import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { WORKROOM_ANALYSIS_POLICY as analysis } from "@shared/workroom-analysis-policy";
import { WORKROOM_BUDGET_POLICY as policy, type WorkroomBudgetSnapshot } from "@shared/workroom-budget-policy";
import { WorkroomTransitionError } from "@shared/workroom-transitions";
import type { WorkroomBudgetMonitor } from "@shared/workroom-budget-monitor";

type Execute = (query: SQL) => Promise<{ rows: any[] }>;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const accountSchema = z.object({ calls: integer, reservedMicroUsd: integer }).strict();
const bucketSchema = z.object({
  schemaVersion: z.literal(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  calls: integer, reservedMicroUsd: integer,
  accounts: z.record(z.string().regex(/^[a-f0-9]{64}$/), accountSchema),
}).strict();
type Bucket = z.infer<typeof bucketSchema>;
export type BudgetRejectionReason = "account_calls" | "account_estimate" | "platform_estimate";
export class WorkroomBudgetLimitError extends WorkroomTransitionError {
  constructor(readonly day: string, readonly reason: BudgetRejectionReason) {
    const messages = {
      account_calls: `Batas ${policy.dailyCallsPerAccount} analisis harian akun tercapai.`,
      account_estimate: "Sisa anggaran estimasi akun tidak cukup untuk analisis ini.",
      platform_estimate: "Sisa anggaran estimasi Workroom gabungan tidak cukup untuk analisis ini.",
    };
    super(`${messages[reason]} Coba setelah reset pukul 00.00 WIB.`, 429);
  }
}
const unavailable = () => new WorkroomTransitionError("Batas harian AI belum dapat diverifikasi. Analisis tidak dimulai.", 503);
export const workroomBudgetKey = (day: string) => `workroom_analysis_budget:v1:${day}`;
const accountKey = (ownerId: string) => createHash("sha256").update(ownerId).digest("hex");

export function workroomBudgetDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw unavailable();
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Conservative text-only reservation, not a provider invoice/token measurement. */
export function estimateWorkroomAnalysis(messages: readonly { content: string }[]): number {
  if (analysis.model !== policy.pricedModel || messages.length !== 2 ||
      messages.some(message => typeof message.content !== "string") ||
      messages.reduce((size, message) => size + message.content.length, 0) > analysis.maxInputChars) throw unavailable();
  // BPE text tokens cannot exceed the UTF-8 byte count; framing is reserved separately.
  const input = messages.reduce((size, message) => size + Buffer.byteLength(message.content, "utf8"), 0) +
    policy.framingTokenAllowance;
  return Math.ceil(input * policy.inputUsdPerMillion + analysis.maxOutputTokens * policy.outputUsdPerMillion);
}
export const minimumWorkroomReservation = () => estimateWorkroomAnalysis([{ content: "" }, { content: "" }]);

function parseBucket(value: string | undefined, day: string): Bucket {
  if (value === undefined) return { schemaVersion: 1, day, calls: 0, reservedMicroUsd: 0, accounts: {} };
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { throw unavailable(); }
  const parsed = bucketSchema.safeParse(raw);
  if (!parsed.success || parsed.data.day !== day) throw unavailable();
  const accounts = Object.values(parsed.data.accounts);
  if (accounts.reduce((sum, account) => sum + account.calls, 0) !== parsed.data.calls ||
      accounts.reduce((sum, account) => sum + account.reservedMicroUsd, 0) !== parsed.data.reservedMicroUsd) throw unavailable();
  return parsed.data;
}

function summary(bucket: Bucket, ownerId: string, nextCost = minimumWorkroomReservation()): WorkroomBudgetSnapshot {
  const account = bucket.accounts[accountKey(ownerId)] || { calls: 0, reservedMicroUsd: 0 };
  const reason = account.calls >= policy.dailyCallsPerAccount ? "account_calls" :
    account.reservedMicroUsd + nextCost > policy.accountMicroUsd ? "account_estimate" :
    bucket.reservedMicroUsd + nextCost > policy.globalMicroUsd ? "platform_estimate" : null;
  return {
    day: bucket.day, timezone: policy.timezone,
    nextResetAt: new Date(new Date(`${bucket.day}T00:00:00+07:00`).getTime() + 86_400_000).toISOString(),
    callsUsed: account.calls, callsLimit: policy.dailyCallsPerAccount,
    reservedMicroUsd: account.reservedMicroUsd, accountLimitMicroUsd: policy.accountMicroUsd,
    globalLimitMicroUsd: policy.globalMicroUsd, available: reason === null, reason,
  };
}

async function currentDay(execute: Execute) {
  const { rows } = await execute(sql`SELECT clock_timestamp() AS budget_now`);
  return workroomBudgetDay(new Date(rows[0]?.budget_now));
}

/** Read-only: no counter initialization or permission to call a model. */
export async function readWorkroomBudget(execute: Execute, ownerId: string): Promise<WorkroomBudgetSnapshot> {
  try {
    const day = await currentDay(execute);
    const { rows } = await execute(sql`SELECT value FROM system_config WHERE key=${workroomBudgetKey(day)}`);
    return summary(parseBucket(rows[0]?.value, day), ownerId);
  } catch { throw unavailable(); }
}

/** Aggregate-only administrative view: never return account keys, sources or execution contents. */
export async function readWorkroomBudgetAggregate(execute: Execute): Promise<Omit<WorkroomBudgetMonitor, "rejections">> {
  try {
    const day = await currentDay(execute);
    const { rows } = await execute(sql`SELECT value FROM system_config WHERE key=${workroomBudgetKey(day)}`);
    const bucket = parseBucket(rows[0]?.value, day);
    return {
      day, timezone: policy.timezone, nextResetAt: summary(bucket, "").nextResetAt,
      model: analysis.model, pricingVersion: policy.version, pricingCheckedOn: policy.pricingCheckedOn,
      callsReserved: bucket.calls, activeAccounts: Object.values(bucket.accounts).filter(account => account.calls > 0).length,
      reservedMicroUsd: bucket.reservedMicroUsd, remainingMicroUsd: Math.max(0, policy.globalMicroUsd - bucket.reservedMicroUsd),
      globalLimitMicroUsd: policy.globalMicroUsd, accountCallLimit: policy.dailyCallsPerAccount,
      accountLimitMicroUsd: policy.accountMicroUsd,
    };
  } catch { throw unavailable(); }
}

/** Caller must be in the same transaction as the execution reservation. Never fire-and-forget. */
export async function reserveWorkroomBudget(execute: Execute, ownerId: string, estimatedMicroUsd: number) {
  const maximum = Math.ceil((analysis.maxInputChars * 4 + policy.framingTokenAllowance) * policy.inputUsdPerMillion +
    analysis.maxOutputTokens * policy.outputUsdPerMillion);
  if (!Number.isSafeInteger(estimatedMicroUsd) || estimatedMicroUsd < minimumWorkroomReservation() || estimatedMicroUsd > maximum) {
    throw unavailable();
  }
  try {
    // One cross-process lock for the pilot. Acquire before choosing the date, including at midnight.
    // Every caller already holds its parent Workroom lock; nothing takes these locks in reverse order.
    await execute(sql`SELECT pg_advisory_xact_lock(hashtext('gustafta:workroom-analysis-budget'), 1)`);
    const day = await currentDay(execute);
    const key = workroomBudgetKey(day);
    const { rows } = await execute(sql`SELECT value FROM system_config WHERE key=${key} FOR UPDATE`);
    const bucket = parseBucket(rows[0]?.value, day);
    const status = summary(bucket, ownerId, estimatedMicroUsd);
    if (!status.available) {
      throw new WorkroomBudgetLimitError(day, status.reason!);
    }
    const hash = accountKey(ownerId);
    const account = bucket.accounts[hash] || { calls: 0, reservedMicroUsd: 0 };
    bucket.accounts[hash] = { calls: account.calls + 1, reservedMicroUsd: account.reservedMicroUsd + estimatedMicroUsd };
    bucket.calls++;
    bucket.reservedMicroUsd += estimatedMicroUsd;
    await execute(sql`INSERT INTO system_config (key,value,updated_at) VALUES (${key},${JSON.stringify(bucket)},clock_timestamp())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`);
    return { day, estimatedMicroUsd, pricingVersion: policy.version };
  } catch (error) {
    if (error instanceof WorkroomTransitionError) throw error;
    throw unavailable();
  }
}
