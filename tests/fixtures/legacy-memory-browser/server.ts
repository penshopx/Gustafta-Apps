import express from "express";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import ts from "typescript";
import { z } from "zod";
import { RecoveryConflict } from "../../../server/lib/legacy-memory-recovery";
import { createRecoveryFixture } from "./store";
import { ARCHIVE_REFERENCE_PATTERN, APPROVAL_REASON, REJECTION_REASONS } from "../../../shared/legacy-memory-evidence";

const root = path.resolve(import.meta.dirname, "../../..");
const base = "/api/admin/legacy-memories";
const roles: Record<string, string> = {
  "admin-a": "superadmin", "admin-b": "superadmin", "admin-c": "superadmin", "ordinary-user": "user", "ordinary-admin": "admin",
};

// Execute ONLY the real guard and real recovery route registrations. Importing
// routes.ts would boot customer storage and unrelated services. Changed markers
// or removed guards fail loudly rather than silently testing copied handlers.
export function mountProductionRecoveryRoutes(app: express.Express, fixture: ReturnType<typeof createRecoveryFixture>) {
  const source = readFileSync(path.join(root, "server/routes.ts"), "utf8");
  const start = source.indexOf("  async function requireSuperAdmin(");
  const end = source.indexOf("  // ==================== ADMIN: LIVE SYSTEM LOAD", start);
  if (start < 0 || end < 0) throw new Error("Production recovery route boundaries changed");
  const block = source.slice(start, end);
  for (const registration of [
    `app.get("${base}", isAuthenticated, requireSuperAdmin,`,
    `app.post("${base}/reviews", isAuthenticated, requireSuperAdmin,`,
    `app.post("${base}/reviews/:id/decision", isAuthenticated, requireSuperAdmin,`,
  ]) {
    if (!block.includes(registration)) throw new Error(`Missing production superadmin guard: ${registration}`);
  }
  const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
  const helpers = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name &&
        ["checkIsSuperAdmin", "getSessionUserId", "getClientIp"].includes(node.name.text)) {
      helpers.set(node.name.text, node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (helpers.size !== 3) throw new Error("Production admin helper boundaries changed");
  const compiled = ts.transpileModule([...helpers.values(), block].join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const isAuthenticated = (req: any, res: any, next: any) =>
    req.user ? next() : res.status(401).json({ error: "Unauthenticated fixture session" });
  new Function("app", "z", "createLegacyMemoryRecovery", "pool", "storage",
    "RecoveryConflict", "isAuthenticated", "getDbRole",
    "ARCHIVE_REFERENCE_PATTERN", "APPROVAL_REASON", "REJECTION_REASONS", compiled)(
    app, z, () => fixture.recovery, Object.freeze({}), fixture.storage,
    RecoveryConflict, isAuthenticated, async (req: any) => req.user?.role ?? "user",
    ARCHIVE_REFERENCE_PATTERN, APPROVAL_REASON, REJECTION_REASONS,
  );
}

export async function startRecoveryBrowserFixture(port = 0, withUi = true) {
  const fixture = createRecoveryFixture();
  const app = express();
  app.use(express.json());
  app.use((req: any, res, next) => {
    const actor = req.headers.cookie?.match(/(?:^|;\s*)fixture-actor=([^;]+)/)?.[1];
    if (actor && roles[actor]) req.user = { id: actor, role: roles[actor] };
    if (req.path.startsWith(base)) res.on("finish", () => {
      fixture.audit.push({ method: req.method, path: req.originalUrl, actor: req.user?.id ?? null, status: res.statusCode });
    });
    next();
  });
  app.post("/__fixture/login/:actor", (req, res) => {
    if (!roles[req.params.actor]) return res.status(400).json({ error: "Unknown fixture identity" });
    res.cookie("fixture-actor", req.params.actor, { httpOnly: true, sameSite: "lax" }).json({ ok: true });
  });
  app.get("/api/admin/me", (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: "No fixture session" });
    res.json({ isSuperAdmin: req.user.role === "superadmin", user: { id: req.user.id } });
  });
  app.get("/__fixture/state", (_req, res) => res.json({
    memories: fixture.memories, reviews: fixture.reviews,
    evidence: [fixture.evidence(3), fixture.evidence(4)],
    archiveReads: fixture.archiveReads, audit: fixture.audit,
  }));
  mountProductionRecoveryRoutes(app, fixture);
  const server = createHttpServer(app);
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  if (withUi) {
    vite = await createViteServer({
      configFile: false, root: import.meta.dirname,
      plugins: [react(), tailwindcss()],
      resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
      // Vite 7 still injects a connecting client with hmr:false. Attach WS to
      // this fixture's own HTTP server instead of competing for port 24678.
      server: { middlewareMode: true, hmr: { server }, allowedHosts: true, fs: { allow: [root] } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  server.listen(port, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  return {
    url: `http://127.0.0.1:${address.port}`, fixture,
    async close() {
      await vite?.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await startRecoveryBrowserFixture(8099);
  console.log(`Isolated legacy-memory browser fixture: ${instance.url}`);
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    void instance.close().then(() => process.exit(0));
  });
}
