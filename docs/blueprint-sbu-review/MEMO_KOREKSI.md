# Memo koreksi blueprint dan SIGAP

**18 Oktober 2026 — rekomendasi revisi dokumen saja.**
Register merupakan hasil pemeriksaan, bukan bukti perusahaan telah memenuhi
syarat. Semua rujukan S281/SP6/SPP28/SUU2/SPBJ dijabarkan beserta kutipan dan
batas akses pada `SUMBER_DAN_BATAS_BUKTI.md`.

## 1. Ganti profil dan kalimat “legalitas”

K:8,16–20,35 dan S:373 tidak boleh menafsirkan Gustafta Apps sebagai BUJK
yang otomatis memiliki seluruh subklasifikasi.

**Teks pengganti:**

> Gustafta Apps adalah platform pendukung proses kontraktor. Profil badan usaha
> pada blueprint adalah templat milik tenant, bukan pernyataan legalitas
> Gustafta atau perusahaan tertentu. Katalog subklasifikasi adalah referensi
> normatif, terpisah dari daftar SBU yang benar-benar dimiliki tenant.
> Kepemilikan, pemegang, klasifikasi/subklasifikasi, kualifikasi, masa berlaku,
> status pembekuan/pencabutan dan konversi harus dibuktikan dengan dokumen serta
> hasil pemeriksaan berwenang pada tanggal pemeriksaan.

Jangan mengganti teks “belum diverifikasi” menjadi “verified/Active” hanya
karena kode ditemukan dalam lampiran. BUJKN, BUJK PMA dan KPBUJKA bukan satu
status badan usaha yang dapat dicentang sekaligus tanpa bukti.

## 2. Bedakan jumlah sumber dan cakupan tabel resmi

**Teks pengganti K:37–46 dan S:459:**

> Katalog blueprint awal berisi 73 kode: BG 9, BS 20, IN 9, KK 16, KP 2, PA 1,
> PB 8, PL 8. Semua kode tersebut ditemukan dalam Lampiran Kepdirjen
> 281/KPTS/DK/2026 bagian 2.1.5.b (PDF 18–24; lampiran halaman 9–15).
> Tabel pada delapan kelompok yang sama berisi 77 kode karena IN juga mencakup
> IN011–IN014. Karena itu daftar 73 bukan katalog lengkap tabel tersebut.
> Kelompok PA wajib muncul dalam ringkasan SIGAP. Pemilihan paket produk
> komersial tidak harus identik dengan jumlah kode normatif.

Jika cakupan produk sengaja hanya 73, namai “73 kode pilihan blueprint”;
jangan mengiklankan “seluruh kode terbaru”. Tidak perlu mengubah aplikasi atau
membuka paket apa pun sebagai bagian pemeriksaan ini.

Empat kode tambahan:

| Kode | Nama pada ekstraksi Permen | Judul KBLI pada tabel Kepdirjen | Bukti kode |
| --- | --- | --- | --- |
| IN011 | Instalasi Sinyal dan Rambu-Rambu Jalan Raya | Pemasangan Perlengkapan Jalan Berbasis Listrik | S281 PDF 21, lampiran 12 |
| IN012 | Instalasi Sinyal dan Telekomunikasi Kereta Api | Pemasangan Sistem Persinyalan Dan Telekomunikasi Kereta Api | sama |
| IN013 | Instalasi Pemanas dan Geotermal | Pemasangan Sistem Pemanas Dan Geotermal | sama |
| IN014 | Instalasi Meteorologi, Klimatologi dan Geofisika | Pemasangan Perlengkapan Meteorologi, Klimatologi, Dan Geofisika | sama |

Keempat nama tersebut dicocokkan pada teks Permen, **bukan diisi dengan judul
KBLI**. Paginasi persis Permen tetap mengikuti batas bukti yang dijelaskan
dalam daftar sumber.

## 3. Lengkapi kualifikasi per bentuk usaha

S281 PDF 15/lampiran 6 dan PDF 18–24/lampiran 9–15:

- BG dan BS bersifat **umum**; IN/KK/KP/PA/PB/PL **spesialis**.
- Untuk BUJKN: K1/K2/K3, Menengah, Besar tersedia sesuai baris kode.
- **Hanya Menengah/Besar** untuk BUJKN pada BS013, BS014, BS015, BS018, BS019,
  IN003, IN010, KK002, KK003, KK010, KK014, PL001.
- BUJK PMA dan KPBUJKA: **Besar** pada baris yang diperiksa.
- Satu BUJK hanya satu kualifikasi/subkualifikasi, termasuk bila memiliki
  sifat umum dan spesialis (2.1.3 angka 3–4).

**Teks pengganti:**

> Kolom kualifikasi menyatakan pilihan menurut norma untuk jenis badan usaha,
> bukan kualifikasi aktual pemegang. Untuk pekerjaan konstruksi, kualifikasi
> kecil dibedakan K1/K2/K3. Sifat spesialis tidak menghapus kewajiban penilaian
> kualifikasi. Pilihan lengkap per kode terdapat pada register pemeriksaan.

Persyaratan penjualan, keuangan, TKK, peralatan, dan ketentuan lain harus
dinilai terpisah; pemeriksaan ini tidak menyimpulkan tenant telah memenuhinya.

## 4. Nama SBU dan judul KBLI adalah dua kolom berbeda

**Pertahankan** nama subklasifikasi pada Lampiran I A.1 Permen,
**tambahkan terpisah** judul KBLI pada tabel Kepdirjen bila dibutuhkan.
Jangan mengganti seluruh nama mengikuti perubahan judul KBLI.

Contoh penting:

- BG001: nama subklasifikasi **Konstruksi Gedung Hunian**; judul KBLI tabel
  Kepdirjen **Konstruksi Konvensional Gedung Hunian**.
- KK003: kepanjangan **Pembangkit Listrik Tenaga Air** lebih tepat dicatat
  utuh; “PLTA” boleh sebagai alias, bukan dianggap kode lain.
- PA001: nama pada Permen **Penyewaan Peralatan**, ruang lingkup dengan
  **operator**. Permen mengecualikan sewa tanpa operator ke kelompok 77393.
  Jangan memperluas PA001 menjadi semua persewaan alat.
- PB001: ekstraksi Permen menulis **Alumunium**, bukan “Aluminium”.
  PB010 menulis **Lansekap**, bukan “Lanskap”. Simpan label sumber dan alias
  pencarian terpisah; ini koreksi transkripsi, bukan perubahan izin.
- BS019: “Peluncuran Satelit” pada nama subklasifikasi tidak otomatis salah
  hanya karena judul KBLI tabel Kepdirjen berbunyi “Bandar Antariksa”.

Nama dengan ekstraksi kolom rusak tetap unresolved, termasuk kemungkinan
perbedaan BS014 dan KP002. Jangan “membetulkan” berdasarkan potongan kalimat.
Daftar lengkap dan kutipannya ada di CSV dan `BUKTI_NAMA_PERMEN.md`.

## 5. Perbaiki tabel dasar regulasi

| Regulasi | Rumusan hasil pemeriksaan | Efektif / transisi |
| --- | --- | --- |
| UU 2/2017 | Jasa Konstruksi, dibaca sebagaimana diubah UU 6/2023; bukan naskah 2017 tanpa perubahan | awal 12 Januari 2017; hubungan perubahan didukung metadata dan konsiderans regulasi terbaru |
| PP 28/2025 | Penyelenggaraan Perizinan Berusaha Berbasis Risiko; mencabut PP 5/2021, Pasal 550 b | 5 Juni 2025, Pasal 552; bukan aturan utama PBJP |
| Permen PU 6/2025 | Gunakan judul lengkap pada daftar sumber; mencabut Permen PUPR 6/2021, Pasal 24 | 30 Desember 2025, Pasal 25; operasional SIJK mengikuti Pasal 20 dan peralihan Pasal 21 |
| Kepdirjen 281/KPTS/DK/2026 | Penetapan Standar Skema Sertifikasi Badan Usaha Jasa Konstruksi; mencabut 37/KPTS/DK/2025, Diktum KELIMA | 26 Agustus 2026, Diktum KEENAM; penyesuaian LSBU paling lambat enam bulan sejak penetapan, bukan tanggal otomatis konversi tenant |
| Jalur pengadaan | Perpres 16/2018 sebagaimana diubah Perpres 12/2021 dan terakhir Perpres 46/2025 | perubahan kedua 30 April 2025 menurut LKPP; tidak mengganti SBU/perizinan |

**Tidak boleh menyatakan tanggal mulai layanan baru sudah terbukti.**
Surat yang menjadi pemicu Pasal 20(2) belum diperoleh. Jangan menyatakan surat
itu tidak ada; yang belum ada adalah bukti dalam pemeriksaan ini.

## 6. Pisahkan SBU, SKK, dan persyaratan paket

**Teks pengganti kolom Legalitas K:20:**

> Bukti badan usaha: NIB, Sertifikat Standar dan SBU yang relevan.
> Bukti kompetensi personel: SKK Konstruksi dan penetapan personel yang relevan
> dengan jabatan/klasifikasi sesuai aturan yang berlaku.
> Bukti sistem manajemen/keselamatan serta dokumen tender diperiksa pada
> jalurnya masing-masing. Daftar kebutuhan ini bukan pernyataan seluruh bukti
> telah dimiliki atau selalu diwajibkan dalam bentuk yang sama.

UU 2/2017 Pasal 1 angka 11–13 (naskah asli PDF 3) membedakan badan usaha dari
tenaga kerja. Kepdirjen 281 mengatur skema BUJK/SBU, **bukan dasar langsung
penerbitan semua SKK atau SKKNI**. Kaitan SKK pada syarat TKK pendukung SBU
tidak mengubah SKK menjadi sertifikat perusahaan.

Jangan menyatakan PJBU/PJTBU/PJSKBU semuanya memiliki kewajiban SKK identik.
Nomenklatur baru pada ketentuan TKK menggunakan PJKBU; rincian jabatan dan
persyaratan SKK harus dibaca per ketentuan, bukan digeneralisasi dari K:20.
AI tidak dapat menjadi pemegang SKK atau penanggung jawab hukum manusia.

## 7. Keputusan penggunaan

- **Boleh:** memakai register sebagai bahan revisi blueprint; membetulkan PA
  pada ringkasan; memisahkan pilihan katalog dari kepemilikan SBU; menambahkan
  batas waktu dan transisi bersyarat.
- **Belum boleh:** menyatakan nama unresolved sudah final, mengklaim seluruh
  halaman lampiran telah diautentikasi, menetapkan tenggat konversi tenant
  tanpa surat pemicu, atau menyatakan perusahaan lulus legal/tender.
- **Tidak dilakukan:** aktivasi konektor, akses data tenant, perubahan database,
  pengesahan legalitas, maupun perpindahan SOP ke Active.

Untuk menutup unresolved, peroleh salinan Permen yang dapat dirender untuk
halaman/nama yang rusak dan surat operasional SIJK yang sah. Ini pekerjaan
penambahan bukti, bukan alasan mengubah nilai unresolved menjadi verified.
