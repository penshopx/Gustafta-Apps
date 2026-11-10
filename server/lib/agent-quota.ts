type QuotaLockedStorage = {
  withAgentQuotaLock<T>(userId: string, fn: (txStorage: any) => Promise<T>): Promise<T>;
};

export type AgentQuotaDenial = {
  status: 403;
  body: Record<string, unknown>;
};

export type AgentQuotaResult<T> =
  | { allowed: true; value: T }
  | { allowed: false; denial: AgentQuotaDenial };

/**
 * Run any owner-scoped agent creation behind the same DB transaction lock as
 * single-agent and organization creation. The callback receives transaction-
 * scoped storage and must create all quota-consuming agents through it.
 */
export async function withAgentCreationQuota<T>(
  storage: QuotaLockedStorage,
  userId: string,
  requestedAgentCount: number,
  isAdmin: boolean,
  create: (txStorage: any) => Promise<T>,
): Promise<AgentQuotaResult<T>> {
  if (!Number.isInteger(requestedAgentCount) || requestedAgentCount < 1) {
    throw new Error("requestedAgentCount must be a positive integer");
  }
  return storage.withAgentQuotaLock(userId, async (txStorage) => {
    if (!isAdmin) {
      const subscription = await txStorage.getActiveSubscription(userId);
      if (!subscription) {
        return {
          allowed: false,
          denial: {
            status: 403,
            body: {
              error: "Aktifkan akun terlebih dahulu melalui Konsultasi Gustafta.",
              reason: "dialog_required",
              redirectUrl: "/konsultasi",
            },
          },
        };
      }
      if (subscription.status !== "active") {
        return {
          allowed: false,
          denial: {
            status: 403,
            body: {
              error: "Subscription expired",
              message: "Langganan Anda sudah habis. Silakan perpanjang untuk membuat chatbot baru.",
              code: "SUBSCRIPTION_EXPIRED",
            },
          },
        };
      }

      const currentAgentCount = await txStorage.countUserAgents(userId);
      const limit = subscription.chatbotLimit || 3;
      if (currentAgentCount + requestedAgentCount > limit) {
        return {
          allowed: false,
          denial: {
            status: 403,
            body: {
              error: "Chatbot limit reached",
              message: `Anda sudah mencapai batas ${limit} chatbot. Upgrade paket untuk menambah chatbot.`,
              code: "LIMIT_REACHED",
              currentCount: currentAgentCount,
              limit,
              requestedCount: requestedAgentCount,
            },
          },
        };
      }
    }

    return { allowed: true, value: await create(txStorage) };
  });
}

/** Match the single-agent creation route's ADMIN_USER_IDS quota exception. */
export function isAgentQuotaAdmin(userId: string): boolean {
  return (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .includes(userId);
}