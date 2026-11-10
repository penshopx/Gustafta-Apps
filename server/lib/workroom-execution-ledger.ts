import { z } from "zod";
import { WorkroomTransitionError, type WorkroomReviewExpectation } from "@shared/workroom-transitions";
import type { WorkroomAnalysisExecution } from "@shared/workroom-analysis-policy";
import { requireWorkroomReview } from "./workroom-review";

export const ANALYSIS_EXECUTION_LOG = "_workroom_ai_execution";
const recordSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), ownerId: z.string().min(1),
  status: z.enum(["running", "succeeded", "failed", "uncertain", "acknowledged"]),
  startedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(), acknowledgedAt: z.string().datetime().optional(),
  resultLogId: z.number().int().positive().optional(),
  currentStage: z.number().int().nonnegative(), reviewRevision: z.number().int().nonnegative(),
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.string().min(1), model: z.string().min(1), policyVersion: z.string().min(1),
  budget: z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), estimatedMicroUsd: z.number().int().positive(),
    pricingVersion: z.string().min(1),
  }).strict().optional(),
}).strict().refine(record => record.status !== "succeeded" || (!!record.resultLogId && !!record.finishedAt));
export type AnalysisExecutionRecord = z.infer<typeof recordSchema>;

export function requireAnalysisExecutionId(value: unknown): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new WorkroomTransitionError("Idempotency-Key UUID wajib disertakan untuk analisis.", 400);
  return parsed.data.toLowerCase();
}

export function analysisLedger(logs: { id: number; type: string; meta: unknown }[]) {
  return logs.filter(log => log.type === ANALYSIS_EXECUTION_LOG).map(log => {
    const parsed = recordSchema.safeParse(log.meta);
    if (!parsed.success) throw new WorkroomTransitionError("Catatan eksekusi tidak dapat diverifikasi. Analisis dikunci.", 503);
    return { logId: log.id, record: parsed.data };
  });
}

export function publicAnalysisExecution(record: AnalysisExecutionRecord): WorkroomAnalysisExecution {
  return {
    id: record.id, status: record.status === "running" && Date.parse(record.expiresAt) <= Date.now() ? "uncertain" : record.status,
    startedAt: record.startedAt, expiresAt: record.expiresAt, finishedAt: record.finishedAt,
    acknowledgedAt: record.acknowledgedAt, resultLogId: record.resultLogId,
    currentStage: record.currentStage, reviewRevision: record.reviewRevision, reviewFingerprint: record.reviewFingerprint,
    provider: record.provider, model: record.model, policyVersion: record.policyVersion,
    budget: record.budget,
  };
}

export function liveAnalysisClaim(
  logs: { id: number; type: string; meta: unknown }[], id: string, ownerId: string,
  currentStage: number, expected?: WorkroomReviewExpectation,
) {
  const claim = analysisLedger(logs).find(entry => entry.record.id === id && entry.record.ownerId === ownerId);
  if (!claim || claim.record.status !== "running" || Date.parse(claim.record.expiresAt) <= Date.now() ||
      claim.record.currentStage !== currentStage) {
    throw new WorkroomTransitionError("Eksekusi tidak lagi aktif. Hasil terlambat tidak dapat disimpan.");
  }
  requireWorkroomReview(claim.record, expected);
  return claim;
}
