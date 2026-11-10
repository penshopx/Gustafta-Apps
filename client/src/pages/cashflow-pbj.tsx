import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { SharedHeader } from "@/components/shared-header";
import { Button } from "@/components/ui/button";
import {
  Wallet, ListChecks, Gauge, FileText, ClipboardCheck, CalendarCheck,
  ShieldAlert, Users, CheckCircle2, ArrowRight, AlertTriangle, Brain,
  CreditCard, Loader2, ShieldCheck,
} from "lucide-react";
import { CASHFLOW_TIERS, formatIDR } from "@/data/pricing";
import { useContactNumbers } from "@/lib/contact";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SPESIALIS = [
  { emoji: "💰", nama: "SI KAS", peran: "Keuangan & arus kas — triage, buffer, runway" },
  { emoji: "⚖️", nama: "SI PASAL", peran: "Hukum & kontrak — bedah klausul, surat resmi" },
  { emoji: "👷", nama: "SI LAPANGAN", peran: "Operasional — negosiasi subkon & supplier" },
  { emoji: "📁", nama: "SI BERKAS", peran: "Administrasi — zero-defect & follow-up PPK" },
  { emoji: "🎯", nama: "SI STRATEGI", peran: "Bisnis — uji kelayakan ambil proyek baru" },
  { emoji: "🧾", nama: "SI PAJAK", peran: "Perpajakan konstruksi — potongan termin & faktur" },
  { emoji: "🚨", nama: "SI DARURAT", peran: "Krisis — rencana penyelamatan 30 hari" },
];

const ALAT = [
  { icon: Wallet, nama: "Cash Triage Board", desc: "Urutan prioritas bayar & tagih saat kas terbatas" },
  { icon: ListChecks, nama: "Termin Tracker 7-Titik", desc: "Lacak posisi uang Anda di jalur birokrasi" },
  { icon: Gauge, nama: "Buffer Calculator", desc: "Hitung oksigen perusahaan: runway & cadangan wajib" },
  { icon: FileText, nama: "Surat Generator", desc: "12 template surat resmi — dari menanyakan status sampai somasi" },
  { icon: ClipboardCheck, nama: "Zero-Defect Checklist", desc: "Berkas tagihan sempurna sejak pengajuan pertama" },
  { icon: CalendarCheck, nama: "Friday Review", desc: "Ritual rapat triase kas 30 menit tiap Jumat" },
  { icon: ShieldAlert, nama: "Red Flags Scanner", desc: "15 klausul kontrak berbahaya yang menggerogoti kas" },
];

export default function CashflowPbjPage() {
  const [durasi, setDurasi] = useState<3 | 6 | 12>(6);
  const [selectedPackage, setSelectedPackage] = useState<{
    key: string;
    tierName: string;
    durationMonths: number;
    total: number;
  } | null>(null);
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const { waLink } = useContactNumbers();
  const { user } = useAuth();
  const { toast } = useToast();

  const beginCheckout = (
    tierName: string,
    duration: (typeof CASHFLOW_TIERS)[number]["durations"][number],
  ) => {
    setSelectedPackage({
      key: duration.key,
      tierName,
      durationMonths: duration.bulan,
      total: duration.total,
    });
    setBuyer((current) => ({
      name:
        current.name ||
        [user?.firstName, user?.lastName].filter(Boolean).join(" "),
      email: current.email || user?.email || "",
      phone: current.phone,
    }));
  };

  const submitCheckout = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPackage) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/cashflow-pbj/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_key: selectedPackage.key,
          buyer,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || "Checkout belum dapat dibuat.");
      }
      const nextUrl = result.payment_url || result.wa_order_url;
      if (!nextUrl) {
        throw new Error("Tautan pembayaran belum tersedia.");
      }
      window.location.assign(nextUrl);
    } catch (error: any) {
      toast({
        title: "Checkout belum berhasil",
        description: error?.message || "Silakan coba lagi.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <SharedHeader />
      {/* HERO — Problem */}
      <section className="max-w-4xl mx-auto px-4 pt-14 pb-10 text-center">
        <p className="text-xs font-semibold tracking-widest text-emerald-400 mb-3">EKOSISTEM CASHFLOW-PBJ · UNTUK KONTRAKTOR PROYEK PEMERINTAH</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
          Untung di RAB,<br />Sekarat di Rekening.
        </h1>
        <p className="text-sm text-slate-400 max-w-2xl mx-auto mb-6">
          Proyek Anda untung di atas kertas — tapi termin macet 3 bulan di meja birokrasi, tukang menagih tiap Sabtu,
          dan supplier mulai menahan material. Bukan karena Anda tidak becus kerja. Karena tidak ada <span className="text-white font-semibold">sistem arus kas</span> yang mengawalnya.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="bg-emerald-600 hover:bg-emerald-700">
            <Link href="/toolkit-cashflow" data-testid="link-hero-toolkit">Coba Toolkit Gratis <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#harga" data-testid="link-hero-harga">Lihat Paket</a>
          </Button>
        </div>
      </section>

      {/* Agitate */}
      <section className="max-w-3xl mx-auto px-4 pb-12">
        <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-white mb-2">Berapa biaya SATU termin Rp 500 juta yang macet 3 bulan?</p>
              <p className="text-xs text-slate-400">
                Denda keterlambatan ke subkon, sewa alat menganggur, bunga pinjaman darurat, produktivitas tim yang jatuh —
                totalnya bisa lebih dari <span className="text-red-300 font-semibold">Rp 185 juta</span>. Dan itu baru satu termin, satu proyek.
                Yang membunuh kontraktor bukan proyek rugi — tapi kas yang telat datang.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Solution — 3 lapis */}
      <section className="max-w-4xl mx-auto px-4 pb-14">
        <h2 className="text-xl font-bold text-white text-center mb-2">Satu Sistem, Tiga Lapis Pertahanan Kas</h2>
        <p className="text-xs text-slate-400 text-center mb-8">Metode CASHFLOW-PBJ dari buku "Kas Merah, RAB Hijau" — dijalankan, bukan sekadar dibaca.</p>

        {/* Lapis 1: Toolkit */}
        <div className="mb-8">
          <p className="text-sm font-semibold text-emerald-400 mb-3">1 · TOOLKIT — 7 alat kerja harian</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ALAT.map(a => (
              <div key={a.nama} className="rounded-xl border border-white/8 bg-white/3 p-4">
                <a.icon className="h-4 w-4 text-emerald-400 mb-2" />
                <p className="text-xs font-semibold text-white">{a.nama}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Lapis 2: Tim AI */}
        <div className="mb-8">
          <p className="text-sm font-semibold text-violet-400 mb-3">2 · RAPAT DIREKSI VIRTUAL — Pak Arga & 7 AI Spesialis</p>
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5 mb-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center text-xl shrink-0">🧠</div>
              <div>
                <p className="text-sm font-semibold text-white">Ir. Arga Winata — "Pak Arga"</p>
                <p className="text-xs text-slate-400 mt-1">
                  Praktisi 20+ tahun proyek pemerintah yang pernah nyaris bangkrut karena termin macet.
                  Ceritakan masalah Anda — Pak Arga mendiagnosis, memanggil spesialis yang tepat, lalu
                  merangkum jadi <span className="text-violet-300 font-semibold">"Langkah Taktis Hari Ini"</span> yang bisa langsung Anda kerjakan.
                </p>
              </div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {SPESIALIS.map(s => (
              <div key={s.nama} className="flex items-center gap-2.5 rounded-lg border border-white/8 bg-white/2 px-3 py-2">
                <span className="text-lg">{s.emoji}</span>
                <div>
                  <p className="text-[11px] font-bold text-white">{s.nama}</p>
                  <p className="text-[10px] text-slate-500">{s.peran}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lapis 3: Ekosistem */}
        <div>
          <p className="text-sm font-semibold text-cyan-400 mb-3">3 · TERHUBUNG KE EKOSISTEM GUSTAFTA</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Brain, nama: "Bedah Dokumen", desc: "Upload kontrak/BAST/invoice — AI mendiagnosis red flags & kelengkapan" },
              { icon: Users, nama: "Klinik Konsultasi", desc: "Ruang tanya-jawab dengan seluruh AI Spesialis" },
              { icon: FileText, nama: "Ruang Simpan & Kelola", desc: "Brankas dokumen proyek + dashboard kesehatan perusahaan" },
            ].map(f => (
              <div key={f.nama} className="rounded-xl border border-white/8 bg-white/3 p-4">
                <f.icon className="h-4 w-4 text-cyan-400 mb-2" />
                <p className="text-xs font-semibold text-white">{f.nama}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="harga" className="max-w-4xl mx-auto px-4 pb-14">
        <h2 className="text-xl font-bold text-white text-center mb-2">Pilih Paket Sesuai Skala Anda</h2>
        <p className="text-xs text-slate-400 text-center mb-1">Harga resmi. Akses aktif otomatis setelah pembayaran terkonfirmasi.</p>
        <p className="text-[10px] text-slate-500 text-center mb-6">Anda tidak membeli aplikasi. Anda membeli asuransi terhadap termin macet.</p>
        <div className="flex justify-center gap-1.5 mb-6">
          {([3, 6, 12] as const).map(b => (
            <button key={b} onClick={() => setDurasi(b)} data-testid={`button-durasi-${b}`}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${durasi === b ? "bg-emerald-600 text-white" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
              {b} bulan{b === 6 ? " · −10%" : b === 12 ? " · −20%" : ""}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {CASHFLOW_TIERS.map(t => {
            const d = t.durations.find(x => x.bulan === durasi)!;
            return (
              <div key={t.key} className={`rounded-2xl border p-5 flex flex-col ${t.highlight ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10 bg-white/3"}`} data-testid={`card-tier-${t.key}`}>
                {t.highlight && <p className="text-[10px] font-bold text-emerald-400 mb-1">PALING BANYAK DIPILIH</p>}
                <p className="text-sm font-bold text-white">{t.nama}</p>
                <p className="text-[10px] text-slate-500 mb-3">{t.target}</p>
                <p className="text-2xl font-bold text-white">{formatIDR(d.perBulan)}<span className="text-xs font-normal text-slate-500">/bln</span></p>
                <p className="text-[10px] text-slate-500 mb-4">{formatIDR(d.total)} / {d.bulan} bulan{d.hemat ? ` · ${d.hemat}` : ""}</p>
                <ul className="space-y-1.5 mb-5 flex-1">
                  {t.fitur.map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />{f}
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  onClick={() => beginCheckout(t.nama, d)}
                  className={t.highlight ? "bg-emerald-600 hover:bg-emerald-700 w-full" : "w-full"}
                  variant={t.highlight ? "default" : "outline"}
                  data-testid={`button-beli-${t.key}`}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Beli Paket
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <Dialog
        open={!!selectedPackage}
        onOpenChange={(open) => {
          if (!open && !submitting) setSelectedPackage(null);
        }}
      >
        <DialogContent className="border-slate-700 bg-slate-950 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Checkout CASHFLOW-PBJ</DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedPackage
                ? `${selectedPackage.tierName} · ${selectedPackage.durationMonths} bulan · ${formatIDR(selectedPackage.total)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCheckout}>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-100">
              <ShieldCheck className="mr-2 inline h-4 w-4 text-emerald-400" />
              Harga diverifikasi server. Setelah Scalev mengonfirmasi pembayaran,
              akses AI Spesialis sesuai tier langsung dibuka.
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashflow-buyer-name">Nama lengkap</Label>
              <Input
                id="cashflow-buyer-name"
                required
                maxLength={120}
                value={buyer.name}
                onChange={(event) => setBuyer({ ...buyer, name: event.target.value })}
                className="border-slate-700 bg-slate-900"
                data-testid="input-cashflow-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashflow-buyer-email">Email akses</Label>
              <Input
                id="cashflow-buyer-email"
                type="email"
                required
                maxLength={200}
                value={buyer.email}
                onChange={(event) => setBuyer({ ...buyer, email: event.target.value })}
                className="border-slate-700 bg-slate-900"
                data-testid="input-cashflow-email"
              />
              <p className="text-[11px] text-slate-500">
                Gunakan email yang sama saat login atau saat mengambil akses AI Spesialis.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashflow-buyer-phone">Nomor WhatsApp</Label>
              <Input
                id="cashflow-buyer-phone"
                inputMode="tel"
                maxLength={30}
                value={buyer.phone}
                onChange={(event) => setBuyer({ ...buyer, phone: event.target.value })}
                className="border-slate-700 bg-slate-900"
                data-testid="input-cashflow-phone"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-cashflow-checkout-submit"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="mr-2 h-4 w-4" />
              )}
              Lanjut ke Pembayaran
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ebook premium */}
      <section className="max-w-3xl mx-auto px-4 pb-8">
        <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-5 text-center" data-testid="card-ebook-kas-merah">
          <p className="text-sm font-semibold text-white mb-1">Mau pahami sistemnya dulu sebelum berlangganan?</p>
          <p className="text-xs text-slate-400 mb-3">
            Ebook <span className="text-orange-300 font-semibold">"KAS MERAH, RAB HIJAU"</span> — 9 bab + 6 lampiran alat kerja:
            Cash Triage, Termin Tracker 7-Titik, Buffer Protocol, 12 template surat &amp; WA. Bab 1 bisa dibaca gratis.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/ebook-kas-merah" data-testid="link-ebook-kas-merah">Baca Bab 1 Gratis</Link>
          </Button>
        </div>
      </section>

      {/* Konsultasi manusia — layanan terpisah */}
      <section className="max-w-3xl mx-auto px-4 pb-14">
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-center" data-testid="card-konsultan-terpisah">
          <p className="text-sm font-semibold text-white mb-1">Butuh pendampingan langsung dari konsultan manusia?</p>
          <p className="text-xs text-slate-400 mb-3">
            Sesi konsultasi privat (review kontrak, penyelamatan kas, pendampingan kasus) tersedia sebagai
            <span className="text-amber-300 font-semibold"> layanan terpisah dengan tarif per sesi</span> — tidak termasuk dalam paket aplikasi di atas.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href={waLink("Halo Gustafta, saya ingin tanya tarif sesi konsultasi privat CASHFLOW-PBJ.")} target="_blank" rel="noopener noreferrer" data-testid="link-tanya-konsultan">
              Tanya Tarif Konsultasi
            </a>
          </Button>
        </div>
      </section>

      {/* CTA akhir */}
      <section className="max-w-3xl mx-auto px-4 pb-16 text-center">
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-8">
          <p className="text-lg font-bold text-white mb-2">Ilmu tanpa sistem = wacana.<br />Ilmu + sistem = perusahaan yang bertahan.</p>
          <p className="text-xs text-slate-400 mb-5">Mulai dari alat gratisnya hari ini — rasakan cara kerjanya sebelum berlangganan.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-emerald-600 hover:bg-emerald-700">
              <Link href="/toolkit-cashflow" data-testid="link-cta-toolkit">Buka Toolkit CASHFLOW-PBJ <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/klinik-konsultasi" data-testid="link-cta-klinik">Konsultasi dengan Pak Arga</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
