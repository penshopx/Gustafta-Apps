import { useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const CONFIRMATION_TEXT = "MIGRASI TAUTAN PEMBAYARAN";

type PaymentLinkChange = {
  table: "store_products" | "agents";
  id: number;
  from: string;
  to: string;
};

type MigrationPreview = {
  oldOrigin: string;
  targetOrigin: string;
  count: number;
  ignored: number;
  changes: PaymentLinkChange[];
  fingerprint: string;
};

function validateOrigin(value: string): string | null {
  const input = value.trim();
  if (!input) return "Masukkan domain lama terlebih dahulu.";
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (input !== url.origin && input !== `${url.origin}/`)
    ) {
      return "Masukkan origin HTTPS saja, misalnya https://bayar.example.com.";
    }
    return null;
  } catch {
    return "Format domain tidak valid. Contoh: https://bayar.example.com.";
  }
}

function errorDetails(error: unknown): { status: number | null; message: string } {
  const raw = error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui.";
  const match = raw.match(/^(\d{3}):\s*([\s\S]*)$/);
  const status = match ? Number(match[1]) : null;
  let message = match?.[2] ?? raw;
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed?.error === "string") message = parsed.error;
  } catch {
    // apiRequest may return a plain-text server error; keep it readable as-is.
  }
  return { status, message };
}

function LinkUrl({ value }: { value: string }) {
  return <span className="block break-all font-mono text-xs leading-relaxed text-foreground">{value}</span>;
}

function EnabledPaymentLinkMigration() {
  const queryClient = useQueryClient();
  const [oldOrigin, setOldOrigin] = useState("");
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operationId = useRef(0);

  const originError = oldOrigin.trim() ? validateOrigin(oldOrigin) : null;
  const canPreview = !!oldOrigin.trim() && !originError && !pending;
  const canApply =
    !!preview &&
    preview.count > 0 &&
    confirmation === CONFIRMATION_TEXT &&
    !pending &&
    preview.oldOrigin === normalizeOrigin(oldOrigin);

  function normalizeOrigin(value: string) {
    try {
      return new URL(value.trim()).origin;
    } catch {
      return "";
    }
  }

  function handleOriginChange(value: string) {
    setOldOrigin(value);
    setPreview(null);
    setConfirmation("");
    setError(null);
    setNotice(null);
    operationId.current += 1;
  }

  async function requestPreview() {
    if (!canPreview) return;
    const requestId = ++operationId.current;
    const submittedOrigin = oldOrigin.trim();
    setPreview(null);
    setConfirmation("");
    setError(null);
    setNotice(null);
    setPending("preview");
    try {
      const result = (await apiRequest("POST", "/api/admin/payment-links/preview", {
        oldOrigin: submittedOrigin,
      })) as MigrationPreview;
      if (requestId !== operationId.current) return;
      if (
        !result ||
        typeof result.oldOrigin !== "string" ||
        typeof result.targetOrigin !== "string" ||
        !Array.isArray(result.changes) ||
        typeof result.fingerprint !== "string"
      ) {
        throw new Error("Respons pratinjau tidak lengkap. Silakan coba lagi.");
      }
      setPreview(result);
    } catch (caught) {
      if (requestId === operationId.current) {
        setError(errorDetails(caught).message || "Pratinjau gagal dimuat. Silakan coba lagi.");
      }
    } finally {
      if (requestId === operationId.current) setPending(null);
    }
  }

  async function applyMigration() {
    if (!canApply || !preview) return;
    const approvedPreview = preview;
    const requestId = ++operationId.current;
    setError(null);
    setNotice(null);
    setPending("apply");
    try {
      const result = await apiRequest("POST", "/api/admin/payment-links/apply", {
        oldOrigin: approvedPreview.oldOrigin,
        fingerprint: approvedPreview.fingerprint,
        confirmation: CONFIRMATION_TEXT,
      });
      if (requestId !== operationId.current) return;
      const updated =
        Number(result?.updated?.store_products ?? 0) + Number(result?.updated?.agents ?? 0);
      setPreview(null);
      setConfirmation("");
      setNotice(`${updated} tautan berhasil diperbarui. Katalog telah disegarkan.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/store/admin/products"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/store/catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/store/catalog/categories"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/store/catalog/modules"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/registry/store-catalog"] }),
      ]);
    } catch (caught) {
      if (requestId === operationId.current) {
        const details = errorDetails(caught);
        setPreview(null);
        setConfirmation("");
        if (details.status === 409) {
          setError(
            "Tautan berubah sejak pratinjau. Persetujuan lama dibatalkan; buat pratinjau baru dan tinjau seluruh perubahan sebelum menerapkan.",
          );
        } else {
          setError(
            `${details.message || "Hasil penerapan belum dapat dipastikan."} Persetujuan dibatalkan. Buat pratinjau baru dan tinjau ulang sebelum mencoba lagi.`,
          );
        }
      }
    } finally {
      if (requestId === operationId.current) setPending(null);
    }
  }

  function handleConfirmationChange(value: string) {
    setConfirmation(value);
    setError(null);
    setNotice(null);
  }

  return (
    <Card className="overflow-hidden border-border/80">
      <CardHeader className="border-b bg-muted/25 pb-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border bg-background p-2 text-primary">
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Migrasi domain checkout</CardTitle>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Periksa dan ganti tautan dengan origin lama yang persis cocok ke domain pembayaran
              aktif.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2.5">
            <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="leading-relaxed">
              Perubahan memengaruhi katalog yang sedang dipakai. Tautan manual dengan domain lama
              perlu diperiksa satu per satu sebelum disetujui.
            </p>
          </div>
          <p className="pl-[26px] leading-relaxed text-muted-foreground sm:pl-0">
            Riwayat pembayaran/order tidak berubah. Hanya tautan HTTPS dengan origin yang cocok
            persis yang diajukan.
          </p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void requestPreview();
          }}
        >
          <label htmlFor="payment-link-old-origin" className="text-sm font-medium">
            Origin domain lama
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="payment-link-old-origin"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://bayar-lama.example.com"
              value={oldOrigin}
              onChange={(event) => handleOriginChange(event.target.value)}
              disabled={pending !== null}
              aria-invalid={!!originError}
              aria-describedby="payment-link-origin-help payment-link-origin-error"
              data-testid="payment-link-old-origin"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!canPreview}
              className="shrink-0"
              data-testid="payment-link-preview"
            >
              {pending === "preview" ? (
                <><LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Memeriksa</>
              ) : (
                "Buat pratinjau"
              )}
            </Button>
          </div>
          <p id="payment-link-origin-help" className="text-xs leading-relaxed text-muted-foreground">
            Gunakan origin HTTPS saja, tanpa path, parameter, atau fragmen. Contoh:{" "}
            <code className="rounded bg-muted px-1 py-0.5">https://bayar.example.com</code>
          </p>
          {originError && (
            <p id="payment-link-origin-error" role="alert" className="text-sm text-destructive" data-testid="payment-link-origin-error">
              {originError}
            </p>
          )}
        </form>

        {error && (
          <div role="alert" className="flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="payment-link-error">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="leading-relaxed">{error}</p>
          </div>
        )}
        {notice && (
          <div role="status" className="flex gap-2.5 rounded-md border border-emerald-600/25 bg-emerald-600/5 p-3 text-sm" data-testid="payment-link-success">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <p className="leading-relaxed">{notice}</p>
          </div>
        )}

        {preview && (
          <section aria-labelledby="payment-link-review-title" className="space-y-4" data-testid="payment-link-preview-results">
            <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-x-8">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Origin lama</p>
                  <p className="mt-1 break-all font-mono text-xs">{preview.oldOrigin}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Origin tujuan</p>
                  <p className="mt-1 break-all font-mono text-xs">{preview.targetOrigin}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-5 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Akan diubah</p>
                  <p className="mt-0.5 text-xl font-semibold tabular-nums" data-testid="payment-link-change-count">{preview.count}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Diabaikan</p>
                  <p className="mt-0.5 text-xl font-semibold tabular-nums" data-testid="payment-link-ignored-count">{preview.ignored}</p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <h3 id="payment-link-review-title" className="text-sm font-semibold">Tinjau perubahan</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                “Diabaikan” mencakup tautan dari domain lain maupun tautan yang tidak valid. Tidak
                ada yang ikut diubah.
              </p>
            </div>

            {preview.count === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center" data-testid="payment-link-empty">
                <p className="text-sm font-medium">Tidak ada tautan yang cocok untuk diubah.</p>
                <p className="mt-1 text-xs text-muted-foreground">Tidak ada penerapan yang dapat dilakukan untuk pratinjau ini.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <div className="hidden grid-cols-[105px_1fr_1fr] gap-4 bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                  <span>Catatan</span><span>Dari</span><span>Menjadi</span>
                </div>
                <ol className="divide-y" aria-label="Daftar tautan pembayaran yang akan berubah" data-testid="payment-link-changes">
                  {preview.changes.map((change) => (
                    <li key={`${change.table}-${change.id}`} className="grid gap-2 p-3 md:grid-cols-[105px_1fr_1fr] md:gap-4">
                      <div className="flex items-center justify-between gap-2 md:block">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:hidden">Tabel / ID</span>
                        <span className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
                          {change.table === "store_products" ? "Produk" : "Agen"} · {change.id}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:hidden">Dari</p>
                        <LinkUrl value={change.from} />
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:hidden">Menjadi</p>
                        <LinkUrl value={change.to} />
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {preview.count > 0 && (
              <div className="space-y-3 rounded-lg border border-amber-600/25 bg-amber-500/[0.04] p-3 sm:p-4">
                <div>
                  <label htmlFor="payment-link-confirmation" className="text-sm font-semibold">
                    Konfirmasi penerapan
                  </label>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Setelah semua URL ditinjau, ketik tepat{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-semibold">{CONFIRMATION_TEXT}</code>
                    {" "}untuk mengaktifkan tombol penerapan.
                  </p>
                </div>
                <Input
                  id="payment-link-confirmation"
                  value={confirmation}
                  onChange={(event) => handleConfirmationChange(event.target.value)}
                  disabled={pending !== null}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="payment-link-confirmation-help"
                  data-testid="payment-link-confirmation"
                />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p id="payment-link-confirmation-help" className="text-xs text-muted-foreground">
                    Penerapan terikat pada origin dan fingerprint pratinjau ini.
                  </p>
                  <Button
                    type="button"
                    onClick={() => void applyMigration()}
                    disabled={!canApply}
                    variant="destructive"
                    data-testid="payment-link-apply"
                  >
                    {pending === "apply" ? (
                      <><LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Menerapkan</>
                    ) : (
                      "Terapkan perubahan"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminPaymentLinkMigration({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <EnabledPaymentLinkMigration />;
}
