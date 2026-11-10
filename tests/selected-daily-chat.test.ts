import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import OpenAI from "openai";
import { DAILY_CHAT_MODELS, usesSelectedDailyChat } from "../shared/daily-chat-models";
import { aiModelSchema } from "../shared/schema";
import { createSelectedDailyChat, SelectedDailyChatError, SELECTED_DAILY_CHAT_KEY_NAMES } from "../server/lib/selected-daily-chat";

const messages = [{ role: "user" as const, content: "Fixture question" }];
const success = () => Response.json({ choices: [{ message: { content: "Fixture answer" }, finish_reason: "stop" }] });
const delta = (content: string, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;
const sse = (body: string) => new Response(body, { headers: { "Content-Type": "text/event-stream" } });
function fixture(fetcher: typeof fetch, key = "fixture-key") {
  const clients: any[] = [], providers: string[] = [];
  const runtime = createSelectedDailyChat({
    keyForProvider: provider => { providers.push(provider); return key || undefined; },
    createClient: config => {
      clients.push(config);
      return new OpenAI({ ...config, fetch: fetcher });
    },
  });
  return { runtime, clients, providers };
}
const safeFailure = (error: unknown) => error instanceof SelectedDailyChatError &&
  error.statusCode === 503 && !error.message.includes("private-provider-diagnostic");

for (const model of DAILY_CHAT_MODELS) {
  test(`${model.provider}: explicit model uses just that endpoint, key and model with SDK retries disabled`, async () => {
    let calls = 0;
    const fixtureClient = fixture(async (url, init) => {
      calls++;
      const expectedHost = { openai: "api.openai.com", deepseek: "api.deepseek.com",
        nvidia: "integrate.api.nvidia.com", gemini: "generativelanguage.googleapis.com" }[model.provider];
      assert.equal(new URL(String(url)).hostname, expectedHost);
      assert.equal(JSON.parse(init!.body as string).model, model.model);
      return success();
    });
    assert.equal(await fixtureClient.runtime.complete(model.id, messages), "Fixture answer");
    assert.equal(calls, 1);
    assert.equal(fixtureClient.clients.length, 1);
    assert.equal(fixtureClient.clients[0].maxRetries, 0);
    assert.deepEqual(fixtureClient.providers, [model.provider]);
    assert.ok(aiModelSchema.safeParse(model.id).success);
  });
  test(`${model.provider}: 503 never retries or contacts another provider and never exposes its diagnostic`, async () => {
    let calls = 0;
    const { runtime, providers } = fixture(async () => {
      calls++; return Response.json({ error: { message: "private-provider-diagnostic" } }, { status: 503 });
    });
    await assert.rejects(runtime.complete(model.id, messages), safeFailure);
    assert.equal(calls, 1);
    assert.deepEqual(providers, [model.provider]);
  });
  test(`${model.provider}: streaming completes once without a fallback attempt`, async () => {
    let calls = 0;
    const { runtime } = fixture(async () => { calls++; return sse(delta("Fixture ") + delta("answer", "stop") + "data: [DONE]\n\n"); });
    let text = "";
    for await (const chunk of runtime.stream(model.id, messages)) text += chunk.content;
    assert.equal(text, "Fixture answer");
    assert.equal(calls, 1);
  });
}

test("missing credentials, unknown reserved model and incompatible partner restriction stop before any SDK request", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return success(); }, "");
  await assert.rejects(f.runtime.complete(DAILY_CHAT_MODELS[0].id, messages), safeFailure);
  await assert.rejects(f.runtime.complete("chat:unknown:model", messages), safeFailure);
  assert.equal(usesSelectedDailyChat("chat:unknown:model"), true);
  assert.equal(aiModelSchema.safeParse("chat:unknown:model").success, false);
  const configured = fixture(async () => { calls++; return success(); });
  await assert.rejects(configured.runtime.complete(DAILY_CHAT_MODELS[2].id, messages, { requiredModel: "gpt-4o-mini" }), safeFailure);
  assert.equal(calls, 0);
  assert.equal(configured.clients.length, 0);
});

test("server credential names are provider-specific, with no Anthropic or cross-provider credential fallback", () => {
  assert.deepEqual(SELECTED_DAILY_CHAT_KEY_NAMES, {
    openai: "OPENAI_API_KEY", deepseek: "DEEPSEEK_API_KEY", nvidia: "NVIDIA_API_KEY", gemini: "GEMINI_API_KEY",
  });
});

test("pre-cancellation prevents requests and a deadline aborts without an automatic second attempt", async () => {
  let calls = 0;
  const f = fixture(async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("fixture abort", "AbortError"));
      if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.runtime.complete(DAILY_CHAT_MODELS[0].id, messages, { signal: abort.signal }), safeFailure);
  assert.equal(calls, 0);
  await assert.rejects(f.runtime.complete(DAILY_CHAT_MODELS[0].id, messages, { timeoutMs: 25 }), safeFailure);
  assert.equal(calls, 1);
});

test("a mid-stream drop, missing terminal or empty completion is a failure, not a saved successful answer", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return sse(delta("partial") + "data: [DONE]\n\n"); });
  let partial = "";
  await assert.rejects(async () => {
    for await (const chunk of f.runtime.stream(DAILY_CHAT_MODELS[2].id, messages)) partial += chunk.content;
  }, safeFailure);
  assert.equal(partial, "partial");
  assert.equal(calls, 1);
  const empty = fixture(async () => Response.json({ choices: [{ message: { content: "  " }, finish_reason: "stop" }] }));
  await assert.rejects(empty.runtime.complete(DAILY_CHAT_MODELS[1].id, messages), safeFailure);
});

test("text-only selections never send images to a different provider", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return success(); });
  for (const model of DAILY_CHAT_MODELS.filter(model => model.provider === "nvidia" || model.provider === "deepseek")) {
    await assert.rejects(f.runtime.complete(model.id, [
      { role: "user", content: [{ type: "image_url", image_url: { url: "https://fixture.invalid/image.png" } }] },
    ]), safeFailure);
  }
  assert.equal(calls, 0);
});

// Execute the actual strict branches, not test-only copies of route routing decisions.
const source = ts.createSourceFile("routes.ts", fs.readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
const strictBranches: ts.IfStatement[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === "usesSelectedDailyChat(agentModel)" &&
      /completeSelectedDailyChat|streamSelectedDailyChat|streamClient\s*=/.test(node.thenStatement.getText(source))) strictBranches.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
test("all four production primary paths dispatch reserved IDs before legacy clients", async () => {
  assert.equal(strictBranches.length, 5); // non-stream, stream client, stream attempts, sub-agent, external channels
  const dispatches = strictBranches.filter(node => node.thenStatement.getText(source).includes("completeSelectedDailyChat"));
  assert.equal(dispatches.length, 3);
  for (const node of dispatches) {
    let calls = 0;
    const fn = new Function("usesSelectedDailyChat", "completeSelectedDailyChat", "agentModel", "chatMessages",
      "temperature", "maxTokens", "timeoutMs", "responseFormat", "res",
      `return (async () => { let aiResponseContent; ${ts.transpileModule(node.getText(source), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText}; return aiResponseContent; })();`);
    const result = await fn(usesSelectedDailyChat, async () => { calls++; return "strict-result"; },
      DAILY_CHAT_MODELS[2].id, messages, 0.7, 1024, 5000, undefined, { once() {}, destroyed: false });
    assert.equal(result, "strict-result"); assert.equal(calls, 1);
  }
});

test("production SSE creates only one attempt even with all legacy fallbacks available", async () => {
  const node = strictBranches.find(node => node.thenStatement.getText(source).includes("fallbackAttempts.push"));
  assert.ok(node);
  const compiled = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let calls = 0;
  const fn = new Function("usesSelectedDailyChat", "streamSelectedDailyChat", "agentModel", "chatMessages",
    "temperature", "maxTokens", "res", "isClientConnected", "_partnerForChat",
    `const fallbackAttempts = []; ${compiled}; return fallbackAttempts;`);
  const attempts = fn(usesSelectedDailyChat, async function* () { calls++; throw new SelectedDailyChatError(); },
    DAILY_CHAT_MODELS[2].id, messages, 0.7, 1024, { once() {}, destroyed: false }, true, null);
  assert.equal(attempts.length, 1);
  await assert.rejects(async () => { for await (const _chunk of await attempts[0].createStream()) {} }, safeFailure);
  assert.equal(calls, 1);
});

test("partner and image coercions cannot silently replace an explicit selection; existing IDs still parse", () => {
  const coercions: ts.IfStatement[] = [];
  function walk(node: ts.Node) {
    if (ts.isIfStatement(node) && /agentModel\s*=/.test(node.thenStatement.getText(source)) &&
        /_partnerForChat\?\.cheapModel|hasVisionContent/.test(node.expression.getText(source))) coercions.push(node);
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.equal(coercions.length, 2);
  for (const node of coercions) assert.match(node.expression.getText(source), /!usesSelectedDailyChat\(agentModel\)/);
  for (const model of ["gpt-4o", "custom", "claude-3-sonnet", "qwen-plus"]) {
    assert.ok(aiModelSchema.safeParse(model).success); assert.equal(usesSelectedDailyChat(model), false);
  }
});

test("scheduled generators that consume agent model settings also dispatch strict IDs without requiring an unrelated OpenAI key", async () => {
  const feed = ts.createSourceFile("research-feed.ts", fs.readFileSync("server/lib/research-feed.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const branches: ts.IfStatement[] = [];
  let keyGuards = 0;
  function walk(node: ts.Node) {
    if (ts.isIfStatement(node)) {
      if (node.expression.getText(feed) === "usesSelectedDailyChat(agent?.aiModel)") branches.push(node);
      if (node.expression.getText(feed) === "!client && !usesSelectedDailyChat(agent?.aiModel)") keyGuards++;
    }
    ts.forEachChild(node, walk);
  }
  walk(feed);
  assert.equal(branches.length, 3); assert.equal(keyGuards, 3);
  for (const branch of branches) {
    let calls = 0;
    const code = ts.transpileModule(branch.getText(feed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const fn = new Function("usesSelectedDailyChat", "completeSelectedDailyChat", "agent", "persona", "userPrompt",
      `return (async () => { let content=""; ${code}; return content; })()`);
    assert.equal(await fn(usesSelectedDailyChat, async () => { calls++; return "strict-research-result"; },
      { aiModel: DAILY_CHAT_MODELS[2].id }, "Fixture persona", "Fixture input"), "strict-research-result");
    assert.equal(calls, 1);
  }
});
