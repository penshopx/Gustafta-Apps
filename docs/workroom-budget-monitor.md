# Pemantauan anggaran Workroom untuk pengelola

## Lokasi dan hak akses

Panel **Anggaran analisis Workroom** tersedia di **Admin → Tools**.
UI memakai izin efektif `isAdmin` dari `/api/admin/me`, bukan role pada profil.
Endpoint `GET /api/admin/workroom-analysis-budget` memakai sesi dan middleware
admin yang sama dengan fitur admin lain. Pengguna biasa tidak dapat membaca
ringkasan gabungan, termasuk bila memiliki Workroom sendiri.

Respons memakai `Cache-Control: no-store`. Membaca atau memperbarui panel hanya
menjalankan SELECT: tidak memanggil model, mengubah batas, mengakui eksekusi,
atau mengembalikan jatah. Tidak ada polling atau pengulangan otomatis saat gagal.

## Data yang ditampilkan

Untuk tanggal WIB yang dipilih berdasarkan waktu database:

- Jumlah percobaan analisis yang sudah dicadangkan, bukan jumlah hasil selesai.
- Jumlah akun yang mempunyai cadangan analisis pada hari itu.
- Total estimasi dicadangkan, sisa estimasi gabungan, dan batas gabungan.
- Batas jumlah dan estimasi per akun yang berlaku.
- Penolakan pemeriksaan batas jumlah akun, estimasi akun, dan estimasi gabungan.
- Waktu pertama/terakhir penolakan tercatat, reset berikutnya, model dan versi harga.

Semua angka tetap **estimasi konservatif aplikasi, bukan invoice provider**.
Scope hanya analisis native Workroom; bukan semua chat, Claude builder, atau
seluruh pemakaian API platform. Cadangan yang gagal, dibatalkan, atau berasal
dari Workroom yang dihapus tidak mendapat refund otomatis.

DTO tidak menyertakan identitas/hash akun, judul/isi Workroom, sumber,
prompt, key API, maupun rincian eksekusi pribadi. Panel tidak memiliki aksi
ubah batas atau mulai analisis.

## Pencatatan penolakan

Counter penolakan memakai key harian terpisah di `system_config`, tanpa tabel
baru. Format counter anggaran utama tidak diubah sehingga pembaca lama yang
memvalidasi format secara ketat tidak rusak.

Penolakan batas terjadi di transaksi reservasi yang harus rollback. Karena itu
server mencatat keputusan penolakan pada **transaksi baru sesudah rollback**,
dengan kunci lintas proses tersendiri. Permintaan bersamaan tidak kehilangan
increment, dan penulisan ini tidak mengurangi cadangan atau mengubah kuota.

Jika pencatatan tidak dapat diverifikasi/disimpan, respons menjadi 503 secara
eksplisit, bukan berpura-pura pencatatan berhasil. Model tetap tidak dipanggil.
Kegagalan membaca statistik tidak mengubah penegakan anggaran; transaksi analisis
yang diizinkan tidak bergantung pada counter penolakan.

Periode mengikuti tanggal saat **keputusan batas dibuat**, bukan tanggal ketika
telemetri akhirnya berhasil dikomit. Penolakan tepat sebelum tengah malam tetap
masuk bucket asal meskipun penulisannya selesai sesudah tengah malam WIB.

## Batas interpretasi

- Counter hanya mencakup keputusan melalui kode baru ini. Tidak ada backfill
  penolakan historis atau pencatatan dari instance lama.
- Angka nol berarti **nol tercatat**, bukan bukti tidak pernah ada penolakan
  sebelum pembaruan ini.
- Penolakan autentikasi, konflik versi/eksekusi, dan kegagalan verifikasi sumber
  tidak digabungkan dengan tiga alasan batas anggaran.
- Ini hitungan keputusan atas permintaan HTTP, bukan jumlah pengguna atau
  pekerjaan unik. Mengulang permintaan yang ditolak dapat menambah counter lagi.
- Counter bukan bukti bahwa klien menerima respons: koneksi/proses dapat mati
  setelah pencatatan dikomit tetapi sebelum respons diterima.
- Ringkasan adalah bacaan saat dimuat/disegarkan, bukan saldo yang dipesan untuk
  tindakan berikutnya. Server tetap memeriksa anggaran saat POST analisis.
- Record rusak atau kegagalan baca menghasilkan status gagal, bukan angka nol.
  UI menyembunyikan nilai lama bila penyegaran gagal; coba lagi secara manual.
- Counter harian bertahan terpisah dari penghapusan Workroom. Tidak ada
  penghapusan statistik historis otomatis pada tahap pilot ini.

## Verifikasi

Suite Workroom memakai PostgreSQL disposable dan provider tiruan, termasuk
rute produksi dan middleware admin sebenarnya dengan resolver izin fixture.
Tes mencakup pengguna biasa/anonim ditolak, admin efektif dengan profil user
diterima, total/sisa/alasan penolakan, data agregat tanpa identitas, GET tanpa
mutasi atau panggilan model, increment konkuren setelah rollback, instance
penyimpanan baru, record rusak, serta perpindahan hari.

Tes React mencakup izin efektif dan pencabutannya, data tersedia/kosong/loading,
format estimasi, refresh manual tanpa duplikasi, dan penyembunyian cache lama
ketika pembacaan gagal. Pengujian tidak menggunakan database aplikasi atau
panggilan provider berbayar.
