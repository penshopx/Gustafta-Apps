# Pratinjau Gustafta dan sandbox

Pratinjau utama menggunakan aplikasi yang sudah ada, bukan migrasi aplikasi baru.

| Tujuan | Workflow | Port lokal | Jalur domain pengembangan |
| --- | --- | --- | --- |
| Gustafta, termasuk API | `Start application` | 5000 | `/` dan `/api/*` |
| Mockup | `artifacts/mockup-sandbox: Component Preview Server` | 23636 | `/__mockup/` |

Pemetaan `.replit` tetap `5000 → 80` dan `23636 → 3000`. Metadata
`artifacts/mockup-sandbox/.replit-artifact/artifact.toml` membatasi layanan
sandbox ke `/__mockup/`; jangan mengubahnya menjadi layanan root.

Jalankan kedua workflow melalui pengelola workflow Replit, lalu:

```sh
npm run check:preview-routing
```

Pemeriksaan hanya membaca domain `REPLIT_DEV_DOMAIN`, tanpa token, login,
perubahan data, atau pengalihan koneksi ke port lokal. Pemeriksaan gagal bila:

- API profil perusahaan tidak mengembalikan 401 JSON dengan
  `Cache-Control: private, no-store` dan
  `X-Gustafta-RS-Contract: rs-app-v1-private-no-store`;
- halaman root bukan HTML Gustafta;
- `/__mockup/` bukan HTML sandbox;
- salah satu entry point JavaScript tidak dapat dimuat.

Pemeriksaan HTTP tidak membuktikan seluruh interaksi UI atau WebSocket.

## Regresi startup dan restart tanpa DB

```sh
npm run test:preview-routing-startup
```

Memerlukan Node dan Python 3.11+ (`tomllib`, tersedia pada runtime Python
proyek). Uji membaca TOML `.replit` dan metadata artifact, memvalidasi pemetaan
port, `previewPath`, `paths`, dan `BASE_PATH`, lalu menjalankan dua server
fixture HTTP serta router lokal pada port loopback sementara. Tidak ada impor
backend Gustafta, akses DB, token, seed, perubahan auth, atau publish.
Workflow asli tidak perlu dimulai, dihentikan, atau di-restart.

Matriks mencakup Gustafta → sandbox dan sandbox → Gustafta, masing-masing
dengan restart Gustafta dan restart sandbox. Setiap fase memeriksa root,
beberapa `/api/*`, halaman sandbox termasuk jalur bertingkat, serta JavaScript
kedua layanan. Saat satu layanan belum hidup atau sedang berhenti, jalurnya
harus gagal 503, bukan beralih ke layanan lain; layanan yang tetap hidup harus
tetap benar. Setelah restart, identitas generasi respons dan JavaScript harus
berubah hanya untuk layanan yang di-restart. Ketika keduanya hidup, kontrak
HTTP yang sama dengan `check:preview-routing` juga dijalankan.

Router fixture menerapkan kepemilikan jalur dari konfigurasi, **bukan router
Replit sebenarnya**. Hasil ini membuktikan matriks regresi lokal dan konsistensi
konfigurasi, bukan perilaku registrasi layanan/proxy Replit saat restart.
Untuk memeriksa domain nyata tetap gunakan `check:preview-routing` setelah
kedua workflow berjalan; CLI tersebut tetap hanya menerima domain
pengembangan `.replit.dev`, tanpa fallback localhost.

## Batas pemeriksaan domain

Screenshot yang langsung menuju port 5000 melewati router domain: screenshot
`/__mockup/` pada port tersebut bisa menampilkan 404 Gustafta meskipun jalur
sandbox pada domain pengembangan bekerja. Periksa alamat aktual hasil
screenshot dan jangan menyimpulkan pemetaan domain dari screenshot lokal saja.

Pada verifikasi 14 Oktober 2026, kedua workflow awalnya belum berjalan.
Setelah dijalankan, semua kontrak HTTP domain pengembangan terpenuhi tanpa
perubahan pemetaan. Penyebab historis salah arah tidak dapat dipastikan dari
keadaan tersebut.

Konfigurasi publishing tetap Autoscale dengan build `npm run build` dan
run `node ./dist/index.cjs`. Tidak dilakukan publish. Keberhasilan pemeriksaan
401 ini bukan bukti integrasi SBU sudah selesai.
