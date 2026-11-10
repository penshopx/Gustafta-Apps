# Blueprint Kontraktor Berbasis AI — Gustafta × SIGAP

Status: rancangan target untuk pilot terbatas; menggantikan asumsi implementasi penuh pada blueprint sumber.

## 1. Identitas dan hasil yang dituju

**Gustafta bukan nama badan usaha kontraktor secara otomatis.** Gustafta adalah platform pendukung penyelesaian pekerjaan. Perusahaan pengguna wajib mengisi identitas sendiri:

| Elemen | Nilai yang harus diisi dari bukti |
| --- | --- |
| Nama badan usaha dan jenis badan hukum | Belum ditetapkan dalam lampiran |
| NIB dan identitas perusahaan | Nomor, penerbit, tanggal verifikasi, dokumen referensi |
| Kategori badan usaha | BUJKN atau BUJKA/struktur lain yang benar-benar berlaku; bukan sekaligus dipilih |
| SBU aktif | Hanya subklasifikasi/kualifikasi yang dibuktikan; periode berlaku dan status verifikasi |
| Tenaga penanggung jawab | Jabatan dan sertifikat yang dipersyaratkan menurut aturan applicable |
| Proyek pilot | Satu proyek dan satu tenant perusahaan dengan tim pengguna yang ditetapkan |
| Process owner | Manusia yang bertanggung jawab atas tiap domain |

Visi operasional: mengurangi administrasi berulang dan meningkatkan kualitas keputusan, tanpa mengganti tanggung jawab profesional, keselamatan, atau kewenangan hukum.

Target seperti penghematan waktu penawaran 60% atau laporan tepat waktu 98% adalah hipotesis pilot. “Zero accident” adalah aspirasi keselamatan, bukan hasil yang dijamin AI.

## 2. Arsitektur kendali

```text
Pengguna / kanal terverifikasi
            |
Gustafta: identitas, hak akses, konteks berizin, penugasan Workroom
            |
SIGAP coordinator: workflow, task queue, policy-aware routing
            |
Adapter API berizin / tools MCP opsional
            |
Aplikasi domain: transaksi resmi, validasi, approval, audit domain
            |
Read model / ringkasan -> Gustafta dan Notion (nonotoritatif)
```

### Batas setiap lapisan

- **Control plane Gustafta:** identitas dan akses platform, konteks memori bisnis yang diizinkan, penugasan, status Workroom, audit interaksi, dan administrasi produk.
- **Aplikasi domain:** keputusan transaksi dan otorisasi domain diperiksa kembali oleh server aplikasi. Approval resmi tersimpan di pemilik objek, bukan hanya pesan chat.
- **SIGAP coordinator:** menyimpan task, inbox event, routing, referensi objek, status delivery dan audit orkestrasi. Tidak memiliki saldo stok, jurnal, upah, atau progres final.
- **SIGAP HUB:** registry koneksi, pemetaan ID, schema/event registry dan proyeksi terbatas. Bukan pemilik kedua seluruh master data.
- **Notion:** blueprint, SOP, kebijakan, knowledge yang dikurasi, dan ringkasan bertanda sumber/waktu. Tidak menjadi ledger transaksi paralel.
- **Ruang Simpan:** penyimpanan arsip/fakta berizin dan referensi dokumen; aplikasi domain tetap pemilik status transaksi. Akses profil tidak otomatis memberi akses berkas.

Hermes, OpenClaw dan MultiClaw adalah pilihan runtime worker, bukan syarat platform. “Hermes” harus dijelaskan apakah runtime tertentu, model, atau nama peran; keputusan produk, versi, lisensi, dukungan dan evaluasinya dicatat sebelum adopsi.

Worker eksternal mulai dari pilot internal read-only yang terisolasi. Tidak ada akses langsung database, shell bebas, folder server bebas, atau kredensial semua aplikasi. Integrasi tool hanya allowlist dan melalui server yang memeriksa izin. Penempatan runtime eksternal pada VPS tidak menjadi instruksi memasang Docker pada workspace Replit.

## 3. Prinsip wajib

1. Satu domain memiliki satu pemilik transaksi; proyeksi diberi label sumber, revision, dan waktu freshness.
2. Agen menyiapkan read/draft/propose. Kewenangan final bukan berasal dari prompt.
3. Kebijakan akses dan approval ditegakkan pada aplikasi pemilik, termasuk ketika dipanggil tanpa SIGAP.
4. Context, memory, embedding dan cache dipisah per tenant/proyek sesuai grant dokumen.
5. Angka dihitung engine deterministik; LLM menjelaskan atau mengekstrak kandidat fakta.
6. Setiap kandidat fakta menyimpan provenance: dokumen/foto, versi, halaman/posisi bila tersedia, waktu dan verifikator.
7. Bahaya dan prosedur darurat manusia tidak menunggu respons LLM.
8. Aplikasi domain tetap dapat bekerja ketika SIGAP/AI tidak tersedia.
9. Versi prompt/skill/model harus melalui proposal, pengujian, review dan rollback; tidak self-modify produksi.
10. Manusia accountable atas pekerjaan; keberhasilan dinilai dari waktu kembali, kualitas, dan pengurangan rework.

## 4. Roster spesialis dan gate manusia

Roster ini memuat peran, bukan kewajiban menjalankan 16 instans atau 16 akun sejak pilot. Identitas layanan dipisah per role-app-environment ketika role tersebut benar-benar diaktifkan.

| Peran | Batas keluaran AI | Gate manusia |
| --- | --- | --- |
| Tender Hunter | Peluang, kecocokan berbukti, rekomendasi Go/No-Go | Direktur/manajer tender memilih; syarat tidak diketahui menjadi needs-review |
| Estimator RAB | Ekstraksi BoQ, estimasi internal dan RAB draf | Estimator senior memvalidasi volume, koefisien, harga dan asumsi |
| Bid Document | Paket penawaran draf, checklist, sumber | Manajer tender + penandatangan berwenang; upload final manusia |
| Legal & Kontrak | Risk memo, redline, draf adendum/claim | Legal dan pejabat berwenang; AI tidak memberi persetujuan hukum final |
| Procurement | Perbandingan vendor, RFQ/PO draf | Pejabat pengadaan/PM/direktur sesuai policy; komitmen final manusia |
| Scheduler | Simulasi jadwal, kurva dan recovery proposal | PM menerima baseline/perubahan; progres hanya dari kuantitas accepted |
| Site Reporter | Laporan harian draf dan bukti terstruktur | Site Manager memverifikasi; laporan eksternal disetujui khusus |
| K3/HSE | Temuan kandidat, alarm, dokumentasi | Petugas lapangan/HSE menangani bahaya; izin lanjut kerja manusia berwenang |
| QA/QC | Checklist, RFI dan NCR draf | QC Engineer/pihak sesuai ITP mengesahkan penerimaan atau penolakan |
| Finance & Termin | Invoice/jurnal/payroll/pajak draf | Finance/Tax/otoritas pembayaran; maker-checker, tidak agent pay/post |
| HR & SKK | Rekap, kebutuhan tenaga, kandidat kelayakan | HR + PM; izin lembur, keputusan pekerja dan kontrak manusia |
| Client Relations | Acknowledgment dan balasan draf | PM menyetujui komitmen waktu, biaya, scope, atau pernyataan sengketa |
| Asset & Alat Berat | Jadwal, rekomendasi, draf sewa/servis | Kepala Alat/operator memverifikasi kondisi; release to service manusia |
| Logistik & Gudang | MR, rekonsiliasi, penerimaan kandidat | Storekeeper bukti fisik; QC acceptance; adjustment Kepala Gudang + Finance |
| Security & Area Control | Alarm akses, anomali, laporan draf | Petugas keamanan/manajemen memverifikasi; tidak menuduh otomatis |
| Aftersales & Garansi | Tiket, triase, jadwal dan draf respons | Manajer Aftersales memutus cakupan garansi dan komitmen perbaikan |

### Tiga peran pilot

Site Reporter, Scheduler, dan Logistik & Gudang sebagai rekomendasi starter. Mulai read-only/draft, satu proyek, pengguna eksplisit. Penggantian role dimungkinkan jika kesiapan data menunjukkan use case lain lebih layak; bukan menambah seluruh roster sekaligus.

Pilot external runtime internal monitoring/research dapat dilakukan terpisah, tetapi tidak memberi hak transaksi pelanggan.

## 5. Workflow dan gerbang

### 5.1 Tender sampai kontrak

Peluang -> bukti syarat -> eligibility review -> **gate Go/No-Go direktur** -> estimasi/dokumen draf -> review angka/legal -> **gate penawaran final** -> unggah manusia -> hasil terverifikasi.

SBU tidak cocok yang terbukti memberi kandidat No-Go; syarat belum pasti harus needs-review, bukan ditolak otomatis tanpa konteks paket/KSO yang sah. Tender menang membuat calon proyek/kontrak/register jaminan, bukan menerbitkan kontrak atau jaminan bank.

### 5.2 Pelaksanaan harian

Mandor mengirim bukti -> ekstraksi kandidat -> verifikasi Site Manager/Quantity -> acceptance mutu bila perlu -> engine menghitung progres -> Scheduler membandingkan baseline -> recovery proposal -> **gate PM** -> laporan eksternal melalui **gate penerbitan**.

Untuk item berbobot kuantitas: progres item = kuantitas accepted / kuantitas baseline, dengan aturan batas dan change order. Progres proyek = jumlah bobot baseline × progres item. Milestone/lumpsum memakai rule acceptance kontrak, bukan dipaksa menjadi volume. Perubahan baseline tidak boleh mengganti histori.

Deviasi >5 pada sumber diperjelas: contoh ambang **5 poin persentase**, parameter dapat diganti pemilik; bukan “5%” tanpa definisi.

### 5.3 Material

Kebutuhan jadwal + BoQ accepted -> stok tersedia/terpesan/reserved -> MR draf -> **gate Site Manager** -> RFQ/perbandingan -> budget reserve/approval -> **gate PO** -> penerimaan kandidat -> cek jumlah fisik dan mutu -> penerimaan final -> mutasi stok -> opname -> **gate adjustment**.

Barang belum lolos QC dipisah di quarantine dan tidak masuk available stock. RFQ tiga vendor adalah target kebijakan internal bila feasible, bukan syarat hukum universal. Single-source membutuhkan alasan dan approval sesuai policy. Selisih stok tidak otomatis berarti pencurian.

### 5.4 Termin dan keuangan

Kuantitas accepted + BA sesuai kontrak -> estimasi termin -> invoice draf -> **gate Finance dan pejabat berwenang** -> penerbitan -> pencocokan pembayaran dari sumber resmi -> jurnal oleh ERP -> retensi/pajak sesuai ruleset.

Approval PO mencatat komitmen anggaran; penerimaan belum otomatis menjadi utang final tanpa pencocokan PO–GRN–invoice dan aturan ERP. Reminder eksternal mengikuti template/kebijakan yang disetujui; status kirim bukan status pembayaran.

### 5.5 K3 dan alat

Indikasi bahaya -> alarm segera melalui jalur independen -> manusia melindungi pekerja/menghentikan pekerjaan sesuai prosedur -> HSE dokumentasi dan investigasi -> tindakan korektif -> **gate izin lanjut kerja**.

AI tidak mengesahkan keselamatan alat, diagnosis medis, APD compliant, atau lokasi aman dari foto saja. Checklist gagal mengubah status administratif ke hold; operasi fisik dikendalikan prosedur dan petugas. Release to service oleh manusia setelah pemeriksaan.

### 5.6 SDM

Kebutuhan jadwal -> HR memvalidasi -> seleksi/kontrak manusia -> absensi kandidat -> dispute/review -> **gate lembur** -> payroll draf -> validasi parameter upah/pajak/BPJS -> **gate payroll dan pembayaran terpisah**.

Absensi foto/GPS tidak membuktikan otomatis jam kerja. Kandidat atau pekerja tidak boleh ditolak/dihukum hanya dari skor AI.

### 5.7 Change order, serah terima dan garansi

Permintaan perubahan -> CR draf -> dampak biaya/jadwal/risiko -> **gate kewenangan kontrak** -> adendum sah -> baseline revision baru.

PHO, FHO dan BAST konsumen memiliki persyaratan berbeda sesuai kontrak. Punch list, as-built, hasil uji dan manual diterima pihak berwenang. Garansi -> tiket -> pemeriksaan cakupan -> **gate Aftersales** -> pekerjaan teknisi -> bukti closure -> konfirmasi pelanggan bila applicable.

## 6. Roadmap tunggal berbasis bukti

Rentang waktu indikatif, bukan janji 12 sprint tanpa mengetahui tim dan kesiapan aplikasi.

| Fase | Indikasi waktu | Scope | Gate keluar |
| --- | --- | --- | --- |
| 0: inventaris & governance | 1–2 minggu | Badan usaha, pemilik aplikasi/data, SOP40–46 terutama45–46, izin, baseline KPI, policy, backup | Owner sign-off, data pilot, jalur manual dan darurat aktif |
| 1: baca & draf pilot | 2–4 minggu | Tiga role; SIAP PROYEK/readiness dan satu domain pendukung; read API minimal | Negatif lintas pemilik/proyek lulus, sumber terlihat, revoke efektif |
| 2: logistik terkendali | 4–6 minggu | MR/PO draf, quarantine/QC, outbox/inbox, approval version-bound | Uji transaksi paralel, stale approval, stock replay dan rekonsiliasi lulus |
| 3: tenaga dan finansial | 4–6 minggu | Rekap tenaga, payroll/termin draf, budget commitment | Ruleset divalidasi, maker-checker, tiga-arah invoice lulus |
| 4: modul lanjutan | Sesuai kesiapan | Alat, aftersales, estimasi, subkon, CDE, jaminan | Tiap modul memiliki owner, API test dan fallback sebelum aktif |
| 5: ekspansi | Setelah bukti manfaat | Role lain dan lebih banyak proyek | KPI, cost cap, incident drill, restore dan rollout/rollback diterima |

K3 manual, inspeksi, dokumen dasar dan aftersales yang diwajibkan kontrak **tidak menunggu fase AI-nya**. Jika proyek pilot sudah membutuhkan RAB, prioritaskan adapter estimasi sebelum fitur gudang lanjutan.

## 7. KPI pilot

| KPI | Definisi ukur | Sumber |
| --- | --- | --- |
| Waktu administrasi kembali | Median menit manusia sebelum/sesudah untuk tugas sejenis | Sampling baseline 2–4 minggu dan log task |
| Laporan tepat waktu | Laporan terverifikasi sebelum cutoff / laporan wajib | SIAP PROYEK |
| Rework | Draf dikembalikan karena salah angka/sumber / draf direview | Workroom + domain review |
| Progres berbukti | Item accepted dengan bukti dan verifikator / total item accepted | Project + QA/QC |
| Lead time invoice | Hari kerja BA accepted sampai invoice issued | ERP + referensi BA |
| Keamanan | Akses lintas tenant yang ditolak; tidak ada akses tak berizin yang diterima | Tes negatif dan audit |
| Kesehatan integrasi | Oldest outbox age, DLQ, reconciliation mismatch | Aplikasi + HUB |
| Biaya AI | Biaya per task accepted dan total per proyek | Log model/worker tersanitasi |

Target ditentukan setelah baseline; jumlah tender yang diikuti bukan satu-satunya ukuran keberhasilan.

## 8. Syarat produksi

Tidak boleh produksi jika identitas badan usaha belum jelas, app owner belum disepakati, auth negatif gagal, approval dapat dipalsukan, sumber angka tidak tersedia, atau jalur manual/darurat tidak berjalan.

Review legal/ketenagakerjaan/pajak/K3 dan acceptance process owner diperlukan. Empat minggu tanpa insiden saja tidak cukup; harus lulus suite negatif, latihan gangguan, restore, dan bukti manfaat.
