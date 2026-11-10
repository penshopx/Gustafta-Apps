# Workroom — Penegakan Gerbang Manusia (P0 awal)

Bagian dari [blueprint Gustafta Apps](gustafta-apps-blueprint.md).
Implementasi ini mengikat gate ke perpindahan tahap, penyelesaian Workroom, serta
versi konteks dan hasil yang ditinjau. Ini belum menerapkan seluruh kontrak tugas P0.

## Aturan yang diterapkan

- Gate berstatus selain `approved` menghalangi masuk ke tahapnya, melewati tahap
  tersebut, atau meninggalkannya ke tahap yang lebih lanjut. Melompat beberapa
  tahap tidak melewati pemeriksaan.
- Gate tanpa `stageKey` berlaku untuk semua perpindahan maju. Gate lama dengan key
  yang tidak dikenal juga memblokir, bukan diabaikan diam-diam.
- Menyatakan Workroom `done` memerlukan semua gate disetujui. Workroom tanpa gate
  tetap mengikuti alur lama; implementasi ini tidak membuat gate wajib otomatis.
- Kembali ke tahap sebelumnya atau tetap di tahap saat ini boleh untuk perbaikan.
  Mengarsipkan bukan menyetujui/menyelesaikan pekerjaan dan tidak membuka izin
  melompati tahap dalam permintaan yang sama.
- Indeks tahap yang salah dan status di luar `active`, `done`, `archived` ditolak
  dengan HTTP 400, bukan dibulatkan atau diklem.
- Pembuatan gate memvalidasi key tahap dan selalu menghasilkan status `pending`.
  Gate baru pada Workroom `done` mengembalikannya menjadi `active`.
- Pemilik dapat memilih **Tinjau ulang** pada gate yang telah diputuskan.
  Gate kembali `pending`, waktu keputusan dikosongkan, dan progres berikutnya
  terkunci. Workroom `done` kembali `active` bila persetujuan dibuka/ditolak.
- Pelanggaran gate melalui API langsung menghasilkan HTTP 409. UI memakai aturan
  yang sama untuk menonaktifkan tombol tahap dan menampilkan galat server.

## Konsistensi dan audit

Perubahan progres, pembuatan gate, keputusan gate, dan penghapusan Workroom
mengunci baris parent Workroom dalam transaksi PostgreSQL. Pemeriksaan gate dan
penulisan progres memakai koneksi transaksi yang sama serta kondisi terbaru.

Keputusan gate dan log keputusan disimpan atomik, termasuk identitas pemilik
yang meneruskan keputusan melalui route. Kegagalan log membatalkan perubahan gate.
Pemeriksaan kepemilikan pada route tetap berlaku; implementasi ini tidak
memberikan hak baru kepada agen atau runtime eksternal.

## Persetujuan terikat versi

Detail Workroom dibaca sebagai satu snapshot terkunci, termasuk `reviewRevision`
(integer) dan `reviewFingerprint` (identitas isi). Revisi menggunakan ID terbesar
catatan material (`change` atau `deliverable`), dengan awal 0; tidak diperlukan
kolom atau migrasi baru. Fingerprint mencakup judul, domain, konteks, definisi
tahap (bukan progresnya), serta isi dan metadata hasil.

Keputusan gate harus mengirim `expectedReviewRevision` dan
`expectedReviewFingerprint` dari snapshot yang dilihat. UI menangkap nilai ketika
tombol diklik, bukan menggantinya dengan versi baru secara diam-diam. Kedua nilai
diperiksa kembali setelah mendapat kunci parent. Versi hilang atau basi menghasilkan
HTTP 409 tanpa mengubah keputusan atau mencatat keberhasilan.

Perubahan nyata pada judul/konteks dan penambahan catatan `change`/`deliverable`
secara atomik membuat revisi material baru serta mengembalikan semua gate ke
`pending`. Workroom yang `done` kembali `active`. Catatan biasa tidak membatalkan
persetujuan; perubahan urutan key JSON saja juga tidak dianggap perubahan isi.
Permintaan yang sekaligus mengubah isi dan menyelesaikan pekerjaan tidak boleh
memakai persetujuan sebelum perubahan.

Revisi integer mencegah pemakaian ulang persetujuan setelah isi berubah A→B→A,
meskipun fingerprint kembali sama. Fingerprint mendeteksi perubahan isi lama
yang tidak menulis jurnal revisi. Jurnal material harus dipertahankan append-only:
jangan memangkas/menghapusnya tanpa terlebih dahulu memigrasikan jangkar revisi.

Approval lama tanpa catatan keputusan server yang terikat versi dianggap perlu
ditinjau ulang pada snapshot dan pemeriksaan progres. Catatan jurnal biasa tidak
dapat memalsukan marker keputusan server. Catatan keputusan menyimpan aktor,
revisi, dan fingerprint, bukan salinan seluruh konteks privat.

Analisis AI memakai snapshot sebelum memanggil model dan memeriksa lagi sebelum
menyimpan hasil. Hasil dari snapshot lama ditolak, bukan ditempelkan ke konteks
yang sudah berubah. Konflik tidak memicu pengulangan keputusan/analisis secara
otomatis; UI membaca ulang data dan meminta tindakan eksplisit pengguna.

## Verifikasi

```sh
npm run check
npx tsc -p tests/workroom-gates.tsconfig.json
bash scripts/test-workroom-gates.sh
npx vitest run tests/workroom-gates.vitest.tsx
npx tsx --test tests/agent-authz-guard.test.ts
```

Script database selalu membuat cluster PostgreSQL lokal sementara dan marker
isolasi. Fixture memeriksa identitas/marker sebelum mengimpor modul database
aplikasi. Database tetap hidup sampai cleanup selesai. Tidak diperlukan data,
akun, atau provider AI nyata.

Tes mencakup kebijakan tahap, route HTTP produksi dengan identitas sintetis,
kepemilikan, tidak berubahnya progres saat ditolak, tinjau ulang, rollback audit,
dan bukti kontensi kunci PostgreSQL melalui `pg_blocking_pids`.
Tes komponen mencakup tombol terkunci, persetujuan, tinjau ulang, perpindahan tahap,
serta galat server tanpa perubahan progres optimistis. Pengujian versi mencakup
tab lama, perubahan konteks/hasil, ABA, approval historis tanpa versi, pemalsuan
jurnal keputusan, hasil AI terlambat, serta pemeriksaan revisi setelah kontensi
kunci PostgreSQL. Tidak ada pemanggilan provider AI nyata dalam pengujian tersebut.

## Batas yang masih terbuka

Binding versi berlaku untuk konteks dan hasil yang tersimpan di Workroom.
Dokumen yang dipilih eksplisit melalui panel Sumber Ruang Simpan juga diikat ke
fingerprint tinjauan. Perubahan sumber mengubah identitas tinjauan, tanpa harus
menambah baris revisi material Workroom. Lihat [sumber Workroom](workroom-sources.md)
untuk akses owner-only, hashing byte, kegagalan verifikasi dan batas jaminannya.
Dokumen yang hanya disebut lewat teks/URL, atau sumber lain yang belum ditautkan,
tetap di luar pengikatan ini.

Jalur aplikasi lama saat rilis campuran tidak dijamin mematuhi kontrol baru.
Indikator ringkasan/list lama juga bukan sertifikat persetujuan; pemeriksaan
tindakan harus memakai snapshot dan guard versi terbaru, bukan status gate mentah.

Belum ada kontrak eksekusi terpadu, anggaran tugas, pembatalan worker, atau
idempotensi alat. Gate ini membatasi progres Workroom, **bukan bukti bahwa semua
tindakan AI di seluruh aplikasi sudah memeriksa gate**. Provider harian dan
integrasi OpenClaw/Hermes tidak diubah. Tidak ada migrasi skema yang diperlukan.
