/** Approved pilot policy. Only native Workroom analysis, not chat/subscription quota. */
export const WORKROOM_BUDGET_POLICY = {
  version: "workroom-budget-v1",
  dailyCallsPerAccount: 10,
  accountMicroUsd: 1_000_000,
  globalMicroUsd: 10_000_000,
  timezone: "Asia/Jakarta",
  pricedModel: "gpt-4o",
  // Standard text pricing, USD per million tokens. Cache discounts are ignored.
  inputUsdPerMillion: 2.5,
  outputUsdPerMillion: 10,
  pricingSource: "https://developers.openai.com/api/docs/models/gpt-4o",
  pricingCheckedOn: "2026-10-28",
  framingTokenAllowance: 1024,
} as const;

export interface WorkroomBudgetReservation {
  day: string;
  estimatedMicroUsd: number;
  pricingVersion: string;
}

export interface WorkroomBudgetSnapshot {
  day: string;
  nextResetAt: string;
  timezone: "Asia/Jakarta";
  callsUsed: number;
  callsLimit: number;
  reservedMicroUsd: number;
  accountLimitMicroUsd: number;
  globalLimitMicroUsd: number;
  available: boolean;
  reason: "account_calls" | "account_estimate" | "platform_estimate" | null;
}
