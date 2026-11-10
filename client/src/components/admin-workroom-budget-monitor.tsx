import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { WorkroomBudgetMonitor } from "@shared/workroom-budget-monitor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const money = (microUsd: number) => `USD ${(microUsd / 1_000_000).toFixed(4)}`;

function formatDateTime(value: string | null, timezone = "Asia/Jakarta") {
  if (!value) return "Belum ada catatan";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date) + " WIB";
}

function Stat({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string;
  detail?: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4" data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function AdminWorkroomBudgetMonitor({ enabled }: { enabled: boolean }) {
  const { data, isPending, isError, isFetching, refetch } = useQuery<WorkroomBudgetMonitor>({
    queryKey: ["/api/admin/workroom-analysis-budget"],
    queryFn: async () => {
      const response = await fetch("/api/admin/workroom-analysis-budget", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Gagal memuat pemantauan anggaran Workroom.");
      return response.json() as Promise<WorkroomBudgetMonitor>;
    },
    enabled,
    retry: false,
  });

  if (!enabled) return null;

  const refresh = () => {
    if (!isFetching) void refetch();
  };

  return (
    <Card data-testid="workroom-budget-monitor" aria-label="Pemantauan anggaran analisis Workroom">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-lg">Anggaran analisis Workroom</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pemantauan cadangan harian untuk penggunaan model dalam Workroom.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={isFetching}
          aria-label={isFetching ? "Memperbarui anggaran Workroom" : "Perbarui anggaran Workroom"}
          data-testid="button-refresh-workroom-budget"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          {isFetching ? "Memperbarui" : "Perbarui"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {isPending && !isError ? (
          <div className="space-y-3" role="status" aria-live="polite" data-testid="workroom-budget-loading">
            <p className="text-sm text-muted-foreground">Memuat ringkasan anggaran…</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-24 animate-pulse rounded-lg border bg-muted/50" />
              ))}
            </div>
          </div>
        ) : isError || !data ? (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
            role="alert"
            data-testid="workroom-budget-error"
          >
            <p className="font-medium">Ringkasan anggaran belum dapat dimuat.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Data sebelumnya disembunyikan agar angka yang ditampilkan tidak kedaluwarsa. Coba perbarui secara manual.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={refresh}
              disabled={isFetching}
              className="mt-3"
              data-testid="button-retry-workroom-budget"
            >
              Coba lagi
            </Button>
          </div>
        ) : (
          <>
            <div
              className="flex flex-col gap-1 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="workroom-budget-period"
            >
              <p className="font-medium">
                Hari WIB: <time dateTime={data.day}>{data.day}</time>
              </p>
              <p className="text-sm text-muted-foreground">
                Reset berikutnya{" "}
                <time dateTime={data.nextResetAt}>{formatDateTime(data.nextResetAt, data.timezone)}</time>
              </p>
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Panggilan dicadangkan"
                value={data.callsReserved.toLocaleString("id-ID")}
                detail="Jumlah percobaan yang dicadangkan"
                testId="workroom-budget-calls-reserved"
              />
              <Stat
                label="Akun aktif"
                value={data.activeAccounts.toLocaleString("id-ID")}
                detail="Akun dengan cadangan analisis"
                testId="workroom-budget-active-accounts"
              />
              <Stat
                label="Cadangan estimasi"
                value={money(data.reservedMicroUsd)}
                detail={`Sisa global: ${money(data.remainingMicroUsd)}`}
                testId="workroom-budget-reserved"
              />
              <Stat
                label="Batas global harian"
                value={money(data.globalLimitMicroUsd)}
                detail="Estimasi gabungan seluruh Workroom"
                testId="workroom-budget-global-limit"
              />
            </dl>

            <section aria-labelledby="workroom-account-limits-heading" className="space-y-2">
              <h3 id="workroom-account-limits-heading" className="text-sm font-semibold">
                Batas per akun
              </h3>
              <dl className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Percobaan analisis per hari</dt>
                  <dd className="mt-1 font-medium tabular-nums" data-testid="workroom-budget-account-call-limit">
                    {data.accountCallLimit.toLocaleString("id-ID")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Batas estimasi per akun per hari</dt>
                  <dd className="mt-1 font-medium tabular-nums" data-testid="workroom-budget-account-usd-limit">
                    {money(data.accountLimitMicroUsd)}
                  </dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="workroom-rejections-heading" className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="workroom-rejections-heading" className="text-sm font-semibold">
                  Penolakan permintaan HTTP
                </h3>
                <p className="text-sm font-semibold tabular-nums" data-testid="workroom-budget-rejections-total">
                  Total tercatat: {data.rejections.total.toLocaleString("id-ID")}
                </p>
              </div>
              <dl className="divide-y rounded-lg border">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm">Batas jumlah panggilan akun</dt>
                  <dd className="font-medium tabular-nums" data-testid="workroom-budget-rejections-account-calls">
                    {data.rejections.accountCalls.toLocaleString("id-ID")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm">Estimasi anggaran akun</dt>
                  <dd className="font-medium tabular-nums" data-testid="workroom-budget-rejections-account-estimate">
                    {data.rejections.accountEstimate.toLocaleString("id-ID")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm">Estimasi anggaran Workroom gabungan</dt>
                  <dd className="font-medium tabular-nums" data-testid="workroom-budget-rejections-platform-estimate">
                    {data.rejections.platformEstimate.toLocaleString("id-ID")}
                  </dd>
                </div>
              </dl>
              <dl className="grid grid-cols-1 gap-3 pt-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Catatan pertama</dt>
                  <dd className="mt-1" data-testid="workroom-budget-rejections-first">
                    {formatDateTime(data.rejections.firstRecordedAt, data.timezone)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Catatan terakhir</dt>
                  <dd className="mt-1" data-testid="workroom-budget-rejections-last">
                    {formatDateTime(data.rejections.lastRecordedAt, data.timezone)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Pencatatan penolakan dimulai bersama pembaruan ini; permintaan HTTP yang ditolak berulang kali dihitung
                lagi. Nilai nol berarti belum ada penolakan yang tercatat, bukan bukti tidak pernah ada penolakan sebelumnya.
              </p>
            </section>

            <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
              <p>
                Cakupan native Workroom saja; tidak mencakup penggunaan model di luar Workroom. Panggilan dicadangkan
                adalah jumlah percobaan, bukan jaminan analisis selesai.
              </p>
              <p>
                Angka biaya adalah estimasi konservatif, bukan tagihan provider. Cadangan tidak dikembalikan jika
                analisis gagal atau dibatalkan, maupun jika Workroom dihapus.
              </p>
              <p>
                Model {data.model} · versi harga {data.pricingVersion} · diperiksa{" "}
                <time dateTime={data.pricingCheckedOn}>{data.pricingCheckedOn}</time>.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
