---
name: Launch Packages (Solution Package Engine)
description: Konvensi & keputusan 6 Launch Package GAIA — harga, komposisi, satuan usage_limit, alur approval.
---

## 6 Launch Package (ACTIVE di DEV, GAIA ON, snapshot v1; belum promote production)
1. SBU-KONSTRUKSI-PROFESSIONAL-6M — Rp1.999.000 (6 anggota, incl Jasa Dokumen 1)
2. SKK-KONSTRUKSI-BASIC-3M — Rp599.000 (5 anggota; exclude Jasa Dokumen & Ruang Kelola; disclaimer Bimtek wajib)
3. TENDER-KONSTRUKSI-PROFESSIONAL-6M — Rp2.499.000 (Brain Project CORE 2 proyek; exclude Jasa Dokumen)
4. LEGALITAS-KONSTRUKSI-BASIC-3M — Rp699.000 (nama override "Gustafta Legalitas & OSS — …"; OSS = cakupan materi, bukan anggota)
5. PROYEK-KONSTRUKSI-BUSINESS-12M — Rp5.999.000 (flagship 7 anggota; Brain 4, Jasa Dokumen 2, RS 25 GB)
6. FINANCE-KONSTRUKSI-PROFESSIONAL-6M — Rp1.999.000 (simetri harga dgn SBU Prof; Jasa Keuangan CORE 1 pekerjaan)

## Konvensi terkunci
- **usage_limit = angka murni; untuk Ruang Simpan angka = GB** (5=5GB, 1=1GB, 25=25GB), satuan ditegaskan di deskripsi paket. JANGAN konversi ke MB.
- Diferensiasi tier: Basic tanpa Jasa Dokumen/Ruang Kelola; Professional +tim/workspace; Business kuota 2× + Jasa 2 pekerjaan.
- Anggota jasa tanpa harga satuan (Bimtek, Jasa Keuangan) sah sebagai member paket — jangan mengarang harga eceran.
- Harga paket = keputusan ChatGPT/Bos, dasar nilai eceran komponen dari pricing.ts; tidak mengarang diskon.
- Alur wajib per paket: AUDIT read-only → APPROVE → CREATE DRAFT → READ-BACK → CROSS-CHECK (paket lain + 10 produk utuh) → LOCK.

**How to apply:** Keenam paket sudah lolos cross-check final dan publish di development. Perubahan material berikutnya harus mengikuti versioning engine dan menghasilkan snapshot immutable baru; promosi production tetap dilakukan lewat pekerjaan terpisah.

## CTA Pesan Paket (Opsi 1 — launch)
Keputusan: TIDAK ada checkout otomatis paket saat launch; catalog API menyertakan `order_cta` per paket (buildOrderCta di server/catalog-api.ts): wa.me URL + pesan prefilled WAJIB memuat package_id, nama, versi, harga. Nomor WA diambil live via getWaContact() saat mapping response (bukan di cache 60s) sehingga rotasi admin langsung berlaku. Checkout otomatis (Scalev + webhook + aktivasi hak) = fase setelah traction, jangan dibangun tanpa approval.
