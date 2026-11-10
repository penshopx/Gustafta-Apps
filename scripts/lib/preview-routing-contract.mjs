import assert from "node:assert/strict";

// Shared HTTP assertions. Only the production CLI selects a workspace domain;
// isolated tests supply their own loopback router without weakening that CLI.
export async function checkPreviewRouting({ origin, log = console.log }) {
  async function get(path) {
    const response = await fetch(new URL(path, origin), {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { "Cache-Control": "no-cache" },
    });
    return response;
  }

  const api = await get("/api/v1/ruang-simpan/company-profile");
  assert.equal(api.status, 401, "Main API must reject an unauthenticated request.");
  assert.match(api.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(api.headers.get("cache-control"), "private, no-store");
  assert.equal(
    api.headers.get("x-gustafta-rs-contract"),
    "rs-app-v1-private-no-store",
  );
  const json = await api.json();
  assert.equal(typeof json.error, "string", "Expected the API's JSON error body.");
  log("PASS main API: 401 JSON, private/no-store contract");

  async function checkPage(path, title, scriptPrefix) {
    const response = await get(path);
    assert.equal(response.status, 200, `${path} must return HTTP 200.`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, title, `${path} must be served by the correct application.`);
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)];
    const entry = scripts.find((match) => match[1].startsWith(scriptPrefix));
    assert(entry, `${path} must contain its own JavaScript entry point.`);
    const asset = await get(entry[1]);
    assert.equal(asset.status, 200, `${path} entry point must load.`);
    assert.match(
      asset.headers.get("content-type") ?? "",
      /(?:javascript|ecmascript)/i,
      `${path} entry point must be JavaScript, not an SPA HTML fallback.`,
    );
    await asset.arrayBuffer();
    log(`PASS ${path}: correct HTML and JavaScript entry point`);
  }

  await checkPage("/", /<title>Gustafta\b/, "/src/main.tsx");
  await checkPage("/__mockup/", /<title>Mockup Canvas<\/title>/, "/__mockup/src/main.tsx");
}
