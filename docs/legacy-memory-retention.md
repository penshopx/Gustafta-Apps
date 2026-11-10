# Retensi catatan tinjauan memori lama

## Status dan batas kewenangan

**Status: prosedur disetujui oleh pemilik yang menyatakan berwenang.**
Persetujuan A dicatat pada 28 Oktober 2026 dari jawaban eksplisit
“Saya berwenang dan menyetujui prosedur” atas permintaan persetujuan prosedur
ini. Persetujuan tersebut hanya mencakup tata cara yang dijelaskan di sini;
jangka retensi per kelompok dan persetujuan B untuk tindakan nyata belum
ditetapkan. Perubahan substantif berikutnya memerlukan pengesahan ulang.

Dokumen ini adalah prosedur, bukan izin membaca arsip, membuat salinan,
menjalankan SQL, mengubah backup, ataupun menghapus data. Belum ada tindakan
terhadap data pelanggan yang dilakukan dalam penyusunannya. Persetujuan prosedur
tidak menggantikan persetujuan pelaksanaan per cakupan di bagian 3.

Tujuannya mengurangi data pribadi pada `legacy_memory_reviews.evidence_ref`
versi 0 dan `rationale` lama, termasuk turunannya, tanpa menghapus keputusan
tinjauan atau memalsukan provenance. Redaksi API saat ini bukan penghapusan
fisik dan bukan bukti semua salinan sudah bersih. Prosedur pemulihan dan syarat
arsip asli tetap mengikuti [pemulihan memori lama](legacy-memory-recovery.md).

Tidak ada batas retensi universal yang diasumsikan. Pemilik berwenang menetapkan
jangka waktu, tanggal akhir, dasar kebutuhan/hukum, dan pengecualian per kelompok
di berkas keputusan terbatas. Nilai kosong berarti **belum diputuskan**, bukan
izin menyimpan selamanya atau izin menghapus. Penanggung jawab wajib menetapkan
tenggat keputusan dan eskalasi; selama belum diputuskan, batasi akses dan jangan
melakukan tindakan baru berdasarkan prosedur ini.

## 1. Lingkup dan hasil penelusuran kode

| Lokasi/jalur | Yang diketahui | Perlakuan wajib dalam inventaris |
| --- | --- | --- |
| `server/lib/legacy-memory-recovery.ts` | Query daftar menyembunyikan rujukan versi 0 dan memakai `reason_code`, bukan `rationale` lama. Migrasi aditif tidak membersihkan teks. | Database utama tetap berpotensi mengandung teks pribadi. Pendataan awal hanya skema, jumlah, dan ID internal; jangan `SELECT *` atau mencetak nilai lama. |
| `/api/admin/legacy-memories` di `server/routes.ts` | Daftar memerlukan autentikasi dan superadmin; bukan jalur pembaca teks lama. Penulisan baru memakai alias dan kode alasan. | Pertahankan redaksi dan hentikan akses instance lama yang belum aman; jangan membuka endpoint khusus teks lama. |
| Database langsung, konsol administrasi, kredensial runtime, pekerjaan terjadwal | Pembatasan API tidak membatasi seluruh pembaca SQL. Hak aktual belum diaudit dalam pekerjaan ini. | DBA memeriksa izin efektif setiap identitas, layanan, operator, dan pekerjaan; superadmin aplikasi bukan izin arsip/SQL tambahan. |
| `server/lib/db-backup.ts`, pemanggil di `server/index.ts` | `pg_dump` seluruh database dibuat sementara, di-ZIP dan dikirim lewat email mingguan. Pembersihan file sementara tidak membuktikan lampiran atau salinan penyedia sudah hilang. | Inventariskan dump, ZIP, file sementara tersisa, antrean pengiriman, penyedia email, kotak terkirim/masuk, terusan, unduhan, sinkronisasi dan backup penerima. Jangan menjalankan backup untuk inventaris ini. |
| `scripts/db-export.ts` / `scripts/db-import.ts` | Daftar tabel eksplisit saat diperiksa tidak mencantumkan `legacyMemoryReviews`. | Bukan bukti ekspor historis atau alat lain aman; catat versi alat dan cakupan tiap ekspor. Jangan membuat ekspor uji dari data pelanggan. |
| `scripts/restore-db.sh`, pemulihan SQL/manual | Pemulihan dapat memasukkan kembali nilai dari sebelum redaksi. | Terapkan gerbang pemulihan bagian 7, bukan mempercayai tanggal backup saja. |
| Replika, WAL/PITR, snapshot, cadangan terkelola, klon lingkungan, unduhan SQL/JSON/CSV, riwayat Git/checkpoint, log/tiket/tangkapan layar | Keberadaan, isi, penerima, retensi, dan kemampuan penghapusan aktual **belum diverifikasi**. | Petugas menelusuri metadata dan konfirmasi kustodian di luar repository. Jangan mengeklaim tidak ada hanya karena tidak tampak di kode. |
| Katalog dan arsip kejadian asli independen | Belum ada sumber operasional yang disahkan untuk persetujuan pemulihan. | Tetap terpisah dari teks tinjauan. Jangan membuat arsip baru dari teks lama, dump, atau klaim pemohon. |

Inventaris metadata tidak perlu membuka isi arsip. Gunakan ID salinan acak,
jenis penyimpanan, hubungan asal/turunan, rentang tanggal, kustodian, status
izin, masa retensi, status immutable/legal hold, dan status verifikasi.
Locator, penerima, serta pemetaan identitas disimpan hanya dalam register
terbatas, bukan dokumen ini, repository, log aplikasi, atau tiket bersama.
Inventaris harus mencakup salinan yang sedang berjalan/dikirim pada saat batas
pelaksanaan, bukan hanya salinan yang sudah terdaftar sebelumnya.

## 2. Penanggung jawab dan akses terbatas

- **Pemilik data/pengendali berwenang:** mengesahkan tujuan, cakupan, masa retensi,
  dasar pemrosesan, hak subjek data, penahanan hukum, dan tindakan per salinan.
  Pemohon tidak boleh menyetujui penghapusan data pihak lain tanpa kewenangan.
- **Petugas arsip:** memverifikasi provenance dan hubungan rujukan tanpa
  merekonstruksi rekaman asli; menjaga katalog terbatas.
- **DBA/kustodian salinan:** menjalankan tindakan yang sudah disetujui pada
  penyimpanan yang menjadi tanggung jawabnya.
- **Pemeriksa independen:** memeriksa cakupan, persetujuan, hasil dan kelengkapan
  audit; bukan pelaksana yang sama.

Akses isi hanya melalui sesi administratif terbatas yang disetujui, identitas
perorangan/MFA bila tersedia, izin baca-saja sebatas kolom/baris yang diperlukan,
batas waktu dan pencabutan setelah pekerjaan. Pisahkan izin baca, ekspor,
perubahan, dan penghapusan. Jangan memberikan kredensial database luas kepada
peninjau aplikasi. Otorisasi baca tidak otomatis mengizinkan salin/unduh.
Jika akses isi atau salinan diperlukan, minta persetujuan eksplisit tersendiri
yang menentukan data minimum, tujuan, tujuan penyimpanan, penerima dan retensinya.

Sebelum sesi, pastikan audit database/penyimpanan dapat merekam akses aktual,
termasuk penolakan; gunakan kontrol ekspor dan audit unduhan bila tersedia.
Register manual melengkapi, bukan menggantikan bukti teknis baca/unduh.
Jika alat tidak bisa membatasi/mengaudit akses, jangan buka isi; eskalasikan
ke pemilik dan siapkan jalur yang memenuhi syarat. Jangan menaruh teks SQL
berparameter sensitif, nilai baris, token, atau respons penyedia mentah di log.

## 3. Berkas keputusan dan dua persetujuan

Simpan formulir berikut di penyimpanan terbatas yang disetujui. Dokumen publik
hanya memuat status tanpa nama, locator, identitas pelanggan atau isi arsip.

1. ID keputusan acak, versi prosedur, waktu UTC, pemilik berwenang serta dasar
   kewenangannya, pelaksana, pemeriksa independen, dan bukti persetujuan.
2. Daftar ID tinjauan/kelompok dan ID salinan, batas tanggal, cakupan kolom,
   jumlah yang diharapkan, serta pengecualian. Dilarang memakai pencocokan pola
   teks lama untuk menganggapnya aman atau mengubah versi 0 menjadi 1.
3. Untuk **setiap** kelompok (utama, replika, backup, ekspor, audit minimal,
   katalog/arsip asli): tujuan/dasar retensi, awal perhitungan, durasi, tanggal
   kedaluwarsa, kustodian, tenggat pelaksanaan, jadwal pemeriksaan, dan tindakan
   akhir. Hubungkan seluruh turunan ke keputusan yang sama.
4. Pilihan tindakan: retensi terbatas sementara, redaksi kolom, penghapusan
   salinan, atau kedaluwarsa immutable. Catat dampak pada pemulihan, kebutuhan
   data lain dalam backup bersama, serta metode penghapusan yang didukung.
5. Legal hold/sengketa/kewajiban hukum: cakupan, dasar, penanggung jawab,
   tanggal tinjau ulang dan syarat pelepasan. Hold menahan tindakan destruktif
   hanya pada cakupannya, tidak membuka akses umum atau meniadakan redaksi API.
6. Rencana mempertahankan rantai rujukan sah, verifikasi sebelum/sesudah,
   penanganan kegagalan parsial dan gerbang pemulihan.
7. **Persetujuan A — prosedur:** pemilik mengesahkan tata cara dan pembagian
   kewenangan. **Persetujuan B — tindakan:** pemilik mengizinkan secara eksplisit
   baca/salin/redaksi/hapus tertentu pada daftar cakupan final; pemeriksa
   independen memeriksa kelengkapannya sebelum pelaksana mulai.

Persetujuan umum, merge kode, kepemilikan akun superadmin, atau diamnya pemilik
bukan persetujuan B. Perubahan cakupan/tujuan/tenggat atau izin yang kedaluwarsa
memerlukan persetujuan ulang. Penolakan atau pencabutan menghentikan tindakan
berikutnya; catat tindakan yang sudah selesai dan tidak dapat dipulihkan.

## 4. Audit akses dan tindakan

Gunakan jurnal terbatas terpisah dari tabel tinjauan, dengan kontrol append-only
atau deteksi perubahan serta pemeriksaan independen. Rekam kejadian permohonan,
persetujuan/penolakan, sesi baca, lookup katalog, percobaan ekspor/unduh,
perubahan izin, redaksi/penghapusan, kegagalan, pencabutan, dan verifikasi.
Setiap kejadian memuat ID operasi/keputusan, identitas petugas terbatas, waktu
UTC, tujuan berkode, tindakan, ID cakupan/salinan, hasil, jumlah dan rujukan
bukti teknis terbatas. Jangan rekam nilai sebelum/sesudah, isi arsip, atau
hash teks pribadi sebagai pengganti isi.

Jika audit tidak dapat ditulis atau bukti cakupan tidak tersedia, hentikan
operasi sebelum membuka/mengubah data. Tinjau akses sesuai jadwal keputusan
serta setelah penyimpangan, dan cabut akses sesi setelah selesai.
Jurnal itu sendiri mengandung metadata pribadi: pemilik wajib menentukan
retensi, akses dan tindakan akhir, bukan menyimpannya tanpa batas.
Penghitung `archive_failure_totals` tidak menggantikan jurnal ini.

## 5. Redaksi sumber utama setelah persetujuan B

Tidak ada skrip siap-jalan atau pekerjaan startup baru dalam prosedur ini.
Rencana teknis spesifik harus ditinjau terhadap skema/constraint saat eksekusi.

1. Bekukan penulis versi lama dan koordinasikan pekerjaan ekspor/backup selama
   jendela tindakan agar nilai lama tidak tersebar lagi. Penghentian atau
   perubahan layanan juga memerlukan izin operasional; kode backup saat ini
   belum berubah dan tidak otomatis menerapkan gerbang ini.
2. Tetapkan daftar ID final dan hitung metadata tanpa membaca nilai teks.
   Buktikan dengan fixture sintetis bahwa rencana hanya menyentuh cakupan
   yang disetujui dan aman diulang. Jangan membuat dump pengaman berisi nilai
   lama tanpa persetujuan salinan tersendiri.
3. Sebelum redaksi, petugas memastikan rujukan yang sah tetap dapat ditelusuri
   lewat register terbatas: ID tinjauan → alias acak → rekaman asli tetap,
   beserta digest asli yang sudah sah. Pembuatan alias tidak mengubah byte asli.
   Jika hubungan tidak dapat dibuktikan, tandai tidak terverifikasi; jangan
   menciptakan bukti atau menyebut rantai lengkap. Bila keputusan mensyaratkan
   rantai utuh, hentikan baris itu dan minta keputusan pemilik.
4. Dalam transaksi, kunci dan verifikasi ulang versi, ID dan jumlah baris.
   Untuk cakupan yang disahkan, kosongkan `rationale` lama menjadi `NULL`;
   ganti `evidence_ref` **hanya versi 0** dengan penanda tetap non-pribadi
   `legacy:redacted` (kolom saat ini `NOT NULL`). Jangan simpan nilai lama di
   kolom lain, log, jurnal, rollback file atau tabel arsip baru. Penanda bukan
   alias sah, tidak mengubah versi dan tidak boleh dipakai untuk persetujuan.
5. Jangan menghapus baris tinjauan atau mengubah `decision`, `reason_code`,
   ID tinjauan/memori, identitas/waktu pengaju dan peninjau, `evidence_sha256`,
   rujukan versi 1 yang sah, maupun pemilik memori. Metadata ini tetap terbatas
   dan memiliki retensi tersendiri. Jangan menebak kode alasan dari teks lama.
6. Ketidakcocokan jumlah, hold baru, pergeseran versi atau kegagalan audit
   membatalkan transaksi. Catat hasil tanpa nilai. Setelah commit, periksa
   jumlah/penanda, invariant keputusan, keterlacakan dan keluaran API.

Redaksi SQL adalah penghapusan logis. MVCC, WAL, replika, snapshot dan media
lama dapat tetap mengandung nilai; `UPDATE`, `VACUUM`, atau hapus file biasa
bukan bukti penghapusan fisik seluruh salinan. Jangan menjalankan pemeliharaan
destruktif atau penghancuran kunci enkripsi bersama yang merusak data lain.

## 6. Replika, backup, dan ekspor terdahulu

- **Replika/klon:** verifikasi penerapan redaksi dan posisi replikasi; klon
  terlepas harus ditangani sendiri. Batasi akses yang tertinggal dan catat
  verifikasi tiap salinan. Jangan menganggap sukses di utama berarti selesai.
- **Backup/WAL/PITR immutable:** jangan mengubah backup terkunci atau melanggar
  hold. Pilih retensi sampai tanggal kedaluwarsa yang disetujui, karantina,
  larangan penggunaan biasa, dan sanitasi sebelum pemulihan. Dapatkan konfirmasi
  kustodian/penyedia mengenai penghapusan dan sisa masa retensi; jika tidak
  tersedia, status tetap belum terverifikasi. Jangan menjanjikan hapus seketika.
- **Backup yang bisa dihapus:** setelah izin B, kustodian menghapus objek
  beserta versi/turunan yang termasuk cakupan, atau membuat pengganti yang
  tersanitasi **hanya bila penyalinan diizinkan**. Jangan menimpa arsip asli
  kejadian untuk menyesuaikan digest. Backup bersama memerlukan pemeriksaan
  dampak pada data lain; tidak boleh dihapus massal demi satu kolom.
- **Ekspor/lampiran/email:** telusuri daftar penerima dan terusan melalui metadata
  yang sah. Instruksikan kustodian menghapus/redaksi sesuai keputusan termasuk
  trash, unduhan, sinkronisasi dan backup lokal; minta konfirmasi tertulis dan
  bukti penghapusan yang tersedia tanpa melampirkan isi. Pencabutan tautan saja
  tidak menghapus unduhan. Untuk penerima tidak diketahui/tidak merespons,
  laporkan sebagai salinan belum terselesaikan dan eskalasikan, bukan tutup.
- **Log, tiket, repository/checkpoint:** bila tercatat sebagai terdampak, minta
  tindakan kustodian untuk riwayat/versinya sesuai persetujuan; hapus dari
  tampilan terkini saja tidak cukup. Jangan melakukan rewrite riwayat atau
  penghapusan checkpoint tanpa izin dan pemeriksaan dampak tersendiri.
- **Salinan berikutnya:** sebelum alur ekspor/backup dilanjutkan, pemilik
  menyetujui apakah memakai sumber tersanitasi atau retensi backup terbatas
  dengan gerbang pemulihan. Dokumentasikan pengendalian yang benar-benar
  dipasang; jangan menyebut backup saat ini sudah tersanitasi.

## 7. Gerbang pemulihan dan kegagalan parsial

Pemulihan dari backup sebelum redaksi harus dilakukan hanya setelah persetujuan
salinan/pemrosesan ke lingkungan terisolasi, akses terbatas dan tanpa layanan
publik, email, provider AI atau pekerjaan ekspor otomatis. Daftar redaksi
(ID/kolom/keputusan, tanpa nilai lama) disimpan di register terpisah dari backup
agar tidak ikut mundur saat restore.

Sebelum membuka akses: terapkan migrasi dan daftar redaksi yang disahkan,
verifikasi seluruh cakupan dan invariant keputusan, uji API dengan fixture
sintetis, dan minta tanda tangan pemeriksa independen. Jika register tidak
tersedia, cakupan tidak cocok atau backup mengandung versi tak dikenal,
**jangan promosikan hasil restore**. Jangan menjalankan skrip impor biasa
ke database pelanggan sebagai cara menguji prosedur.

Kegagalan pada satu salinan tidak membatalkan tindakan selesai pada salinan
lain dengan mengembalikan teks pribadi. Catat status per salinan dan ulangi
hanya cakupan tersisa setelah izin diperiksa. Pemilik menentukan eskalasi,
tenggat dan penanganan insiden untuk salinan bocor/tidak dapat dijangkau.

## 8. Kriteria penutupan dan daftar periksa

- [ ] Persetujuan A tercatat; persetujuan B terpisah mencakup tindakan final.
- [ ] Semua kelompok punya kustodian, tanggal retensi/tenggat, status hold,
      akses terbatas dan audit; ketidakpastian tidak ditandai selesai.
- [ ] Pelaksanaan hanya pada cakupan sah; hasil dan audit akses diverifikasi.
- [ ] Keputusan tinjauan dan rujukan asli yang sah tetap dapat ditelusuri;
      hubungan tidak terverifikasi dinyatakan jujur tanpa bukti pengganti.
- [ ] Salinan terhapus memiliki bukti; salinan immutable memiliki tanggal
      kedaluwarsa dan pemilik tindak lanjut. Status demikian **bukan** sudah
      terhapus; penutupan final menunggu konfirmasi kedaluwarsa/penghapusan.
- [ ] Ekspor terdahulu dan penerima turunannya terkonfirmasi; yang tidak diketahui
      tetap terbuka dalam register risiko dengan eskalasi.
- [ ] Gerbang restore terbukti dengan data sintetis; akses sementara dicabut.
- [ ] Pemilik dan pemeriksa menandatangani laporan metadata tanpa isi privat.

Penyusunan/pengesahan prosedur dapat selesai sebelum pelaksanaan. Jangan
menyatakan data pelanggan sudah dibersihkan hanya karena dokumen disetujui
atau redaksi API lulus uji.
