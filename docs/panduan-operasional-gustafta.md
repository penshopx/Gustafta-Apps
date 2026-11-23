# Panduan Penggunaan Dan Operasional Gustafta

**Cakupan:** pengguna, admin, dan superadmin Gustafta Apps  
**Versi dokumen:** 1.1 · 23 November 2026

**Tujuan:** menjadi rujukan praktis untuk memahami menu, isi fitur, alur kerja, batas akses, dan penanganan masalah umum.

> Nama menu dan akses dapat berubah mengikuti rilis, paket langganan, izin akun, dan ketersediaan integrasi. Panduan ini menjelaskan fitur yang ada di proyek; tidak berarti semua fitur terbuka pada setiap akun atau seluruh integrasi eksternal selalu aktif.

## 1. Gambaran Gustafta

Gustafta adalah platform penyelesaian masalah berbasis AI. Pengguna dapat memilih AI Specialist, mengelola pengetahuan dan dokumen, membuat keluaran kerja, serta menjalankan alur tugas dengan kontrol dan persetujuan manusia.

Tiga lapisan yang perlu dibedakan:

1. **Produk/layanan:** fitur yang digunakan langsung, seperti Ruang Simpan, Ruang Proyek, portal SBU/SKK, Klinik Konsultasi, Mini Apps, dan AI Specialist.
2. **Engine Gustafta:** alur yang membantu memahami kebutuhan, menyusun solusi, mengonfigurasi AI, berkolaborasi, dan mengeksekusi pekerjaan.
3. **Hasil:** jawaban, analisis, dokumen, checklist, draf, atau catatan tugas yang perlu ditinjau sesuai risikonya.

**Workroom** adalah istilah untuk tahap/alur eksekusi tugas. **Ruang X** adalah nama produk atau domain (misalnya Ruang Simpan atau Ruang Tender); keduanya bukan istilah yang sama.

AI membantu analisis dan penyusunan draf. Untuk keputusan legal, sertifikasi, keselamatan, pengadaan, pajak, atau keputusan bisnis, cocokkan hasil dengan sumber resmi dan penanggung jawab yang berwenang.

## 2. Peran Dan Batas Kewenangan

| Peran | Penggunaan utama | Kewenangan operasional |
|---|---|---|
| **Pengguna** | Memakai fitur yang tersedia pada akun/paketnya, mengelola data miliknya, dan melihat status langganan. | Tidak dapat melihat atau mengubah data privat pengguna lain. |
| **Admin** | Membantu operasional pengguna, langganan/trial, mitra, Store, produk, dan alat administrasi yang diizinkan. | Tidak dapat mengangkat/menurunkan admin atau mengelola akun admin. |
| **Superadmin** | Semua kewenangan admin serta pengelolaan admin dan kontrol khusus platform. | Perubahan berdampak luas harus dibatasi pada kebutuhan, dikonfirmasi, dan dicatat. Akses superadmin bukan alasan untuk membuka data yang tidak diperlukan. |

Peran efektif dapat berbeda dari label profil. Sistem memakai pemeriksaan akses admin yang berlaku di server. Jika menu admin tidak muncul atau akses ditolak, jangan mencoba melewati pembatasan; minta pemilik akun memeriksa peran dan status akun.

## 3. Memulai Sebagai Pengguna

### 3.1 Masuk Dan Mengenali Dashboard

1. Buka situs Gustafta dan masuk dengan akun yang terdaftar.
2. Buka **Dashboard** untuk memilih AI Specialist, fitur, dan mini app yang tersedia.
3. Gunakan pencarian/kategori bila tersedia; akses tertentu bergantung pada paket dan status langganan.
4. Buka **Akun** untuk memeriksa profil dan **Langganan Saya** untuk memeriksa paket serta masa aktif.
5. Jika baru pertama menggunakan fitur, mulai dari satu kebutuhan konkret dan satu output yang ingin dihasilkan.

### 3.2 Memilih AI Specialist

AI Specialist atau Claw dirancang untuk bidang tertentu. Pilih yang paling dekat dengan pekerjaan, misalnya:

- **SBU, sertifikasi, dan perizinan:** SBUClaw, SkemaClaw, ABUClaw, OSSClaw, LKUTClaw, dan spesialis terkait.
- **SKK dan kompetensi:** PanduanASKOM, ManprojakClaw, ArsitekturClaw, SurveiPemetaanClaw, GeoteknikClaw, dan spesialis jabatan teknis.
- **Konstruksi, proyek, K3, tender, dan kontrak:** KonstraClaw, TenderaClaw, KonstraTenderClaw, PengawasClaw, K3ManClaw, QSClaw, dan spesialis lain.
- **Sistem manajemen:** SMAPClaw, ISOClaw, SMK3Claw, HACCPClaw, ESGClaw, dan spesialis terkait.
- **Energi, industri, bisnis, HR, pemasaran, pendidikan, dan riset:** pilih spesialis sesuai kategori pada katalog.

MultiClaw adalah tim beberapa agen yang berkoordinasi. Gunakan tim ketika tugas benar-benar memerlukan keahlian berbeda; untuk pertanyaan sederhana, satu spesialis biasanya lebih tepat. Hasil spesialis tetap perlu dibaca dan disatukan secara kritis.

### 3.3 Cara Bertanya Agar Hasil Lebih Berguna

Berikan konteks secukupnya:

1. **Tujuan:** keputusan atau dokumen apa yang dibutuhkan.
2. **Konteks:** sektor, lokasi, tahap pekerjaan, dan kondisi yang relevan.
3. **Bahan:** unggah atau pilih dokumen yang memang boleh dipakai.
4. **Bentuk hasil:** tabel, langkah kerja, checklist, draf surat, atau ringkasan.
5. **Batasan:** periode regulasi, format, anggaran, atau hal yang tidak boleh diasumsikan.

Minta AI menyebutkan sumber, asumsi, data yang belum tersedia, dan hal yang perlu diverifikasi. Jangan masukkan kata sandi, token, kunci API, atau data pribadi yang tidak diperlukan.

### 3.4 Paket Bidang Dan Langganan

- Buka **Paket Bidang** (`/paket-bidang`) untuk melihat atau memilih paket bidang jika menu itu tersedia pada akun.
- Batas pilihan dan daftar fitur mengikuti paket aktif. Pilihan tertentu dapat terkunci setelah disimpan; baca konfirmasi sebelum menyimpan.
- Buka **Langganan Saya** (`/my-subscription`) untuk melihat status dan masa aktif.
- Jangan menganggap tampilan produk berarti akses sudah aktif. Jika akses tidak sesuai bukti pembayaran/pemberian akses, hubungi admin dan sertakan nama fitur serta waktu kejadian—bukan token atau kata sandi.

## 4. Peta Fitur Dan Isi Konten

Menu berikut merupakan kelompok fitur yang tersedia dalam aplikasi. Tautan dapat memerlukan login, paket tertentu, atau layanan eksternal yang aktif.

### 4.1 Peta Menu Utama

| Menu | Rute | Untuk apa |
|---|---|---|
| Dashboard | `/dashboard` | Memulai pekerjaan dan membuka fitur yang dapat diakses akun. |
| AI Builder | `/ai-builder` | Membuat sistem AI baru secara privat atau mengustomisasi Claw sistem sesuai akses akun. |
| Ruang Proyek | `/ruang-proyek` | Menata konteks dan portofolio proyek milik pengguna. |
| Klinik Konsultasi | `/klinik-konsultasi` | Memulai alur konsultasi berdasarkan kebutuhan/domain. |
| Bedah Dokumen | `/bedah-dokumen` | Membuka layanan analisis dokumen. |
| Brain Project | `/brain-project` | Mengelola konteks/pengetahuan proyek pada fitur tersebut. |
| Ekosistem Kompetensi | `/kompetensi-hub` | Menjelajahi jalur kompetensi dan layanan terkait. |
| Ruang Simpan | `/ruang-simpan` | Mengelola dokumen dan koneksi aplikasi milik sendiri. |
| Dokumen Proyek | `/dokumen-proyek` | Mengakses alur dokumen proyek yang tersedia. |
| PKB-PUB / EXUM-PKB | `/executive-summary` | Menyusun atau meninjau ringkasan proyek sesuai alur yang ditampilkan. |
| Mini Apps | `/mini-apps` | Membuka alat kecil untuk tugas tertentu. |
| Produk | `/produk` | Melihat katalog produk dan layanan. |
| Akun | `/account` | Memeriksa profil dan pengaturan akun. |
| Langganan Saya | `/my-subscription` | Memeriksa paket dan status langganan. |

Portal SBU, SKK, tender, ISO, serta sejumlah aplikasi ekosistem lain muncul melalui menu solusi atau tautan layanan. Beberapa dibuka pada domain terpisah; gunakan tautan resmi di dalam aplikasi, karena ketersediaan dan login dapat berbeda.

| Kelompok | Isi dan kegunaan |
|---|---|
| **SBU–SKK dan sertifikasi** | Portal, panduan, pemeriksaan kesiapan, konsultasi, dan AI Specialist untuk badan usaha serta tenaga kerja konstruksi. Gunakan sebagai bantuan kerja; persyaratan final tetap mengikuti sumber resmi dan lembaga berwenang. |
| **Tender dan kontrak** | Pencarian/pemantauan informasi tender, analisis dokumen, checklist penawaran, dan dukungan pengelolaan kontrak. Ketersediaan data mengikuti sumber dan jadwal pembaruan masing-masing. |
| **Ruang Proyek** | Portofolio dan pengelolaan konteks proyek. Pengguna mengelola ruang miliknya; kolaborasi agen tidak otomatis memberikan akses ke Workroom atau data milik orang lain. |
| **Ruang Simpan** | Penyimpanan dokumen dan data bisnis. Dokumen bersifat privat per pemilik. Pemilik mengatur koneksi aplikasi dan memilih izin serta dokumen/folder secara eksplisit. |
| **Dokumen Proyek dan PKB-PUB/EXUM** | Pengelolaan bahan proyek dan penyusunan dokumen/ringkasan sesuai alur yang tersedia. Periksa kembali data sumber, versi, dan pihak yang akan menggunakan hasil. |
| **Bedah Dokumen** | Membantu membaca, merangkum, dan menelaah dokumen yang diunggah atau dipilih. Pastikan dokumen memang boleh diproses dan hasil analisis diperiksa terhadap dokumen asli. |
| **Mini Apps** | Aplikasi kecil untuk checklist, kalkulator, penilaian risiko, pelacak progres, generator, analisis kesenjangan, dan kebutuhan kerja lain. Jenis yang tersedia dapat berbeda; ikuti petunjuk pada tiap app dan simpan hasil sebelum meninggalkan halaman bila diminta. |
| **AI Builder** | Ruang kerja untuk membuat sistem AI baru secara manual atau mengustomisasi salinan privat AI Specialist sistem. |
| **Blueprint Builder** | Merumuskan kebutuhan lalu membuat satu agen baru melalui langkah perancangan terpandu. |
| **Rakit Tim AI** | Menyusun beberapa agen sekaligus sebagai ketua tim dan anggota; gunakan bila pekerjaan memang perlu dikerjakan oleh tim spesialis. |
| **Studio Belajar/Akademi** | Materi belajar, kursus, tutor, asesmen, dan dukungan kompetensi. Status pendaftaran, progres, serta sertifikat mengikuti halaman masing-masing. |
| **AI Specialist Store/Produk** | Menemukan atau menggunakan AI Specialist dan produk digital yang tersedia. Lisensi, masa akses, dan biaya berkala mengikuti halaman produk/paket. |
| **LexCom dan layanan hukum** | Dukungan informasi dan analisis awal pada domain hukum yang tersedia. Bukan pengganti nasihat profesional atau keputusan lembaga berwenang. |
| **Afiliasi dan mitra** | Informasi referral atau pengelolaan mitra hanya tersedia bagi akun yang mendapat akses. Ketentuan komisi, kursi, dan branding mengikuti konfigurasi yang berlaku. |

### 4.2 Isi Yang Dapat Ditemui Dalam AI Specialist

Konfigurasi spesialis dapat mencakup:

- **System Prompt:** tujuan, ruang lingkup, metode kerja, batasan, dan perilaku agen.
- **Knowledge Base (KB):** dokumen atau teks yang menjadi sumber konteks; status pemrosesan dapat menunjukkan menunggu, diproses, selesai, atau gagal.
- **Persona & UX:** pesan pembuka, prompt cepat, dan status aktif/nonaktif bila dikelola oleh admin.
- **Model & RAG:** pilihan model dan pengaturan pengambilan potongan pengetahuan. Detail yang bisa diubah dibatasi oleh izin dan halaman admin.
- **Sub-Agents:** spesialis pendukung yang dihubungkan untuk tugas tertentu.

Isi konfigurasi admin bukan selalu konten yang terlihat langsung oleh pengguna. Jawaban AI bergantung pada model, instruksi, dokumen yang diizinkan, dan pertanyaan. Agen publik tidak membuat dokumen privat otomatis dapat diunduh.

### 4.3 Dokumen Dan Publikasi Pengetahuan

- Unggah hanya dokumen yang dimiliki atau diizinkan untuk digunakan.
- Pastikan nama, versi, status, dan kategori dokumen benar.
- Sumber privat tidak otomatis menjadi konteks bersama. Gunakan jalur publikasi yang memang tersedia dan minta persetujuan yang diperlukan.
- Publikasi KB adalah publikasi **salinan pengetahuan yang disetujui**, bukan pembukaan akses ke file asli di Ruang Simpan.
- Jika isi sumber berubah, tinjau ulang persetujuan/publikasi. Jangan berasumsi persetujuan lama tetap berlaku untuk konten baru.

### 4.4 AI Builder: Membuat Chatbot Baru Atau Mengustomisasi Claw

AI Builder adalah ruang kerja untuk merakit sistem AI milik akun Anda. Ini berbeda dari katalog **Produk AI/Store**: katalog menawarkan produk siap pakai, sedangkan AI Builder dipakai untuk membuat sistem baru atau membuat salinan privat dari Claw sistem.

**Cara membuka:**

1. Masuk ke akun Gustafta yang aktif.
2. Buka **Produk** (`/produk`) lalu pilih **Rakit AI Anda Sendiri → Buka AI Builder**, atau buka `/ai-builder`.
3. Di AI Builder, pilih salah satu jalur berikut.

Di Dashboard, pintasan **Rancang Agen (Blueprint Builder)** membuka jalur pembuatan manual yang sama. **Rakit Tim AI** adalah jalur berbeda untuk membentuk beberapa agen yang saling terhubung, bukan cara untuk mengubah satu Claw sistem.

**Jalur A — Membuat chatbot yang benar-benar baru**

1. Pilih **Bangun sistem secara manual** untuk membuka **Blueprint Builder** (`/blueprint-builder`).
2. Ikuti empat langkah inti untuk merumuskan kebutuhan dan konfigurasi agen. Tinjau rancangan sebelum menyimpan.
3. Setelah pembuatan berhasil, agen baru menjadi milik akun Anda dan bersifat privat secara default; agen tersebut tidak mengubah Claw sistem atau chatbot pengguna lain.
4. Pembuatan chatbot baru mengikuti **langganan aktif dan kuota chatbot akun**. Jika kuota habis, selesaikan atau tingkatkan paket sesuai pilihan yang tersedia sebelum membuat chatbot tambahan.

**Jalur B — Mengustomisasi Claw sistem**

1. Buka bagian **Kustomisasi privat** di AI Builder.
2. Pilih Claw yang tercakup oleh lisensi individual atau paket akses aktif Anda, lalu tekan **Kustomisasi**.
3. AI Builder membuat salinan privat untuk akun Anda. Perubahan pada salinan—misalnya prompt, Knowledge Base, Persona & UX, Model & RAG, atau Sub-Agents—tidak mengubah Claw sistem yang menjadi sumbernya.
4. Akses untuk memakai atau mengustomisasi Claw mengikuti lisensi individual atau paket akses Claw yang berlaku. Login saja tidak otomatis membuka semua Claw.

Sistem yang dibuat atau disalin tampil pada bagian **Sistem AI milik Anda** di AI Builder. Pilih **Buka sistem** untuk menuju Dashboard dan melanjutkan penggunaan/pengelolaan agen tersebut. Bila ingin membangun organisasi dengan beberapa agen yang terhubung, pilih jalur **Susun hierarki tim** (`/organization-builder`); jalur ini opsional dan dapat memakai lebih dari satu slot chatbot sesuai jumlah agen yang dibuat.

Monetisasi AI Builder tidak membuat biaya atau skema lisensi baru: pembuatan chatbot mengikuti langganan serta kuota akun yang sudah berlaku, sedangkan akses kustomisasi Claw sistem mengikuti lisensi atau paket akses Claw.

## 5. Ruang Simpan Dan Koneksi Aplikasi

Ruang Simpan adalah sumber dokumen bisnis pemilik, bukan folder bersama untuk semua AI Specialist.

### Untuk Pemilik Dokumen

1. Buka **Ruang Simpan** (`/ruang-simpan`), pilih atau unggah dokumen.
2. Periksa klasifikasi/status dan pastikan berkas tidak memuat data yang tidak boleh dibagikan.
3. Saat membuat koneksi aplikasi, pilih izin minimum. Aplikasi yang hanya membaca profil cukup diberi `profile:read`; akses file memerlukan izin file serta pilihan file/folder.
4. Simpan token sebagai secret di server aplikasi tujuan. Token ditampilkan satu kali; jangan tempelkan ke chat, URL, frontend, tiket, atau screenshot.
5. Periksa riwayat akses dan cabut koneksi yang tidak diperlukan.

### Untuk Aplikasi Yang Terhubung

Integrasi dilakukan server-ke-server dengan token dan cakupan yang diatur pemilik. Aplikasi tidak boleh meminta akses browser langsung ke data privat. Jangan meminta atau menyimpan token di repositori atau konten bantuan. Jika respons ditolak, periksa izin dan pilihan dokumen melalui pemilik—jangan melewati otorisasi.

## 6. Alur Tugas: Blueprint, Kolaborasi, Workroom

1. **Dialog:** jelaskan masalah, tujuan, pemilik tugas, tenggat, dan hasil yang dianggap selesai.
2. **Blueprint:** susun rencana, data yang diperlukan, risiko, dan pembagian peran.
3. **Konfigurasi/kolaborasi:** pilih agen dan konteks yang benar-benar relevan. Delegasi tidak memperluas hak akses dokumen.
4. **Workroom:** catat progres, bahan sumber yang dipilih, dan hasil kerja pada tugas milik sendiri.
5. **Gerbang manusia (◆):** gunakan persetujuan untuk langkah penting. Agen tidak dapat menyetujui tindakannya sendiri.
6. **Tinjau hasil:** cek bukti/sumber, asumsi, risiko, serta perubahan sejak persetujuan terakhir.

Jangan menyatakan pekerjaan selesai hanya karena agen menampilkan status selesai. Pastikan hasil atau bukti benar-benar tersedia. Simpan informasi penting pada tempat yang memang menjadi sumber resminya, bukan hanya di percakapan.

## 7. Menyimpan Perubahan Dan Memecahkan Masalah Umum

### Perubahan Tampak Hilang Setelah Disimpan

1. Tunggu indikator simpan atau notifikasi berhasil/gagal.
2. Jangan tutup halaman ketika status masih **Menyimpan**.
3. Setelah berhasil, muat ulang data atau buka kembali tab/agen untuk memastikan nilai terbaru tetap tampil.
4. Jika gagal, catat nama menu, tindakan terakhir, waktu, dan pesan error yang sudah disanitasi.
5. Untuk System Prompt, simpan salinan kerja di tempat aman sebelum mengubah teks panjang. Jangan menghapus marker/instruksi sistem yang ditandai penting.
6. Jangan mengulang tindakan yang mungkin sudah tersimpan jika responsnya tidak jelas—periksa nilai terkini dahulu.

### Menu Kosong Atau “Agent Not Found”

- Pastikan memilih agen/produk yang benar dan halaman tidak menggunakan tautan lama.
- Coba muat ulang setelah deployment terbaru selesai.
- Jika tetap kosong, laporkan nama menu dan teks error. Jangan mengganti ID atau slug secara manual.

### Mini App Tidak Dapat Digulir

- Pastikan pointer berada di area isi dialog/halaman, bukan di luar panel.
- Coba roda mouse, trackpad, atau tombol Tab/arah pada kontrol yang berfokus.
- Jika bagian bawah tetap terpotong, tutup dialog dan laporkan nama Mini App serta ukuran layar/browser.

### Akses Atau Langganan Tidak Sesuai

- Periksa akun yang sedang masuk, paket aktif, dan masa berlaku.
- Ambil tangkapan layar status tanpa menampilkan data sensitif.
- Hubungi admin dengan nama produk/fitur, waktu, dan bukti pembayaran yang disanitasi.

### Gangguan Layanan Atau Hasil AI

- Muat ulang sekali dan periksa koneksi.
- Untuk jawaban faktual, minta sumber atau tanggal acuan dan verifikasi ke dokumen resmi.
- Jika dokumen gagal diproses, jangan menganggapnya sudah menjadi KB; lihat status proses atau coba ulang sesuai petunjuk.
- Hindari mengirim permintaan berulang untuk aksi yang berdampak (pembayaran, pengiriman, perubahan konfigurasi) sebelum statusnya diketahui.

## 8. Panduan Untuk Admin

Admin mengoperasikan panel yang diizinkan, namun tidak mengelola akun admin atau mengubah peran admin.

### 8.1 Masuk Ke Panel

1. Gunakan akun admin yang telah disetujui.
2. Buka **Admin** (`/admin`) dari menu akun atau URL panel.
3. Pastikan identitas/peran pada panel tertulis **Admin**.
4. Jika fitur yang diperlukan tidak muncul, hentikan tindakan dan minta superadmin memeriksa kewenangan efektif.

### 8.2 Area Kerja Admin

Nama tab yang tersedia di panel dapat meliputi:

- **Pengguna:** memeriksa akun dan status, mengaktifkan/menonaktifkan pengguna sesuai kebijakan, serta memberi akses Early Adopter bila berwenang.
- **Langganan:** memeriksa dan mengelola status langganan sesuai bukti.
- **Trial:** meninjau permintaan trial dan memberikan keputusan sesuai aturan.
- **Modul:** mengelola akses modul yang tersedia di panel.
- **Store:** mengelola produk/penawaran yang memang menjadi kewenangan admin.
- **Scalev:** memeriksa konfigurasi produk/pesanan pada integrasi pembayaran yang tersedia.
- **Blueprint:** memeriksa pengajuan/rancangan yang masuk ke alur admin.
- **Tools:** alat operasional, termasuk menu yang ditampilkan sesuai izin.
- **Kategori Knowledge Base** (`/admin/taxonomy`): mengelola kategori, memperhatikan nama/slug dan riwayat perubahan.

Admin juga dapat diberi akses ke pengelolaan mitra, seat, dan permintaan top-up. Gunakan data minimum untuk menyelesaikan tiket; jangan menyalin isi dokumen privat ke komentar atau log.

### 8.3 Alur Aman Menangani Pengguna

1. Cari akun berdasarkan informasi yang diperlukan dan pastikan tidak memilih orang yang salah.
2. Periksa status akun, langganan, pembayaran, atau bukti permintaan.
3. Pilih tindakan paling sempit yang menyelesaikan masalah.
4. Jelaskan konsekuensi kepada pengguna bila perubahan membatasi akses.
5. Simpan bukti keputusan sesuai proses internal; hindari menyimpan token, kata sandi, atau isi dokumen pribadi.

## 9. Panduan Untuk Superadmin

Superadmin memiliki kewenangan platform yang lebih luas. Gunakan akun khusus dan lakukan perubahan penting dengan prinsip dua kali periksa.

### 9.1 Manajemen Admin

Di **Admin → Admin**, superadmin dapat:

- mengangkat/menurunkan peran Admin;
- mengaktifkan/menonaktifkan akun Admin;
- meninjau daftar dan status admin.

Sebelum perubahan peran, pastikan identitas dan kebutuhan bisnisnya benar. Pengubahan peran tidak boleh dipakai sebagai jalan pintas untuk menangani satu tiket pengguna.

### 9.2 Operasional Tambahan

Menu khusus yang dapat tersedia bagi superadmin antara lain **Product Registry**, **Sales Ladder**, **Product Bible**, **MultiClaw Admin**, serta area audit/operasional tertentu.

Di **MultiClaw Admin** (`/multiclaw-admin`), pengelolaan dapat mencakup:

1. **Knowledge Base:** meninjau sumber dan status proses; gunakan dokumen yang tervalidasi.
2. **System Prompt:** memperbarui instruksi agen. Simpan marker sistem yang dinyatakan penting, uji hasil setelah perubahan, dan pastikan notifikasi berhasil.
3. **Model & RAG:** ubah model atau parameter retrieval hanya jika ada alasan dan kriteria evaluasi.
4. **Persona & UX:** mengelola status aktif, greeting, dan prompt percakapan cepat.
5. **Sub-Agents:** mengatur spesialis pendukung; berikan konteks dan tanggung jawab seminimal mungkin.

Setelah perubahan MultiClaw, lakukan verifikasi:

- pilih agen yang tepat;
- simpan satu kelompok perubahan;
- tunggu notifikasi sukses;
- baca ulang konfigurasi dari server atau muat ulang halaman;
- uji dengan pertanyaan yang aman dan sesuai peran;
- cek bahwa dokumen privat tidak bocor ke pengguna yang tidak berhak.

Jangan menyamakan perubahan di workspace dengan perubahan pada domain publik. Perubahan baru tampil di produksi setelah proses publikasi selesai dan versi yang benar aktif.

### 9.3 Kontrol Berisiko Tinggi

- Jangan melakukan perubahan massal pada agen, model, akses, atau data tanpa ruang lingkup dan rencana pemulihan yang jelas.
- Jangan mengaktifkan jadwal monitor, mengirim ping produksi, mengirim notifikasi, atau menjalankan operasi eksternal hanya untuk menguji tanpa persetujuan tersendiri.
- Menu pemulihan data lama hanya untuk proses yang telah memenuhi prasyarat bukti dan persetujuan; status superadmin sendiri bukan bukti arsip.
- Jangan memakai SQL atau endpoint internal untuk menghindari kontrol UI/API.
- Jangan menyalin konten pribadi, token, atau identitas sensitif ke laporan bersama.

## 10. Praktik Keamanan Dan Privasi Untuk Semua Peran

1. Jangan berbagi akun, kata sandi, token, API key, atau kode pemulihan.
2. Gunakan file dan data yang memang boleh diproses. Data milik orang lain tidak menjadi terbuka hanya karena suatu agen bersifat publik.
3. Beri akses koneksi aplikasi secukupnya dan cabut saat tidak dibutuhkan.
4. Periksa penerima, domain, dan tujuan sebelum mengirim atau mempublikasikan dokumen.
5. Tinjau keluaran AI sebelum dipakai untuk keputusan, publikasi, kontrak, pembayaran, atau kepatuhan.
6. Jangan menganggap respons “berhasil” atau halaman konfirmasi sebagai bukti pembayaran/aktivasi jika status server belum mengonfirmasi.
7. Laporkan insiden dengan waktu, menu, langkah reproduksi, dan pesan error yang sudah disanitasi.

## 11. Daftar Periksa Singkat

### Sebelum Memulai Pekerjaan

- [ ] Saya memakai akun dan peran yang benar.
- [ ] Tujuan, keluaran, dan batas pekerjaan jelas.
- [ ] Dokumen yang dipakai memang boleh saya akses.
- [ ] Saya memilih spesialis/alat yang sesuai.

### Sebelum Menyimpan Atau Menerbitkan

- [ ] Saya memeriksa agen, dokumen, versi, penerima, dan ruang lingkup yang benar.
- [ ] Saya melihat konfirmasi berhasil dan membaca ulang perubahan.
- [ ] Saya tidak memasukkan secret ke prompt, chat, atau dokumen.
- [ ] Saya meminta persetujuan manusia untuk tindakan yang berdampak.

### Sebelum Melaporkan Selesai

- [ ] Hasil benar-benar tersedia, bukan hanya status yang dinyatakan agen.
- [ ] Sumber, asumsi, risiko, dan hal yang belum diketahui dicatat.
- [ ] Tidak ada akses atau konten privat yang ikut terbuka.

## 12. Glosarium

| Istilah | Arti |
|---|---|
| **AI Specialist / Claw** | Agen AI dengan spesialisasi, instruksi, dan lingkup pekerjaan tertentu. |
| **MultiClaw** | Tim beberapa AI Specialist yang berkoordinasi melalui peran dan subtugas. |
| **System Prompt** | Instruksi dasar yang menentukan peran, cakupan, dan perilaku agen. |
| **Knowledge Base (KB)** | Sumber teks/dokumen yang diizinkan untuk membantu jawaban agen. |
| **RAG** | Cara mengambil bagian sumber yang relevan saat agen menjawab; bukan akses bebas ke semua dokumen. |
| **Blueprint** | Rancangan solusi, pekerjaan, atau tim sebelum konfigurasi/pelaksanaan. |
| **Workroom** | Alur tugas untuk progres, hasil, sumber, serta persetujuan manusia. |
| **Gerbang manusia (◆)** | Titik yang memerlukan keputusan orang yang berwenang sebelum pekerjaan tertentu dilanjutkan. |
| **Superadmin** | Peran pengelola platform dengan kewenangan tambahan, termasuk manajemen admin; bukan izin otomatis atas semua data privat. |

## 13. Rujukan Lanjutan

- [Dokumentasi fitur Gustafta](https://gustafta.my.id/documentation)
- [Panduan integrasi Ruang Simpan](ruang-simpan-app-integration.md)
- [Daftar MultiClaw](multiclaw-routes.md)
- [Aturan sumber dan akses KB](access-inventory-blueprint-workroom-kb.md)
- [Blueprint Gustafta Apps](gustafta-apps-blueprint.md)
- [Peta implementasi Blueprint](gustafta-apps-blueprint-mapping.md)
