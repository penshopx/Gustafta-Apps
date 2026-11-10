import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { agents, series, toolboxes } from "../shared/schema";

export type LexRole = "orchestrator" | "metode" | "substansi" | "lapangan" | "sidang" | "notion";

const NAMES: Record<LexRole, string> = {
  orchestrator: "LexSkripsi",
  metode: "AGENT-METODE",
  substansi: "AGENT-SUBSTANSI",
  lapangan: "AGENT-LAPANGAN",
  sidang: "AGENT-SIDANG",
  notion: "AGENT-NOTION",
};
const SERIES_SLUG = "lexskripsi-asisten-skripsi-hukum";
const NOTION_SLUG = "lexskripsi-agent-notion";

type Candidate = {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  systemPrompt: string | null;
  seriesSlug: string | null;
};

// Exported separately so shifted/occupied IDs can be tested without touching the database.
export function selectLexSkripsiTargets<T extends Candidate>(
  rows: T[],
  roles: readonly LexRole[],
): Record<LexRole, T> {
  const selected = {} as Record<LexRole, T>;
  for (const role of roles) {
    const matches = rows.filter((row) => {
      if (row.name !== NAMES[role]) return false;
      if (role === "notion") {
        return row.seriesSlug === SERIES_SLUG &&
          (row.slug === null || row.slug === NOTION_SLUG) &&
          row.description?.includes("LexSkripsi") &&
          row.systemPrompt?.includes("anggota tim LexSkripsi") === true;
      }
      return row.seriesSlug === SERIES_SLUG;
    });
    if (matches.length !== 1) {
      throw new Error(`Target LexSkripsi ${role} tidak pasti (${matches.length} kandidat terverifikasi); patch dibatalkan`);
    }
    selected[role] = matches[0];
  }
  return selected;
}

export async function resolveLexSkripsiTargets<R extends LexRole>(
  roles: readonly R[],
  exec: Pick<typeof db, "select"> = db,
): Promise<Pick<Record<LexRole, Candidate>, R>> {
  const rows = await exec.select({
    id: agents.id,
    name: agents.name,
    slug: agents.slug,
    description: agents.description,
    systemPrompt: agents.systemPrompt,
    seriesSlug: series.slug,
  }).from(agents)
    .leftJoin(toolboxes, eq(agents.toolboxId, toolboxes.id))
    .leftJoin(series, eq(toolboxes.seriesId, series.id))
    .where(inArray(agents.name, roles.map((role) => NAMES[role])));
  return selectLexSkripsiTargets(rows, roles);
}

export const LEX_NOTION_SLUG = NOTION_SLUG;