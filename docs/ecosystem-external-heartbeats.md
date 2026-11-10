# Pemantau jadwal pemeriksaan di luar GitHub

Workflow `ecosystem-link-health.yml` berjalan sekali sehari (02:17 UTC) dan
`ecosystem-monitor-watchdog.yml` dua kali sehari (10:31 dan 18:31 UTC).
Pengawas di GitHub tidak bisa memberi kabar jika **semua** event terjadwal
GitHub berhenti. Karena itu, dua cron check pada layanan **Healthchecks.io**
dan dua monitor terpisah pada **Cronitor** harus dijalankan di luar GitHub.
Masing-masing penyedia memeriksa ketiadaan ping dan mengirim peringatan
sendiri, bukan GitHub Actions. Kegagalan satu penyedia tidak menghentikan
ping atau timer penyedia lainnya.

## Pengaktifan Healthchecks oleh pengelola

1. Daftar/masuk di [Healthchecks.io](https://healthchecks.io/), lalu buat
   **dua check** terpisah di satu project. Pilih jenis jadwal **Cron**,
   bukan Simple:

   | Nama check | Cron expression | Timezone | Grace Time |
   | --- | --- | --- | --- |
   | Gustafta pemeriksaan ekosistem | `17 2 * * *` | UTC | 6 jam |
   | Gustafta pengawas ekosistem | `31 10,18 * * *` | UTC | 5 jam |

   Grace memberi ruang untuk keterlambatan jadwal GitHub, tetapi masih
   mendeteksi hilangnya kedua jadwal dalam hari yang sama. Jangan memakai
   satu check gabungan; setiap workflow mempunyai jadwal dan ping URL sendiri.
2. Di **Integrations** pada project Healthchecks yang sama, tambahkan
   **Email** untuk alamat email operasional; selesaikan verifikasi alamat
   jika diminta. Tambahkan juga integrasi **Telegram** sebagai saluran
   cadangan yang tidak bergantung pada kotak masuk email maupun GitHub:
   dari aplikasi Telegram pengelola, mulai percakapan dengan
   [@HealthchecksBot](https://t.me/HealthchecksBot), kirim `/start`,
   buka tautan konfirmasi yang dibalas bot, pilih project yang memuat
   **kedua check** di atas, lalu pilih **Connect Telegram**. Gunakan
   penerima Telegram yang benar-benar dipantau pengelola; jangan gunakan
   pengalihan email-ke-Telegram. Di halaman **Checks**, pastikan ikon
   **Email** dan **Telegram** sama-sama **ON pada masing-masing dari dua
   check** (empat tanda ON). Integrasi yang hanya terpasang di project
   tetapi OFF pada salah satu check bukan jalur peringatan untuk check itu.
   Di **Account Settings > Email Reports**, nonaktifkan **hourly/daily reminders**;
   jangan aktifkan escalation atau notifikasi berulang di kedua kanal.
   Satu masa gangguan hanya perlu satu pesan down per check
   per kanal (dan satu pesan pemulihan saat up).
3. Salin masing-masing **ping URL** dari Healthchecks langsung ke GitHub
   repository: **Settings > Secrets and variables > Actions > Secrets >
   New repository secret**. Buat:

   | Nama secret di GitHub | Isi |
   | --- | --- |
   | `ECOSYSTEM_CHECK_HEARTBEAT_URL` | Ping URL check pemeriksaan ekosistem |
   | `ECOSYSTEM_WATCHDOG_HEARTBEAT_URL` | Ping URL check pengawas ekosistem |

   Jangan kirim URL itu melalui chat, commit, log, atau dashboard publik.
   URL adalah kredensial untuk menandai check sehat. Jangan gunakan URL
   yang sama untuk keduanya. Pastikan Actions di default branch memakai
   workflow versi ini.
4. **Verifikasi dua saluran tanpa mengganggu produksi:** buat satu check
   uji sementara dalam project yang sama, Cron tiap menit
   (`* * * * *`, UTC), Grace Time 1 menit. Aktifkan Email **dan** Telegram
   untuk check uji. Kirim **satu** ping kosong ke URL *check uji* melalui
   tombol ping manual di layanan jika tersedia, atau dari terminal pribadi
   dengan `curl -X POST -d '' '<PING_URL_UJI>'`. Biarkan check uji down;
   pastikan pengelola benar-benar menerima **dua** pesan down, masing-masing
   di kotak masuk email dan aplikasi Telegram (bukan sekadar status
   "terkirim" di dashboard). Hapus check uji setelah verifikasi, agar
   tidak berulang kali mengirim peringatan. Jangan tempel URL ping check
   produksi maupun check uji ke chat, commit, terminal bersama, atau log.
   Jangan kirim hasil pemeriksaan, URL aplikasi, maupun secret sebagai
   isi ping. Periksa lagi empat tanda ON pada dua check produksi, lalu
   amati ping **jadwal**, bukan `workflow_dispatch`, di masing-masing.
   Check baru mungkin belum memberi peringatan sebelum ping pertamanya;
   jangan anggap perlindungan aktif sampai keduanya menunjukkan ping
   jadwal dan **kedua pesan uji diterima**. Log langkah
   `Heartbeat scheduled ...` hanya berisi status, bukan URL atau respons.

5. **Uji ulang setiap bulan** (misalnya hari kerja pertama) dengan
   **satu check uji sementara**, cara yang sama seperti langkah 4. Pasang
   pengingat kalender di luar GitHub dan email operasional, misalnya di
   kalender perangkat pengelola. Catat tanggal, nama kedua check produksi,
   bahwa keempat tanda ON terlihat, dan apakah pesan down diterima di
   masing-masing kanal; jangan catat tautan konfirmasi bot, ping URL,
   isi pesan, log, atau secret. Bila salah satu pesan tidak diterima,
   perbaiki konfigurasi/kanalnya dan ulangi satu uji terkontrol sebelum
   menganggap sistem terlindungi. Jangan menunggu pengingat email dari
   penyedia untuk membuktikan jalur email bekerja. Jangan membiarkan
   check uji tetap aktif atau mengulang ping berkali-kali.

Workflow hanya mengirim POST kosong ketika `github.event_name == schedule`.
Heartbeat menandakan **jadwal berhasil dimulai**, bukan hasil pemeriksaan
aplikasi. Kegagalan pemeriksaan tetap ditangani oleh laporan/pengawas yang
sudah ada; kegagalan ping tidak menghentikan pemeriksaan aplikasi. Jika
kedua jadwal GitHub terhenti, dua check eksternal menjadi down tanpa
memerlukan GitHub untuk menjalankan pemeriksaan apa pun. Pesan dari
penyedia hanya menyebut nama check dan status down/up: beri nama check
yang generik seperti tabel di atas, sebab nama check terlihat di kedua
kanal. Tidak ada log, URL aplikasi, hasil pemeriksaan, atau secret yang
dikirim sebagai isi ping. Telegram dan email dikirim oleh Healthchecks,
bukan oleh kedua workflow GitHub, sehingga hilangnya jadwal GitHub tetap
dapat memicu dua saluran tersebut.

**Batasan:** Jalur Healthchecks memerlukan akun dan konfigurasi Email+Telegram
di penyedia tersebut serta dua secret GitHub di atas. Tanpa pengaktifan tersebut,
workflow akan mencatat `heartbeat is not configured` pada jadwal dan
tidak ada peringatan dari Healthchecks. Jika layanan atau email pengelola
sendiri mati, ia tidak bisa menjamin pengiriman peringatan; dua kanal
mengurangi risiko kegagalan satu transport, bukan kegagalan penyedia itu
sendiri. Jalur Cronitor di bawah ini melindungi kegagalan Healthchecks.
Verifikasi penerimaan manusia tetap diperlukan.

## Jalur kedua: Cronitor (penyedia terpisah)

Cronitor mengelola jadwal dan pengiriman peringatannya sendiri; jangan
menjadikan Healthchecks, GitHub Actions, atau Brevo sebagai pemicu
peringatannya. [Dokumentasi heartbeat Cronitor](https://cronitor.io/docs/heartbeat-monitoring),
[telemetry](https://cronitor.io/docs/telemetry-api), dan
[notifikasi](https://cronitor.io/docs/alerts) menjadi acuan pengaturan.

1. Pada akun Cronitor, buat **dua monitor tipe Heartbeat**, bukan satu
   monitor gabungan atau Job yang menunggu event `complete`. Atur jadwal
   cron (UTC), grace, dan nama yang tidak memuat laporan atau URL:

   | Nama | Schedule | Timezone | Grace |
   | --- | --- | --- | --- |
   | Gustafta jadwal pemeriksaan | `17 2 * * *` | UTC | 6 jam (21600 detik) |
   | Gustafta jadwal pengawas | `31 10,18 * * *` | UTC | 5 jam (18000 detik) |

   Jadwal harus dinilai dari ping pertama hingga tenggat berikutnya; jangan
   menganggap monitor aktif sebelum dua ping **schedule** diterima. Gunakan
   toleransi keterlambatan sesuai tabel, tanpa *schedule tolerance* tambahan.
2. Di **Settings > Integrations**, aktifkan penerima **Telegram** yang
   benar-benar dibaca pengelola (atau kanal langsung non-email lainnya).
   Di **Settings > Alerts**, buat satu Notification List dengan penerima
   tersebut dan pasang pada **kedua** monitor; jangan memakai email
   Healthchecks sebagai satu-satunya jalur Cronitor. Nonaktifkan
   eskalasi, pengulangan notifikasi, dan pengingat berkala. Target:
   satu peringatan *down* untuk satu insiden per monitor, lalu paling banyak
   satu pemulihan bila diaktifkan.
3. Simpan **base Telemetry URL** masing-masing monitor secara terpisah
   sebagai repository Actions secret:

   | Nama secret | Isi |
   | --- | --- |
   | `ECOSYSTEM_CHECK_CRONITOR_URL` | URL telemetry heartbeat pemeriksaan |
   | `ECOSYSTEM_WATCHDOG_CRONITOR_URL` | URL telemetry heartbeat pengawas |

   Gunakan URL HTTPS `cronitor.link` yang dihasilkan Cronitor untuk masing-masing
   monitor; jangan tambahkan `state=fail`, `message`, atau isi laporan.
   URL yang mengandung API key bersifat rahasia. Jangan tempel URL ke chat,
   commit, screenshot, atau log; bila terungkap, cabut/rotasi kunci atau
   buat ulang monitor sebelum melanjutkan. Workflow hanya POST dengan
   body kosong pada event `schedule`, masing-masing langkah tetap berjalan
   walau langkah Healthchecks gagal. `workflow_dispatch` dan `workflow_run`
   tidak mengirim ping ke keduanya. Ping menyatakan jadwal dimulai, **bukan**
   bahwa pemeriksaan berhasil.
4. **Buktikan penerimaan manusia tanpa mengganggu monitor produksi.**
   Buat satu monitor uji Heartbeat sementara pada Cronitor, jadwal tiap
   menit (`* * * * *`, UTC), grace satu menit; pasang Notification List yang
   sama. Kirim satu ping kosong dari terminal pribadi ke URL uji, lalu
   hentikan ping. Setelah status *down*, pastikan pengelola **menerima**
   satu pesan di aplikasi penerima, bukan hanya melihat status terkirim di
   dashboard. Jangan kirim event `fail` berulang. Segera hapus monitor uji
   setelah pembuktian, sebelum tenggat pengingat selanjutnya; pastikan tidak
   muncul peringatan kedua. Catat hanya tanggal, nama monitor uji, kanal,
   diterima ya/tidak, dan bahwa monitor uji telah dihapus. Jangan simpan
   isi pesan, identitas penerima, URL ping, laporan, atau secret. Periksa
   juga bahwa dua monitor produksi menerima ping *schedule* dari default
   branch. Bila tidak diterima, perbaiki jalur penerima dan lakukan satu
   uji terkontrol lagi; jangan klaim perlindungan aktif sebelum berhasil.
5. Ulangi uji sementara ini tiap bulan dengan pengingat di luar GitHub dan
   Healthchecks. Periksa kedua monitor produksi dan bahwa daftar penerima
   masih terpasang, tanpa membuat peringatan produksi. Jika salah satu
   penyedia mengalami gangguan, cek status penyedia lain secara mandiri;
   jangan menonaktifkan timer atau peringatan yang masih bekerja.

**Status operasional:** Konfigurasi workflow dan uji lokal tidak membuktikan
akun Cronitor, repository secrets, ping jadwal pada default branch, atau
penerimaan pesan manusia sudah aktif. Keempat hal itu wajib dikonfirmasi
pengelola secara terpisah; jangan menyamakan uji simulasi dengan bukti
penerimaan.

### Audit konfigurasi Healthchecks dan Cronitor

Workflow `ecosystem-cronitor-config-audit.yml` masih **draf manual**:
jadwal produksi dinonaktifkan dan memerlukan persetujuan aktivasi terpisah.
Jadwal yang direncanakan adalah Senin 07:13 UTC. Langkah audit API **tidak**
mengirim telemetry, `state=fail`, atau
perubahan monitor. Ia membandingkan tipe Heartbeat, cron UTC, grace,
schedule tolerance nol, keadaan tidak paused, Notification List yang
terpasang, status list, serta **jenis dan identitas penerima** dalam list.
Perubahan apa pun, respons API rusak/tidak tersedia, atau secret yang belum
disiapkan membuat audit gagal (bukan dianggap sehat). Pada jadwal, kegagalan
memicu email generik melalui Brevo, **bukan Cronitor**; workflow tetap gagal
agar terlihat pada GitHub Actions. `workflow_dispatch` hanya membaca dan
menampilkan status aman (`ok`, `drift`, `provider_error`, `config_error`):
tidak mengirim email, bahkan saat gagal. Heartbeat jadwal terpisah di bawah
hanya dapat mengirim ping setelah aktivasi disetujui pada event `schedule`.

Pengelola perlu menambahkan dua **repository Actions secrets** (bukan Replit
Secrets), tanpa menyalin nilainya ke chat, issue, log, atau dokumen:

1. `CRONITOR_AUDIT_API_KEY`: kunci Cronitor terpisah dengan izin
   `monitor:read` saja (untuk GET monitor dan notification list), **bukan**
   telemetry URL atau telemetry key. Jangan beri `monitor:write`.
2. `CRONITOR_AUDIT_BASELINE`: JSON satu baris berikut, diisi secara privat
   dari konfigurasi yang telah diperiksa di dashboard. `key` adalah *monitor
   key* pada Cronitor (bukan nama tampilan atau telemetry URL); `list` adalah
   key Notification List **non-default** yang terpasang pada monitor.
   `notifications` berisi semua kanal dan identitas tujuan sesuai yang
   dikembalikan API notification list, termasuk `telegram` dan kanal lain.
   Bila kedua monitor memakai list yang sama, ulangi nilai list/notifications
   yang sama pada kedua bagian. Contoh di bawah hanya ilustrasi, bukan
   konfigurasi operasional:

   ```json
   {"checker":{"key":"KEY_MONITOR_PEMERIKSAAN","list":"KEY_LIST","notifications":{"telegram":["TUJUAN_TELEGRAM"]}},"watchdog":{"key":"KEY_MONITOR_PENGAWAS","list":"KEY_LIST","notifications":{"telegram":["TUJUAN_TELEGRAM"]}}}
   ```

   Jangan masukkan identitas penerima asli ke repo. Cocokkan format/nama
   kanal dengan hasil API Cronitor secara privat; jangan tempel hasil API
   mentah di log. Jika penyedia mengubah format respons, audit akan gagal
   tertutup hingga baseline dan pembacanya diperiksa. Default Notification
   List sengaja ditolak agar pelepasan list khusus tidak tersembunyi di
   balik fallback default.

Pastikan `BREVO_API_KEY` dan `BREVO_ALERT_EMAIL` sudah ada sebagai Actions
secrets, dan alamat pengirim (`BREVO_SENDER_EMAIL` opsional) sudah terverifikasi.
Jalankan manual sekali setelah setup: hanya status audit, tidak ada peringatan
produksi. Lihat hasil workflow terjadwal pertama, lalu konfirmasi email
peringatan audit secara terkontrol menggunakan **mock lokal** atau kredensial
uji, bukan dengan melepaskan kanal/ping monitor produksi. Audit tidak
membuktikan pesan Cronitor benar-benar diterima manusia; uji sementara bulanan
di atas tetap wajib. Jika GitHub berhenti menjalankan schedule audit, audit
ini juga berhenti; check jadwal utama tidak membuktikan jadwal audit hidup.
Rancangan timer audit terpisah di bawah menutup celah tersebut **setelah**
aktivasi disetujui. Pengaktifan akun dan secret belum terverifikasi hanya
dari perubahan kode ini.

#### Timer eksternal khusus jadwal audit konfigurasi (belum aktif)

**Status: persiapan lokal saja.** Jangan membuat akun/check, mengisi secret,
mengaktifkan jadwal, atau mengirim ping produksi dalam pekerjaan persiapan.
Pengelola harus menyetujui penyiapan akun dan aktivasi secara terpisah.
Workflow tetap hanya `workflow_dispatch`; tidak ada pemicu `schedule` aktif.

Setelah persetujuan, siapkan **satu check Healthchecks baru dan satu monitor
Cronitor baru** dengan nama generik “Gustafta jadwal audit konfigurasi”.
Jangan gunakan kembali check, monitor, atau URL pemeriksa, watchdog, maupun
status peringatan GitHub. Pengiriman yang aktif pada ketiga jalur lain
tidak boleh memperpanjang timer audit.

| Penyedia | Jenis | Cron expression | Timezone | Grace |
| --- | --- | --- | --- | --- |
| Healthchecks.io | Cron | `13 7 * * 1` | UTC | 24 jam (86400 detik) |
| Cronitor | Heartbeat | `13 7 * * 1` | UTC | 24 jam (86400 detik) |

Cronitor memakai schedule tolerance **0**. Jadwal ini berarti Senin 07:13 UTC;
bila satu kesempatan hilang, tenggat down adalah **Selasa 07:13 UTC**,
bukan tujuh hari setelah ping pemeriksa/watchdog terakhir. Provider memiliki
timer dan pengiriman notifikasi sendiri, tanpa memerlukan GitHub Actions,
Issues, Brevo, atau aplikasi Gustafta berjalan. Dua provider mengurangi
ketergantungan pada satu penyedia; ini bukan jaminan keduanya selalu tersedia.

Healthchecks: Email dan Telegram harus ON pada **check audit baru**.
Cronitor: pasang Notification List non-default dengan kanal non-email
langsung yang dipantau pengelola. Periksa tujuan dan aktivasi secara privat,
bukan hanya nama/alias. Nonaktifkan reminders/escalation/pengulangan seperti
prosedur sebelumnya: satu down per kanal per gangguan, lalu satu pemulihan.
Peringatan harus menyebut jadwal audit tidak teramati, **bukan aplikasi mati
atau konfigurasi pasti berubah**.

Siapkan repository **Actions secrets** baru (bukan Replit Secrets):

| Secret | Isi privat |
| --- | --- |
| `ECOSYSTEM_CONFIG_AUDIT_HEARTBEAT_URL` | Ping URL check Healthchecks khusus audit |
| `ECOSYSTEM_CONFIG_AUDIT_CRONITOR_URL` | Base telemetry URL Cronitor khusus audit |

Periksa di dashboard bahwa masing-masing target berbeda dari semua monitor
lama; nama secret berbeda saja tidak membuktikan URL/check berbeda. Jangan
menyalin nilai, UUID, tujuan penerima, atau tangkapan layar ke repo/chat/log.
Setelah persetujuan aktivasi dan penyiapan target, pengelola perlu:

1. Menambahkan cron audit `13 7 * * 1` pada default branch, **tanpa mengubah**
   batasan event pada heartbeat maupun email kegagalan audit.
2. Mengatur repository **Actions variable**
   `ECOSYSTEM_CONFIG_AUDIT_HEARTBEATS_ENABLED` tepat ke string `true`.
   Nilai hilang, `false`, atau nilai lain menahan kedua ping. Variable saja
   tidak mengaktifkan schedule; menambah schedule saja tidak mengirim ping.
3. Memastikan kedua target eksternal aktif dan menerima ping dari event
   `schedule` pertama. Periksa jadwal/grace dan kedua kanal, termasuk
   pemulihan setelah masa penyiapan. Jangan menyatakan perlindungan aktif
   sebelum bukti tersebut tersedia. Bila jadwal akan dihentikan secara
   sengaja, pause hanya timer audit di provider lewat persetujuan operator;
   mematikan variable saja akan menghasilkan alarm ketiadaan ping.

Kedua POST kosong ditempatkan **sebelum checkout, setup-node, npm ci, dan
audit API**. Masing-masing best-effort (`continue-on-error`), sehingga
kegagalan Healthchecks tidak melewatkan Cronitor, dan sebaliknya.
Output curl/respons disembunyikan; tidak ada laporan atau identitas dalam
body. Ping berarti **event jadwal mencapai langkah awal**, bukan audit
selesai atau hasil `ok`. Kegagalan audit yang berjalan tetap melalui Brevo
dan job gagal; kegagalan sebelum audit dimulai tetap terlihat pada job
GitHub, tetapi tidak dicakup sebagai kegagalan penyelesaian oleh timer ini.
Pemantauan penyelesaian audit adalah sinyal berbeda dari jadwal.

`workflow_dispatch`, termasuk audit manual gagal, tidak mengirim ping
maupun email. `workflow_run`, push, dan PR juga tidak dapat mengirim ping.
Menjalankan pemeriksa/watchdog, atau mengirim ping ke check mereka,
tidak memulihkan timer audit. Jangan menambahkan fallback ping audit
ke workflow lain atau memakai ping manual sebagai bukti schedule hidup.
Audit API yang ada tetap memeriksa baseline dua check utama; penambahan
timer audit tidak otomatis memperluas cakupan audit konfigurasinya sendiri.

**Simulasi lokal (tidak menghubungi provider):** tes menjalankan blok shell
workflow dengan curl palsu, mengevaluasi gate event/aktivasi, dan menghitung
tenggat mingguan UTC. Setelah satu ping audit terjadwal, pemeriksa/watchdog
terus ping sementara dua Senin audit dilewati; kedua timer audit tetap
down sejak Selasa pertama. Skenario semua jadwal berhenti, manual run,
pemulihan schedule, pergantian bulan/tahun, dan gagal kirim salah satu
provider juga diperiksa. Ini membuktikan rancangan, **bukan** timer
provider atau penerimaan manusia.

```sh
npx tsx --test tests/ecosystem-config-audit-heartbeats.test.ts tests/ecosystem-draft-activation.test.ts
```

**Uji penerimaan setelah persetujuan terpisah:** gunakan check/monitor
disposable khusus audit, bukan target produksi. Percepat cron menjadi
`*/2 * * * *`, UTC, grace 60 detik, tanpa toleransi tambahan.
Kirim satu ping kosong beberapa detik setelah 12:00 UTC; hentikan ping
sehingga slot 12:02 hilang dan down diharapkan pada 12:03. Konfirmasi satu
down diterima manusia pada masing-masing kanal, lalu satu ping kosong
pemulihan dan satu pesan up per kanal. Bila tidak diterima dalam 10 menit
setelah tenggat, tandai belum berhasil, jangan mengulang ping tanpa diagnosis.
Hapus check/monitor sementara setelah uji; jika gagal, pause hanya fixture
sementara sambil menyelesaikan penghapusannya. Pastikan monitor produksi
tidak berubah. Catat hanya waktu UTC, penyedia, jadwal/grace, jenis kanal,
down/up diterima ya/tidak, dan penghapusan fixture, tanpa URL/identitas/isi
pesan. Ulangi uji kanal minimal bulanan dengan pengingat di luar GitHub.
Aktivasi, penyiapan akun, dan penerimaan manusia **belum dibuktikan** di sini.

#### Dua check Healthchecks: jadwal, grace, dan empat tanda ON

Workflow yang sama juga menjalankan `scripts/audit-healthchecks-config.ts`.
Kegagalan audit Cronitor tidak melewatkan audit Healthchecks. Hasil setiap
check dicatat hanya dengan alias tetap `checker`/`watchdog` dan status
`ok`, `drift`, `provider_error`, atau `config_error`; jika salah satu audit
gagal, job tetap gagal. Ketika jadwal kelak disetujui dan diaktifkan,
peringatan generik dikirim lewat **Brevo**, di luar kedua penyedia monitor.
Audit manual tidak mengirim email maupun ping produksi, termasuk saat gagal.

Audit membandingkan cron dan grace tabel Healthchecks di atas, timezone UTC,
check tidak paused, serta daftar integrasi yang tepat pada **masing-masing**
check. Email atau Telegram yang tersedia di project tetapi dilepas dari
satu check menjadi drift pada check itu. Penggantian ID, jenis, atau nama
integrasi juga terdeteksi. Audit hanya melakukan GET ke endpoint tetap
Management API v3: `/channels/` dan `/checks/<uuid>`. Redirect ditolak;
URL dalam respons tidak pernah diikuti. Respons, error mentah, nama check,
UUID, nama penerima, dan ping URL tidak dicetak maupun dikirim lewat email.

Siapkan **repository Actions secrets** secara privat:

- `HEALTHCHECKS_AUDIT_API_KEY`: kunci **read-write Management API** khusus
  project kedua check, dari Project Settings. Ini bukan URL ping.
  [API resmi Healthchecks](https://healthchecks.io/docs/api/) tidak mengizinkan
  pembacaan `/channels/` dengan kunci read-only dan menghilangkan field
  `channels` pada respons check read-only. Karena itu kunci read-only tidak
  cukup membuktikan empat tanda ON; respons tersebut gagal tertutup.
  Walaupun izin kunci lebih luas, skrip audit **tidak melakukan write**.
  Jangan pakai kunci ini pada workflow PR atau menyalin nilainya ke chat.
- `HEALTHCHECKS_AUDIT_BASELINE`: JSON privat dengan tepat dua bagian
  `checker` dan `watchdog`. Setiap bagian berisi `uuid` check serta tepat
  dua integrasi `channels`, satu `email` dan satu `telegram`.
  Setiap integrasi berisi `id`, `kind`, dan `name` sesuai API. Ambil UUID
  dan ID secara privat setelah memeriksa empat tanda ON; UUID check juga
  memungkinkan penyusunan URL ping, jadi perlakukan sebagai rahasia.
  Kedua check harus berbeda; keduanya boleh memakai integrasi yang sama.

Contoh **hanya struktur**, bukan nilai operasional:

```json
{"checker":{"uuid":"UUID_CHECK_PEMERIKSAAN","channels":[{"id":"UUID_EMAIL","kind":"email","name":"ALIAS_EMAIL"},{"id":"UUID_TELEGRAM","kind":"telegram","name":"ALIAS_TELEGRAM"}]},"watchdog":{"uuid":"UUID_CHECK_PENGAWAS","channels":[{"id":"UUID_EMAIL","kind":"email","name":"ALIAS_EMAIL"},{"id":"UUID_TELEGRAM","kind":"telegram","name":"ALIAS_TELEGRAM"}]}}
```

**Batas API:** v3 menampilkan ID, jenis, nama, dan keterkaitan integrasi,
bukan alamat email/chat ID, status verifikasi email, atau status disabled
global integrasi. `ok` membuktikan konfigurasi yang terlihat API, **bukan**
penerimaan manusia atau tidak adanya perubahan tujuan di balik ID/nama
yang sama. Field yang tidak didokumentasikan tidak digunakan sebagai bukti.
Uji kanal sementara bulanan tetap wajib; jangan
menyatakan seluruh jalur sehat hanya karena audit `ok`. Status check
`down` sendiri bukan drift konfigurasi dan tidak memicu ping tambahan.
API ditolak, timeout, JSON rusak, atau field wajib hilang tidak dianggap sehat.

Jalankan simulasi tanpa kredensial atau akses penyedia:

```sh
npx tsx --test tests/ecosystem-cronitor-config-audit.test.ts tests/ecosystem-draft-activation.test.ts
```

Tes mencakup konfigurasi sehat, pelepasan kanal pada setiap check, perubahan
jadwal/grace/jenis/nama, dan kegagalan API. Setelah secrets disiapkan,
jalankan workflow manual sekali. Jangan mengubah konfigurasi produksi atau
mengirim ping gagal untuk menguji audit. Pengaktifan secrets dan penerimaan
peringatan operasional belum dibuktikan oleh tes lokal.

### Verifikasi operator untuk tujuan dan aktivasi yang tidak terlihat API

Sumber yang dievaluasi: [Management API v3](https://healthchecks.io/docs/api/#list-channels)
dan [pengaturan notifikasi resmi](https://healthchecks.io/docs/configuring_notifications/).
API hanya mendokumentasikan ID/jenis/nama integrasi; tidak ada sumber
read-only terdokumentasi untuk semua properti yang diperlukan. Karena itu
audit memakai **observasi operator dari dashboard resmi**, bukan scraping,
endpoint internal, atau dugaan field `disabled`/`verified`.

Siapkan dua repository Actions secrets tambahan, terpisah dari acuan API:

- `HEALTHCHECKS_DESTINATION_BASELINE`: acuan privat yang disetujui penanggung
  jawab. Bentuk `{"version":1,"channels":[{"id":"UUID_EMAIL","kind":"email",
  "destination":"EMAIL_YANG_DISETUJUI"},{"id":"UUID_TELEGRAM","kind":"telegram",
  "destination":"IDENTITAS_CHAT_YANG_DISETUJUI"}]}`. Sertakan **semua ID unik**
  dari kedua check pada `HEALTHCHECKS_AUDIT_BASELINE`; jika masing-masing
  check memakai integrasi berbeda, sertakan keempatnya. Jangan menyalin
  tujuan aktual yang berubah ke acuan hanya agar audit hijau.
- `HEALTHCHECKS_OPERATOR_VERIFICATION`: observasi terpisah oleh operator
  berwenang, bukan respons API. Bentuk:

  ```json
  {"version":1,"source":"dashboard","status":"available","checkedAt":"2026-10-18T10:00:00.000Z","channels":[{"id":"UUID_EMAIL","kind":"email","destination":"EMAIL_YANG_DILIHAT","enabled":true,"emailVerified":true,"receiptConfirmed":true},{"id":"UUID_TELEGRAM","kind":"telegram","destination":"IDENTITAS_CHAT_YANG_DILIHAT","enabled":true,"emailVerified":null,"receiptConfirmed":true}]}
  ```

Contoh di atas hanya struktur dengan placeholder, bukan bukti operasional.
Jangan simpan JSON nyata di repositori, input workflow, issue, chat, artefak,
atau log. Jangan gunakan `echo`, `set -x`, maupun argumen command line untuk
mengisi nilai rahasia. Gunakan antarmuka repository Actions secrets.

**Prosedur operator saat aktivasi, setiap perubahan, dan minimal bulanan:**

1. Buka project dan detail setiap integrasi di dashboard Healthchecks resmi.
   Cocokkan ID dengan acuan API secara privat; nama/alias saja tidak cukup.
2. Baca tujuan sebenarnya. Catat email persis sebagaimana tampil dan gunakan
   identitas Telegram yang tidak ambigu (bukan sekadar nama tampilan).
   Cocokkan dengan acuan tujuan yang telah disetujui. Jika dashboard tidak
   mengungkap tujuan dengan jelas, jangan mengasumsikan cocok.
3. Periksa aktivasi **global**, peringatan integrasi, dan verifikasi email.
   `enabled` berarti global, bukan hanya ON pada baris check. Bila status
   tidak dapat dipastikan, jangan mencatat `true`.
4. Lakukan uji penerimaan dengan check **sementara/disposable** sebagaimana
   prosedur bulanan di atas. Pastikan pemilik email dan chat yang diharapkan
   mengonfirmasi penerimaan; barulah `receiptConfirmed: true`. Jangan gunakan
   check produksi atau ping kegagalan produksi.
5. Isi observasi aktual, termasuk nilai `false` atau tujuan yang berubah,
   sebelum menjalankan audit. Waktu UTC `checkedAt` adalah waktu seluruh
   verifikasi selesai, format ISO dengan milidetik. Jangan memperbarui waktu
   tanpa mengulang verifikasi. Pisahkan persetujuan perubahan acuan dari
   pencatatan observasi.
6. Bila dashboard/identitas/status tidak dapat diakses atau dibuktikan,
   segera ganti observasi dengan
   `{"version":1,"source":"dashboard","status":"inaccessible","checkedAt":"WAKTU_UTC_ISO","channels":[]}`.
   Jangan mempertahankan observasi lama yang masih tampak sehat.
7. Jalankan workflow audit manual. Ia hanya membaca API dan secrets, tidak
   mengirim email atau ping. Perbaiki masalah berdasarkan kode generik,
   lalu ulangi observasi sebelum menganggap verifikasi berhasil.

Tujuan yang berbeda, integrasi nonaktif, email belum diverifikasi, atau
penerimaan belum dikonfirmasi menghasilkan `drift`. Observasi hilang atau
berumur **31 hari atau lebih** menghasilkan `verification_due`; sumber
tidak dapat diakses menghasilkan `source_unavailable`. Bentuk tidak dikenal,
duplikasi ID, acuan tidak cocok dengan ID/jenis API, atau waktu masa depan
menghasilkan `config_error`. Semua membuat langkah Healthchecks dan job
gagal meskipun kedua pemeriksaan konfigurasi API `ok`. Output hanya kode
tetap; tidak ada identitas/UUID/respons privat di log atau isi peringatan.
Setelah jadwal audit diaktifkan sesuai prosedur aktivasi, kegagalan ini
menggunakan jalur peringatan **Brevo**, di luar Healthchecks. Draf manual
tetap tidak mengirim peringatan; kegagalannya terlihat pada status job.

**Batas yang tersisa:** catatan ini adalah pernyataan operator, bukan
telemetri langsung atau bukti kriptografis penerimaan. Perubahan yang tidak
dilaporkan setelah observasi baru diketahui pada pemeriksaan berikutnya
atau ketika masa berlaku habis. Timestamp atau pernyataan palsu oleh pemilik
akses secrets tidak dapat dideteksi. Gangguan sumber tidak otomatis diketahui
sebelum operator melaporkannya. Hilangnya akses dashboard, tujuan yang
tersamarkan, dan status yang ambigu wajib dianggap tidak dapat diverifikasi.
Uji bulanan dan pemeriksaan ulang segera setelah perubahan tetap diperlukan.
Tes lokal mensimulasikan tujuan berubah dengan ID/nama sama, integrasi
nonaktif, email belum terverifikasi, sumber tidak dapat diakses, kedaluwarsa,
dan keluaran CLI privat; tidak membuktikan penerimaan operasional nyata.

## Check terpisah untuk jalur status peringatan GitHub

Heartbeat jadwal di atas dikirim **sebelum** pemeriksaan API, jadi tetap sehat
ketika GitHub Search/Issues API berulang kali menolak pencarian atau klaim
peringatan. Buat **check tambahan** terpisah dari kedua check jadwal pada
Healthchecks.io dan **monitor tambahan** pada Cronitor. Keduanya memakai cron
`31 10,18 * * *` UTC dengan grace **21 jam**: satu ping gagal tidak langsung
menjadi down, tetapi dua kesempatan terjadwal yang berturut-turut gagal akan
menjadi down sebelum kesempatan berikutnya. Gunakan nama generik seperti
“Gustafta status peringatan GitHub” tanpa URL atau data pelanggan. Healthchecks:
pasang Email dan Telegram pada check tambahan; Cronitor: pasang Notification
List dengan penerima non-email langsung. Nonaktifkan reminder/escalation
berulang seperti pada check jadwal. Simpan URL ping yang **berbeda** untuk
masing-masing provider sebagai repository Actions secrets:

| Nama secret | Isi |
| --- | --- |
| `ECOSYSTEM_ALERT_STATE_HEARTBEAT_URL` | Ping URL Healthchecks check status peringatan |
| `ECOSYSTEM_ALERT_STATE_CRONITOR_URL` | Base telemetry URL Cronitor monitor status peringatan |

Hanya watchdog **terjadwal** yang mengirim POST kosong setelah pemeriksaan
GitHub Search, Issues, dan riwayat workflow berhasil, serta tidak ada klaim
status yang gagal pada pemeriksaan harian atau watchdog. Gangguan Brevo yang
sudah meninggalkan klaim `sending` tidak dianggap bukti kegagalan GitHub;
klaim itu tetap perlu diperiksa operator sebelum mengirim ulang. Manual run
dan `workflow_run` tidak mengirim ping. Status down berarti jalur API/status
peringatan **tidak berhasil diverifikasi** selama dua kesempatan, bukan bukti
bahwa issue hilang, email belum dikirim, atau aplikasi eksternal mati.
Periksa log langkah yang gagal dan status `sending` secara manual; jangan
hapus issue atau kirim ulang email berdasarkan status down saja. Jangan kirim
URL ping, API, hasil pencarian, respons penyedia, atau kredensial sebagai
isi ping/log. Tanpa kedua secret dan konfigurasi monitor eksternal tersebut,
sinyal ini **belum aktif**. Uji penerimaan kanal lewat check sementara seperti
prosedur di atas, tanpa mematikan check produksi.

### Uji terkontrol: dua kesempatan gagal dan pemulihan

Prosedur khusus ini melengkapi uji kanal tiap menit di atas. Tujuannya
membuktikan timer eksternal dan penerimaan manusia untuk **status peringatan
GitHub**, bukan membuat GitHub API sengaja gagal. Tes lokal tidak membuktikan
pengiriman penyedia maupun penerimaan manusia.

1. Sebelum mulai, operator memeriksa bahwa check status peringatan produksi
   pada Healthchecks dan monitor padanannya pada Cronitor sudah aktif,
   memakai cron `31 10,18 * * *` UTC, grace 21 jam, serta menerima ping
   **schedule**. Bila konfigurasi belum aktif, hentikan uji dan selesaikan
   pengaktifan dahulu. Jangan mengubah atau mematikan check produksi,
   mengganti repository secrets, menghapus issue GitHub, atau mengirim ulang
   email dengan status `sending` yang belum jelas.
2. Buat check/monitor **sementara** bernama generik
   “Gustafta uji status peringatan” pada penyedia yang diuji. Gunakan cron
   `*/2 * * * *`, timezone UTC, grace **3 menit** (180 detik), tanpa
   toleransi jadwal tambahan. Healthchecks: Email dan Telegram ON; Cronitor:
   pasang Notification List yang sama dengan monitor status produksi,
   dengan kanal non-email langsung. Nonaktifkan reminder, pengulangan,
   dan escalation. Uji masing-masing penyedia secara terpisah; jangan
   memakai URL atau monitor produksi sebagai target uji.
3. Tepat setelah batas menit UTC genap (misalnya beberapa detik setelah
   12:00 UTC), kirim **satu ping kosong** ke check sementara melalui kontrol
   penyedia jika tersedia atau terminal pribadi. Jangan menggunakan terminal
   bersama, workflow GitHub, tangkapan layar, atau log untuk URL ping.
   Jangan kirim event `fail` atau isi laporan.
4. Hentikan ping. Dalam contoh tersebut, kesempatan pertama terlewat pada
   12:02, kedua pada 12:04; grace dari kesempatan pertama berakhir pada
   12:05, sebelum kesempatan ketiga pada 12:06. Secara umum:
   interval < grace < 2 × interval; tenggat down = kesempatan pertama +
   grace. Catat waktu UTC tanpa URL. Status down tidak boleh mendahului
   kesempatan kedua. Pengiriman pesan dapat terlambat dibanding perubahan
   status; jangan menyamakan waktu pesan masuk dengan waktu status down.
5. Operator memastikan **satu pesan down per kanal** benar-benar diterima
   di aplikasi penerima terpisah dari GitHub. Healthchecks perlu konfirmasi
   Email dan Telegram; Cronitor perlu konfirmasi kanal non-email langsung.
   Status “terkirim” di dashboard bukan bukti penerimaan. Bila belum diterima
   dalam 10 menit setelah tenggat down, tandai uji belum berhasil, hapus
   check sementara, dan periksa kanal sebelum membuat satu uji baru.
6. Setelah down diterima, kirim **satu ping kosong pemulihan** ke check
   sementara yang sama. Pastikan status kembali up dan operator menerima
   **satu pesan pemulihan per kanal**. Bila pemulihan belum diterima dalam
   10 menit, tandai uji belum berhasil; jangan mengulang ping atau mengirim
   email sendiri untuk menggantikan bukti penyedia.
7. Hapus check/monitor sementara setelah pemulihan atau jika uji dibatalkan.
   Periksa kembali bahwa monitor produksi tetap aktif dan tidak berubah.
   Jika penghapusan gagal, pause **hanya check sementara** di dashboard
   sambil menyelesaikan penghapusannya. Jangan meninggalkan check uji aktif.

Catatan bukti hanya berisi tanggal, penyedia, nama generik check uji,
cron/timezone/grace, waktu UTC ping awal, dua kesempatan terlewat, status
down dan up, penerimaan down/pemulihan **ya/tidak per jenis kanal**,
tidak ada pesan berulang selama uji, penghapusan check sementara, serta
produksi tetap aktif/tidak berubah. **Jangan catat URL ping, identitas
penerima, isi pesan, tangkapan layar, respons API, atau secret.** Bedakan
waktu perubahan status dan waktu penerimaan bila keduanya diketahui.

**Status uji khusus — 14 Oktober 2026:** pengguna kembali mengonfirmasi
**belum siap, tetap tunda uji**. Uji eksternal **ditunda atas keputusan
pengguna**, bukan dinyatakan berhasil. Tidak ada ping uji yang dikirim,
check sementara yang dibuat, atau konfigurasi eksternal yang diubah oleh
agen dalam penundaan ini; status produksi belum diverifikasi ulang.
Persiapan prosedur dan lima tes lokal
telah selesai; belum ada konfirmasi operator mengenai penerimaan
down setelah dua kesempatan terlewat dan pemulihan sesudah ping kembali.
Keputusan penundaan ini tidak mengubah workflow: sebelumnya workflow sudah
berupa draf manual sesuai `ecosystem-monitoring-merge-readiness.md`. Aktivasi
jadwal pada repository tujuan tetap memerlukan persetujuan terpisah.
Laporan uji kanal sebelumnya di bawah tidak menggantikan bukti ini.
Lanjutkan uji hanya setelah pengelola akun siap menjalankannya dan memastikan
prasyarat konfigurasi di langkah 1. Setelah operator mengonfirmasi seluruh
langkah, ganti status ini dengan
catatan minimal sesuai batasan di atas; jangan mengklaim keberhasilan
hanya karena tes lokal lulus.

**28 September 2026 — laporan operator, bukan akses langsung oleh agen:**
dua monitor Cronitor telah diaktifkan; pengelola mengonfirmasi kedua ping
terjadwal terlihat, satu pesan uji diterima manusia, monitor uji dihapus,
dan tidak ada peringatan uji berulang. Jangan tambahkan telemetry URL, isi
pesan, atau identitas penerima pada catatan berikutnya. Status ini perlu
diperiksa kembali setelah perubahan konfigurasi atau penggantian secret.

## Catatan verifikasi operasional

**27 September 2026 — berdasarkan laporan operator, bukan akses langsung ke
akun atau kotak masuk oleh agen:**

- Check produksi **Gustafta pemeriksaan ekosistem** dan **Gustafta pengawas
  ekosistem** dibuat ulang setelah URL lama tampak dalam tangkapan layar.
  Dua URL baru disimpan sebagai repository secrets yang berbeda; URL lama
  tidak digunakan lagi.
- Email dan Telegram sama-sama ON pada setiap check (empat ikon aktif).
  Operator mengonfirmasi kedua *Last Ping* berasal dari jadwal GitHub,
  bukan ping manual.
- Satu check uji sementara menghasilkan pesan *down* yang diterima operator
  di **Email: ya** dan **Telegram: ya**. Check uji kemudian dihapus.
- Operator melaporkan pengingat uji bulanan di kalender perangkat sudah
  diperbaiki untuk berulang dan menampilkan notifikasi.

Catatan ini merekam konfirmasi manusia, bukan akses agen ke akun penyedia.
Jangan tambahkan ping URL, tautan bot, isi pesan, atau identitas penerima
ke catatan uji berikutnya. Lampiran yang sebelumnya memperlihatkan URL
telah dihapus dari versi proyek saat ini; URL yang sempat terlihat tetap
harus dianggap dicabut melalui pembuatan ulang check, termasuk bila
lampiran lama masih ada di riwayat Git.