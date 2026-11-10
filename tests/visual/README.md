# Pemeriksaan visual halaman publik

## Inventaris dan kebijakan font aplikasi

Inventaris antarmuka di `client/src` (termasuk komponen bersama), bukan dokumen
HTML cetak/ekspor yang dibuka terpisah:

| Font | Pemakaian nyata | Bobot/gaya yang dipertahankan | Pemuatan |
| --- | --- | --- | --- |
| DM Sans | Teks, navigasi, judul, tombol, formulir; beranda, halaman publik, login dan daftar | Normal dan italic 400–900; `font-normal` sampai `font-black` masih dipakai; sumbu optical size 9–40 dipertahankan | Satu stylesheet Google Fonts di `client/index.html` |
| JetBrains Mono | `font-mono`, misalnya kode pada dokumentasi dan tampilan kode/chat; juga elemen kecil header | Normal dan italic 400–700 | Impor yang sama; browser baru mengambil berkas font bila ada teks yang memakainya |
| Libre Baskerville | `font-serif`: kutipan product landing, hasil generator BAST/surat kuasa, judul admin taksonomi/sales ladder | Normal 400/700, italic 400 | `styles/serif-font.css`, diimpor hanya oleh lima modul rute lazy tersebut |

Beranda menimpa `font-display` dan `font-mono` dengan DM Sans melalui `landing.css`.
Login (termasuk mode daftar, OTP dan reset) memakai DM Sans 400/500/600/700, bukan
font khusus lain. Variabel `--font-display` menyebut Space Grotesk, tetapi tidak
ada aturan utility `font-display` yang menerapkannya; tidak perlu mengambil font
itu atau menambah aturan baru yang akan mengubah desain.

Sebelumnya HTML meminta **25 keluarga**, dan CSS meminta DM Sans/Space Grotesk lagi.
Sekarang satu stylesheet HTML awal menawarkan **dua
keluarga**, impor CSS rangkap dihapus, sedangkan serif ditunda. Sumbu optical size
DM Sans tetap tersedia agar bentuk teks pada ukuran judul tidak berubah. Rentang
100–300, DM Sans 1000, dan JetBrains Mono 800 dihapus; gaya italic tetap tersedia
untuk konten/prose. Jangan mengartikan jumlah keluarga sebagai ukuran unduhan:
Google mengirim subset berdasarkan browser, dan berkas font diambil sesuai pemakaian.

Tidak lagi diminta oleh aplikasi: Architects Daughter, Fira Code, Geist/Geist Mono,
IBM Plex Sans/Mono, Inter, Lora, Merriweather, Montserrat, Open Sans, Outfit, Oxanium,
Playfair Display, Plus Jakarta Sans, Poppins, Roboto/Roboto Mono, Source Code Pro,
Source Serif 4, Space Grotesk dan Space Mono. Inter di template HTML cetak/ekspor
`bedah-dokumen` dan `marketing-panel` tetap khusus dokumen keluaran tersebut,
bukan permintaan font saat masuk ke aplikasi. Times New Roman/Georgia/Arial dan
fallback sistem juga tidak menyebabkan pemuatan Google Fonts.

Pemeriksaan khusus:

```sh
node --test tests/public-fonts.test.mjs
env -u REPL_ID NODE_ENV=production node scripts/check-public-fonts.mjs
CHROME_PATH="$(which chromium)" npm run visual:ci
```

Tes kontrak menjaga daftar keluarga/bobot, satu pemilik stylesheet awal, serta
impor serif pada setiap konsumen lazy. Pemeriksaan browser khusus menyalakan
Google Fonts dan mengambil beranda, `/login`, `/login?mode=register`,
`/kontraktor`, `/documentation`, `/pricing` pada 1280×800 dan 390×844. Koneksi
Google Fonts wajib berhasil dan DM Sans harus benar-benar berstatus loaded.
Resource Timing memeriksa stylesheet font, termasuk `@import` yang tidak selalu
muncul pada peristiwa intersepsi permintaan Puppeteer. Navigasi SPA berikutnya ke
rute product membuktikan stylesheet serif baru dimuat saat diperlukan; spesimen
terpisah membuktikan regular/bold/italic tersedia. API diintersepsi sebagai anonim,
tanpa database, seed, akun uji atau panggilan AI. Gambar/laporan tersimpan di
`generated-artifacts/public-fonts/after/`; `FONT_CAPTURE_LABEL=before` hanya untuk
mengambil bukti pembanding sebelum perubahan, bukan melewati pemeriksaan rilis.

Ini melengkapi, bukan menggantikan, gate visual di bawah: gate dimaksudkan menguji
font fallback, tetapi pemblokiran berbasis peristiwa permintaan Puppeteer belum
menjamin semua font eksternal terblokir di setiap halaman/konteks browser.
Gambar sebelum/sesudah font-enabled harus ditinjau saat mengubah kebijakan font.
Spesimen serif bukan verifikasi tampilan halaman admin yang membutuhkan login.

Verifikasi perubahan font pada 28 Oktober 2026: dua tes kontrak lulus, seluruh
12 gambar font-enabled sebelum/sesudah identik byte demi byte, dan delapan
pembandingan `visual:ci` lulus dengan referensi tetap (0–0,19% selisih). Tidak ada
overflow baru; overflow lama pada `/pricing` 390px tetap sama dan tidak diubah
sebagai bagian pekerjaan font.

## Pemeriksaan otomatis di CI dan pra-rilis

Workflow `.github/workflows/visual.yml` berjalan pada setiap pull request ke `main`, push ke `main`, dan pemicu manual `workflow_dispatch`. Tidak memakai filter berkas: perubahan TSX, dependensi, dan konfigurasi build juga dapat mengubah CSS. Job **Public application visual gate** menjalankan `npm ci`, pemeriksaan kontrak, `npm run visual:setup`, lalu `npm run visual:ci`. Tidak pernah menjalankan `visual:update`.

Lingkungan CI memakai Ubuntu 24.04, Node **20.20.0**, Chrome for Testing **138.0.7204.100**, serta arsip font Ubuntu **DejaVu core dan mono 2.37-8**. Versi browser mengikuti referensi awal. Ketiga arsip diperiksa SHA-256 sebelum diekstrak; konfigurasi fontconfig hanya membaca font tersebut, dengan hinting `hintslight`, RGB dan filter LCD yang eksplisit. Font sistem runner tidak dipakai; pemblokiran Google Fonts masih memiliki batas yang dijelaskan pada bagian kebijakan font di atas. Skrip menolak versi browser yang berbeda. Paket JS dipasang dari `package-lock.json`.

Sebelum `npm ci`, runner GitHub menjalankan tes tanpa dependensi dan `scripts/prepare-visual-ci-lock.mjs`. Skrip hanya mengalihkan URL tarball `package-firewall.replit.local/npm/` ke `https://registry.npmjs.org/` dalam salinan checkout CI; versi, integrity, dan metadata dependensi tidak berubah. Alamat internal itu tidak dapat dipakai runner GitHub. Skrip menolak berjalan di luar GitHub Actions dan menolak entri internal tanpa integrity atau jalur yang tidak sesuai. Lockfile workspace tidak diubah, tidak ada upgrade paket atau pengabaian checksum. Sesudah pemasangan, import `express`, `puppeteer-core`, dan `vite` harus berhasil; exit code pemasang saja bukan bukti bahwa modul tersedia.

`visual:ci` membangun frontend aplikasi asli dengan konfigurasi Vite proyek, menyalakannya lewat server HTTP lokal pada port sementara, memeriksa kesiapan HTML, lalu menjalankan **`npm run visual:check`**. Server selalu ditutup setelah pemeriksaan. Ini bukan mockup sandbox. Backend tidak diimpor: tidak ada database, startup seed, worker, login, atau panggilan layanan berbayar. API lokal mengembalikan 401 untuk konteks anonim; pemeriksaan ini menilai tampilan publik, bukan perilaku API.

Artefak **visual-comparison-…** di halaman Actions diunggah bahkan jika pemeriksaan gagal, disimpan 14 hari, dan berisi `results/report.html`, gambar saat ini, diff magenta, serta `baselines/`. Unduh dan ekstrak seluruh artefak, lalu buka `results/report.html` agar tautan gambar relatif tetap bekerja. Kegagalan build/browser/heading juga menghasilkan laporan kesalahan; jika pemasangan dependensi atau unduhan gagal sebelum server berjalan, lihat log langkah Actions (belum ada gambar pembandingan).

Untuk pra-rilis lokal di Linux:

```sh
npm run visual:setup
npm run visual:ci
```

Diperlukan `curl`, `unzip`, `dpkg-deb`, `fontconfig`, dan pustaka runtime Chrome (daftarnya ada di workflow). Unduhan/build disimpan dalam `generated-artifacts/`, tidak masuk git atau deployment. Di workspace Nix, Chrome Linux unduhan mungkin tidak dapat memuat pustaka sistem. Gunakan Chromium sistem secara eksplisit jika **versinya sama**:

```sh
CHROME_PATH="$(which chromium)" npm run visual:ci
```

Override ini hanya berlaku lokal; dalam CI, skrip selalu memilih binary unduhan yang diverifikasi. Tidak ada pembaruan referensi otomatis atau bypass ambang perubahan. Untuk benar-benar melarang merge yang gagal, pengelola repositori perlu menetapkan job tersebut sebagai required status check pada perlindungan branch; workflow ini tidak mengubah pengaturan repositori atau melakukan deployment.

## Aktivasi larangan merge di GitHub

**Status: aktif, diverifikasi pada 28 Oktober 2026.** Paket lengkap sudah masuk ke `main` melalui [PR #2](https://github.com/penshopx/landing-page/pull/2). [Ruleset khusus `main`](https://github.com/penshopx/landing-page/rules/26010672) mewajibkan **`Public application visual gate`** dari GitHub Actions, tanpa daftar bypass. [PR uji #3](https://github.com/penshopx/landing-page/pull/3) membuktikan pembandingan visual gagal dan merge biasa berstatus `BLOCKED` untuk aktor yang tidak dapat bypass; perubahan uji kemudian dipulihkan, pemeriksaan visual revisi baru lulus, dan PR ditutup tanpa merge. Rincian konfigurasi sebelum/sesudah, revisi, hasil CI dan batas verifikasi ada di [catatan aktivasi](activation-audit-2026-10-28.md).

Audit sebelum aktivasi menemukan respons `Branch not protected` dari API branch protection, daftar ruleset kosong termasuk aturan induk, dan tidak ada aturan efektif pada `main`. Karena itu aktivasi menambahkan satu ruleset tersendiri, bukan mengganti konfigurasi keamanan lain.

Aktivasi dilakukan atas persetujuan pengelola **setelah workflow beserta pendukungnya tersedia di GitHub**. Untuk perubahan berikutnya, jangan memasang required check yang belum dapat dijalankan karena seluruh PR biasa akan menunggu hasil yang tidak pernah muncul. Keberadaan workflow di workspace saja bukan bukti bahwa GitHub menjalankannya.

### Prasyarat dan perubahan terbatas

1. Kirim paket visual lengkap melalui PR yang ditinjau: `.github/workflows/visual.yml`, `scripts/check-visual.mjs`, `scripts/run-visual-ci.mjs`, `scripts/setup-visual-env.sh`, `tests/visual-ci.test.mjs`, `tests/visual-negative.test.mjs`, fixture dan delapan PNG referensi di `tests/visual/`, serta keenam perintah npm visual di `package.json`. Pastikan versi frontend/CSS sesuai dengan referensi yang ditinjau; jangan menyalin referensi baru untuk menyembunyikan kegagalan pada kode lama. Jangan mengganti seluruh `package.json` GitHub dengan versi workspace hanya untuk menambahkan perintah ini.
2. Setelah workflow tersedia di `main`, pastikan run sungguhan menghasilkan check dengan nama tepat **`Public application visual gate`** dan penyedia **GitHub Actions**. Nama workflow `Visual regression` bukan nama required check. Catat URL run dan identitas aplikasi dari check run, bukan tebakan ID penyedia.
3. Dengan akses administrasi yang sesuai, baca kembali perlindungan branch klasik, semua ruleset termasuk induk, dan aturan efektif `main`. Simpan konfigurasi sebelum perubahan. Jangan menganggap hasil audit lama masih berlaku.
4. Tambahkan hanya check tersebut ke daftar required status checks untuk `main`, terikat ke GitHub Actions bila tersedia. Pertahankan seluruh check lama, persyaratan review, pembatasan push, pengaturan branch terbaru/strict, force-push, penghapusan, dan daftar bypass. Jangan memakai permintaan penggantian konfigurasi dengan nilai kosong/default. Jika belum ada perlindungan sama sekali, gunakan ruleset branch aktif dengan target hanya `refs/heads/main` dan aturan required status check tersebut; jangan memperluas target ke semua branch. Periksa daftar bypass secara eksplisit.
5. Baca ulang konfigurasi dan aturan efektif setelah penyimpanan. Bandingkan dengan konfigurasi awal: perbedaannya hanya penambahan gate yang disetujui (atau ruleset khusus yang baru). Catat URL aturan, nama check, penyedia, dan jalur bypass yang benar-benar berlaku. Jika API menolak akses, laporkan kegagalan; jangan menganggap aturan aktif.

Dokumentasi GitHub: [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging), [aturan branch efektif](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch), dan [pembuatan ruleset](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset).

### Bukti bahwa PR gagal benar-benar terblokir

- Gunakan PR uji non-draft ke `main` tanpa konflik, tanpa kegagalan lain, dan tanpa mengubah baseline/workflow. Buat perubahan visual yang jelas pada halaman yang ditangkap. Jangan merge PR uji.
- Tunggu check pada revisi PR terbaru selesai dengan kesimpulan **failure** akibat pembandingan visual, bukan kegagalan instalasi/build/browser. Simpan URL PR, revisi, dan URL check run.
- Dari akun tanpa bypass, pastikan halaman PR menyatakan required check ini gagal dan merge biasa diblokir. Respons REST `mergeable: true` hanya berarti tidak ada konflik; itu bukan bukti izin merge. Catat juga status blokir GitHub jika tersedia. Jangan mencoba API merge dengan akun admin sebagai cara menguji: jika aturan keliru, PR justru bisa tergabung.
- Pulihkan perubahan pada PR uji dan pastikan run revisi baru lulus; hasil hijau revisi lama tidak cukup. Tutup PR tanpa merge setelah bukti dikumpulkan. Simpan tautan hasil gagal/terblokir dan hasil pulih di catatan audit. Sampai langkah ini selesai, nyatakan verifikasi pemblokiran **belum dilakukan**, bukan selesai berdasarkan tes lokal.

### Batas perlindungan

Required check berlaku pada jalur GitHub yang tercakup aturan aktif. Perlindungan branch klasik dapat mengecualikan admin bila penerapan ke admin tidak diaktifkan; ruleset dapat memberi bypass kepada role, tim, atau aplikasi tertentu. Pemilik hak administrasi juga dapat mengubah atau menonaktifkan aturan. Jangan mengklaim gate tidak dapat dilewati, dan jangan mengubah kebijakan bypass tanpa persetujuan terpisah.

Aturan GitHub tidak dengan sendirinya memeriksa atau menghentikan deployment dari workspace, CLI, layanan lain, atau salinan kode yang tidak melalui PR terlindungi. Run pada `push` ke `main` hanya mendeteksi masalah setelah push tersebut terjadi. Prosedur rilis di luar GitHub tetap perlu menjalankan `npm run visual:ci` terhadap revisi yang akan dirilis dan menolak rilis saat gagal; task ini tidak memasang atau menjanjikan penguncian deployment tersebut.

## Pemeriksaan manual terhadap server yang sudah berjalan

Mulai aplikasi (`npm run dev`), lalu jalankan `npm run visual:check` **sebelum merilis pembaruan CSS**. Pemeriksaan memakai Chromium (`CHROME_PATH` bila `which chromium` tidak tersedia), delapan referensi yang dilacak di `baselines/`, dan tidak berjalan dalam `npm test` biasa. `VISUAL_BASE_URL` boleh menunjuk ke server pengembangan lain yang menjalankan versi kode yang sedang diperiksa; jangan arahkan ke akun login/produksi. Laporan lokal ada di `results/report.html` (buka di browser), beserta gambar terbaru dan diff magenta. Kode keluar 1 jika halaman/heading hilang atau selisih melewati 1,2% piksel (per kanal warna di atas 20). Hasil lama dibersihkan setiap kali pembandingan dimulai.

Beranda dan `/kontraktor` menguji viewport awal; `/documentation` memotret elemen isi kartu hierarki (`prose`); `/pricing` memotret elemen kartu Paket Bisnis (`ring-2`) dengan margin **4px per sisi**, khusus kartu ini. Ring luar Tailwind adalah box-shadow yang tidak termasuk `getBoundingClientRect()`; tanpa margin, hampir seluruh ring terpotong. Setiap halaman dirender di viewport 1280×800 dan 390×844 (elemen boleh lebih tinggi dari viewport). Browser menggunakan konteks anonim baru, tema bawaan aplikasi (gelap), pixel ratio 1, animasi nonaktif; widget chat dan nomor kontak dinamis disembunyikan. Skrip mengusahakan pemblokiran aset pihak ketiga (termasuk Google Fonts), tetapi intersepsi permintaan belum menjamin seluruh font terblokir pada halaman berikutnya. Jalankan di lingkungan Chromium dan font sistem yang sama; jangan menganggap hasil sebagai bukti offline penuh. Ini mendeteksi perubahan CSS pada area yang tertangkap, bukan semua bagian halaman. Permintaan API dinamis tidak dipakai untuk menunggu kesiapan halaman.

## Pembaruan referensi: manual dan ditinjau

Jika perubahan disengaja, tinjau ketiga kolom laporan dan gunakan lingkungan font/browser yang dipin. Terhadap frontend/server lokal yang menjalankan kode baru:

```sh
CHROME_PATH="$(which chromium)" \
FONTCONFIG_FILE="$PWD/generated-artifacts/visual-env/fonts.conf" \
VISUAL_EXPECTED_CHROME=138.0.7204.100 \
VISUAL_BASE_URL=http://127.0.0.1:5000 \
npm run visual:update
```

Pada Linux biasa, `CHROME_PATH` dapat menunjuk ke `$PWD/generated-artifacts/visual-env/chrome-linux64/chrome`. Periksa **semua** PNG yang berubah sebelum menyimpannya ke git, ajukan perubahan dalam PR untuk ditinjau, lalu jalankan pembandingan tanpa `--update`. Jangan memperbarui referensi hanya untuk membuat pemeriksaan lulus. `visual:update` menolak dijalankan ketika `CI` aktif; `visual:ci` menolak semua argumen termasuk `--update`. Pembaruan browser/font juga harus diperlakukan sebagai perubahan referensi yang ditinjau, bukan pembaruan otomatis.

`npm run test:visual-ci` memeriksa pemicu CI, pin/checksum font dan browser, unggahan laporan, serta penolakan pembaruan referensi dan laporan ketika lingkungan belum siap. Hasil di `results/` sengaja tidak dilacak.

`npm run test:visual-ci-failures` menjalankan runner pra-rilis asli terhadap frontend Vite kecil di direktori unik `generated-artifacts/visual-ci-failures-*/`. Jalankan sesudah `visual:setup`, atau gunakan `CHROME_PATH` yang menunjuk Chromium 138.0.7204.100 lokal. Lingkungan child memakai daftar variabel yang diizinkan, tanpa database, sesi, atau kunci provider. Referensi fixture adalah salinan PNG aplikasi; referensi asli dan salinannya wajib tidak berubah.

Fixture membuktikan build gagal, executable browser gagal dibuka, dan heading halaman kedua benar-benar hilang: semuanya keluar 1 secara normal, mengganti laporan serta gambar lama, dan menutup frontend jika sudah dimulai. Tangkapan halaman yang sudah berhasil tetap ditautkan dalam laporan kegagalan heading. Kasus tambahan dengan delapan perbedaan gambar menghasilkan laporan lengkap beserta diff, tanpa mengubah ambang atau referensi. Susunan unggahan diambil dari daftar path workflow Actions, dikemas dengan root bersama `tests/visual`, lalu diekstrak ke direktori lain. Setiap tautan gambar dalam `results/report.html` harus mengarah ke PNG lengkap di paket ekstraksi, termasuk `../baselines/`. Kasus build/browser yang belum menghasilkan gambar hanya memuat alasan kegagalan, bukan tautan gambar buatan. Workflow mengunggah bukti fixture dan log meskipun pemeriksaan gagal.

Delapan PNG referensi juga diperiksa terhadap `baselines/sha256.json` sebelum browser dijalankan. Ini mendeteksi kerusakan saat transfer atau checkout, terpisah dari regresi tampilan. Jika referensi memang diperbarui dengan persetujuan peninjau, tinjau PNG dan perbarui checksum terkait dalam PR yang sama (`sha256sum tests/visual/baselines/*.png`). Jangan mengubah manifest untuk menerima PNG rusak atau membuat CI hijau tanpa tinjauan.

Referensi awal dibuat dari frontend workspace, yang lebih baru daripada frontend pada branch GitHub sasaran ketika paket CI disiapkan. Paket CI saja tidak membawa seluruh perubahan aplikasi itu. Selisih navigasi dan tata letak yang muncul setelah pembandingan berjalan harus ditinjau sebagai perbedaan sumber aplikasi: pengelola perlu menentukan apakah perubahan frontend terkait ikut dibawa, atau referensi untuk revisi GitHub ditinjau dan disetujui secara terpisah. Jangan otomatis mengganti referensi atau mengubah tampilan aplikasi hanya untuk meloloskan pemeriksaan.

Pengelola memilih mempertahankan referensi workspace. Karena itu PR juga menyertakan navigasi ekosistem dan konfigurasi Tailwind/Vite/CSS yang menghasilkan referensi tersebut. Tidak ada pembaruan PNG atau pelonggaran ambang. Tailwind 4 memakai versi dan checksum yang sudah ada pada dependensi plugin Vite; dependensi aplikasi lain tidak dinaikkan.

Tes umum memakai layanan PostgreSQL 16 sementara milik job GitHub, bukan secret `DATABASE_URL` repositori. Guard memeriksa runner, mode test, host loopback, nama database khusus, kesesuaian kedua URL, serta ketiadaan jalur pooled dan kredensial provider nyata. Persiapan menolak database yang sudah berisi objek, membuat schema dari sumber aplikasi, dan hanya menanam data produk; tidak menyalin data pelanggan atau transaksi. Layanan beserta volumenya dibuang otomatis saat job berakhir.

### Catatan kesiapan PR dan kredensial webhook

Workflow tes umum harus memakai persiapan lockfile portable yang sama sebelum `npm ci`; pemasangan ulang saja masih memakai URL internal yang direkam di lockfile. Tes clipboard sertifikat memeriksa URL absolut dari `window.location.origin`, bukan memaksa domain produksi pada setiap lingkungan.

Pemindaian Gitleaks tetap aktif. Pemeriksaan tambahan membedakan prefix kunci dari bagian identifier/slug biasa dan assignment literal dari referensi `process.env`. Log hanya berisi lokasi dan nama aturan, bukan baris yang cocok atau nilai kredensial. Bagian `[userenv.shared]` tetap ditolak pada konfigurasi `.replit` yang dilacak, tetapi penyebutannya dalam dokumentasi tidak dianggap kebocoran.

PR persiapan memindahkan konfigurasi nonrahasia ke `[env]` dan menghapus `NOTIFY_WEBHOOK_KEY` serta URL webhook yang membawa kunci dari konfigurasi terlacak. Penghapusan itu sendiri **tidak** merotasi nilai lama atau menghapusnya dari riwayat Git/log CI yang sudah terbit. Sebelum merge pada 28 Oktober 2026, keberadaan Secret pengganti produksi diperiksa tanpa membaca nilainya, dan pengelola mengonfirmasi pengirim webhook sudah memakai kunci baru. Ini bukan uji pengiriman notifikasi atau pembuktian bahwa semua salinan rilis lama telah mencabut kunci lama. Kebutuhan membersihkan riwayat/log dan memastikan pencabutan pada setiap runtime lama tetap harus dinilai pengelola. Tidak ada deployment atau pengiriman notifikasi uji dalam aktivasi gate; lihat [catatan aktivasi](activation-audit-2026-10-28.md).

## Uji negatif terisolasi: warna, ring, dan ukuran kartu

```sh
CHROME_PATH="$(which chromium)" npm run test:visual-negative
```

Perintah menjalankan dua pengujian berurutan: fixture pembanding dan **frontend aplikasi asli**. Keduanya memakai skrip `check-visual.mjs` asli, bukan pembanding tiruan, tanpa database, login, atau provider eksternal.

`tests/visual-negative.test.mjs` memakai fixture HTML lokal `fixtures/cards.html` yang melayani empat rute pada port sementara. Bagian ini tidak membutuhkan build aplikasi. Delapan referensi fixture dibuat di direktori kerja unik `generated-artifacts/visual-negative-*/`; delapan referensi aplikasi yang ditinjau di `tests/visual/baselines/` tidak dipakai sebagai referensi fixture dan hash-nya diperiksa tetap sama setelah uji.

Kondisi normal fixture wajib menghasilkan kode keluar **0** dan delapan hasil **LULUS** dengan selisih nol. Perubahan warna latar kartu `prose` serta warna ring inset kartu `ring` masing-masing wajib menghasilkan kode keluar **1**, dua hasil **BERUBAH** (desktop/mobile) di atas ambang 1,2%, dan enam hasil lain tetap lulus. Ring inset hanya membuktikan pembanding; cakupan ring luar aplikasi dibuktikan terpisah di bawah. Setiap mutasi fixture diulang dua kali dan hash semua diff harus identik. Error browser/heading tidak dianggap bukti bahwa regresi CSS terdeteksi.

Varian `height-grow` dan `height-shrink` hanya mengganti tinggi kartu `prose` dari 280px menjadi 320px atau 240px; lebar, warna, ring, dan isi tetap. Keduanya diulang dua kali melalui tangkapan Chromium nyata di desktop/mobile. Masing-masing wajib keluar **1**, dua gambar prose **BERUBAH**, dan enam gambar lain tetap identik. Baris terkait di `report.html` wajib memuat dimensi referensi dan aktual (`lebar×280 → lebar×320` atau `lebar×240`, dengan pemisah `x`). Setiap PNG referensi, aktual, dan diff didekode penuh oleh browser. Ukuran diff wajib sama dengan maksimum lebar dan tinggi kedua gambar, sehingga pertumbuhan maupun penyusutan tidak memotong bukti. Setelah semua mutasi, kontrol normal dipulihkan dan wajib kembali keluar **0**.

Uji juga memastikan PNG referensi, gambar saat ini, dan diff tersedia serta ditautkan di laporan HTML. Semua laporan dipertahankan di `tests/visual/results-normal/`, `results-normal-restored/`, `results-color-{1,2}/`, `results-ring-{1,2}/`, `results-height-grow-{1,2}/`, dan `results-height-shrink-{1,2}/` **di dalam direktori artefak unik**, bukan direktori hasil aplikasi. Buka `report.html` di salah satu direktori tersebut untuk melihat tiga kolom, termasuk diff magenta. Keluaran terminal menunjukkan direktori artefaknya.

CI menjalankan uji ini setelah penyiapan browser/font yang dipin dan mengunggah artefak **visual-negative-…** bahkan ketika uji gagal. Ekstrak seluruh artefak agar tautan `../baselines/` tetap bekerja. Perintah uji keseluruhan sukses justru ketika kegagalan visual yang disengaja terbukti; pembuatan referensi fixture hanya memakai `--update` dalam direktori sementara, sedangkan pembandingan tetap berjalan dengan `CI=true`. Tidak ada pembaruan referensi aplikasi, perubahan ambang, atau pengecualian kelulusan.

### Ring luar pada kartu aplikasi asli

`tests/visual-application-ring.test.mjs` membangun frontend dengan konfigurasi Vite proyek, termasuk `client/src/pages/pricing.tsx`, App, dan Tailwind asli. Server sementara hanya melayani hasil build; `/api` menjawab 401. Lingkungan child menggunakan daftar variabel yang diizinkan, tanpa database, sesi, atau kunci provider. Jalankan `npm run visual:setup` dahulu dan gunakan browser versi yang dipin seperti CI:

```sh
CHROME_PATH="$(which chromium)" \
FONTCONFIG_FILE="$PWD/generated-artifacts/visual-env/fonts.conf" \
node --test tests/visual-application-ring.test.mjs
```

Uji menyalin referensi yang ditinjau ke `generated-artifacts/visual-negative-application-*/tests/visual/baselines/`, **tidak pernah membuat referensi dengan `--update`**. Kontrol normal wajib keluar 0, kedelapan gambar lulus, dan dua tangkapan ring sama persis dengan referensi. Server kemudian menyisipkan hanya CSS `.ring-2.ring-violet-400 { --tw-ring-color: #22c55e !important; }` pada respons `/pricing`; berkas TSX dan bundle tidak diubah. Lebar, radius, offset, ketebalan ring, isi kartu, dan tata letak tetap sama. `npm run visual:check` wajib keluar **1**, kedua gambar ring harus **BERUBAH**, dan enam gambar lainnya tetap **LULUS**.

Selain status, uji membaca PNG: ukuran normal/hasil/diff harus sama, area isi kartu tidak boleh berubah, dan lebih dari 1.000 piksel pada margin luar bounding box harus berubah serta tampil magenta di diff **pada setiap viewport**. Sudut ring yang membulat dapat berada di dalam bounding box; pemeriksaan isi mengecualikan radius sudut 16px, bukan mengabaikan seluruh kartu. Semua tautan referensi/hasil/diff diperiksa dan hash referensi asli beserta salinannya harus tetap sama.

Bukti tersimpan bersama dalam direktori unik: `build.log`, `normal.log`, `outer-ring.log`, `outer-ring-pixels.json`, `tests/visual/results-normal/report.html`, dan `tests/visual/results-outer-ring/report.html` beserta PNG. Direktori ini ikut pola unggahan CI `visual-negative-*`. Tidak ada akses database, deployment, atau perubahan aplikasi harga.

**Tinjauan referensi pada 28 Oktober 2026:** sebelum perbaikan, mutasi warna ring luar nyata masih keluar 0 (desktop 0,10%, mobile 0,09%); hanya sebagian sudut tertangkap. Margin 4px dipilih untuk ring 2px dan antialiasing, tanpa memperluas tangkapan halaman lain. Dua kandidat bersih ditangkap dengan pembandingan biasa, diperiksa manual untuk memastikan kartu Paket Bisnis dan seluruh ring terlihat, lalu disalin satu per satu menjadi referensi. Tidak menjalankan `visual:update`. Desktop berubah dari 297×531 menjadi 305×539; mobile dari 358×499 menjadi 366×507. Setelah margin 4px dibuang dari kandidat, area gambar lama identik (0 kanal berubah) di kedua viewport. Hanya dua PNG ring dan checksum terkait diganti; enam PNG lain tidak berubah. Ambang tetap 1,2% dan toleransi kanal tetap 20.

**Hasil setelah perbaikan:** kontrol aplikasi normal keluar 0; mutasi ring luar keluar 1 dengan desktop **2,02%** dan mobile **1,85%**, tanpa perubahan dimensi. Diff kedua viewport ditinjau dan menampilkan ring magenta lengkap; isi kartu tidak berubah. Margin di luar bounding box mengandung masing-masing **3.165** dan **3.281** piksel magenta. Enam tangkapan lain tetap lulus. Pengujian tidak menerima kegagalan karena browser/heading, ketidakcocokan ukuran, atau perubahan pada isi kartu sebagai pengganti bukti ring.