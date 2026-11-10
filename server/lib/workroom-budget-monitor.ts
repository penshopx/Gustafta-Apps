import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { WorkroomBudgetMonitor } from "@shared/workroom-budget-monitor";
import { WorkroomTransitionError } from "@shared/workroom-transitions";
import { readWorkroomBudgetAggregate, type WorkroomBudgetLimitError } from "./workroom-analysis-budget";

type Execute = (query: SQL) => Promise<{ rows: any[] }>;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const schema = z.object({
  schemaVersion: z.literal(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountCalls: integer, accountEstimate: integer, platformEstimate: integer,
  firstRecordedAt: z.string().datetime(), lastRecordedAt: z.string().datetime(),
}).strict().refine(value => Date.parse(value.firstRecordedAt) <= Date.parse(value.lastRecordedAt));
type Rejections = z.infer<typeof schema>;
export const workroomRejectionKey = (day: string) => `workroom_analysis_rejections:v1:${day}`;
const unavailable = () => new WorkroomTransitionError("Statistik penolakan Workroom belum dapat diverifikasi. Model tidak dipanggil.", 503);
function parse(value: string | undefined, day: string): Rejections | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    if (parsed.success && parsed.data.day === day &&
        Number.isSafeInteger(parsed.data.accountCalls + parsed.data.accountEstimate + parsed.data.platformEstimate)) return parsed.data;
  } catch { /* Do not expose database contents. */ }
  throw unavailable();
}

/** Called in a NEW transaction after the denied claim rolled back. No parent lock or quota mutation. */
export async function recordWorkroomBudgetRejection(execute: Execute, denial: WorkroomBudgetLimitError): Promise<void> {
  try {
    await execute(sql`SELECT pg_advisory_xact_lock(hashtext('gustafta:workroom-analysis-rejections'), 1)`);
    const key = workroomRejectionKey(denial.day);
    const { rows } = await execute(sql`SELECT value FROM system_config WHERE key=${key} FOR UPDATE`);
    const clock = await execute(sql`SELECT clock_timestamp() AS rejection_now`);
    const now = new Date(clock.rows[0]?.rejection_now).toISOString();
    const record = parse(rows[0]?.value, denial.day) || {
      schemaVersion: 1 as const, day: denial.day, accountCalls: 0, accountEstimate: 0, platformEstimate: 0,
      firstRecordedAt: now, lastRecordedAt: now,
    };
    const field = { account_calls: "accountCalls", account_estimate: "accountEstimate", platform_estimate: "platformEstimate" } as const;
    record[field[denial.reason]]++;
    record.lastRecordedAt = new Date(Math.max(Date.parse(record.lastRecordedAt), Date.parse(now))).toISOString();
    if (!schema.safeParse(record).success ||
        !Number.isSafeInteger(record.accountCalls + record.accountEstimate + record.platformEstimate)) throw unavailable();
    await execute(sql`INSERT INTO system_config (key,value,updated_at) VALUES (${key},${JSON.stringify(record)},clock_timestamp())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`);
  } catch { throw unavailable(); }
}

/** SELECT-only. Does not initialize rows, acknowledge jobs, refund quota or invoke providers. */
export async function readWorkroomBudgetMonitor(execute: Execute): Promise<WorkroomBudgetMonitor> {
  const aggregate = await readWorkroomBudgetAggregate(execute);
  try {
    const { rows } = await execute(sql`SELECT value FROM system_config WHERE key=${workroomRejectionKey(aggregate.day)}`);
    const record = parse(rows[0]?.value, aggregate.day);
    const accountCalls = record?.accountCalls ?? 0, accountEstimate = record?.accountEstimate ?? 0,
      platformEstimate = record?.platformEstimate ?? 0;
    return { ...aggregate, rejections: {
      accountCalls, accountEstimate, platformEstimate, total: accountCalls + accountEstimate + platformEstimate,
      firstRecordedAt: record?.firstRecordedAt ?? null, lastRecordedAt: record?.lastRecordedAt ?? null,
    } };
  } catch { throw unavailable(); }
}
