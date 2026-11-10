export interface WorkroomBudgetMonitor {
  day: string;
  timezone: "Asia/Jakarta";
  nextResetAt: string;
  model: string;
  pricingVersion: string;
  pricingCheckedOn: string;
  callsReserved: number;
  activeAccounts: number;
  reservedMicroUsd: number;
  remainingMicroUsd: number;
  globalLimitMicroUsd: number;
  accountCallLimit: number;
  accountLimitMicroUsd: number;
  rejections: {
    total: number;
    accountCalls: number;
    accountEstimate: number;
    platformEstimate: number;
    firstRecordedAt: string | null;
    lastRecordedAt: string | null;
  };
}
