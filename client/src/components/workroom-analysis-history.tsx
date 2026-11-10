import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { WorkroomAnalysisExecution } from "@shared/workroom-analysis-policy";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const labels: Record<WorkroomAnalysisExecution["status"], string> = {
  running: "Berjalan", succeeded: "Tersimpan", failed: "Gagal",
  uncertain: "Perlu tinjauan", acknowledged: "Ketidakpastian diakui",
};
export function WorkroomAnalysisHistory({ workroomId, executions, onRefresh }: {
  workroomId: string; executions: WorkroomAnalysisExecution[]; onRefresh: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { toast } = useToast();
  const acknowledge = useMutation({
    retry: false,
    mutationFn: (id: string) => apiRequest("POST", `/api/workrooms/${workroomId}/analysis-executions/${id}/acknowledge`,
      { acknowledgeUncertain: true }),
    onSuccess: () => { setConfirmId(null); onRefresh(); },
    onError: () => { onRefresh(); toast({ title: "Status belum berubah", description: "Periksa status sebelum mencoba kembali.", variant: "destructive" }); },
  });
  if (!executions.length) return null;
  return <section className="mt-4 space-y-2 text-sm" aria-label="Riwayat eksekusi AI">
    <div className="flex items-center justify-between">
      <h3 className="font-medium">Riwayat eksekusi AI</h3>
      <Button variant="outline" size="sm" onClick={onRefresh}>Periksa status</Button>
    </div>
    <p className="text-xs text-muted-foreground">
      Berjalan atau perlu tinjauan mengunci analisis baru. Tidak ada pengulangan model otomatis setelah koneksi putus atau restart.
    </p>
    {executions.slice(0, 10).map(execution => <div key={execution.id} className="rounded border p-2">
      <p>{labels[execution.status]} · {execution.model}</p>
      <p className="text-xs break-all text-muted-foreground">{execution.id} · {new Date(execution.startedAt).toLocaleString("id-ID")}</p>
      {execution.status === "uncertain" && <Button size="sm" variant="outline"
        data-testid={`button-review-execution-${execution.id}`} onClick={() => setConfirmId(execution.id)}>
        Tinjau ketidakpastian
      </Button>}
    </div>)}
    {confirmId && <div role="alertdialog" aria-label="Konfirmasi ketidakpastian eksekusi" className="rounded border border-amber-500 p-3 space-y-2">
      <p>Panggilan sebelumnya mungkin sudah diproses atau ditagihkan. Periksa hasil tersimpan dahulu.
        Mengakui ketidakpastian hanya membuka izin untuk memulai analisis baru secara manual; tidak mengulang model atau membatalkan biaya.</p>
      <Button variant="outline" onClick={() => setConfirmId(null)} disabled={acknowledge.isPending}>Batal</Button>
      <Button onClick={() => acknowledge.mutate(confirmId)} disabled={acknowledge.isPending}
        data-testid="button-confirm-execution-uncertainty">Saya memahami risikonya</Button>
    </div>}
  </section>;
}
