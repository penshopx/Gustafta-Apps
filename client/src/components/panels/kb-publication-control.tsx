import { useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { KnowledgeBase, KBPublicationHistoryEntry } from "@shared/schema";

type HistoryPage = {
  entries: (Omit<KBPublicationHistoryEntry, "createdAt"> & { createdAt: string })[];
  nextBefore: number | null;
};

export function KBPublicationControl({ source }: { source: KnowledgeBase }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const published = source.visibility === "published";
  const owned = !!user?.id && source.ownerUserId === user.id;
  const mutable = owned && ["private", "published"].includes(source.visibility);
  const historyKey = ["/api/knowledge-base", source.id, "publication/history", user?.id];
  const history = useInfiniteQuery<HistoryPage>({
    queryKey: historyKey,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => apiRequest("GET",
      `/api/knowledge-base/${source.id}/publication/history${pageParam ? `?before=${pageParam}` : ""}`),
    getNextPageParam: page => page.nextBefore ?? undefined,
    enabled: mutable && historyOpen,
    retry: false,
    staleTime: 0,
    // A previously authorized result must not remain visible after access loss.
    gcTime: 0,
  });
  const publication = useMutation({
    mutationFn: () => apiRequest("POST", `/api/knowledge-base/${source.id}/publication`, {
      publish: !published, confirmed: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-base", source.agentId] });
      queryClient.invalidateQueries({ queryKey: historyKey });
      setOpen(false);
      toast({ title: published ? "Publikasi dicabut" : "Dokumen dipublikasikan" });
    },
    onError: (error: Error) => toast({
      title: "Publikasi tidak berubah", description: error.message, variant: "destructive",
    }),
  });
  return <>
    <Badge variant={published ? "default" : "outline"} data-testid={`kb-privacy-${source.id}`}>
      {published ? "Dipublikasikan" : source.visibility === "platform" ? "Kurasi platform" : "Privat"}
    </Badge>
    {mutable && <Button
      size="sm" variant="outline"
      disabled={publication.isPending || (!published && source.processingStatus !== "completed")}
      onClick={() => setOpen(true)}
      data-testid={`kb-publication-${source.id}`}
    >{published ? "Cabut publikasi" : "Publikasikan"}</Button>}
    {mutable && <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}
      data-testid={`kb-publication-history-${source.id}`}>Riwayat publikasi</Button>}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Riwayat publikasi</DialogTitle>
          <DialogDescription>
            Persetujuan hanya berlaku untuk salinan KB pada agen ini, bukan akses berkas asli Ruang Simpan.
            Nomor revisi mengenali versi sumber tanpa menyimpan isinya dalam riwayat.
          </DialogDescription>
        </DialogHeader>
        {history.isPending || (history.isFetching && !history.isFetchingNextPage) ? <p role="status">Memuat riwayat...</p>
          : history.isError ? <div role="alert">
            <p>Riwayat tidak dapat ditampilkan. Pastikan Anda pemilik dokumen dan memiliki izin mengelola agen.</p>
            <Button variant="outline" onClick={() => history.refetch()}>Coba lagi</Button>
          </div>
          : <>
            {history.data?.pages[0]?.entries.length === 0 && <p>Belum ada riwayat publikasi.
              Publikasi sebelum pencatatan riwayat diaktifkan tidak dicatat ulang.</p>}
            <ol className="space-y-3" data-testid="kb-publication-history-list">
              {history.data?.pages.flatMap(page => page.entries).map(entry => <li key={entry.id}
                className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium">{entry.action === "publish" ? "Dipublikasikan" : "Publikasi dicabut"}
                  {entry.reason === "content_edit" ? " otomatis karena sumber diedit"
                    : entry.reason === "reprocess" ? " otomatis karena pemrosesan ulang" : ""}</p>
                <p>Pelaku: {entry.actorId
                  ? `${entry.actorId === user?.id ? "Anda — " : ""}${entry.actorId}` : "Sistem"}</p>
                <p><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("id-ID")}</time></p>
                <p>Sumber #{entry.sourceId} · Revisi {entry.contentRevision}</p>
              </li>)}
            </ol>
            {history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}>
              {history.isFetchingNextPage ? "Memuat..." : "Riwayat sebelumnya"}
            </Button>}
          </>}
      </DialogContent>
    </Dialog>
    <Dialog open={open} onOpenChange={next => { if (!publication.isPending) setOpen(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{published ? "Cabut publikasi dokumen?" : "Publikasikan dokumen untuk pengunjung?"}</DialogTitle>
          <DialogDescription>
            {published
              ? `Sumber “${source.name}” akan kembali privat untuk jawaban baru. Jawaban yang sudah diterima pengunjung tidak dapat ditarik kembali.`
              : `Seluruh isi sumber “${source.name}” dapat digunakan AI dalam jawaban kepada pengunjung agen ini, termasuk pengunjung tanpa login bila agen publik. Pastikan Anda berhak menerbitkannya dan tidak ada data pribadi, rahasia, atau informasi pelanggan.`}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Hanya salinan KB pada agen ini yang berubah. Berkas asli di Ruang Simpan tetap privat.
          Mengedit atau memproses ulang sumber akan mengembalikannya ke privat dan memerlukan publikasi ulang.
          Agen tetap mengikuti pengaturan aksesnya sendiri.
        </p>
        <DialogFooter>
          <Button variant="outline" disabled={publication.isPending} onClick={() => setOpen(false)}>Batal</Button>
          <Button disabled={publication.isPending} onClick={() => publication.mutate()} data-testid="kb-confirm-publication">
            {publication.isPending ? "Menyimpan..." : published ? "Ya, cabut publikasi" : "Saya setuju, publikasikan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
