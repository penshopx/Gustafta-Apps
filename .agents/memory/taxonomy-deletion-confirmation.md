---
name: Taxonomy deletion confirmation
description: Safety invariant for deleting globally shared KB categories.
---

Kategori pengetahuan global boleh dihapus meskipun digunakan KB, tetapi hanya tautan kategori yang dilepas; isi dan dokumen KB tidak boleh hilang. Konfirmasi admin harus mengirim jumlah KB yang ditinjau, lalu server membandingkannya dengan jumlah aktual di dalam transaksi yang mengunci perubahan sebelum melepas tautan. Perubahan jumlah harus membatalkan penghapusan dan meminta tinjauan ulang.

**Why:** Kategori dipakai lintas akun. Jumlah di layar dapat usang saat admin lain atau proses KB mengubah referensi; dialog konfirmasi saja tidak cukup untuk menjaga keputusan admin sesuai dampak sebenarnya.

**How to apply:** Pertahankan pemeriksaan jumlah dan pelepasan referensi dalam satu transaksi jika perilaku hapus kategori atau penyimpanan KB berubah. Jangan ubah menjadi penghapusan berantai dokumen.
