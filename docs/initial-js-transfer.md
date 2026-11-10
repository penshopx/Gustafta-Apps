# JavaScript yang diunduh saat kunjungan pertama

Pemeriksaan build (`script/check-initial-js-budget.ts`) tetap menghitung raw/gzip
berkas lokal yang disebut HTML. Pemeriksaan browser berikut mengukur transfer
nyata, termasuk impor dinamis yang dijalankan otomatis dan skrip pihak ketiga.
Keduanya saling melengkapi; pekerjaan ini tidak mengoptimasi dashboard.

## Gate rilis production yang dapat diulang

```sh
npm run visual:setup  # Chromium 138.0.7204.100, checksum arsip diverifikasi
npm run check:initial-js-production
```

Perintah kedua **membangun frontend production baru** (Vite build, bukan Vite
serve/preview), memeriksa batas statis HTML, lalu menyajikannya melalui server
HTTP lokal khusus. Tidak menjalankan `server/index.ts`, seed, worker aplikasi,
atau koneksi database. Output build terisolasi di
`generated-artifacts/initial-js-production/public`, bukan `dist` aplikasi.
CI memakai Chrome hasil unduhan terpin; di workspace Nix,
`CHROME_PATH="$(which chromium)" npm run check:initial-js-production` boleh
memakai Chromium dengan **versi yang sama**. Versi berbeda menolak pembandingan.

Profil server `production-gzip6-anonymous-v1`:

- Node HTTP/1.1 loopback, gzip level 6 untuk HTML/JS/CSS/JSON/SVG, Content-Length,
  tanpa Date, `Cache-Control: no-store`, header profil tetap; bukan kompresi
  bergantung reverse proxy atau negosiasi Brotli yang berubah antar layanan.
- Entry `/`, pengunjung tanpa login, semua `/api/*` memberi JSON 401 tetap.
  Konfigurasi marketing pixel tidak tersedia; `VITE_META_PIXEL_ID` dikosongkan.
  Ini profil frontend anonim, **bukan** pengujian backend/fitur login atau
  pembuktian jumlah skrip marketing pada konfigurasi situs live.
- Build menerima environment toolchain minimal, bukan secret aplikasi. Tidak
  meneruskan `REPL_ID`/`VITE_*` dari workspace. Tidak memalsukan atau memblokir
  JavaScript pihak ketiga: jika build mulai memintanya, unduhan tetap dihitung;
  bila jaringan gagal, laporan tidak sah, bukan dianggap nol.
- Berkas aset hilang mengembalikan 404, tidak disamarkan sebagai SPA HTML.
  Tidak ada koneksi ke Vite development, Mockup Sandbox, atau database.

Baseline tersimpan di `config/initial-js-transfer-baseline.json` (termasuk
checksum aset). Tiga browser baru pada build yang sama, 28 Oktober 2026,
menghasilkan angka byte identik:

| Kelompok | Baseline transfer | Batas transfer |
| --- | ---: | ---: |
| `localInitial` | 301.514 B | 335.000 B |
| `localRuntime` | 934 B | 5.000 B |
| `thirdParty` | 0 B | 0 B |
| **total** | **302.448 B** | **340.000 B** |

Batas di `config/initial-js-transfer-budget.json` adalah byte respons terkompresi
**ditambah header**, bukan raw/gzip statis. Batas inklusif; nilai sama masih lolos.
Skrip awal mendapat ruang sekitar 11%, runtime sekitar 4 KB tambahan, total
sekitar 12%. Batas pihak ketiga nol sengaja mewajibkan tinjauan jika profil
anonim mulai mengunduh skrip eksternal. Total dan setiap kelompok diperiksa
sendiri; penghematan di satu kelompok tidak menghapus pelanggaran kelompok lain.
`sw.js` yang didaftarkan aplikasi ikut runtime walau penggunaan service worker
untuk menyajikan halaman dilewati.

Laporan lengkap:
`generated-artifacts/initial-js-production/report.json`, berisi versi browser,
profil server, jendela pengamatan, rincian request, total/kelompok, batas,
pelanggaran, dan hasil. `.github/workflows/initial-js-transfer.yml` menjalankan
gate pada push/PR ke main dan manual, menyimpan JSON dengan `always()` selama
14 hari, termasuk saat pemeriksaan gagal. Sentinel kegagalan dibuat sebelum
setup dependency/browser, agar kegagalan setup tidak meninggalkan laporan lama.
Upload artifact bukan perubahan branch protection; check perlu diwajibkan dalam
aturan repository bila ingin mencegah merge ketika gagal.

| `outcome` | Exit | Arti |
| --- | ---: | --- |
| `passed` | 0 | Pengukuran sah, semua batas dipenuhi |
| `budget-exceeded` | 1 | Pengukuran sah, satu atau lebih batas terlampaui |
| `measurement-error` | 2 | Setup/build/browser/jaringan gagal, JS pending/gagal, cache/error halaman, atau profil/versi/jendela berbeda |

Pengukuran tidak sah **tidak dibandingkan dengan batas**, walaupun byte parsial
besar. Periksa `problems`, status/error request dan log CI, perbaiki lingkungan
atau jaringan lalu ulangi; jangan menaikkan batas untuk mengatasi kegagalan itu.
`loadingFinished` tanpa metadata respons HTTP juga tidak cukup sebagai bukti:
misalnya `sw.js` dengan `status: null` dan isi nol harus menghasilkan
`measurement-error`, bukan dianggap unduhan kecil yang lulus. Respons HTTP
kosong dengan status yang benar-benar teramati berbeda dari metadata yang hilang.
`valid` menyatakan kelengkapan pengukuran: pelanggaran batas dapat mempunyai
`valid: true` dan tetap gagal lewat `outcome`.

Untuk perubahan batas yang disengaja: jalankan gate pada build baru, tinjau
rincian JSON dan alasan pertumbuhan, ulangi kunjungan dingin, lalu ubah baseline,
batas, dan dokumentasi bersama dalam PR. Jangan otomatis memperbarui baseline
dari hasil gagal, Vite development, atau konfigurasi server/browser lain.

## Pengukuran diagnostik target eksplisit

```sh
npm run check:initial-js-transfer -- --url https://HOST/
```

Perintah ini tidak menerapkan batas kecuali `--budget
config/initial-js-transfer-budget.json` diberikan. Dalam mode batas, target harus
memberikan header `X-Transfer-Profile` yang cocok dengan profil baseline.
Tanpa batas, pengukuran sah ditandai `outcome: measured`; ini bukan gate rilis.


Ganti HOST dengan alamat aplikasi yang akan diukur. Gunakan **hasil build
production yang sedang disajikan**, bukan Vite development atau Mockup Sandbox,
untuk baseline rilis. Perintah tidak menyalakan server, memublikasikan aplikasi,
atau mengubah database. Chromium harus tersedia; `CHROME_PATH` dapat menunjuk
executable lain. Target wajib eksplisit agar laporan tidak mengukur layanan salah.

Browser baru memakai viewport 1440×900, tanpa login/cookie/cache, dan melewati
service worker. Tidak ada klik, scroll, maupun navigasi ke halaman lain.
Redirect HTTP awal diperbolehkan; navigasi halaman setelah itu membatalkan hasil.
Perekaman dimulai sebelum permintaan dokumen sampai **5 detik setelah load**.
Ubah jendela dengan `--observe-ms 10000` jika perlu; bandingkan laporan yang
memakai jendela, versi browser, target, dan konfigurasi server yang sama.
Unduhan yang baru dimulai setelah cutoff tidak termasuk.

Laporan JSON default: `generated-artifacts/initial-js-transfer.json` (diabaikan
Git/deployment). `--output PATH` memilih lokasi lain. Rincian:

- `localInitial`: skrip same-origin yang disebut HTML respons awal, termasuk
  modulepreload dan preload `as=script`, dengan resolusi `<base>`.
- `localRuntime`: JavaScript same-origin lainnya yang benar-benar diminta,
  termasuk impor dinamis dan dependensi transitif module.
- `thirdParty`: JavaScript dari origin berbeda, baik dari HTML maupun runtime.
- Setiap permintaan memiliki URL, status, byte transfer, byte isi terdekode,
  kelompok, serta status selesai/cache/gagal. Permintaan berulang dihitung
  terpisah; preload yang digunakan ulang tidak digandakan.

`transferBytes` memakai CDP `Network.loadingFinished.encodedDataLength`:
respons terkompresi **ditambah header respons**, bukan ukuran raw berkas atau
perkiraan gzip. Tidak termasuk overhead TLS/TCP atau header permintaan.
Resource Timing `transferSize` tidak dipakai karena pihak ketiga tanpa
Timing-Allow-Origin dapat dilaporkan sebagai nol.
Inline script/data/blob tidak menghasilkan transfer JS tersendiri; byte inline
berada dalam HTML dan bukan total JS ini. Target child (worker dan iframe
terpisah) diamati sebelum kode berjalan agar dependensi runtime-nya ikut tercatat.
Permintaan entry worker dapat mulai di sesi induk dan selesai di sesi worker;
event tersebut dicocokkan agar transfer tidak hilang atau terhitung dua kali.
Untuk entry worker yang event akhirnya hanya memuat header, byte isi respons
terkompresi diperoleh dari log jaringan Chromium dan ditambahkan ke byte header
CDP. `transferSource` menandai bukti tersebut. Pencocokan wajib tunggal, selesai,
dan ukuran isi terdekodenya sama; jika bukti tidak lengkap, hasil ditolak.
Log jaringan mentah dibuat sementara dengan mode bawaan yang menyamarkan
header sensitif, lalu dihapus setelah browser ditutup. Log mentah tidak disimpan
dalam laporan atau Git.

Kegagalan/pending JS, cache tak terduga, error halaman, dan navigasi lanjutan
menghasilkan laporan `valid: false` dan exit nonzero, sehingga hasil parsial
tidak menjadi baseline sukses. Kegagalan membuka dokumen/browser juga exit
2 (`measurement-error`). Kegagalan tersebut tetap menyimpan JSON, termasuk
kegagalan sebelum browser menghasilkan ukuran byte. Vite development ditolak.
Batas build statis tetap berlaku dan tidak diubah oleh gate browser.

Verifikasi offline (dua server HTTP lokal, termasuk gzip dan impor runtime):

```sh
npm run check:initial-js-transfer-types
npm run test:initial-js-transfer
```
