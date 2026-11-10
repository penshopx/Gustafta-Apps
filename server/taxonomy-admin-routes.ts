import type { Express, RequestHandler } from "express";
import { insertKnowledgeTaxonomySchema, TAXONOMY_LEVELS, type KnowledgeTaxonomyTreeNode } from "@shared/schema";
import type { IStorage } from "./storage";
import { z } from "zod";
import { isTaxonomySlugConflict, TAXONOMY_SLUG_CONFLICT } from "@shared/taxonomy-slug";

export function validateTaxonomyHierarchy(
  tree: KnowledgeTaxonomyTreeNode[], data: { parentId?: number | null; level?: string }, id?: number,
): string | null {
  const nodes: KnowledgeTaxonomyTreeNode[] = [];
  const visit = (items: KnowledgeTaxonomyTreeNode[]) => {
    for (const node of items) { nodes.push(node); visit(node.children); }
  };
  visit(tree);
  const current = nodes.find(n => n.id === id);
  const level = data.level ?? current?.level ?? "sektor";
  const parentId = data.parentId === undefined ? current?.parentId ?? null : data.parentId;
  const index = TAXONOMY_LEVELS.indexOf(level as typeof TAXONOMY_LEVELS[number]);
  if (index === 0 && parentId !== null) return "Sektor tidak boleh memiliki kategori induk.";
  if (index > 0) {
    const parent = nodes.find(n => n.id === parentId);
    if (!parent) return "Pilih induk sesuai jenjang kategori.";
    const seen = new Set<number>();
    let ancestor: KnowledgeTaxonomyTreeNode | undefined = parent;
    while (ancestor) {
      if (ancestor.id === id || seen.has(ancestor.id)) return "Kategori tidak boleh menjadi induk dirinya atau turunannya.";
      seen.add(ancestor.id);
      ancestor = nodes.find(n => n.id === ancestor?.parentId);
    }
    if (parent.level !== TAXONOMY_LEVELS[index - 1]) return "Pilih induk sesuai jenjang kategori.";
  }
  if (current?.children.some(n => n.level !== TAXONOMY_LEVELS[index + 1])) {
    return "Jenjang tidak dapat diubah selama kategori anak masih memakai jenjang lama.";
  }
  return null;
}

type TaxonomyStorage = Pick<IStorage,
  "getTaxonomyTree" | "getTaxonomyNode" | "getTaxonomyUsageCounts" |
  "createTaxonomyNode" | "updateTaxonomyNode" | "deleteTaxonomyNode" | "getTaxonomyAuditHistory">;

export function registerTaxonomyAdminRoutes(
  app: Express, storage: TaxonomyStorage, authenticated: RequestHandler, admin: RequestHandler,
) {
  const idSchema = z.coerce.number().int().positive();
  // Both OIDC and email sessions; never accept the actor from the request body.
  const actorRequired: RequestHandler = (req, res, next) => {
    const user = req.user as { claims?: { sub?: string }; id?: string } | undefined;
    const actorId = user?.claims?.sub || user?.id;
    if (typeof actorId !== "string" || !actorId.trim()) {
      res.status(401).json({ error: "Identitas admin tidak ditemukan." });
      return;
    }
    res.locals.taxonomyActorId = actorId;
    next();
  };
  const schema = insertKnowledgeTaxonomySchema.extend({
    name: z.string().trim().min(1).max(255),
    slug: z.string().trim().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug harus berupa huruf kecil, angka, dan tanda hubung."),
    parentId: z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().default(0),
  });
  app.get("/api/taxonomy/usage", authenticated, admin, async (_req, res) => {
    try { res.json(await storage.getTaxonomyUsageCounts()); }
    catch { res.status(500).json({ error: "Gagal membaca penggunaan kategori." }); }
  });
  app.get("/api/taxonomy/audit", authenticated, admin, async (req, res) => {
    const query = z.object({
      beforeId: idSchema.optional(),
      search: z.string().trim().max(255).optional(),
    }).safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Parameter riwayat tidak valid." });
    try { res.json(await storage.getTaxonomyAuditHistory(undefined, query.data.beforeId, query.data.search)); }
    catch { res.status(500).json({ error: "Gagal membaca riwayat kategori." }); }
  });
  app.get("/api/taxonomy/:id/history", authenticated, admin, async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const cursor = idSchema.optional().safeParse(req.query.beforeId);
    if (!id.success || !cursor.success) return res.status(400).json({ error: "Parameter riwayat tidak valid." });
    try { res.json(await storage.getTaxonomyAuditHistory(id.data, cursor.data)); }
    catch { res.status(500).json({ error: "Gagal membaca riwayat kategori." }); }
  });
  app.post("/api/taxonomy", authenticated, admin, actorRequired, async (req, res) => {
    try {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
      const tree = await storage.getTaxonomyTree();
      const error = validateTaxonomyHierarchy(tree, parsed.data);
      if (error) return res.status(400).json({ error });
      res.status(201).json(await storage.createTaxonomyNode(parsed.data, res.locals.taxonomyActorId));
    } catch (error) {
      const conflict = isTaxonomySlugConflict(error);
      res.status(conflict ? 409 : 500)
        .json(conflict ? { code: "TAXONOMY_SLUG_CONFLICT", field: "slug", error: TAXONOMY_SLUG_CONFLICT } : { error: "Gagal membuat kategori." });
    }
  });
  app.patch("/api/taxonomy/:id", authenticated, admin, actorRequired, async (req, res) => {
    try {
      const id = idSchema.safeParse(req.params.id);
      const parsed = schema.partial().safeParse(req.body);
      if (!id.success || !parsed.success) return res.status(400).json({ error: "Data kategori tidak valid." });
      if (!await storage.getTaxonomyNode(id.data)) return res.status(404).json({ error: "Kategori tidak ditemukan." });
      const error = validateTaxonomyHierarchy(await storage.getTaxonomyTree(), parsed.data, id.data);
      if (error) return res.status(400).json({ error });
      const node = await storage.updateTaxonomyNode(id.data, parsed.data, res.locals.taxonomyActorId);
      if (!node) return res.status(404).json({ error: "Kategori tidak ditemukan." });
      res.json(node);
    } catch (error) {
      const conflict = isTaxonomySlugConflict(error);
      res.status(conflict ? 409 : 500)
        .json(conflict ? { code: "TAXONOMY_SLUG_CONFLICT", field: "slug", error: TAXONOMY_SLUG_CONFLICT } : { error: "Gagal memperbarui kategori." });
    }
  });
  app.delete("/api/taxonomy/:id", authenticated, admin, actorRequired, async (req, res) => {
    try {
      const id = idSchema.safeParse(req.params.id);
      const confirmation = z.object({ confirmedUsageCount: z.number().int().nonnegative().optional() })
        .safeParse(req.body ?? {});
      if (!id.success || !confirmation.success) return res.status(400).json({ error: "Data penghapusan tidak valid." });
      const ok = await storage.deleteTaxonomyNode(id.data, confirmation.data.confirmedUsageCount, res.locals.taxonomyActorId);
      if (!ok) return res.status(404).json({ error: "Kategori tidak ditemukan." });
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const conflict = message.includes("anak") || message.includes("konfirmasi");
      res.status(conflict ? 409 : 500).json({ error: conflict ? message : "Gagal menghapus kategori." });
    }
  });
}
