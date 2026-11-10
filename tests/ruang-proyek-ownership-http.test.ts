import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

const hasDb = testDatabaseReady;
const SKIP = hasDb ? false : testDbSkip;
const RUN = `ruang-proyek-ownership-${process.pid}-${Date.now()}`;
const OWNER_ID = `${RUN}-owner`;
const OTHER_ID = `${RUN}-other`;
const RECOVERY_KEY = "test_recovery_ruang_proyek_ownership";

let pool: any;
let server: Server;
let baseUrl = "";
const ownerProjectId = randomUUID();
const otherProjectId = randomUUID();
const otherFileId = randomUUID();
let recoveryLockClient: any;

type Recovery = {
  runId?: string;
  projectIds?: string[];
  fileIds?: string[];
};

async function readRecovery(): Promise<Recovery | undefined> {
  const result = await pool.query(`SELECT value FROM system_config WHERE key = $1`, [RECOVERY_KEY]);
  const value = result.rows[0]?.value;
  if (!value) return undefined;
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function cleanupRecovery(record: Recovery | undefined) {
  if (record?.projectIds?.length) {
    await pool.query(`DELETE FROM ruang_proyek_projects WHERE id = ANY($1::uuid[])`, [record.projectIds]);
  }
  if (record?.fileIds?.length) {
    await pool.query(`DELETE FROM ruang_simpan_files WHERE id = ANY($1::uuid[])`, [record.fileIds]);
  }
}

async function request(
  path: string,
  method: "GET" | "PATCH" | "DELETE",
  userId?: string,
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(userId ? { "x-test-user": userId } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() as any };
}

before(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;
  ({ pool } = await import("../server/db"));

  recoveryLockClient = await pool.connect();
  await recoveryLockClient.query("SELECT pg_advisory_lock(hashtext($1))", [RECOVERY_KEY]);

  await cleanupRecovery(await readRecovery());
  await pool.query(`DELETE FROM system_config WHERE key = $1`, [RECOVERY_KEY]);
  await pool.query(
    `INSERT INTO system_config (key, value) VALUES ($1, $2::jsonb)`,
    [RECOVERY_KEY, JSON.stringify({
      runId: RUN,
      projectIds: [ownerProjectId, otherProjectId],
      fileIds: [otherFileId],
    })],
  );

  await pool.query(
    `INSERT INTO ruang_proyek_projects (id, user_id, name)
     VALUES ($1, $2, $3)`,
    [ownerProjectId, OWNER_ID, `${RUN} owner project`],
  );

  await pool.query(
    `INSERT INTO ruang_proyek_projects (id, user_id, name)
     VALUES ($1, $2, $3)`,
    [otherProjectId, OTHER_ID, `${RUN} other project`],
  );

  await pool.query(
    `INSERT INTO ruang_simpan_files (id, user_id, original_name)
     VALUES ($1, $2, $3)`,
    [otherFileId, OTHER_ID, `${RUN}.pdf`],
  );

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const userId = req.headers["x-test-user"];
    if (userId) {
      req.user = { claims: { sub: userId } };
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }
    next();
  });
  const { registerRuangProyekRoutes } = await import("../server/ruang-proyek-routes");
  registerRuangProyekRoutes(app);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;
  try {
    const recovery = await readRecovery();
    if (recovery?.runId === RUN) {
      await cleanupRecovery(recovery);
      await pool.query(`DELETE FROM system_config WHERE key = $1`, [RECOVERY_KEY]);
    }
  } finally {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (recoveryLockClient) {
      await recoveryLockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [RECOVERY_KEY])
        .catch(() => undefined);
      recoveryLockClient.release();
    }
    await pool.end().catch(() => undefined);
  }
});

test("GET/PATCH/DELETE proyek user lain semuanya menyamar sebagai 404", { skip: SKIP }, async () => {
  const detail = await request(`/api/ruang-proyek/projects/${otherProjectId}`, "GET", OWNER_ID);
  assert.equal(detail.status, 404);

  const patch = await request(
    `/api/ruang-proyek/projects/${otherProjectId}`,
    "PATCH",
    OWNER_ID,
    { name: "IDOR mutation must fail" },
  );
  assert.equal(patch.status, 404);

  const deletion = await request(`/api/ruang-proyek/projects/${otherProjectId}`, "DELETE", OWNER_ID);
  assert.equal(deletion.status, 404);

  const persisted = await pool.query(
    `SELECT name FROM ruang_proyek_projects WHERE id = $1 AND user_id = $2`,
    [otherProjectId, OTHER_ID],
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].name, `${RUN} other project`);
});

test("linkedFileIds milik user lain ditolak 400 dan proyek tidak berubah", { skip: SKIP }, async () => {
  const result = await request(
    `/api/ruang-proyek/projects/${ownerProjectId}`,
    "PATCH",
    OWNER_ID,
    { linkedFileIds: [otherFileId], expectedRevision: 1 },
  );
  assert.equal(result.status, 400);

  const persisted = await pool.query(
    `SELECT linked_file_ids, revision FROM ruang_proyek_projects WHERE id = $1`,
    [ownerProjectId],
  );
  assert.deepEqual(persisted.rows[0].linked_file_ids, []);
  assert.equal(Number(persisted.rows[0].revision), 1);
});

test("GET/PATCH/DELETE tanpa login ditolak 401", { skip: SKIP }, async () => {
  const results = await Promise.all([
    request(`/api/ruang-proyek/projects/${ownerProjectId}`, "GET"),
    request(`/api/ruang-proyek/projects/${ownerProjectId}`, "PATCH", undefined, { name: "nope" }),
    request(`/api/ruang-proyek/projects/${ownerProjectId}`, "DELETE"),
  ]);
  assert.deepEqual(results.map((result) => result.status), [401, 401, 401]);
});