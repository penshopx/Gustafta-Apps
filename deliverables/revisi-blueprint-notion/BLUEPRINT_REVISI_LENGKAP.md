# Paket Revisi Blueprint Gustafta × SIGAP

Evaluasi dan revisi usulan • 9 Oktober 2026 • Belum disahkan untuk produksi

## Daftar isi

- Evaluasi Blueprint Notion: Kontraktor Berbasis AI dan Integrasi SIGAP
- Blueprint Kontraktor Berbasis AI — Gustafta × SIGAP
- Blueprint Penutup Celah Operasional — Portofolio SIAP/SIGAP
- Kontrak Integrasi SIGAP — Usulan yang Dapat Diuji
- Revisi SOP dan Kriteria Penerimaan
- Lampiran matriks 46 SOP; CSV lengkap tersedia terpisah

# Evaluasi Blueprint Notion: Kontraktor Berbasis AI dan Integrasi SIGAP

Tanggal evaluasi: 9 Oktober 2026  
Status: revisi untuk review pemilik proses; bukan persetujuan produksi atau opini hukum.

## 1. Kesimpulan

Materi layak menjadi rancangan awal, tetapi belum layak dipakai sebagai spesifikasi implementasi tanpa perbaikan. Kekuatan utamanya adalah pemetaan 39 SOP, pembagian peran spesialis, penekanan persetujuan manusia, dan upaya menentukan pemilik data. Hambatan utamanya adalah identitas bisnis yang tercampur, kontrak keamanan yang belum mengikat, duplikasi domain aplikasi, dan status kemampuan yang belum dibuktikan.

Revisi memisahkan tiga hal:

1. **Gustafta:** platform identitas, izin, memori bisnis, penugasan, kolaborasi, dan audit aktivitas platform.
2. **Perusahaan pengguna:** badan usaha yang memiliki legalitas, proyek, pekerja, kontrak, dan kewajiban hukum.
3. **Aplikasi domain:** sumber transaksi resmi; SIGAP mengoordinasikan, bukan mengambil alih kepemilikan transaksi.

“Otonom” dibatasi pada pekerjaan administratif berisiko rendah. Tindakan keuangan final, komitmen kontraktual, penerimaan mutu, keputusan ketenagakerjaan, dan pengoperasian alat tetap menjadi tanggung jawab manusia berwenang.

## 2. Cakupan sumber yang benar-benar dibaca

| Lampiran | Isi yang tersedia | Batas evaluasi |
| --- | --- | --- |
| BLUE_PRINT_APLIKASI_PENUTUP_CELAH_OPERASIONAL | Satu Markdown induk | Tujuh tautan rincian aplikasi tidak berisi dokumen turunannya dalam ZIP |
| BLUE_PRINT_KONTRAKTOR_OTONOM | Satu Markdown induk | Tidak berisi bukti legalitas atau hasil uji runtime |
| SOP_AGENTIC | CSV biasa dan CSV `_all` | Tabel ringkasan 39 SOP, bukan langkah lengkap per SOP |
| SOP_KONVENSIONAL | Markdown adaptasi dan dua CSV SOP Agentic | Bukan 39 naskah SOP konvensional asli; diagnosis salah isi tidak dapat dibuktikan terhadap naskah aslinya |
| SPESIFIKASI_INTEGRASI_SIGAP | ZIP tanpa ekstensi berisi satu Markdown | API, event, tools, dan aplikasi berstatus “sudah dibuat” belum diverifikasi live dalam evaluasi ini |

Evaluasi tidak membuka tautan Notion, mengubah halaman Notion, mengubah kode aplikasi, menerbitkan aplikasi, atau memindahkan data perusahaan. Paket hasil dapat diimpor atau disalin kembali setelah review.

## 3. Daftar masalah dan koreksi

| ID | Prioritas | Sumber dan bukti | Dampak | Koreksi |
| --- | --- | --- | --- | --- |
| F01 | Kritis | Blueprint Kontraktor §1: Nama “Gustafta Apps”; kategori “BUJKN & BUJKA”; daftar legalitas | Merek platform dianggap kontraktor berizin dan dua kategori badan usaha dianggap sekaligus berlaku | Pisahkan platform dari perusahaan pengguna; legalitas hanya dari bukti terverifikasi |
| F02 | Kritis | Kontraktor §2, §7: Notion SSOT; Integrasi §4.2: Notion bukan sumber transaksi kedua; Celah §3: aplikasi domain pemilik | Angka stok, progres, upah, dan termin dapat bercabang | Tetapkan satu pemilik per domain; Notion untuk spesifikasi/SOP/ringkasan nonotoritatif |
| F03 | Kritis | Integrasi §3.3 keputusan memuat `by`; §2 memuat `X-Actor` | Identitas approver berpotensi dipalsukan jika dipercayai server | Identitas berasal dari sesi/token terverifikasi; field dan header klien bukan sumber otorisasi |
| F04 | Kritis | Kontraktor §4.6: “klaim retur otomatis”; Integrasi §4.8.1: tender menang membuat jaminan; §8: agen hanya read/draft/propose | Aksi final terjadi sebelum persetujuan atau diterima pihak ketiga | Semua hanya proposal/draf; posting/issue/release oleh aplikasi pemilik setelah gate dan pengecekan ulang |
| F05 | Kritis | Kontraktor §4.5 dan §6: stop-work menunggu konfirmasi HSE | Respons bahaya dapat menunggu AI atau antrean digital | Alarm segera; manusia mengikuti prosedur darurat tanpa menunggu AI; izin melanjutkan pekerjaan harus eksplisit |
| F06 | Tinggi | Approval hanya ID, peran, nilai; tidak ada revisi/hash bukti/masa berlaku | Objek berubah setelah disetujui; persetujuan lama dapat dipakai ulang | Ikat ke tenant, proyek, object_revision, payload_hash, evidence_refs, policy_version, expiry |
| F07 | Tinggi | Integrasi §2 OAuth/JWT dan scope; belum ada kontrak tenant/project; `*:read` di Insight | Scope baca dianggap hak ke semua perusahaan atau semua field | Izin = aplikasi + tenant + proyek + aksi + field + status akun; default deny |
| F08 | Tinggi | HMAC hanya `sha256=<hmac>`; tidak ada timestamp/replay window | Event lama dapat diputar ulang | Tanda tangani timestamp + delivery ID + raw body; validasi waktu dan inbox dedup |
| F09 | Tinggi | Outbox disebut “tidak ada event hilang”; retry/DLQ tanpa replay/reconciliation | Jaminan berlebihan; kegagalan tetap mungkin | Outbox/inbox durable, observability, replay terbatas, rekonsiliasi; at-least-once bukan exactly-once |
| F10 | Tinggi | MCP contoh `requiresApproval`, `destructive` dalam annotations | Metadata tool dianggap kontrol keamanan; field tersebut bukan nama hint standar MCP | Gunakan hint standar yang sesuai dan extension kebijakan; otorisasi/gate tetap di server API |
| F11 | Tinggi | Celah memiliki SIAP GUDANG; Integrasi memiliki SIGAP Procure; RAB/Tender, HR/Tenaga, Legal/LKUT tumpang tindih | Pembuatan aplikasi baru menggandakan data dan biaya operasi | Registry alias dan kemampuan; perluasan aplikasi lebih dulu sebelum proyek aplikasi baru |
| F12 | Tinggi | Celah §5, Kontraktor §9, Adaptasi §8 berbeda; governance di gelombang terakhir | Tim tidak memiliki satu urutan dependensi; rilis terjadi tanpa kontrol dasar | Satu roadmap berbasis stage gate; governance/security sejak fase 0 |
| F13 | Tinggi | SOP17 berlabel L4 namun memerlukan persetujuan lembur; SOP23 L4 mencakup pemeliharaan fisik | Level otomatisasi salah dibaca sebagai kewenangan operasional | Pisahkan rekap/pengingat L4 dari izin lembur/servis L2–L3 |
| F14 | Tinggi | SOP30–39 “agen utama” untuk SOP jabatan | Jabatan manusia dan tanggung jawabnya seolah digantikan AI | SOP jabatan tetap manusia accountable; agen hanya copilot |
| F15 | Tinggi | Ekspor SOP tidak punya langkah, input, output, guardrail, KPI per baris | Tabel belum menjadi SOP yang dapat diuji | Lengkapi matriks 46 SOP + kerangka wajib; detail lokal dan pengesahan tetap diperlukan |
| F16 | Tinggi | Roadmap menunda K3, sementara pemantauan dijanjikan otomatis | K3 dasar seolah menunggu aplikasi/vision | K3 manual dan jalur darurat berlaku sejak hari pertama; AI K3 hanyalah tambahan |
| F17 | Sedang | Celah offline queue tanpa konflik/auth saat sinkron | Stok ganda, unggahan lama, transaksi setelah izin dicabut | Status lokal belum final; idempotensi, revision, reauth, conflict queue, cache privat |
| F18 | Sedang | Semua rupiah integer tanpa aturan kuantitas/pembulatan | Volume pecahan dan perhitungan AHSP/pajak tidak terdefinisi | Decimal deterministik untuk volume/tarif; pembulatan nilai final tercatat per aturan versi |
| F19 | Sedang | “Self-hosted” dianggap data tidak keluar; model frontier via API disarankan | Risiko transfer data tetap ada | Kebijakan klasifikasi, minimisasi, penyedia yang disetujui, dan persetujuan transfer |
| F20 | Sedang | Penawaran ≥60%, respons <5 menit, zero accident tanpa baseline | Janji hasil yang belum diukur; respons otomatis disamakan solusi | Target pilot, bukan jaminan; bedakan acknowledgment, respons substantif, dan penyelesaian |
| F21 | Sedang | Integrasi §11 “73 Paket” tetapi daftar menghilangkan PA | Cakupan katalog tidak konsisten | Angka 73 adalah hitungan internal tabel termasuk PA001; tanpa PA = 72; bukan verifikasi resmi regulasi |
| F22 | Sedang | “HPS pembanding” dalam tugas estimator kontraktor | Harga penawaran kontraktor dapat tercampur HPS resmi pemberi kerja | Gunakan estimasi internal/RAB penawaran; HPS resmi hanya sebagai sumber dari pemberi kerja bila tersedia |
| F23 | Tinggi | Integrasi §4.5 mendengar `project.ncr.opened`, sedangkan §4.2 NCR milik QA/QC | Temuan mutu memiliki dua penerbit final | QA/QC menerbitkan NCR; Project dan ISO menyimpan referensi/read model |
| F24 | Tinggi | Legalitas, SKK, SIO dan AHSP dicampur tanpa register applicability | Sertifikat atau aturan domain yang berbeda dianggap saling menggantikan | Register bukti, jenis sertifikat, regulator, penerbit, periode berlaku, ruang lingkup dan verifikator |

Prioritas “Kritis” berarti harus diselesaikan sebelum alur produksi yang terkait, bukan pernyataan bahwa sistem live sudah mengandung kerentanan tersebut.

## 4. Bagian yang dipertahankan

- 39 nomor SOP asli sebagai identifier migrasi; 29 proses dan 10 jabatan.
- Tujuh alur operasional A–G; tambah alur pra-kontrak dan governance tanpa mengganti nomor lama.
- Roster 16 spesialis sebagai katalog peran jangka panjang, bukan jumlah worker minimum.
- Progres diterima manusia dan dihitung deterministik; angka finansial resmi milik ERP.
- Upload penawaran, tanda tangan, transfer dana, dan pengesahan tetap terkontrol manusia.
- CloudEvents, OpenAPI, outbox, idempotensi, dan circuit breaker sebagai kontrak target yang perlu diuji.

## 5. Batas kepastian hukum dan kemampuan

Daftar subklasifikasi dan angka 73 hanya diperiksa konsistensi internalnya, tidak dicocokkan ulang dengan lampiran resmi regulasi. Dokumen ini tidak menetapkan bahwa perusahaan pengguna memiliki semua subklasifikasi.

PP 28/2025 dibedakan dari Perpres pengadaan; jangan menulis “Perpres 28/2025”. Permen PU 6/2025 dan Kepdirjen Bina Konstruksi 281/2026 ditempatkan pada konteks standar usaha/BUJK/SBU, bukan dasar tunggal SKK. Persyaratan tiap subklasifikasi, tender, tenaga ahli, KSO, dan badan usaha asing harus diperiksa dari naskah resmi serta dokumen pemilihan yang berlaku.

Belum ada validasi tarif upah/lembur, pajak, BPJS, AHSP, aturan tanda tangan, atau kewajiban sertifikasi ISO untuk perusahaan/proyek tertentu. Semua wajib memiliki applicability register, sumber resmi, effective date, versi, dan reviewer kompeten sebelum dipakai produksi.

## 6. Keputusan yang perlu disahkan pemilik

1. Identitas badan usaha pilot beserta bukti legalitas dan penanggung jawab manusia.
2. Aplikasi pemilik tiap domain dan aliasnya; bukan sekadar daftar nama aplikasi.
3. Tiga peran pilot, batas akses, plafon biaya AI, dan indikator keberhasilan.
4. Kebijakan approval berdasarkan nilai kumulatif, risiko, transaksi terkait, dan segregasi tugas. Angka Rp50 juta dalam sumber hanyalah contoh, bukan kebijakan otomatis yang telah disahkan.
5. Retensi, penggunaan foto/CCTV/lokasi pekerja, transfer ke penyedia AI, dan jadwal pemulihan.
6. Penerimaan hasil uji integrasi; keberadaan aplikasi bukan bukti bahwa API dan MCP-nya siap.

## 7. Paket revisi

- `02-blueprint-kontraktor-berbasis-ai.md`: identitas, arsitektur, roster, workflow dan roadmap yang diselaraskan.
- `03-blueprint-penutup-celah.md`: pemilik data dan scope MVP aplikasi/modul.
- `04-kontrak-integrasi-sigap.md`: auth, approval, API, events, MCP, offline dan tes kontrak.
- `05-sop-dan-kriteria-penerimaan.md`: template eksekusi SOP dan aturan migrasi.
- `06-matriks-sop-revisi.csv`: 39 SOP yang diperbaiki + tujuh SOP baru.
- `BLUEPRINT_REVISI_LENGKAP.md` dan `BLUEPRINT_REVISI_LENGKAP.html`: dokumen gabungan.
- `manifest-sumber.json`: inventaris sumber, hash, jumlah baris dan kesamaan CSV.

Semua revisi adalah usulan dokumen. Tidak ada klaim bahwa aplikasi, konektor, runtime, atau integrasi live telah selesai karena paket ini dibuat.


---

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


---

# Blueprint Penutup Celah Operasional — Portofolio SIAP/SIGAP

Status: rancangan scope dan ownership; tidak menyatakan semua aplikasi sudah dibangun.

## 1. Aturan inventaris

Nama aplikasi tidak cukup untuk membuktikan domain atau kemampuan. Buat registry dengan app_id stabil, nama dagang/alias, workspace, URL deployment terverifikasi, owner proses, tenant model, API version, auth scheme, event types, contract-test date dan status.

Status kemampuan: **belum diketahui -> dokumen tersedia -> prototype -> endpoint terverifikasi -> pilot diterima -> produksi disetujui**. “Sudah dibuat” tidak otomatis berarti API read/write, MCP, outbox dan approval siap.

Rincian per aplikasi yang hanya ditautkan dalam ekspor masih merupakan dependency dokumen. Scope di bawah adalah proposal pengganti minimal untuk review, bukan rekonstruksi rincian Notion yang tidak tersedia.

## 2. Registry domain dan alias

| Domain | Nama/alias dari sumber | Keputusan revisi |
| --- | --- | --- |
| Project control | SIAP PROYEK / SIGAP Project | Satu engine; Ruang Proyek Gustafta pintu masuk, bukan ledger proyek kedua |
| Keuangan | ERP Keuangan / SIGAP Finance | Satu owner jurnal, anggaran, invoice, pajak dan pembayaran |
| Pengadaan + gudang | SIAP GUDANG / SIGAP Procure | Satu domain logistik; pisah modul procurement/gudang jika perlu, tidak dua master vendor/stok |
| Tenaga | SIAP TENAGA / SIGAP HR & SKK | Satu owner personel/absensi; payroll finansial tetap ERP |
| Alat | SIAP ALAT / SIGAP Aset & Alat / perluasan TATABANGUN | Tentukan host modul setelah audit; satu register aset dan booking |
| Purnajual | SIAP LAYAN / SIGAP Klien & Purnajual / TATABANGUN | Satu owner tiket/garansi; CRM dan work order lewat referensi |
| Estimasi | SIAP RAB / SIGAP Tender & Estimasi | Tender pipeline dan estimator bisa modul; satu versi RAB penawaran |
| Legal | SIAP LKUT / KontrakKonstruksi / SIGAP Legal | SBU/perizinan dan kontrak boleh berbeda owner objek; bukan tiga register identik |
| Mutu | QA/QC Core + ISO Hub | QA/QC owner keputusan mutu proyek; ISO owner SOP/audit/CAPA sistem; saling referensi |
| Keselamatan | Contractor Safety Passport / SIGAP K3 | Satu owner keputusan keselamatan; worker qualifications direferensi HR |
| Integritas | SMAP / Pancek / ProComply | Domain terkait tetapi tidak identik; kasus whistleblowing tetap terpisah dan restricted |
| Lintas domain | SIGAP HUB / Insight / Akademi | Registry/proyeksi/knowledge, tidak mengambil ledger owner |
| Dokumen | Ruang Simpan / CDE / ISO documents | Bytes/arsip, status drawing, dan dokumen terkendali dibedakan; grant eksplisit |

## 3. Pemilik data yang diselaraskan

| Objek | Owner otoritatif | Konsumen dan syarat |
| --- | --- | --- |
| Profil resmi perusahaan dan arsip berizin | Ruang Simpan sesuai kontrak koneksi | Aplikasi sektoral read sesuai scope/grant; tidak otomatis baca berkas |
| Project ID, WBS, baseline pelaksanaan, jadwal, progres accepted | SIAP PROYEK | ERP, gudang, alat membaca referensi/revision |
| RAB/BoQ penawaran | Estimasi | Baseline kontrak diserahkan lewat handover accepted; sumber versi tetap tersimpan |
| Nilai kontrak legal dan adendum | KontrakKonstruksi/legal owner | Project dan ERP menyimpan referensi beserta snapshot terkontrol |
| Anggaran/COA/kode biaya/jurnal/invoice/pajak | ERP | Project tidak boleh menjadikan hasil LLM angka finansial resmi |
| Vendor/material/MR/PO/mutasi stok | Gudang/Procure owner | ERP payable setelah validasi; QC acceptance dari QA/QC |
| SDM/absensi/SKK dan bukti personel | Tenaga/HR owner | Minimal fields ke K3/Legal/Project; ERP untuk pembayaran |
| SIO/izin dan fitness yang relevan | Registry jenis sertifikat sesuai penerbit/domain | Jangan samakan SKK dan SIO; sumber bukti selalu terlihat |
| Aset/log jam/servis/booking/sewa operasional | Alat owner | ERP penyusutan/tagihan; kontrak sewa legal melalui referensi |
| NCR/acceptance hasil uji | QA/QC Core | Project progres; ISO read reference untuk analisis/CAPA |
| Insiden/permit K3/izin lanjut kerja | Safety Passport/K3 owner | Project mendapat status minimal sesuai izin |
| SOP resmi, audit dan CAPA sistem | ISO Hub | Aplikasi menaut versi yang berlaku |
| Tiket garansi/komplain | Layan owner | Work order TATABANGUN referensi; retensi finansial ERP |
| App/project/vendor/person mapping | HUB registry | Hanya ID dan pemetaan, tidak mengedit master bisnis milik aplikasi |

Tidak semua aplikasi menyimpan hanya ID tanpa data: read model atau snapshot historis dapat diperlukan. Snapshot harus memuat source_app, source_id, source_revision, captured_at dan tidak diedit sebagai master.

## 4. MVP per modul

### 4.1 HUB — fondasi minimum, bukan aplikasi master raksasa

Scope: app/capability registry, mapping ID, credential reference, event schema registry, inbox dedup, delivery status, task references, approval deep link dan audit koordinasi. Kredensial disimpan di Secrets/secret manager, bukan kolom plaintext.

Tidak termasuk: master personel lengkap, jurnal, saldo stok, database approval final paralel, atau seluruh data transaksi semua aplikasi.

Acceptance: alias tidak membuat duplikat; app down tidak mematikan aplikasi lain; revoke koneksi efektif; outbox backlog dan schema mismatch terlihat; isolasi tenant/project lulus.

### 4.2 GUDANG / Procure

Entitas minimum: vendor, material + uom conversion, gudang/lokasi, MR, RFQ, PO, receipt kandidat, acceptance reference, stock ledger, reservation, adjustment proposal.

Status: MR draft -> pending -> approved/rejected; PO draft -> approved -> issued; receipt recorded -> quarantined -> accepted/rejected. available stock tidak termasuk quarantined.

Kontrol: mutasi append-only dan reversal, anti-negative stock sesuai kebijakan, penguncian saldo/reservation, unit conversion deterministik, three-way matching, audit item/lot, FEFO bila masa kedaluwarsa relevan.

Acceptance: receipt duplikat tidak menambah stok; dua issue serentak tidak overdraw; stale approval gagal; adjustment perlu alasan dan reviewer independen.

### 4.3 TENAGA / HR

Entitas: pekerja, hubungan kerja, penempatan proyek, bukti keahlian, attendance observation, attendance accepted, overtime request, approved recap dan payroll input snapshot.

Kontrol: minimisasi data, pembatasan field upah/identitas, mekanisme dispute absensi, effective-date rules, approval lembur terpisah rekap.

Tidak termasuk transfer dana, penandatanganan kontrak otomatis, atau keputusan disiplin dari AI. Slip upah tidak disebar ke grup WA; portal pribadi/kanal terverifikasi.

Acceptance: pengguna hanya melihat pekerja yang diizinkan; revisi absensi merubah draft payroll bukan payroll posted; snapshot approved tidak diam-diam berubah.

### 4.4 ALAT

Entitas: asset, meter reading, inspeksi, maintenance plan, work order, booking, rental draft, handover dan return.

Kontrol: hold administratif ketika inspection failed; release oleh petugas berwenang; konflik booking; jam operasi/BBM anomali menjadi investigasi; sewa tidak ditawarkan otomatis karena idle tujuh hari.

Acceptance: tidak double-booking; alat hold tidak bisa dipesan untuk operasi; jadwal maintenance boleh otomatis tetapi servis/kelayakan tetap manusia; billing tetap ERP.

### 4.5 LAYAN

Entitas: kontrak/unit, handover reference, warranty rules, ticket, triage, work order reference, visit, closure evidence.

Kontrol: acknowledgment berbeda diagnosis; urgent safety issue langsung dialihkan; cakupan garansi sesuai kontrak/version; pelanggan tidak membaca tiket pelanggan lain.

Acceptance: tiket idempoten, SLA business-hours jelas, komitmen biaya perlu approval, closure menyimpan bukti.

### 4.6 RAB / Tender

Entitas: tender opportunity, source document version, eligibility evidence, BoQ, AHSP ruleset, price source date/location, estimates, exclusions, contingency, bid package dan handover baseline.

Kontrol: decimal arithmetic, unit conversion, rounding, koefisien/satuan divalidasi; no-price = missing bukan angka karangan; rumus transparan; HPS resmi tidak digantikan estimasi kontraktor.

Acceptance: setiap subtotal dapat direproduksi; sumber volume/harga tersedia; perubahan input menciptakan revision dan approval baru; tidak unggah/tanda tangan otomatis.

## 5. Pembangunan dan deployment

Gunakan stack/proses proyek yang sudah ada; jangan menjadikan React/Fastify atau DB baru sebagai migrasi wajib tanpa kebutuhan. Pada Gustafta, pertahankan modular monolith; aplikasi sektoral yang sudah terpisah dihubungkan melalui adapter.

UI/API stateless dapat memakai deployment Autoscale. Worker terjadwal harus memiliki runtime yang benar-benar berjalan atau penjadwal eksternal; jangan mengandalkan interval in-memory pada service yang dapat tidur. Pemilihan runtime dilakukan setelah mengukur volume/latensi dan biaya. Tidak mewajibkan satu Reserved VM per aplikasi.

Database queue/outbox dapat cukup untuk pilot. NATS/RabbitMQ/Redis bukan tiga komponen yang harus dipasang bersamaan. Tambah broker jika kebutuhan throughput/routing terukur membuktikannya.

## 6. Urutan yang disepakati

Ikuti fase pada blueprint utama: governance + inventory -> read pilot -> draft + gate -> event/reconciliation -> modul lanjutan. Gudang dan tenaga paralel hanya jika pemilik dan tim independen siap.

Jangan membangun aplikasi baru sebelum capability audit memastikan fungsi tidak tersedia atau tidak dapat diperluas pada aplikasi yang ada.


---

# Kontrak Integrasi SIGAP — Usulan yang Dapat Diuji

Status: kontrak target. Contoh endpoint/schema bukan klaim route live.

## 1. Compatibility dan registry

Endpoint baru direkomendasikan `/api/v1/...`; adapter mencatat base URL dan path aktual aplikasi lama yang memakai `/v1`. Jangan mengganti route publik atau format error aplikasi yang sudah ada tanpa versi dan migrasi konsumen.

Kontrak Ruang Simpan saat ini terpisah dari kontrak SIGAP target:

- Profil: `/api/v1/ruang-simpan/company-profile`.
- Scope `profile:read` hanya membaca profil pemilik koneksi.
- Header respons privat: `Cache-Control: private, no-store` dan `X-Gustafta-RS-Contract: rs-app-v1-private-no-store`.
- Token/scope yang ada tidak otomatis dimigrasikan ke OAuth/JWT hanya karena spesifikasi SIGAP mengusulkannya.
- Auth SBU lokal harus membatasi pengguna yang boleh membaca profil perusahaan terkonfigurasi. Keberhasilan token server tidak membuktikan izin semua pengguna SBU.

Registry capability menyimpan implemented/tested status per route/tool/event, tanggal tes, evidence_ref, auth method, compatibility version dan owner. URL contoh `lsbu.co.id` pada sumber tidak dianggap domain operasional yang telah tersedia.

## 2. Autentikasi dan otorisasi

Client credentials/OAuth2 adalah pilihan target untuk app-to-app setelah identity authority disepakati. Jangan membuat issuer berbeda pada setiap aplikasi tanpa trust model.

Jika JWT digunakan, verifikasi signature, algoritma allowlist, issuer, audience, expiry/not-before, key ID, client status, revocation policy dan clock skew. Token audience terikat aplikasi; service identity terikat tenant/project grant. Kredensial per role-app-environment, bukan satu token semua tenant.

Otorisasi wajib memeriksa:

```text
client/user aktif
AND koneksi aktif
AND audience/app benar
AND tenant diizinkan
AND project membership/grant sesuai
AND action scope eksplisit
AND field/document grant sesuai
AND policy bisnis dan status objek mengizinkan
```

Scope `read` tidak mencakup semua field, dokumen atau tenant. Hindari wildcard produksi seperti `*:read` dan `smap.*:read`; enumerate resource/field yang diberikan. Whistleblowing content dilarang bagi agen umum, termasuk dashboard agregasi, vector index, log dan event payload.

`X-Actor` atau field `by` tidak menentukan identitas. Server mendapatkan pelaku dari token/sesi. Jika on-behalf-of diperlukan, gunakan delegated proof terverifikasi, grant terbatas dan audit actor+delegator; header plaintext tidak cukup.

## 3. Data dan HTTP

- Internal ID opaque stabil (misalnya UUID); kode `PRJ-YYYY-NNN` untuk tampilan dan mapping, bukan pembatas kapasitas atau sumber hak akses.
- Tenant/project context wajib dan dicek server, tidak dipercaya dari body saja.
- Waktu timestamp UTC atau ISO-8601 ber-offset; simpan timezone proyek untuk deadline/cutoff. Date-only digunakan untuk tanggal bisnis.
- Kuantitas/koefisien/tarif memakai decimal string atau numeric decimal, unit dan precision eksplisit. Nilai final rupiah mengikuti rounding rule versi; no JavaScript float untuk kalkulasi finansial.
- Optimistic concurrency memakai integer `revision` dan atomic conditional update. Revision berubah setiap mutasi material.
- Body limit pra-parse, input schema strict, pagination bounded, timeouts dan rate limits per principal/tenant sesuai beban.
- Status: 401 identitas tidak valid; 403 tidak berizin; 404 sesuai policy concealment; 409 revision/idempotency conflict; 422 aturan bisnis; 429 rate limit; 503 dependency tidak tersedia.
- `application/problem+json` untuk kontrak baru; route legacy boleh mempertahankan JSON existing melalui adapter.
- Semua respons privat termasuk penolakan, unduhan dan error: `Cache-Control: private, no-store` sebelum auth/rate limiting.

Contoh error target:

```json
{
  "type": "urn:sigap:error:revision-conflict",
  "title": "Objek berubah sejak ditinjau",
  "status": 409,
  "detail": "Muat ulang objek dan ajukan persetujuan untuk revisi terbaru.",
  "trace_id": "trace-opaque",
  "retryable": false
}
```

Jangan memasukkan token, isi dokumen privat atau detail internal SQL dalam error.

## 4. Draf dan approval state machine

```text
draft -> pending_approval -> approved -> execution_pending -> executed
                           -> rejected
                           -> expired
                           -> superseded (revision/bukti/policy berubah)
execution_pending -> failed_retryable / failed_manual_review
```

Approval harus mengikat:

```json
{
  "approval_id": "opaque",
  "tenant_id": "tenant-opaque",
  "project_id": "project-opaque",
  "object": {
    "app_id": "procure",
    "type": "purchase_order",
    "id": "po-opaque",
    "revision": 3,
    "payload_hash": "sha256-of-canonical-approved-fields"
  },
  "evidence_refs": [
    {"id": "quote-opaque", "revision": 2, "checksum": "sha256"}
  ],
  "policy_id": "procurement-policy",
  "policy_version": 2,
  "required_roles": ["project_manager"],
  "expires_at": "2026-10-10T10:00:00Z",
  "state": "pending_approval"
}
```

Canonical payload hashing harus memiliki field list dan normalization/version yang ditentukan. Perubahan harga/item/penerima, bukti terkait atau policy yang memengaruhi keputusan meng-invalidasi approval.

Keputusan manusia lewat sesi terverifikasi:

```text
POST /api/v1/approvals/{id}/decision
Idempotency-Key: opaque-client-generated-key
```

```json
{"decision":"approved","expected_revision":3,"note":"Sesuai hasil review."}
```

Server menetapkan approved_by dan waktu; memeriksa entitlement saat keputusan serta saat execution. Agen tidak memiliki decision scope. Tombol WA/Telegram membawa deep link/login atau challenge sekali pakai terikat approver/objek/action/expiry; bukan persetujuan siapa saja yang menerima forwarded message.

Segregasi tugas: maker tidak mengesahkan transaksi sendiri pada domain yang memerlukan checker. Approval nilai menggunakan nilai kumulatif dan transaksi terkait untuk mencegah split PO. Timeout atau approver tidak tersedia tidak berarti approved.

Eksekusi otomatis hanya boleh dilakukan executor aplikasi terhadap aksi yang memang disahkan policy, setelah approval valid dan kondisi terakhir diperiksa ulang. Transfer dana, tanda tangan, atau keputusan keselamatan tidak menjadi hak agen generik.

## 5. Idempotensi dan simulasi

Untuk mutasi agen (POST/PUT/PATCH dan DELETE jika tersedia), key disimpan dengan tenant, client, route, normalized-request hash, state, response reference, expiry dan business operation ID.

- Key sama + payload sama: hasil operasi yang sama, tidak efek kedua.
- Key sama + payload berbeda: 409.
- Concurrent same key: unique constraint/lock; hanya satu efek bisnis.
- Ambiguous timeout: query operation status atau retry key yang sama, bukan membuat key baru.
- TTL harus mencakup retry/offline window; aturan unik business operation tetap mencegah duplikasi setelah key record expired.
- Reauthorization tetap dilakukan saat replay; jangan replay response privat setelah akses dicabut.

`dry_run=true` menjalankan auth dan validasi tanpa commit, outbox, email, WA, debit, reservation, file persistence atau efek eksternal lain. Simulasi tidak memberikan jaminan kapasitas/budget masih tersedia saat execution; validasi ulang dalam transaksi.

## 6. Event CloudEvents, HMAC dan reliability

```json
{
  "specversion": "1.0",
  "id": "event-opaque",
  "source": "urn:sigap:app:procure",
  "type": "id.sigap.procure.goods.accepted.v1",
  "subject": "receipt/receipt-opaque",
  "time": "2026-10-09T03:00:00Z",
  "datacontenttype": "application/json",
  "tenantid": "tenant-opaque",
  "projectid": "project-opaque",
  "traceid": "trace-opaque",
  "data": {
    "receipt_id": "receipt-opaque",
    "revision": 4,
    "acceptance_ref": "qc-opaque"
  }
}
```

Gunakan satu namespace registry. Event observation/proposed berbeda dari accepted/issued/posted. `progress.accepted`, bukan `progress.updated` yang ambigu; `qaqc.ncr.opened`, bukan Project sebagai penerbit NCR final. Event tender won membuat **draf** dependency, bukan mengesahkan kontrak/jaminan.

Pengirim webhook:

```text
X-Sigap-Key-Id: key-version
X-Sigap-Timestamp: unix-seconds
X-Sigap-Delivery: delivery-uuid
X-Sigap-Signature: sha256=<hex>
signature = HMAC_SHA256(key, timestamp + "." + delivery_id + "." + raw_body)
```

Penerima memakai raw bytes sebelum parsing, constant-time comparison, timestamp window contoh ±5 menit sesuai policy, unique `(source,event_id)` dan delivery record. Delivery replay ditolak; pengiriman ulang sah membuat delivery ID/timestamp baru dengan event ID tetap. Auth producer diperiksa against tenant/source allowlist, bukan percaya tenantid dari payload.

Alur durable:

1. Transaksi domain + outbox ditulis atomik.
2. Worker claim dengan lease, retry/backoff/jitter dan attempt count.
3. Penerima verifikasi lalu menyimpan inbox sebelum acknowledge.
4. Consumer menerapkan efek dan menandai processed secara atomik/idempoten.
5. Poison event -> DLQ; schema mismatch tidak dibuang diam-diam.
6. Replay dilakukan operator dengan izin, alasan dan audit; rekonsiliasi membandingkan revision/domain state.

Urutan tidak dijamin global. Gunakan object revision/sequence untuk mendeteksi event tua atau gap; fetch state resmi bila perlu. Outbox mengurangi risiko kehilangan, tidak menghapus kemungkinan kegagalan permanen. Monitor backlog age, failed deliveries, DLQ dan reconciliation drift.

429/5xx/network transient dapat retry bounded; 401/403 berhenti sampai konfigurasi/izin diperbaiki; 409 perlu rekonsiliasi; 422 perlu keputusan proses. Side effect eksternal yang hasilnya ambigu masuk manual review jika provider tidak memiliki idempotency/status proof.

## 7. MCP bukan pengganti otorisasi

REST adapter diprioritaskan; MCP opsional untuk runtime yang membutuhkannya. Tool mengikuti auth API yang sama, bukan jalur privileged kedua.

Contoh metadata:

```json
{
  "name": "procure_create_purchase_request_draft",
  "description": "Membuat draf MR; tidak menyetujui atau menerbitkan PO.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["project_id", "items"],
    "properties": {
      "project_id": {"type": "string"},
      "items": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["material_id", "quantity", "uom"],
          "properties": {
            "material_id": {"type": "string"},
            "quantity": {"type": "string", "pattern": "^[0-9]+([.][0-9]+)?$"},
            "uom": {"type": "string"}
          }
        }
      }
    }
  },
  "annotations": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false,
    "openWorldHint": false
  }
}
```

Validasi bisnis tetap mensyaratkan quantity >0, satuan valid, precision dan batas nilai. Hint idempotent false di contoh karena input tidak mendefinisikan operation key; adapter harus menyediakan idempotency key stabil untuk retry. Hint hanyalah metadata, bukan proof keamanan. Approval requirement tercatat dalam policy registry/extension vendor, lalu ditegakkan server.

Metadata/output tool dan dokumen eksternal tidak dipercaya sebagai instruksi. Prompt injection tidak boleh menambah grant, memilih arbitrary URL, membaca secret, atau membuat aksi final.

## 8. Offline, dokumen dan privasi

- Offline boleh capture observation/draft; approval, accepted stock/progress/payroll tidak final sebelum server menerima.
- Queue lokal menyimpan operation ID/revision; reauth dan recheck izin sebelum sync; konflik masuk review, bukan last-write-wins pada uang/stok.
- PWA service worker tidak men-cache API privat; browser lokal hanya menyimpan data minimal dengan TTL/clear-on-logout, revoked-state handling dan shared-device policy.
- File upload memiliki limit, allowlist type, malware checks bila diperlukan, checksum dan tenant isolation.
- Presigned URL pendek, operation/resource-bound, tidak dicatat ke analytics/log; server memeriksa grant sebelum menerbitkan. Folder grant mengikuti policy aktual, bukan snapshot izin seumur hidup.
- Memori/vector retrieval menerapkan filter izin sebelum pengambilan konteks; log prompt tidak otomatis menyimpan dokumen mentah/PII.
- Audit append-only untuk role aplikasi, akses operator terbatas, backup/protected export dan pemeriksaan integritas. “Tidak bisa dihapus” bukan klaim absolut terhadap DB administrator.
- Retensi/tombstone/redaction mengikuti kebijakan dan kewajiban hukum; audit tidak menjadi alasan menyimpan seluruh PII tanpa batas.

## 9. Skenario penerimaan integrasi

| Uji | Hasil wajib |
| --- | --- |
| Tanpa token/malformed/expired/revoked | 401 JSON; private no-store |
| Token tanpa action scope | 403; tidak ada efek |
| Tenant A menebak objek/proyek B | Ditolak; metadata, dokumen, event, memory tidak bocor |
| Pengguna SBU tanpa explicit company permission | Ditolak di SBU sebelum fetch profil perusahaan |
| Header X-Actor/body by dipalsukan | Tidak mengubah actor server; approval ditolak bila unauthorized |
| Approval revision 3, objek berubah revision 4 | 409/superseded; tidak execution |
| Dua keputusan/dua execution serentak | Satu hasil legal; audit lengkap; tidak efek ganda |
| Key sama, request berbeda | 409 |
| Webhook bad signature/stale/delivery replay | Ditolak sebelum business processing |
| Event duplikat/out-of-order | Tidak saldo ganda; revision reconcile |
| Worker mati setelah external call | Retry/status check atau manual review; bukan aksi ganda diam-diam |
| Dry-run | Tidak data/outbox/file/email/WA/reservation berubah |
| Offline sync setelah revoke | Ditolak; data lokal tidak menjadi final |
| AI/HUB down | Aplikasi domain tetap berjalan; jalur manual dan alarm darurat tersedia |
| Restore | RPO/RTO yang disetujui terbukti lewat drill, bukan sekadar backup tersedia |

Paket dokumen tidak menjalankan skenario tersebut terhadap semua aplikasi. Bukti test harus ditambahkan per capability sebelum status “pilot diterima”.


---

# Revisi SOP dan Kriteria Penerimaan

## 1. Struktur katalog

Nomor 1–29 tetap SOP proses. Nomor 30–39 tetap SOP jabatan, bukan workflow agen pengganti jabatan. Tambahan 40–46 menutup pra-kontrak dan governance:

40. Pencarian Tender dan Go/No-Go.
41. Estimasi dan Penyusunan RAB.
42. Penyusunan Dokumen Penawaran.
43. Review Kontrak dan Adendum.
44. Change Order.
45. Tata Kelola Agen AI / AgentOps.
46. Keamanan dan Privasi Data.

Alur A–G dipertahankan; H = Pra-kontrak & Perubahan; I = Governance. H/I merupakan pengelompokan tambahan, bukan klaim bahwa sumber awal memiliki sembilan alur.

Matriks CSV memuat 46 baris. Semua berstatus **Usulan revisi - belum disahkan**, bukan Aktif. Field kebijakan lokal seperti nama pejabat, limit, jam kerja, nomor formulir dan aturan hukum tetap harus dilengkapi process owner.

## 2. Level otomasi yang diperjelas

| Level | Batas yang diizinkan |
| --- | --- |
| L1 Asisten | Checklist, penjelasan dan dukungan dokumentasi; manusia menjalankan keputusan/aksi |
| L2 Kolaboratif | AI mengolah kandidat fakta; manusia verifikasi fisik/teknis sebelum acceptance |
| L3 Draf/Propose + Approval | AI menyiapkan paket proses; aksi final mengikuti gate dan executor aplikasi |
| L4 Administratif berisiko rendah | Read, rekap, reminder terkonfigurasi; tidak mengesahkan angka/izin/komitmen baru |

Level ditentukan **per langkah**, bukan otomatis semua langkah satu SOP. Rekap lembur boleh L4; izin lembur tetap manusia. Pengingat servis boleh L4; pekerjaan servis dan kelayakan alat tidak.

## 3. Template wajib SOP operasional

Setiap SOP disahkan setelah memiliki:

1. ID, judul, revisi, effective date, reviewer dan pejabat pengesah.
2. Tujuan, applicability proyek/kontrak dan exclusions.
3. Trigger yang membedakan observation, proposed dan accepted.
4. Input resmi, source owner, revision, freshness dan bukti.
5. **RACI manusia:** satu accountable owner; responsible/checker/consulted/informed jelas. Agen selalu copilot, bukan legal accountable.
6. Langkah AI vs manusia dan precondition/postcondition.
7. Gate bernama, approver, revision/hash bukti, expiry dan kebijakan eskalasi.
8. Output, status, formulir, audit dan siapa yang dapat membaca.
9. SLA: business/calendar time, start/stop clock, timezone, exception, escalation.
10. KPI: numerator/denominator, sumber, baseline, target dan frekuensi.
11. Guardrail: larangan, confidentiality, value cap, unknown/error path.
12. Jalur manual saat dependency gagal dan rekonsiliasi setelah pulih.
13. Acceptance test termasuk negatif, concurrent, replay dan stale evidence.

Bila gate melewati SLA, eskalasi ke pejabat pengganti sesuai delegasi tercatat; tidak auto-approve. Prioritas darurat menggunakan SOP keselamatan manusia, bukan timer approval administrasi.

## 4. Langkah minimum per keluarga proses

### A — Material & Logistik (1, 2, 3, 21; dukungan jabatan34/36)

Input: jadwal/BoQ accepted, stok by status, reservation, vendor quotation, budget. MR -> review kebutuhan -> draf pengadaan -> gate PO -> bukti fisik receipt -> gate QC -> stock ledger -> issuance per cost/WBS -> opname -> adjustment proposal.

KPI: kebutuhan terpenuhi tepat waktu, receipt verified, mismatch opname, stockout dan supplier defect. Tidak menghitung barang quarantine sebagai stok tersedia.

### B — Alat (4, 5, 22, 23; jabatan39)

Input: register, manual pabrikan, jam operasi accepted, inspection dan booking. Operator checklist -> hold bila gagal -> review Kepala Alat -> maintenance/repair work order -> teknisi melakukan -> bukti uji -> release manusia.

KPI: availability, downtime, overdue maintenance, confirmed fuel anomaly. Log AI tidak membuktikan servis terlaksana.

### C — Pelaksanaan & Mutu (6, 7, 12, 24, 25; jabatan30–33/35/37)

Input: kontrak/baseline, drawing versi berlaku, field measurement, test results. Observasi -> verifikasi volume/teknis -> acceptance mutu -> progres deterministik -> deviasi -> recovery proposal -> gate PM -> laporan eksternal.

KPI: bukti diterima, laporan tepat waktu, rework, variation tanpa approval. Quantity measurement dan QC acceptance tidak digabung menjadi keputusan satu agen.

### D — Keuangan & Pajak (8, 9, 10, 11, 14; jabatan38)

Input: ERP, BA accepted, kontrak, payroll accepted, ruleset pajak. Draft -> validasi angka/sumber -> maker-checker -> issued/posted manusia/aplikasi terotorisasi -> reconcile source proof.

KPI: close timeliness, invoice lead time, unresolved reconciliation, payroll disputes. Pengajuan upah cross-reference HR; tidak ada duplikasi employee master di ERP.

### E — SDM (15, 16, 17; handoff10)

Input: resource need, kontrak kerja, attendance accepted, sertifikat. HR validasi kebutuhan -> review kandidat -> keputusan manusia -> kontrak -> izin lembur -> rekap accepted -> payroll draft.

KPI: kebutuhan personel terpenuhi, sertifikat diverifikasi, dispute selesai. SKK/SKKNI/SIO tidak diperlakukan sebagai sertifikat identik.

### F — K3 & Keamanan (18, 19, 20)

Input: izin akses, prosedur darurat, CCTV/foto berizin, laporan manusia. Deteksi -> alarm -> tindakan petugas -> amankan bukti -> verifikasi/investigasi manusia -> tindakan korektif -> izin lanjut/closure berwenang.

KPI: alarm ter-deliver, response manusia, closure berbukti, false alarms. Tidak ada tuduhan pencurian, sanksi atau penentuan kondisi medis otomatis.

### G — Serah Terima & Purnajual (13, 26, 27, 28, 29)

Input: kontrak, acceptance, punch list, as-built, warranty. Checklist -> inspeksi pihak berwenang -> BA sah -> maintenance obligation -> ticket -> scope decision -> work order -> evidence closure.

KPI: handover completeness, complaint lead time, repeat defect, accepted closure. PHO, FHO dan consumer BAST dipisah.

## 5. Tujuh SOP baru — minimum langkah dan gate

### SOP40 — Tender dan Go/No-Go

1. AI mengumpulkan peluang dari sumber sah dan bertimestamp.
2. AI mengekstrak persyaratan paket, sumber/halaman dan deadline.
3. Server mencocokkan bukti legalitas/kualifikasi perusahaan; unknown -> review.
4. Manajer tender meninjau eligibility dan kapasitas.
5. Direktur memutuskan Go/No-Go dengan alasan.
6. Catat keputusan, versi sumber, reviewer, deadline dan tindak lanjut.

Output: opportunity review dan decision record. Larangan: login portal pakai kredensial bebas, bypass CAPTCHA/access control, atau final rejection dari tebakan.

### SOP41 — Estimasi dan RAB

1. Terima BoQ/gambar revision sah; deteksi unit/volume missing.
2. Tentukan ruleset AHSP applicable dan sumber harga date/location.
3. Engine menghitung subtotal, overhead/risiko/margin sesuai policy versi.
4. Estimator memverifikasi volume/koefisien/asumsi dan sensitivity.
5. Gate Estimator Senior; perubahan input mengganti revision.
6. Ekspor RAB immutable revision dan handover reference.

Output: RAB draf/accepted, assumptions, source evidence, rounding record. Larangan: mengarang harga, mengklaim estimasi internal sebagai HPS resmi.

### SOP42 — Dokumen Penawaran

1. AI membuat compliance checklist dari dokumen pemilihan revision terbaru.
2. AI merakit draf dari bukti legalitas, RAB accepted dan metode/jadwal.
3. Cross-check angka, tanggal, tenaga dan dokumen.
4. Manajer tender/legal mereview.
5. Gate pejabat penandatangan; upload manusia ke kanal resmi.
6. Simpan checksum paket dan bukti submission; status submitted berdasarkan bukti.

Output: paket dan submission reference; bukan jaminan menang.

### SOP43 — Kontrak dan Adendum

1. AI menerima versi kontrak dan memetakan klausul/risiko.
2. Legal menilai kewenangan, obligations, jaminan, pembayaran, perubahan dan sengketa.
3. AI menyiapkan redline/draf.
4. Negosiasi/review manusia.
5. Gate pejabat berwenang; signature bukan tanda “approved” chat.
6. Aplikasi menyimpan signed version dan menyerahkan revision ke Project/ERP.

Output: signed contract reference hanya setelah bukti sah; legal memo terpisah.

### SOP44 — Change Order

1. Catat permintaan, originator, sumber dan konteks kontrak.
2. Quantity/Estimator, Scheduler dan Legal menghitung dampak.
3. AI merakit opsi/risk package.
4. PM meninjau; otoritas kontrak dan counterpart mengesahkan bila diperlukan.
5. Update baseline hanya berdasarkan adendum/keputusan sah.
6. Simpan histori baseline lama, delta dan audit.

Larangan: chat klien menjadi instruksi pekerjaan tambah berbayar final tanpa kewenangan sah.

### SOP45 — AgentOps

1. Registrasi role/model/skill/tools, izin, budget, owner dan versi.
2. Perubahan diajukan sebagai proposal; dilarang self-promote.
3. Jalankan evaluasi sumber/angka, injection, auth, scope, timeout, loops dan biaya.
4. Gate Process Owner + AgentOps; sandbox dan canary.
5. Monitor accepted/rejected outputs, cost, error, latency dan incident.
6. Kill switch, credential revoke, rollback versi dan root-cause review.

Output: release evidence dan incident record; governance aktif sebelum pilot.

### SOP46 — Keamanan dan Privasi

1. Klasifikasikan data, dasar penggunaan, retensi, pihak yang dapat mengakses.
2. Berikan grant minimal terikat tenant/project/resource/field.
3. Review provider/model transfer policy dan logging/redaction.
4. Uji negative access, token revoke, file grants, backup dan restore.
5. Security owner/pemilik data menyetujui penggunaan.
6. Review akses berkala; penanganan insiden mengikuti prosedur dan kewajiban applicable.

Output: access registry, review evidence, retention schedule, restore report. Larangan: token dalam chat/CSV/Notion; wildcard seluruh dokumen.

## 6. Migrasi dan penerimaan

- Original SOP tetap referensi sampai revisi disahkan. Jika ada konflik, satu SOP berlaku resmi; jangan dua proses transaksi berjalan paralel tanpa rekonsiliasi.
- Shadow mode membandingkan hasil AI terhadap proses resmi, bukan membuat pembayaran/stock posting kedua.
- UAT harus mencakup contoh benar/salah, pengguna tanpa izin, perubahan revision setelah approval, concurrency, outage dan jalur manual.
- Keberhasilan empat minggu tanpa insiden hanya salah satu bukti, bukan syarat tunggal.
- Setiap SOP jabatan disahkan bersama batas delegasi manusia; AI tidak “mengambil alih” jabatan.
- Perlu ekspor naskah asli SOP konvensional dan child blueprint untuk audit per langkah yang lengkap. Ketiadaan itu dicatat sebagai evidence gap, bukan dianggap sudah ditutup.


---

# Lampiran: Ringkasan Matriks 46 SOP

CSV lengkap memuat trigger, langkah, SLA usulan, gate, guardrail, eskalasi dan uji penerimaan per SOP.

| No | SOP | Accountable manusia | Level revisi | Output |
| --- | --- | --- | --- | --- |
| 1 | SOP Order Permintaan Material | Site Manager | L3 Draf/Propose + Approval | MR draf -> MR approved; PO draf terpisah |
| 2 | SOP Penerimaan Material Proyek | Kepala Gudang | L2 Kolaboratif | Receipt kandidat; GRN accepted atau rejected |
| 3 | SOP Penyimpanan & Pengelolaan Material | Kepala Gudang | L2 + L3 untuk adjustment | Ledger mutasi; reservation; adjustment proposal |
| 4 | SOP Pemakaian Alat Proyek | Kepala Alat | L2 Kolaboratif | Checklist terverifikasi; izin administratif pakai/hold |
| 5 | SOP Penyimpanan Alat Proyek | Kepala Alat | L2 fisik; L4 rekap | Register lokasi/kondisi alat terverifikasi |
| 6 | SOP Opname Pekerjaan Proyek | Quantity Control / Site Engineer | L2 Kolaboratif | Opname draf; BA accepted terikat versi |
| 7 | SOP Laporan Prestasi Pekerjaan Proyek | Site Manager | L4 rekap accepted; L3 penerbitan eksternal | Rekap internal; laporan eksternal approved |
| 8 | SOP Penyusunan Laporan Keuangan Konstruksi | Finance Manager | L3 Draf/Propose + Approval | Laporan keuangan draf/approved; close reference |
| 9 | SOP Petty Cash Proyek (Kas Kecil) | Kepala Bagian Keuangan | L3 Draf/Propose + Approval | Petty cash request; settlement terverifikasi |
| 10 | SOP Pembayaran Upah Tenaga Kerja Proyek | HR Manager | L3 Draf/Propose + Approval | Payroll input accepted; batch payroll draf; payment reference |
| 11 | SOP Penagihan Pembayaran Proyek | Finance Manager | L3 Draf/Propose + Approval | Invoice draf -> issued; aging resmi |
| 12 | SOP Pengukuran Ulang Lapangan | Site Engineer / Surveyor | L2 Kolaboratif | Measurement report accepted; kandidat perubahan baseline |
| 13 | SOP Serah Terima Pekerjaan | Project Manager | L2 Kolaboratif | Paket final handover/FHO sesuai applicability |
| 14 | SOP Laporan Pajak Jasa Konstruksi | Tax Officer / Finance Manager | L3 Draf/Propose + Approval | Rekap pajak/SPT draf; bukti lapor/setor resmi |
| 15 | SOP Perencanaan Tenaga Kerja | HR Manager | L3 Draf/Propose + Approval | Resource plan draf/approved |
| 16 | SOP Kebutuhan Tenaga Kerja | HR Manager | L3 Draf/Propose + Approval | Permintaan tenaga; kandidat; keputusan HR; kontrak draf |
| 17 | SOP Lembur Karyawan | HR Manager / Atasan Langsung | L4 rekap; L3 izin lembur | Permintaan lembur approved; rekap accepted |
| 18 | SOP Control Area | Site Supervisor / Kepala Keamanan | L2 kontrol fisik; L4 alarm | Access log; alert; izin akses berwenang |
| 19 | SOP Penanganan Pencurian | Kepala Keamanan / Manajemen | L2 Kolaboratif | Laporan indikasi; investigation record; tindakan manusia |
| 20 | SOP Penanganan Kecelakaan Kerja | HSE Officer | L1 Asisten | Alarm; respons manusia; incident record; izin lanjut |
| 21 | SOP Penghitungan Fisik Persediaan | Kepala Gudang | L2 hitung; L3 adjustment | Count sheet; variance; adjustment approved |
| 22 | SOP Perbaikan Alat atau Mesin | Kepala Alat | L2 servis; L3 biaya/WO | Repair work order; inspeksi release |
| 23 | SOP Pemeliharaan Alat atau Mesin | Kepala Alat | L4 jadwal; L2 servis/release | Jadwal/reminder; maintenance work order; bukti servis |
| 24 | SOP Pengawasan Progres Bangunan | Project Manager | L4 monitoring; L3 recovery | Deviasi; recovery proposal; baseline revision approved |
| 25 | SOP Prosedur Teknis & Spesifikasi Bangunan | Site Engineer | L2 Kolaboratif | Matriks spesifikasi dan checklist versi berlaku |
| 26 | SOP Serah Terima Konsumen | Manajer Aftersales | L2 Kolaboratif | Checklist per unit; consumer BAST sah |
| 27 | SOP Serah Terima Sementara (PHO) | Project Manager | L2 Kolaboratif | Permohonan PHO; BA; punch list |
| 28 | SOP Layanan Garansi Bangunan | Manajer Aftersales | L4 acknowledgment; L3 komitmen | Warranty ticket; scope decision; repair/closure evidence |
| 29 | SOP Komplain / Perbaikan Rumah | Manajer Aftersales | L4 acknowledgment; L3 komitmen | Complaint case; opsi perbaikan; closure |
| 30 | SOP Jabatan Project Manager | Project Manager | Copilot jabatan; level mengikuti langkah SOP proses | Decision log PM; delegasi dan action plan |
| 31 | SOP Jabatan Site Manager | Site Manager | Copilot jabatan; level mengikuti langkah SOP proses | Rencana lapangan; validasi laporan; koordinasi |
| 32 | SOP Jabatan Site Engineer | Site Engineer | Copilot jabatan; level mengikuti langkah SOP proses | Review teknis; solusi terverifikasi |
| 33 | SOP Jabatan Quality Control | QC Engineer | Copilot jabatan; level mengikuti langkah SOP proses | Acceptance mutu; NCR; bukti uji |
| 34 | SOP Jabatan Quantity Control | Quantity Control | Copilot jabatan; level mengikuti langkah SOP proses | Measurement accepted; quantity reconciliation |
| 35 | SOP Jabatan Site Supervisor | Site Supervisor | Copilot jabatan; level mengikuti langkah SOP proses | Pengawasan mandor; laporan terverifikasi |
| 36 | SOP Jabatan Logistik-Purchasing | Pejabat Logistik-Purchasing | Copilot jabatan; level mengikuti langkah SOP proses | Vendor evaluation; negosiasi; PO draf/issued berwenang |
| 37 | SOP Jabatan Staff Admin | Staff Admin / Document Controller | Copilot jabatan; level mengikuti langkah SOP proses | Dokumen terkendali; notulen dan distribusi |
| 38 | SOP Jabatan Staff Keuangan | Staff Keuangan | Copilot jabatan; level mengikuti langkah SOP proses | Input/reconcile draf; exception list |
| 39 | SOP Jabatan Bagian Alat Proyek | Kepala/Bagian Alat Proyek | Copilot jabatan; level mengikuti langkah SOP proses | Keputusan mobilisasi/servis/sewa manusia |
| 40 | SOP Pencarian Tender dan Go/No-Go | Manajer Tender | L3 Draf/Propose + Approval | Eligibility review; Go/No-Go decision |
| 41 | SOP Estimasi dan Penyusunan RAB | Estimator Senior | L3 Draf/Propose + Approval | RAB revision accepted; source/assumption list |
| 42 | SOP Penyusunan Dokumen Penawaran | Manajer Tender | L3 Draf/Propose + Approval | Bid package reviewed; submission proof |
| 43 | SOP Review Kontrak dan Adendum | Legal / Contract Manager | L3 Draf/Propose + Approval | Risk memo; contract/addendum draft; signed reference |
| 44 | SOP Change Order | Project Manager / Contract Manager | L3 Draf/Propose + Approval | CR; impact package; approved baseline delta |
| 45 | SOP Tata Kelola Agen AI / AgentOps | AgentOps Lead | L3 Draf/Propose + Approval | Release evidence; model/skill version; rollback/incident record |
| 46 | SOP Keamanan dan Privasi Data | Security & Privacy Owner | L2 review; L3 perubahan akses/policy | Grant review; privacy policy; restore evidence |
