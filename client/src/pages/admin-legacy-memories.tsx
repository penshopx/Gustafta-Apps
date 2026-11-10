import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ARCHIVE_REFERENCE_PATTERN, ARCHIVE_REFERENCE_SOURCE, APPROVAL_REASON, REJECTION_REASONS, RECOVERY_REASON_LABELS, validRecoveryReason } from "@shared/legacy-memory-evidence";

type Unowned = { id: number; agentId: number; createdAt: string };
type Review = {
  id: number; memoryId: number; agentId: number | null; proposedUserId: string; evidenceRef: string | null;
  requiresResubmission: boolean;
  evidenceSha256: string; submittedBy: string; submittedAt: string;
  reviewedBy: string | null; reviewedAt: string | null;
  decision: "pending" | "approved" | "rejected"; rationale: string | null;
};
type Queue = { unowned: Unowned[]; reviews: Review[] };
type AdminMe = { isSuperAdmin: boolean; user: { id: string } | null };

const base = "/api/admin/legacy-memories";
const submissionAttestation = "Record independently links memoryId, agentId and authenticated userId";
const approvalAttestation = "I independently verified the trusted original record";
const rejectionAttestation = "I independently reviewed the evidence and found it insufficient";
const formatDate = (value: string) => new Date(value).toLocaleString("id-ID");

export default function AdminLegacyMemories() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [memoryPages, setMemoryPages] = useState([0]);
  const [reviewPages, setReviewPages] = useState([0]);
  const [selectedMemory, setSelectedMemory] = useState<Unowned | null>(null);
  // Keep only the selection and its opening status; details always come from
  // the current queue, including after another reviewer's decision.
  const [reviewSelection, setSelectedReview] = useState<Pick<Review, "id" | "decision"> | null>(null);
  const [proposedUserId, setProposedUserId] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [evidenceSha256, setEvidenceSha256] = useState("");
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [rationale, setRationale] = useState("");
  const [decisionConfirmed, setDecisionConfirmed] = useState(false);
  const me = useQuery<AdminMe>({ queryKey: ["/api/admin/me"] });
  const afterMemory = memoryPages[memoryPages.length - 1];
  const afterReview = reviewPages[reviewPages.length - 1];
  const queue = useQuery<Queue>({
    queryKey: [base, afterMemory, afterReview],
    queryFn: () => apiRequest("GET", `${base}?afterMemory=${afterMemory}&afterReview=${afterReview}`),
    enabled: me.data?.isSuperAdmin === true,
    staleTime: 0,
    refetchInterval: query => reviewSelection &&
      query.state.data?.reviews.some(row => row.id === reviewSelection.id && row.decision === "pending")
      ? 5_000 : false,
    refetchIntervalInBackground: true,
  });
  const selectedReview = queue.isError ? null :
    queue.data?.reviews.find(row => row.id === reviewSelection?.id) ?? null;
  const reviewChanged = reviewSelection?.decision === "pending" &&
    selectedReview && selectedReview.decision !== "pending";
  const mutation = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => apiRequest("POST", url, body),
    onSuccess: () => {
      setSelectedMemory(null);
      setSelectedReview(null);
      setSubmissionConfirmed(false);
      setDecisionConfirmed(false);
      setRationale("");
      setProposedUserId("");
      setEvidenceRef("");
      setEvidenceSha256("");
      setMemoryPages([0]);
      setReviewPages([0]);
      client.invalidateQueries({ queryKey: [base] });
      toast({ title: "Tindakan tercatat. Antrean diperbarui." });
    },
    onError: async (error: Error) => {
      toast({ title: "Tindakan gagal; tidak ada perubahan yang dikonfirmasi", description: error.message, variant: "destructive" });
      // Keep mutation controls blocked until the authoritative status arrives.
      await queue.refetch();
    },
  });
  const selectMemory = (row: Unowned) => {
    setSelectedMemory(row);
    setSelectedReview(null);
    setSubmissionConfirmed(false);
    setProposedUserId("");
    setEvidenceRef("");
    setEvidenceSha256("");
  };
  const selectReview = (row: Review) => {
    setSelectedReview(row);
    setSelectedMemory(null);
    setDecisionConfirmed(false);
    setRationale("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedMemory || !submissionConfirmed || mutation.isPending ||
        !ARCHIVE_REFERENCE_PATTERN.test(evidenceRef)) return;
    mutation.mutate({
      url: `${base}/reviews`,
      body: {
        memoryId: selectedMemory.id, agentId: selectedMemory.agentId,
        proposedUserId: proposedUserId.trim(), evidenceRef: evidenceRef.trim(),
        evidenceSha256: evidenceSha256.trim(), evidenceType: "authenticated_creation_record",
        attestation: submissionAttestation,
      },
    });
  };
  const decide = (approve: boolean) => {
    if (!selectedReview || selectedReview.decision !== "pending" || queue.isFetching ||
        !decisionConfirmed || !validRecoveryReason(approve, rationale) ||
        (approve && selectedReview.requiresResubmission) || mutation.isPending ||
        selectedReview.submittedBy === me.data?.user?.id) return;
    mutation.mutate({
      url: `${base}/reviews/${selectedReview.id}/decision`,
      body: { approve, rationale, attestation: approve ? approvalAttestation : rejectionAttestation },
    });
  };

  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <Link href="/admin" className="text-sm text-sky-300 hover:underline">← Kembali ke Admin</Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">Khusus superadmin · peninjauan dua orang</p>
        <h1 className="mt-2 text-3xl font-bold">Pemulihan memori lama</h1>
        <p className="mt-2 text-slate-300">Antrean ini hanya berisi ID dan waktu. Isi memori dan session ID tidak tersedia di sini.</p>
      </header>
      {me.isLoading && <p role="status">Memeriksa akses…</p>}
      {me.isError && <p role="alert" className="text-rose-300">Tidak dapat memeriksa akses. Masuk kembali atau coba muat ulang.</p>}
      {!me.isLoading && !me.isError && !me.data?.isSuperAdmin && <p role="alert" className="text-rose-300">Akses ditolak. Halaman ini hanya untuk superadmin.</p>}
      {me.data?.isSuperAdmin === true && <>
        <section className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-5 text-sm leading-relaxed text-amber-100">
          <h2 className="mb-2 text-lg font-semibold">Aturan bukti wajib</h2>
          <p>Untuk tiap ID memori, hanya rekaman asli dari sumber tepercaya yang dibuat saat permintaan penulisan terautentikasi yang dapat dipakai. Satu peristiwa harus mengikat ID memori, ID agen, dan ID pengguna terautentikasi. Arsip harus mendahului tinjauan; catat rujukan arsip terbatas dan SHA-256 rekaman asli.</p>
          <p className="mt-2">Session ID, pemilik agen, isi yang cocok, percakapan, dan klaim pengguna bukan bukti. Jangan masukkan isi memori, session ID, cookie, token, atau data pribadi ke rujukan maupun alasan. Jika arsip tidak ada atau tidak dapat diverifikasi, biarkan memori tanpa pemilik.</p>
        </section>
        {queue.isLoading && <p role="status">Memuat antrean…</p>}
        {queue.isError && <div role="alert" className="rounded-lg border border-rose-500 p-4 text-rose-200">Antrean tidak tersedia. Formulir keputusan ditutup sampai status terbaru dapat diperiksa. <Button variant="outline" onClick={() => queue.refetch()}>Coba lagi</Button></div>}
        {queue.data && <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Baris tanpa pemilik</h2>
            {queue.data.unowned.length === 0 && <p className="text-slate-400">Tidak ada baris di halaman ini.</p>}
            {queue.data.unowned.map(row => <button key={row.id} type="button" onClick={() => selectMemory(row)}
              className={`w-full rounded-lg border p-4 text-left hover:border-sky-400 ${selectedMemory?.id === row.id ? "border-sky-400 bg-slate-800" : "border-slate-700 bg-slate-900"}`}
              data-testid={`memory-${row.id}`}>
              <span className="font-semibold">Memori #{row.id}</span><span className="ml-3 text-sm text-slate-300">Agen #{row.agentId}</span>
              <span className="block text-xs text-slate-400">{formatDate(row.createdAt)}</span>
            </button>)}
            <Pagination page={memoryPages.length} hasNext={queue.data.unowned.length === 100}
              previous={() => { setMemoryPages(p => p.slice(0, -1)); setSelectedMemory(null); }}
              next={() => { setMemoryPages(p => [...p, queue.data!.unowned.at(-1)!.id]); setSelectedMemory(null); }} />
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Riwayat keputusan</h2>
            {queue.data.reviews.length === 0 && <p className="text-slate-400">Belum ada tinjauan di halaman ini.</p>}
            {queue.data.reviews.map(row => <button key={row.id} type="button" onClick={() => selectReview(row)}
              className={`w-full rounded-lg border p-4 text-left hover:border-sky-400 ${selectedReview?.id === row.id ? "border-sky-400 bg-slate-800" : "border-slate-700 bg-slate-900"}`}
              data-testid={`review-${row.id}`}>
              <span className="font-semibold">Tinjauan #{row.id} · Memori #{row.memoryId}</span>
              <span className="ml-2 text-sm text-sky-300">{row.decision === "pending" ? "Menunggu" : row.decision === "approved" ? "Disetujui" : "Ditolak"}</span>
              <span className="block text-xs text-slate-400">{formatDate(row.submittedAt)} · Pengaju: {row.submittedBy}</span>
            </button>)}
            <Pagination page={reviewPages.length} hasNext={queue.data.reviews.length === 100}
              previous={() => { setReviewPages(p => p.slice(0, -1)); setSelectedReview(null); }}
              next={() => { setReviewPages(p => [...p, queue.data!.reviews.at(-1)!.id]); setSelectedReview(null); }} />
          </section>
        </div>}
        {selectedMemory && <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Ajukan bukti · Memori #{selectedMemory.id} / Agen #{selectedMemory.agentId}</h2>
          <p className="text-sm text-amber-200">Periksa arsip asli di luar halaman ini. Pengajuan tidak membuka isi memori; superadmin kedua wajib memverifikasi sendiri sebelum pengaitan.</p>
          <form onSubmit={submit} className="space-y-4">
            <div><Label htmlFor="proposed-user">ID pengguna terautentikasi pada rekaman asli</Label><Input id="proposed-user" required maxLength={255} value={proposedUserId} onChange={e => setProposedUserId(e.target.value)} className="mt-1 bg-slate-800" /></div>
            <div><Label htmlFor="evidence-ref">ID arsip acak dari petugas arsip (archive:v1:UUIDv4)</Label><Input id="evidence-ref" required pattern={ARCHIVE_REFERENCE_SOURCE} maxLength={47} value={evidenceRef} onChange={e => setEvidenceRef(e.target.value)} className="mt-1 bg-slate-800" /><p className="mt-1 text-sm text-slate-300">Bukan URL, nama berkas, session ID, atau isi rekaman. Temukan sumber asli melalui katalog arsip terbatas dengan akses yang sah.</p></div>
            <div><Label htmlFor="evidence-hash">SHA-256 rekaman asli (64 digit heksadesimal)</Label><Input id="evidence-hash" required pattern="[a-fA-F0-9]{64}" maxLength={64} value={evidenceSha256} onChange={e => setEvidenceSha256(e.target.value)} className="mt-1 bg-slate-800 font-mono" /></div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={submissionConfirmed} onChange={e => setSubmissionConfirmed(e.target.checked)} className="mt-1" />Saya sudah memeriksa bahwa satu rekaman asli mengikat ketiga ID dan arsipnya sudah ada sebelum tinjauan.</label>
            <Button type="submit" disabled={!submissionConfirmed || mutation.isPending || !proposedUserId.trim() || !ARCHIVE_REFERENCE_PATTERN.test(evidenceRef)} data-testid="submit-evidence">Ajukan untuk peninjau kedua</Button>
          </form>
        </section>}
        {selectedReview && <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Tinjauan #{selectedReview.id} · Memori #{selectedReview.memoryId}</h2>
          {reviewChanged && <p role="status" data-testid="review-conflict" className="rounded-lg border border-amber-500/40 p-3 text-amber-100">
            Tinjauan ini sudah diputuskan oleh superadmin lain. Formulir keputusan ditutup; hasil terbaru ditampilkan di bawah dan di riwayat keputusan.
          </p>}
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-400">ID agen pada baris memori</dt><dd>{selectedReview.agentId ?? "Tidak tersedia — jangan setujui"}</dd></div>
            <div><dt className="text-slate-400">ID pengguna yang diajukan</dt><dd className="break-all">{selectedReview.proposedUserId}</dd></div>
            <div><dt className="text-slate-400">Pengaju</dt><dd className="break-all">{selectedReview.submittedBy}</dd></div>
            <div><dt className="text-slate-400">Rujukan arsip terbatas</dt><dd className="break-all">{selectedReview.evidenceRef ?? "Rujukan lama disembunyikan — perlu pengajuan ulang"}</dd></div>
            <div><dt className="text-slate-400">SHA-256 rekaman asli</dt><dd className="break-all font-mono">{selectedReview.evidenceSha256}</dd></div>
            {selectedReview.reviewedBy && <div><dt className="text-slate-400">Peninjau / waktu</dt><dd>{selectedReview.reviewedBy} · {selectedReview.reviewedAt && formatDate(selectedReview.reviewedAt)}</dd></div>}
            <div><dt className="text-slate-400">Alasan keputusan</dt><dd>{selectedReview.rationale ? RECOVERY_REASON_LABELS[selectedReview.rationale] : "Belum diputuskan atau alasan teks lama disembunyikan"}</dd></div>
          </dl>
          {selectedReview.decision === "pending" && (selectedReview.submittedBy === me.data.user?.id
            ? <p className="text-amber-200">Anda pengaju. Superadmin lain harus memeriksa dan memutuskan tinjauan ini.</p>
            : <div className="space-y-4">
              <p className="text-sm text-amber-200">Buka arsip tepercaya sendiri, hitung ulang SHA-256, lalu cocokkan ID memori, ID agen, dan ID pengguna terautentikasi. Tanpa bukti lengkap, tolak. Persetujuan langsung mengaitkan pemilik.</p>
              {selectedReview.requiresResubmission && <p role="status" className="text-amber-200">Teks rujukan lama tidak dibuka. Tolak dengan alasan pengajuan ulang; petugas arsip berwenang harus memetakan rekaman asli ke ID acak sebelum pengajuan baru. Riwayat keputusan lama tetap dipertahankan.</p>}
              <div><Label htmlFor="rationale">Alasan keputusan (pilih kode; tanpa teks bebas)</Label><select id="rationale" value={rationale} onChange={e => setRationale(e.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-2">
                <option value="">Pilih alasan</option>
                {!selectedReview.requiresResubmission && <option value={APPROVAL_REASON}>{RECOVERY_REASON_LABELS[APPROVAL_REASON]}</option>}
                {REJECTION_REASONS.map(code => <option key={code} value={code}>{RECOVERY_REASON_LABELS[code]}</option>)}
              </select></div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={decisionConfirmed} onChange={e => setDecisionConfirmed(e.target.checked)} className="mt-1" />Saya sudah meninjau sumber arsip secara independen. Saya hanya akan menyetujui jika rekaman asli benar-benar membuktikan ketiga ID; jika tidak, saya menolak.</label>
              <div className="flex flex-wrap gap-3">
                <Button variant="destructive" disabled={!decisionConfirmed || !validRecoveryReason(false, rationale) || mutation.isPending || queue.isFetching} onClick={() => decide(false)} data-testid="reject-review">Tolak bukti</Button>
                <Button disabled={selectedReview.requiresResubmission || !selectedReview.agentId || !decisionConfirmed || !validRecoveryReason(true, rationale) || mutation.isPending || queue.isFetching} onClick={() => { if (window.confirm("Yakin semua ID dan SHA-256 sudah diverifikasi dari arsip asli? Pemilik akan langsung dikaitkan.")) decide(true); }} data-testid="approve-review">Setujui & kaitkan pemilik</Button>
              </div>
            </div>)}
        </section>}
      </>}
    </div>
  </div>;
}

function Pagination({ page, hasNext, previous, next }: { page: number; hasNext: boolean; previous: () => void; next: () => void }) {
  return <div className="flex items-center gap-3 text-sm">
    <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={previous}>Sebelumnya</Button>
    <span>Halaman {page}</span>
    <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={next}>Berikutnya</Button>
  </div>;
}