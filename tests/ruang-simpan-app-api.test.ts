import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
const { hashIntegrationToken, parseIntegrationBearer, registerRuangSimpanAppApi, SAVE_COMPANY_PROFILE_SQL } = await import("../server/ruang-simpan-app-api");
const { pool } = await import("../server/db");
const { authStorage } = await import("../server/replit_integrations/auth/storage");

test("token aplikasi hanya dikenali dalam header Bearer dengan format yang tepat", () => {
  const token = `gst_rs_${"a".repeat(43)}`;
  assert.equal(parseIntegrationBearer(`Bearer ${token}`), token);
  assert.equal(parseIntegrationBearer(token), null);
  assert.equal(parseIntegrationBearer(`Bearer ${token} extra`), null);
  assert.equal(parseIntegrationBearer(`Bearer ${token}\nother`), null);
  assert.equal(hashIntegrationToken(token).length, 64);
  assert.notEqual(hashIntegrationToken(token), token);
});

test("API eksternal menolak token mati dan membatasi pemilik, izin serta revisi", async () => {
  const validToken = `gst_rs_${"b".repeat(43)}`;
  const validHash = hashIntegrationToken(validToken);
  let revoked = false;
  let scopes = ["profile:read"];
  let profile: { name: string; nib: string; address: string; revision: number } | null =
    { name: "Usaha A", nib: "123", address: "Jakarta", revision: 1 };
  const queries: string[] = [];
  const originalQuery = pool.query;
  const originalGetUser = authStorage.getUser;
  (authStorage as any).getUser = async () => ({ id: "owner-a", isActive: true, role: "user" });
  // All DB calls remain in this process-local mock; this test never touches
  // the project/customer database.
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    queries.push(sql);
    if (sql.includes("FROM ruang_simpan_app_connections c")) {
      return { rows: params[0] === validHash && !revoked
        ? [{ id: "app-id", owner_user_id: "owner-a", scopes }] : [] };
    }
    if (sql.includes("FROM ruang_simpan_company_profiles WHERE")) {
      assert.equal(params[0], "owner-a");
      return { rows: profile ? [profile] : [] };
    }
    if (sql.includes("WITH updated AS")) {
      assert.equal(params[0], "owner-a");
      if (params[4] !== (profile?.revision ?? 0)) return { rows: [] };
      profile = { name: params[1] as string, nib: params[2] as string, address: params[3] as string, revision: (profile?.revision ?? 0) + 1 };
      return { rows: [profile] };
    }
    return { rows: [], rowCount: 0 };
  };
  const app = express();
  app.use(express.json({ limit: "8kb" }));
  app.use("/api/ruang-simpan", (req: any, _res, next) => {
    // A browser may retain email and OIDC sessions at once. The authenticated
    // email principal must win, not the unrelated stale Passport req.user.
    req.session = { emailUser: { id: "owner-a" } };
    req.user = { id: "victim", claims: { sub: "victim" } };
    next();
  });
  let server: ReturnType<typeof createServer> | undefined;
  try {
    await registerRuangSimpanAppApi(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const call = async (method: string, path: string, token?: string, body?: object) => {
      const response = await fetch(url + path, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json", Origin: url } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (path.startsWith("/api/v1/ruang-simpan/")) {
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-gustafta-rs-contract"), "rs-app-v1-private-no-store");
      }
      return response;
    };
    const ownerRead = await call("GET", "/api/ruang-simpan/company-profile");
    assert.equal(ownerRead.status, 200);
    assert.equal((await ownerRead.json() as { name: string }).name, "Usaha A");
    const ownerApps = await call("GET", "/api/ruang-simpan/app-connections");
    assert.equal(ownerApps.status, 200);
    assert.ok(queries.some((sql) => sql.includes("FROM ruang_simpan_app_connections c") && sql.includes("c.owner_user_id = $1")));
    const external = "/api/v1/ruang-simpan/company-profile";
    const missingToken = await call("GET", external);
    assert.equal(missingToken.status, 401);
    assert.match(missingToken.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await missingToken.json(), { error: "Token integrasi tidak valid." });
    assert.equal((await call("GET", external, `gst_rs_${"z".repeat(43)}`)).status, 401);
    const read = await call("GET", external, validToken);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("cache-control"), "private, no-store");
    assert.equal((await read.json() as { name: string }).name, "Usaha A");
    const next = { name: "Usaha B", nib: "234", address: "Bandung", revision: 1 };
    assert.equal((await call("PUT", external, validToken, next)).status, 403);
    scopes = ["profile:write"];
    assert.equal((await call("GET", external, validToken)).status, 403);
    assert.equal((await call("PUT", external, validToken, { ...next, owner_user_id: "victim" })).status, 400);
    profile = null;
    assert.equal((await call("PUT", external, validToken, { ...next, revision: 999 })).status, 409);
    assert.ok(queries.some((sql) => sql.includes("WHERE $5 = 0") && sql.includes("AND revision = $5")));
    assert.equal((await call("PUT", external, validToken, { ...next, revision: 0 })).status, 200);
    assert.equal(profile?.revision, 1);
    assert.equal((await call("PUT", "/api/ruang-simpan/company-profile", undefined, { ...next, revision: 1 })).status, 200);
    assert.equal(profile?.revision, 2);
    assert.equal(profile?.name, "Usaha B");
    assert.equal((await call("PUT", external, validToken, next)).status, 409);
    const updated = { ...next, revision: 2 };
    assert.equal((await call("PUT", external, validToken, updated)).status, 200);
    assert.equal(profile.name, "Usaha B");
    assert.equal((await call("PUT", external, validToken, updated)).status, 409);
    assert.equal((await call("PUT", "/api/ruang-simpan/company-profile", undefined, {
      ...next, revision: profile.revision, updated_at: null,
    })).status, 400);
    for (const nib of ["1234567890", "SAMPLE-NIB-001", ""]) {
      const saved = await call("PUT", "/api/ruang-simpan/company-profile", undefined, {
        ...next, revision: profile.revision, nib,
      });
      assert.equal(saved.status, 200);
      assert.equal((await saved.json() as { nib: string }).nib, nib);
    }
    revoked = true;
    assert.equal((await call("PUT", external, validToken, { ...next, revision: 3 })).status, 401);
    assert.ok(queries.some((sql) => sql.includes("JOIN users u") && sql.includes("u.is_active = true")));
    assert.ok(queries.some((sql) => sql.includes("INSERT INTO ruang_simpan_profile_changes")));
  } finally {
    await new Promise<void>((resolve, reject) => server?.close((err) => err ? reject(err) : resolve()) ?? resolve());
    (pool as any).query = originalQuery;
    (authStorage as any).getUser = originalGetUser;
  }
});

test("header kontrak dipasang sebelum pemeriksaan token dan penolakan rate limit", async () => {
  const originalQuery = pool.query;
  let databaseCalls = 0;
  (pool as any).query = async () => {
    databaseCalls++;
    return { rows: [], rowCount: 0 };
  };
  const app = express();
  // Isolate this test's limiter key from other HTTP tests.
  app.set("trust proxy", 1);
  let server: ReturnType<typeof createServer> | undefined;
  try {
    await registerRuangSimpanAppApi(app);
    const registrationCalls = databaseCalls;
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/v1/ruang-simpan/company-profile`;
    for (let attempt = 1; attempt <= 61; attempt++) {
      const response = await fetch(url, { headers: { "X-Forwarded-For": "192.0.2.41" } });
      assert.equal(response.status, attempt <= 60 ? 401 : 429);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-gustafta-rs-contract"), "rs-app-v1-private-no-store");
      if (attempt <= 60) {
        assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
        assert.deepEqual(await response.json(), { error: "Token integrasi tidak valid." });
      } else {
        await response.text();
      }
    }
    assert.equal(databaseCalls, registrationCalls, "missing tokens never query company data");
  } finally {
    await new Promise<void>((resolve, reject) => server?.close((err) => err ? reject(err) : resolve()) ?? resolve());
    (pool as any).query = originalQuery;
  }
});

test("akses dokumen aplikasi dibatasi owner, pilihan, scope, pencabutan dan kedaluwarsa", async () => {
  const token = `gst_rs_${"c".repeat(43)}`;
  const selected = randomUUID(), unselected = randomUUID(), foreign = randomUUID(), folder = randomUUID();
  let revoked = false, expired = false, granted = true;
  let scopes = ["files:read"];
  const originalQuery = pool.query;
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM ruang_simpan_app_connections c") && sql.includes("token_hash"))
      return { rows: params[0] === hashIntegrationToken(token) && !revoked && !expired
        ? [{ id: "connection-a", owner_user_id: "owner-a", scopes }] : [] };
    if (sql.includes("FROM ruang_simpan_files f") && sql.includes("ruang_simpan_app_selections")) {
      assert.equal(params[0], "owner-a");
      assert.equal(params[1], "connection-a");
      if (sql.includes("f.id = $3")) {
        const id = params[2];
        return { rows: granted && id === selected ? [{
          id, original_name: "selected.txt", mime_type: "text/plain",
          file_content: Buffer.from("owner-a"), doc_status: "aktif",
        }] : [] };
      }
      return { rows: granted ? [{ id: selected }] : [] };
    }
    if (sql.includes("FROM ruang_simpan_folders fo")) {
      assert.equal(params[0], "owner-a");
      return { rows: params[2] === folder && granted ? [{ "?column?": 1 }] : [] };
    }
    return { rows: [], rowCount: 0 };
  };
  const app = express();
  app.use(express.json());
  let server: ReturnType<typeof createServer> | undefined;
  try {
    await registerRuangSimpanAppApi(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1/ruang-simpan/files`;
    const call = (path: string) => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual((await (await call("")).json() as any).files.map((f: any) => f.id), [selected]);
    assert.equal((await call(`/${selected}`)).status, 200);
    assert.equal((await call(`/${selected}/content`)).status, 200);
    assert.equal((await call(`/${unselected}`)).status, 404);
    assert.equal((await call(`/${unselected}/content`)).status, 404);
    assert.equal((await call(`/${foreign}/content`)).status, 404);
    scopes = ["files:write"];
    assert.equal((await call(`/${selected}/content`)).status, 403);
    const upload = async (folderId: string) => {
      const form = new FormData();
      form.append("folder_id", folderId);
      form.append("file", new Blob(["dokumen tes"], { type: "text/plain" }), "tes.txt");
      return fetch(base, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    };
    assert.equal((await upload(randomUUID())).status, 403);
    granted = false;
    assert.equal((await upload(folder)).status, 403);
    scopes = ["files:read"];
    assert.equal((await call(`/${selected}/content`)).status, 404);
    granted = true;
    expired = true;
    assert.equal((await call(`/${selected}/content`)).status, 401);
    expired = false;
    revoked = true;
    assert.equal((await call(`/${selected}/content`)).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()) ?? resolve());
    (pool as any).query = originalQuery;
  }
});

test("PostgreSQL menegakkan revisi pertama, konflik dan audit secara atomik", { skip: !testDatabaseReady && testDbSkip }, async () => {
  // An isolated uncommitted transaction: even if the test process is killed,
  // PostgreSQL rolls back the temporary user and all dependent rows.
  const client = await pool.connect();
  const owner = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id) VALUES ($1)", [owner]);
    const write = (revision: number, name: string) =>
      client.query(SAVE_COMPANY_PROFILE_SQL, [owner, name, "", "", revision, null]);
    assert.equal((await write(999, "Salah")).rowCount, 0);
    assert.equal((await write(0, "Pertama")).rows[0].revision, 1);
    assert.equal((await write(0, "Terlambat")).rowCount, 0);
    assert.equal((await write(1, "Kedua")).rows[0].revision, 2);
    assert.equal((await write(1, "Menimpa")).rowCount, 0);
    const profile = await client.query(
      "SELECT name, revision FROM ruang_simpan_company_profiles WHERE owner_user_id = $1", [owner],
    );
    assert.deepEqual(profile.rows[0], { name: "Kedua", revision: 2 });
    const logs = await client.query(
      "SELECT revision FROM ruang_simpan_profile_changes WHERE owner_user_id = $1 ORDER BY revision", [owner],
    );
    assert.deepEqual(logs.rows.map((row) => row.revision), [1, 2]);
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
});

test("PostgreSQL tidak mengizinkan pilihan milik akun lain terbaca lewat koneksi aplikasi", { skip: !testDatabaseReady && testDbSkip }, async () => {
  const client = await pool.connect();
  const owner = randomUUID(), other = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
    const { rows: [{ id: folder }] } = await client.query(
      "INSERT INTO ruang_simpan_folders (user_id, name) VALUES ($1, 'Folder A') RETURNING id", [owner],
    );
    const { rows: [{ id: otherFolder }] } = await client.query(
      "INSERT INTO ruang_simpan_folders (user_id, name) VALUES ($1, 'Folder B') RETURNING id", [other],
    );
    const { rows: [{ id: file }] } = await client.query(
      "INSERT INTO ruang_simpan_files (user_id, folder_id, original_name) VALUES ($1,$2,'A') RETURNING id", [owner, folder],
    );
    const { rows: [{ id: otherFile }] } = await client.query(
      "INSERT INTO ruang_simpan_files (user_id, folder_id, original_name) VALUES ($1,$2,'B') RETURNING id", [other, otherFolder],
    );
    const { rows: [{ id: connection }] } = await client.query(
      `INSERT INTO ruang_simpan_app_connections (owner_user_id, name, token_hash, scopes, expires_at)
       VALUES ($1,'tes','${
         hashIntegrationToken(randomUUID())
       }',ARRAY['files:read'],now() + interval '1 day') RETURNING id`, [owner],
    );
    // Even if a malformed selection row points at someone else's file, owner
    // containment in the read query must still reject it.
    await client.query(
      "INSERT INTO ruang_simpan_app_selections (connection_id, file_id) VALUES ($1,$2)", [connection, otherFile],
    );
    const permitted = (id: string) => client.query(
      `SELECT f.id FROM ruang_simpan_files f
       WHERE f.user_id = $1 AND f.id = $3 AND f.doc_status = 'aktif'
         AND EXISTS (SELECT 1 FROM ruang_simpan_app_selections s
           WHERE s.connection_id = $2 AND (s.file_id = f.id OR s.folder_id = f.folder_id))`,
      [owner, connection, id],
    );
    assert.equal((await permitted(otherFile)).rowCount, 0);
    assert.equal((await permitted(file)).rowCount, 0);
    await client.query(
      "INSERT INTO ruang_simpan_app_selections (connection_id, folder_id) VALUES ($1,$2)", [connection, folder],
    );
    assert.equal((await permitted(file)).rowCount, 1);
    await client.query(
      "DELETE FROM ruang_simpan_app_selections WHERE connection_id = $1 AND folder_id = $2", [connection, folder],
    );
    assert.equal((await permitted(file)).rowCount, 0);
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
});