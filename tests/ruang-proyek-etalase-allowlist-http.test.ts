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
const RUN = `etalase-allowlist-${process.pid}-${Date.now()}`;
const OWNER_ID = `${RUN}-owner`;
const OTHER_ID = `${RUN}-other`;
const RECOVERY_KEY = "test_recovery_ruang_proyek_etalase_allowlist";
const projectIds = Array.from({ length: 6 }, () => randomUUID());

let pool: any;
let server: Server;
let baseUrl = "";
let recoveryLockClient: any;

type Recovery = { runId?: string; projectIds?: string[] };

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
    [RECOVERY_KEY, JSON.stringify({ runId: RUN, projectIds })],
  );

  const rows = [
    [projectIds[0], OWNER_ID, "Tanpa opt-in", false, false, true],
    [projectIds[1], OWNER_ID, "Nilai saja", true, false, true],
    [projectIds[2], OWNER_ID, "Klien saja", false, true, true],
    [projectIds[3], OWNER_ID, "Semua opt-in", true, true, true],
    [projectIds[4], OWNER_ID, "Tidak ditampilkan", true, true, false],
    [projectIds[5], OTHER_ID, "Milik user lain", true, true, true],
  ];
  for (const [id, userId, name, showValue, showClient, isShowcased] of rows) {
    await pool.query(
      `INSERT INTO ruang_proyek_projects (
         id, user_id, name, client, location, description, status, contract_value,
         start_date, end_date, checklist, cost_items, linked_file_ids, admin_docs,
         is_showcased, show_value, show_client
       ) VALUES (
         $1, $2, $3, 'Klien Rahasia', 'Bandung', 'Deskripsi aman', 'aktif', 987654321,
         '2024-01-02', '2025-03-04', '[{"id":"private"}]'::jsonb,
         '[{"amount":999}]'::jsonb, '["00000000-0000-0000-0000-000000000000"]'::jsonb,
         '[{"note":"rahasia"}]'::jsonb, $4, $5, $6
       )`,
      [id, userId, name, isShowcased, showValue, showClient],
    );
  }

  const app = express();
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

test("etalase anonim mengekspos persis allowlist sesuai opt-in pemilik", { skip: SKIP }, async () => {
  const response = await fetch(`${baseUrl}/api/etalase/${OWNER_ID}`);
  assert.equal(response.status, 200);
  const projects = await response.json() as Array<Record<string, unknown>>;
  assert.equal(projects.length, 4);

  const byName = new Map(projects.map((project) => [project.name, project]));
  const safeKeys = ["description", "location", "name", "status", "year"];
  assert.deepEqual(Object.keys(byName.get("Tanpa opt-in")!).sort(), safeKeys);
  assert.deepEqual(Object.keys(byName.get("Nilai saja")!).sort(), [...safeKeys, "contractValue"].sort());
  assert.deepEqual(Object.keys(byName.get("Klien saja")!).sort(), [...safeKeys, "client"].sort());
  assert.deepEqual(
    Object.keys(byName.get("Semua opt-in")!).sort(),
    [...safeKeys, "client", "contractValue"].sort(),
  );

  assert.equal(byName.get("Nilai saja")!.contractValue, 987654321);
  assert.equal(byName.get("Klien saja")!.client, "Klien Rahasia");
  assert.equal(byName.has("Tidak ditampilkan"), false);
  assert.equal(byName.has("Milik user lain"), false);

  for (const project of projects) {
    for (const forbidden of ["id", "userId", "costItems", "cost_items", "adminDocs", "admin_docs", "linkedFileIds", "linked_file_ids"]) {
      assert.equal(forbidden in project, false, `${forbidden} tidak boleh bocor`);
    }
  }
});