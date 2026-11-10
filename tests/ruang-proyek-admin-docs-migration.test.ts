import { prepareTestDatabase, testDbSkip } from "./test-database";
const testDatabaseReady = await prepareTestDatabase();

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";

const hasDb = testDatabaseReady;
const SKIP = hasDb ? false : testDbSkip;
const schema = `test_ruang_proyek_admin_docs_${process.pid}_${Date.now()}`;
const userId = `ruang-proyek-admin-docs-${process.pid}-${Date.now()}`;
const projectId = randomUUID();

let adminDocs: Array<Record<string, unknown>>;
let pool: pg.Pool;
let server: Server;
let baseUrl = "";

async function request(path: string, method: "GET" | "PATCH", body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-test-user": userId,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() as any };
}

before(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;

  const bootstrapPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  try {
    await bootstrapPool.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await bootstrapPool.end();
  }

  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 1,
  });

  // Bentuk tabel pra-fitur: sengaja tanpa admin_docs dan kolom-kolom migrasi berikutnya.
  await pool.query(`
    CREATE TABLE ruang_proyek_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      name text NOT NULL,
      client text,
      location text,
      description text,
      status text NOT NULL DEFAULT 'aktif',
      contract_value bigint,
      start_date date,
      end_date date,
      checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
      cost_items jsonb NOT NULL DEFAULT '[]'::jsonb,
      linked_file_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `INSERT INTO ruang_proyek_projects (id, user_id, name) VALUES ($1, $2, $3)`,
    [projectId, userId, "Proyek dari schema lama"],
  );

  const { ensureRuangProyekTable, registerRuangProyekRoutes } =
    await import("../server/ruang-proyek-routes");
  await ensureRuangProyekTable(pool as any);

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { claims: { sub: req.headers["x-test-user"] } };
    req.isAuthenticated = () => true;
    next();
  });
  registerRuangProyekRoutes(app, pool as any);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  adminDocs = [{
    id: "kontrak",
    key: "kontrak",
    label: "Dokumen Kontrak",
    stage: "persiapan",
    status: "selesai",
    fileId: null,
    note: "Sudah ditandatangani",
  }];
});

after(async () => {
  if (!testDatabaseReady) return;
  if (!hasDb) return;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (pool) await pool.end();

  const cleanupPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  try {
    await cleanupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await cleanupPool.end();
  }
});

test("ensure memigrasikan tabel lama dan list/detail/PATCH adminDocs tetap bekerja", { skip: SKIP }, async () => {
  const column = await pool.query(
    `SELECT column_default, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'ruang_proyek_projects' AND column_name = 'admin_docs'`,
    [schema],
  );
  assert.equal(column.rowCount, 1);
  assert.equal(column.rows[0].is_nullable, "NO");
  assert.match(column.rows[0].column_default, /\[\]/);

  const list = await request("/api/ruang-proyek/projects", "GET");
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 1);
  assert.deepEqual(list.json[0].adminDocs, []);
  assert.equal(list.json[0].revision, 1);

  const detail = await request(`/api/ruang-proyek/projects/${projectId}`, "GET");
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.json.adminDocs, []);

  const patch = await request(`/api/ruang-proyek/projects/${projectId}`, "PATCH", {
    adminDocs,
    expectedRevision: detail.json.revision,
  });
  assert.equal(patch.status, 200);
  assert.deepEqual(patch.json.adminDocs, adminDocs);
  assert.equal(patch.json.revision, 2);

  const persisted = await pool.query(
    `SELECT admin_docs, revision FROM ruang_proyek_projects WHERE id = $1`,
    [projectId],
  );
  assert.deepEqual(persisted.rows[0].admin_docs, adminDocs);
  assert.equal(Number(persisted.rows[0].revision), 2);
});