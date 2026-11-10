import { prepareTestDatabase, testDbSkip } from "./test-database";
const databaseReady = await prepareTestDatabase();
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
const { shouldCaptureApiResponse } = await import("../server/lib/response-log-policy");
const { pool } = await import("../server/db");
const { authStorage } = await import("../server/replit_integrations/auth/storage");
const { invalidateUserActiveCache } = await import("../server/replit_integrations/auth");
const { registerRuangSimpanAppApi, hashIntegrationToken, ROTATE_INTEGRATION_TOKEN_SQL } =
  await import("../server/ruang-simpan-app-api");

test("token sekali tampil tidak masuk log respons termasuk varian URL", () => {
  for (const path of [
    "/api/ruang-simpan/app-connections",
    "/api/ruang-simpan/app-connections/abc/rotate-token",
    "/api/ruang-simpan/app-connections/abc/selections",
    "/api/ruang-simpan/app-connections/history",
    "/API/RUANG-SIMPAN/APP-CONNECTIONS/abc/ROTATE-TOKEN/",
  ]) {
    assert.equal(shouldCaptureApiResponse(path, undefined, "development"), false);
  }
  assert.equal(shouldCaptureApiResponse("/alias", "/api/ruang-simpan/app-connections/:id/rotate-token", "development"), false);
  assert.equal(shouldCaptureApiResponse("/api/health", undefined, "development"), true);
});

test("rotasi HTTP hanya untuk pemilik aktif, token lama mati dan akses baru tetap terbatas", async () => {
  const id = randomUUID(), selected = randomUUID(), folder = randomUUID();
  const oldToken = `gst_rs_${"r".repeat(43)}`;
  let hash = hashIntegrationToken(oldToken);
  let principal: string | null = "owner-a", active = true, expired = false, revoked = false, fail = false;
  const connection = {
    id, revision: 1, name: "Aplikasi A", scopes: ["files:read", "profile:read"],
    created_at: "2026-01-01", expires_at: "2099-01-01", revoked_at: null,
    file_ids: [selected], folder_ids: [folder],
  };
  const originalQuery = pool.query, originalGetUser = authStorage.getUser;
  (authStorage as any).getUser = async () => ({ id: principal, isActive: active, role: "user" });
  let rotations = 0;
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql === ROTATE_INTEGRATION_TOKEN_SQL) {
      rotations++;
      if (fail) throw new Error("Database unavailable");
      if (params[0] !== id || params[1] !== "owner-a" || revoked || expired || params[3] !== connection.revision) return { rows: [] };
      hash = params[2] as string;
      connection.revision++;
      return { rows: [connection] };
    }
    if (sql.includes("SELECT id FROM ruang_simpan_app_connections WHERE")) {
      return { rows: params[0] === id && params[1] === "owner-a" ? [{ id }] : [] };
    }
    if (sql.includes("FROM ruang_simpan_app_connections c")) {
      if (sql.includes("c.token_hash"))
        return { rows: params[0] === hash && !revoked && !expired && active
          ? [{ id, owner_user_id: "owner-a", scopes: connection.scopes }] : [] };
      assert.equal(params[0], "owner-a");
      return { rows: [connection] };
    }
    if (sql.includes("FROM ruang_simpan_files f")) {
      assert.equal(params[0], "owner-a");
      assert.equal(params[1], id);
      assert.ok(sql.includes("ruang_simpan_app_selections"));
      assert.ok(sql.includes("f.doc_status = 'aktif'"));
      return { rows: !params[2] || params[2] === selected
        ? [{ id: selected, original_name: "A.txt", mime_type: "text/plain", file_content: Buffer.from("A") }] : [] };
    }
    return { rows: [], rowCount: 0 };
  };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = principal ? { emailUser: { id: principal } } : {};
    next();
  });
  const server = createServer(app);
  try {
    await registerRuangSimpanAppApi(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const rotate = (connectionId: string = id, origin: string | null = base, body: unknown = { revision: 1 }) => fetch(
      `${base}/api/ruang-simpan/app-connections/${connectionId}/rotate-token`,
      { method: "POST", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const read = (token: string, suffix = `files/${selected}`) => fetch(
      `${base}/api/v1/ruang-simpan/${suffix}`, { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal((await read(oldToken)).status, 200);
    assert.equal((await rotate(id, null)).status, 403);
    assert.equal((await rotate(id, "https://foreign.invalid")).status, 403);
    principal = null;
    assert.equal((await rotate()).status, 401);
    principal = "owner-a"; active = false;
    invalidateUserActiveCache("owner-a");
    assert.equal((await rotate()).status, 403);
    active = true; principal = "owner-b";
    assert.equal((await rotate()).status, 404);
    principal = "owner-a";
    invalidateUserActiveCache("owner-a");
    assert.equal((await rotate("invalid")).status, 400);
    for (const body of [{}, { revision: 0 }, { revision: -1 }, { revision: 1.1 }, { revision: "1" }, { revision: 2147483647 }]) {
      assert.equal((await rotate(id, base, body)).status, 400);
    }
    assert.equal((await rotate(randomUUID())).status, 404);
    revoked = true;
    assert.equal((await rotate()).status, 409);
    revoked = false; expired = true;
    assert.equal((await rotate()).status, 409);
    expired = false; fail = true;
    assert.equal((await rotate()).status, 503);
    assert.equal(hash, hashIntegrationToken(oldToken));
    assert.equal((await read(oldToken)).status, 200);
    fail = false;
    const response = await rotate();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const result = await response.json() as { token: string; connection: typeof connection };
    assert.match(result.token, /^gst_rs_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(result.token, oldToken);
    assert.deepEqual(result.connection, connection);
    assert.equal(hash, hashIntegrationToken(result.token));
    const stale = await rotate();
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as any).token, undefined);
    assert.equal(hash, hashIntegrationToken(result.token));
    assert.equal((await read(oldToken)).status, 401);
    assert.equal((await read(result.token)).status, 200);
    assert.equal((await read(result.token, `files/${selected}/content`)).status, 200);
    assert.equal((await read(result.token, `files/${randomUUID()}/content`)).status, 404);
    const upload = await fetch(`${base}/api/v1/ruang-simpan/files`, {
      method: "POST", headers: { Authorization: `Bearer ${result.token}` },
    });
    assert.equal(upload.status, 403, "rotasi tidak menambahkan scope tulis");
    const listed = await (await fetch(`${base}/api/ruang-simpan/app-connections`)).json() as any;
    assert.equal(JSON.stringify(listed).includes(result.token), false);
    assert.equal(JSON.stringify(listed).includes(hash), false);
    assert.ok(rotations > 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    (pool as any).query = originalQuery;
    (authStorage as any).getUser = originalGetUser;
    invalidateUserActiveCache("owner-a");
    invalidateUserActiveCache("owner-b");
  }
});

test("PostgreSQL mengganti hash atomik tanpa mengubah koneksi dan pilihan", { skip: !databaseReady && testDbSkip }, async () => {
  const client = await pool.connect();
  const id = randomUUID(), owner = randomUUID(), file = randomUUID(), folder = randomUUID();
  const oldHash = hashIntegrationToken(`gst_rs_${"s".repeat(43)}`);
  const newHash = hashIntegrationToken(`gst_rs_${"t".repeat(43)}`);
  try {
    await client.query("BEGIN");
    // Temp tables shadow the app tables. No customer schema or data is changed.
    await client.query(`CREATE TEMP TABLE ruang_simpan_app_connections (
      id uuid PRIMARY KEY, owner_user_id text, name text, token_hash text UNIQUE,
      scopes text[], created_at timestamptz DEFAULT now(),
      expires_at timestamptz, revoked_at timestamptz, revision integer NOT NULL DEFAULT 1) ON COMMIT DROP;
      CREATE TEMP TABLE ruang_simpan_app_selections
      (connection_id uuid, file_id uuid, folder_id uuid) ON COMMIT DROP;
      CREATE TEMP TABLE ruang_simpan_connection_changes (
        id bigserial, owner_user_id text, actor_user_id text, connection_id uuid, action text
      ) ON COMMIT DROP`);
    await client.query(`INSERT INTO ruang_simpan_app_connections
      (id,owner_user_id,name,token_hash,scopes,expires_at)
      VALUES ($1,$2,'A',$3,ARRAY['files:read','profile:read'],now()+interval '1 day')`, [id, owner, oldHash]);
    await client.query(`INSERT INTO ruang_simpan_app_selections VALUES ($1,$2,NULL),($1,NULL,$3)`, [id, file, folder]);
    const before = (await client.query("SELECT * FROM ruang_simpan_app_connections")).rows[0];
    const selections = (await client.query("SELECT * FROM ruang_simpan_app_selections")).rows;
    assert.equal((await client.query(ROTATE_INTEGRATION_TOKEN_SQL, [id, randomUUID(), newHash, 1])).rowCount, 0);
    assert.equal((await client.query(ROTATE_INTEGRATION_TOKEN_SQL, [id, owner, newHash, 1])).rowCount, 1);
    assert.equal((await client.query("SELECT id FROM ruang_simpan_app_connections WHERE token_hash=$1", [oldHash])).rowCount, 0);
    const after = (await client.query("SELECT * FROM ruang_simpan_app_connections WHERE token_hash=$1", [newHash])).rows[0];
    assert.deepEqual(after, { ...before, token_hash: newHash, revision: 2 });
    assert.deepEqual((await client.query("SELECT * FROM ruang_simpan_app_selections")).rows, selections);
    await client.query("UPDATE ruang_simpan_app_connections SET revoked_at=now()");
    assert.equal((await client.query(ROTATE_INTEGRATION_TOKEN_SQL, [id, owner, oldHash, 2])).rowCount, 0);
    await client.query("UPDATE ruang_simpan_app_connections SET revoked_at=NULL, expires_at=now()-interval '1 second'");
    assert.equal((await client.query(ROTATE_INTEGRATION_TOKEN_SQL, [id, owner, oldHash, 2])).rowCount, 0);
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
});

test("HTTP PostgreSQL menjaga CAS, audit atomik, isolasi pemilik dan respons hilang", {
  skip: !databaseReady && testDbSkip, timeout: 30_000,
}, async () => {
  // A private schema in the already-validated disposable database lets every
  // HTTP request use its own real PostgreSQL connection, not a mocked UPDATE.
  const schema = `rotation_${randomUUID().replaceAll("-", "")}`;
  const setup = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
    application_name: schema, max: 6,
  });
  const originalQuery = pool.query, originalConnect = pool.connect, originalGetUser = authStorage.getUser;
  const owner = randomUUID(), otherOwner = randomUUID(), file = randomUUID(), folder = randomUUID(), legacyId = randomUUID();
  const app = express();
  const server = createServer(app);
  let base = "";
  try {
    await setup.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE users (id varchar(255) PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
      CREATE TABLE ruang_simpan_files (id uuid PRIMARY KEY, user_id text);
      CREATE TABLE ruang_simpan_folders (id uuid PRIMARY KEY, user_id text);
      -- Model a pre-revision installation so the real boot migration is tested.
      CREATE TABLE ruang_simpan_app_connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id varchar(255) REFERENCES users(id), name varchar(100),
        token_hash char(64) UNIQUE, scopes text[], created_at timestamptz DEFAULT now(),
        expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz
      )`);
    await db.query("INSERT INTO users(id) VALUES ($1),($2)", [owner, otherOwner]);
    await db.query(`INSERT INTO ruang_simpan_app_connections
      (id,owner_user_id,name,token_hash,scopes,expires_at)
      VALUES ($1,$2,'Legacy fixture',$3,ARRAY['profile:read'],now()+interval '1 day')`,
    [legacyId, owner, hashIntegrationToken(`gst_rs_${"l".repeat(43)}`)]);
    await db.query("INSERT INTO ruang_simpan_files VALUES ($1,$2)", [file, owner]);
    await db.query("INSERT INTO ruang_simpan_folders VALUES ($1,$2)", [folder, owner]);
    (pool as any).query = db.query.bind(db);
    (pool as any).connect = db.connect.bind(db);
    (authStorage as any).getUser = async (id: string) => ({ id, isActive: true, role: "user" });
    app.use(express.json());
    app.use((req: any, res, next) => {
      // Distinct browser sessions for the same owner; no customer cookies.
      req.session = req.get("authorization") ? {}
        : { id: req.get("x-test-session"), emailUser: { id: req.get("x-test-owner") ?? owner } };
      if (req.get("x-drop-response")) {
        const json = res.json.bind(res);
        res.json = ((body: any) => {
          if (body.token) { res.destroy(); return res; }
          return json(body);
        }) as typeof res.json;
      }
      next();
    });
    await registerRuangSimpanAppApi(app);
    await registerRuangSimpanAppApi(express()); // migration is idempotent
    assert.equal((await db.query("SELECT revision FROM ruang_simpan_app_connections WHERE id=$1", [legacyId])).rows[0].revision, 1);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
    const path = "/api/ruang-simpan/app-connections";
    const call = (method: string, suffix = "", body?: object, headers: Record<string, string> = {}) =>
      fetch(base + path + suffix, {
        method, headers: { Origin: base, "Content-Type": "application/json", "x-test-session": randomUUID(), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    const read = (token: string) => fetch(base + "/api/v1/ruang-simpan/company-profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const create = async () => {
      const response = await call("POST", "", {
        name: "Fixture Portal", scopes: ["profile:read", "files:read"],
        file_ids: [file], folder_ids: [folder],
      });
      assert.equal(response.status, 201);
      const result = await response.json() as any;
      assert.equal(result.connection.revision, 1);
      return result;
    };
    for (const body of [{}, { revision: "1" }, { revision: 0 }, { revision: 1.5 }]) {
      assert.equal((await call("DELETE", `/${legacyId}`, body)).status, 400);
    }
    assert.equal((await call("DELETE", `/${legacyId}`, { revision: 1 }, { "x-test-owner": otherOwner })).status, 404);
    assert.equal((await call("DELETE", `/${legacyId}`, { revision: 1 }, { Origin: "https://foreign.invalid" })).status, 403);
    const waitForBlocked = async (count: number) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { rows } = await setup.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE application_name = $1 AND cardinality(pg_blocking_pids(pid)) > 0`, [schema],
        );
        if (rows[0].n === count) return;
        await delay(10);
      }
      assert.fail(`Expected ${count} genuinely blocked PostgreSQL writes`);
    };
    for (const [firstMethod, secondMethod] of [["POST", "POST"], ["DELETE", "POST"], ["POST", "DELETE"]]) {
      const initial = await create();
      const id = initial.connection.id;
      const before = (await db.query("SELECT * FROM ruang_simpan_app_connections WHERE id=$1", [id])).rows[0];
      const selections = (await db.query("SELECT * FROM ruang_simpan_app_selections WHERE connection_id=$1 ORDER BY id", [id])).rows;
      const lock = await db.connect();
      let first: Promise<Response> | undefined, second: Promise<Response> | undefined;
      let responses: Response[];
      try {
        await lock.query("BEGIN");
        await lock.query("SELECT id FROM ruang_simpan_app_connections WHERE id=$1 FOR UPDATE", [id]);
        const suffix = (method: string) => `/${id}${method === "POST" ? "/rotate-token" : ""}`;
        first = call(firstMethod, suffix(firstMethod), { revision: 1 }, { "x-test-session": "session-a" });
        await waitForBlocked(1);
        second = call(secondMethod, suffix(secondMethod), { revision: 1 }, { "x-test-session": "session-b" });
        await waitForBlocked(2);
        await lock.query("COMMIT");
        responses = await Promise.all([first, second]);
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
        await Promise.allSettled([first, second].filter(Boolean));
      }
      assert.deepEqual(responses.map(response => response.status), [200, 409]);
      const winner = await responses[0].json() as any, loser = await responses[1].json() as any;
      assert.equal(responses[1].headers.get("cache-control"), "private, no-store");
      assert.match(loser.error, /Muat ulang/);
      assert.equal(loser.token, undefined);
      assert.equal(loser.connection, undefined);
      assert.equal(JSON.stringify(loser).includes("token_hash"), false);
      const after = (await db.query("SELECT * FROM ruang_simpan_app_connections WHERE id=$1", [id])).rows[0];
      assert.equal(after.revision, 2);
      assert.deepEqual(after, { ...before, revision: 2, token_hash: after.token_hash, revoked_at: after.revoked_at });
      assert.deepEqual((await db.query("SELECT * FROM ruang_simpan_app_selections WHERE connection_id=$1 ORDER BY id", [id])).rows, selections);
      assert.equal((await read(initial.token)).status, 401);
      if (firstMethod === "POST") {
        assert.equal(after.revoked_at, null);
        assert.equal(winner.connection.revision, 2);
        assert.equal(after.token_hash, hashIntegrationToken(winner.token));
        assert.equal((await read(winner.token)).status, 200);
        // A fresh, explicit revocation still works after stale revocation loses.
        if (secondMethod === "DELETE") {
          assert.equal((await call("DELETE", `/${id}`, { revision: 2 })).status, 200);
          assert.equal((await read(winner.token)).status, 401);
        }
      } else {
        assert.ok(after.revoked_at);
        assert.equal(after.token_hash, before.token_hash);
        assert.equal(winner.token, undefined);
      }
      assert.equal((await call("POST", `/${id}/rotate-token`, { revision: 2 }, { "x-test-owner": otherOwner })).status, 404);
    }
    const initial = await create();
    const suffix = `/${initial.connection.id}/rotate-token`;
    await assert.rejects(call("POST", suffix, { revision: 1 }, { "x-drop-response": "yes" }));
    assert.equal((await read(initial.token)).status, 401, "response loss does not undo a committed rotation");
    assert.equal((await call("POST", suffix, { revision: 1 })).status, 409, "blind retries cannot rotate again");
    const listed = await (await call("GET")).json() as any;
    const current = listed.connections.find((connection: any) => connection.id === initial.connection.id);
    assert.equal(current.revision, 2);
    assert.equal(current.token, undefined);
    assert.equal(current.token_hash, undefined);
    const recovered = await call("POST", suffix, { revision: current.revision });
    assert.equal(recovered.status, 200);
    const recovery = await recovered.json() as any;
    assert.equal(recovery.connection.revision, 3);
    assert.equal((await read(recovery.token)).status, 200);

    // Real HTTP + PostgreSQL: audit failure must roll back every mutation.
    await db.query(`CREATE FUNCTION reject_connection_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$;
      CREATE TRIGGER reject_audit BEFORE INSERT ON ruang_simpan_connection_changes
      FOR EACH ROW EXECUTE FUNCTION reject_connection_audit()`);
    const connectionCount = async () => Number((await db.query("SELECT count(*) FROM ruang_simpan_app_connections")).rows[0].count);
    const countBefore = await connectionCount();
    assert.equal((await call("POST", "", { name: "Rejected", scopes: ["profile:read"] })).status, 503);
    assert.equal(await connectionCount(), countBefore);
    const snapshot = (await db.query("SELECT * FROM ruang_simpan_app_connections WHERE id=$1", [current.id])).rows[0];
    const selectedBefore = (await db.query("SELECT * FROM ruang_simpan_app_selections WHERE connection_id=$1 ORDER BY id", [current.id])).rows;
    const auditsBefore = (await db.query("SELECT * FROM ruang_simpan_connection_changes ORDER BY id")).rows;
    assert.equal((await call("POST", `/${current.id}/rotate-token`, { revision: 3 })).status, 503);
    assert.equal((await call("DELETE", `/${current.id}`, { revision: 3 })).status, 503);
    assert.equal((await call("PUT", `/${current.id}/selections`, { file_ids: [], folder_ids: [] })).status, 503);
    assert.deepEqual((await db.query("SELECT * FROM ruang_simpan_app_connections WHERE id=$1", [current.id])).rows[0], snapshot);
    assert.deepEqual((await db.query("SELECT * FROM ruang_simpan_app_selections WHERE connection_id=$1 ORDER BY id", [current.id])).rows, selectedBefore);
    assert.deepEqual((await db.query("SELECT * FROM ruang_simpan_connection_changes ORDER BY id")).rows, auditsBefore);
    assert.equal((await read(recovery.token)).status, 200);
    await db.query("DROP TRIGGER reject_audit ON ruang_simpan_connection_changes");

    // Denied selections and foreign writes never add an audit entry.
    assert.equal((await call("PUT", `/${current.id}/selections`, { file_ids: [randomUUID()] })).status, 404);
    assert.equal((await call("PUT", `/${current.id}/selections`, {}, { "x-test-owner": otherOwner })).status, 404);
    assert.deepEqual((await db.query("SELECT * FROM ruang_simpan_connection_changes ORDER BY id")).rows, auditsBefore);
    assert.equal((await call("PUT", `/${current.id}/selections`, { file_ids: [], folder_ids: [] })).status, 200);
    const response = await call("GET", "/history");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const { history } = await response.json() as any;
    assert.deepEqual([...new Set(history.map((row: any) => row.action))].sort(),
      ["created", "revoked", "selections_changed", "token_rotated"]);
    for (const row of history) {
      assert.equal(row.actor_user_id, owner);
      assert.ok(row.connection_id);
      assert.ok(Number.isFinite(Date.parse(row.changed_at)));
      assert.deepEqual(Object.keys(row).sort(), ["action", "actor_user_id", "changed_at", "connection_id", "id"]);
    }
    // Both persisted rows and API projections must be credential/content-free.
    const serialized = JSON.stringify((await db.query("SELECT * FROM ruang_simpan_connection_changes")).rows);
    for (const forbidden of [initial.token, recovery.token, snapshot.token_hash, file, folder, "Fixture Portal", "token_hash"]) {
      assert.equal(serialized.includes(forbidden), false);
      assert.equal(JSON.stringify(history).includes(forbidden), false);
    }
    assert.deepEqual(await (await call("GET", "/history", undefined, { "x-test-owner": otherOwner })).json(), { history: [] });
    assert.equal((await fetch(base + path + "/history", { headers: { Authorization: `Bearer ${recovery.token}` } })).status, 401,
      "integration bearer is not owner authentication");
    await db.query(`INSERT INTO ruang_simpan_connection_changes
      (owner_user_id,actor_user_id,connection_id,action)
      SELECT $1,$1,$2,'selections_changed' FROM generate_series(1,60)`, [owner, current.id]);
    const limited = await (await call("GET", "/history")).json() as any;
    assert.equal(limited.history.length, 50);
    const expected = (await db.query(`SELECT id::text FROM ruang_simpan_connection_changes
      WHERE owner_user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 50`, [owner])).rows.map(row => row.id);
    assert.deepEqual(limited.history.map((row: any) => row.id), expected);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    (pool as any).query = originalQuery;
    (pool as any).connect = originalConnect;
    (authStorage as any).getUser = originalGetUser;
    invalidateUserActiveCache(owner);
    invalidateUserActiveCache(otherOwner);
    await db.end();
    try { await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await setup.end(); }
  }
});
