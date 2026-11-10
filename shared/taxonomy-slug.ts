export const TAXONOMY_SLUG_CONSTRAINT = "knowledge_taxonomy_slug_unique";
export const TAXONOMY_SLUG_CONFLICT =
  "Slug sudah digunakan kategori lain, termasuk kategori nonaktif atau di bawah induk berbeda. Pilih slug lain, misalnya tambahkan nama sektor.";

/** Drizzle wraps PostgreSQL errors in cause; inspect only the named constraint. */
export function isTaxonomySlugConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const value = error as { code?: string; constraint?: string; cause?: unknown };
    if (value.code === "23505" && value.constraint === TAXONOMY_SLUG_CONSTRAINT) return true;
    error = value.cause;
  }
  return false;
}
