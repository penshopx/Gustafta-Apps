// Opaque UUIDv4 issued by the archive custodian, never derived from a session,
// user identifier, filename, URL or record contents. Syntax is not provenance.
export const ARCHIVE_REFERENCE_SOURCE = "archive:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
// Negative lookahead for ANY remaining character, including a final line break.
export const ARCHIVE_REFERENCE_PATTERN = new RegExp(`^${ARCHIVE_REFERENCE_SOURCE}(?![\\s\\S])`);
export const APPROVAL_REASON = "original_record_verified";
export const REJECTION_REASONS = [
  "record_unavailable", "record_incomplete", "record_mismatch",
  "legacy_reference_requires_resubmission",
] as const;
export const RECOVERY_REASON_LABELS: Record<string, string> = {
  original_record_verified: "Rekaman asli, SHA-256, dan ketiga ID telah diverifikasi",
  record_unavailable: "Rekaman asli tidak tersedia melalui akses yang sah",
  record_incomplete: "Rekaman asli tidak membuktikan ketiga ID secara lengkap",
  record_mismatch: "Rekaman asli, SHA-256, atau identitas tidak cocok",
  legacy_reference_requires_resubmission: "Rujukan lama harus diajukan ulang dengan ID arsip terbatas",
};
export function validRecoveryReason(approve: boolean, reason: unknown): reason is string {
  return typeof reason === "string" && (approve
    ? reason === APPROVAL_REASON
    : REJECTION_REASONS.some(code => code === reason));
}
