import type { WorkroomBudgetSnapshot } from "@shared/workroom-budget-policy";
import { Button } from "@/components/ui/button";

const money = (micro: number) => `USD ${(micro / 1_000_000).toFixed(4)}`;
const reasons = {
  account_calls: "Batas jumlah analisis akun tercapai.",
  account_estimate: "Sisa anggaran estimasi akun tidak mencukupi.",
  platform_estimate: "Sisa anggaran estimasi Workroom gabungan tidak mencukupi.",
};
export function WorkroomAnalysisBudget({ budget, failed, onRefresh }: {
  budget?: WorkroomBudgetSnapshot; failed: boolean; onRefresh: () => void;
}) {
  return <section aria-label="Batas harian analisis AI" className="mt-4 rounded border p-3 space-y-2 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-medium">Batas harian analisis AI</h3>
      <Button size="sm" variant="outline" onClick={onRefresh} data-testid="button-refresh-analysis-budget">Periksa batas</Button>
    </div>
    {!budget || failed ? <p role={failed ? "alert" : "status"}>
      {failed ? "Batas harian belum dapat diverifikasi. Analisis dikunci; data Workroom tetap dapat ditinjau." : "Memuat batas harian…"}
    </p> : <>
      <p data-testid="text-analysis-budget-usage">Akun: {budget.callsUsed} / {budget.callsLimit} analisis hari ini.</p>
      <p>Estimasi dicadangkan: {money(budget.reservedMicroUsd)} / {money(budget.accountLimitMicroUsd)} per akun.</p>
      <p>Batas estimasi gabungan seluruh akun: {money(budget.globalLimitMicroUsd)} per hari, hanya untuk analisis Workroom.</p>
      {!budget.available && <p role="alert" className="text-amber-400">{budget.reason ? reasons[budget.reason] : "Analisis belum tersedia."}</p>}
      <p className="text-xs text-muted-foreground">Reset 00.00 WIB · berikutnya {new Date(budget.nextResetAt).toLocaleString("id-ID", { timeZone: budget.timezone })} WIB.</p>
    </>}
    <p className="text-xs text-muted-foreground">
      Estimasi bukan tagihan provider. Server memeriksa kebutuhan kasus sebelum panggilan model.
      Eksekusi yang sudah dicadangkan tetap dihitung meskipun gagal, dibatalkan, diakui ketidakpastiannya, atau Workroom dihapus.
      Kuota chat tidak berubah.
    </p>
  </section>;
}
