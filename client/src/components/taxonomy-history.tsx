import { useState, type FormEvent } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { TaxonomyAuditEntry } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FIELDS = [
  ["name", "Nama"], ["slug", "Slug"], ["description", "Deskripsi"],
  ["level", "Jenjang"], ["parentId", "ID induk"], ["sortOrder", "Urutan"], ["isActive", "Aktif"],
] as const;
const ACTIONS = { create: "Dibuat", update: "Diubah", delete: "Dihapus" };
const display = (value: unknown): string => value == null || value === "" ? "—"
  : typeof value === "boolean" ? (value ? "Ya" : "Tidak") : String(value);

export function TaxonomyHistory({ target, onClose }: {
  target: { id: number; name: string } | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const history = useInfiniteQuery({
    queryKey: ["/api/taxonomy", "history", target?.id ?? "all", search],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }): Promise<TaxonomyAuditEntry[]> => {
      const params = new URLSearchParams();
      if (pageParam !== undefined) params.set("beforeId", String(pageParam));
      if (!target && search) params.set("search", search);
      const path = target ? `/api/taxonomy/${target.id}/history` : "/api/taxonomy/audit";
      return apiRequest("GET", `${path}?${params}`);
    },
    getNextPageParam: (page) => page.length === 50 ? page[page.length - 1].id : undefined,
    retry: false,
    staleTime: 0,
  });
  const entries = history.data?.pages.flat() ?? [];
  const submit = (event: FormEvent) => { event.preventDefault(); setSearch(draft.trim()); };

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Riwayat kategori{target ? ` · ${target.name} (#${target.id})` : ""}</DialogTitle>
        <DialogDescription>Catatan terbaru lebih dulu. Hanya metadata kategori, tanpa konten KB. Aktor ditampilkan dengan ID akun tetap, termasuk bila akunnya telah dihapus.</DialogDescription>
      </DialogHeader>
      {!target && <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="taxonomy-history-search">Cari nama, slug, atau ID kategori (termasuk yang dihapus)</Label>
        <div className="flex gap-2">
          <Input id="taxonomy-history-search" maxLength={255} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <Button type="submit">Cari</Button>
        </div>
      </form>}
      <div aria-live="polite" className="space-y-4">
        {history.isPending && <p role="status">Memuat riwayat kategori…</p>}
        {history.isError && <div role="alert" className="space-y-2 text-destructive">
          <p>Riwayat kategori gagal dimuat. Silakan coba lagi.</p>
          <Button variant="outline" onClick={() => history.isFetchNextPageError ? history.fetchNextPage() : history.refetch()}>Coba lagi</Button>
        </div>}
        {history.isSuccess && entries.length === 0 && <p>Belum ada riwayat kategori yang cocok.</p>}
        {entries.map((entry) => <article key={entry.id} className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{ACTIONS[entry.action]} · {entry.after?.name ?? entry.before?.name ?? "Kategori"} (#{entry.taxonomyId})</h3>
              <p className="break-all text-sm text-muted-foreground">Aktor (ID akun): {entry.actorId}</p>
            </div>
            <time dateTime={String(entry.createdAt)} className="text-sm text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "long" })}
            </time>
          </div>
          <dl className="space-y-2 text-sm">
            {FIELDS.filter(([key]) => entry.action !== "update" || entry.before?.[key] !== entry.after?.[key])
              .map(([key, label]) => <div key={key} className="grid gap-1 border-t border-border pt-2 sm:grid-cols-[7rem_1fr]">
                <dt className="font-medium">{label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words">
                  <span className="text-muted-foreground">Sebelum: </span>{display(entry.before?.[key])}
                  <br /><span className="text-muted-foreground">Sesudah: </span>{display(entry.after?.[key])}
                </dd>
              </div>)}
          </dl>
          {!target && <Button variant="outline" size="sm" onClick={() => { setDraft(String(entry.taxonomyId)); setSearch(String(entry.taxonomyId)); }}>Cari kategori #{entry.taxonomyId}</Button>}
        </article>)}
        {history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>
          {history.isFetchingNextPage ? "Memuat…" : "Muat riwayat lebih lama"}
        </Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
