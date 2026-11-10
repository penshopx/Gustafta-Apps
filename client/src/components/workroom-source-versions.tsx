import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkroomReviewExpectation, WorkroomReviewToken, WorkroomSourceVersion } from "@shared/workroom-transitions";

export function WorkroomSourceVersions(props: WorkroomReviewToken & {
  workroomId: string; hasSources: boolean; deletionPending?: boolean; onRefresh: () => void;
}) {
  const [history, setHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const key = ["/api/workrooms", props.workroomId, "source-versions"];
  const versions = useQuery<WorkroomSourceVersion[]>({
    queryKey: key, queryFn: () => apiRequest("GET", `/api/workrooms/${props.workroomId}/source-versions`),
    enabled: history && !props.deletionPending,
  });
  const capture = useMutation({
    retry: false,
    mutationFn: (expected: WorkroomReviewExpectation) => apiRequest("POST", `/api/workrooms/${props.workroomId}/source-versions`, expected),
    onSuccess: () => { setHistory(true); qc.invalidateQueries({ queryKey: key }); },
    onError: props.onRefresh,
  });
  const remove = useMutation({
    retry: false,
    mutationFn: () => apiRequest("DELETE", `/api/workrooms/${props.workroomId}`),
    onSuccess: () => { qc.removeQueries({ queryKey: ["/api/workrooms", props.workroomId] }); qc.invalidateQueries({ queryKey: ["/api/workrooms"] }); navigate("/workroom"); },
    onError: () => { setConfirmDelete(false); props.onRefresh(); },
  });
  return (
    <Card className="bg-slate-900 border-slate-800" data-testid="workroom-source-versions">
      <CardHeader><CardTitle className="text-base">Arsip versi dokumen</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-slate-400">
          Salinan privat memakai penyimpanan tambahan dan tidak ditimpa oleh perubahan sumber.
          Persetujuan baru dengan sumber akan menyimpan versi secara otomatis.
          Arsip ikut dihapus bersama Workroom; dokumen asli Ruang Simpan tidak ikut dihapus.
        </p>
        {props.deletionPending ? <p role="status" className="text-amber-300">
          Penghapusan belum selesai. Akses arsip dikunci. Ulangi hapus Workroom untuk melanjutkan.
        </p> : <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!props.hasSources || capture.isPending}
              data-testid="button-capture-source-version"
              onClick={() => capture.mutate({ expectedReviewRevision: props.reviewRevision, expectedReviewFingerprint: props.reviewFingerprint })}>
              {capture.isPending ? "Menyimpan…" : "Simpan versi untuk tinjauan ini"}
            </Button>
            <Button variant="ghost" onClick={() => setHistory(value => !value)} data-testid="button-source-history">Riwayat versi</Button>
          </div>
          {capture.isError && <p role="alert" className="text-amber-300">Versi belum tersimpan. Tinjau data terbaru lalu coba lagi. Tidak ada persetujuan yang dibuat.</p>}
          {history && <>
            {versions.isLoading && <p>Memuat riwayat…</p>}
            {versions.isError && <p role="alert">Riwayat belum dapat dibaca. <button className="underline" onClick={() => versions.refetch()}>Coba lagi</button></p>}
            {Array.isArray(versions.data) && !versions.data.length && <p>Belum ada salinan versi. Versi lama sebelum fitur ini tidak dibuat ulang secara otomatis.</p>}
            {Array.isArray(versions.data) && versions.data.map(version => (
              <div key={version.versionId} className="border border-slate-700 rounded p-3 space-y-2">
                <p>Disimpan {new Date(version.createdAt).toLocaleString("id-ID")} · tinjauan {version.reviewRevision}</p>
                <p className="text-xs text-slate-400 break-all">Versi {version.versionId}</p>
                {version.files.map(file => (
                  <div key={file.fileId}>
                    <a className="text-sky-300 underline"
                      href={`/api/workrooms/${props.workroomId}/source-versions/${version.versionId}/files/${file.fileId}`}>
                      Unduh salinan: {file.name}
                    </a>
                    <p className="text-xs text-slate-400 break-all">SHA-256: {file.sha256}</p>
                  </div>
                ))}
              </div>
            ))}
          </>}
        </>}
        {remove.isError && <p role="alert" className="text-amber-300">Penghapusan belum selesai. Tidak dinyatakan berhasil; coba ulangi penghapusan.</p>}
        {!confirmDelete ? <Button variant="destructive" data-testid="button-delete-workroom"
          disabled={capture.isPending} onClick={() => setConfirmDelete(true)}>
          {props.deletionPending ? "Ulangi hapus Workroom" : "Hapus Workroom dan arsipnya"}
        </Button> : <div className="border border-red-500/40 rounded p-3 space-y-2" role="alertdialog" aria-label="Konfirmasi hapus Workroom">
          <p>Hapus Workroom dan seluruh salinan versinya? Tindakan ini tidak bisa dibatalkan. Dokumen asli Ruang Simpan tetap ada.</p>
          <Button variant="destructive" disabled={remove.isPending} data-testid="button-confirm-delete-workroom"
            onClick={() => remove.mutate()}>Ya, hapus Workroom dan arsip</Button>{" "}
          <Button variant="outline" disabled={remove.isPending} onClick={() => setConfirmDelete(false)}>Batal</Button>
        </div>}
      </CardContent>
    </Card>
  );
}
