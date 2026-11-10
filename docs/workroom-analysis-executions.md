# Identitas analisis Workroom yang tersimpan

Tahap ini memperkuat [pengamanan analisis native](workroom-analysis-safety.md).
Tidak mengaktifkan OpenClaw/Hermes, alat eksternal, atau antrean worker otomatis.
[Batas estimasi harian](workroom-analysis-budget.md) kini melengkapi reservasi eksekusi.

## Kontrak permintaan

`POST /api/workrooms/:id/analyze` wajib membawa header `Idempotency-Key` berupa
UUID, selain pasangan revisi/fingerprint pada body seperti sebelumnya.
Browser membuat satu UUID per tindakan analisis. Key bukan kredensial; semua
akses tetap memeriksa sesi dan pemilik Workroom.

Permintaan ulang dengan **key dan tinjauan asal yang sama**:

- Jika sudah berhasil, mengembalikan deliverable yang sama dengan `replayed:true`.
  Tidak memanggil model dan tidak menulis deliverable/keputusan baru.
- Jika masih berjalan atau sudah berakhir tanpa hasil, ditolak dengan 409.
  Key yang sama tidak digunakan ulang untuk percobaan lain.
- Jika token tinjauan tidak sama, ditolak dengan 409.

Replay adalah pembacaan hasil historis, bukan analisis ulang atas konteks terbaru.
Ia dapat mengembalikan hasil lama setelah konteks berubah atau Workroom selesai,
tetapi tidak mengganti data terkini. Workroom yang hilang, tidak dimiliki akun,
atau sedang dihapus tetap tidak dapat direplay.

## Penyimpanan dan konkurensi

Sebelum memanggil model, server mengunci parent, memeriksa ulang versi/tahap/
status/sumber, dan **meng-commit reservasi** pada jurnal internal. Tidak ada
migrasi tabel baru; metadata tidak berisi prompt, isi berkas, respons mentah,
key API atau token akses.

Reservasi satu Workroom/pemilik diserialisasi di PostgreSQL, bukan Map proses:

- Key ganda tidak memulai model lagi.
- Key berbeda juga ditahan selama ada eksekusi `running` atau `uncertain`.
- Deliverable, pembatalan persetujuan lama, dan status eksekusi `succeeded`
  disimpan dalam transaksi yang sama.
- Jika respons hilang sesudah commit, status berhasil tidak ditimpa oleh handler
  kegagalan. Mengirim ulang key awal membaca hasil yang sudah tersimpan.
- Penulisan hasil wajib mempunyai reservasi aktif, belum kedaluwarsa, untuk
  aktor/tahap/tinjauan yang sama. Worker lama tidak bisa menulis setelah
  ketidakpastian diakui.

Ini mencegah pemanggilan ulang pada lapisan aplikasi untuk key yang masih
tersimpan. Bukan jaminan exactly-once tagihan di dalam provider atau proxy.
Key dicakup oleh Workroom; tindakan baru pada Workroom lain adalah pekerjaan lain.

## Status

| Status | Arti |
|---|---|
| `running` | Reservasi sudah tersimpan; panggilan mungkin sedang berlangsung |
| `succeeded` | Deliverable dan status berhasil sudah dikomit bersama |
| `failed` | Tidak ada hasil berhasil; provider sudah mengembalikan respons atau panggilan belum dimulai |
| `uncertain` | Hasil pemanggilan/penyimpanan belum dapat dipastikan; tidak aman diulang otomatis |
| `acknowledged` | Pemilik mengakui ketidakpastian, bukan membuktikan provider batal |

Kesalahan format atau penolakan tulis sesudah model selesai dapat menjadi
`failed`. Error koneksi/provider, pembatalan saat panggilan berjalan, dan batas
waktu diperlakukan konservatif sebagai `uncertain`.
Jika penyimpanan status gagal, reservasi awal tidak dihapus atau dianggap sukses.

Masa berlaku reservasi adalah **dua menit**. Setelah lewat, status bacaan menjadi
`uncertain` meskipun proses mati sebelum dapat menulis status akhir. Lewatnya
masa berlaku **tidak** memulai worker pengganti atau memanggil model ulang.
Worker lama yang hidup kembali ditolak saat mencoba menyimpan.

## Memeriksa dan mengakui ketidakpastian

Detail Workroom menampilkan **Riwayat eksekusi AI** dari data server:

1. Tekan **Periksa status** untuk memuat ulang hasil/status, termasuk setelah
   koneksi pulih atau aplikasi restart. Tidak ada POST model otomatis.
2. Selama berjalan atau perlu tinjauan, analisis baru dikunci.
3. Untuk status perlu tinjauan, buka **Tinjau ketidakpastian**.
4. Baca peringatan bahwa panggilan lama mungkin sudah diproses/ditagihkan,
   periksa deliverable, lalu pilih **Saya memahami risikonya** bila sesuai.

Endpoint pengakuan:

```
POST /api/workrooms/:id/analysis-executions/:executionId/acknowledge
Content-Type: application/json

{"acknowledgeUncertain": true}
```

Konfirmasi boolean wajib di server. Endpoint memeriksa pemilik serta status
aktual di bawah kunci parent. Reservasi yang masih aktif tidak bisa dilepas
lebih awal. Pengakuan hanya membuka kesempatan memulai **analisis baru secara
manual dengan UUID baru**; ia tidak memanggil model, menyetujui gate, mengubah
konteks, membatalkan biaya, atau menandai eksekusi lama berhasil.

## Batas operasional

- Pembatalan tetap best-effort. Provider dapat terus bekerja setelah HTTP putus.
  Mengakui ketidakpastian lalu memulai pekerjaan baru dapat menimbulkan biaya
  tambahan jika panggilan lama sudah berjalan.
- Tidak ada retry/fallback provider otomatis atau pemulihan otomatis pekerjaan.
- Ada kuota jumlah dan cadangan estimasi harian untuk pilot ini, bukan penghitung
  invoice provider atau jaminan refund. UUID sendiri bukan pengganti penganggaran.
- Jurnal eksekusi mengikuti lifecycle Workroom dan dihapus bersama parent.
  Replay setelah Workroom dihapus tidak tersedia. Counter anggaran terpisah
  tetap bertahan; menghapus parent tidak mengembalikan jatah.
- Riwayat hanya untuk pemilik; DTO tidak memuat pemilik lain atau metadata
  jurnal internal. Pengalihan pemilik tidak memberikan hak worker lama untuk
  menyimpan hasil.
- Catatan eksekusi yang rusak mengunci jalur analisis, bukan dilewati seolah
  reservasi tidak pernah ada. Penanganan metadata rusak memerlukan pengelola.

## Verifikasi

Suite Workroom yang sama memakai PostgreSQL disposable dan model tiruan.
Rute produksi diuji untuk replay, token salah, request paralel satu/beda key,
status setelah instance penyimpanan baru, reservasi kedaluwarsa tanpa retry,
pengakuan terautentikasi, penolakan hasil worker lama, rollback, dan kehilangan
respons sesudah commit. Tes React mencakup lock saat reload, peringatan biaya,
konfirmasi eksplisit, serta tidak adanya POST model saat mengakui ketidakpastian.
