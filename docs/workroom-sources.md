# Sumber Ruang Simpan untuk tinjauan Workroom

## Cakupan pilot

Pemilik Workroom dapat menautkan dokumen **aktif milik akun yang sama** melalui
panel **Sumber Ruang Simpan → Pilih dokumen → Simpan sumber**. Buka dokumen dari
panel untuk meninjaunya, kemudian gunakan gerbang persetujuan biasa.

- Maksimal 5 dokumen dan total 20 MB per Workroom.
- Pemilih menampilkan hingga 100 dokumen aktif terbaru.
- Tautan disimpan di konteks Workroom; byte berkas tetap di Ruang Simpan.
- Tidak ada migrasi tabel, token aplikasi baru, atau grant baru.
- Izin folder, dokumen publik, akses biro jasa, admin, dan grant aplikasi lain
  **tidak** memperluas akses pilot ini. Akses lintas akun belum didukung.
- Menautkan sumber **tidak** otomatis mengirim isi berkas ke model AI. Ini adalah
  pengikatan bukti tinjauan, bukan implementasi RAG atau worker eksternal.

## Identitas sumber

Snapshot detail dan pemeriksaan tindakan membaca ulang dokumen dengan filter
pemilik. Verifikasi menggabungkan SHA-256 byte sumber, identitas pembaruan
database dengan presisi penuh, hasil ekstraksi, status pemrosesan, nama dan ukuran.
Untuk penyimpanan bytea lama, hashing dilakukan di PostgreSQL; untuk Object
Storage, byte dibaca melalui helper penyimpanan yang ada dan di-hash di server.
Kunci objek harus sesuai dengan pemilik dan ID berkas. Kunci penyimpanan, byte,
dan pesan galat provider tidak dikirim dalam respons snapshot.

Fingerprint tinjauan Workroom mencakup identitas setiap sumber. Akibatnya:

1. Mengubah, mengarsipkan, menghapus, atau memindahkan kepemilikan sumber membuat
   approval versi sebelumnya tidak efektif.
2. Perubahan byte objek terdeteksi walaupun nama dan metadata database tetap sama.
3. Perubahan A→B→A melalui API Ruang Simpan tetap mempunyai identitas pembaruan
   baru; approval pertama tidak kembali berlaku.
4. Snapshot menampilkan gate yang perlu ditinjau ulang sebagai `pending`.
   Tidak ada penulisan massal ke semua Workroom saat sebuah dokumen berubah.
5. Keputusan dan progres maju membaca sumber lagi. Tab lama mendapat HTTP 409;
   progres juga dilindungi pada Workroom tanpa gate.
6. Penyelesaian dengan sumber mencatat versi yang dipakai. Snapshot tidak
   menampilkan penyelesaian lama sebagai selesai untuk versi sumber baru.

Parent Workroom dikunci sebelum baris sumber. Baris sumber dikunci `FOR SHARE`
dalam urutan ID yang tetap hingga transaksi keputusan/progres selesai, sehingga
perubahan metadata database bersamaan tidak lolos dengan versi lama.

## Kegagalan dan pemulihan

- `unavailable`: tidak ada dokumen aktif yang boleh dibaca akun tersebut. Nama,
  pemilik, dan status dokumen akun lain tidak dibocorkan.
- `verification_failed`: baris boleh dibaca, tetapi byte belum tersedia, ukuran
  tidak sesuai, kunci objek salah, atau pembacaan penyimpanan gagal/timeout.
- Kegagalan query database tetap galat; bukan respons “dokumen hilang”.

Kedua keadaan sumber di atas mengunci persetujuan, analisis AI dan progres maju.
Tidak ada fallback diam-diam ke bytea lama ketika Object Storage gagal.
Pengguna masih dapat mundur, mencatat pekerjaan, memeriksa ulang sumber, atau
melepas sumber yang bermasalah dengan versi tinjauan terbaru.

Pemilih menyimpan token versi saat dibuka. Refresh di belakang layar tidak
mengubah persetujuan draft menjadi persetujuan untuk versi baru. Jika penyimpanan
konflik, tutup pemilih, tinjau ulang data, lalu pilih kembali. Tidak ada retry
otomatis untuk keputusan, pemilihan sumber, progres, atau analisis.

## Batas jaminan

Ini pemeriksaan **pada titik baca/tindakan**, bukan pengawas real-time.
Pembacaan Object Storage dibatasi 3 detik per sumber, tetapi request yang sudah
berjalan di helper penyimpanan tidak dapat dibatalkan oleh lapisan ini.

Salinan historis privat sekarang tersedia melalui
[arsip versi Workroom](workroom-source-versions.md). Arsip tersebut tidak
ditimpa oleh perubahan sumber dan ikut dihapus bersama Workroom. Penggantian
objek langsung di luar aplikasi sesudah verifikasi hanya diketahui pada
pemeriksaan berikutnya; transaksi PostgreSQL tidak mengunci penyimpanan objek.
Penulisan di luar aplikasi yang memulihkan seluruh byte dan identitas pembaruan
lama juga bukan riwayat revisi yang dapat dijamin oleh mekanisme ini.

Jalur rilis lama, widget/chat umum, worker, atau deployment di luar guard Workroom
tidak otomatis mendapat jaminan ini. Jangan mengaktifkan tindakan eksternal atas
dasar fitur ini saja: masih diperlukan kontrak eksekusi terpadu, versi berkas
immutable untuk pemakaian lintas runtime, anggaran dan idempotensi alat.

## Pemeriksaan lokal yang terisolasi

```sh
npm run check
npx tsc -p tests/workroom-gates.tsconfig.json
bash scripts/test-workroom-gates.sh
npx vitest run tests/workroom-gates.vitest.tsx tests/workroom-sources.vitest.tsx
```

Script database selalu membuat klaster PostgreSQL sementara dan tidak menggunakan
database aplikasi. Tes menjalankan rute HTTP produksi, penolakan lintas akun,
perubahan byte/ekstraksi, kehilangan akses, sumber tanpa byte, pelepasan tautan,
penyelesaian tanpa gate, dan kontensi kunci baris sumber. Object Storage/provider
AI nyata tidak dipanggil dalam tes.
