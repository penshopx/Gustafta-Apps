/**
 * Dedicated, disposable integration DB only. Never derive opt-in from the app
 * URL. Await this guard at module scope, before importing DB-backed modules or
 * registering fixtures/hooks (a failed before hook does not stop later hooks).
 */
import pg from "pg";
import { acquireTestDatabaseLease } from "./test-database-lease";

const blockedUrl = "postgres://test_guard:invalid@127.0.0.1:1/test_guard_blocked";
export const testDbSkip = "TEST_DATABASE_URL tidak diset — lewati integrasi DB";
const applicationUrls = [process.env.DATABASE_URL, process.env.DATABASE_URL_POOLED];

function reject(message: string): never {
  throw new Error(`Database uji ditolak: ${message}`);
}

export function checkTestDatabaseUrl(url: string, appUrls = applicationUrls): string {
  let target: URL;
  try { target = new URL(url); } catch { return reject("URL tidak valid"); }
  if (!["postgres:", "postgresql:"].includes(target.protocol)) reject("protokol bukan PostgreSQL");
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/_integration_test$/.test(name)) reject("nama harus berakhiran _integration_test");
  // Intentionally conservative: aliases/poolers may use a different host but
  // still reach the same database. A same-name target is never accepted.
  for (const appUrl of appUrls) {
    if (!appUrl) continue;
    let app: URL;
    try { app = new URL(appUrl); } catch { return reject("URL aplikasi tidak valid"); }
    if (decodeURIComponent(app.pathname.slice(1)) === name) reject("nama sama dengan database aplikasi");
  }
  // Do not permit a URL option to change search_path / database identity.
  if (target.searchParams.has("options")) reject("opsi koneksi kustom tidak diizinkan");
  return name;
}

export async function proveTestDatabase(url: string, appUrls = applicationUrls) {
  const name = checkTestDatabaseUrl(url, appUrls);
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const identity = await pool.query("SELECT current_database() AS name");
    if (identity.rows[0]?.name !== name) reject("identitas koneksi berbeda");
    const marker = await pool.query(
      "SELECT marker FROM public.integration_test_isolation_guard WHERE marker = $1",
      ["dedicated-disposable-integration-database"],
    );
    if (marker.rowCount !== 1) reject("penanda database disposable tidak ada");
  } catch {
    // Never print pg connection errors: they can include URLs or credentials.
    reject("pemeriksaan identitas/penanda gagal");
  } finally {
    await pool.end();
  }
}

let preparation: Promise<boolean> | undefined;
function blockDatabase() {
  process.env.DATABASE_URL = blockedUrl;
  delete process.env.DATABASE_URL_POOLED;
}
export function prepareTestDatabase(): Promise<boolean> {
  return preparation ??= (async () => {
    const url = process.env.TEST_DATABASE_URL;
    // Block both connection paths *before* attempting validation, including
    // missing/invalid URLs. Child processes keep the original app identities.
    blockDatabase();
    if (!url) return false;
    const inherited = process.env.TEST_DATABASE_APP_NAMES;
    const originals = inherited
      ? JSON.parse(inherited) as string[]
      : applicationUrls.filter((value): value is string => !!value)
          .map(value => {
            try { return new URL(value).pathname; } catch { return reject("URL aplikasi tidak valid"); }
          });
    const appUrls = originals.map(path => `postgres://app.invalid${path}`);
    await proveTestDatabase(url, appUrls);
    await acquireTestDatabaseLease(url, blockDatabase);
    process.env.TEST_DATABASE_APP_NAMES = JSON.stringify(originals);
    process.env.DATABASE_URL = url;
    return true;
  })();
}
