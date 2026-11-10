export interface WorkroomGateState {
  id: number;
  stageKey: string;
  status: string;
}

export interface WorkroomReviewToken {
  reviewRevision: number;
  reviewFingerprint: string;
}

export interface WorkroomReviewExpectation {
  expectedReviewRevision?: unknown;
  expectedReviewFingerprint?: unknown;
}

export interface WorkroomSourceState {
  fileId: string;
  name?: string;
  availability: "available" | "unavailable" | "verification_failed";
  revision: string;
}

export interface WorkroomSourceVersion extends WorkroomReviewToken {
  versionId: string;
  createdAt: string;
  files: { fileId: string; name: string; mimeType: string; sizeBytes: number; sha256: string }[];
}

export class WorkroomTransitionError extends Error {
  constructor(message: string, public readonly statusCode: number = 409) {
    super(message);
    this.name = "WorkroomTransitionError";
  }
}

/** A gate protects entry to, and departure from, its stage. Blank/unknown keys
 * protect all forward progress (legacy gates must not silently be ignored). */
export function blockingWorkroomGates(
  stages: unknown,
  currentStage: number,
  gates: WorkroomGateState[],
  targetStage: number | null,
): WorkroomGateState[] {
  if (targetStage !== null && targetStage <= currentStage) return [];
  const keys = Array.isArray(stages) ? stages.map(s => s?.key) : [];
  return gates.filter(gate => {
    if (gate.status === "approved") return false;
    if (targetStage === null) return true;
    const index = keys.indexOf(gate.stageKey);
    return !gate.stageKey || index < 0 || index <= targetStage;
  });
}

export function prepareWorkroomPatch(
  room: { stages: unknown; currentStage: number; status: string },
  gates: WorkroomGateState[],
  data: Record<string, any>,
): Record<string, any> {
  const patch = { ...data };
  // Stages are derived from the freshly locked parent, never a stale route read.
  delete patch.stages;
  if (patch.status !== undefined && !["active", "done", "archived"].includes(patch.status)) {
    throw new WorkroomTransitionError("Status Workroom tidak valid.", 400);
  }
  if (patch.currentStage !== undefined) {
    const stages = room.stages;
    if (!Array.isArray(stages) || !Number.isInteger(patch.currentStage) ||
        patch.currentStage < 0 || patch.currentStage >= stages.length) {
      throw new WorkroomTransitionError("Tahap Workroom tidak valid.", 400);
    }
    const blocked = blockingWorkroomGates(stages, room.currentStage, gates, patch.currentStage);
    if (blocked.length) {
      throw new WorkroomTransitionError("Selesaikan persetujuan gerbang manusia sebelum melanjutkan tahap.");
    }
    patch.stages = stages.map((stage, index) => ({
      ...stage,
      status: index < patch.currentStage ? "done" : index === patch.currentStage ? "active" : "pending",
    }));
    if (room.status === "done" && patch.currentStage !== room.currentStage && patch.status === undefined) {
      patch.status = "active";
    }
  }
  if (patch.status === "done" &&
      blockingWorkroomGates(room.stages, room.currentStage, gates, null).length) {
    throw new WorkroomTransitionError("Semua gerbang manusia harus disetujui sebelum Workroom dinyatakan selesai.");
  }
  return patch;
}

export function validateWorkroomGateStage(stages: unknown, key: unknown): void {
  if (typeof key !== "string" || (key !== "" &&
      (!Array.isArray(stages) || !stages.some(s => s?.key === key)))) {
    throw new WorkroomTransitionError("Tahap gerbang tidak ditemukan pada Workroom ini.", 400);
  }
}
