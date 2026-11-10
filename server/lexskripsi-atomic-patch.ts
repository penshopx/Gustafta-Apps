import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { knowledgeBases, series } from "../shared/schema";
import { resolveLexSkripsiTargets, type LexRole } from "./lexskripsi-patch-targets";

export type LexPatchOptions = {
  database?: typeof db;
  afterWrite?: (index: number) => void | Promise<void>;
};
type LexTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type LexTargets<R extends LexRole> = Pick<Awaited<ReturnType<typeof resolveLexSkripsiTargets>>, R>;

// Serialize competing startups on the series row. The marker and all writes
// share this transaction; a failed write (including marker insertion) rolls back.
export async function runLexSkripsiAtomicPatch<R extends LexRole, T>(
  marker: string,
  roles: readonly R[],
  options: LexPatchOptions,
  apply: (
    tx: LexTx,
    targets: LexTargets<R>,
    wrote: () => Promise<void>,
  ) => Promise<{ result: T; content: string }>,
  isComplete?: (tx: LexTx, targets: LexTargets<R>) => Promise<boolean>,
): Promise<{ skipped: true } | { skipped: false; result: T }> {
  return (options.database ?? db).transaction(async (tx) => {
    const rows = await tx.select({ id: series.id }).from(series)
      .where(eq(series.slug, "lexskripsi-asisten-skripsi-hukum")).for("update");
    if (rows.length !== 1) throw new Error("Seri LexSkripsi tidak pasti; patch dibatalkan");
    const targets = await resolveLexSkripsiTargets(roles, tx);
    const prefix = `[PATCH_MARKER] ${marker} — `;
    const existing = await tx.select({ id: knowledgeBases.id }).from(knowledgeBases)
      .where(and(eq(knowledgeBases.agentId, targets[roles[0]].id),
        sql`left(${knowledgeBases.name}, ${prefix.length}) = ${prefix}`)).limit(1);
    if (existing.length && (!isComplete || await isComplete(tx, targets))) return { skipped: true as const };
    let index = 0;
    const wrote = async () => { await options.afterWrite?.(++index); };
    const { result, content } = await apply(tx, targets, wrote);
    if (existing.length) {
      await tx.update(knowledgeBases).set({ content }).where(eq(knowledgeBases.id, existing[0].id));
    } else {
      await tx.insert(knowledgeBases).values({
        agentId: targets[roles[0]].id,
        name: `[PATCH_MARKER] ${marker} — ${new Date().toISOString()}`,
        type: "text",
        content,
        description: "Patch marker otomatis — jangan dihapus",
        processingStatus: "completed",
        status: "active",
      });
    }
    await wrote();
    return { skipped: false as const, result };
  });
}