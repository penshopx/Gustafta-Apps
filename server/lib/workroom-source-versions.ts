import { createHash, randomUUID } from "node:crypto";
import { Client } from "@replit/object-storage";
import { WorkroomTransitionError, type WorkroomReviewToken, type WorkroomSourceVersion } from "@shared/workroom-transitions";
import type { CapturedWorkroomSource } from "./workroom-sources";

export const VERSION_LOG = "_workroom_source_version";
export const DELETING_LOG = "_workroom_versions_deleting";
export const DELETION_RECEIPT_LOG = "_workroom_versions_deleted";
export interface VersionBlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
let client: Client | undefined;
const storeClient = () => client ??= new Client();
export const versionBlobStore: VersionBlobStore = {
  async put(key, bytes) {
    const result = await storeClient().uploadFromBytes(key, bytes);
    if (!result.ok) throw new Error("Version upload failed");
  },
  async read(key) {
    const result = await storeClient().downloadAsBytes(key);
    if (!result.ok || !result.value) throw new Error("Version read failed");
    return Buffer.from(result.value[0]);
  },
  async remove(key) {
    const result = await storeClient().delete(key, { ignoreNotFound: true });
    if (!result.ok) throw new Error("Version deletion failed");
  },
};
export type VersionManifest = Omit<WorkroomSourceVersion, "files"> & {
  ownerId: string; state: "preparing" | "ready" | "failed";
  files: (WorkroomSourceVersion["files"][number] & { key: string })[];
};
type Log = { id: number; type: string; meta: unknown };
export function versionManifests(logs: Log[], ownerId?: string): VersionManifest[] {
  return logs.filter(log => log.type === VERSION_LOG && (ownerId === undefined || (log.meta as any)?.ownerId === ownerId))
    .map(log => log.meta as VersionManifest);
}
export function publicSourceVersion(version: VersionManifest): WorkroomSourceVersion {
  return {
    versionId: version.versionId, createdAt: version.createdAt,
    reviewRevision: version.reviewRevision, reviewFingerprint: version.reviewFingerprint,
    files: version.files.map(file => ({
      fileId: file.fileId, name: file.name, mimeType: file.mimeType,
      sizeBytes: file.sizeBytes, sha256: file.sha256,
    })),
  };
}
export function readySourceVersion(logs: Log[], ownerId: string, token: WorkroomReviewToken): VersionManifest | undefined {
  return versionManifests(logs, ownerId).find(version => version.state === "ready" &&
    version.reviewRevision === token.reviewRevision && version.reviewFingerprint === token.reviewFingerprint);
}
export function versionManifest(ownerId: string, token: WorkroomReviewToken, sources: CapturedWorkroomSource[]): VersionManifest {
  const versionId = randomUUID();
  return {
    reviewRevision: token.reviewRevision, reviewFingerprint: token.reviewFingerprint,
    ownerId, versionId, createdAt: new Date().toISOString(), state: "preparing",
    files: sources.map(source => ({
      fileId: source.fileId, name: source.name, mimeType: source.mimeType,
      sizeBytes: source.bytes.length, sha256: createHash("sha256").update(source.bytes).digest("hex"),
      // A fresh, opaque key per file, never derived from a caller's path/name.
      key: `workroom-versions/${versionId}/${randomUUID()}`,
    })),
  };
}
export function verifyVersionBytes(bytes: Buffer, file: { sizeBytes: number; sha256: string }): void {
  if (bytes.length !== file.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new WorkroomTransitionError("Integritas salinan versi tidak cocok. Berkas tidak diberikan.", 409);
  }
}
export function requireNotDeleting(logs: Log[]): void {
  if (logs.some(log => log.type === DELETING_LOG)) {
    throw new WorkroomTransitionError("Penghapusan Workroom sedang berlangsung. Ulangi penghapusan untuk menyelesaikannya.");
  }
}
