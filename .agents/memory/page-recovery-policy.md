---
name: Pemulihan halaman setelah rilis
description: Alasan pemulihan rute menggunakan persetujuan pengunjung, bukan reload otomatis
---

Pemulihan impor rute yang gagal memakai reload atas pilihan pengunjung saja, bukan percobaan reload otomatis.

**Why:** Kegagalan impor tidak membuktikan rilis baru tersedia; jaringan offline atau aset rilis yang masih bermasalah dapat terus gagal. Reload otomatis juga dapat menghilangkan perubahan yang belum disimpan tanpa persetujuan.

**How to apply:** Pertahankan pilihan reload manual dan peringatan perubahan belum disimpan bila memperluas pemulihan. Koneksi yang kembali cukup mengaktifkan pilihan reload, bukan menjalankannya.
