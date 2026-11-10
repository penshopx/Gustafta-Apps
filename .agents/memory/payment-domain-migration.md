---
name: Payment domain & PAYMENT_BASE_URL
description: Scalev storefront domain is env-driven; how to migrate payment domains without touching code
---
Storefront pembayaran (Scalev) sekarang: **https://bayar.dokumenproyek.com** (dulu bayar.gustafta.my.id, mati/404 sejak Aug 2026). Brand pembeli = dokumenproyek.com; gustafta.my.id tetap mesin internal/admin.

**Rule:** jangan pernah hardcode domain pembayaran. Server pakai `PAYMENT_BASE_URL` dari `server/lib/scalev.ts` (env PAYMENT_BASE_URL); client pakai `client/src/lib/payment-base.ts` (env VITE_PAYMENT_BASE_URL). Keduanya diset di shared env.

**Why:** migrasi domain sebelumnya menyentuh 22 titik kode + baris DB (store_products.payment_url, agents.payment_url). Nilai payment_url yang tersimpan tidak otomatis berubah saat env diganti. Status berbagi DB produksi tercatat terpisah di prod-shares-dev-db.md.

**How to apply:** migrasi berikutnya = ganti 2 env var + periksa/update kolom payment_url tersimpan sesuai lingkungan DB yang berlaku. Jangan menganggap ada DB produksi terpisah.

**Rule:** server jangan mengimpor modul data klien sekalipun hanya membutuhkan satu konstanta harga; taruh nilai yang dipakai bersama di modul netral, lalu ekspor ulang untuk UI.

**Why:** bundler CommonJS mengikuti seluruh graph import. Impor data harga klien menyeret konfigurasi Vite (`import.meta.env`) ke server, memunculkan peringatan dan membuat URL pembayaran jatuh ke fallback.

**How to apply:** saat menambah harga/konstanta yang dipakai server dan UI, pastikan modul netral itu tidak mengimpor kode klien; uji graph build server, bukan hanya modul pembayaran langsung.
