import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PoolClient, QueryResult } from "pg";

export const markers = {
  private: "PRIVATE_A_DOCUMENT_CANARY_76315",
  curated: "PLATFORM_DOCUMENT_CANARY_89427",
  subPrivate: "PRIVATE_SUB_AGENT_DOCUMENT_CANARY_21864",
  subCurated: "PLATFORM_SUB_AGENT_DOCUMENT_CANARY_57296",
};
export const owner = "kb-http-owner-a";
export const other = "kb-http-viewer-b";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server?: Server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

/**
 * Full production route registration + real PostgreSQL storage. Only session
 * establishment and the external AI transport are fixtures. All SQL runs on a
 * single BEGIN connection: disconnect/SIGKILL rolls back, not merely after().
 * Call ONLY after prepareTestDatabase() has proved the disposable DB.
 */
export async function startKBContextFixture() {
  const captures: Array<{ messages: Array<{ role: string; content: string }>; stream?: boolean }> = [];
  const ai = express();
  ai.use(express.json({ limit: "5mb" }));
  ai.post("/v1/chat/completions", (req, res) => {
    captures.push(req.body);
    const prompt = JSON.stringify(req.body.messages);
    const content = Object.values(markers).filter(marker => prompt.includes(marker)).join("\n");
    if (req.body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.json({ choices: [{ message: { role: "assistant", content } }], usage: { total_tokens: 1 } });
    }
  });
  let aiServer: Server | undefined;
  let appServer: Server | undefined;
  let client: PoolClient | undefined;
  let pool: (typeof import("../../server/db"))["pool"] | undefined;
  let originalQuery: any;
  let originalConnect: any;
  let pendingQuery: Promise<unknown> = Promise.resolve();
  async function drainQueries() {
    // Orchestration schedules Project Brain/deliverable write-back with
    // setImmediate after sending SSE complete. A single pendingQuery await can
    // miss its next SQL continuation and let it run after ROLLBACK/pool.end().
    // Keep the fixture connection pinned through an idle event-loop turn.
    for (;;) {
      await new Promise<void>(resolve => setImmediate(resolve));
      const tail = pendingQuery;
      await tail;
      await new Promise<void>(resolve => setImmediate(resolve));
      if (tail === pendingQuery) return;
    }
  }
  const originalFetch = globalThis.fetch;
  try {
    aiServer = createServer(ai);
    const aiUrl = await listen(aiServer);
    // Process-local dummy credentials. Never read or restore real key values.
    for (const key of [
      "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY",
      "QWEN_API_KEY", "DASHSCOPE_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "NVIDIA_API_KEY",
    ]) delete process.env[key];
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "isolated-fixture-not-a-secret";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `${aiUrl}/v1`;
    // Non-stream chat uses model-router, which creates its own SDK client.
    process.env.OPENAI_API_KEY = "isolated-fixture-not-a-secret";
    process.env.OPENAI_BASE_URL = `${aiUrl}/v1`;
    process.env.ADMIN_USER_IDS = "";
    process.env.NODE_ENV = "test";
    // A new fallback or accidentally configured provider must fail, not bill.
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      assert.equal(url.hostname, "127.0.0.1", "Fixture forbids external HTTP");
      return originalFetch(input, init);
    }) as typeof fetch;

    ({ pool } = await import("../../server/db"));
    client = await pool.connect();
    await client.query("BEGIN");
    originalQuery = pool.query;
    originalConnect = pool.connect;
    const query = (...args: any[]): Promise<QueryResult<any>> => {
      assert.notEqual(typeof args.at(-1), "function", "Fixture requires promise-based SQL");
      const result = pendingQuery.then(() => client!.query(...args as [any, any]));
      pendingQuery = result.then(() => {}, () => {});
      return result as Promise<QueryResult<any>>;
    };
    pool.query = query as typeof pool.query;
    // Startup includes a real Drizzle transaction (sales-ladder seed). Lease
    // the SAME client and translate its transaction boundary to a savepoint:
    // its COMMIT must never commit the outer fixture. Concurrent independent
    // transactions fail explicitly instead of sharing a misleading boundary.
    let leased = false;
    let transactionNumber = 0;
    pool.connect = (async () => {
      assert.equal(leased, false, "Fixture forbids concurrent independent SQL transactions");
      leased = true;
      const savepoint = `kb_fixture_tx_${++transactionNumber}`;
      return {
        query(input: any, ...args: any[]) {
          const text = typeof input === "string" ? input : input.text;
          const command = text.trim().toLowerCase();
          const replacement = /^begin\b/.test(command) ? `SAVEPOINT ${savepoint}`
            : command === "commit" ? `RELEASE SAVEPOINT ${savepoint}`
            : command === "rollback" ? `ROLLBACK TO SAVEPOINT ${savepoint}` : text;
          return query(typeof input === "string" ? replacement : { ...input, text: replacement }, ...args);
        },
        release() { leased = false; },
      };
    }) as typeof pool.connect;
    const { storage } = await import("../../server/storage");
    await client.query(
      "INSERT INTO users (id, email, role, is_active) VALUES ($1, $2, 'user', true), ($3, $4, 'user', true)",
      [owner, `${owner}@example.test`, other, `${other}@example.test`],
    );
    const agent = await storage.createAgent({
      name: "Isolated public document agent", userId: owner, isPublic: true,
      aiModel: "gpt-4o", ragEnabled: true, guestMessageLimit: 1000,
    } as any);
    assert.equal(agent.userId, owner);
    assert.equal(agent.isPublic, true);
    // createAgent does not persist this optional setting; the enlarged HTTP
    // matrix must not accidentally test the default ten-message guest quota.
    await storage.updateAgent(agent.id, { guestMessageLimit: 1000 });
    const curated = await storage.createKnowledgeBase({
      agentId: agent.id, name: "Platform fixture", type: "text",
      content: `${markers.curated} curated reference available to every visitor.`,
      visibility: "platform", status: "active",
    } as any);

    const app = express();
    app.use(express.json());
    app.use(session({
      secret: "isolated-public-chat-session-fixture",
      resave: false, saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure: false },
    }));
    app.use((req: any, _res, next) => {
      const actor = req.headers["x-fixture-user"];
      if (actor === owner || actor === other) {
        if (req.headers["x-fixture-auth"] === "email") {
          req.session.emailUser = { id: actor };
          req.user = { claims: { sub: actor } };
          req.isAuthenticated = () => false;
        } else {
          req.user = { id: actor, claims: { sub: actor }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
          req.isAuthenticated = () => true;
        }
      } else req.isAuthenticated = () => false;
      next();
    });
    appServer = createServer(app);
    const { registerRoutes } = await import("../../server/routes");
    await registerRoutes(appServer, app);
    // Full registration starts a seed asynchronously; include it in the fixture
    // rather than letting it keep writing after ROLLBACK/pool shutdown.
    await (await import("../../server/routes-lms")).lmsSeedSettled;
    const url = await listen(appServer);
    const cookies = new Map<string, string>();
    async function request(method: string, path: string, actor?: string, body?: unknown, email = false, browser = "default") {
      const key = `${actor || "anonymous"}:${email}:${browser}`;
      const response = await fetch(`${url}${path}`, {
        method, signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          ...(actor ? { "x-fixture-user": actor } : {}),
          ...(email ? { "x-fixture-auth": "email" } : {}),
          ...(cookies.has(key) ? { Cookie: cookies.get(key)! } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const cookie = response.headers.get("set-cookie");
      if (cookie) cookies.set(key, cookie.split(";")[0]);
      return response;
    }
    let closed = false;
    return {
      request, captures, agentId: agent.id, curatedId: curated.id, storage, query,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await close(appServer);
          await close(aiServer);
        } finally {
          await drainQueries();
          pool!.query = originalQuery;
          pool!.connect = originalConnect;
          await client!.query("ROLLBACK");
          client!.release();
          await pool!.end();
          globalThis.fetch = originalFetch;
        }
      },
    };
  } catch (error) {
    await close(appServer);
    await close(aiServer);
    await drainQueries();
    if (pool && originalQuery) pool.query = originalQuery;
    if (pool && originalConnect) pool.connect = originalConnect;
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    if (pool) await pool.end();
    globalThis.fetch = originalFetch;
    throw error;
  }
}
