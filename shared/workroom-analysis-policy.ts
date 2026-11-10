import type { WorkroomBudgetReservation } from "./workroom-budget-policy";

/** Per-call pilot limits. Separate daily budget does not change subscription/chat quota. */
export const WORKROOM_ANALYSIS_POLICY = {
  version: "workroom-analysis-v2",
  provider: "openai",
  model: "gpt-4o",
  timeoutMs: 45_000,
  maxInputChars: 16_000,
  maxOutputChars: 24_000,
  maxOutputTokens: 1500,
  executionLeaseMs: 120_000,
} as const;

export interface WorkroomAnalysisExecution {
  id: string;
  status: "running" | "succeeded" | "failed" | "uncertain" | "acknowledged";
  startedAt: string;
  expiresAt: string;
  finishedAt?: string;
  acknowledgedAt?: string;
  resultLogId?: number;
  currentStage: number;
  reviewRevision: number;
  reviewFingerprint: string;
  provider: string;
  model: string;
  policyVersion: string;
  budget?: WorkroomBudgetReservation;
}
