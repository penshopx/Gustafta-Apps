export const CASHFLOW_AGENT_SLUGS = new Set([
  "si-kas-claw",
  "si-berkas-claw",
  "si-pasal-claw",
  "si-lapangan-claw",
  "si-strategi-claw",
  "si-pajak-claw",
  "si-darurat-claw",
  "cashflow-pbj-multiclaw",
]);

export type CashflowAccessResult =
  | { ok: true }
  | {
      ok: false;
      status: 403;
      error: string;
      reason:
        | "cashflow_subscription_required"
        | "cashflow_subscription_invalid"
        | "cashflow_subscription_expired";
    };

export async function checkCashflowAgentAccess(input: {
  agentId: string | number;
  agentSlug: string | null | undefined;
  accessToken: string | null | undefined;
  getSubscriptionByToken: (token: string) => Promise<{
    id: string | number;
    agentId: string | number;
    status: string | null;
    endDate: string | Date | null;
  } | undefined>;
  markExpired?: (subscriptionId: string | number) => Promise<unknown>;
  now?: Date;
}): Promise<CashflowAccessResult> {
  if (!input.agentSlug || !CASHFLOW_AGENT_SLUGS.has(input.agentSlug)) {
    return { ok: true };
  }
  const token = String(input.accessToken || "").trim();
  if (!token) {
    return {
      ok: false,
      status: 403,
      error: "Akses paket CASHFLOW-PBJ diperlukan.",
      reason: "cashflow_subscription_required",
    };
  }
  const subscription = await input.getSubscriptionByToken(token);
  if (
    !subscription ||
    subscription.status !== "active" ||
    String(subscription.agentId) !== String(input.agentId)
  ) {
    return {
      ok: false,
      status: 403,
      error: "Langganan CASHFLOW-PBJ tidak aktif untuk AI Spesialis ini.",
      reason: "cashflow_subscription_invalid",
    };
  }
  const now = input.now ?? new Date();
  if (subscription.endDate && new Date(subscription.endDate) <= now) {
    await input.markExpired?.(subscription.id);
    return {
      ok: false,
      status: 403,
      error: "Langganan CASHFLOW-PBJ sudah berakhir.",
      reason: "cashflow_subscription_expired",
    };
  }
  return { ok: true };
}