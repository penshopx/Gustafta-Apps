# Arsip versi sumber Workroom

## Kebijakan yang dipilih pengelola

**Arsip versi ikut dihapus bersama Workroom.** Dokumen asli di Ruang Simpan tidak
ikut dihapus. Sebaliknya, mengubah, melepas, atau menghapus dokumen asli tidak
mengubah salinan historis yang sudah tersimpan dalam Workroom.

Salinan tetap privat bagi pemilik Workroom. Admin, pengguna lain, aplikasi
eksternal dan pihak yang hanya mengetahui ID versi tidak mendapat akses baru.
Tidak dibuat URL publik atau tautan bertanda tangan.

## Cara menggunakan

Pada detail Workroom:

1. Pilih sumber melalui panel Sumber Ruang Simpan.
2. Tekan **Simpan versi untuk tinjauan ini**, atau lakukan persetujuan baru atas
   gate yang mempunyai sumber. Persetujuan tersebut menyimpan versi dahulu.
   Penyelesaian Workroom dengan sumber juga menyimpan versi.
3. Buka **Riwayat versi**, kemudian unduh salinan historis yang dipilih.

Penyimpanan versi tidak sama dengan persetujuan. Jika persetujuan kemudian gagal,
salinan dapat tetap ada, tetapi tidak dicatat sebagai keputusan berhasil.
Keputusan dan penyelesaian baru mencatat ID versi yang dipakainya.
Versi lama sebelum fitur ini tidak dapat dibuat ulang dari berkas terbaru.

Riwayat tetap dapat dibuka setelah sumber dilepas atau hilang, selama Workroom
masih dimiliki akun tersebut dan belum dalam proses penghapusan.

## Integritas dan konsistensi

- Byte disimpan di App Storage; database hanya menyimpan manifest dan jejak proses.
- Setiap percobaan baru mendapat ID dan kunci objek acak baru. Tidak tersedia API
  untuk memperbarui byte atau mengganti manifest versi yang sudah siap.
- Snapshot mengikat salinan ke revisi dan fingerprint tinjauan. Sumber dibaca
  dengan filter pemilik dan diverifikasi sebelum merekam niat penyimpanan.
- Niat penyimpanan beserta seluruh kunci objek **di-commit sebelum unggahan**.
  Kegagalan atau proses mati tidak menghilangkan jejak objek yang mungkin terunggah.
- Sebelum menyalin, versi tinjauan diperiksa lagi di bawah kunci parent. Baris
  sumber database tetap share-locked selama proses finalisasi.
- Setiap salinan dibaca kembali dan diperiksa ukuran serta SHA-256 sebelum
  statusnya menjadi siap. Hanya versi siap yang dapat diunduh.
- Permintaan ulang untuk tinjauan yang sudah mempunyai versi siap memakai versi
  itu, bukan menulis ulang objeknya.
- Unduhan historis kembali memeriksa ukuran dan SHA-256. Kegagalan baca atau
  ketidakcocokan menolak unduhan; tidak pernah memakai sumber terbaru sebagai
  pengganti.
- Manifest internal dan kunci objek tidak keluar lewat jurnal/detail/riwayat.
  Jurnal biasa tidak dapat menciptakan catatan internal arsip.

Ini **write-once pada lapisan aplikasi**, bukan janji fitur WORM/Object Lock dari
provider penyimpanan. Pengelola yang mengubah database dan objek secara langsung
berada di luar batas jaminan. Perubahan objek tanpa perubahan manifest terdeteksi
saat verifikasi berikutnya.

## Penghapusan bersama Workroom

UI meminta konfirmasi penghapusan Workroom dan seluruh arsipnya.

1. Untuk Workroom dengan arsip, status penghapusan dicatat dahulu secara durable.
   Sejak itu akses arsip serta perubahan Workroom dikunci.
2. Semua kunci versi siap, gagal, dan percobaan terputus dibersihkan.
3. Parent dan jurnal Workroom baru dihapus setelah penghapusan objek berhasil.
4. Jika suatu penghapusan gagal, API tidak mengaku berhasil. Workroom tetap
   menampilkan penghapusan tertunda; pengguna dapat mengulangi penghapusan.
   Objek yang sudah terhapus aman dilewati pada percobaan berikutnya.

Niat penyimpanan yang masih `preparing` dan berumur kurang dari tiga menit
mencegah penghapusan untuk menghindari balapan dengan unggahan yang baru dimulai.
Jika proses penyimpanan mati, tunggu tiga menit lalu ulangi penghapusan.
Tidak ada worker pembersihan otomatis atau retry unggahan yang menimpa kunci lama.

Setelah berhasil, hanya tanda terima teknis berisi kunci acak dan waktu
penghapusan yang dipertahankan untuk penelusuran. Tidak ada byte, nama berkas,
konteks, atau metadata dokumen dalam tanda terima ini. Ia bukan arsip yang dapat
dibuka pengguna. Penghapusan tidak menjamin penghapusan backup internal provider
atau salinan yang sudah diunduh ke perangkat.

## Biaya dan batas cakupan

Salinan memakai penyimpanan tambahan. Fitur ini tidak mengubah paket/harga
Ruang Simpan atau mengimplementasikan kuota lintas arsip. Batas sumber per
Workroom tetap maksimal lima dokumen dengan total 20 MB pada satu tinjauan.

Isi dokumen belum otomatis dikirim ke model AI. Arsip bukan izin untuk melakukan
tindakan eksternal, dan kontrak worker/alat lintas runtime belum diaktifkan.

## Verifikasi lokal

```sh
npm run check
npx tsc -p tests/workroom-gates.tsconfig.json
bash scripts/test-workroom-gates.sh
npx vitest run tests/workroom-gates.vitest.tsx tests/workroom-sources.vitest.tsx tests/workroom-versions.vitest.tsx
```

Tes memakai PostgreSQL disposable dan adapter blob tiruan. Rute produksi diuji
untuk kepemilikan, idempotensi, byte historis, integritas rusak, kegagalan baca,
unggahan ambigu, proses terputus, penghapusan parsial dan retry. Tidak ada
unggahan, penghapusan dokumen pengguna, migrasi skema, atau pemanggilan AI nyata.
