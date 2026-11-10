import { createHash } from "node:crypto";
import { createLegacyMemoryRecovery } from "../../../server/lib/legacy-memory-recovery";

// No pg client, environment lookup or application storage import is permitted here.
export function createRecoveryFixture() {
  const memories = Array.from({ length: 102 }, (_, i) => ({
    id: i + 3, agent_id: 7, user_id: null as string | null,
    createdAt: "2026-01-01T00:00:00Z",
  }));
  type ReviewRow = {
    id: number; memory_id: number; proposed_user_id: string; submitted_by: string;
    evidence_ref: string; evidence_sha256: string; decision: string;
    reviewed_by: string | null; rationale: string | null;
    evidence_format_version: number;
    reason_code: string | null;
  };
  const reviews: ReviewRow[] = Array.from({ length: 102 }, (_, i) => ({
    id: i + 1, memory_id: 1000 + i, proposed_user_id: "fixture-owner",
    submitted_by: "admin-a", evidence_ref: "fixture:historical-record",
    evidence_sha256: "a".repeat(64), decision: "rejected",
    reviewed_by: "admin-b", rationale: "Fixture archive was insufficient",
    evidence_format_version: 0, reason_code: null,
  }));
  const originals = new Map([3, 4].map(id => [id, Buffer.from(JSON.stringify({
    type: "authenticated_memory_creation", memoryId: id, agentId: 7,
    authenticatedUserId: "fixture-owner",
  }))]));
  const evidence = (id: number) => ({
    memoryId: id, agentId: 7, proposedUserId: "fixture-owner",
    evidenceRef: `archive:v1:00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    evidenceSha256: createHash("sha256").update(originals.get(id)!).digest("hex"),
    evidenceType: "authenticated_creation_record",
    attestation: "Record independently links memoryId, agentId and authenticated userId",
  });
  const archiveReads: string[] = [];
  const audit: Array<{ method: string; path: string; actor: string | null; status: number }> = [];
  let snapshot: { memories: typeof memories; reviews: typeof reviews } | null = null;
  const query = async (sql: string, args: any[] = []): Promise<any> => {
    if (sql === "BEGIN") {
      snapshot = structuredClone({ memories, reviews });
    } else if (sql === "ROLLBACK") {
      if (snapshot) {
        memories.splice(0, memories.length, ...snapshot.memories);
        reviews.splice(0, reviews.length, ...snapshot.reviews);
      }
      snapshot = null;
    } else if (sql === "COMMIT") {
      snapshot = null;
    } else if (sql.includes("LEFT JOIN user_memories")) {
      return { rows: reviews.filter(r => r.id > args[0]).slice(0, 100).map(r => ({
        id: r.id, memoryId: r.memory_id,
        agentId: memories.find(m => m.id === r.memory_id)?.agent_id ?? null,
        proposedUserId: r.proposed_user_id, evidenceRef: r.evidence_format_version === 1 ? r.evidence_ref : null,
        evidenceFormatVersion: r.evidence_format_version,
        evidenceSha256: r.evidence_sha256, submittedBy: r.submitted_by,
        submittedAt: "2026-01-01T00:00:00Z", reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_by ? "2026-01-02T00:00:00Z" : null,
        decision: r.decision, rationale: r.reason_code,
      })) };
    } else if (sql.includes("FROM user_memories WHERE id = $1 AND user_id IS NULL FOR UPDATE")) {
      return { rows: memories.filter(m => m.id === args[0] && m.user_id === null)
        .map(m => ({ id: m.id, agent_id: m.agent_id })) };
    } else if (sql.includes("FROM users WHERE id = $1")) {
      return { rows: args[0] === "fixture-owner" ? [{ id: args[0] }] : [] };
    } else if (sql.includes("FROM legacy_memory_reviews WHERE memory_id = $1 AND decision IN")) {
      return { rows: reviews.filter(r => r.memory_id === args[0] && ["pending", "approved"].includes(r.decision)) };
    } else if (sql.includes("INSERT INTO legacy_memory_reviews")) {
      const id = Math.max(0, ...reviews.map(r => r.id)) + 1;
      reviews.push({
        id, memory_id: args[0], proposed_user_id: args[1], evidence_ref: args[2],
        evidence_sha256: args[3], submitted_by: args[4], decision: "pending",
        reviewed_by: null, rationale: null,
        evidence_format_version: 1, reason_code: null,
      });
      return { rows: [{ id }] };
    } else if (sql.includes("SELECT memory_id FROM legacy_memory_reviews WHERE id = $1")) {
      return { rows: reviews.filter(r => r.id === args[0]).map(r => ({ memory_id: r.memory_id })) };
    } else if (sql.includes("FROM legacy_memory_reviews WHERE id = $1 FOR UPDATE")) {
      return { rows: reviews.filter(r => r.id === args[0]) };
    } else if (sql.includes("UPDATE user_memories SET user_id")) {
      const memory = memories.find(m => m.id === args[1] && m.user_id === null);
      if (!memory) return { rows: [] };
      memory.user_id = args[0];
      return { rows: [{ id: memory.id }] };
    } else if (sql.includes("UPDATE legacy_memory_reviews")) {
      const review = reviews.find(r => r.id === args[3] && r.decision === "pending");
      if (review) Object.assign(review, { decision: args[0], reviewed_by: args[1], reason_code: args[2] });
    } else {
      throw new Error(`Unexpected fixture SQL: ${sql}`);
    }
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const recovery = createLegacyMemoryRecovery(pool as any, {
    async readOriginalRecord(ref) {
      archiveReads.push(ref);
      const id = Number(ref.split("-").at(-1));
      return ref === evidence(id).evidenceRef ? originals.get(id) ?? null : null;
    },
  });
  const storage = {
    async listUnownedMemories(after: number) {
      return memories.filter(m => m.user_id === null && m.id > after).slice(0, 100)
        .map(m => ({ id: m.id, agentId: m.agent_id, createdAt: m.createdAt }));
    },
  };
  return { recovery, storage, memories, reviews, evidence, archiveReads, audit };
}
