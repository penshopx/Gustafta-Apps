# Cara memakai paket

1. Buka proyek aplikasi tujuan.
2. Unggah **GUSTAFTA_FEATURE_KIT_UPLOAD.md**. File ini lengkap dan cukup digunakan sendiri.
3. Salin PROMPT_UNTUK_AGEN.txt, lalu isi tujuan dan kode fitur/preset.
4. Bila belum tahu pilihan, minta rekomendasi minimum sebelum implementasi.
5. Agen menerapkan fitur secara lokal, lalu membuktikan alur serta batas akses.

## Isi
- File Markdown utama: seluruh katalog, spesifikasi, dependency, preset, aturan keamanan dan tes.
- KATALOG_FITUR.json/CSV: mudah dipilih atau diolah; bukan kode plugin.
- PILIHAN_FITUR_TEMPLATE.json: pilihan kosong disengaja, bukan izin memasang semua.
- PROMPT_UNTUK_AGEN.txt: instruksi yang tinggal disalin dan diisi.
- MANIFEST.json: daftar hash untuk memeriksa integritas paket.

ZIP boleh diekstrak dahulu. Jika agen dapat membaca ZIP, minta ia membuka README dan file utama; jangan hanya membaca CSV.

Tidak ada credential, akun, data perusahaan/pelanggan, file produksi atau kode aplikasi di paket ini. Referensi kode pada modul adalah provenance kemampuan, bukan jaminan sertifikasi atau kesiapan endpoint live.

Mode awal: **mandiri/local**. AI/email/WA/storage/pembayaran opsional membutuhkan provider aplikasi tujuan. Hanya F22 menambahkan koneksi baca data Gustafta, dengan izin dan verifikasi terpisah.

Paket tidak mengubah Gustafta, tidak memperbarui Notion dan tidak menyelesaikan integrasi live SBU.
