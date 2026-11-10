import { test } from "node:test";
import assert from "node:assert/strict";
import { makeImproveBrainHandler } from "../server/lib/improve-brain-handler";

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
}

function setup(options: {
  prompt?: string;
  improved?: string;
  authz?: { ok: true } | { ok: false; status: number; error: string };
  rateLimited?: boolean;
} = {}) {
  const originalPrompt =
    options.prompt ??
    "Identitas agen\nFEDERATION_MODE v2\nSYNTHESIS ORCHESTRATOR\nSCORECARD";
  let claudeCalls = 0;
  let writes = 0;
  const handler = makeImproveBrainHandler({
    getAgent: async () => ({ name: "Orkestrator", systemPrompt: originalPrompt }),
    assertCanMutateAgent: async () => options.authz ?? { ok: true },
    isRateLimited: () => options.rateLimited ?? false,
    callClaude: async () => {
      claudeCalls++;
      return options.improved ?? originalPrompt;
    },
  });

  return {
    handler,
    get claudeCalls() {
      return claudeCalls;
    },
    get writes() {
      return writes;
    },
    // Sengaja tidak diberikan ke handler: endpoint preview tidak boleh memiliki
    // jalur penyimpanan. Counter membuat invariant ini eksplisit di assertion.
    markWrite() {
      writes++;
    },
  };
}

async function invoke(subject: ReturnType<typeof setup>) {
  const req = {
    params: { id: "agent-1" },
    user: { id: "owner-1" },
    body: { instruction: "Rapikan" },
  };
  const res = responseRecorder();
  await subject.handler(req, res);
  return res;
}

test("hasil Claude tanpa marker orkestrator ditolak 422 dan tidak disimpan", async () => {
  const subject = setup({ improved: "Prompt yang tampak rapi tetapi marker hilang" });
  const res = await invoke(subject);

  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /FEDERATION_MODE v2/);
  assert.match(res.body.error, /SYNTHESIS ORCHESTRATOR/);
  assert.match(res.body.error, /SCORECARD/);
  assert.equal(subject.claudeCalls, 1);
  assert.equal(subject.writes, 0);
});

test("non-owner ditolak 403 sebelum memanggil Claude", async () => {
  const subject = setup({
    authz: { ok: false, status: 403, error: "Forbidden" },
  });
  const res = await invoke(subject);

  assert.equal(res.statusCode, 403);
  assert.equal(subject.claudeCalls, 0);
  assert.equal(subject.writes, 0);
});

test("system prompt di atas 24.000 karakter ditolak 400 sebelum memanggil Claude", async () => {
  const subject = setup({ prompt: "x".repeat(24001) });
  const res = await invoke(subject);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /24\.000/);
  assert.equal(subject.claudeCalls, 0);
  assert.equal(subject.writes, 0);
});

test("pengguna yang melewati batas 15 per jam ditolak 429 sebelum memanggil Claude", async () => {
  const subject = setup({ rateLimited: true });
  const res = await invoke(subject);

  assert.equal(res.statusCode, 429);
  assert.equal(subject.claudeCalls, 0);
  assert.equal(subject.writes, 0);
});