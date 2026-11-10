---
name: Startup repair transaction boundary
description: Mengapa pemulihan startup harus menulis seluruh tahap melalui satu koneksi transaksi.
---

Pemulihan startup yang menyusun beberapa entitas harus menggunakan satu transaksi database untuk seluruh penulisan, termasuk penanda selesai. Helper storage global yang membuka query sendiri tidak dapat ikut rollback transaksi pemanggil.

**Why:** Proses dapat terputus sesudah KB tercatat namun sebelum relasi atau penanda tersimpan. Pada retry, penanda saja tidak membuktikan bahwa semua tahap selesai; pembacaan KB yang sudah ada harus dibatasi ke agen terverifikasi dan identitas entri yang tepat.

**How to apply:** Untuk patch startup bertahap, lakukan pemeriksaan identitas dan seluruh perubahan melalui client transaksi yang sama. Kunci entitas induk bersama sebelum membaca kandidat atau penanda, agar dua instance tidak sama-sama menyimpulkan entitas anak belum ada. Periksa kondisi lengkap sebelum skip; patch lama mungkin menulis penanda meski beberapa insert gagal dan menelan error. Cocokkan entri parsial secara idempoten pada retry, dan perbarui penanda lama alih-alih membuat penanda kedua.