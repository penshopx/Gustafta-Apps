# Pemulihan memori lama

Baris `user_memories.user_id IS NULL` tetap terisolasi. Tidak ada backfill otomatis. `session_id`, pemilik agen (agen bisa publik/berbagi), kecocokan isi, serta pernyataan pengguna **bukan bukti kepemilikan**. Riwayat `agent_messages` juga tidak menyimpan pemilik pesan.

## Bukti yang boleh dipakai

Untuk **setiap ID memori**, cari rekaman asli dari sumber tepercaya yang dibuat saat permintaan penulisan memori *terautentikasi*. Rekaman harus secara eksplisit mengikat **ID baris memori, ID agen, dan ID pengguna terautentikasi** dalam satu peristiwa. Arsip harus sudah ada sebelum tinjauan (bukan dibuat dari klaim pemohon); catat ID arsip acak terbatas dan SHA-256 dari rekaman asli. Jangan salin isi memori, cookie, token, atau data pribadi ke rujukan atau alasan tinjauan.

## Format rujukan dan alasan (versi 1)

`evidenceRef` hanya menerima `archive:v1:<UUIDv4>` huruf kecil, tepat 47 karakter. Contoh sintaks (bukan bukti nyata): `archive:v1:65f43a20-d8b4-4a0c-9a25-ec1a1b71cc01`. ID harus diterbitkan secara acak oleh petugas arsip untuk **satu rekaman asli tetap**. Jangan memakai UUID sesi/pengguna, hash isi, nomor telepon, nama berkas, URL, path, parameter, atau teks rekaman sebagai ID. Validasi format bukan pembuktian provenance: UUID sesi yang kebetulan sesuai pola tidak menjadi bukti.

Petugas arsip yang berwenang memelihara pemetaan ID acak → lokasi rekaman asli dalam katalog arsip **di luar tabel tinjauan**, dengan kontrol akses dan audit sendiri. Peninjau membawa ID tersebut ke katalog melalui akses sah; ID bukan URL publik, token akses, ataupun izin membaca arsip. Adapter server kelak harus memakai katalog terbatas yang sama, bukan menafsirkan ID sebagai path/URL atau mengikuti lokasi kiriman operator. Penambahan alias katalog untuk arsip lama boleh dilakukan setelah verifikasi petugas; byte rekaman asli tidak boleh dibuat ulang atau diubah. Aplikasi ini tidak menyimpan isi arsip maupun pemetaan lokasi tersebut. Sumber arsip dan adapter masih belum tersedia; format ini tidak membuat persetujuan menjadi aktif.

`rationale` bukan teks bebas lagi. API dan UI hanya menerima kode berikut:

- Persetujuan: `original_record_verified`.
- Penolakan: `record_unavailable`, `record_incomplete`, `record_mismatch`, atau `legacy_reference_requires_resubmission`.

Kode harus sesuai `approve`. Tidak ada kolom catatan tambahan; request dengan field tambahan atau teks bebas ditolak tanpa memantulkan input. Pilihan kode dan pernyataan peninjau tidak menggantikan verifikasi byte asli, SHA-256, ketiga ID, atau peninjau kedua.

## Migrasi riwayat lama tanpa membuka data pribadi

Migrasi startup bersifat aditif dan idempoten: `evidence_format_version` bernilai **0 untuk seluruh baris lama**; pengajuan baru secara eksplisit menulis versi 1. Kolom `reason_code` baru menyimpan hanya kode alasan. `rationale` lama tidak dipilih oleh query antrean dan tidak ditulis oleh alur baru. `evidence_ref` versi 0 tidak dipilih sebagai rujukan dalam respons; API mengembalikan `evidenceRef: null` dan `requiresResubmission: true`. Ini berlaku juga bila teks lama kebetulan cocok dengan pola baru. Alasan teks lama selalu disembunyikan; keputusan, waktu, ID tinjauan, pengaju, dan peninjau tetap ada. Constraint database membatasi rujukan versi 1 dan kode alasan sesuai keputusan. Tidak ada konversi massal berdasarkan pola, penghapusan otomatis, atau perubahan pemilik/keputusan lama.

Langkah operasional:

1. Terapkan kode dan migrasi sebelum membuka antrean baru. Selama rilis campuran, hentikan akses peninjauan pada instance lama: versi aplikasi lama masih dapat menampilkan teks lama. Jangan menurunkan versi aplikasi yang belum menerapkan redaksi.
2. Jangan mengekspor kolom teks lama lewat API, log, tangkapan layar, atau tiket bersama. Jika diperlukan untuk pemetaan, hanya petugas arsip dengan kewenangan khusus yang memeriksa data audit lama melalui jalur terbatas yang disetujui, dengan audit akses. Wewenang superadmin di halaman ini bukan izin tambahan membuka arsip.
3. Untuk pending lama, superadmin kedua menolak dengan `legacy_reference_requires_resubmission`. Jangan mengubah baris lama ke versi 1. Petugas arsip mencari rekaman asli yang sudah ada dan memastikan provenance, lalu menerbitkan alias acak dalam katalog terbatas. Superadmin pertama mengajukan **tinjauan baru** untuk ID memori sama memakai alias itu dan SHA-256 byte asli. Dua peninjau dan seluruh verifikasi tetap berlaku.
4. Riwayat yang sudah diputuskan tidak diedit/diajukan ulang bila memori sudah dimiliki; tidak ada pencabutan atau persetujuan ulang otomatis. Jika arsip tidak ditemukan atau akses tidak sah, biarkan memori tanpa pemilik.
5. Teks audit lama tetap tersimpan, tetapi tidak dapat dibaca dari antrean. Penghapusan/redaksi permanen pada sumber audit, replika, backup, atau ekspor lama memerlukan keputusan retensi dan persetujuan pemilik data tersendiri; pekerjaan ini tidak menghapusnya. Gunakan [prosedur retensi catatan tinjauan](legacy-memory-retention.md) untuk inventaris metadata, persetujuan terpisah per tindakan, audit akses terbatas, penanganan salinan dan gerbang pemulihan. Status persetujuan prosedur tidak menjadi izin membaca, menyalin, atau menghapus arsip.

Jika arsip seperti itu tidak ada atau tidak bisa diverifikasi, **jangan ajukan persetujuan**. Biarkan baris tanpa pemilik. Rekaman percakapan atau session ID saja tidak dapat membuktikan pemilik. **Saat ini tidak ada sumber arsip terautentikasi dan tidak dapat diubah yang teridentifikasi atau dihubungkan ke aplikasi.** Karena itu, server menolak semua persetujuan; penolakan masih dapat dicatat. Pengajuan yang sudah pending pun tidak mendapatkan pengecualian.

## Kontrak pembaca arsip (belum dipasang di produksi)

`createLegacyMemoryRecovery(pool, archive)` menerima pembaca arsip **hanya dari server** melalui `TrustedCreationArchive.readOriginalRecord(evidenceRef)`. Pengguna hanya menyerahkan rujukan dan digest, **bukan** rekaman. Pembaca harus mengembalikan byte asli dari peristiwa penulisan yang sudah disimpan secara independen saat identitas pengguna diautentikasi; penyimpanan harus tidak dapat diubah, aksesnya hanya baca, dan rujukannya harus mengarah ke satu peristiwa tetap. Jangan membangun pembaca dari `user_memories`, `agent_messages`, session ID, data kiriman pengguna, atau arsip yang dapat dibuat/ditimpa setelah pengajuan. Jangan menyambungkan pembaca sebelum asal, sifat tidak dapat diubah, kontrol akses, dan keberadaan arsip lama tersebut terbukti.

`server/lib/trusted-creation-archive.ts` menyediakan adapter server-only `createTrustedCreationArchive(catalog, reader)`. Katalog terbatas memetakan alias acak ke locator internal rekaman lama; pembaca terbatas membaca **byte asli** pada locator itu. Adapter menolak alias di luar format, tidak menafsirkan alias sebagai lokasi, tidak menerima lokasi atau byte dari pemohon, dan tidak membuat arsip baru. Katalog dan pembaca konkret **belum ada**; adapter generik/fixture bukan bukti bahwa arsip historis tersedia. Jangan isi port ini dari tabel pelanggan, database tinjauan, log chat, atau session ID. Kegagalan lookup/baca dan perubahan byte membuat persetujuan gagal tertutup pada verifikasi recovery.

Sebelum memasang adapter di `server/routes.ts`, pemilik sistem/petugas arsip harus mengidentifikasi **sumber arsip kejadian asli** (bukan alias baru) dan mendokumentasikan secara terbatas: kapan dan bagaimana event ditulis dari identitas yang sudah terautentikasi; bahwa setiap rekaman sejak saat itu mengikat ID memori yang sudah dibuat, ID agen, dan ID pengguna; kontrol immutability dan riwayat retensi termasuk backup; siapa yang dapat mengubah katalog/byte; serta kredensial baca-saja dan audit akses yang terpisah dari peran superadmin aplikasi. Petugas harus memverifikasi alias menunjuk hanya ke satu rekaman tetap. Jangan menaruh nama berkas privat, kredensial, locator, atau isi event di tabel tinjauan/dokumen publik. **Belum ada sumber yang dapat dibuktikan demikian saat ini: rute tetap membuat recovery tanpa adapter, sehingga seluruh persetujuan tetap ditolak.** Bila sumber tidak ditemukan, lanjutkan karantina tanpa migrasi kepemilikan.

Format byte rekaman adalah JSON UTF-8 berisi `type: "authenticated_memory_creation"`, `memoryId` dan `agentId` sebagai angka bulat, serta `authenticatedUserId` sebagai string dari konteks autentikasi saat pembuatan. Pembaca **wajib menjamin provenance**: JSON yang kebetulan mengklaim tiga ID itu tidak membuktikan siapa yang menulisnya. Saat persetujuan, server membaca rekaman dari arsip, menghitung SHA-256 atas byte aslinya, mencocokkan digest yang diajukan, lalu membandingkan tiga ID dengan baris memori yang masih tanpa pemilik dan pengajuan yang terkunci di transaksi yang sama. Rekaman hilang, tidak lengkap, berubah, atau layanan arsip tidak tersedia membuat persetujuan gagal dan baris tetap dikarantina. Tidak ada fallback ke pernyataan dua admin. Pengaktifan di masa depan memerlukan adapter server untuk sumber yang benar-benar memenuhi kontrak ini; tidak ada arsip pelanggan yang dipakai oleh pengujian.

### Sinyal gangguan arsip untuk operator

Telemetri sudah disiapkan di batas verifikasi recovery; **ini tidak memasang adapter atau membuka persetujuan**. Setelah sumber disahkan dan adapter diinjeksikan, setiap percobaan verifikasi yang gagal menghasilkan tepat satu kenaikan penghitung sesuai sebab:

| Penghitung | Arti dan tindak lanjut |
| --- | --- |
| `lookup_missing` | Katalog tidak menemukan alias, atau pembaca mengembalikan `null` karena rekaman asli hilang. Petugas arsip memeriksa katalog dan retensi lewat jalur terbatas. |
| `access_denied` | Port katalog/pembaca melempar `CreationArchiveAccessDenied`. Periksa izin baca-saja melalui petugas berwenang; jangan memperluas izin pemohon. |
| `service_unavailable` | Pembacaan melempar error lain, termasuk gangguan jaringan. Periksa kesehatan layanan; error penyedia tidak dicatat atau ditebak dari pesannya. |
| `digest_changed` | SHA-256 byte asli tidak sama dengan digest pengajuan. Hentikan persetujuan dan minta pemeriksaan integritas/provenance, bukan mengganti digest agar lolos. |

Port konkret wajib memetakan penolakan izin yang teridentifikasi secara tepercaya menjadi `CreationArchiveAccessDenied()` tanpa pesan, stack, atau cause penyedia. `null` hanya untuk rekaman hilang, bukan untuk menyembunyikan outage/penolakan izin. Error lain tetap menolak persetujuan dan dihitung sebagai layanan tidak tersedia.

Cari penanda log peringatan `[legacy-memory-recovery] archive_failure_totals` di log server. Payload hanya empat penghitung kumulatif tersebut: tidak ada ID tinjauan/memori/agen/pengguna, alias, locator, isi, digest, token, atau error mentah. Penghitung bersifat **per proses**, dimulai dari nol setelah restart; jangan menjumlahkan snapshot kumulatif seolah setiap baris merupakan kejadian baru. Tidak ada endpoint publik. Pantau kenaikan penghitung di setiap instance; log ini adalah sinyal gangguan, bukan bukti arsip atau audit persetujuan permanen. Tidak adanya sinyal bukan bukti bahwa adapter aktif atau arsip sehat.

Mode tanpa adapter, input tidak valid, keputusan menolak, dan kegagalan validasi isi/identitas tidak diklasifikasikan sebagai empat gangguan ini. Kegagalan tetap menghasilkan konflik generik, pemilik tetap kosong, dan tinjauan tetap pending melalui rollback. Gangguan pengiriman sinyal tidak boleh membuka persetujuan. Tindak lanjut operator harus menggunakan katalog terbatas yang sah, bukan menambahkan bukti privat ke log/tiket.

## Hasil penelusuran sumber yang tersedia di proyek

**Keputusan: belum ada sumber yang layak disahkan; persetujuan tetap tertutup.** Ini hasil pemeriksaan kode, dokumentasi, dan struktur cadangan lokal, bukan pengesahan operasional atau pernyataan bahwa arsip di luar proyek pasti tidak ada.

| Kandidat | Yang dapat dibuktikan dari pemeriksaan | Mengapa belum memenuhi syarat |
| --- | --- | --- |
| Jalur penulisan memori di `server/routes.ts` dan `server/db-storage.ts` | Jalur saat ini menulis identitas pengguna pada baris aplikasi. Tidak ditemukan penulis arsip kejadian independen pada jalur tersebut. | Identitas pada baris sekarang tidak membuktikan penulis baris lama; tabel aplikasi dapat berubah dan bukan arsip kejadian asli. |
| Dump SQL lokal dari Juli 2026 | Definisi tabel memori dalam dua dump yang diperiksa memuat ID memori, ID agen, sesi, kategori, isi, dan waktu; tidak memuat ID pengguna. Pemeriksaan hanya memerlukan struktur tabel, bukan isi memori. | Tidak mengikat pengguna terautentikasi pada kejadian penulisan. Tanggal pada nama cadangan tidak membuktikan provenance, retensi, atau immutability. |
| Pembuat cadangan `server/lib/db-backup.ts` | Membuat dump database lalu mengirim salinan ZIP. | Kode pencadangan tidak membuktikan adanya event terautentikasi, penyimpanan immutable, riwayat retensi, atau akses arsip baca-saja yang terpisah. Cadangan database tidak otomatis memenuhi kontrak arsip kejadian. |
| Riwayat chat, sesi, dan metadata tinjauan | Dapat menjadi petunjuk pencarian oleh petugas berwenang, bukan bukti kepemilikan. | Tidak membuktikan ikatan tiga ID pada saat pembuatan; klaim tinjauan tidak independen dari proses tinjauan. |
| Adapter generik dan fixture pengujian | Menunjukkan kontrak lookup, pembacaan byte, dan penolakan bila bukti tidak valid. | Data sintetis dan kode adapter bukan arsip historis pelanggan dan tidak mengesahkan sumber operasional. |

Tidak ada database pelanggan yang diubah, arsip yang direkonstruksi, atau kredensial baru yang digunakan untuk pemeriksaan ini. Isi cadangan, locator privat, dan bukti pelanggan tidak disalin ke dokumentasi atau pengujian. Penyimpanan eksternal, log infrastruktur lama, hak akses aktual, dan kebijakan retensi di luar proyek **belum diverifikasi**; hanya pemilik sistem/petugas arsip berwenang yang dapat menyediakan bukti terbatasnya.

### Berkas pengesahan terbatas sebelum implementasi port

Petugas menyimpan berkas pengesahan di tempat terbatas yang disetujui, **bukan** di repository, tabel tinjauan, atau tiket bersama. Semua butir berikut wajib terbukti; kolom yang tidak diketahui berarti **belum boleh diaktifkan**:

1. **Sumber dan provenance:** sistem asal, penanggung jawab, rentang sejarah yang tersedia, serta bukti bahwa event ditulis dari konteks autentikasi yang telah diverifikasi pada saat pembuatan memori, sebelum tinjauan. Jangan merekonstruksi event dari dump, sesi, atau klaim pengguna.
2. **Ikatan identitas:** event asli memuat ID memori hasil insert, ID agen, dan ID pengguna terautentikasi dalam satu kejadian. Petugas memastikan format byte asli sesuai kontrak JSON di atas; konversi/serialisasi ulang untuk menyesuaikan format bukan byte asli.
3. **Immutability:** kontrol yang mencegah pembuatan ulang, penimpaan, dan penghapusan bukti historis oleh pemohon, peninjau, serta identitas runtime aplikasi; sertakan bukti konfigurasi dan kewenangan administrator arsip. SHA-256 saja tidak membuktikan immutability.
4. **Retensi historis:** awal pencatatan, periode retensi, kontinuitas penyimpanan, kemungkinan celah, dan kebijakan cadangan/pemulihan. Pastikan bukti untuk tiap memori memang masih tersedia; keberadaan cadangan baru tidak membuktikan pencatatan lama.
5. **Katalog:** alias acak menunjuk tepat satu rekaman tetap; kewenangan perubahan katalog dan auditnya terpisah dari proses tinjauan. Alias boleh baru, tetapi event asli harus sudah ada secara independen. Perubahan target alias tidak boleh menjadi cara mengganti bukti.
6. **Akses baca-saja:** identitas runtime hanya boleh lookup dan membaca byte sumber yang disahkan, tanpa kemampuan menulis/menghapus atau mewarisi akses peninjau. Buktikan pembatasan melalui kebijakan izin dan pemeriksaan non-destruktif di lingkungan terisolasi, bukan mencoba mengubah arsip asli. Jangan menaruh kredensial di berkas pengesahan.
7. **Pengesahan dan cakupan:** identitas petugas berwenang, waktu pengesahan, hasil setiap pemeriksaan, batas cakupan sumber, dan rujukan internal ke bukti terbatas. Pernyataan dua superadmin di halaman tinjauan tidak menggantikan berkas ini.

Hanya setelah seluruh butir disahkan: implementasikan `CreationArchiveCatalog.lookupOriginal` dan `CreationArchiveByteReader.readOriginalBytes` untuk sumber tersebut, susun dengan `createTrustedCreationArchive`, lalu injeksikan ke `createLegacyMemoryRecovery` di `server/routes.ts`. Jangan menambahkan sakelar konfigurasi yang menganggap sumber otomatis tepercaya. Gunakan fixture terisolasi untuk membuktikan lookup hilang, kegagalan baca, byte berubah, dan ketiga ID tidak cocok semuanya tetap menolak persetujuan. Pemeriksaan komposisi rute di `tests/legacy-memory-routes-http.test.ts` sengaja mempertahankan mode tanpa arsip saat ini; ubah pemeriksaan itu hanya bersama integrasi sumber yang sudah disahkan.

Jika petugas tidak dapat menemukan atau mengesahkan sumber, hasil operasional tetap **tidak tersedia**: jangan mengisi port dengan sumber pengganti dan jangan menyambungkannya ke rute. Pengajuan pending tetap tidak dapat disetujui, penolakan tetap dapat dicatat, dan kepemilikan memori lama tidak berubah.

## Alur untuk dua superadmin

Gunakan halaman **Admin → Pemulihan memori lama** (`/admin/legacy-memories`). Hanya superadmin yang dapat membuka antrean dan riwayat. Setiap daftar memuat maksimal 100 baris per halaman dan punya tombol halaman berikutnya/kembali sendiri. Halaman tidak membuka isi memori atau session ID; keputusan menyangkut **satu ID memori** saja. Jangan memakai halaman ini untuk mencari bukti: arsip asli harus diperiksa secara terpisah melalui akses yang sah. Jika tidak ada bukti yang memenuhi syarat, jangan ajukan klaim.

1. `GET /api/admin/legacy-memories?afterMemory=0&afterReview=0` menampilkan antrean metadata tanpa isi atau session ID. Masing-masing cursor dipaginasi terpisah (maksimal 100 per halaman). Tidak tersedia bagi pengguna biasa.
2. Superadmin pertama memeriksa arsip asli dan pengguna yang masih ada. Kirim `POST /api/admin/legacy-memories/reviews` dengan JSON: `memoryId`, `agentId`, `proposedUserId`, `evidenceRef`, `evidenceSha256` (64 karakter hex), `evidenceType: "authenticated_creation_record"`, dan `attestation: "Record independently links memoryId, agentId and authenticated userId"`. Ini **belum** membuka memori.
3. Superadmin **berbeda** membuka sumber arsip yang dirujuk melalui katalog terbatas dengan akses sah, menghitung ulang SHA-256, dan memastikan identitas terautentikasi serta kedua ID sesuai. Kirim `POST /api/admin/legacy-memories/reviews/:id/decision` dengan `approve: true/false` dan `rationale` berupa kode yang sesuai di atas. Untuk persetujuan, gunakan `attestation: "I independently verified the trusted original record"` hanya setelah semuanya terbukti. Server juga melakukan verifikasi sendiri melalui pembaca arsip; saat ini tanpa pembaca, persetujuan selalu ditolak. Untuk penolakan karena bukti kurang atau meragukan, gunakan `attestation: "I independently reviewed the evidence and found it insufficient"`. Penolakan tersimpan dan pengajuan bukti baru masih bisa dibuat.
4. Persetujuan dan pengaitan pemilik terjadi dalam satu transaksi. Jika baris sudah diklaim/dihapus, pemilik tidak ada, atau pengaju dan peninjau sama, transaksi gagal. Catatan keputusan tetap ada walau memori yang sudah dikaitkan kemudian dihapus oleh pemilik.

Jangan gunakan database bersama pelanggan untuk mencoba-coba alur ini. `tests/legacy-memory-recovery.test.ts` menjalankan simulasi SQL terisolasi tanpa koneksi database.