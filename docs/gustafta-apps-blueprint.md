# Blueprint Gustafta Apps — Framework dan Pipeline AI

**Status:** acuan arsitektur yang disepakati pemilik proyek, 26 Oktober 2026.
**Cakupan:** Gustafta Apps dan produk di dalam ekosistemnya.
**Bukan laporan implementasi:** dokumen ini menetapkan arah dan batas pengembangan,
bukan menyatakan seluruh komponen sudah tersedia atau terhubung.

Peta kode yang sudah ada, celah, dan urutan implementasi tersedia pada
[Pemetaan Implementasi](gustafta-apps-blueprint-mapping.md).

## 1. Tujuan dan kedudukan

Gustafta membantu manusia menyelesaikan masalah melalui pengetahuan, agen spesialis,
kolaborasi, dan hasil kerja yang dapat diperiksa. Keberhasilan diukur dari mutu
hasil, penghematan waktu, dan kualitas keputusan, bukan banyaknya agen.

Blueprint ini merinci arsitektur AI dalam tiga lapisan kanonik pada `replit.md`:
**Layanan/Produk → Engine Gustafta → Output**. Komponen teknis di bawah ini tidak
menggantikan pembagian tersebut. **Workroom** tetap nama tahap eksekusi engine;
nama produk/domain memakai nama masing-masing, termasuk bentuk **Ruang X**.

## 2. Pembagian tanggung jawab

| Komponen | Tanggung jawab | Batas |
| --- | --- | --- |
| Claude | Merancang dan memperbaiki “otak”: instruksi/system prompt, peran, aturan, dan rancangan kolaborasi agen. | Bukan model chat harian; bukan pemberi izin dan bukan pengendali server. |
| Model harian | GPT/OpenAI, DeepSeek, model melalui NVIDIA, atau Gemini menjalankan percakapan dan penalaran operasional sesuai konfigurasi. | Pemakaian mengikuti kemampuan model, izin konteks, dan anggaran. NVIDIA adalah jalur penyedia model, bukan satu model tunggal. |
| Harness Gustafta | Kode pengendali untuk pemilihan model, konteks, alat, delegasi, status tugas, batas langkah/biaya, audit, dan gerbang manusia. | Keamanan ditegakkan oleh server, bukan hanya instruksi kepada model. |
| Claw | Satu agen spesialis berorientasi tugas dengan peran, alat, konteks, dan batas yang jelas. | Tidak memperoleh akses atau otonomi tanpa batas karena label agen. |
| MultiClaw | Tim Claw dengan koordinator, pembagian subtugas, serah-terima hasil, dan sintesis bersama. | Bukan kumpulan OpenClaw; tidak harus memakai runtime eksternal. |
| OpenClaw / Hermes Agent | Runtime/pelaksana tambahan untuk langkah yang terbukti memerlukannya. | Opsional, bertahap, dan tetap di bawah kendali Gustafta; bukan pengganti model atau produk inti. |
| Ruang Simpan | Sumber utama dokumen dan memori bisnis beserta asal-usul dan izin aksesnya. | Bukan gudang konteks yang otomatis terbuka bagi seluruh agen atau pelanggan. |
| Workroom | Tempat tugas, progres, hasil, dan keputusan manusia ditautkan dalam satu alur kerja. | Status yang ditampilkan harus sesuai bukti pelaksanaan, bukan klaim agen semata. |
| Manusia yang ditunjuk | Memutuskan persetujuan, tindakan penting, dan penyelesaian konflik yang perlu pertimbangan manusia. | Agen tidak boleh menyetujui tindakannya sendiri. |

“Otak” di sini berarti rancangan instruksi dan perilaku, **bukan pemindahan bobot,
pelatihan ulang, atau penyalinan kecerdasan Claude** ke model lain. Mutu hasil tetap
bergantung pada kemampuan model pelaksana dan konteks yang tersedia.

## 3. Dua pipeline yang saling terhubung

### A. Perancangan atau revisi agen

```text
Dialog: masalah, tujuan, pemilik, batas keberhasilan
  → Blueprint solusi dan pembagian peran
  → Claude menyusun/memperbaiki instruksi agen
  → Pemeriksaan dan persetujuan pengelola
  → Konfigurasi AI berversi yang siap dipakai
```

Claude dipanggil ketika instruksi perlu dibuat atau diperbaiki, **bukan pada setiap
pesan**. Gunakan konfigurasi yang sudah disetujui bila masih sesuai. Perubahan agen
yang sudah digunakan pelanggan memerlukan tinjauan; jangan mengganti perilakunya
secara massal atau diam-diam.

### B. Pelaksanaan pekerjaan

```text
Permintaan pengguna
  → Pemeriksaan identitas, izin, tujuan, dan konteks yang boleh dipakai
  → Harness memilih alur: chat langsung / Claw / MultiClaw
  → Model harian menjalankan instruksi dan mengusulkan langkah
  → Harness memvalidasi lalu menjalankan alat/delegasi yang diizinkan
  → Hasil dan bukti dikembalikan ke tugas Workroom bila memakai alur tugas
  → Koordinator menyintesis hasil bila melibatkan tim
  → ◆ Persetujuan manusia pada tindakan/hasil yang memerlukannya
  → Output dan catatan keputusan
```

Chat biasa tidak wajib membentuk tim, membuka runtime eksternal, atau menjalani
ulang proses perancangan. Pada pekerjaan bertahap, kolaborasi dapat memperbaiki
rencana sebelum Workroom dan berlangsung kembali selama pelaksanaan.

Siklus engine tetap: **Dialog → Blueprint → Konfigurasi AI → Kolaborasi →
Workroom**. Produksi, refleksi, dan pengetahuan baru adalah kelanjutan siklus
jangka panjang. Refleksi bersifat pendukung; jangan menjadikannya gerbang wajib
sebelum pekerjaan inti. Hasil refleksi tidak otomatis mengubah pengetahuan resmi.

## 4. Kendali harness dan model

- Model mengusulkan; server memutuskan apakah alat, dokumen, atau tindakan boleh
  digunakan. Periksa kembali izin saat akses atau tindakan dilakukan.
- Konfigurasi menyebut penyedia **dan** model, versi instruksi, kemampuan yang
  dibutuhkan, serta batas biaya, waktu, dan jumlah langkah/delegasi.
- Uji kepatuhan instruksi, pemanggilan alat, dan keluaran terstruktur per model.
  Model berbeda tidak diasumsikan memiliki kemampuan yang identik.
- Pergantian/fallback model hanya mengikuti kebijakan yang disetujui dan tercatat.
  Jangan mengirim konteks ke penyedia lain atau memakai layanan berbayar tanpa
  persetujuan kebijakan data dan anggarannya.
- Claude tidak menjadi fallback chat harian secara otomatis. API key tiap layanan
  terpisah dan disimpan di server. Kuota NVIDIA tidak membayar penggunaan Claude;
  akses gratis tidak diasumsikan tersedia tanpa batas untuk produksi.
- Hentikan tugas bila batas terlampaui. Tampilkan kegagalan, kebutuhan klarifikasi,
  atau eskalasi secara eksplisit; jangan melaporkan sukses tanpa hasil yang sah.

## 5. Kontrak tugas dan sinkronisasi

Semua pelaksana internal maupun eksternal mengikuti satu kontrak konseptual.
Nama field/API aktual ditentukan saat pemetaan ke implementasi yang sudah ada.

**Penugasan:** identitas tugas/subtugas dan induknya; pemilik serta lingkup
organisasi; tujuan dan kriteria selesai; versi instruksi; referensi konteks yang
diizinkan; daftar alat/tindakan; batas sumber daya; pihak pemberi persetujuan.

**Hasil:** identitas tugas; status; temuan/draf terstruktur; sumber dan bukti;
tindakan yang dijalankan; kendala atau konflik; pemakaian sumber daya; kebutuhan
persetujuan. Jangan menyimpan secret atau seluruh dokumen privat di log.

Status konseptual membedakan antrean, berjalan, menunggu persetujuan, selesai,
gagal, dan dibatalkan. Tugas yang menunggu persetujuan belum dianggap selesai.
Gunakan identitas eksekusi dan versi agar respons terlambat tidak menimpa hasil
baru. Pengulangan tugas tidak boleh menggandakan tindakan berdampak; pembatalan dan
pencabutan izin harus menghentikan akses berikutnya.

Sinkronisasi adalah **penugasan dan pengembalian hasil**, bukan replikasi seluruh
database, memori, atau percakapan ke setiap runtime. Ruang Simpan tetap sumber
utama. Pelajaran/memori lokal pelaksana hanya menjadi usulan sampai ditinjau,
ditentukan pemiliknya, dan diberi izin publikasi/akses yang sesuai.

## 6. Aturan MultiClaw

- Mulai dari satu koordinator dan sekitar tiga spesialis berperan sempit sebagai
  pola awal, bukan jumlah wajib untuk semua produk.
- Setiap spesialis menerima konteks dan alat minimum untuk subtugasnya, bukan
  seluruh akses koordinator. Delegasi tidak dapat menaikkan hak akses.
- Hasil memakai struktur yang dapat digabungkan: temuan, sumber, risiko,
  kekurangan data, dan rekomendasi.
- Koordinator menjaga hubungan subtugas dan tugas induk, memeriksa hasil, serta
  menyatukan rekomendasi. Konflik dan kekurangan bukti harus ditampilkan.
- Tetapkan ◆ dengan manusia/peran penanggung jawab yang jelas, termasuk ruang
  lingkup tindakan yang disetujui. Perubahan material membatalkan persetujuan lama.
- Anggota boleh memakai model berbeda sesuai kebutuhan dan anggaran. Hindari
  delegasi berulang tanpa batas atau membentuk tim untuk tugas yang cukup satu agen.

## 7. Batas OpenClaw dan Hermes

Gustafta tetap pengendali identitas, izin, memori bisnis, persetujuan, audit, dan
biaya. Runtime eksternal menerima paket tugas terbatas melalui adapter yang perlu
dirancang dan diverifikasi; dokumen ini tidak mengasumsikan adapter sudah tersedia.

Pilot pertama: **Hermes untuk Riset/Monitoring internal**, dipimpin satu spesialis,
baca-saja pada sumber yang diizinkan. Hasil beserta sumber ditinjau manusia sebelum
dipakai atau dipublikasikan. OpenClaw diuji terpisah hanya jika ada kebutuhan nyata.

Jangan memberikan akses database langsung, filesystem/shell bebas, seluruh secret,
atau akses lintas pelanggan. Jangan membiarkan runtime saling memanggil bebas.
Perluasan alat, kemampuan menulis, atau penggunaan oleh pelanggan memerlukan
pemeriksaan keselamatan, keandalan, manfaat, biaya, dan persetujuan pengelola.
Kegagalan runtime opsional tidak boleh membuka akses atau membuat pekerjaan inti
bergantung padanya tanpa alternatif yang disetujui.

## 8. Urutan penerapan dan syarat penerimaan

1. Petakan kemampuan yang sudah ada: konfigurasi agen, router model, izin dokumen,
   delegasi, Workroom, persetujuan, dan audit. Gunakan kembali komponen dan data
   yang sesuai; jangan membuat engine atau tabel duplikat tanpa kebutuhan terbukti.
2. Perkuat alur asli Gustafta untuk satu tugas Claw sampai hasil dan ◆ terbukti.
3. Uji satu MultiClaw kecil, termasuk konteks terbatas, sintesis, dan konflik.
4. Jalankan pilot Hermes internal baca-saja; nilai hasil dan sumbernya.
5. Pertimbangkan OpenClaw atau perluasan runtime hanya setelah evaluasi dan
   persetujuan tersendiri. Desktop/web tetap prioritas proyek.

Sebelum menyatakan suatu tahap tersedia, buktikan jalur sukses **dan** penolakan:
akses dokumen pengguna lain; alat di luar izin; anggaran habis; kegagalan/timeout;
pengulangan dan hasil terlambat; persetujuan yang tidak ada atau kedaluwarsa.
Verifikasi hasil nyata, bukan hanya keberadaan UI atau endpoint.

Penerapan kode, perubahan model/provider, koneksi runtime, migrasi data, merge,
dan deployment merupakan pekerjaan terpisah yang memerlukan lingkup serta izin
yang sesuai. Pembakuan dokumen ini tidak menjalankan tindakan-tindakan tersebut.
