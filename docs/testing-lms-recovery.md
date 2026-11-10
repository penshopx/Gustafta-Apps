# Database uji dan pemulihan fixture LMS

Job **LMS isolated database and forced-stop recovery** di `.github/workflows/ci.yml`
memakai layanan PostgreSQL 16 sementara, bukan secret `DATABASE_URL` aplikasi.
Database `ci_lms_test` dibuat khusus per job dan dibuang bersama layanan CI.
Tidak ada akses atau salinan data pelanggan.

`scripts/setup-lms-test-database.ts` hanya membaca `LMS_TEST_DATABASE_URL`.
Script menolak database yang tidak berakhiran `_lms_test`, identitas koneksi
yang berbeda, atau database yang sudah berisi tabel publik. Tabel users,
user_profiles, dan LMS dihasilkan dari model Drizzle aplikasi, termasuk indeks
sertifikat; ini skema minimum untuk tes LMS, bukan migrasi seluruh aplikasi.
Pembuatan skema dan marker dilakukan dalam satu transaksi.

## Menjalankan secara lokal

Gunakan database PostgreSQL **kosong, terpisah, dan boleh dibuang** dengan nama
berakhiran `_lms_test`. Set koneksinya lewat `LMS_TEST_DATABASE_URL`; jangan
mengganti secret `DATABASE_URL` proyek dan jangan memakai data pelanggan.

```sh
npm run check:lms-recovery
npx tsx scripts/setup-lms-test-database.ts
npm run test:lms-recovery
```

Provisioning hanya dijalankan sekali pada database kosong. Pengulangan tes
memakai database yang sama agar pemulihan jurnal dapat diperiksa.
Tanpa `LMS_TEST_DATABASE_URL`, tes integrasi dilewati; job CI tetap wajib
menyediakan koneksi karena langkah provisioning gagal jika koneksi tidak ada.

## Bukti yang diperiksa

- Parent menjalankan subprocess melalui IPC dan menunggu pemberitahuan **setelah**
  jurnal/fixture tersimpan, baru mengirim **SIGKILL**. Ini bukan simulasi exception
  atau pemanggilan cleanup: hook `after()` tidak sempat berjalan.
- Dua jalur diperiksa: jurnal suite LMS umum dan jurnal re-enrollment. Masing-masing
  dihentikan sesudah jurnal saja serta sesudah semua fixture relasional dibuat.
- Parent memastikan jurnal dan fixture tertinggal. Subprocess berikutnya memakai
  helper pemulihan yang sama dengan suite sesungguhnya dan memastikan pengguna,
  profil, enrollment, progress, sertifikat, kursus fixture, dan tabel scratch hilang.
- Seluruh isi kursus dan pelajaran seed dibandingkan dengan kondisi sebelum
  penghentian. ID serial dan waktu pembuatan tidak dibandingkan karena pemulihan
  suite menghapus lalu melakukan seed ulang.
- URL aplikasi langsung dan pooled diganti dalam subprocess dengan pengawas TCP.
  Tes wajib mencatat **nol koneksi**, baik saat pemulihan sukses maupun penolakan
  alias yang memakai nama database aplikasi. Kredensial induk tidak diwariskan.
- Suite HTTP re-enrollment kemudian memeriksa sertifikat tetap sama dan tetap
  tersedia melalui API setelah enrollment direset.

Jalankan serial terhadap satu database khusus. Semua jalur fixture menggunakan
advisory lock yang sama dan menolak database yang sedang dipakai suite lain.
