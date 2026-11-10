import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

type TableName = "store_products" | "agents";
export type PaymentLinkRow = { id: number; payment_url: string };
export type PaymentLinkRows = Record<TableName, PaymentLinkRow[]>;
export type PaymentLinkChange = { table: TableName; id: number; from: string; to: string };

// Only whole HTTPS origins may be migrated. Never interpret an arbitrary URL as a
// prefix: bayar.example.com.evil must not match bayar.example.com.
export function paymentOrigin(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      input !== url.origin && input !== `${url.origin}/`) {
    throw new Error("Domain harus berupa origin HTTPS saja (contoh: https://bayar.example.com)");
  }
  return url.origin;
}

export function planPaymentLinkMigration(
  rows: PaymentLinkRows,
  oldOrigin: string,
  targetOrigin: string,
): { changes: PaymentLinkChange[]; fingerprint: string; ignored: number } {
  if (oldOrigin === targetOrigin) throw new Error("Domain lama dan baru harus berbeda");
  const changes: PaymentLinkChange[] = [];
  let ignored = 0;
  for (const table of ["store_products", "agents"] as const) {
    for (const row of rows[table]) {
      let url: URL;
      try { url = new URL(row.payment_url); } catch { ignored++; continue; }
      if (url.origin !== oldOrigin || url.protocol !== "https:" || url.username || url.password) { ignored++; continue; }
      // Preserve the original path, query and fragment (including encoded text).
      changes.push({
        table, id: row.id, from: row.payment_url,
        to: targetOrigin + url.href.slice(url.origin.length),
      });
    }
  }
  changes.sort((a, b) => a.table.localeCompare(b.table) || a.id - b.id);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ oldOrigin, targetOrigin, changes }))
    .digest("hex");
  return { changes, fingerprint, ignored };
}

export async function readPaymentLinks(client: PoolClient, lock = false): Promise<PaymentLinkRows> {
  const rows = {} as PaymentLinkRows;
  for (const table of ["store_products", "agents"] as const) {
    // The table names are fixed by this module, not interpolated from a request.
    const result = await client.query<PaymentLinkRow>(
      `SELECT id, payment_url FROM ${table} WHERE payment_url IS NOT NULL AND payment_url <> '' ORDER BY id${lock ? " FOR UPDATE" : ""}`,
    );
    rows[table] = result.rows;
  }
  return rows;
}

export class PaymentLinksChangedError extends Error {}

export async function applyPaymentLinkMigration(
  client: PoolClient,
  oldOrigin: string,
  targetOrigin: string,
  expectedFingerprint: string,
): Promise<{ store_products: number; agents: number }> {
  await client.query("BEGIN");
  try {
    const plan = planPaymentLinkMigration(await readPaymentLinks(client, true), oldOrigin, targetOrigin);
    if (plan.fingerprint !== expectedFingerprint) {
      throw new PaymentLinksChangedError("Tautan berubah sejak pratinjau. Tinjau ulang sebelum menerapkan.");
    }
    const updated = { store_products: 0, agents: 0 };
    for (const change of plan.changes) {
      const result = await client.query(
        `UPDATE ${change.table} SET payment_url = $1 WHERE id = $2 AND payment_url = $3`,
        [change.to, change.id, change.from],
      );
      if (result.rowCount !== 1) throw new PaymentLinksChangedError("Tautan berubah saat migrasi. Tidak ada perubahan disimpan.");
      updated[change.table]++;
    }
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}