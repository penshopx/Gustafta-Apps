---
name: Workroom execution boundaries
description: Why cancellation and one-result optimistic writes must not be described as durable execution or cost idempotency.
---

Pembatalan HTTP dan penolakan hasil lama bukan pembatalan pekerjaan durable
atau jaminan tidak ada tagihan provider ganda.

**Why:** Tanpa reservasi durable, dua permintaan paralel dapat sama-sama menghubungi model, meskipun
optimistic concurrency hanya mengizinkan satu hasil disimpan. Provider juga
bisa tetap memproses permintaan setelah koneksi putus, dan commit dapat selesai
sebelum pembatalan diketahui.

**How to apply:** Setelah pembatalan/koneksi hilang, baca kembali riwayat sebelum
menawarkan retry. Jangan menyatakan hasil pasti tidak tersimpan atau biaya sudah
dibatalkan. Sebelum memperluas ke tindakan berdampak, gunakan identitas tugas
durable, klaim yang terserialisasi, dan kebijakan anggaran tersendiri; sinyal
proses lokal dan batas satu panggilan bukan penggantinya.

Untuk panggilan AI tanpa idempotensi provider, reservasi kedaluwarsa bukan izin
untuk mencoba lagi otomatis. Pertahankan ketidakpastiannya sampai pemilik
memeriksa hasil dan mengakui risiko panggilan sebelumnya.

**Why:** Proses dapat mati setelah provider menerima permintaan atau setelah
commit berhasil tetapi sebelum respons diterima. Memulihkan status tidak sama
dengan membuktikan panggilan belum pernah diproses.

**How to apply:** Simpan klaim sebelum panggilan, simpan hasil dan sukses secara
atomik, dan replay hasil berdasarkan identitas asal. Jangan mengubah expiry
menjadi retry berbayar otomatis. Pengakuan risiko harus eksplisit dan tidak boleh
disamakan dengan persetujuan bisnis atau jaminan pembatalan biaya.

Counter anggaran harus mempunyai lifecycle terpisah dari jurnal Workroom.
Cadangan estimasi bukan invoice aktual dan tidak mendapat refund otomatis
karena gagal, dibatalkan, diakui ketidakpastiannya, atau parent dihapus.

**Why:** Arsip/jurnal memang mengikuti penghapusan Workroom, tetapi menerapkan
aturan itu pada counter memungkinkan pengguna menghapus parent lalu mendapat
jatah baru. Ketidakpastian provider juga tidak membuktikan panggilan gratis.

**How to apply:** Pertahankan counter agregat lintas Workroom/restart, dan
commit anggaran bersama intent sebelum model dipanggil. Kebijakan pilot ini
hanya untuk analisis native Workroom; jangan mengubah hak chat/paket atau
menyebutnya batas seluruh tagihan API platform.

Pisahkan counter observasi penolakan dari format counter anggaran yang
menegakkan pemakaian. Catat penolakan sesudah transaksi reservasi rollback,
tanpa mengubah saldo atau menganggap counter sebagai bukti tagihan.

**Why:** Penulisan di transaksi yang ditolak ikut hilang saat rollback.
Menambahkan field ke format anggaran yang divalidasi ketat juga dapat memutus
instance lama yang masih berjalan saat rollout campuran.

**How to apply:** Gunakan transaksi tersendiri untuk statistik penolakan dan
labeli sebagai keputusan permintaan yang tercatat sejak pembaruan, bukan
riwayat lengkap atau jumlah pekerjaan unik. Kegagalan baca bukan nol; tampilan
admin wajib menyembunyikan statistik lama bila refresh gagal.
