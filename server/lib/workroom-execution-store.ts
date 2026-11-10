import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { workrooms, workroomGates, workroomLogs } from "@shared/schema";
import { WORKROOM_ANALYSIS_POLICY as policy } from "@shared/workroom-analysis-policy";
import { WorkroomTransitionError, type WorkroomReviewExpectation } from "@shared/workroom-transitions";
import { requireNotDeleting } from "./workroom-source-versions";
import { loadWorkroomSources, requireAvailableWorkroomSources } from "./workroom-sources";
import { requireWorkroomReview, reviewedWorkroomGates, reviewedWorkroomStatus, workroomReviewToken } from "./workroom-review";
import { reserveWorkroomBudget, WorkroomBudgetLimitError } from "./workroom-analysis-budget";
import { recordWorkroomBudgetRejection } from "./workroom-budget-monitor";
import {
  ANALYSIS_EXECUTION_LOG, analysisLedger, publicAnalysisExecution, requireAnalysisExecutionId,
  type AnalysisExecutionRecord,
} from "./workroom-execution-ledger";

export async function claimWorkroomAnalysis(
  id: number, ownerId: string, executionId: string, currentStage: number, expected: WorkroomReviewExpectation,
  estimatedMicroUsd: number,
) {
  executionId = requireAnalysisExecutionId(executionId);
  try { return await db.transaction(async tx => {
    const [room] = await tx.select().from(workrooms)
      .where(and(eq(workrooms.id, id), eq(workrooms.userId, ownerId))).for("update");
    if (!room) throw new WorkroomTransitionError("Workroom tidak ditemukan.", 404);
    const logs = await tx.select().from(workroomLogs).where(eq(workroomLogs.workroomId, id));
    requireNotDeleting(logs);
    const records = analysisLedger(logs);
    if (records.some(entry => entry.record.id === executionId)) {
      throw new WorkroomTransitionError("Identitas eksekusi sudah dipakai. Periksa status; jangan mengulang panggilan model.");
    }
    if (records.some(entry => entry.record.ownerId === ownerId &&
        ["running", "uncertain"].includes(entry.record.status))) {
      throw new WorkroomTransitionError("Eksekusi sebelumnya belum tuntas. Periksa status dan tinjau ketidakpastiannya dahulu.");
    }
    const sources = await loadWorkroomSources(query => tx.execute(query), ownerId, room.context);
    requireAvailableWorkroomSources(sources);
    const token = workroomReviewToken(room, logs, sources);
    requireWorkroomReview(token, expected);
    const gates = await tx.select().from(workroomGates).where(eq(workroomGates.workroomId, id));
    if (room.currentStage !== currentStage ||
        reviewedWorkroomStatus(room, reviewedWorkroomGates(gates, logs, token, ownerId), logs, token, sources) !== "active") {
      throw new WorkroomTransitionError("Tahap atau status Workroom berubah. Tinjau ulang sebelum menganalisis.");
    }
    const budget = await reserveWorkroomBudget(query => tx.execute(query), ownerId, estimatedMicroUsd);
    const now = Date.now();
    const record: AnalysisExecutionRecord = {
      schemaVersion: 1, id: executionId, ownerId, status: "running", currentStage, ...token,
      startedAt: new Date(now).toISOString(), expiresAt: new Date(now + policy.executionLeaseMs).toISOString(),
      provider: policy.provider, model: policy.model, policyVersion: policy.version,
      budget,
    };
    await tx.insert(workroomLogs).values({ workroomId: id, type: ANALYSIS_EXECUTION_LOG,
      content: "Identitas analisis dicadangkan sebelum panggilan model.", meta: record });
    return publicAnalysisExecution(record);
  }); } catch (error) {
    if (error instanceof WorkroomBudgetLimitError) {
      // The reservation transaction has rolled back; telemetry must commit independently.
      await db.transaction(tx => recordWorkroomBudgetRejection(query => tx.execute(query), error));
    }
    throw error;
  }
}

/** Trusted worker settlement only. Never replace a committed success or a manual acknowledgment. */
export async function settleWorkroomAnalysis(
  id: number, ownerId: string, executionId: string, status: "failed" | "uncertain",
) {
  return db.transaction(async tx => {
    const [room] = await tx.select().from(workrooms).where(eq(workrooms.id, id)).for("update");
    if (!room) return;
    const logs = await tx.select().from(workroomLogs).where(eq(workroomLogs.workroomId, id));
    const entry = analysisLedger(logs).find(item => item.record.id === executionId && item.record.ownerId === ownerId);
    if (!entry || entry.record.status !== "running") return;
    const record = { ...entry.record, status: Date.parse(entry.record.expiresAt) <= Date.now() ? "uncertain" as const : status,
      finishedAt: new Date().toISOString() };
    await tx.update(workroomLogs).set({ meta: record }).where(eq(workroomLogs.id, entry.logId));
  });
}

export async function acknowledgeWorkroomAnalysis(id: number, ownerId: string, executionId: string) {
  executionId = requireAnalysisExecutionId(executionId);
  return db.transaction(async tx => {
    const [room] = await tx.select().from(workrooms)
      .where(and(eq(workrooms.id, id), eq(workrooms.userId, ownerId))).for("update");
    if (!room) throw new WorkroomTransitionError("Workroom tidak ditemukan.", 404);
    const logs = await tx.select().from(workroomLogs).where(eq(workroomLogs.workroomId, id));
    requireNotDeleting(logs);
    const entry = analysisLedger(logs).find(item => item.record.id === executionId && item.record.ownerId === ownerId);
    if (!entry) throw new WorkroomTransitionError("Eksekusi tidak ditemukan.", 404);
    if (entry.record.status === "acknowledged") return publicAnalysisExecution(entry.record);
    if (publicAnalysisExecution(entry.record).status !== "uncertain") {
      throw new WorkroomTransitionError("Eksekusi belum memerlukan pengakuan ketidakpastian.");
    }
    const record: AnalysisExecutionRecord = { ...entry.record, status: "acknowledged", acknowledgedAt: new Date().toISOString() };
    await tx.update(workroomLogs).set({ meta: record }).where(eq(workroomLogs.id, entry.logId));
    return publicAnalysisExecution(record);
  });
}
