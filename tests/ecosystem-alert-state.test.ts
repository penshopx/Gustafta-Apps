import assert from "node:assert/strict";
import test from "node:test";
import { AlertState, validateAlertKey } from "../scripts/ecosystem-alert-state";

const key = "ecosystem-alert-2026-W39-" + "a".repeat(64);
test("weekly issue marker survives cache deletion and never stores raw URLs or credentials", async () => {
  let issue: { number: number; title: string; body: string } | undefined;
  let fail = false;
  const state = new AlertState("owner/repo", "test-token", async (url, init) => {
    assert.match(url, /^https:\/\/api\.github\.com\/(?:search\/issues|repos\/owner\/repo\/issues)/);
    if (fail) return new Response("private URL", { status: 503 });
    if (init?.method === "POST") {
      issue = { number: 1, ...JSON.parse(String(init.body)) };
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
  fail = true;
  await assert.rejects(state.claim(key)); // API unavailable: don't send
  fail = false;
  assert.equal(await state.claim(key), true);
  assert.equal(issue!.body, "sending");
  assert.equal(await state.claim(key), false); // uncertain delivery: don't resend
  fail = true;
  await assert.rejects(state.finish(key)); // failed persistence does not mark sent
  fail = false;
  assert.equal(issue!.body, "sending");
  await state.finish(key);
  assert.equal(issue!.body, "sent");
  assert.equal(await state.claim(key), false);
  assert.doesNotMatch(JSON.stringify(issue), /https?:|test-token/);
});

test("keys are allowlisted, including browser, network, and watchdog categories", () => {
  validateAlertKey("ecosystem-browser-alert-2026-W39");
  validateAlertKey("ecosystem-network-alert-2026-W39");
  validateAlertKey("ecosystem-watchdog-failed-2026-09-21");
  assert.throws(() => validateAlertKey("ecosystem-alert-https://example.test?token=secret"));
  assert.throws(() => validateAlertKey("ecosystem-watchdog-missed-2026-09-21\nsecret"));
});

test("kunci gangguan jaringan dari workflow bisa diklaim dan dikonfirmasi tanpa data sensitif", async () => {
  const networkKey = "ecosystem-network-alert-2026-W39";
  let issue: { number: number; title: string; body: string } | undefined;
  const state = new AlertState("owner/repo", "test-token", async (url, init) => {
    if (init?.method === "POST") {
      issue = { number: 2, ...JSON.parse(String(init.body)) };
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
  assert.equal(await state.claim(networkKey), true);
  assert.equal(issue!.body, "sending");
  assert.equal(await state.claim(networkKey), false);
  await state.finish(networkKey);
  assert.equal(issue!.body, "sent");
  assert.doesNotMatch(JSON.stringify(issue), /https?:|test-token/);
});

test("penanda lama tetap ditemukan setelah ribuan issue lain, tanpa mengirim ulang", async () => {
  const marker = { number: 5, title: "Ecosystem alert delivery: " + key, body: "sending" };
  let posts = 0;
  const state = new AlertState("owner/repo", "test-token", async (url, init) => {
    if (init?.method === "POST") posts++;
    if (url.includes("/search/")) {
      assert.match(decodeURIComponent(url), /^https:\/\/api\.github\.com\/search\/issues\?q=repo:owner\/repo in:title "Ecosystem alert delivery:/);
      return Response.json({ total_count: 1, incomplete_results: false, items: [marker] });
    }
    if (url.includes("?state=all")) return Response.json([]);
    if (init?.method === "PATCH") return Response.json({ ...marker, body: "sent" });
    throw new Error("Unexpected request");
  });
  assert.equal(await state.claim(key), false);
  await state.finish(key);
  assert.equal(posts, 0);
});

test("hasil pencarian yang gagal, tidak lengkap, atau ganda tidak pernah mengizinkan klaim", async () => {
  const marker = { number: 5, title: "Ecosystem alert delivery: " + key, body: "sent" };
  for (const result of [
    new Response("failed", { status: 503 }),
    Response.json({ total_count: 1, incomplete_results: true, items: [] }),
    Response.json({ total_count: 1000, incomplete_results: false, items: [] }),
    Response.json({ total_count: 2, incomplete_results: false, items: [marker, { ...marker, number: 6 }] }),
  ]) {
    let posts = 0;
    const state = new AlertState("owner/repo", "test-token", async (_url, init) => {
      if (init?.method === "POST") posts++;
      return result.clone();
    });
    await assert.rejects(state.claim(key));
    assert.equal(posts, 0);
  }
});

test("respons klaim yang tidak valid tidak pernah mengizinkan email", async () => {
  const state = new AlertState("owner/repo", "test-token", async (url, init) =>
    init?.method === "POST" ? Response.json({}) :
      Response.json(url.includes("/search/") ?
        { total_count: 0, incomplete_results: false, items: [] } : []));
  await assert.rejects(state.claim(key), /Invalid alert claim/);
});

test("penanda baru yang belum terindeks tetap ditemukan dari issue terkini", async () => {
  const marker = { number: 9, title: "Ecosystem alert delivery: " + key, body: "sending" };
  const state = new AlertState("owner/repo", "test-token", async (url) =>
    Response.json(url.includes("/search/") ?
      { total_count: 0, incomplete_results: false, items: [] } : [marker]));
  assert.equal(await state.claim(key), false);
});

test("pencarian beberapa halaman wajib membaca seluruh hasil sebelum menganggap penanda tidak ada", async () => {
  const marker = { number: 501, title: "Ecosystem alert delivery: " + key, body: "sent" };
  let pages = 0;
  const state = new AlertState("owner/repo", "test-token", async (url) => {
    if (!url.includes("/search/")) return Response.json([]);
    pages++;
    return Response.json({
      total_count: 101, incomplete_results: false,
      items: new URL(url).searchParams.get("page") === "1" ?
        Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: "unrelated", body: "" })) :
        [marker],
    });
  });
  assert.equal(await state.claim(key), false);
  assert.equal(pages, 2);
});