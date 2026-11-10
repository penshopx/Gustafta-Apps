// Harga final CASHFLOW-PBJ untuk UI, seed registry, snapshot paket, dan Scalev.
// Diskon durasi: 6 bulan hemat 10%, 12 bulan hemat 20%.
export interface CashflowDuration {
  key: string;
  packageId: string;
  bulan: 3 | 6 | 12;
  total: number;
  perBulan: number;
  hemat?: string;
}

export interface CashflowTier {
  key: string;
  nama: string;
  target: string;
  perBulan: number;
  highlight: boolean;
  fitur: string[];
  durations: CashflowDuration[];
}

function cfDurations(prefix: string, perBulan: number): CashflowDuration[] {
  const mk = (bulan: 3 | 6 | 12, disc: number, hemat?: string): CashflowDuration => {
    const total = Math.round(perBulan * bulan * (1 - disc) / 1000) * 1000;
    return {
      key: `${prefix}_${bulan}`,
      packageId: `CASHFLOW-PBJ-${prefix.toUpperCase()}-${bulan}M`,
      bulan,
      total,
      perBulan: Math.round(total / bulan),
      hemat,
    };
  };
  return [mk(3, 0), mk(6, 0.10, "Hemat 10%"), mk(12, 0.20, "Hemat 20%")];
}

export const CASHFLOW_TIERS: CashflowTier[] = [
  {
    key: "mandor", nama: "T1 — MANDOR", target: "Kontraktor kecil, 1 proyek aktif",
    perBulan: 299_000, highlight: false,
    fitur: [
      "Toolkit lengkap: Triage, Tracker 7-Titik, Buffer, 12 Surat, Zero-Defect, Friday Review, Red Flags",
      "2 AI Spesialis (SI KAS + SI BERKAS)",
      "Bedah Dokumen: 3 dokumen/bulan",
      "Health Check dasar + alert dokumen kadaluarsa",
      "Pusat bantuan & panduan penggunaan",
    ],
    durations: cfDurations("mandor", 299_000),
  },
  {
    key: "kontraktor", nama: "T2 — KONTRAKTOR", target: "Kontraktor aktif, 2-3 proyek",
    perBulan: 749_000, highlight: true,
    fitur: [
      "Semua fitur T1",
      "5 AI Spesialis + Pak Arga (rapat direksi virtual)",
      "Akses langsung ke tiap spesialis + memori per proyek",
      "Bedah Dokumen: 20 dokumen/bulan",
      "Workroom per proyek + log keputusan otomatis",
      "Alert buffer menipis + laporan mingguan otomatis",
      "Pusat bantuan & panduan video lengkap",
    ],
    durations: cfDurations("kontraktor", 749_000),
  },
  {
    key: "direktur", nama: "T3 — DIREKTUR", target: "PT multi-proyek dengan tim admin",
    perBulan: 1_490_000, highlight: false,
    fitur: [
      "Semua fitur T2",
      "7 AI Spesialis lengkap + SI DARURAT (mode krisis)",
      "Bedah Dokumen: tanpa batas (batas wajar 100 dok/bulan)",
      "Akses tim: undang admin/mandor (maks 5 pengguna)",
      "Alert termin otomatis via WhatsApp + auto-draft surat",
      "Paket video onboarding mandiri langkah demi langkah",
    ],
    durations: cfDurations("direktur", 1_490_000),
  },
];