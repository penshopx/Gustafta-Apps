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
