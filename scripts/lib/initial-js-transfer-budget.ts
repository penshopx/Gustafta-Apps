import type { AssetGroup } from "./initial-js-transfer";

export const TRANSFER_GROUPS = ["localInitial", "localRuntime", "thirdParty"] as const;
export interface TransferBudget {
  schemaVersion: 1;
  profile: string;
  browserVersion: string;
  observationMs: number;
  limits: Record<AssetGroup | "total", number>;
}

export function parseTransferBudget(value: unknown): TransferBudget {
  const budget = value as TransferBudget;
  if (!budget || budget.schemaVersion !== 1 || typeof budget.profile !== "string" ||
      !budget.profile || typeof budget.browserVersion !== "string" || !budget.browserVersion ||
      !Number.isSafeInteger(budget.observationMs) || budget.observationMs < 0 ||
      budget.observationMs > 60_000 ||
      !budget.limits || [...TRANSFER_GROUPS, "total" as const].some((key) =>
        !Number.isSafeInteger(budget.limits[key]) || budget.limits[key] < 0)) {
    throw new Error("Invalid initial JS transfer budget");
  }
  return budget;
}

interface Measurement {
  valid: boolean;
  problems: string[];
  browserVersion: string;
  observationMs: number;
  total: { transferBytes: number };
  groups: Record<AssetGroup, { transferBytes: number }>;
}

/** Never compare partial/invalid results with limits, even when bytes exceed them. */
export function evaluateTransferBudget(report: Measurement, budget: TransferBudget, profile?: string) {
  const problems = [...report.problems];
  if (report.browserVersion.split("/").at(-1) !== budget.browserVersion) problems.push("Browser version differs from baseline");
  if (report.observationMs !== budget.observationMs) problems.push("Observation window differs from baseline");
  if (profile !== budget.profile) problems.push("Server profile differs from baseline");
  if (!report.valid || problems.length) {
    return { outcome: "measurement-error" as const, exitCode: 2, problems, violations: [] };
  }
  const violations = [...TRANSFER_GROUPS, "total" as const].flatMap((group) => {
    const actual = group === "total" ? report.total.transferBytes : report.groups[group].transferBytes;
    return actual > budget.limits[group] ? [{ group, actual, limit: budget.limits[group] }] : [];
  });
  return {
    outcome: violations.length ? "budget-exceeded" as const : "passed" as const,
    exitCode: violations.length ? 1 : 0,
    problems: [],
    violations,
  };
}
