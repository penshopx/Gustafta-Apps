# Batas harian pilot analisis Workroom

## Kebijakan yang disetujui

Hanya berlaku untuk `POST /api/workrooms/:id/analyze` pada implementasi baru:

| Batas | Nilai |
|---|---|
| Jumlah per akun, gabungan semua Workroom miliknya | 10 analisis/hari |
| Estimasi dicadangkan per akun | USD 1/hari |
| Estimasi dicadangkan gabungan seluruh akun | USD 10/hari |
| Periode | Tanggal WIB, reset pukul 00.00 Asia/Jakarta |

Tidak mengubah jatah chat, hak paket/langganan, builder prompt Claude, atau
pemakaian AI pada endpoint lain. Batas gabungan ini **bukan** batas seluruh
tagihan API aplikasi.

## Arti estimasi

Ini anggaran konservatif aplikasi, bukan invoice atau pengukuran token aktual.
Untuk model Workroom yang sudah ada, `gpt-4o`, acuan harga teks standar adalah
USD 2,50/juta token input dan USD 10/juta token output:
https://developers.openai.com/api/docs/models/gpt-4o

Acuan diperiksa 2026-10-28. Dokumentasi menandai model deprecated; tahap ini
tidak mengganti model otomatis. Penggantian model harus disertai konfigurasi
harga yang sesuai; model yang tidak cocok dengan acuan harga ditolak.

Reservasi dihitung dari jumlah byte UTF-8 dua pesan teks, tambahan 1.024 token
untuk framing, dan seluruh batas output 1.500 token. Pendekatan byte sengaja
lebih konservatif daripada perkiraan karakter/4, termasuk untuk Unicode.
Diskon cache tidak diasumsikan. Aritmetika penyimpanan memakai integer micro-USD
(USD 1 = 1.000.000 micro-USD), dengan pembulatan ke atas.

Karena biaya tiap konteks berbeda, batas USD dapat tercapai **sebelum**
10 analisis. Harga provider/proxy dapat berubah; estimasi ini bukan jaminan
batas invoice, termasuk biaya tambahan di luar tarif teks standar.

## Reservasi sebelum model

Server memeriksa pemilik, identitas eksekusi, sumber, tinjauan, status, dan tahap
seperti sebelumnya. Sesudah itu:

1. Mengunci parent Workroom.
2. Mengambil kunci anggaran bersama lintas proses/akun.
3. Mengambil waktu database setelah mendapatkan kunci, lalu menentukan tanggal WIB.
4. Membaca dan memvalidasi counter tanggal tersebut.
5. Memeriksa batas jumlah akun serta kecukupan estimasi akun dan gabungan untuk
   **permintaan ini**, bukan sekadar mengecek apakah masih ada saldo positif.
6. Menyimpan counter dan intent eksekusi dalam **transaksi yang sama**.
7. Baru setelah commit, mengizinkan panggilan model.

Ketidakcukupan mengembalikan 429 sebelum provider dipanggil. Permintaan paralel
pada Workroom berbeda juga memakai kunci anggaran bersama; keduanya tidak
dapat mengambil sisa saldo yang sama. Tidak ada fallback ke counter in-memory.

Replay hasil berhasil tidak mencadangkan ulang. Request yang ditolak sebelum
reservasi berhasil tidak memakai jatah. Jika transaksi intent gagal, counter
ikut rollback; tidak ada reservasi terpisah yang ditinggalkan.

## Tidak ada refund otomatis

Semua intent yang sudah dikomit tetap memakai satu jatah serta estimasi penuhnya,
termasuk kegagalan format/penyimpanan hasil, pembatalan, timeout, dan provider
error. Ini juga berlaku bila server berhenti sebelum sempat memastikan panggilan.
Tidak ada pengembalian otomatis berdasarkan jumlah token output yang lebih kecil.

Mengakui ketidakpastian hanya membuka izin untuk tindakan manual berikutnya:
tidak mengurangi counter, tidak mengubah bucket asal, dan bukan bukti biaya batal.
Bucket dipilih saat reservasi, sehingga penyelesaian/acknowledgment sesudah
tengah malam tidak memindahkan atau menghapus pemakaian hari sebelumnya.

## Penyimpanan dan lifecycle

Counter agregat menggunakan key harian khusus pada `system_config` yang sudah
ada, terpisah dari jurnal parent. Nilai diserialisasi sebagai JSON dalam kolom
teks; tidak diperlukan tabel atau migrasi baru.

- Berisi total, counter akun dengan identitas hash, dan tanggal; bukan isi
  dokumen, prompt, key, atau respons provider.
- Jurnal eksekusi menyimpan tanggal/cadangan/versi harga untuk referensi.
- Counter **tidak dihapus bersama Workroom**. Membuat Workroom baru atau
  instance penyimpanan baru tidak mengembalikan jatah akun.
- Hari baru memakai bucket baru tanpa cron reset. Bucket lama tetap tersimpan;
  tidak ada penghapusan otomatis counter historis pada tahap ini.
- Total harus cocok dengan jumlah counter akun. JSON/tanggal/nilai tidak valid
  atau kegagalan baca/tulis mengunci panggilan model dengan 503.

Ini berbeda dari snapshot statistik best-effort. Counter penegakan wajib dibaca
dan ditulis langsung di database dalam transaksi, bukan dimuat sekali ke Map
lalu dipersist secara fire-and-forget.

## API dan UI

Pengelola dapat membaca ringkasan gabungan dan penolakan melalui
**Admin → Tools → Anggaran analisis Workroom**. Lihat
[pemantauan pengelola](workroom-budget-monitor.md) untuk batas cakupan statistik.

`GET /api/workrooms/:id/analysis-budget` memerlukan sesi serta kepemilikan
Workroom. Respons memakai `Cache-Control: no-store`.

DTO hanya menampilkan pemakaian akun sendiri, batas, tanggal/reset berikutnya,
dan alasan ketersediaan. Tidak memuat daftar identitas/counter akun lain atau
angka pemakaian gabungan yang rinci.

Di Detail Workroom, **Batas harian analisis AI** menampilkan jumlah dan estimasi
dicadangkan. Batas tercapai atau status batas gagal dibaca mengunci tombol model;
meninjau data, jurnal, dan gerbang manusia tetap tersedia. Tombol **Periksa batas**
hanya memuat ulang data, tidak memanggil model.

Ketersediaan di UI adalah informasi terakhir yang dibaca, bukan reservasi saldo.
Server tetap memeriksa kebutuhan aktual di bawah kunci saat POST, termasuk jika
akun lain menghabiskan anggaran gabungan sesudah tampilan dimuat.

## Batas rollout

Hanya reservasi baru melalui kode ini yang tercatat. Tidak ada backfill biaya
historis. Proses lama yang belum memuat kebijakan ini dan endpoint/provider lain
tidak dilindungi oleh penegakan pilot ini. Deployment dan perubahan hak akses
tidak dilakukan pada pekerjaan ini.

## Bukti pengujian

Suite memakai PostgreSQL disposable dan provider tiruan. Pengujian meliputi:
10 panggilan lalu penolakan, replay tanpa konsumsi tambahan, cadangan yang tetap
dihitung saat gagal/acknowledgment, penghapusan parent, instance baru, saldo akun,
dua akun yang benar-benar menunggu kunci database untuk satu slot gabungan,
rollback intent, kegagalan tulis counter, serta counter rusak.

Tes murni mencakup batas tengah malam WIB, pergantian tahun, Unicode, dan
perhitungan cadangan. Tes React mencakup tiga alasan batas, status gagal baca
meski cache lama masih menyatakan tersedia, tombol model terkunci, dan
peninjauan manusia yang tetap dapat digunakan. Tidak memakai API berbayar
atau database aplikasi untuk pengujian ini.
