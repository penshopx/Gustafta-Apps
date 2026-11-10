import assert from "node:assert/strict";
import test from "node:test";
import { EcosystemStateStore, failedAppNames, parseState, recoveredAppNames, serializeState, transition } from "../scripts/ecosystem-health-state";

test("pemulihan hanya terjadi saat aplikasi gagal sebelumnya kini sehat", () => {
  const previous = ["ISO Hub", "TukangConnect"];
  const current = failedAppNames(["TukangConnect: halaman HTTP 503", "SMAP–PANCEK: HTTP 502"]);
  assert.deepEqual(recoveredAppNames(previous, current), ["ISO Hub"]);
  assert.deepEqual(recoveredAppNames(current, current), []);
  assert.deepEqual(recoveredAppNames([], []), []);
  assert.deepEqual(recoveredAppNames(["ISO Hub"], []), ["ISO Hub"]);
});

test("alasan kegagalan berubah bukan pemulihan; kegagalan dari dua pemeriksa disatukan", () => {
  const current = failedAppNames(["ISO Hub: HTTP 503", "ISO Hub: halaman kosong, salah, atau gagal dimuat"]);
  assert.deepEqual(current, ["ISO Hub"]);
  assert.deepEqual(recoveredAppNames(["ISO Hub"], current), []);
});

test("laporan dan status rusak ditolak agar tidak menghasilkan pemulihan palsu", () => {
  assert.throws(() => failedAppNames({ failure: "ISO Hub" }));
  assert.throws(() => failedAppNames(["Aplikasi tidak dikenal: HTTP 503"]));
  assert.throws(() => failedAppNames(["ISO Hub: https://example.test?token=rahasia: HTTP 503"]));
  assert.throws(() => recoveredAppNames(["Aplikasi tidak dikenal"], []));
});

test("riwayat disimpan di GitHub issue, tidak bergantung pada cache; pemulihan hanya sekali", async () => {
  let issue: { number: number; title: string; body: string } | undefined;
  let unavailable = false;
  const requests: string[] = [];
  const store = new EcosystemStateStore("owner/repo", "test-token", async (url, init) => {
    requests.push(url);
    if (unavailable) return new Response("temporary outage", { status: 503 });
    if (init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      issue = { number: 42, ...input };
      return Response.json(issue, { status: 201 });
    }
    if (init?.method === "PATCH") {
      issue!.body = JSON.parse(String(init.body)).body;
      return Response.json(issue);
    }
    return Response.json(url.includes("/search/") ?
      { total_count: issue ? 1 : 0, incomplete_results: false, items: issue ? [issue] : [] } :
      issue ? [issue] : []);
  });
  assert.deepEqual(await transition(store, "prepare", ["ISO Hub"]), []);
  assert.deepEqual(parseState(issue!.body), { failed: ["ISO Hub"], phase: "idle" });
  unavailable = true;
  await assert.rejects(transition(store, "prepare", []));
  unavailable = false;
  assert.deepEqual(parseState(issue!.body), { failed: ["ISO Hub"], phase: "idle" });
  assert.deepEqual(await transition(store, "prepare", []), ["ISO Hub"]);
  await assert.rejects(transition(store, "prepare", [])); // no duplicate on ambiguous send
  unavailable = true;
  await assert.rejects(transition(store, "finish")); // accepted email, state write fails
  unavailable = false;
  assert.equal(parseState(issue!.body).phase, "sending");
  await assert.rejects(transition(store, "prepare", [])); // never resend after ambiguous commit
  await transition(store, "finish");
  assert.deepEqual(await transition(store, "prepare", []), []);
  assert.deepEqual(parseState(issue!.body), { failed: [], phase: "idle" });
  assert(requests.every((url) => url.startsWith("https://api.github.com/search/issues?") ||
    url.startsWith("https://api.github.com/repos/owner/repo/issues")));
  assert(!issue!.body.includes("http"));
  assert(!issue!.body.includes("test-token"));
});

test("kegagalan pengiriman yang diketahui dapat diulang; status ambigu butuh keputusan eksplisit", async () => {
  let body = serializeState({ failed: ["ISO Hub"], phase: "idle" });
  const store = new EcosystemStateStore("owner/repo", "test-token", async (url, init) => {
    if (init?.method === "PATCH") body = JSON.parse(String(init.body)).body;
    const item = { title: "Ecosystem health monitor state (automated; do not edit)", number: 5, body };
    return Response.json(init?.method === "GET"
      ? url.includes("/search/") ? { total_count: 1, incomplete_results: false, items: [item] } : [item]
      : { number: 5, body });
  });
  assert.deepEqual(await transition(store, "prepare", []), ["ISO Hub"]);
  await transition(store, "release");
  assert.deepEqual(await transition(store, "prepare", []), ["ISO Hub"]);
  await transition(store, "resolve-retry");
  assert.deepEqual(await transition(store, "prepare", []), ["ISO Hub"]);
  await transition(store, "resolve-delivered");
  assert.deepEqual(await transition(store, "prepare", []), []);
  assert.throws(() => parseState('ecosystem-health-state-v1\n{"failed":["https://secret"],"phase":"idle"}'));
  assert.throws(() => parseState('ecosystem-health-state-v1\n{"failed":[],"phase":"sending","current":[]}'));
});

test("status lama tetap dimuat dari pencarian judul setelah repositori bertambah besar", async () => {
  const item = {
    number: 3, title: "Ecosystem health monitor state (automated; do not edit)",
    body: serializeState({ failed: ["ISO Hub"], phase: "idle" as const }),
  };
  const store = new EcosystemStateStore("owner/repo", "test-token", async (url) =>
    Response.json(url.includes("/search/") ?
      { total_count: 1, incomplete_results: false, items: [item] } : []));
  assert.deepEqual(await store.load(), { issue: 3, state: { failed: ["ISO Hub"], phase: "idle" } });
});