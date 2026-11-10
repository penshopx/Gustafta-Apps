import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InsertKnowledgeTaxonomy, KnowledgeTaxonomyTreeNode } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

/**
 * Hook untuk membaca seluruh pohon taksonomi knowledge base
 * (Sektor → Subsektor → Topik → Klausul). Dipakai oleh form KB
 * untuk referensi lama/admin. Form pilihan baru memakai activeOnly agar
 * kategori nonaktif beserta seluruh turunannya tidak ditawarkan.
 * Penyaringan hanya di observer, bukan pada data cache bersama.
 */
// Filter an entire branch: an active child of an inactive parent is not selectable.
// Do not mutate the cached tree; admin and historical references still need it.
export function selectActiveTaxonomy(tree: KnowledgeTaxonomyTreeNode[]): KnowledgeTaxonomyTreeNode[] {
  return tree
    .filter((node) => node.isActive !== false)
    .map((node) => ({ ...node, children: selectActiveTaxonomy(node.children ?? []) }));
}

export function useTaxonomy(enabled = true, { activeOnly = false } = {}) {
  return useQuery<KnowledgeTaxonomyTreeNode[]>({
    queryKey: ["/api/taxonomy"],
    enabled,
    select: activeOnly ? selectActiveTaxonomy : undefined,
  });
}

export function useTaxonomyUsage(enabled = true) {
  return useQuery<Record<number, number>>({
    queryKey: ["/api/taxonomy/usage"],
    enabled,
    staleTime: 0,
  });
}

export function useTaxonomyMutations() {
  const client = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["/api/taxonomy"] }),
      client.invalidateQueries({ queryKey: ["/api/taxonomy/usage"] }),
      client.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes("knowledge-base") }),
    ]);
  };
  const create = useMutation({
    mutationFn: (data: InsertKnowledgeTaxonomy) => apiRequest("POST", "/api/taxonomy", data),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertKnowledgeTaxonomy> }) =>
      apiRequest("PATCH", `/api/taxonomy/${id}`, data),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: ({ id, confirmedUsageCount }: { id: number; confirmedUsageCount: number }) =>
      apiRequest("DELETE", `/api/taxonomy/${id}`, { confirmedUsageCount }),
    onSuccess: refresh,
    onError: () => client.invalidateQueries({ queryKey: ["/api/taxonomy/usage"] }),
  });
  return { create, update, remove };
}
