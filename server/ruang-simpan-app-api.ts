/**
 * Canonical, account-owned company profile and scoped server-to-server access.
 * Tokens are created by the account owner, shown once, and never accepted as
 * an owner ID supplied in a request body.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { pool } from "./db";
import type { PoolClient } from "pg";
import { authenticateRequest } from "./replit_integrations/auth";
import { downloadFile } from "./lib/object-storage";
import { ruangSimpanUpload, ingestRuangSimpanFile } from "./ruang-simpan-routes";
import { rsConnectionAuditDDL } from "./lib/rs-connection-audit";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nib: z.string().trim().max(32),
  address: z.string().trim().max(500),
  revision: z.number().int().min(0),
}).strict();

const connectionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  scopes: z.array(z.enum(["profile:read", "profile:write", "files:read", "files:write"])).min(1).max(4)
    .refine((scopes) => new Set(scopes).size === scopes.length),
  file_ids: z.array(z.string().uuid()).max(100).default([]),
  folder_ids: z.array(z.string().uuid()).max(50).default([]),
}).strict();

const selectionSchema = connectionSchema.pick({ file_ids: true, folder_ids: true });
const connectionRevisionSchema = z.object({
  revision: z.number().int().min(1).max(2147483646),
}).strict();
type Scope = "profile:read" | "profile:write" | "files:read" | "files:write";
type ApiRequest = Request & { integration?: { id: string; ownerId: string; scopes: Scope[] } };

export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// A single UPDATE locks and replaces the credential atomically without
// recreating the connection or touching its scope, selections or expiry.
export const ROTATE_INTEGRATION_TOKEN_SQL = `
  WITH changed AS (
  UPDATE ruang_simpan_app_connections SET token_hash = $3, revision = revision + 1
   WHERE id = $1 AND owner_user_id = $2
     AND revision = $4
     AND revoked_at IS NULL AND expires_at > now()
   RETURNING id, name, scopes, created_at, expires_at, revoked_at, revision
  ), recorded AS (
    INSERT INTO ruang_simpan_connection_changes (owner_user_id, actor_user_id, connection_id, action)
    SELECT $2, $2, id, 'token_rotated' FROM changed RETURNING id
  ) SELECT changed.* FROM changed JOIN recorded ON true`;

export const REVOKE_INTEGRATION_SQL = `
  WITH changed AS (
    UPDATE ruang_simpan_app_connections SET revoked_at = now(), revision = revision + 1
    WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL AND revision = $3
    RETURNING id, revision
  ), recorded AS (
    INSERT INTO ruang_simpan_connection_changes (owner_user_id, actor_user_id, connection_id, action)
    SELECT $2, $2, id, 'revoked' FROM changed RETURNING id
  ) SELECT changed.revision FROM changed JOIN recorded ON true`;

async function recordConnectionChange(
  client: PoolClient, owner: string, connectionId: string, action: "created" | "selections_changed",
) {
  await client.query(
    `INSERT INTO ruang_simpan_connection_changes (owner_user_id, actor_user_id, connection_id, action)
     VALUES ($1, $1, $2, $3)`, [owner, connectionId, action],
  );
}

// Only disclose a conflict for an owned connection, never for another account.
async function connectionWriteMiss(res: Response, id: string) {
  const { rows } = await pool.query(
    `SELECT id FROM ruang_simpan_app_connections WHERE id = $1 AND owner_user_id = $2`,
    [id, ownerId(res)],
  );
  return rows[0]
    ? res.status(409).json({ error: "Koneksi telah berubah atau tidak aktif. Muat ulang daftar aplikasi sebelum mencoba lagi." })
    : res.status(404).json({ error: "Koneksi tidak ditemukan." });
}

export function parseIntegrationBearer(header: string | undefined): string | null {
  const match = /^Bearer (gst_rs_[A-Za-z0-9_-]{43})$/.exec(header ?? "");
  return match?.[1] ?? null;
}

async function authenticatedOwner(req: Request, res: Response, next: NextFunction) {
  const result = await authenticateRequest(req);
  if (!result.ok) return res.status(result.status).json({ error: result.message });
  res.locals.rsOwnerId = result.userId;
  next();
}

function ownerId(res: Response): string {
  return res.locals.rsOwnerId as string;
}

function onlySameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  try {
    if (origin && new URL(origin).host === req.get("host")) return next();
  } catch {
    // Missing or invalid Origin must not authorize a cookie-backed write.
  }
  return res.status(403).json({ error: "Permintaan harus berasal dari Gustafta." });
}

async function profileFor(owner: string) {
  const { rows } = await pool.query<{
    name: string; nib: string; address: string; revision: number; updated_at: Date;
  }>(
    `SELECT name, nib, address, revision, updated_at
       FROM ruang_simpan_company_profiles WHERE owner_user_id = $1`,
    [owner],
  );
  return rows[0] ?? { name: "", nib: "", address: "", revision: 0, updated_at: null };
}

// UPDATE locks the existing row and compares its current revision atomically.
// Only revision 0 can create a profile; concurrent first creates conflict
// safely without overwriting each other.
export const SAVE_COMPANY_PROFILE_SQL = `
     WITH updated AS (
       UPDATE ruang_simpan_company_profiles
          SET name = $2, nib = $3, address = $4,
              revision = revision + 1, updated_at = now()
        WHERE owner_user_id = $1 AND revision = $5
       RETURNING name, nib, address, revision, updated_at
     ), inserted AS (
       INSERT INTO ruang_simpan_company_profiles
         (owner_user_id, name, nib, address, revision)
       SELECT $1, $2, $3, $4, 1
       WHERE $5 = 0 AND NOT EXISTS (SELECT 1 FROM updated)
       ON CONFLICT (owner_user_id) DO NOTHING
       RETURNING name, nib, address, revision, updated_at
     ), changed AS (
       SELECT * FROM updated UNION ALL SELECT * FROM inserted
     ), recorded AS (
       INSERT INTO ruang_simpan_profile_changes (owner_user_id, revision, actor_connection_id)
       SELECT $1, revision, $6 FROM changed RETURNING id
     ) SELECT changed.* FROM changed JOIN recorded ON true`;

async function saveProfile(owner: string, input: z.infer<typeof profileSchema>, actorConnectionId: string | null = null) {
  const { rows } = await pool.query(
    SAVE_COMPANY_PROFILE_SQL,
    [owner, input.name, input.nib, input.address, input.revision, actorConnectionId],
  );
  return rows[0] ?? null;
}

async function authorizeIntegration(req: ApiRequest, res: Response, next: NextFunction) {
  const token = parseIntegrationBearer(req.get("authorization"));
  if (!token) return res.status(401).json({ error: "Token integrasi tidak valid." });
  try {
    const { rows } = await pool.query<{ id: string; owner_user_id: string; scopes: Scope[] }>(
      `SELECT c.id, c.owner_user_id, c.scopes
         FROM ruang_simpan_app_connections c
         JOIN users u ON u.id = c.owner_user_id
        WHERE c.token_hash = $1 AND c.revoked_at IS NULL AND c.expires_at > now()
          AND u.is_active = true`,
      [hashIntegrationToken(token)],
    );
    if (!rows[0]) return res.status(401).json({ error: "Token integrasi tidak valid." });
    req.integration = { id: rows[0].id, ownerId: rows[0].owner_user_id, scopes: rows[0].scopes };
    return next();
  } catch {
    return res.status(503).json({ error: "Izin integrasi tidak dapat diverifikasi." });
  }
}

function requireScope(scope: Scope) {
  return (req: ApiRequest, res: Response, next: NextFunction) => {
    if (!req.integration?.scopes.includes(scope)) {
      return res.status(403).json({ error: "Izin aplikasi tidak mencakup tindakan ini." });
    }
    next();
  };
}

const integrationLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as ApiRequest).integration?.id ?? ipKeyGenerator(req.ip ?? ""),
});
const appUploadLimit = rateLimit({
  windowMs: 60 * 60_000, limit: 20,
  standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: (req) => (req as ApiRequest).integration!.id,
});
// Invalid tokens must be limited before any DB lookup. This is an additional
// per-instance guard; valid tokens also have a separate per-connection limit.
const tokenAttemptLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

class InvalidSelection extends Error {}
async function writeSelections(client: PoolClient, connectionId: string, owner: string, selections: z.infer<typeof selectionSchema>) {
  const files = [...new Set(selections.file_ids)];
  const folders = [...new Set(selections.folder_ids)];
  const [{ rows: ownedFiles }, { rows: ownedFolders }] = await Promise.all([
    client.query(`SELECT id FROM ruang_simpan_files WHERE user_id = $1 AND id = ANY($2::uuid[])`, [owner, files]),
    client.query(`SELECT id FROM ruang_simpan_folders WHERE user_id = $1 AND id = ANY($2::uuid[])`, [owner, folders]),
  ]);
  if (ownedFiles.length !== files.length || ownedFolders.length !== folders.length) throw new InvalidSelection();
  await client.query(`DELETE FROM ruang_simpan_app_selections WHERE connection_id = $1`, [connectionId]);
  for (const id of files) await client.query(
    `INSERT INTO ruang_simpan_app_selections (connection_id, file_id) VALUES ($1,$2)`, [connectionId, id],
  );
  for (const id of folders) await client.query(
    `INSERT INTO ruang_simpan_app_selections (connection_id, folder_id) VALUES ($1,$2)`, [connectionId, id],
  );
}

async function replaceSelections(connectionId: string, owner: string, selections: z.infer<typeof selectionSchema>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [connection] } = await client.query(
      `SELECT id FROM ruang_simpan_app_connections
       WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`,
      [connectionId, owner],
    );
    if (!connection) { await client.query("ROLLBACK"); return false; }
    await writeSelections(client, connectionId, owner, selections);
    await recordConnectionChange(client, owner, connectionId, "selections_changed");
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof InvalidSelection) return false;
    throw error;
  } finally { client.release(); }
}

// Always join both the token's owner and current selections. Folder selections
// follow files moved into/out of that folder; file selections remain file-specific.
const permittedFileSql = `
  FROM ruang_simpan_files f
 WHERE f.user_id = $1 AND f.id = $3 AND f.doc_status = 'aktif'
   AND EXISTS (SELECT 1 FROM ruang_simpan_app_selections s
               WHERE s.connection_id = $2 AND
                 (s.file_id = f.id OR s.folder_id = f.folder_id))`;

async function logAppAccess(fileId: string, owner: string, connectionId: string, action: string) {
  await pool.query(
    `INSERT INTO ruang_simpan_access_log
     (file_id, file_owner_user_id, actor_name, action, meta)
     VALUES ($1,$2,'Aplikasi eksternal',$3,$4)`,
    [fileId, owner, action, JSON.stringify({ connection_id: connectionId })],
  );
}

export async function registerRuangSimpanAppApi(app: Express): Promise<void> {
  // Idempotent boot migration: endpoints must not be served against an old schema.
  await pool.query(`CREATE TABLE IF NOT EXISTS ruang_simpan_company_profiles (
    owner_user_id varchar(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL, nib varchar(32) NOT NULL DEFAULT '',
    address varchar(500) NOT NULL DEFAULT '',
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ruang_simpan_app_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL, token_hash char(64) NOT NULL UNIQUE,
    scopes text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL, revoked_at timestamptz, last_used_at timestamptz,
    CONSTRAINT ruang_simpan_app_scopes CHECK (
       array_length(scopes, 1) BETWEEN 1 AND 4
       AND scopes <@ ARRAY['profile:read','profile:write','files:read','files:write']::text[]
    )
  )`);
  await pool.query(`ALTER TABLE ruang_simpan_app_connections
    ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)`);
  // Existing installations have the old two-scope constraint.
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'ruang_simpan_app_scopes'
        AND pg_get_constraintdef(oid) LIKE '%files:read%'
    ) THEN
      ALTER TABLE ruang_simpan_app_connections DROP CONSTRAINT IF EXISTS ruang_simpan_app_scopes;
      ALTER TABLE ruang_simpan_app_connections ADD CONSTRAINT ruang_simpan_app_scopes
        CHECK (array_length(scopes, 1) BETWEEN 1 AND 4
          AND scopes <@ ARRAY['profile:read','profile:write','files:read','files:write']::text[]);
    END IF;
  END $$`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ruang_simpan_app_selections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id uuid NOT NULL REFERENCES ruang_simpan_app_connections(id) ON DELETE CASCADE,
    file_id uuid REFERENCES ruang_simpan_files(id) ON DELETE CASCADE,
    folder_id uuid REFERENCES ruang_simpan_folders(id) ON DELETE CASCADE,
    CONSTRAINT rs_app_selection_target CHECK ((file_id IS NULL) <> (folder_id IS NULL))
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS rs_app_selection_file
    ON ruang_simpan_app_selections(connection_id, file_id) WHERE file_id IS NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS rs_app_selection_folder
    ON ruang_simpan_app_selections(connection_id, folder_id) WHERE folder_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ruang_simpan_app_connections_owner_idx
    ON ruang_simpan_app_connections(owner_user_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ruang_simpan_profile_changes (
    id bigserial PRIMARY KEY,
    owner_user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision integer NOT NULL, actor_connection_id uuid,
    changed_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ruang_simpan_profile_changes_owner_idx
    ON ruang_simpan_profile_changes(owner_user_id, changed_at DESC)`);
  await pool.query(rsConnectionAuditDDL);

  app.get("/api/ruang-simpan/app-connections/history", authenticatedOwner, async (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const { rows } = await pool.query(
        `SELECT id::text, actor_user_id, connection_id, action, changed_at
         FROM ruang_simpan_connection_changes WHERE owner_user_id = $1
         ORDER BY changed_at DESC, id DESC LIMIT 50`, [ownerId(res)],
      );
      res.json({ history: rows });
    } catch { res.status(503).json({ error: "Riwayat akses aplikasi belum dapat dibaca." }); }
  });

  app.get("/api/ruang-simpan/company-profile", authenticatedOwner, async (_req, res) => {
    const owner = ownerId(res);
    res.setHeader("Cache-Control", "private, no-store");
    try { res.json(await profileFor(owner)); }
    catch { res.status(503).json({ error: "Profil belum dapat dibaca." }); }
  });

  app.put("/api/ruang-simpan/company-profile", authenticatedOwner, onlySameOrigin, async (req, res) => {
    const owner = ownerId(res);
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data profil tidak valid." });
    res.setHeader("Cache-Control", "no-store");
    try {
      const saved = await saveProfile(owner, parsed.data);
      if (!saved) return res.status(409).json({ error: "Profil telah berubah. Muat ulang sebelum menyimpan." });
      res.json(saved);
    } catch {
      res.status(503).json({ error: "Profil belum dapat disimpan." });
    }
  });

  app.get("/api/ruang-simpan/app-connections", authenticatedOwner, async (_req, res) => {
    const owner = ownerId(res);
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const { rows } = await pool.query(
         `SELECT c.id, c.name, c.scopes, c.created_at, c.expires_at, c.revoked_at, c.revision,
                 COALESCE(array_agg(DISTINCT s.file_id) FILTER (WHERE s.file_id IS NOT NULL), '{}') AS file_ids,
                 COALESCE(array_agg(DISTINCT s.folder_id) FILTER (WHERE s.folder_id IS NOT NULL), '{}') AS folder_ids
            FROM ruang_simpan_app_connections c
            LEFT JOIN ruang_simpan_app_selections s ON s.connection_id = c.id
           WHERE c.owner_user_id = $1 GROUP BY c.id ORDER BY c.created_at DESC`,
        [owner],
      );
      res.json({ connections: rows });
    } catch { res.status(503).json({ error: "Daftar aplikasi belum dapat dibaca." }); }
  });

  app.post("/api/ruang-simpan/app-connections", authenticatedOwner, onlySameOrigin, async (req, res) => {
    const owner = ownerId(res);
    const parsed = connectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Nama atau izin aplikasi tidak valid." });
    const token = `gst_rs_${randomBytes(32).toString("base64url")}`;
    res.setHeader("Cache-Control", "no-store");
    const client = await pool.connect().catch(() => null);
    if (!client) return res.status(503).json({ error: "Izin aplikasi belum dapat dibuat." });
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO ruang_simpan_app_connections
           (owner_user_id, name, token_hash, scopes, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '90 days')
          RETURNING id, name, scopes, created_at, expires_at, revoked_at, revision`,
        [owner, parsed.data.name, hashIntegrationToken(token), parsed.data.scopes],
      );
      await writeSelections(client, rows[0].id, owner, parsed.data);
      await recordConnectionChange(client, owner, rows[0].id, "created");
      await client.query("COMMIT");
      res.status(201).json({ connection: rows[0], token });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(error instanceof InvalidSelection ? 400 : 503).json({
        error: error instanceof InvalidSelection ? "Pilihan file/folder bukan milik akun ini." : "Izin aplikasi belum dapat dibuat.",
      });
    } finally { client.release(); }
  });

  app.put("/api/ruang-simpan/app-connections/:id/selections", authenticatedOwner, onlySameOrigin, async (req, res) => {
    const parsed = selectionSchema.safeParse(req.body);
    if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) return res.sendStatus(400);
    try {
      if (!await replaceSelections(req.params.id as string, ownerId(res), parsed.data)) return res.sendStatus(404);
      res.setHeader("Cache-Control", "no-store");
      res.json({ file_ids: parsed.data.file_ids, folder_ids: parsed.data.folder_ids });
    } catch { res.status(503).json({ error: "Pilihan dokumen belum dapat disimpan." }); }
  });

  app.post("/api/ruang-simpan/app-connections/:id/rotate-token", authenticatedOwner, onlySameOrigin, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const parsed = connectionRevisionSchema.safeParse(req.body);
    if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) {
      return res.status(400).json({ error: "ID koneksi dan revision integer positif wajib dikirim." });
    }
    const token = `gst_rs_${randomBytes(32).toString("base64url")}`;
    try {
      const { rows } = await pool.query(
        ROTATE_INTEGRATION_TOKEN_SQL,
        [req.params.id, ownerId(res), hashIntegrationToken(token), parsed.data.revision],
      );
      if (!rows[0]) return await connectionWriteMiss(res, req.params.id as string);
      res.json({ connection: rows[0], token });
    } catch {
      res.status(503).json({ error: "Token belum dapat diganti. Periksa status koneksi sebelum mencoba lagi." });
    }
  });

  app.delete("/api/ruang-simpan/app-connections/:id", authenticatedOwner, onlySameOrigin, async (req, res) => {
    const owner = ownerId(res);
    res.setHeader("Cache-Control", "private, no-store");
    const parsed = connectionRevisionSchema.safeParse(req.body);
    if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) {
      return res.status(400).json({ error: "ID koneksi dan revision integer positif wajib dikirim." });
    }
    try {
      const { rowCount } = await pool.query(
        REVOKE_INTEGRATION_SQL,
        [req.params.id, owner, parsed.data.revision],
      );
      if (!rowCount) return await connectionWriteMiss(res, req.params.id as string);
      res.json({ revoked: true });
    } catch { res.status(503).json({ error: "Izin aplikasi belum dapat dicabut." }); }
  });

  // Apply the contract before token checks and rate limits, including their
  // early-return responses (401, 403 and 429).
  app.use("/api/v1/ruang-simpan", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Gustafta-RS-Contract", "rs-app-v1-private-no-store");
    next();
  });

  app.get("/api/v1/ruang-simpan/company-profile", tokenAttemptLimit, authorizeIntegration, integrationLimit, requireScope("profile:read"), async (req: ApiRequest, res) => {
    try { res.json(await profileFor(req.integration!.ownerId)); }
    catch { res.status(503).json({ error: "Profil belum dapat dibaca." }); }
  });

  app.put("/api/v1/ruang-simpan/company-profile", tokenAttemptLimit, authorizeIntegration, integrationLimit, requireScope("profile:write"), async (req: ApiRequest, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Data profil tidak valid." });
    try {
      const saved = await saveProfile(req.integration!.ownerId, parsed.data, req.integration!.id);
      if (!saved) return res.status(409).json({ error: "Profil telah berubah. Muat ulang sebelum menyimpan." });
      res.json(saved);
    } catch { res.status(503).json({ error: "Profil belum dapat disimpan." }); }
  });

  const external = [tokenAttemptLimit, authorizeIntegration, integrationLimit] as const;
  app.get("/api/v1/ruang-simpan/files", ...external, requireScope("files:read"), async (req: ApiRequest, res) => {
    try {
      const { ownerId: owner, id } = req.integration!;
      const { rows } = await pool.query(
        `SELECT DISTINCT f.id, f.original_name, f.mime_type, f.size_bytes, f.description,
                f.folder_id, f.kb_status, f.doc_status, f.created_at
         FROM ruang_simpan_files f
         JOIN ruang_simpan_app_selections s ON s.connection_id = $2
           AND (s.file_id = f.id OR s.folder_id = f.folder_id)
         WHERE f.user_id = $1 AND f.doc_status = 'aktif'
         ORDER BY f.created_at DESC LIMIT 200`, [owner, id],
      );
      res.json({ files: rows });
    } catch { res.status(503).json({ error: "Dokumen belum dapat dibaca." }); }
  });

  app.get("/api/v1/ruang-simpan/files/:id", ...external, requireScope("files:read"), async (req: ApiRequest, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(400);
    try {
      const { ownerId: owner, id } = req.integration!;
      const { rows } = await pool.query(
        `SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.description,
                f.folder_id, f.kb_status, f.doc_status, f.created_at
         ${permittedFileSql}`, [owner, id, req.params.id],
      );
      if (!rows[0]) return res.sendStatus(404);
      await logAppAccess(req.params.id as string, owner, id, "app_read");
      res.json(rows[0]);
    } catch { res.status(503).json({ error: "Dokumen belum dapat dibaca." }); }
  });

  app.get("/api/v1/ruang-simpan/files/:id/content", ...external, requireScope("files:read"), async (req: ApiRequest, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.sendStatus(400);
    try {
      const { ownerId: owner, id } = req.integration!;
      const { rows } = await pool.query(
        `SELECT f.original_name, f.mime_type, f.storage_key, f.file_content
         ${permittedFileSql}`, [owner, id, req.params.id],
      );
      if (!rows[0]) return res.sendStatus(404);
      const file = rows[0];
      let buffer: Buffer;
      if (file.storage_key) {
        try { buffer = await downloadFile(file.storage_key); }
        catch {
          if (!file.file_content) return res.sendStatus(410);
          buffer = Buffer.from(file.file_content);
        }
      } else if (file.file_content) buffer = Buffer.from(file.file_content);
      else return res.sendStatus(410);
      await logAppAccess(req.params.id as string, owner, id, "app_download");
      res.setHeader("Content-Type", file.mime_type);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name)}"`);
      res.send(buffer);
    } catch { res.status(503).json({ error: "Konten dokumen belum dapat dibaca." }); }
  });

  app.post("/api/v1/ruang-simpan/files", ...external, requireScope("files:write"), appUploadLimit,
    (req, res, next) => ruangSimpanUpload.single("file")(req, res, (error) => {
      if (error) return res.status(400).json({ error: "File tidak didukung atau terlalu besar (maks. 20 MB)." });
      next();
    }),
    async (req: ApiRequest, res) => {
      const parsed = z.object({ folder_id: z.string().uuid(), description: z.string().max(500).optional() }).safeParse(req.body);
      if (!parsed.success || !req.file) return res.sendStatus(400);
      try {
        const { ownerId: owner, id } = req.integration!;
        const { rows } = await pool.query(
          `SELECT 1 FROM ruang_simpan_folders fo
           JOIN ruang_simpan_app_selections s ON s.folder_id = fo.id AND s.connection_id = $2
           WHERE fo.user_id = $1 AND fo.id = $3`,
          [owner, id, parsed.data.folder_id],
        );
        if (!rows[0]) return res.sendStatus(403);
        const result = await ingestRuangSimpanFile(owner, req.file, parsed.data.folder_id, parsed.data.description ?? null, id);
        if (result.quotaExceeded) return res.status(402).json({ error: "Kuota storage penuh.", quota_exceeded: true });
        res.status(201).json(result.saved);
      } catch { res.status(503).json({ error: "Unggah belum dapat diselesaikan." }); }
    },
  );
}