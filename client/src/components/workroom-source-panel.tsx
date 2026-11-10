import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkroomReviewExpectation, WorkroomReviewToken, WorkroomSourceState } from "@shared/workroom-transitions";

type Choice = { fileId: string; name: string };
type Draft = { fileIds: string[] } & WorkroomReviewExpectation;
export function WorkroomSourcePanel(props: WorkroomReviewToken & {
  workroomId: string; sources: WorkroomSourceState[]; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const options = useQuery<Choice[]>({
    queryKey: ["/api/workrooms", props.workroomId, "source-options"],
    queryFn: () => apiRequest("GET", `/api/workrooms/${props.workroomId}/source-options`),
    enabled: draft !== null,
  });
  const save = useMutation({
    retry: false,
    mutationFn: (snapshot: Draft) => apiRequest("POST", `/api/workrooms/${props.workroomId}/sources`, snapshot),
    onSuccess: () => { setDraft(null); props.onSaved(); },
    onError: () => { props.onSaved(); },
  });
  const choices = [...(options.data || [])];
  for (const source of props.sources) {
    if (!choices.some(choice => choice.fileId === source.fileId)) {
      choices.push({ fileId: source.fileId, name: source.name || "Sumber tidak tersedia" });
    }
  }
  function open() {
    save.reset();
    setDraft({
      fileIds: props.sources.map(source => source.fileId),
      expectedReviewRevision: props.reviewRevision,
      expectedReviewFingerprint: props.reviewFingerprint,
    });
  }
  return (
    <Card className="bg-slate-900 border-slate-800" data-testid="workroom-source-panel">
      <CardHeader><CardTitle className="text-base">Sumber Ruang Simpan</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-400">
          Pilih dokumen aktif milik Anda untuk dasar tinjauan. Maksimal 5 dokumen, total 20 MB.
          Isi dokumen belum otomatis dikirim ke model AI.
        </p>
        {!props.sources.length && <p className="text-sm text-slate-400">Belum ada dokumen ditautkan.</p>}
        {props.sources.map(source => (
          <div key={source.fileId} className="border border-slate-700 rounded p-3 text-sm" data-testid={`source-${source.fileId}`}>
            <p>{source.name || "Sumber tidak tersedia"}</p>
            {source.availability === "available" ? (
              <>
                <p className="text-xs text-slate-400">Terverifikasi saat dimuat · revisi {source.revision.slice(0, 12)}</p>
                <a className="text-sky-300 underline" href={`/api/ruang-simpan/files/${source.fileId}/download`}
                  target="_blank" rel="noopener noreferrer">Buka dokumen untuk ditinjau</a>
              </>
            ) : (
              <p className="text-amber-300" role="status">
                {source.availability === "verification_failed"
                  ? "Dokumen belum dapat diverifikasi. Coba muat ulang data."
                  : "Dokumen tidak tersedia untuk akun ini atau sudah tidak aktif."}
                {" "}Persetujuan dan progres berikutnya terkunci.
              </p>
            )}
          </div>
        ))}
        {!draft ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={open} data-testid="button-edit-sources">Pilih dokumen</Button>
            <Button variant="ghost" onClick={props.onSaved} data-testid="button-refresh-sources">Periksa ulang sumber</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Pilihan memuat hingga 100 dokumen aktif terbaru.</p>
            {options.isLoading && <p className="text-sm">Memuat dokumen…</p>}
            {options.isError && <p role="alert">Daftar dokumen belum dapat dimuat. Tutup pemilih dan coba lagi.</p>}
            {!options.isLoading && !options.isError && !choices.length && <p>Belum ada dokumen aktif. Unggah melalui Ruang Simpan.</p>}
            {choices.map(choice => (
              <label key={choice.fileId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.fileIds.includes(choice.fileId)}
                  disabled={save.isPending || (!draft.fileIds.includes(choice.fileId) && draft.fileIds.length >= 5)}
                  onChange={event => {
                    const checked = event.target.checked;
                    setDraft(current => current ? { ...current, fileIds: checked
                      ? [...current.fileIds, choice.fileId] : current.fileIds.filter(id => id !== choice.fileId) } : null);
                  }} />
                {choice.name}
              </label>
            ))}
            {save.isError && <p role="alert" className="text-amber-300">
              Tidak tersimpan. Tutup pemilih, tinjau data terbaru, lalu pilih ulang.
            </p>}
            <div className="flex gap-2">
              <Button onClick={() => save.mutate({ ...draft, fileIds: [...draft.fileIds] })}
                disabled={save.isPending || options.isLoading || options.isError}
                data-testid="button-save-sources">Simpan sumber</Button>
              <Button variant="outline" disabled={save.isPending} onClick={() => setDraft(null)}>Tutup pemilih</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
