---
name: Persetujuan aktivasi visual gate
description: Syarat pengelola sebelum aturan merge visual diaktifkan pada main GitHub.
---

Pengelola memilih mengaktifkan pemeriksaan visual wajib hanya setelah workflow tersedia di GitHub, bukan segera saat workflow masih hanya ada di workspace.

**Why:** Memasang required check sebelum workflow beserta pendukungnya tersedia akan membuat PR menunggu check yang tidak pernah dijalankan.

**How to apply:** Pastikan workflow dan paket pendukung sudah tersedia di main GitHub sebelum mengubah aturan. Persetujuan ini bukan izin untuk merge PR atau melakukan deployment. Jangan menandai pemblokiran sebagai terbukti sebelum ada bukti GitHub dari PR gagal melalui akun tanpa bypass.
