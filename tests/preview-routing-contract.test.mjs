import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { checkPreviewRouting } from "../scripts/lib/preview-routing-contract.mjs";

const apiPath = "/api/v1/ruang-simpan/company-profile";
const rootEntry = "/src/main.tsx";
const sandboxEntry = "/__mockup/src/main.tsx";
const rootHtml = '<title>Gustafta AI</title><script type="module" src="/src/main.tsx"></script>';
const sandboxHtml = '<title>Mockup Canvas</title><script type="module" src="/__mockup/src/main.tsx"></script>';
const expectedPaths = [apiPath, "/", rootEntry, "/__mockup/", sandboxEntry];

function validResponses() {
  return {
    [apiPath]: {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
        "x-gustafta-rs-contract": "rs-app-v1-private-no-store",
      },
      body: JSON.stringify({ error: "Authentication required" }),
    },
    "/": { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: rootHtml },
    "/__mockup/": { status: 200, headers: { "content-type": "text/html" }, body: sandboxHtml },
    [rootEntry]: {
      status: 200, headers: { "content-type": "text/javascript" }, body: 'console.log("main");',
    },
    [sandboxEntry]: {
      status: 200, headers: { "content-type": "application/javascript" }, body: 'console.log("sandbox");',
    },
  };
}

async function fixture(t, mutate = () => {}) {
  const responses = validResponses();
  mutate(responses);
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const response = responses[req.url];
    if (!response) {
      res.writeHead(500).end("Unexpected fixture request");
      return;
    }
    res.writeHead(response.status, response.headers).end(response.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}

test("correct API, main page and sandbox contracts pass through local HTTP", { timeout: 5_000 }, async (t) => {
  const { origin, requests } = await fixture(t);
  const messages = [];
  await checkPreviewRouting({ origin, log: (message) => messages.push(message) });
  assert.deepEqual(requests, expectedPaths);
  assert.equal(messages.length, 3);
  assert(messages.every((message) => message.startsWith("PASS ")));
});

const failures = [
  {
    name: "sandbox base-path 404 at the main API",
    path: apiPath,
    mutate: (responses) => {
      responses[apiPath] = {
        status: 404, headers: { "content-type": "text/html" },
        body: 'The server is configured with a public base URL of /__mockup/ - did you mean to visit /__mockup/api/v1/ruang-simpan/company-profile instead?',
      };
    },
    error: /Main API must reject an unauthenticated request/,
  },
  ...[200, 403, 500].map((status) => ({
    name: `wrong API status ${status}`, path: apiPath,
    mutate: (responses) => { responses[apiPath].status = status; },
    error: /Main API must reject an unauthenticated request/,
  })),
  ...[
    ["content-type", "text/html", /application/],
    ["cache-control", "public, max-age=3600", /private, no-store/],
    ["x-gustafta-rs-contract", "wrong-service", /rs-app-v1-private-no-store/],
  ].flatMap(([header, wrongValue, error]) => [undefined, wrongValue].map((value) => ({
    name: `${value === undefined ? "missing" : "wrong"} API ${header}`, path: apiPath, error,
    mutate: (responses) => {
      if (value === undefined) delete responses[apiPath].headers[header];
      else responses[apiPath].headers[header] = value;
    },
  }))),
  {
    name: "API body without a string error", path: apiPath,
    mutate: (responses) => { responses[apiPath].body = '{"error":false}'; },
    error: /Expected the API's JSON error body/,
  },
  {
    name: "HTML body under API JSON headers", path: apiPath,
    mutate: (responses) => { responses[apiPath].body = rootHtml; },
    error: SyntaxError,
  },
  ...["/", "/__mockup/"].flatMap((path) => [
    {
      name: `${path} wrong page status`, path,
      mutate: (responses) => { responses[path].status = 404; },
      error: /must return HTTP 200/,
    },
    {
      name: `${path} wrong page content type`, path,
      mutate: (responses) => { responses[path].headers["content-type"] = "application/json"; },
      error: /text/,
    },
    {
      name: `${path} served by the other application`, path,
      mutate: (responses) => { responses[path].body = path === "/" ? sandboxHtml : rootHtml; },
      error: /must be served by the correct application/,
    },
    {
      name: `${path} uses the other application's entry point`, path,
      mutate: (responses) => {
        responses[path].body = responses[path].body.replace(
          path === "/" ? rootEntry : sandboxEntry,
          path === "/" ? sandboxEntry : rootEntry,
        );
      },
      error: /must contain its own JavaScript entry point/,
    },
  ]),
  ...[rootEntry, sandboxEntry].flatMap((path) => [
    {
      name: `${path} missing entry`, path,
      mutate: (responses) => { responses[path].status = 404; },
      error: /entry point must load/,
    },
    {
      name: `${path} returns an HTTP 200 HTML fallback`, path,
      mutate: (responses) => {
        responses[path].headers["content-type"] = "text/html";
        responses[path].body = rootHtml;
      },
      error: /must be JavaScript, not an SPA HTML fallback/,
    },
  ]),
  ...expectedPaths.flatMap((path) => [301, 302, 307, 308].map((status) => ({
    name: `${path} redirects with ${status}`, path,
    mutate: (responses) => {
      responses[path] = {
        status, headers: { location: "/redirect-target" }, body: "",
      };
      // A valid target would hide the routing error if redirects were followed.
      responses["/redirect-target"] = validResponses()[path];
    },
    error: /fetch failed/,
  }))),
];

for (const { name, path, mutate, error } of failures) {
  test(`rejects ${name}`, { timeout: 5_000 }, async (t) => {
    const { origin, requests } = await fixture(t, mutate);
    const messages = [];
    await assert.rejects(
      checkPreviewRouting({ origin, log: (message) => messages.push(message) }),
      error,
    );
    assert.deepEqual(requests, expectedPaths.slice(0, expectedPaths.indexOf(path) + 1));
    // API passes first; a page only passes once its entry also loads.
    assert.equal(messages.length, Math.ceil(expectedPaths.indexOf(path) / 2));
  });
}

for (const domain of [undefined, "", "localhost", "127.0.0.1", "gustafta.my.id", "https://workspace.replit.dev"]) {
  test(`operational CLI rejects domain ${JSON.stringify(domain)}`, () => {
    const env = domain === undefined ? {} : { REPLIT_DEV_DOMAIN: domain };
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };
       await import("./scripts/check-preview-routing.mjs");`,
    ], {
      cwd: new URL("../", import.meta.url), env, encoding: "utf8", timeout: 5_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, domain ? /Expected a development hostname/ : /REPLIT_DEV_DOMAIN is required/);
    assert.doesNotMatch(result.stderr, /NETWORK_FORBIDDEN/);
    assert.doesNotMatch(result.stdout, /PASS/);
  });
}
