import { ARCHIVE_REFERENCE_PATTERN } from "../../shared/legacy-memory-evidence";
import type { TrustedCreationArchive } from "./legacy-memory-recovery";

// These ports must be implemented by the custodian of an independently
// retained historical archive, with read-only credentials. Neither the review
// database nor the request may supply a locator or the record bytes.
export type CreationArchiveCatalog = {
  // null means absent. Throw CreationArchiveAccessDenied (without provider
  // details) for permission failures; other errors count as unavailable.
  lookupOriginal(evidenceRef: string): Promise<string | null>;
};

export type CreationArchiveByteReader = {
  // Same error contract as the catalog. null means the original is missing.
  readOriginalBytes(locator: string): Promise<Uint8Array | null>;
};

/**
 * Server-only bridge from a custodian's opaque reference catalog to original
 * event bytes. This bridge cannot establish that a source is historical,
 * authenticated, immutable or read-only: those guarantees belong to the
 * custodian and must be verified before this is passed to the recovery service.
 * Do not wire this to production until that source has been identified.
 * Recovery records aggregate failures at its verification boundary, so catalog
 * and byte-reader failures count once and never log aliases/locators/errors.
 */
export function createTrustedCreationArchive(
  catalog: CreationArchiveCatalog,
  reader: CreationArchiveByteReader,
): TrustedCreationArchive {
  return {
    async readOriginalRecord(evidenceRef) {
      if (!ARCHIVE_REFERENCE_PATTERN.test(evidenceRef)) return null;
      const locator = await catalog.lookupOriginal(evidenceRef);
      if (typeof locator !== "string" || !locator) return null;
      // Only the trusted catalog can provide the locator. Never derive it
      // from an alias or accept a path/URL from a review submission.
      const bytes = await reader.readOriginalBytes(locator);
      return bytes instanceof Uint8Array ? bytes : null;
    },
  };
}
