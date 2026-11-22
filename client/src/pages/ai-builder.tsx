import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronRight,
  CircleUserRound,
  Compass,
  Cpu,
  Layers3,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

type OwnedAgent = {
  id: number;
  name: string;
  tagline: string | null;
  avatar: string | null;
  createdAt: string | null;
  clonedFromAgentId: string | null;
};

type TemplateAgent = {
  id: number;
  name: string;
  tagline: string | null;
  avatar: string | null;
};

type CloneResponse = {
  agent: {
    id: number;
    name: string;
  };
  reused?: boolean;
};

function getErrorStatus(error: unknown) {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/^(\d{3}):/);
  return match ? Number(match[1]) : null;
}

function localizedError(error: unknown, fallback: string) {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) return "Anda tidak memiliki izin untuk mengakses data ini.";
  if (status === 404) return "Data yang diminta tidak ditemukan.";
  if (status && status >= 500) return "Terjadi gangguan pada server. Silakan coba lagi.";
  return fallback;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function AgentAvatar({ src, name, size = "normal" }: { src: string | null; name: string; size?: "normal" | "large" }) {
  const sizeClass = size === "large" ? "h-14 w-14 rounded-2xl text-base" : "h-11 w-11 rounded-xl text-sm";
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-sky-200/70 bg-sky-100 text-sky-800 ${sizeClass}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-semibold tracking-wide">{initials(name)}</span>
      )}
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
        <div>
          <p className="font-semibold text-slate-900">Bagian ini tidak dapat dimuat</p>
          <p className="mt-1 text-sm text-slate-600">{message}</p>
        </div>
      </div>
      <Button variant="outline" onClick={onRetry} className="shrink-0 border-rose-300 bg-white text-rose-900 hover:bg-rose-100">
        <RefreshCw className="mr-2 h-4 w-4" />
        Coba lagi
      </Button>
    </div>
  );
}

function AgentSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-slate-100" />
        <div className="flex-1">
          <div className="h-4 w-36 rounded bg-slate-100" />
          <div className="mt-2 h-3 w-52 max-w-full rounded bg-slate-100" />
        </div>
      </div>
      <div className="mt-6 h-9 w-full rounded-lg bg-slate-100" />
    </div>
  );
}

function SectionEyebrow({ children }: { children: string }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">{children}</p>;
}

export default function AiBuilderPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [cloningTemplateId, setCloningTemplateId] = useState<number | null>(null);

  const mineQuery = useQuery<OwnedAgent[]>({
    queryKey: ["/api/ai-builder/mine"],
    queryFn: () => apiRequest("GET", "/api/ai-builder/mine"),
    enabled: isAuthenticated,
  });
  const templatesQuery = useQuery<TemplateAgent[]>({
    queryKey: ["/api/ai-builder/templates"],
    queryFn: () => apiRequest("GET", "/api/ai-builder/templates"),
    enabled: isAuthenticated,
  });
  const ownedAgents = mineQuery.data ?? [];
  const specialistTemplates = templatesQuery.data ?? [];

  const cloneMutation = useMutation({
    mutationFn: (template: TemplateAgent) => {
      setCloningTemplateId(template.id);
      return apiRequest("POST", `/api/ai-builder/templates/${template.id}/clone`);
    },
    onSuccess: async (result: CloneResponse) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ai-builder/mine"] });
      toast({
        title: result.reused ? "Versi pribadi dibuka" : "Salinan privat berhasil dibuat",
        description: `${result.agent.name} siap digunakan di ruang kerja Anda.`,
      });
      setLocation(`/dashboard?agent=${result.agent.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Salinan privat tidak dapat dibuat",
        description: localizedError(error, "Terjadi kendala. Silakan coba lagi."),
        variant: "destructive",
      });
    },
    onSettled: () => setCloningTemplateId(null),
  });

  return (
    <main className="min-h-[100dvh] bg-[#edf5fc] text-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-40 -top-44 h-[32rem] w-[32rem] rounded-full bg-sky-200/35 blur-3xl" />
        <div className="absolute -left-52 top-[48rem] h-[30rem] w-[30rem] rounded-full bg-blue-100/70 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-[1400px] px-4 pb-16 pt-5 sm:px-7 lg:px-10">
        <header className="flex items-center justify-between border-b border-slate-200/80 pb-5">
          <Link href="/dashboard" className="group flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#101c2e] text-sky-100 shadow-sm">
              <Cpu className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight text-slate-950">Gustafta</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">Ruang kerja AI Builder</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/75 px-3 py-1.5 text-xs font-semibold text-slate-600">
            <ShieldCheck className="h-4 w-4 text-sky-700" />
            AI Builder
          </div>
        </header>

        {authLoading ? (
          <section className="mx-auto mt-20 max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-800">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <h1 className="mt-5 text-xl font-bold">Memeriksa akses ruang kerja</h1>
            <p className="mt-2 text-sm text-slate-600">Memeriksa sesi dan status akun Anda.</p>
          </section>
        ) : !isAuthenticated ? (
          <section className="mx-auto mt-20 max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_20px_70px_-40px_rgba(15,23,42,.35)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#101c2e] text-sky-100">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <SectionEyebrow>Masuk diperlukan</SectionEyebrow>
            <h1 className="mt-3 text-2xl font-bold tracking-tight">Masuk untuk menggunakan AI Builder</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-600">
              Akun aktif diperlukan untuk merancang sistem AI dan menyimpan hasilnya di ruang kerja pribadi.
            </p>
            <Link href="/login?redirect=%2Fai-builder" className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-[#101c2e] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
              Masuk <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        ) : (
          <>
            <section className="relative mt-8 overflow-hidden rounded-[28px] bg-[#101c2e] px-6 py-8 text-white shadow-[0_24px_70px_-38px_rgba(15,23,42,.8)] sm:px-10 sm:py-10 lg:px-12">
              <div className="absolute inset-y-0 right-0 hidden w-[45%] overflow-hidden md:block" aria-hidden="true">
                <div className="absolute right-12 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full border border-sky-300/20" />
                <div className="absolute right-24 top-1/2 h-52 w-52 -translate-y-1/2 rounded-full border border-sky-300/25" />
                <div className="absolute right-36 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full border border-sky-300/30" />
                <div className="absolute right-[8.5rem] top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-2xl bg-sky-300 text-[#101c2e] shadow-[0_0_0_12px_rgba(125,211,252,.08)]">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className="absolute right-20 top-[22%] h-2 w-2 rounded-full bg-sky-200" />
                <div className="absolute right-56 bottom-[23%] h-1.5 w-1.5 rounded-full bg-blue-300" />
              </div>
              <div className="relative max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-sky-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                  Ruang kerja pembuatan privat
                </div>
                <h1 className="mt-6 max-w-xl text-4xl font-semibold leading-[1.04] tracking-[-0.04em] sm:text-5xl">
                  Bangun sistem AI <span className="text-sky-300">untuk mendukung pekerjaan.</span>
                </h1>
                <p className="mt-5 max-w-lg text-sm leading-6 text-slate-300 sm:text-base">
                  Rangkai sistem untuk organisasi, mulai dari spesialis yang tersedia, atau buat salinan privat untuk pemilik tertentu.
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-300">
                  <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-sky-300" /> Tersedia untuk akun aktif</span>
                </div>
              </div>
            </section>

            <section className="mt-9">
              <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                <div>
                  <SectionEyebrow>Pilih titik awal</SectionEyebrow>
                  <h2 className="mt-1.5 text-2xl font-bold tracking-tight">Bangun sistem baru</h2>
                </div>
                <p className="text-sm text-slate-600">Pilih cara pembuatan yang sesuai kebutuhan.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Link href="/blueprint-builder" className="group relative flex min-h-[190px] flex-col justify-between overflow-hidden rounded-2xl border border-sky-200 bg-white p-6 shadow-[0_10px_34px_-28px_rgba(15,23,42,.42)] transition-all hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-[0_18px_40px_-28px_rgba(2,132,199,.32)]">
                  <div className="absolute -right-5 -top-8 h-36 w-36 rounded-full bg-sky-50 transition-transform group-hover:scale-110" />
                  <div className="relative flex items-start justify-between">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#101c2e] text-sky-200"><Plus className="h-5 w-5" /></span>
                    <ArrowUpRight className="h-5 w-5 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-sky-700" />
                  </div>
                  <div className="relative mt-7">
                    <h3 className="text-lg font-bold tracking-tight">Bangun sistem secara manual</h3>
                    <p className="mt-1.5 max-w-sm text-sm leading-5 text-slate-600">Blueprint Builder memandu pembuatan sistem AI melalui empat langkah inti.</p>
                  </div>
                </Link>

                <Link href="/organization-builder" className="group relative flex min-h-[190px] flex-col justify-between overflow-hidden rounded-2xl border border-sky-200 bg-white p-6 shadow-[0_10px_34px_-28px_rgba(15,23,42,.42)] transition-all hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-[0_18px_40px_-28px_rgba(2,132,199,.32)]">
                  <div className="absolute -right-5 -top-8 h-36 w-36 rounded-full bg-sky-50 transition-transform group-hover:scale-110" />
                  <div className="relative flex items-start justify-between">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-900"><UsersRound className="h-5 w-5" /></span>
                    <ArrowUpRight className="h-5 w-5 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-sky-700" />
                  </div>
                  <div className="relative mt-7">
                    <h3 className="text-lg font-bold tracking-tight">Susun hierarki tim</h3>
                    <p className="mt-1.5 max-w-sm text-sm leading-5 text-slate-600">Hierarki tim adalah level lanjutan kelima yang opsional untuk membentuk organisasi spesialis AI.</p>
                  </div>
                </Link>
              </div>
            </section>

            <section className="mt-12">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end">
                <div>
                  <SectionEyebrow>Ruang kerja Anda</SectionEyebrow>
                  <h2 className="mt-1.5 text-2xl font-bold tracking-tight">Sistem AI milik Anda</h2>
                </div>
                {mineQuery.isSuccess && (
                  <span className="text-sm font-medium text-slate-500">{ownedAgents.length} sistem</span>
                )}
              </div>

              {mineQuery.isLoading ? (
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <AgentSkeleton /><AgentSkeleton /><AgentSkeleton />
                </div>
              ) : mineQuery.isError ? (
                <div className="mt-5">
                  <InlineError
                    message={localizedError(mineQuery.error, "Gangguan koneksi membuat sistem Anda tidak dapat dimuat.")}
                    onRetry={() => void mineQuery.refetch()}
                  />
                </div>
              ) : ownedAgents.length === 0 ? (
                <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/65 px-6 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"><Boxes className="h-5 w-5" /></div>
                  <h3 className="mt-4 text-base font-bold">Ruang kerja Anda siap</h3>
                  <p className="mt-1 max-w-sm text-sm leading-5 text-slate-600">Sistem yang Anda buat atau sesuaikan secara privat akan muncul di sini.</p>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {ownedAgents.map((agent) => (
                    <Link
                      key={agent.id}
                      href={`/dashboard?agent=${agent.id}`}
                      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_-26px_rgba(15,23,42,.4)] transition-all hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_18px_40px_-28px_rgba(2,132,199,.3)]"
                    >
                      <div className="flex items-start gap-3.5">
                        <AgentAvatar src={agent.avatar} name={agent.name} />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-bold text-slate-950">{agent.name}</h3>
                          <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">{agent.tagline || "Sistem AI"}</p>
                        </div>
                      </div>
                      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3.5">
                        <span className="text-xs font-medium text-slate-500">
                          {agent.clonedFromAgentId ? "Kustomisasi privat" : "Sistem milik Anda"}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-800 group-hover:text-sky-950">
                          Buka sistem <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-12">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end">
                <div>
                  <SectionEyebrow>Mulai dari spesialis</SectionEyebrow>
                  <h2 className="mt-1.5 text-2xl font-bold tracking-tight">Kustomisasi privat</h2>
                  <p className="mt-1.5 max-w-xl text-sm leading-5 text-slate-600">Kloning AI Specialist sistem ke ruang kerja Anda, lalu lanjutkan di salinan milik Anda.</p>
                </div>
                {templatesQuery.isSuccess && (
                  <span className="text-sm font-medium text-slate-500">{specialistTemplates.length} tersedia</span>
                )}
              </div>

              {templatesQuery.isLoading ? (
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <AgentSkeleton /><AgentSkeleton /><AgentSkeleton />
                </div>
              ) : templatesQuery.isError ? (
                <div className="mt-5">
                  <InlineError
                    message={localizedError(templatesQuery.error, "Gangguan koneksi membuat daftar spesialis tidak dapat dimuat.")}
                    onRetry={() => void templatesQuery.refetch()}
                  />
                </div>
              ) : specialistTemplates.length === 0 ? (
                <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/65 px-6 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-800"><Compass className="h-5 w-5" /></div>
                  <h3 className="mt-4 text-base font-bold">Belum ada spesialis</h3>
                  <p className="mt-1 max-w-sm text-sm leading-5 text-slate-600">Claw sistem muncul di sini jika tercakup lisensi individual atau paket aktif Anda.</p>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {specialistTemplates.map((template) => {
                    const isCloning = cloneMutation.isPending && cloningTemplateId === template.id;
                    return (
                      <article key={template.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_-26px_rgba(15,23,42,.4)] transition-all hover:border-sky-300">
                        <div className="flex items-start gap-3.5">
                          <AgentAvatar src={template.avatar} name={template.name} />
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate font-bold text-slate-950">{template.name}</h3>
                            <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">{template.tagline || "AI Specialist sistem"}</p>
                          </div>
                        </div>
                        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                            <CircleUserRound className="h-3.5 w-3.5" /> Salinan pemilik
                          </span>
                          <Button
                            size="sm"
                            onClick={() => cloneMutation.mutate(template)}
                            disabled={cloneMutation.isPending}
                            className="bg-[#101c2e] text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            {isCloning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                            {isCloning ? "Membuat salinan…" : "Kustomisasi"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {cloneMutation.isError && (
                <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{localizedError(cloneMutation.error, "Salinan privat tidak dapat dibuat. Silakan coba lagi.")}</span>
                </div>
              )}
              {cloneMutation.isSuccess && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                  <Check className="h-4 w-4" /> Salinan privat berhasil dibuat. Membuka ruang kerja pemilik…
                </div>
              )}
            </section>

            <footer className="mt-14 flex flex-col gap-4 border-t border-slate-200 pt-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <p>AI Builder digunakan untuk merangkai dan mengustomisasi sistem. Store tetap menjadi katalog terpisah untuk AI siap pakai.</p>
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600"><Layers3 className="h-3.5 w-3.5" /> Perangkat internal Gustafta</span>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
