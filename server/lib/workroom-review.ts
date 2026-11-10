import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  WorkroomTransitionError, type WorkroomReviewExpectation, type WorkroomReviewToken, type WorkroomSourceState,
} from "@shared/workroom-transitions";

interface ReviewLog { id: number; type: string; content: string; meta: unknown; }
interface ReviewRoom { userId: string; title: string; domain: string; context: unknown; stages: unknown; }

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function materialWorkroomLog(type: string): boolean {
  return type === "deliverable" || type === "change";
}

/** Material log IDs provide integer, ABA-safe revisions without a schema change.
 * The digest additionally detects legacy/out-of-band edits with no revision log. */
export function workroomReviewToken(room: ReviewRoom, logs: ReviewLog[], sources: WorkroomSourceState[] = []): WorkroomReviewToken {
  const material = logs.filter(log => materialWorkroomLog(log.type));
  const reviewRevision = material.reduce((max, log) => Math.max(max, log.id), 0);
  const value = {
    title: room.title, domain: room.domain, context: room.context,
    stages: Array.isArray(room.stages) ? room.stages.map(s => ({ key: s?.key, label: s?.label })) : room.stages,
    deliverables: material.filter(log => log.type === "deliverable")
      .sort((a, b) => a.id - b.id).map(log => ({ id: log.id, content: log.content, meta: log.meta })),
    ...(sources.length ? { sources: sources.map(({ fileId, revision, availability }) => ({ fileId, revision, availability })) } : {}),
  };
  return {
    reviewRevision,
    reviewFingerprint: createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"),
  };
}

export function requireWorkroomReview(
  current: WorkroomReviewToken, expected?: WorkroomReviewExpectation,
): void {
  if (!expected || !Number.isSafeInteger(expected.expectedReviewRevision) ||
      expected.expectedReviewRevision !== current.reviewRevision ||
      expected.expectedReviewFingerprint !== current.reviewFingerprint) {
    throw new WorkroomTransitionError("Versi tinjauan sudah berubah atau belum tersedia. Muat ulang data dan tinjau kembali sebelum menyimpan.");
  }
}

export function materialWorkroomPatch(room: { title: string; context: unknown }, data: Record<string, any>): boolean {
  return (data.title !== undefined && data.title !== room.title) ||
    (data.context !== undefined && !isDeepStrictEqual(canonical(data.context), canonical(room.context)));
}

/** Only decision logs inserted by the decision transaction are authoritative.
 * Generic journal entries cannot manufacture an approval. */
export function reviewedWorkroomGates<G extends { id: number; status: string }>(
  gates: G[], logs: ReviewLog[], token: WorkroomReviewToken, ownerId: string,
): G[] {
  return gates.map(gate => {
    if (gate.status !== "approved") return gate;
    const decision = logs.filter(log => {
      const meta = log.meta as any;
      return log.type === "decision" && meta?.workroomGateDecision === true && meta.gateId === gate.id;
    }).sort((a, b) => b.id - a.id)[0];
    const meta = decision?.meta as any;
    if (meta?.status === "approved" && meta.actorUserId === ownerId &&
        meta.reviewRevision === token.reviewRevision && meta.reviewFingerprint === token.reviewFingerprint) return gate;
    return { ...gate, status: "pending", decidedAt: null };
  });
}

/** Keep the rendered and execution-time view of a stale completion identical. */
export function reviewedWorkroomStatus(
  room: { status: string; userId: string }, gates: { status: string }[], logs: ReviewLog[],
  token: WorkroomReviewToken, sources: WorkroomSourceState[],
): string {
  const completion = logs.filter(log => (log.meta as any)?.workroomCompletion === true)
    .sort((a, b) => b.id - a.id)[0]?.meta as any;
  const staleCompletion = sources.length > 0 && (
    completion?.actorUserId !== room.userId || completion?.reviewRevision !== token.reviewRevision ||
    completion?.reviewFingerprint !== token.reviewFingerprint);
  const incomplete = sources.some(source => source.availability !== "available") ||
    gates.some(gate => gate.status !== "approved") || staleCompletion;
  return room.status === "done" && incomplete ? "active" : room.status;
}
