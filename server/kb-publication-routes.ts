import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type { AgentAuthzResult } from "./lib/agent-authz";
import type { KBPublicationHistoryEntry } from "@shared/schema";

const publicationBody = z.object({
  publish: z.boolean(),
  confirmed: z.literal(true),
}).strict();

export interface PublicationSource {
  id: number;
  agentId: number;
  ownerUserId: string | null;
  visibility: string;
  processingStatus: string | null;
}

export function publicationError(source: PublicationSource, userId: string, publish: boolean): string | null {
  if (!userId || !source.ownerUserId || source.ownerUserId !== userId) {
    return "Hanya pemilik dokumen yang dapat mengubah publikasinya.";
  }
  if (!["private", "published"].includes(source.visibility)) {
    return "Sumber kurasi platform tidak dapat dipublikasikan melalui tindakan ini.";
  }
  if (publish && source.processingStatus !== "completed") {
    return "Tunggu hingga pemrosesan dokumen selesai sebelum menerbitkannya.";
  }
  return null;
}

// The transaction implementation keeps the source locked through authorization
// and the write. Neither administrator privilege nor agent.isPublic is consent.
export function registerKBPublicationRoutes(app: Express, deps: {
  authenticate: RequestHandler;
  userId(req: any): string;
  getAgent(id: string): Promise<any>;
  canManage(req: any, agent: any): Promise<AgentAuthzResult>;
  withLockedSource<T>(id: number, fn: (
    source: PublicationSource | undefined,
    setVisibility: (visibility: "private" | "published", actorId: string) => Promise<void>,
    readHistory: (before?: number) => Promise<KBPublicationHistoryEntry[]>,
  ) => Promise<T>): Promise<T>;
}) {
  app.get("/api/knowledge-base/:id/publication/history", deps.authenticate, async (req, res) => {
    const id = Number(req.params.id);
    const before = req.query.before === undefined ? undefined : Number(req.query.before);
    if (!/^[1-9]\d*$/.test(String(req.params.id)) || !Number.isSafeInteger(id)
      || (before !== undefined && (!/^[1-9]\d*$/.test(String(req.query.before)) || !Number.isSafeInteger(before)))) {
      return res.status(400).json({ error: "ID atau penanda riwayat tidak valid." });
    }
    try {
      const result = await deps.withLockedSource(id, async (source, _set, readHistory) => {
        if (!source) return { status: 404, body: { error: "Dokumen tidak ditemukan." } };
        const agent = await deps.getAgent(String(source.agentId));
        if (!agent) return { status: 404, body: { error: "Agen tidak ditemukan." } };
        const auth = await deps.canManage(req, agent);
        if (!auth.ok) return { status: auth.status, body: { error: auth.error } };
        const error = publicationError(source, deps.userId(req), false);
        if (error) return { status: 403, body: { error } };
        const entries = await readHistory(before);
        return { status: 200, body: {
          entries, nextBefore: entries.length === 50 ? entries[entries.length - 1].id : null,
        } };
      });
      return res.status(result.status).json(result.body);
    } catch {
      return res.status(500).json({ error: "Gagal memuat riwayat publikasi." });
    }
  });
  app.post("/api/knowledge-base/:id/publication", deps.authenticate, async (req, res) => {
    const id = Number(req.params.id);
    const body = publicationBody.safeParse(req.body);
    if (!/^[1-9]\d*$/.test(String(req.params.id)) || !Number.isSafeInteger(id) || !body.success) {
      return res.status(400).json({ error: "ID dan konfirmasi publikasi yang valid diperlukan." });
    }
    try {
      const result = await deps.withLockedSource(id, async (source, setVisibility) => {
        if (!source) return { status: 404, body: { error: "Dokumen tidak ditemukan." } };
        const agent = await deps.getAgent(String(source.agentId));
        if (!agent) return { status: 404, body: { error: "Agen tidak ditemukan." } };
        const auth = await deps.canManage(req, agent);
        if (!auth.ok) return { status: auth.status, body: { error: auth.error } };
        const error = publicationError(source, deps.userId(req), body.data.publish);
        if (error) return { status: 403, body: { error } };
        const visibility = body.data.publish ? "published" : "private";
        // Repeating an already-applied decision is not a new approval.
        if (source.visibility !== visibility) await setVisibility(visibility, deps.userId(req));
        return { status: 200, body: { id: String(id), visibility } };
      });
      return res.status(result.status).json(result.body);
    } catch {
      return res.status(500).json({ error: "Gagal mengubah publikasi dokumen." });
    }
  });
}
