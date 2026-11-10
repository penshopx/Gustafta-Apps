import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bedahDokumenQuotaExceededBody,
  consumeBedahDokumenQuota,
  getBedahDokumenMonth,
  getBedahDokumenMonthlyLimit,
  reserveBedahDokumenAnalysis,
} from "../server/lib/bedah-dokumen-quota";

test("batas Bedah Dokumen mengikuti tier numerik, bukan badge", () => {
  assert.equal(getBedahDokumenMonthlyLimit({ tier: 0 }), 1);
  assert.equal(getBedahDokumenMonthlyLimit({ tier: 1 }), 3);
  assert.equal(getBedahDokumenMonthlyLimit({ tier: 2 }), 20);
  assert.equal(getBedahDokumenMonthlyLimit({ tier: 3 }), 100);
  assert.equal(getBedahDokumenMonthlyLimit({ tier: 4 }), 100);
});

test("bulan kuota mengikuti kalender WIB dan reset saat bulan berganti", () => {
  assert.equal(getBedahDokumenMonth(new Date("2026-08-31T16:59:59Z")), "2026-08");
  assert.equal(getBedahDokumenMonth(new Date("2026-08-31T17:00:00Z")), "2026-09");
});

test("konsumsi memakai upsert bersyarat dan mengembalikan sisa kuota", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      return { rows: [{ count: 2 }] };
    },
  };
  const result = await consumeBedahDokumenQuota(pool as any, "user-1", { tier: 1 }, new Date("2026-09-01T00:00:00Z"));
  assert.deepEqual(result, { ok: true, used: 2, limit: 3, remaining: 1, month: "2026-09" });
  assert.match(calls[0].text, /ON CONFLICT \(user_id, month\) DO UPDATE/);
  assert.match(calls[0].text, /count < \$3/);
  assert.deepEqual(calls[0].values, ["user-1", "2026-09", 3]);
});

test("kuota habis tidak menambah counter dan memberi ajakan upgrade ramah", async () => {
  let call = 0;
  const pool = {
    async query() {
      call += 1;
      return call === 1 ? { rows: [] } : { rows: [{ count: 20 }] };
    },
  };
  const result = await consumeBedahDokumenQuota(pool as any, "user-2", { tier: 2 }, new Date("2026-09-15T00:00:00Z"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  const body = bedahDokumenQuotaExceededBody(result);
  assert.equal(body.code, "BEDAH_DOKUMEN_QUOTA_EXHAUSTED");
  assert.equal(body.limit, 20);
  assert.match(body.error, /Upgrade paket/);
  assert.equal(body.upgradeUrl, "/cashflow-pbj");
});

test("kedua endpoint pembuat Bedah Dokumen memakai enforcement server", async () => {
  const routes = await readFile(new URL("../server/routes.ts", import.meta.url), "utf8");
  const uploadRoute = routes.slice(
    routes.indexOf('app.post("/api/bedah-dokumen/upload"'),
    routes.indexOf('app.post("/api/bedah-dokumen/:id/chat"'),
  );
  const fromRsRoute = routes.slice(
    routes.indexOf('app.post("/api/bedah-dokumen/from-rs/:fileId"'),
    routes.indexOf('app.post("/api/bedah-dokumen/:id/regulasi-note"'),
  );
  assert.match(uploadRoute, /reserveBedahDokumenAnalysis\(pool/);
  assert.match(uploadRoute, /status\(429\).*bedahDokumenQuotaExceededBody/s);
  assert.match(fromRsRoute, /reserveBedahDokumenAnalysis\(pool/);
  assert.match(fromRsRoute, /status\(429\).*bedahDokumenQuotaExceededBody/s);
  assert.match(fromRsRoute, /source_file_id = \$2 OR filename = \$3/);
});

test("migrasi menjamin satu counter per user per bulan", async () => {
  const migration = await readFile(
    new URL("../migrations/0023_bedah_dokumen_monthly_usage.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bedah_dokumen_monthly_usage/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS[\s\S]*\(user_id, month\)/);
});

test("startup menyiapkan identitas unik Ruang Simpan sebelum route dilayani", async () => {
  const startup = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(startup, /ALTER TABLE document_analyses ADD COLUMN IF NOT EXISTS source_file_id UUID/);
  assert.match(startup, /document_analyses_user_source_file_idx[\s\S]*\(user_id, source_file_id\)/);
  assert.match(startup, /CREATE TABLE IF NOT EXISTS bedah_dokumen_monthly_usage/);
});

test("reservasi mengikat konsumsi kuota dan baris analisis dalam satu transaksi", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text.trim());
      if (text.includes("bedah_dokumen_monthly_usage")) return { rows: [{ count: 1 }] };
      if (text.includes("INSERT INTO document_analyses")) return { rows: [{ id: 77 }] };
      return { rows: [] };
    },
    release() {},
  };
  const result = await reserveBedahDokumenAnalysis(
    { async connect() { return client; } } as any,
    { userId: "user-atomic", filename: "file.pdf", originalName: "file.pdf", fileSize: 123 },
    { tier: 1 },
  );
  assert.deepEqual(result, {
    ok: true,
    id: 77,
    created: true,
    quota: { ok: true, used: 1, limit: 3, remaining: 2, month: getBedahDokumenMonth() },
  });
  assert.equal(statements[0], "BEGIN");
  assert.match(statements[1], /INSERT INTO bedah_dokumen_monthly_usage/);
  assert.match(statements[2], /INSERT INTO document_analyses/);
  assert.equal(statements[3], "COMMIT");
});