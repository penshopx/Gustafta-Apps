import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { checkCashflowAgentAccess } from "../server/lib/cashflow-agent-access";

const active = {
  id: 10,
  agentId: 101,
  status: "active",
  endDate: new Date("2030-01-01T00:00:00.000Z"),
};

test("non-CASHFLOW agents are unaffected", async () => {
  const result = await checkCashflowAgentAccess({
    agentId: 1,
    agentSlug: "another-agent",
    accessToken: null,
    getSubscriptionByToken: async () => undefined,
  });
  assert.deepEqual(result, { ok: true });
});

test("CASHFLOW agents deny missing and cross-tier tokens", async () => {
  const missing = await checkCashflowAgentAccess({
    agentId: 101,
    agentSlug: "si-kas-claw",
    accessToken: null,
    getSubscriptionByToken: async () => undefined,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "cashflow_subscription_required");

  const wrongAgent = await checkCashflowAgentAccess({
    agentId: 202,
    agentSlug: "si-pasal-claw",
    accessToken: "tier-one-token",
    getSubscriptionByToken: async () => active,
  });
  assert.equal(wrongAgent.ok, false);
  if (!wrongAgent.ok) assert.equal(wrongAgent.reason, "cashflow_subscription_invalid");
});

test("CASHFLOW agents accept exact active access and reject expired access", async () => {
  const valid = await checkCashflowAgentAccess({
    agentId: 101,
    agentSlug: "si-kas-claw",
    accessToken: "valid",
    getSubscriptionByToken: async () => active,
    now: new Date("2029-01-01T00:00:00.000Z"),
  });
  assert.deepEqual(valid, { ok: true });

  let expiredId: string | number | undefined;
  const expired = await checkCashflowAgentAccess({
    agentId: 101,
    agentSlug: "si-kas-claw",
    accessToken: "expired",
    getSubscriptionByToken: async () => active,
    markExpired: async (id) => {
      expiredId = id;
    },
    now: new Date("2031-01-01T00:00:00.000Z"),
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "cashflow_subscription_expired");
  assert.equal(expiredId, active.id);
});

test("all public message surfaces are wired to the CASHFLOW paid-access gate", async () => {
  const source = await readFile(
    new URL("../server/routes.ts", import.meta.url),
    "utf8",
  );
  for (const marker of [
    "_cashflowRead",
    "_cashflowSession",
    "_cashflowExport",
    "_cashflowExportCsv",
    "_cashflowChat",
    "_cashflowDelete",
    "_cashflowStream",
  ]) {
    assert.match(source, new RegExp(`const ${marker} = await assertCashflowPaidAgentAccess`));
  }
  assert.ok(
    source.indexOf("const _cashflowRead") <
      source.indexOf("if (agent.isPublic && !isAuthed)"),
    "anonymous public shortcut must run after the CASHFLOW gate",
  );
  assert.match(
    source,
    /app\.post\("\/api\/products\/:agentId\/token-by-email", optionalAuthWithEmail/,
  );
  assert.match(source, /Email harus sama dengan email akun yang sedang masuk/);
});