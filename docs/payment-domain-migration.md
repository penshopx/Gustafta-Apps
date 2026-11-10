# Migrasi domain checkout

Ubah `PAYMENT_BASE_URL` (server) dan `VITE_PAYMENT_BASE_URL` (klien) ke origin HTTPS baru, lalu terapkan/restart aplikasi. URL lama yang sudah tersimpan **tidak berubah otomatis**: database ini dapat langsung memengaruhi katalog yang sedang dipakai pembeli.

## Melalui halaman admin

Buka **Admin → Tools → Migrasi domain checkout**. Masukkan origin domain lama lengkap dengan `https://` (tanpa path, query, atau fragmen), lalu buat pratinjau. Domain tujuan diambil dari konfigurasi server, bukan diketik di formulir.

Tinjau seluruh baris: sumber tabel, ID, URL lama, dan URL tujuan. Jumlah tautan yang dilewati mencakup domain lain serta URL tidak valid; tautan tersebut tidak diubah. Cocokkan domain tujuan dengan konfigurasi klien. Jika tautan manual memakai domain lama, periksa satu per satu sebelum menyetujui.

Untuk menerapkan, ketik **MIGRASI TAUTAN PEMBAYARAN** persis dan klik tombol penerapan. Persetujuan hanya berlaku untuk daftar yang baru ditinjau. Mengubah input atau membuat pratinjau lagi membatalkan persetujuan sebelumnya. Perubahan langsung memengaruhi tautan katalog; pembayaran dan order historis tidak dipindahkan.

Jika data berubah selama peninjauan (409), daftar lama dan persetujuannya dibuang. Buat pratinjau baru, tinjau ulang, lalu konfirmasi kembali. Jika penerapan gagal atau responsnya tidak pasti, buat pratinjau baru sebelum mencoba lagi. Setelah berhasil, ulangi pratinjau untuk memastikan tidak ada perubahan tersisa, lalu periksa katalog dan landing produk.

Formulir hanya tersedia bagi pengguna dengan izin admin efektif dari server; kedua endpoint tetap memeriksa login dan izin admin.

## Melalui API

Admin yang sudah login juga dapat melakukan pemeriksaan dengan:

1. `POST /api/admin/payment-links/preview` dengan JSON `{"oldOrigin":"https://domain-lama.example"}`. Respons menampilkan domain tujuan dari konfigurasi server, seluruh perubahan yang diusulkan (`table`, `id`, `from`, `to`), jumlah, tautan yang diabaikan, dan `fingerprint`. Tinjau semua URL dan cocokkan domain tujuan dengan konfigurasi klien.
2. Setelah admin menyetujui daftar tersebut, `POST /api/admin/payment-links/apply` dengan JSON `{"oldOrigin":"https://domain-lama.example","fingerprint":"<nilai dari preview>","confirmation":"MIGRASI TAUTAN PEMBAYARAN"}`. Status 409 berarti tautan yang cocok telah berubah; ambil pratinjau baru dan tinjau ulang. Tidak ada perubahan sebagian bila terjadi kegagalan.
3. Ulangi preview untuk memastikan jumlah perubahan menjadi nol. Periksa tampilan katalog dan landing produk.

Hanya URL HTTPS dengan **origin persis sama** dengan `oldOrigin` di `store_products.payment_url` dan `agents.payment_url` yang diganti; path, query dan fragmen tetap. Link manual pihak lain tetap utuh. Bila link manual justru memakai domain lama, jangan setujui sebelum diperiksa satu per satu. Endpoint ini tidak memindahkan pembayaran/order historis.