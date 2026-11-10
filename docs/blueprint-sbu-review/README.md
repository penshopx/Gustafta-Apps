# Pemeriksaan blueprint SBU dan dasar hukum

**Tanggal pemeriksaan: 18 Oktober 2026. Status: tinjauan dokumen, bukan
pengesahan legalitas perusahaan.**

## Hasil utama

1. Arsip blueprint berisi **73 kode unik**, seluruhnya ditemukan dalam tabel
   Kepdirjen Bina Konstruksi **281/KPTS/DK/2026**, Lampiran 2.1.5.b.
2. Delapan kelompok pekerjaan konstruksi pada tabel tersebut berjumlah **77**:
   BG 9, BS 20, **IN 13**, KK 16, KP 2, PA 1, PB 8, PL 8.
   Blueprint belum mencantumkan **IN011, IN012, IN013, IN014**.
   Angka 77 ini tidak mencakup konsultansi atau pekerjaan konstruksi terintegrasi.
3. Ringkasan SIGAP menyebut 73 tetapi menghilangkan **PA**. Koreksi tersebut
   berbeda dari temuan empat kode IN yang belum masuk blueprint.
4. Kualifikasi spesialis bukan “—”. Tabel resmi membedakan BUJKN, BUJK PMA,
   KPBUJKA, dan K1/K2/K3. Pilihan dalam katalog bukan kualifikasi yang sekaligus
   dimiliki sebuah perusahaan.
5. Aturan berlaku tidak otomatis berarti layanan baru sudah dioperasikan.
   **Surat mulai penyelenggaraan SIJK belum diperoleh dalam pemeriksaan ini.**
6. **Nama subklasifikasi tidak boleh diganti dengan judul KBLI.** Contoh:
   KK001 berjudul KBLI “Pemasangan Dan Rekayasa Struktur Bangunan”, sedangkan
   nama subklasifikasinya “Pondasi Konstruksi”.

## Berkas hasil

- [Memo koreksi](MEMO_KOREKSI.md): teks pengganti dan keputusan penggunaan.
- `REGISTER_KLAIM.csv`: satu baris per klaim, status
  `verified` / `corrected` / `unresolved`.
- `KATALOG_PERBANDINGAN.csv`: 73 kode sumber ditambah empat kode yang belum
  masuk; nama, judul KBLI, kualifikasi, dan statusnya dipisahkan.
- [Daftar sumber dan batas bukti](SUMBER_DAN_BATAS_BUKTI.md).
- `BUKTI_NAMA_PERMEN.md`: cuplikan naskah pemerintah, termasuk ekstraksi yang
  rusak; tidak diam-diam melengkapi nama berdasarkan dugaan.
- `BUKTI_TABEL_281.csv`: transkripsi tabel resmi, termasuk sambungan antarhalaman.
- `MANIFEST_SUMBER.csv`: SHA-256 sumber lokal dan tangkapan teks daring.
- `RINGKASAN_VALIDASI.json`: hitungan dan pemeriksaan konsistensi paket.

**Definisi status:** `verified` berarti klaim terbatas didukung bukti yang
disebut; `corrected` berarti teks sumber perlu dibetulkan/dilengkapi dan usulan
dicatat; `unresolved` berarti bukti belum cukup, bukan klaim itu pasti salah.
Status berlaku **per dimensi**, tidak diwariskan ke seluruh baris atau perusahaan.
Misalnya kode bisa verified tetapi ejaan nama unresolved.

## Batas penggunaan

Hasil ini bukan daftar SBU tenant, bukan keputusan kelayakan tender, bukan
sertifikasi SKK, dan bukan perintah aktivasi. Tidak ada perubahan kode aplikasi,
database, konektor, atau status SOP. Dokumen dan arsip asli tidak ditimpa.

Salinan pemerintah terlampir dipakai sebagai sumber primer dokumenter.
Keaslian tanda tangan elektronik dan kesamaan byte dengan salinan unduhan
pemerintah **belum dibuktikan**. Untuk Permen, teks pemerintah berhasil dibaca
melalui JDIH BPK, tetapi sebagian tabel terurai tidak berurutan. Halaman cetak
yang tidak bisa dipastikan tidak dikarang; register memakai pasal, lampiran,
KBLI dan segmen ekstraksi sebagai penunjuk tambahan. Lihat klaim `R-PAGINASI`.

## Reproduksi

`python scripts/build-blueprint-sbu-review.py` membangun ulang CSV dan cuplikan
dari kedua ZIP asli, salinan Kepdirjen di `attached_assets`, dan tangkapan
teks resmi di `generated-artifacts/blueprint-sbu-review/sources`.
Tangkapan besar sengaja tidak dimasukkan Git. Paket unduhan menyertakannya.
Jika tidak tersedia, peroleh ulang sumber sesuai daftar sumber; skrip berhenti
dengan pesan jelas, bukan mengarang bukti atau memakai database.
