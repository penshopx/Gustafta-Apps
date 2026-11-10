import { createHash } from "node:crypto";
import type { Message } from "../../shared/schema";

/**
 * A caller-chosen conversation name is not an ownership credential.
 * Keep the principal in a server-derived namespace, including on model reads.
 * Legacy, unowned rows deliberately do not match any namespace.
 */
export async function publicChatScope(req: any, agent: { isPublic?: boolean }) {
  if (!agent.isPublic) return undefined;
  const userId = req.session?.emailUser?.id
    || (req.isAuthenticated?.() ? req.user?.claims?.sub || req.user?.id : undefined);
  let principal: string;
  if (userId) {
    principal = `user:${userId}`;
  } else {
    if (!req.session || !req.sessionID) throw new Error("Public chat requires a server session");
    // saveUninitialized=false: persist before SSE flushes its response headers.
    if (!req.session.publicChatEstablished) {
      req.session.publicChatEstablished = true;
      await new Promise<void>((resolve, reject) => req.session.save((error: unknown) =>
        error ? reject(error) : resolve()));
    }
    principal = `visitor:${req.sessionID}`;
  }
  const prefix = `public-v1.${createHash("sha256").update(principal).digest("hex")}.`;
  return {
    prefix,
    sessionId: (id?: string) => prefix + Buffer.from(id || "").toString("base64url"),
    // Preserve the external conversation name; never ask clients to store the namespace.
    externalMessages: (messages: Message[]) => messages.map(message => ({
      ...message,
      sessionId: Buffer.from((message.sessionId || "").slice(prefix.length), "base64url").toString(),
    })),
  };
}
