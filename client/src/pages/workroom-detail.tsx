import { useEffect, useRef, useState } from "react";
import { WORKROOM_ANALYSIS_POLICY, type WorkroomAnalysisExecution } from "@shared/workroom-analysis-policy";
import { WorkroomAnalysisHistory } from "@/components/workroom-analysis-history";
import { WorkroomAnalysisBudget } from "@/components/workroom-analysis-budget";
import type { WorkroomBudgetSnapshot } from "@shared/workroom-budget-policy";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { blockingWorkroomGates, type WorkroomReviewExpectation, type WorkroomSourceState } from "@shared/workroom-transitions";
import { WorkroomSourcePanel } from "@/components/workroom-source-panel";
import { WorkroomSourceVersions } from "@/components/workroom-source-versions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, CheckCircle2, Circle, CircleDot, Sparkles,
  ShieldQuestion, Check, X, Plus, FileText, GraduationCap,
} from "lucide-react";
import { workroomDomainMeta } from "@/lib/workroom-domains";

interface Stage { key: string; label: string; status: string; }
interface Gate { id: number; question: string; status: string; note: string; stageKey: string; }
interface Log { id: number; type: string; content: string; meta: any; createdAt: string; }
interface WorkroomDetail {
  id: number; title: string; domain: string; status: string;
  reviewRevision: number; reviewFingerprint: string;
  sources: WorkroomSourceState[];
  deletionPending?: boolean;
  analysisExecutions?: WorkroomAnalysisExecution[];
  currentStage: number; stages: Stage[]; context: any;
  gates: Gate[]; logs: Log[];
}

const LOG_STYLE: Record<string, { label: string; cls: string }> = {
  decision:    { label: "Keputusan",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  assumption:  { label: "Asumsi",     cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  risk:        { label: "Risiko",     cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  change:      { label: "Perubahan",  cls: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  note:        { label: "Catatan",    cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  deliverable: { label: "Deliverable", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

export default function WorkroomDetailPage() {
  const { id } = useParams();
  const { toast } = useToast();
  const key = ["/api/workrooms", id];

  const [logType, setLogType] = useState("note");
  const [logContent, setLogContent] = useState("");
  const [gateQuestion, setGateQuestion] = useState("");
  const analysisController = useRef<AbortController | null>(null);
  useEffect(() => () => { analysisController.current?.abort(); analysisController.current = null; }, [id]);

  const { data: room, isLoading, isError } = useQuery<WorkroomDetail | null>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/workrooms/${id}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Gagal memuat workroom (${res.status})`);
      return res.json();
    },
  });

  const budgetQuery = useQuery<WorkroomBudgetSnapshot>({
    queryKey: [...key, "analysis-budget"], enabled: !!id && !!room, retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/workrooms/${id}/analysis-budget`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Batas harian belum dapat diverifikasi.");
      return response.json();
    },
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["/api/workrooms"] });
  };

  const reviewExpectation = () => ({
    expectedReviewRevision: room?.reviewRevision,
    expectedReviewFingerprint: room?.reviewFingerprint,
  });
  const reviewError = (e: any) => {
    // Read the current snapshot, never retry the human decision automatically.
    refresh();
    toast({ title: "Tinjauan belum tersimpan", description: e?.message, variant: "destructive" });
  };

  const advanceMutation = useMutation({
    retry: false,
    mutationFn: async ({ stageIndex, ...expected }: { stageIndex: number } & WorkroomReviewExpectation) =>
      apiRequest("PATCH", `/api/workrooms/${id}`, { currentStage: stageIndex, ...expected }),
    onSuccess: () => { refresh(); },
    onError: (e: any) => toast({ title: "Gagal", description: e?.message, variant: "destructive" }),
  });

  const addLogMutation = useMutation({
    retry: false,
    mutationFn: async (entry: { type: string; content: string } & WorkroomReviewExpectation) =>
      apiRequest("POST", `/api/workrooms/${id}/log`, entry),
    onSuccess: () => { setLogContent(""); refresh(); },
    onError: reviewError,
  });

  const addGateMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/workrooms/${id}/gate`, { question: gateQuestion }),
    onSuccess: () => { setGateQuestion(""); refresh(); toast({ title: "Gerbang dibuat" }); },
    onError: (e: any) => toast({ title: "Gagal", description: e?.message, variant: "destructive" }),
  });

  const decideGateMutation = useMutation({
    retry: false,
    mutationFn: async ({ gateId, ...decision }: { gateId: number; status: string } & WorkroomReviewExpectation) =>
      apiRequest("POST", `/api/workrooms/${id}/gate/${gateId}/decide`, decision),
    onSuccess: () => { refresh(); },
    onError: reviewError,
  });

  const analyzeMutation = useMutation({
    retry: false,
    mutationFn: async ({ expected, controller, executionId }: {
      expected: WorkroomReviewExpectation; controller: AbortController; executionId: string;
    }) => apiRequest("POST", `/api/workrooms/${id}/analyze`, expected,
      { signal: controller.signal, headers: { "Idempotency-Key": executionId } }),
    onSuccess: (data) => { refresh(); toast({ title: data?.replayed ? "Hasil sudah tersimpan" : "Analisis selesai",
      description: "Hasil tersedia sebagai deliverable." }); },
    onError: (error: any, variables) => {
      if (variables.controller.signal.aborted) {
        refresh();
        toast({ title: "Permintaan dihentikan", description: "Periksa riwayat sebelum mengulangi; hasil yang sudah tersimpan tidak dibatalkan." });
      } else {
        refresh();
        toast({ title: "Analisis belum tuntas", description: error?.message, variant: "destructive" });
      }
    },
    onSettled: (_data, _error, variables) => {
      if (analysisController.current === variables.controller) analysisController.current = null;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (isError || !room) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4">
        <p className="text-slate-400" data-testid="text-workroom-error">
          {isError ? "Gagal memuat workroom. Coba lagi atau periksa akses Anda." : "Workroom tidak ditemukan."}
        </p>
        <Button asChild variant="outline"><Link href="/workroom">Kembali ke daftar</Link></Button>
      </div>
    );
  }

  const stages = room.stages || [];
  const sourcesUnavailable = room.sources?.some(source => source.availability !== "available") ?? false;
  if (room.deletionPending) return <main className="max-w-3xl mx-auto p-6">
    <WorkroomSourceVersions workroomId={id!} hasSources={false} deletionPending
      reviewRevision={room.reviewRevision} reviewFingerprint={room.reviewFingerprint} onRefresh={refresh} />
  </main>;
  const gates = room.gates || [];
  const logs = room.logs || [];
  const meta = workroomDomainMeta(room.domain);
  const ctxSummary = meta.fields
    .filter((f) => !f.textarea)
    .map((f) => room.context?.[f.key])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm" className="text-slate-300">
            <Link href="/workroom" data-testid="button-back-list">
              <ArrowLeft className="h-4 w-4 mr-2" /> Daftar Workroom
            </Link>
          </Button>
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30" data-testid="badge-domain">{meta.short}</Badge>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-1" data-testid="text-workroom-title">{room.title}</h1>
        {ctxSummary.length > 0 && (
          <p className="text-slate-400 text-sm mb-6" data-testid="text-context-summary">
            {ctxSummary.join(" · ")}
          </p>
        )}
        {room.context?.source === "capstone" && room.context?.courseId && (
          <Link
            href={`/lms/course/${room.context.courseId}`}
            className="inline-flex items-center gap-2 mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/20 transition-colors"
            data-testid="link-capstone-course"
          >
            <GraduationCap className="h-4 w-4" />
            Capstone dari kursus: {room.context.courseTitle || "Academy"} — kembali ke kursus
          </Link>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Stages */}
          <Card className="bg-slate-900 border-slate-800 lg:col-span-1">
            <CardHeader><CardTitle className="text-base">Tahapan Kerja</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {stages.map((s, i) => {
                const blocked = (i > room.currentStage && sourcesUnavailable) ||
                  blockingWorkroomGates(stages, room.currentStage, room.gates || [], i).length > 0;
                const Icon = s.status === "done" ? CheckCircle2 : s.status === "active" ? CircleDot : Circle;
                const color = s.status === "done" ? "text-emerald-400" : s.status === "active" ? "text-sky-400" : "text-slate-600";
                return (
                  <button
                    key={s.key}
                    onClick={() => advanceMutation.mutate({ stageIndex: i, ...reviewExpectation() })}
                    disabled={advanceMutation.isPending || blocked}
                    title={blocked ? "Gerbang manusia harus disetujui sebelum melanjutkan." : undefined}
                    className="w-full flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-slate-800/60 text-left"
                    data-testid={`stage-${s.key}`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                    <span className={`text-sm ${s.status === "pending" ? "text-slate-400" : "text-slate-100"}`}>{s.label}</span>
                  </button>
                );
              })}
              <p className="text-xs text-slate-400 pt-2 px-2">Klik tahap untuk mengaktifkannya. Tahap berikutnya terkunci bila gerbang manusia belum disetujui.</p>
            </CardContent>
          </Card>

          {/* Middle: AI + Gates */}
          <div className="lg:col-span-2 space-y-6">
            <WorkroomSourceVersions workroomId={id!} hasSources={!!room.sources?.length}
              reviewRevision={room.reviewRevision} reviewFingerprint={room.reviewFingerprint} onRefresh={refresh} />
            <WorkroomSourcePanel workroomId={id!} sources={room.sources || []}
              reviewRevision={room.reviewRevision} reviewFingerprint={room.reviewFingerprint} onSaved={refresh} />
            {/* AI Analyze */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" /> {meta.analyzeHeading}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">
                  {meta.analyzeDesc} Keputusan akhir tetap di tangan Anda (◆ gerbang manusia).
                </p>
                <Button
                  onClick={() => {
                    if (analysisController.current) return;
                    const controller = new AbortController();
                    analysisController.current = controller;
                    analyzeMutation.mutate({ expected: reviewExpectation(), controller, executionId: crypto.randomUUID() });
                  }}
                  disabled={analyzeMutation.isPending || sourcesUnavailable || room.status !== "active" ||
                    room.analysisExecutions?.some(execution => ["running", "uncertain"].includes(execution.status)) ||
                    budgetQuery.isError || !budgetQuery.data?.available}
                  className="bg-emerald-600 hover:bg-emerald-500"
                  data-testid="button-analyze"
                >
                  {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Jalankan Analisis
                </Button>
                {analyzeMutation.isPending && <Button variant="outline" className="ml-2"
                  data-testid="button-cancel-analysis" onClick={() => analysisController.current?.abort()}>
                  Hentikan permintaan
                </Button>}
                <p className="text-xs text-muted-foreground mt-2">
                  {WORKROOM_ANALYSIS_POLICY.model} · maksimal {WORKROOM_ANALYSIS_POLICY.timeoutMs / 1000} detik per panggilan
                  · tanpa pengulangan otomatis atau tindakan eksternal. Perubahan tinjauan menolak hasil yang terlambat.
                </p>
                <WorkroomAnalysisHistory workroomId={id!} executions={room.analysisExecutions || []} onRefresh={refresh} />
                <WorkroomAnalysisBudget budget={budgetQuery.data} failed={budgetQuery.isError} onRefresh={refresh} />
              </CardContent>
            </Card>

            {/* Human Gates */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldQuestion className="h-4 w-4 text-amber-400" /> Gerbang Manusia ◆
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-slate-400" data-testid="text-review-version">
                  Versi tinjauan {room.reviewRevision}. Persetujuan berlaku untuk konteks dan hasil pada versi ini.
                  Perubahan konteks, judul, atau hasil akan meminta persetujuan ulang.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={gateQuestion}
                    onChange={(e) => setGateQuestion(e.target.value)}
                    placeholder="mis. Setujui submit penawaran tender ini?"
                    className="bg-slate-950 border-slate-700"
                    data-testid="input-gate-question"
                  />
                  <Button
                    onClick={() => addGateMutation.mutate()}
                    disabled={addGateMutation.isPending || gateQuestion.trim().length < 3}
                    variant="outline"
                    className="border-slate-700 shrink-0"
                    data-testid="button-add-gate"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {gates.length === 0 ? (
                  <p className="text-sm text-slate-600">Belum ada gerbang persetujuan.</p>
                ) : (
                  gates.map((g) => (
                    <div key={g.id} className="border border-slate-800 rounded-lg p-3" data-testid={`gate-${g.id}`}>
                      <p className="text-sm mb-2">{g.question}</p>
                      {g.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => decideGateMutation.mutate({ gateId: g.id, status: "approved", ...reviewExpectation() })}
                            disabled={decideGateMutation.isPending || sourcesUnavailable}
                            className="bg-emerald-600 hover:bg-emerald-500 h-8"
                            data-testid={`button-approve-${g.id}`}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" /> Setujui
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => decideGateMutation.mutate({ gateId: g.id, status: "rejected", ...reviewExpectation() })}
                            disabled={decideGateMutation.isPending}
                            className="border-red-500/40 text-red-400 hover:bg-red-500/10 h-8"
                            data-testid={`button-reject-${g.id}`}
                          >
                            <X className="h-3.5 w-3.5 mr-1" /> Tolak
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Badge className={g.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-red-500/15 text-red-400 border-red-500/30"}>
                            {g.status === "approved" ? "Disetujui" : "Ditolak"}
                          </Badge>
                          <Button
                            size="sm" variant="outline"
                            onClick={() => decideGateMutation.mutate({ gateId: g.id, status: "pending", ...reviewExpectation() })}
                            disabled={decideGateMutation.isPending}
                            title="Kembalikan ke menunggu persetujuan; tahap berikutnya akan terkunci."
                            data-testid={`button-reopen-gate-${g.id}`}
                          >Tinjau ulang</Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Logs / Journal */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-400" /> Jurnal Kerja
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Select value={logType} onValueChange={setLogType}>
                    <SelectTrigger className="w-40 bg-slate-950 border-slate-700 shrink-0" data-testid="select-log-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="note">Catatan</SelectItem>
                      <SelectItem value="decision">Keputusan</SelectItem>
                      <SelectItem value="assumption">Asumsi</SelectItem>
                      <SelectItem value="risk">Risiko</SelectItem>
                      <SelectItem value="change">Perubahan</SelectItem>
                      <SelectItem value="deliverable">Deliverable</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={logContent}
                    onChange={(e) => setLogContent(e.target.value)}
                    placeholder="Tulis catatan…"
                    className="bg-slate-950 border-slate-700"
                    data-testid="input-log-content"
                  />
                  <Button
                    onClick={() => addLogMutation.mutate({ type: logType, content: logContent, ...reviewExpectation() })}
                    disabled={addLogMutation.isPending || logContent.trim().length < 1}
                    variant="outline"
                    className="border-slate-700 shrink-0"
                    data-testid="button-add-log"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {logs.length === 0 ? (
                  <p className="text-sm text-slate-600">Belum ada catatan.</p>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => {
                      const style = LOG_STYLE[log.type] || LOG_STYLE.note;
                      const analysis = log.type === "deliverable" ? log.meta?.result : null;
                      return (
                        <div key={log.id} className="border border-slate-800 rounded-lg p-3" data-testid={`log-${log.id}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className={`text-xs ${style.cls}`}>{style.label}</Badge>
                            <span className="text-xs text-slate-600">{new Date(log.createdAt).toLocaleString("id-ID")}</span>
                          </div>
                          <p className="text-sm text-slate-200">{log.content}</p>
                          {analysis && (
                            <div className="mt-2 text-sm text-slate-300 space-y-1 border-t border-slate-800 pt-2">
                              {analysis.kelayakan && (
                                <p>
                                  <span className="text-slate-500">Kelayakan: </span>
                                  {analysis.kelayakan.layak ? "Layak" : "Belum layak"} — {analysis.kelayakan.alasan}
                                </p>
                              )}
                              {analysis.win_probability && (
                                <p><span className="text-slate-500">{meta.scoreLabel}: </span>{analysis.win_probability.skor}% — {analysis.win_probability.dasar}</p>
                              )}
                              {Array.isArray(analysis.rekomendasi) && analysis.rekomendasi.length > 0 && (
                                <div>
                                  <span className="text-slate-500">Rekomendasi:</span>
                                  <ul className="list-disc list-inside text-slate-300">
                                    {analysis.rekomendasi.map((r: string, i: number) => <li key={i}>{r}</li>)}
                                  </ul>
                                </div>
                              )}
                              {Array.isArray(analysis.asumsi) && analysis.asumsi.length > 0 && (
                                <div className="text-amber-400/90">
                                  {analysis.asumsi.map((a: string, i: number) => <p key={i}>{a}</p>)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
