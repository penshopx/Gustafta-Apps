// Tes endpoint external AI API Gaia SIAP — POST /api/v1/ai/assist (Task #306).
//
// Cakupan: fail-closed tanpa secret, Bearer auth, validasi input (termasuk
// penolakan field tak dikenal), guard ukuran body pra-parse, dan jaminan tidak
// ada kebocoran key di response. Jalur 200 (panggilan LLM nyata) TIDAK diuji di
// sini agar tes tidak tergantung provider eksternal — dicakup smoke test manual.
//
// Jalankan: npx tsx --test tests/gaia-siap-assist.test.ts

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "http";
import http from "http";
import { readFile } from "node:fs/promises";
import {
  isSensitiveAiAssistRequest,
  shouldCaptureApiResponse,
} from "../server/lib/response-log-policy";

let server: Server;
let base: string;
let completeMode: "ok" | "busy" | "provider-error" = "ok";
const rateBuckets = new Map<string, number>();

beforeEach(() => {
  rateBuckets.clear();
  completeMode = "ok";
});

before(async () => {
  delete process.env.GAIA_SIAP_API_KEY;
  const { registerGaiaSiapAiRoutes } = await import("../server/gaia-siap-api");
  const { DialogBusyError } = await import("../server/lib/dialog-load-guard");
  const app = express();
  // Cermin parser route-scoped di server/index.ts.
  app.use("/api/v1/ai/assist", express.json({ limit: "256kb", strict: true }));
  app.use("/api/v1/ai/assist", (err: any, _req: any, res: any, next: any) => {
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "payload_too_large" });
    }
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "invalid_json" });
    }
    next(err);
  });
  app.use(express.json({ limit: "50mb" }));
  registerGaiaSiapAiRoutes(app, {
    rateLimitPerMinute: 2,
    rateLimitStore: {
      async hit(key: string, windowMs: number, now: number) {
        const count = (rateBuckets.get(key) || 0) + 1;
        rateBuckets.set(key, count);
        return { count, resetAt: now + windowMs };
      },
    } as any,
    runGuarded: async (fn) => {
      if (completeMode === "busy") throw new DialogBusyError();
      return fn();
    },
    complete: async () => {
      if (completeMode === "provider-error") throw new Error("rahasia-provider");
      return "Jawaban uji";
    },
  });
  // Error handler JSON rusak — versi aman (tanpa menulis body ke log).
  app.use((err: any, _req: any, res: any, next: any) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: "bad_request" });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${(server.address() as any).port}/api/v1/ai/assist`;
});

after(() => server?.close());

const call = (opts: { key?: string; body?: any; raw?: string; headers?: Record<string, string> }) =>
  fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.raw ?? JSON.stringify(opts.body ?? {}),
  });

test("fail-closed: tanpa GAIA_SIAP_API_KEY semua request ditolak 503", async () => {
  delete process.env.GAIA_SIAP_API_KEY;
  const r = await call({ key: "apapun", body: { prompt: "hi" } });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "service_not_configured");
});

test("401 bila Authorization hilang atau key salah", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-tes";
  for (const opts of [{ body: { prompt: "hi" } }, { key: "salah", body: { prompt: "hi" } }]) {
    const r = await call(opts as any);
    assert.equal(r.status, 401);
    const j = await r.json();
    assert.equal(j.error, "unauthorized");
    assert.ok(!JSON.stringify(j).includes("kunci-tes"), "key tidak boleh bocor di response");
  }
});

test("200 memakai kontrak JSON sederhana tanpa menyentuh chat/session", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-sukses";
  completeMode = "ok";
  const r = await call({
    key: "kunci-sukses",
    body: { prompt: "Bantu saya", context: "Kasus uji", case_id: "case-1" },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { response: "Jawaban uji", suggestions: [] });
});

test("200 kontrak pub-siap-v1 mengembalikan maksimal tiga key unik dari input", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-pub";
  completeMode = "provider-error";
  const availableRecommendationKeys = [
    "legalitas-pancek",
    "sertifikasi-lms",
    "legalitas-pancek",
    "tender-risk",
    "opsi-keempat",
  ];
  const r = await call({
    key: "kunci-pub",
    body: {
      schemaVersion: "pub-siap-v1",
      availableRecommendationKeys,
    },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, {
    recommendationKeys: ["legalitas-pancek", "sertifikasi-lms", "tender-risk"],
  });
  assert.ok(body.recommendationKeys.length <= 3);
  assert.ok(
    body.recommendationKeys.every((key: string) => availableRecommendationKeys.includes(key)),
  );
});

test("kontrak pub-siap-v1 tetap memerlukan Bearer key yang valid", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-pub-auth";
  const body = {
    schemaVersion: "pub-siap-v1",
    availableRecommendationKeys: ["legalitas-pancek"],
  };
  assert.equal((await call({ body })).status, 401);
  assert.equal((await call({ key: "salah", body })).status, 401);
});

test("kontrak pub-siap-v1 menolak field identitas dan input yang tidak valid", async () => {
  const cases = [
    {
      schemaVersion: "pub-siap-v1",
      availableRecommendationKeys: ["legalitas-pancek"],
      memberId: "anggota-rahasia",
    },
    {
      schemaVersion: "versi-lain",
      availableRecommendationKeys: ["legalitas-pancek"],
    },
    {
      schemaVersion: "pub-siap-v1",
      availableRecommendationKeys: ["legalitas-pancek", 123],
    },
  ];
  for (const [index, body] of cases.entries()) {
    const key = `kunci-pub-invalid-${index}`;
    process.env.GAIA_SIAP_API_KEY = key;
    const r = await call({ key, body });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "invalid_request");
  }
});

test("429 setelah kuota per klien habis dan menyertakan Retry-After", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-limit";
  completeMode = "ok";
  const first = await call({ key: "kunci-limit", body: { prompt: "satu" } });
  const second = await call({ key: "kunci-limit", body: { prompt: "dua" } });
  const limited = await call({ key: "kunci-limit", body: { prompt: "tiga" } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal((await limited.json()).error, "rate_limited");
});

test("503 busy jelas dan tidak membocorkan detail internal", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-busy";
  completeMode = "busy";
  const r = await call({ key: "kunci-busy", body: { prompt: "hi" } });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("retry-after"), "5");
  const body = await r.json();
  assert.equal(body.error, "busy");
  assert.ok(!JSON.stringify(body).includes("kunci-busy"));
  completeMode = "ok";
});

test("400 untuk input tidak valid", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-tes";
  const cases: any[] = [
    {}, // prompt hilang
    { prompt: "" }, // kosong
    { prompt: 123 }, // tipe salah
    { prompt: "x".repeat(8001) }, // kebesaran
    { prompt: "hi", case_id: 99 }, // case_id non-string
    { prompt: "hi", context: "x".repeat(24001) }, // context kebesaran
    { prompt: "hi", junk: "tidak dikenal" }, // field asing ditolak
  ];
  for (const [index, body] of cases.entries()) {
    const key = `kunci-validasi-${index}`;
    process.env.GAIA_SIAP_API_KEY = key;
    const r = await call({ key, body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await r.json()).error, "invalid_request");
  }
});

test("413 untuk body melebihi 256KB (pra-parse guard)", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-tes";
  const big = JSON.stringify({ prompt: "hi", context: "x".repeat(300 * 1024) });
  const r = await call({ key: "kunci-tes", raw: big });
  assert.equal(r.status, 413);
});

test("413 untuk transfer chunked besar tanpa Content-Length", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-chunked";
  const url = new URL(base);
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer kunci-chunked",
        "Transfer-Encoding": "chunked",
      },
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode || 0));
    });
    req.on("error", reject);
    req.write('{"prompt":"hi","context":"');
    for (let i = 0; i < 300; i++) req.write("x".repeat(1024));
    req.end('"}');
  });
  assert.equal(status, 413);
});

test("JSON rusak → 4xx terkontrol (tanpa crash)", async () => {
  process.env.GAIA_SIAP_API_KEY = "kunci-tes";
  const r = await call({ key: "kunci-tes", raw: "{rusak" });
  assert.ok(r.status >= 400 && r.status < 500);
});

test("bootstrap memakai parser 256KB nyata dan meredaksi body respons AI dari logger generik", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(source, /"\/api\/v1\/ai\/assist",\s*express\.json\(\{\s*limit: "256kb"/s);
  assert.match(source, /shouldCaptureApiResponse\(path, req\.route\?\.path, process\.env\.NODE_ENV\)/);
});

test("logger meredaksi endpoint AI termasuk trailing slash dan variasi case", () => {
  for (const path of [
    "/api/v1/ai/assist",
    "/api/v1/ai/assist/",
    "/API/V1/AI/ASSIST",
    "/API/V1/AI/ASSIST/",
  ]) {
    assert.equal(isSensitiveAiAssistRequest(path), true, path);
    assert.equal(shouldCaptureApiResponse(path, undefined, "development"), false, path);
  }
  assert.equal(
    shouldCaptureApiResponse("/jalur-alias", "/api/v1/ai/assist", "development"),
    false,
  );
  assert.equal(shouldCaptureApiResponse("/api/health", "/api/health", "development"), true);
});
