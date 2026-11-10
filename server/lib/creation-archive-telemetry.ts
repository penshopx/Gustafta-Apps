// Fixed-cardinality, process-local counters only. Never accept evidence or
// provider errors here: even their messages/stack/cause may contain secrets.
export type CreationArchiveFailure =
  | "lookup_missing"
  | "access_denied"
  | "service_unavailable"
  | "digest_changed";

export type CreationArchiveFailureCounts = Readonly<Record<CreationArchiveFailure, number>>;

// Concrete custodian ports must translate an authoritative permission failure
// into this error. Unknown errors fail closed as service_unavailable; do not
// guess from provider messages or include the original error as a cause.
export class CreationArchiveAccessDenied extends Error {
  constructor() {
    super("Creation archive access denied");
  }
}

export function createCreationArchiveTelemetry(
  signal: (counts: CreationArchiveFailureCounts) => void = (counts) => {
    console.warn("[legacy-memory-recovery] archive_failure_totals", counts);
  },
) {
  const counts: Record<CreationArchiveFailure, number> = {
    lookup_missing: 0,
    access_denied: 0,
    service_unavailable: 0,
    digest_changed: 0,
  };
  return {
    snapshot(): CreationArchiveFailureCounts {
      return Object.freeze({ ...counts });
    },
    record(failure: CreationArchiveFailure): void {
      // Also enforce the allowlist at runtime, not just in TypeScript.
      if (!Object.hasOwn(counts, failure)) return;
      counts[failure] = Math.min(Number.MAX_SAFE_INTEGER, counts[failure] + 1);
      try {
        signal(Object.freeze({ ...counts }));
      } catch {
        // A broken log collector must never bypass verification or replace
        // the generic conflict with a potentially private transport error.
      }
    },
  };
}

export type CreationArchiveTelemetry = ReturnType<typeof createCreationArchiveTelemetry>;
export const creationArchiveTelemetry = createCreationArchiveTelemetry();
