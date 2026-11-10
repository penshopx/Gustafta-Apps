import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { WorkroomBudgetLimitError } from "../server/lib/workroom-analysis-budget";
import { readWorkroomBudgetMonitor, recordWorkroomBudgetRejection, workroomRejectionKey } from "../server/lib/workroom-budget-monitor";

test("fresh day monitoring reports zero recorded without creating any rows", async () => {
  const statements: string[] = [];
  const dialect = new PgDialect();
  const data = await readWorkroomBudgetMonitor(async query => {
    statements.push(dialect.sqlToQuery(query).sql);
    return { rows: statements.length === 1 ? [{ budget_now: "2026-10-28T17:00:00Z" }] : [] };
  });
  assert.equal(data.day, "2026-10-29");
  assert.equal(data.callsReserved, 0);
  assert.equal(data.remainingMicroUsd, 10_000_000);
  assert.equal(data.rejections.total, 0);
  assert.equal(data.rejections.firstRecordedAt, null);
  assert.ok(statements.every(statement => /^SELECT\b/.test(statement)));
});

test("late rejection persistence belongs to the original decision day, not the following day", async () => {
  let count = 0, writtenKey: unknown, record: any;
  const dialect = new PgDialect();
  await recordWorkroomBudgetRejection(async query => {
    const statement = dialect.sqlToQuery(query);
    if (statement.sql.startsWith("INSERT")) {
      writtenKey = statement.params[0]; record = JSON.parse(statement.params[1] as string);
    }
    return { rows: ++count === 3 ? [{ rejection_now: "2026-10-28T17:00:01Z" }] : [] };
  }, new WorkroomBudgetLimitError("2026-10-28", "account_estimate"));
  assert.equal(writtenKey, workroomRejectionKey("2026-10-28"));
  assert.equal(record.day, "2026-10-28");
  assert.equal(record.accountEstimate, 1);
  assert.equal(record.firstRecordedAt, "2026-10-28T17:00:01.000Z");
});

test("broken monitoring counters never become a successful zero", async () => {
  let call = 0;
  await assert.rejects(readWorkroomBudgetMonitor(async () => ({
    rows: ++call === 1 ? [{ budget_now: "2026-10-28T01:00:00Z" }] :
      call === 2 ? [] : [{ value: "private-invalid-rejection-record" }],
  })), { statusCode: 503 });
});
