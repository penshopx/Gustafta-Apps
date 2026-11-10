# Ruang Simpan sebagai sumber data antar-aplikasi

Setiap aplikasi sektor bisa berjalan di akun Replit/deployment berbeda. Domain
atau subdomain bukan identitas aplikasi dan **tidak memberi akses otomatis**.
Ruang Simpan milik akun Gustafta adalah data resmi; aplikasi lain memakai API
server-ke-server dengan izin yang dibuat pemilik akun dari halaman Ruang Simpan.

## Kemampuan yang sudah tersedia

- Pemilik yang login dapat mengisi satu profil badan usaha resmi (nama, NIB,
  alamat) di Ruang Simpan. Perubahan memakai `revision` integer; versi lama
  mendapat `409`, bukan menimpa perubahan baru. Perubahan dicatat per revisi.
- Pemilik membuat koneksi per aplikasi, memilih izin `profile:read`,
  `profile:write`, `files:read` dan/atau `files:write`. Izin dokumen
  **tidak memilih semua berkas**: pemilik harus memilih file dan/atau folder
  secara eksplisit. File yang baru masuk atau dipindah ke folder terpilih
  ikut tercakup; file yang keluar tidak lagi tercakup. Upload hanya ke folder
  terpilih, tidak ke file yang dipilih secara individual.
  Token acak hanya tampil sekali, hash-nya saja tersimpan,
  kedaluwarsa setelah 90 hari, dapat dicabut kapan saja. Akun nonaktif
  tidak dapat menggunakan koneksinya.
- Server aplikasi yang diberi izin memanggil endpoint berikut melalui HTTPS,
  dengan `Authorization: Bearer <token>`:

  | Metode | Path | Izin |
  | --- | --- | --- |
  | GET | `/api/v1/ruang-simpan/company-profile` | `profile:read` |
  | PUT | `/api/v1/ruang-simpan/company-profile` | `profile:write` |
  | GET | `/api/v1/ruang-simpan/files` | `files:read` |
  | GET | `/api/v1/ruang-simpan/files/:id` | `files:read` |
  | GET | `/api/v1/ruang-simpan/files/:id/content` | `files:read` |
  | POST | `/api/v1/ruang-simpan/files` | `files:write` + folder terpilih |

  Contoh body PUT:
  `{"name":"PT Contoh","nib":"123456789","address":"Jakarta","revision":1}`.
  Saat profil belum ada, GET mengembalikan `revision:0` dan kolom kosong;
  saat menyimpan pertama kali kirim `revision:0`. Untuk mengubah, GET versi
  terbaru dahulu, kemudian PUT dengan revisi yang sama. `409` berarti
  harus muat ulang dan menyelesaikan konflik; jangan retry dengan versi lama.

`GET files` mengembalikan `{ "files": [...] }` (maksimum 200 dokumen terbaru),
metadata saja tanpa teks ekstraksi atau byte. `GET files/:id` mengembalikan
metadata dan `GET files/:id/content` mengembalikan byte sebagai attachment.
Dokumen yang tidak dipilih, milik orang lain, atau tidak berstatus `aktif`
memberikan 404. Tidak ada URL unduhan publik. Gunakan header Bearer yang sama
di semua panggilan; daftar pilihan diperiksa lagi pada setiap permintaan.

`POST files` menerima `multipart/form-data` dengan `file` dan `folder_id`
(UUID folder yang dipilih pemilik), opsional `description` (maksimum 500 karakter).
Jenis file mengikuti aturan unggah Ruang Simpan, maksimum 20 MB. Permintaan
melebihi kuota mengembalikan 402; hasil sukses 201 berisi metadata dengan
`kb_status: pending`. Ekstraksi/indeks AI berjalan setelah unggah. Batas
permintaan koneksi berlaku; pemilik dapat mencabut token kapan saja. Setiap
akses detail/konten dan unggah dicatat dalam audit dokumen.

Pemilik dapat mengganti pilihan pada koneksi aktif tanpa mengganti token
melalui panel, atau `PUT /api/ruang-simpan/app-connections/:id/selections`
dengan sesi pemilik dan Origin situs yang sama, body
`{"file_ids":["uuid"],"folder_ids":["uuid"]}`. Daftar kosong mencabut seluruh
akses dokumen meskipun token tetap berlaku untuk izin profil.

**Token adalah kredensial milik satu akun** dan tidak boleh ditempel di kode
frontend, URL, log, atau diberikan ke aplikasi yang tidak dipercaya.
Simpan sebagai secret pada server aplikasi yang bersangkutan. Jangan berikan
izin tulis bila aplikasi hanya membutuhkan baca. Saat token hilang atau terungkap,
gunakan **Ganti token** pada koneksi aktif; token lama tidak dapat dilihat kembali.
Panggilan browser langsung dari subdomain lain tidak didukung oleh API ini.

## Rotasi token tanpa memilih ulang dokumen

Pemilik dapat memilih **Ganti token**, membaca konfirmasi, lalu memilih
**Ganti token sekarang**. Token baru ditampilkan sekali pada panel untuk aplikasi
tersebut. Salin ke secret server aplikasi tujuan sebelum menutup tampilan token.
Tidak ada masa transisi: setelah perubahan tersimpan, permintaan baru memakai
token lama mendapat `401`. Permintaan yang sudah lolos autentikasi sebelum rotasi
tidak dibatalkan.

API pengelolaan: `POST /api/ruang-simpan/app-connections/:id/rotate-token`,
body `{"revision":1}`, memakai sesi pemilik aktif dan header `Origin` dari situs yang sama
(bukan token aplikasi). Respons `200` berisi `{ "connection": {...}, "token": "..." }`
dengan `Cache-Control: private, no-store`. Server hanya menyimpan hash token baru.
ID koneksi, nama, scope, pilihan file/folder, dan tanggal kedaluwarsa tetap sama;
rotasi **tidak memperpanjang** masa berlaku 90 hari. Koneksi milik akun lain,
atau tidak ditemukan mendapat `404`; koneksi sendiri yang sudah berubah,
dicabut, atau kedaluwarsa mendapat `409` disertai permintaan muat ulang.
ID/revision tidak valid atau revision tidak dikirim mendapat `400`, sesi tidak sah
`401/403`, dan Origin berbeda/tidak ada `403`.

Penggantian hash dilakukan dalam satu pembaruan atomik; tidak ada tahap mencabut
lalu membuat koneksi baru. Token tidak dikembalikan lewat daftar koneksi dan
tidak dapat diambil kembali setelah tampilan ditutup. Jika respons hilang setelah
server menyimpan perubahan, jangan menganggap token lama masih berlaku: muat ulang
daftar koneksi, lalu konfirmasikan rotasi lagi dengan revision terbaru untuk
memperoleh token baru. Token yang hilang tidak dapat dipulihkan. Jangan melakukan
retry otomatis, termasuk setelah `503` karena hasil commit mungkin belum diketahui.

`GET /api/ruang-simpan/app-connections`, pembuatan, dan rotasi mengembalikan
`connection.revision` integer (mulai 1 untuk koneksi baru maupun koneksi lama
yang dimigrasikan). Revision ini terpisah dari revision profil perusahaan dan
hanya mengurutkan perubahan kredensial: rotasi dan pencabutan menambahnya satu;
perubahan pilihan dokumen tidak mengubahnya. Server membandingkan revision yang
dikirim dan memperbarui hash/revision dalam satu UPDATE atomik.
Dua rotasi dengan revision sama menghasilkan tepat satu `200`; sisanya `409`,
tanpa token atau hash di respons konflik. Token pemenang tetap berlaku sampai
ada perubahan berikutnya yang memakai revision terbaru, expiry, atau penonaktifan akun.

`DELETE /api/ruang-simpan/app-connections/:id` juga wajib memakai body
`{"revision":1}` dengan sesi pemilik dan Origin sama. Balapan rotasi/pencabutan
pada revision sama hanya mengizinkan satu tindakan: jika pencabutan menang,
rotasi konflik tanpa token; jika rotasi menang, pencabutan lama konflik dan
pemilik harus memuat ulang serta mengonfirmasi pencabutan lagi. Jangan otomatis
mengulangi salah satu tindakan menggunakan revision baru.
Panel menutup konfirmasi lama dan meminta **Muat ulang daftar aplikasi**
setelah konflik atau respons rotasi/pencabutan tidak diterima.
Untuk menghentikan seluruh akses, tetap gunakan
**Cabut akses**, bukan rotasi.

## Batas kemampuan saat ini

Izin anggota tim, data badan usaha yang lebih luas (SBU/SKK/portofolio),
dan migrasi fitur internal yang masih membaca data sendiri memerlukan
integrasi tersendiri. Jangan membuat salinan baru sebagai sumber resmi; jika
aplikasi perlu cache, cache itu hanya turunan baca yang bisa kedaluwarsa.