import { prepareTestDatabase } from "./test-database";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import pg from "pg";

// Fail rather than report a green skipped race suite when its runner is absent.
assert.ok(await prepareTestDatabase(), "Run npm run test:kb-publication-concurrency");

class Worker {
  child: ChildProcess;
  port = 0;
  pausedPid = 0;
  private serial = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  readonly ready: Promise<void>;
  constructor(readonly name: string) {
    this.child = fork(new URL("./fixtures/kb-publication-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
        TEST_DATABASE_LEASE_GROUP: process.env.TEST_DATABASE_LEASE_GROUP,
        TEST_DATABASE_APP_NAMES: process.env.TEST_DATABASE_APP_NAMES,
        PGAPPNAME: name,
      },
    });
    let stderr = "";
    this.child.stderr!.on("data", chunk => { stderr += chunk; });
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${name}: startup timed out: ${stderr}`)), 15_000);
      timeout.unref();
      this.child.on("message", (message: any) => {
        if (message.event === "ready") { clearTimeout(timeout); this.port = message.port; resolve(); }
        if (message.event === "paused") this.pausedPid = message.pid;
        const pending = this.pending.get(message.request);
        if (pending) {
          this.pending.delete(message.request);
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message.result);
        }
      });
      this.child.once("error", reject);
      this.child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        const error = new Error(`${name} exited (${code ?? signal}): ${stderr}`);
        reject(error);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      });
    });
  }
  rpc(command: string, payload: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = ++this.serial;
      const timeout = setTimeout(() => {
        this.pending.delete(request);
        reject(new Error(`${this.name}: ${command} timed out`));
      }, 20_000);
      timeout.unref();
      this.pending.set(request, {
        resolve(value) { clearTimeout(timeout); resolve(value); },
        reject(error) { clearTimeout(timeout); reject(error); },
      });
      this.child.send({ request, command, ...payload });
    });
  }
  async publish(id: number, publish = true) {
    const response = await fetch(`http://127.0.0.1:${this.port}/api/knowledge-base/${id}/publication`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publish, confirmed: true }), signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() };
  }
  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exit = once(this.child, "exit");
    this.child.kill("SIGKILL"); // A genuine fresh process, not a cleared object/cache.
    await exit;
  }
}

async function until(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(`Timed out: ${description}`);
}

test("real PostgreSQL publication races, cross-worker revocation and restart", { timeout: 120_000 }, async t => {
  const observer = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
  const workers: Worker[] = [];
  const worker = async (name: string) => {
    const instance = new Worker(name);
    workers.push(instance);
    await instance.ready;
    return instance;
  };
  const row = async (id: number) => (await observer.query("SELECT * FROM knowledge_bases WHERE id = $1", [id])).rows[0];
  const history = async (id: number) => (await observer.query(
    "SELECT action, reason, content_revision, actor_id FROM kb_publication_history WHERE source_id = $1 ORDER BY id", [id],
  )).rows;
  const seed = async () => (await observer.query(`INSERT INTO knowledge_bases
    (agent_id, name, type, content, visibility, owner_user_id, processing_status, file_url)
    VALUES (777, 'race fixture', 'text', 'approved old bytes', 'private', 'importer', 'completed',
      '/api/ruang-simpan/file/original/download') RETURNING id`)).rows[0].id as number;
  const blockedBy = async (waiter: Worker, holder: Worker) => {
    await until(async () => holder.pausedPid !== 0, "winner reached production SELECT");
    await until(async () => {
      const result = await observer.query(`SELECT 1 FROM pg_stat_activity
        WHERE application_name = $1 AND $2::int = ANY(pg_blocking_pids(pid))`,
      [waiter.name, holder.pausedPid]);
      return result.rowCount === 1;
    }, "loser blocked by winner's real PostgreSQL row lock");
  };
  try {
    const a = await worker("kb-publication-worker-a");
    const b = await worker("kb-publication-worker-b");
    assert.notEqual(a.child.pid, b.child.pid);

    // An AFTER UPDATE trigger observes every intermediate SQL write, not only
    // the final committed state. Splitting content/revision and revocation
    // into separate UPDATEs must fail even inside one transaction.
    await observer.query(`CREATE FUNCTION enforce_publication_atomicity_fixture() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.visibility = 'published' AND
          (NEW.content IS DISTINCT FROM OLD.content OR NEW.content_revision <> OLD.content_revision
            OR NEW.processing_status = 'processing') AND NEW.visibility <> 'private' THEN
          RAISE EXCEPTION 'content and consent must change in one UPDATE';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER enforce_publication_atomicity_fixture AFTER UPDATE ON knowledge_bases
      FOR EACH ROW EXECUTE FUNCTION enforce_publication_atomicity_fixture();`);

    for (const mode of ["edit", "reprocess"] as const) {
      await t.test(`publication first, concurrent ${mode} revokes that exact revision`, async () => {
        const id = await seed();
        a.pausedPid = 0;
        await a.rpc("arm");
        const publish = a.publish(id);
        const outcomes: Promise<unknown>[] = [publish];
        try {
          await until(async () => a.pausedPid !== 0, "publication paused after SELECT");
          const edit = b.rpc("edit", { id, data: mode === "edit"
            ? { content: "new unapproved bytes" } : { processingStatus: "processing" } });
          outcomes.push(edit);
          await blockedBy(b, a);
          assert.equal((await row(id)).visibility, "private", "uncommitted approval is invisible");
          await a.rpc("release");
          assert.equal((await publish).status, 200);
          await edit;
          assert.equal((await row(id)).visibility, "private");
          assert.equal((await row(id)).content_revision, 2);
          assert.deepEqual(await history(id), [
            { action: "publish", reason: "consent", content_revision: 1, actor_id: "importer" },
            { action: "revoke", reason: mode === "edit" ? "content_edit" : "reprocess", content_revision: 1, actor_id: "editor" },
          ]);
          const context = await a.rpc("context");
          assert.ok(!context.kbs.some((kb: any) => Number(kb.id) === id));
          if (mode === "reprocess") {
            assert.equal((await a.publish(id)).status, 403);
            await b.rpc("edit", { id, data: { processingStatus: "completed" } });
            assert.equal((await row(id)).visibility, "private", "completion never restores old consent");
          }
          assert.equal((await a.publish(id)).status, 200);
          assert.equal((await row(id)).visibility, "published");
          assert.equal((await history(id)).at(-1).content_revision, 2);
        } finally {
          await a.rpc("release");
          await Promise.allSettled(outcomes);
        }
      });

      await t.test(`${mode} first, publisher reads only the locked current version`, async () => {
        const id = await seed();
        assert.equal((await a.publish(id)).status, 200);
        b.pausedPid = 0;
        await b.rpc("arm");
        const edit = b.rpc("edit", { id, data: mode === "edit"
          ? { content: "replacement", processingStatus: "processing" } : { processingStatus: "processing" } });
        const outcomes: Promise<unknown>[] = [edit];
        try {
          await until(async () => b.pausedPid !== 0, "editor paused after SELECT");
          const publish = a.publish(id);
          outcomes.push(publish);
          await blockedBy(a, b);
          await b.rpc("release");
          await edit;
          assert.equal((await publish).status, 403, "publisher must see processing, not stale completed version");
          assert.equal((await row(id)).visibility, "private");
          assert.equal((await history(id)).length, 2, "rejected publisher leaves no consent");
          await b.rpc("edit", { id, data: { processingStatus: "completed" } });
          assert.equal((await row(id)).visibility, "private");
          assert.equal((await a.publish(id)).status, 200);
          assert.equal((await history(id)).at(-1).content_revision, 2);
        } finally {
          await b.rpc("release");
          await Promise.allSettled(outcomes);
        }
      });
    }

    await t.test("other worker revokes warm context and restart preserves consent/importer", async () => {
      const published = await seed();
      const revoked = await seed();
      assert.equal((await a.publish(published)).status, 200);
      assert.equal((await a.publish(revoked)).status, 200);
      await observer.query(`INSERT INTO knowledge_chunks (knowledge_base_id, agent_id, chunk_index, content)
        VALUES ($1, 777, 0, 'published chunk'), ($2, 777, 0, 'revoked chunk')`, [published, revoked]);
      // Earlier cases intentionally read an empty chunk cache. Give this case
      // a fresh reader so its cache is primed with these committed chunks.
      const reader = await worker("kb-publication-context-reader");
      // Prime the very process which must notice the second worker's write.
      const warm = await reader.rpc("context");
      assert.ok(warm.kbs.some((kb: any) => Number(kb.id) === revoked));
      assert.ok(warm.chunks.some((chunk: any) => chunk.knowledgeBaseId === revoked));
      assert.equal((await b.publish(revoked, false)).status, 200);
      const withdrawn = await reader.rpc("context");
      assert.ok(!withdrawn.kbs.some((kb: any) => Number(kb.id) === revoked));
      assert.ok(!withdrawn.chunks.some((chunk: any) => chunk.knowledgeBaseId === revoked),
        "warm cached chunks cannot bypass a fresh visibility read");
      assert.ok((await reader.rpc("context", { viewer: "importer" })).kbs.some((kb: any) => Number(kb.id) === revoked));
      const before = await Promise.all([row(published), row(revoked), history(published), history(revoked)]);
      // Legacy repair requires these relations, but their owners intentionally
      // disagree with the importer. A restart must not reassign either copy.
      await observer.query(`CREATE TABLE IF NOT EXISTS ruang_simpan_files (id text PRIMARY KEY, user_id text);
        INSERT INTO ruang_simpan_files (id, user_id) VALUES ('original', 'original-file-owner');
        INSERT INTO agents (id, name, user_id) VALUES (777, 'fixture agent', 'agent-owner');`);
      await reader.stop();
      const restarted = await worker("kb-publication-worker-restarted");
      for (let i = 0; i < 2; i++) await restarted.rpc("repair");
      assert.deepEqual(await Promise.all([row(published), row(revoked), history(published), history(revoked)]), before);
      const context = await restarted.rpc("context");
      assert.ok(context.kbs.some((kb: any) => Number(kb.id) === published));
      assert.ok(!context.kbs.some((kb: any) => Number(kb.id) === revoked));
      assert.ok(!context.chunks.some((chunk: any) => chunk.knowledgeBaseId === revoked));
      assert.equal((await restarted.publish(revoked)).status, 200, "importer can explicitly reapprove after restart");
      assert.equal((await history(revoked)).at(-1).actor_id, "importer");
      assert.ok((await restarted.rpc("context")).chunks.some((chunk: any) => chunk.knowledgeBaseId === revoked));
    });
  } finally {
    await Promise.all(workers.map(instance => instance.stop()));
    await observer.end();
    // The runner drops the entire dedicated cluster, including all fixture
    // rows/triggers, even on assertion failure; no customer DB cleanup exists.
  }
});
