import type { Pool, PoolClient } from "pg";
import { createHash, timingSafeEqual } from "node:crypto";
import { ARCHIVE_REFERENCE_PATTERN, validRecoveryReason } from "../../shared/legacy-memory-evidence";
import {
  CreationArchiveAccessDenied,
  creationArchiveTelemetry,
  type CreationArchiveTelemetry,
} from "./creation-archive-telemetry";

// The reviewer must consult an independently retained, trusted server record
// of the authenticated creation request. It must explicitly contain the memory
// row ID, agent ID and authenticated user ID. A session ID, agent ownership,
// matching content, user statement, or a newly written record is NOT proof.
// evidenceSha256 fingerprints the original record, not the memory content.
export type RecoverySubmission = {
  memoryId: number;
  agentId: number;
  proposedUserId: string;
  evidenceRef: string;
  evidenceSha256: string;
};

export class RecoveryConflict extends Error {}

// Implementations must read an independently retained, authenticated, immutable
// creation-event archive. The adapter in trusted-creation-archive.ts provides
// lookup/read plumbing, NOT the historical trust guarantee. Never implement
// this against user submissions, chat history, the mutable application DB, or
// a session-id lookup.
export type TrustedCreationArchive = {
  readOriginalRecord(evidenceRef: string): Promise<Uint8Array | null>;
};

type RecoveryClient = Pick<PoolClient, "query" | "release">;
type RecoveryPool = Pick<Pool, "connect" | "query">;

async function verifyOriginalRecord(
  archive: TrustedCreationArchive | undefined,
  evidenceRef: string,
  evidenceSha256: string,
  memoryId: number,
  agentId: number,
  userId: string,
  telemetry: CreationArchiveTelemetry,
) {
  if (!archive || !ARCHIVE_REFERENCE_PATTERN.test(evidenceRef) ||
      evidenceSha256.length !== 64 || !/^[a-f0-9]{64}$/i.test(evidenceSha256)) {
    throw new RecoveryConflict("Trusted creation record is unavailable or invalid");
  }
  let raw: Uint8Array | null;
  try {
    raw = await archive.readOriginalRecord(evidenceRef);
  } catch (error) {
    telemetry.record(error instanceof CreationArchiveAccessDenied ? "access_denied" : "service_unavailable");
    throw new RecoveryConflict("Trusted creation record is unavailable or invalid");
  }
  if (raw === null) {
    telemetry.record("lookup_missing");
    throw new RecoveryConflict("Trusted creation record is unavailable or invalid");
  }
  if (!(raw instanceof Uint8Array) || raw.byteLength === 0 || raw.byteLength > 1024 * 1024) {
    throw new RecoveryConflict("Trusted creation record is unavailable or invalid");
  }
  const digest = createHash("sha256").update(raw).digest();
  const expected = Buffer.from(evidenceSha256, "hex");
  if (!timingSafeEqual(digest, expected)) {
    telemetry.record("digest_changed");
    throw new RecoveryConflict("Trusted creation record does not match");
  }

  let record: unknown;
  try {
    record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new RecoveryConflict("Trusted creation record is incomplete");
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new RecoveryConflict("Trusted creation record is incomplete");
  }
  const event = record as Record<string, unknown>;
  if (event.type !== "authenticated_memory_creation" ||
      event.memoryId !== memoryId ||
      event.agentId !== agentId ||
      event.authenticatedUserId !== userId ||
      !Number.isSafeInteger(event.memoryId) ||
      !Number.isSafeInteger(event.agentId) ||
      typeof event.authenticatedUserId !== "string" || !event.authenticatedUserId) {
    throw new RecoveryConflict("Trusted creation record does not prove this owner");
  }
}

export async function ensureLegacyMemoryRecoverySchema(pool: RecoveryPool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS legacy_memory_reviews (
    id serial PRIMARY KEY,
    memory_id integer NOT NULL,
    proposed_user_id varchar(255) NOT NULL,
    evidence_ref text NOT NULL,
    evidence_sha256 varchar(64) NOT NULL,
    submitted_by varchar(255) NOT NULL,
    submitted_at timestamp NOT NULL DEFAULT now(),
    reviewed_by varchar(255),
    reviewed_at timestamp,
    decision text NOT NULL DEFAULT 'pending'
      CHECK (decision IN ('pending', 'approved', 'rejected')),
    rationale text,
    CONSTRAINT legacy_memory_reviews_distinct_reviewers
      CHECK (reviewed_by IS NULL OR reviewed_by <> submitted_by)
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS legacy_memory_reviews_memory_idx ON legacy_memory_reviews (memory_id, id)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS legacy_memory_reviews_one_pending_idx ON legacy_memory_reviews (memory_id) WHERE decision = 'pending'");
  // Additive migration: never classify old free text as safe by matching syntax.
  // Keep the old audit internally; do not copy it into a new archive or response.
  await pool.query(`ALTER TABLE legacy_memory_reviews
    ADD COLUMN IF NOT EXISTS evidence_format_version integer NOT NULL DEFAULT 0
      CHECK (evidence_format_version IN (0, 1) AND
        (evidence_format_version = 0 OR
          (length(evidence_ref) = 47 AND evidence_ref ~ '^archive:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))),
    ADD COLUMN IF NOT EXISTS reason_code text
      CHECK (reason_code IS NULL OR
        (decision = 'approved' AND reason_code = 'original_record_verified') OR
        (decision = 'rejected' AND reason_code IN
          ('record_unavailable', 'record_incomplete', 'record_mismatch', 'legacy_reference_requires_resubmission')))`);
}

export function createLegacyMemoryRecovery(
  pool: RecoveryPool,
  archive?: TrustedCreationArchive,
  telemetry: CreationArchiveTelemetry = creationArchiveTelemetry,
) {
  async function transaction<T>(action: (client: RecoveryClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    // Never return content or session IDs in an admin queue.
    async listReviews(afterId: number) {
      const result = await pool.query(
        `SELECT r.id, r.memory_id AS "memoryId", m.agent_id AS "agentId",
                r.proposed_user_id AS "proposedUserId",
                r.evidence_format_version AS "evidenceFormatVersion",
                CASE WHEN r.evidence_format_version = 1 THEN r.evidence_ref END AS "evidenceRef",
                r.evidence_sha256 AS "evidenceSha256",
                r.submitted_by AS "submittedBy", r.submitted_at AS "submittedAt",
                r.reviewed_by AS "reviewedBy", r.reviewed_at AS "reviewedAt",
                r.decision, r.reason_code AS rationale
           FROM legacy_memory_reviews r
           LEFT JOIN user_memories m ON m.id = r.memory_id
          WHERE r.id > $1 ORDER BY r.id LIMIT 100`,
        [afterId],
      );
      return result.rows.map(row => ({
        ...row,
        evidenceRef: row.evidenceFormatVersion === 1 && typeof row.evidenceRef === "string" &&
          ARCHIVE_REFERENCE_PATTERN.test(row.evidenceRef) ? row.evidenceRef : null,
        requiresResubmission: row.evidenceFormatVersion !== 1 ||
          typeof row.evidenceRef !== "string" || !ARCHIVE_REFERENCE_PATTERN.test(row.evidenceRef),
        rationale: validRecoveryReason(row.decision === "approved", row.rationale) ? row.rationale : null,
      }));
    },

    async submit(input: RecoverySubmission, submittedBy: string) {
      if (!submittedBy || !input.proposedUserId ||
          typeof input.evidenceRef !== "string" || !ARCHIVE_REFERENCE_PATTERN.test(input.evidenceRef) ||
          typeof input.evidenceSha256 !== "string" || input.evidenceSha256.length !== 64 ||
          !/^[a-f0-9]{64}$/i.test(input.evidenceSha256)) {
        throw new RecoveryConflict("Invalid submission");
      }
      return transaction(async (client) => {
        const memory = await client.query(
          "SELECT agent_id FROM user_memories WHERE id = $1 AND user_id IS NULL FOR UPDATE",
          [input.memoryId],
        );
        if (memory.rows.length !== 1 || memory.rows[0].agent_id !== input.agentId) {
          throw new RecoveryConflict("Memory is not an unowned row for this agent");
        }
        const owner = await client.query("SELECT id FROM users WHERE id = $1", [input.proposedUserId]);
        if (owner.rows.length !== 1) throw new RecoveryConflict("Proposed user does not exist");
        const previous = await client.query(
          "SELECT id FROM legacy_memory_reviews WHERE memory_id = $1 AND decision IN ('pending', 'approved') LIMIT 1",
          [input.memoryId],
        );
        if (previous.rows.length) throw new RecoveryConflict("Recovery already pending or approved");
        const result = await client.query(
          `INSERT INTO legacy_memory_reviews
             (memory_id, proposed_user_id, evidence_ref, evidence_sha256, submitted_by, evidence_format_version)
           VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
          [input.memoryId, input.proposedUserId, input.evidenceRef, input.evidenceSha256, submittedBy],
        );
        return result.rows[0].id as number;
      });
    },

    async decide(reviewId: number, reviewer: string, approve: boolean, rationale: string) {
      if (!reviewer || !validRecoveryReason(approve, rationale)) throw new RecoveryConflict("Invalid decision reason code");
      return transaction(async (client) => {
        // Resolve the immutable memory ID before taking locks in a consistent order.
        const lookup = await client.query(
          "SELECT memory_id FROM legacy_memory_reviews WHERE id = $1",
          [reviewId],
        );
        if (lookup.rows.length !== 1) throw new RecoveryConflict("Review not found");
        const memoryId = lookup.rows[0].memory_id;
        const memory = await client.query(
          "SELECT id, agent_id FROM user_memories WHERE id = $1 AND user_id IS NULL FOR UPDATE",
          [memoryId],
        );
        const review = await client.query(
          `SELECT proposed_user_id, submitted_by, decision, evidence_ref, evidence_sha256, evidence_format_version
             FROM legacy_memory_reviews WHERE id = $1 FOR UPDATE`,
          [reviewId],
        );
        if (review.rows.length !== 1 || review.rows[0].decision !== "pending" || !memory.rows.length) {
          throw new RecoveryConflict("Review is no longer pending or memory is already owned");
        }
        if (review.rows[0].submitted_by === reviewer) {
          throw new RecoveryConflict("A different superadmin must review the evidence");
        }
        if (approve) {
          if (review.rows[0].evidence_format_version !== 1) {
            throw new RecoveryConflict("Legacy evidence must be resubmitted with an archive reference");
          }
          const owner = await client.query("SELECT id FROM users WHERE id = $1", [review.rows[0].proposed_user_id]);
          if (owner.rows.length !== 1) throw new RecoveryConflict("Proposed user no longer exists");
          await verifyOriginalRecord(
            archive, review.rows[0].evidence_ref, review.rows[0].evidence_sha256,
            memoryId, memory.rows[0].agent_id, review.rows[0].proposed_user_id,
            telemetry,
          );
          const updated = await client.query(
            "UPDATE user_memories SET user_id = $1 WHERE id = $2 AND user_id IS NULL RETURNING id",
            [review.rows[0].proposed_user_id, memoryId],
          );
          if (updated.rows.length !== 1) throw new RecoveryConflict("Memory already owned");
        }
        await client.query(
          `UPDATE legacy_memory_reviews
              SET decision = $1, reviewed_by = $2, reviewed_at = now(), reason_code = $3
            WHERE id = $4 AND decision = 'pending'`,
          [approve ? "approved" : "rejected", reviewer, rationale, reviewId],
        );
        return { memoryId, decision: approve ? "approved" : "rejected" };
      });
    },
  };
}