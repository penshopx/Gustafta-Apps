# Pemetaan Implementasi Blueprint Gustafta Apps

**Tanggal tinjauan:** 26 Oktober 2026.
**Acuan:** [Framework dan Pipeline AI](gustafta-apps-blueprint.md).
**Metode:** pembacaan kode workspace, tanpa menjalankan model, memanggil provider,
memeriksa nilai secret, mengubah database, atau menjalankan integrasi eksternal.

Ini peta awal untuk menentukan pekerjaan berikutnya, **bukan audit keamanan lengkap
atau bukti kelulusan pengujian**. “Ada” berarti ditemukan struktur/jalur kode;
belum membuktikan keberhasilan operasional, validitas kredensial, atau kesamaan
versi dengan aplikasi produksi/GitHub.

**Pembaruan implementasi:** penegakan progres/gate Workroom kini memiliki
[implementasi P0 awal](workroom-human-gates.md). Tabel di bawah mencatat temuan
awal; gap PATCH progres serta pengikatan persetujuan ke versi konteks/hasil
Workroom telah ditangani. Sumber Ruang Simpan yang dipilih eksplisit juga diverifikasi
pada titik baca/tindakan; lihat [pilot sumber](workroom-sources.md). Versi immutable
lintas runtime, dokumen yang hanya disebut lewat teks/URL, dan kontrak eksekusi
penuh masih belum diterapkan.

Salinan historis privat dan penghapusan bersama Workroom dijelaskan pada
[arsip versi sumber](workroom-source-versions.md). Ini bukan aktivasi worker
eksternal atau WORM provider.

## 1. Peta kemampuan dan celah

| Bagian blueprint | Bukti kode yang ditelaah | Status dan celah |
| --- | --- | --- |
| Claude sebagai perancang | `server/lib/anthropic.ts`; route `generate-brain` dan `improve-brain` pada `server/routes.ts` | **Ada fondasi.** Generator untuk agen baru dan perbaikan berupa preview tersedia. Helper mendukung model melalui konfigurasi serta fallback Claude melalui OpenRouter. Ini bukan bukti model tertinggi sedang aktif atau kredensial valid. Jangan mengganti kebijakan fallback lama secara diam-diam. |
| Model harian | `server/lib/model-router.ts` | **Sebagian.** Router memiliki OpenAI, DeepSeek, Qwen, dan Gemini, pemilihan menurut jenis tugas, fallback, serta statistik kesehatan dalam proses. Qwen adalah dukungan yang sudah ada; blueprint tidak menjadi izin menghapusnya. Belum terbukti ada kebijakan data/anggaran per tugas yang terpadu di semua pemanggilan. |
| NVIDIA | `server/routes.ts`; `server/lib/dialog-load-guard.ts` | **Sebagian, tersebar.** Ada pemanggilan/fallback NVIDIA, tetapi belum tercantum sebagai provider di router utama yang ditelaah. Default model pada dua jalur juga berbeda. Keberadaan key tidak berarti NVIDIA menjadi model utama di seluruh aplikasi. |
| Claw dan MultiClaw | `server/lib/claw-factory.ts`; konfigurasi `agenticSubAgents` pada `server/routes.ts` | **Ada fondasi.** Factory membentuk spesialis dan koordinator dari katalog. Label internal `openclaw` pada katalog/factory tidak membuktikan koneksi ke runtime eksternal OpenClaw. |
| Blueprint tim dan konfigurasi | `server/services/blueprint-engine/organization-configuration-engine.ts` | **Ada fondasi.** Tersedia pemetaan anggota, validasi sebelum tulis, mode pratinjau, dan kebutuhan transaksi atomik. Konfigurasi tim belum boleh disamakan dengan kontrak eksekusi tugas lengkap. |
| Harness | Router, route agen, factory, konfigurasi organisasi, dan route Workroom | **Sebagian.** Kemampuan tersebar pada beberapa modul. Belum terbukti ada satu kontrak terpadu yang menegakkan identitas eksekusi, batas langkah/biaya, pembatalan, hasil terlambat, dan idempotensi untuk seluruh jalur. Jangan membuat engine paralel sebelum memetakan jalur yang akan digunakan pilot. |
| Workroom dan gerbang manusia | Route `/api/workrooms/*` pada `server/routes.ts`; `client/src/pages/workroom-detail.tsx`; `server/lib/workroom-access.ts` | **Sebagian.** Ada pemeriksaan kepemilikan, tahap, status, log, pembuatan gate, dan keputusan approve/reject. Jalur PATCH tahap/status yang ditelaah belum memeriksa persetujuan gate sebelum memperbarui progres; UI gate bukan bukti bahwa gate menghalangi pelaksanaan. |
| Model dalam analisis Workroom | Route `/api/workrooms/:id/analyze` pada `server/routes.ts` | **Pilot diperketat, belum seragam.** Jalur memakai OpenAI langsung dengan batas waktu/ukuran, reservasi tersimpan, replay idempotent, keluaran tervalidasi, serta [kuota/cadangan estimasi harian](workroom-analysis-budget.md). Bukan antrean worker otomatis, batas seluruh invoice aplikasi, atau router model terpadu. Lihat [batas pengamanan analisis](workroom-analysis-safety.md) dan [identitas eksekusi](workroom-analysis-executions.md). |
| Memori bisnis dan izin dokumen | `server/ruang-simpan-app-api.ts` | **Ada fondasi akses.** Koneksi memiliki scope, masa berlaku/pencabutan, token hash, dan seleksi berkas/folder menurut pemilik. Ini bukan bukti semua delegasi atau runtime sudah memakai jalur tersebut. |
| Hermes/OpenClaw eksternal | Penelusuran nama pada `server` dan `client/src`; pembandingan dengan factory internal | **Belum terbukti terhubung.** Tidak ditemukan adapter Hermes pada kode aplikasi yang ditelaah. Referensi OpenClaw yang ditemukan terutama merupakan istilah katalog/produk. Jangan menyatakan integrasi aktif tanpa adapter dan bukti uji nyata. |

## 2. Prioritas implementasi

### P0 — Satu alur Claw asli Gustafta yang terkendali

Pilih satu tugas internal baca-saja: menelaah sumber yang diizinkan dan menghasilkan
draf ringkasan bersumber untuk diperiksa manusia. Belum perlu runtime eksternal.
Gunakan identitas pengguna, agen, dokumen, dan Workroom yang sudah ada.

Hasil yang harus dibuktikan:

- Tugas memiliki tujuan, pemilik, versi instruksi, konteks yang diizinkan, dan
  kriteria selesai; hasil terhubung ke tugas yang benar.
- Gerbang wajib ditegakkan server. Perubahan tahap/status tidak boleh melewati
  keputusan manusia hanya karena klien mengirim nilai tahap yang lebih tinggi.
- Persetujuan mengacu pada versi hasil dan ruang lingkup tindakan; perubahan
  material memerlukan persetujuan baru.
- Batas waktu, langkah, dan biaya serta provider yang diizinkan jelas. Penolakan,
  kegagalan provider, dan kebutuhan persetujuan ditampilkan sebagai status berbeda.
- Pengulangan, pembatalan, dan respons lama tidak menggandakan tindakan atau
  menimpa hasil baru. Bukti hasil lebih penting daripada indikator “selesai”.

Ini prioritas fondasi keselamatan, bukan izin untuk mengubah seluruh Workroom
secara massal. Definisikan kontrak dan kompatibilitas jalur lama sebelum menulis kode.

### P1 — Selaraskan provider pada jalur pilot

Petakan semua pemanggilan model yang dipakai pilot, termasuk yang tidak melewati
router. Tambahkan dukungan NVIDIA secara konsisten bila dipilih, dengan nama model
yang eksplisit dan pemeriksaan kemampuan.

Pertahankan dukungan yang sudah digunakan pelanggan. Fallback harus mengikuti
izin penyedia, kebijakan data, dan batas biaya; jangan menjadikan Claude fallback
chat harian. Uji memakai provider tiruan sebelum penggunaan kredensial nyata
yang diizinkan. Jangan menganggap kuota gratis sebagai jaminan operasi produksi.

### P2 — MultiClaw kecil dengan satu kontrak tugas

Gunakan satu koordinator dan sekitar tiga spesialis hanya bila tugas membutuhkan
pembagian tersebut. Manfaatkan factory/delegasi yang sudah ada. Tambahkan
subtugas, konteks minimum, sumber, konflik, dan sintesis melalui kontrak P0.
Persetujuan manusia tetap mengikat hasil gabungan yang versinya jelas.

### P3 — Pilot Hermes internal baca-saja

Setelah P0–P2 terbukti, rancang adapter paket tugas/hasil untuk Riset/Monitoring.
Batasi sumber dan alat; jangan memberikan akses database, shell/filesystem bebas,
seluruh secret, atau lintas pelanggan. Pelaksana harus dapat dinonaktifkan tanpa
menghilangkan alur inti. Uji penolakan, timeout, duplikasi, pencabutan izin, dan
hasil terlambat sebelum menghubungkan kredensial/lingkungan nyata.

### P4 — Evaluasi OpenClaw secara terpisah

Identifikasi manfaat yang belum dipenuhi alur asli atau pilot Hermes. Perluasan
ke tindakan tulis atau penggunaan pelanggan memerlukan evaluasi dan persetujuan
tersendiri. Tidak perlu memasang dua runtime sekaligus untuk memenuhi blueprint.

## 3. Bukti penerimaan minimal

| Skenario | Hasil yang diharapkan |
| --- | --- |
| Tugas sah, sumber sah | Hasil bersumber tersimpan pada tugas/pemilik yang benar. |
| Dokumen pengguna lain / izin dicabut | Akses ditolak sebelum konteks dikirim ke model atau alat. |
| Gate belum disetujui / ditolak | Langkah yang dilindungi tidak berjalan, termasuk melalui API langsung. |
| Hasil berubah setelah disetujui | Persetujuan lama tidak mengizinkan versi baru. |
| Model gagal / anggaran habis | Status eksplisit; tidak ada fallback di luar kebijakan. |
| Tugas diulang / callback lama | Tidak ada efek ganda atau penimpaan hasil baru. |
| Tugas dibatalkan | Pelaksanaan berikutnya ditolak; hasil lama tidak menghidupkan tugas kembali. |
| Runtime eksternal tidak tersedia | Gagal/berhenti dengan jelas atau memakai alternatif yang diizinkan, tanpa membuka akses. |

Gunakan fixture terisolasi untuk pengujian, bukan dokumen atau akun pelanggan nyata.
Satu tahap dinyatakan tersedia hanya setelah jalur berhasil dan jalur penolakannya
dibuktikan. Dokumen ini belum menjalankan pengujian-pengujian tersebut.

## 4. Langkah teknis berikutnya

Rinci P0 menjadi kontrak satu tugas dan aturan transisi server, dengan pemetaan ke
struktur Workroom/gate/log yang sudah ada serta rencana kompatibilitas. Setelah
lingkup implementasi ditetapkan, implementasikan dan buktikan alur tersebut dahulu;
jangan memulai dengan pemasangan OpenClaw/Hermes atau penggantian seluruh provider.

Tidak ada perubahan aplikasi, kredensial, database, PR GitHub, aturan branch, atau
deployment yang dilakukan sebagai bagian dari pemetaan ini. Pekerjaan visual gate
pada Task #149 tetap terpisah dan tidak dianggap selesai oleh dokumen ini.
