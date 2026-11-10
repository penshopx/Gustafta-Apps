import { prepareTestDatabase } from "../test-database";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { eq } from "drizzle-orm";
import { knowledgeBases } from "../../shared/schema";
import { registerKBPublicationRoutes } from "../../server/kb-publication-routes";
import { recordKBPublication, readKBPublicationHistory } from "../../server/lib/kb-publication-history";
import { loadContextSources } from "../../server/lib/kb-context-access";

assert.ok(await prepareTestDatabase(), "Disposable PostgreSQL is required");
const { db, pool } = await import("../../server/db");
const { dbStorage } = await import("../../server/db-storage");
await pool.query("SET statement_timeout = '10s'");

let armed = false;
let release: (() => void) | undefined;
const connect = pool.connect.bind(pool);
pool.connect = ((callback?: any) => {
  // pg.Pool.query acquires connections via the callback overload. Only
  // Drizzle's promise-based transaction leases need scheduling.
  if (callback) return connect(callback);
  return (async () => {
  const client = await connect();
  const query = client.query.bind(client);
  const pid = (await query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  // Observe and schedule real queries, never replace results or transactions.
  // Match SELECT independently of FOR UPDATE so removing the production lock
  // fails the observed-blocking assertion instead of bypassing the pause.
  client.query = (async (input: any, values?: any) => {
    const result = await query(input, values);
    const text = typeof input === "string" ? input : input.text;
    if (armed && /^select\b/i.test(text) && text.includes('from "knowledge_bases"')) {
      armed = false;
      await new Promise<void>(resolve => {
        release = resolve;
        process.send!({ event: "paused", pid });
      });
    }
    return result;
  }) as typeof client.query;
  const originalRelease = client.release.bind(client);
  client.release = (...args: any[]) => {
    client.query = query as typeof client.query;
    client.release = originalRelease;
    originalRelease(...args);
  };
  return client;
  })();
}) as typeof pool.connect;

const app = express();
app.use(express.json());
// Execute the actual registration block from routes.ts, not a handwritten
// adapter. Avoid importing registerRoutes, whose unrelated seeds/workers are
// deliberately outside this race fixture. Fail loudly if its boundary moves.
const routes = readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");
const start = routes.indexOf("  registerKBPublicationRoutes(app, {");
const end = routes.indexOf('\n  app.patch("/api/knowledge-base/:id"', start);
assert.ok(start >= 0 && end > start, "Production publication wiring boundary changed");
new Function(
  "app", "registerKBPublicationRoutes", "isAuthenticated", "getAuthenticatedMemoryUserId",
  "storage", "assertCanMutateAgent", "db", "knowledgeBases", "eq",
  "recordKBPublication", "readKBPublicationHistory", routes.slice(start, end),
)(
  app, registerKBPublicationRoutes,
  (_req: any, _res: any, next: any) => next(),
  () => "importer",
  { getAgent: async () => ({ id: "777" }) },
  async () => ({ ok: true }),
  db, knowledgeBases, eq, recordKBPublication, readKBPublicationHistory,
);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
process.send!({ event: "ready", port: (server.address() as { port: number }).port });

process.on("message", async (message: any) => {
  try {
    let result: unknown;
    switch (message.command) {
      case "arm": armed = true; break;
      case "release": release?.(); release = undefined; break;
      case "edit":
        result = await dbStorage.updateKnowledgeBase(String(message.id), message.data, "editor");
        break;
      case "context":
        result = await loadContextSources(dbStorage, "777", message.viewer);
        break;
      case "repair": {
        const boot = readFileSync(new URL("../../server/index.ts", import.meta.url), "utf8");
        const sql = boot.match(/await pool\.query\(`\s*(UPDATE knowledge_bases kb[\s\S]*?)`\);/);
        assert.ok(sql, "Production startup repair boundary changed");
        await pool.query(sql[1]);
        // Also exercise the committed migration's repeated-application path.
        await pool.query(readFileSync(new URL("../../migrations/0029_private_knowledge_context.sql", import.meta.url), "utf8"));
        break;
      }
      default: throw new Error("Unknown fixture command");
    }
    process.send!({ request: message.request, result });
  } catch (error) {
    process.send!({ request: message.request, error: error instanceof Error ? error.message : String(error) });
  }
});

process.on("disconnect", () => {
  release?.();
  server.closeAllConnections();
  server.close(() => void pool.end().finally(() => process.exit(0)));
});
