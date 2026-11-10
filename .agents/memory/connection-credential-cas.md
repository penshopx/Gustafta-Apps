---
name: Connection credential concurrency
description: Credential changes require a confirmed lifecycle revision, including revocation and recovery after lost responses.
---
Rotasi dan pencabutan koneksi memakai revisi siklus kredensial yang sama.
Pencabutan dari sesi lama tidak boleh otomatis mengikuti revisi baru; pemilik
harus memuat ulang dan mengonfirmasi lagi jika rotasi menang.

**Why:** Tanpa pemeriksaan pada kedua tindakan, sesi lama dapat mencabut token
yang baru saja berhasil diterbitkan sesi lain. Respons hilang juga tidak
membuktikan rotasi gagal tersimpan, sehingga retry buta dapat mengganti token lagi.

**How to apply:** Tangkap revisi ketika konfirmasi dibuka, jangan menggantinya
dengan hasil refetch latar. Setelah konflik atau hasil tidak pasti, minta muat
ulang eksplisit sebelum konfirmasi baru. Revisi kredensial terpisah dari revisi
profil dan tidak mewakili perubahan pilihan dokumen.
