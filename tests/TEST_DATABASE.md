# Database integrasi yang aman

## Alur otomatis lokal (direkomendasikan)

```bash
npm run test:commerce-integration
```

Memerlukan `initdb`, `pg_ctl`, `createdb`, Node dan dependensi proyek.
Perintah ini **selalu membuat cluster PostgreSQL lokal baru** di direktori
sementara privat, bukan memakai `DATABASE_URL` atau `TEST_DATABASE_URL` yang
sudah ada. Tidak ada dump, pembacaan database aplikasi, atau salinan pelanggan.
`TEST_DATABASE_URL` tanpa kredensial dibuat di lingkungan child process saja,
tidak disimpan ke berkas, konfigurasi repositori, ataupun log. Secret API
aplikasi tidak diteruskan; suite memasang mock Scalev/Brevo/Meta sendiri.
Ini tidak mengubah koneksi aplikasi yang sedang berjalan.
Secret webhook dummy hanya berlaku pada server HTTP lokal milik tes. URL
aplikasi di child process diganti placeholder yang tidak bisa terhubung;
pengaman masing-masing suite kemudian mengarahkannya ke URL uji setelah
validasi. Hanya nama database aplikasi awal yang diwariskan sebagai daftar
larangan, bukan URL atau kredensialnya.
Fixture preload `tests/fixtures/commerce-network.ts` menyimulasikan pengiriman
Brevo dengan key dummy untuk jalur fulfillment positif dan menolak `fetch`
eksternal lain yang belum di-mock suite. Tidak ada email/pembayaran sungguhan;
request HTTP loopback ke server uji tetap nyata.

Urutan alur:

1. Buat database `commerce_integration_test` pada cluster baru, port dinamis.
2. Generate DDL dari `shared/schema.ts` lewat API Drizzle (tidak menjalankan
   `drizzle-kit push`, prompt interaktif, atau migrasi historis pada pelanggan).
   DDL dan penanda dibuat dalam satu transaksi, hanya pada database kosong.
3. Jalankan seeder produksi yang terpilih: empat seed Claw proyek (termasuk
   dependensi MultiClaw), `seedStoreProducts`, `seedCashflowPackages`,
   `seedContractorLadder`, lalu `seedSbuSkkEbook`. Ini memakai definisi produk,
   harga, dan PDF kanonik di kode/aset lokal; bukan baris database pelanggan.
   Tidak menjalankan boot server penuh, scheduler, LMS seed, atau AI API.
   Seeder ebook memverifikasi hash PDF privat; aset yang hilang/salah membuat
   setup gagal, bukan memakai PDF dummy. Verifikasi akhir menolak seed yang
   menghasilkan pengguna, pesanan, langganan, atau entitlement.
4. Jalankan suite lifecycle, Scalev, Unified Order API, katalog, Claw visibility,
   dan delivery ebook **berurutan** (`--test-concurrency=1`).
5. Teardown memeriksa identitas dan penanda pada koneksi/transaksi yang sama,
   lalu mengosongkan schema public. Cluster dihentikan dan direktori sementara
   dibuang lewat trap, termasuk saat setup/tes gagal atau menerima SIGINT/TERM.
   SIGKILL tidak bisa menjalankan trap; cluster sisa tidak pernah dipakai ulang.

Untuk subset, tetap menggunakan setup dan teardown yang sama:

```bash
bash scripts/test-commerce-integration.sh tests/order-api-scalev.test.ts
```

Untuk memverifikasi koordinasi antarberkas pada cluster baru:

```bash
bash scripts/test-commerce-integration.sh --parallel \
  tests/test-database-lease.test.ts \
  tests/bootstrap-superadmin-db-concurrent.test.ts \
  tests/wa-contact-rotation.test.ts \
  tests/claw-seed-store-visibility.test.ts \
  tests/store-catalog-price-override.test.ts
```

Runner ini tetap berurutan untuk membatasi sumber daya. Pemanggilan langsung
beberapa berkas dengan `tsx --test` juga aman: pengaman menserialkan suite DB
yang tidak berkaitan. Alur ini tidak dimaksudkan sebagai eksekusi seluruh suite
proyek atau suite LMS.

## Database disposable yang disediakan pengelola

Jika memakai PostgreSQL terpisah yang bukan cluster lokal otomatis, buat
database **kosong** terlebih dahulu. Simpan `TEST_DATABASE_URL` melalui
**Replit Secrets**, bukan `.env`, `.replit`, argumen shell berkredensial, atau
repositori. Jangan memakai database LMS. Aplikasi tetap memakai URL semula.

```bash
npm run setup:integration-test-db
# Jalankan suite yang diperlukan dengan provider offline, selalu berurutan:
SCALEV_WEBHOOK_SECRET=disposable-webhook BREVO_API_KEY=disposable-email \
  node --import tsx --import ./tests/fixtures/commerce-network.ts \
  --test --test-concurrency=1 tests/order-api-scalev.test.ts tests/store-catalog-scalev-variant.test.ts
npm run teardown:integration-test-db
```

Setup menolak database yang memiliki objek public (termasuk view, fungsi, tipe,
sequence) atau schema buatan lain. Setup ulang pada database berpenanda tetap
ditolak: lakukan teardown eksplisit terlebih dahulu. Teardown menghapus **semua
objek public pada database uji yang terbukti**, bukan database itu sendiri.
Nama database harus berbeda dari URL aplikasi, pooled, identitas aplikasi
warisan child process, dan `LMS_TEST_DATABASE_URL`. Tidak ada perintah yang
menambahkan penanda ke database berisi data. Jika setup seed terputus setelah
DDL berhasil, lakukan teardown lalu setup ulang. Jika DDL gagal, transaksi
dibatalkan sehingga database tetap kosong.

Tes lifecycle membuat database saudara hanya jika runner lokal memberikan
`TEST_LIFECYCLE_ALLOW_CREATEDB=1`; jangan set flag ini untuk server eksternal.

## Kontrak pengaman untuk seluruh suite non-LMS

Tes non-LMS yang membaca/menulis database tidak lagi menerima `DATABASE_URL`
aplikasi sebagai izin untuk berjalan. Ini berlaku untuk `tests/run.ts` maupun
`npx tsx --test tests/<nama>.test.ts`.

Siapkan **database PostgreSQL baru yang disposable**, bukan salinan pelanggan,
database aplikasi, atau schema tambahan pada database aplikasi:

1. Namanya harus berakhiran `_integration_test` dan berbeda dari nama database
   pada `DATABASE_URL` **serta** `DATABASE_URL_POOLED` (host/alias berbeda tidak
   cukup).
2. Migrasikan schema aplikasi ke database baru tersebut. Suite katalog/ebook/
   claw memerlukan data seed produk yang sesuai, tanpa pengguna pelanggan.
3. Tambahkan penanda secara manual **hanya di database disposable**:

   ```sql
   CREATE TABLE public.integration_test_isolation_guard (marker text PRIMARY KEY);
   INSERT INTO public.integration_test_isolation_guard
     VALUES ('dedicated-disposable-integration-database');
   ```

4. Masukkan URL lewat konfigurasi lingkungan `TEST_DATABASE_URL`. Jangan
   menyimpan URL berkredensial di repositori atau output tes.
5. Jalankan `npx tsx tests/run.ts` atau satu berkas tes langsung.

Tanpa `TEST_DATABASE_URL`, kasus DB dilewati; kasus statis, adapter, serta unit
tetap berjalan. URL aplikasi dan pooled diblokir sebelum impor modul server.
Dengan URL uji, koneksi independen yang hanya menjalankan `SELECT` memeriksa
`current_database()` dan penanda, lalu ditutup. Kegagalan menghentikan evaluasi
suite **sebelum** hook setup/cleanup maupun fixture terdaftar. Ini sengaja tidak
mengandalkan kegagalan `before()`.

Tes HTTP yang dahulu memakai server workspace kini membuka server lokalnya
sendiri setelah validasi sehingga handler juga menggunakan database uji.
Subproses bootstrap meneruskan identitas nama database aplikasi awal agar
validasi tidak salah menganggap URL uji yang diwariskan sebagai URL aplikasi.

Pengaman non-LMS tidak menggantikan kontrak `LMS_TEST_DATABASE_URL` yang sudah
ada. Jangan menambahkan penanda ini ke database LMS atau database pelanggan.
Database uji dapat dibuang dan dibuat ulang setelah tes terhenti; snapshot/
jurnal pemulihan lama tetap digunakan oleh suite yang memilikinya.

### Koordinasi fixture antarproses

Setelah bukti identitas/penanda, `prepareTestDatabase()` menunggu lease fixture
PostgreSQL sebelum mengaktifkan URL uji. Semua suite non-LMS memakai lease yang
sama untuk satu database, termasuk suite snapshot konfigurasi dan reconciler
katalog. Suite terpisah tidak dapat mengambil snapshot ketika suite lain masih
mengubah atau memulihkan fixture. Waktu tunggu maksimum sepuluh menit; gagal
koneksi, token grup kedaluwarsa, atau timeout tetap memblokir URL aplikasi.
URL pooled tidak pernah diaktifkan.

Anak proses yang sengaja dibuat suite mewarisi `TEST_DATABASE_LEASE_GROUP`.
Jangan menghapus/mengganti variabel internal ini saat meneruskan lingkungan
ke worker. Setiap anak memvalidasi grup aktif pada database tujuan dan memegang
lease bersama sendiri. Induk tidak menahan lock eksklusif yang menghalangi
anak: bootstrap dua proses tetap berlomba pada lock khusus bootstrap yang
sudah ada, dan worker uji SIGKILL tetap berjalan di dalam grup induk.
Suite independen tetap menunggu sampai anggota terakhir selesai, bahkan bila
induk crash. Jangan membagikan token grup secara manual kepada suite independen.

Koneksi validasi selalu ditutup. Koneksi lease tidak mempertahankan proses
yang sudah selesai, tetapi tetap hidup sepanjang hook cleanup dan penutupan
pool; ditutup saat `beforeExit` atau otomatis oleh PostgreSQL ketika proses
mati. Hilangnya koneksi lease saat tes masih hidup menghentikan proses dengan
pesan tanpa kredensial, bukan melanjutkan mutasi tanpa koordinasi.
Lease bukan rollback: jurnal pemulihan fixture tetap diperlukan setelah crash.
Koneksi session-level ini memerlukan URL PostgreSQL langsung/session pooler,
bukan transaction pooler.

`test-database-lease.test.ts` adalah pengendali regresi khusus, bukan fixture
aplikasi: hanya membuktikan database sebelum membuka probe dan worker. Ia tidak
mengambil lease induk agar worker independen benar-benar bersaing. Regresinya
mencakup snapshot katalog/konfigurasi, anak bergabung di tengah antrean, crash
induk/anak, penolakan grup kedaluwarsa, dan penutupan koneksi.

## Audit dan pencegahan regresi

`test-database-isolation.test.ts` memeriksa seluruh suite yang mengakses DB
langsung/raw pg serta urutan impor. Audit mencakup katalog/harga/checkout,
Scalev/order/delivery, bootstrap/claw, kolaborasi/kuota mitra, taxonomy/registry/
Sales Ladder, Ruang Proyek/Simpan/Kelola, rate limiter, promotion dan patch
LexSkripsi. Suite non-DB dengan SQL double atau `MemStorage` bukan fixture
PostgreSQL dan tidak perlu database uji.

Suite DB baru wajib memanggil `await prepareTestDatabase()` pada tingkat modul
sebelum impor dinamis modul server; gunakan hasilnya untuk melewati setiap
kasus DB dan menjaga hook fixture. Jangan mengubah izin menjalankan tes menjadi
cek keberadaan `DATABASE_URL`, dan jangan mengirim mutasi ke server workspace.
