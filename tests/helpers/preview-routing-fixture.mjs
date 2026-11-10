import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, request } from "node:http";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function readRoutingConfig() {
  // Python 3.11+ is already part of this project's runtime. Parse TOML, not
  // regexes; return only routing fields (never [userenv] values).
  return JSON.parse(execFileSync("python3", ["-c", `
import json, tomllib
from pathlib import Path
root = Path(${JSON.stringify(root)})
main = tomllib.loads((root / ".replit").read_text())
artifact = tomllib.loads((root / "artifacts/mockup-sandbox/.replit-artifact/artifact.toml").read_text())
print(json.dumps({
  "mainPort": int(main["env"]["PORT"]),
  "ports": main["ports"],
  "workflowPort": next(w for w in main["workflows"]["workflow"] if w["name"] == "Start application")["tasks"][0]["waitForPort"],
  "router": artifact["router"],
  "previewPath": artifact["previewPath"],
  "services": [{"localPort": s["localPort"], "paths": s["paths"], "env": s["env"]} for s in artifact["services"]]
}))
`], { encoding: "utf8", timeout: 5_000, env: { PATH: process.env.PATH } }));
}

export function validateRoutingConfig(config) {
  assert.equal(config.mainPort, 5000);
  assert.equal(config.workflowPort, config.mainPort);
  assert.deepEqual(config.ports, [
    { localPort: 5000, externalPort: 80 },
    { localPort: 23636, externalPort: 3000 },
  ]);
  assert.equal(config.router, "path");
  assert.equal(config.previewPath, "/__mockup/");
  assert.equal(config.services.length, 1);
  const sandbox = config.services[0];
  assert.equal(sandbox.localPort, 23636);
  assert.deepEqual(sandbox.paths, [config.previewPath]);
  assert.equal(Number(sandbox.env.PORT), sandbox.localPort);
  assert.equal(sandbox.env.BASE_PATH, config.previewPath);
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address().port;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

// No application imports, child app processes, database or provider clients.
// Logical configured ports map to ephemeral loopback ports, so real workflows
// can keep running untouched.
export async function createRoutingFixture(config) {
  validateRoutingConfig(config);
  const services = new Map();
  const upstreams = new Map();
  const generations = new Map();
  const sandboxConfig = config.services[0];
  const mainPort = config.ports.find((p) => p.externalPort === 80).localPort;

  function target(path) {
    return config.services.find((s) => s.paths.some((prefix) => path.startsWith(prefix)))
      ?.localPort ?? mainPort;
  }

  const proxy = createServer((req, res) => {
    const port = upstreams.get(target(new URL(req.url, "http://fixture").pathname));
    if (!port) {
      res.writeHead(503).end("Selected fixture is unavailable; no fallback.");
      return;
    }
    const upstream = request({
      hostname: "127.0.0.1", port, path: req.url, method: req.method,
      headers: { ...req.headers, connection: "close" },
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.setTimeout(2_000, () => upstream.destroy(new Error("fixture timeout")));
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(503);
      res.end("Selected fixture is unavailable; no fallback.");
    });
    req.pipe(upstream);
  });
  const port = await listen(proxy);

  return {
    origin: `http://127.0.0.1:${port}`,
    async start(name) {
      assert(["gustafta", "sandbox"].includes(name));
      assert(!services.has(name), `${name} is already started`);
      const logicalPort = name === "gustafta" ? mainPort : sandboxConfig.localPort;
      const generation = (generations.get(name) ?? 0) + 1;
      const base = name === "sandbox" ? sandboxConfig.env.BASE_PATH : "/";
      const server = createServer((req, res) => {
        res.setHeader("x-fixture-service", name);
        res.setHeader("x-fixture-generation", String(generation));
        res.setHeader("cache-control", "no-store");
        const path = new URL(req.url, "http://fixture").pathname;
        if (name === "gustafta" && path.startsWith("/api/")) {
          res.writeHead(401, {
            "content-type": "application/json",
            "cache-control": "private, no-store",
            "x-gustafta-rs-contract": "rs-app-v1-private-no-store",
          }).end(JSON.stringify({ error: "Unauthenticated fixture", path, generation }));
        } else if (!path.startsWith(base) || (name === "gustafta" && path.startsWith(config.previewPath))) {
          res.writeHead(404).end("Wrong fixture");
        } else if (path === `${base}src/main.tsx`) {
          res.writeHead(200, { "content-type": "application/javascript" })
            .end(`export const fixture = ${JSON.stringify({ name, generation })};`);
        } else {
          res.writeHead(200, { "content-type": "text/html" })
            .end(`<title>${name === "gustafta" ? "Gustafta" : "Mockup Canvas"}</title><script type="module" src="${base}src/main.tsx"></script>`);
        }
      });
      try {
        const actualPort = await listen(server, upstreams.get(logicalPort) ?? 0);
        services.set(name, server);
        upstreams.set(logicalPort, actualPort);
        generations.set(name, generation);
      } catch (error) {
        await close(server);
        throw error;
      }
    },
    async stop(name) {
      assert(services.has(name), `${name} is not running`);
      await close(services.get(name));
      services.delete(name);
      // Keep the selected port while offline. The router must not reassign its
      // paths to whichever server happens to still be listening.
    },
    async close() {
      await close(proxy);
      await Promise.all([...services.values()].map(close));
    },
  };
}
