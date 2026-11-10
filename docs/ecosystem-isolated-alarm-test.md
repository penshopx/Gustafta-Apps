# Draf workflow dan pengujian alarm terisolasi

Repository tujuan: **penshopx/landing-page**.

Status: draf manual, bukan aktivasi monitoring produksi. Keberadaan PR tidak
membuktikan workflow pada default branch atau kanal notifikasi sudah aktif.
Jalur proxy penulisan ditolak 403. SDK dicoba sebagai alternatif, tetapi
pengiriman perubahan lengkap masih ditolak. Jangan memakai token plaintext
dari remote.

Pemicu schedule dan workflow_run pada tiga workflow monitoring produksi
dinonaktifkan di draf. Pemanggilan manual pemeriksa/watchdog juga membutuhkan
`allow_operational_run=true` yang secara default false; pemanggilan operasional
tersebut bukan pengganti uji penerimaan terisolasi.

## 1. Secret status peringatan untuk produksi — petunjuk saja

Secret yang belum tercantum: `ECOSYSTEM_ALERT_STATE_HEARTBEAT_URL`.
Ini **bukan** URL check jadwal pemeriksa atau jadwal watchdog.

1. Pada Healthchecks, buat check baru khusus **Gustafta status peringatan
   GitHub**, dengan cron `31 10,18 * * *`, timezone UTC, dan grace 21 jam.
2. Pasang integrasi Email dan Telegram pada check ini. Periksa tujuan secara
   privat, dan nonaktifkan pengingat/escalation berulang.
3. Di GitHub, buka `penshopx/landing-page` → **Settings → Secrets and variables
   → Actions → New repository secret**.
4. Isi nama `ECOSYSTEM_ALERT_STATE_HEARTBEAT_URL`. Salin nilai ping URL check
   baru langsung dari dashboard Healthchecks, bukan ke chat atau dokumen.
5. Pastikan tidak memakai ulang nilai `ECOSYSTEM_CHECK_HEARTBEAT_URL` atau
   `ECOSYSTEM_WATCHDOG_HEARTBEAT_URL`. Nama secret yang ada tidak membuktikan
   bahwa nilainya benar.
6. Untuk jalur provider cadangan, konfigurasi monitor status Cronitor dan
   secret `ECOSYSTEM_ALERT_STATE_CRONITOR_URL` sesuai
   [`ecosystem-external-heartbeats.md`](ecosystem-external-heartbeats.md).
   Jangan menganggap perlindungan kedua provider aktif sebelum diverifikasi.

Jangan kirim ping manual ke check produksi untuk pengujian. Pada workflow
watchdog yang disiapkan, ping status hanya dikirim oleh event schedule setelah
pemeriksaan status GitHub berhasil. Manual run bukan bukti jadwal aktif.
Konfigurasi cron/grace produksi perlu ditinjau pada kedua interval jadwal
(8 dan 16 jam); uji dipercepat di bawah tidak membuktikan persis waktu alarm
produksi atau memperbaiki kegagalan API GitHub.

## 2. Fixture Healthchecks yang terpisah

Buat **project Healthchecks khusus pengujian**, jangan project produksi.
Tambahkan Email dan Telegram dengan tujuan yang sama seperti alarm produksi,
tetapi tanpa menyalin identitas tujuan ke repository.

Buat satu check sementara dengan pengaturan berikut:

| Pengaturan | Nilai |
| --- | --- |
| Name | `Gustafta isolated alarm receipt` |
| Tags | hanya `gustafta-isolated-receipt` |
| Schedule | `* * * * *` |
| Timezone | `UTC` |
| Grace | **90 detik** |
| HTTP methods | POST, atau pengaturan default |
| Body/failure filtering | nonaktif |
| Email dan Telegram | aktif untuk check ini |
| Reminder/escalation berulang | nonaktif |
| Status awal | `new` (belum pernah diping) |

Buat **read-only API key** pada Project Settings project uji. Jangan gunakan
kunci read-write. Script membaca metadata tetapi tidak membuat, mengubah,
pause/resume, atau menghapus check melalui Management API.

Di GitHub, buat environment `monitoring-receipt-test` melalui **Settings →
Environments**. Batasi branch yang boleh memakainya ke branch uji yang
disetujui; tambahkan required reviewer jika fitur tersedia. Tambahkan dua
**environment secrets**, bukan pengganti secret produksi:

- `ECOSYSTEM_RECEIPT_TEST_HEARTBEAT_URL`: ping URL fixture baru.
- `ECOSYSTEM_RECEIPT_TEST_READONLY_KEY`: read-only API key project fixture.

Jangan menggunakan nama fixture yang sama pada check produksi. Script menolak
check yang nama, tag, cron, timezone, grace, atau bentuk respons read-only-nya
tidak sesuai. Pembacaan read-only **tidak menampilkan kanal penerima**; operator
tetap harus memeriksa kanal dan mengonfirmasi pesan diterima.

## 3. Workflow manual dan bootstrap yang aman

Workflow: `.github/workflows/ecosystem-alert-receipt-test.yml`.
Script: `scripts/test-ecosystem-alert-receipt.mjs`.
Tidak ada schedule, pemicu kegagalan workflow produksi, npm install, atau
secret produksi dalam workflow uji.

**Batasan GitHub:** workflow baru dengan `workflow_dispatch` harus sudah ada
pada default branch sebelum dapat dipanggil. Membuka PR atau hanya menaruhnya
di branch uji tidak cukup. Karena itu, mintalah persetujuan terpisah untuk
bootstrap **hanya workflow manual ini dan script-nya**, tanpa menggabungkan
tiga workflow produksi terjadwal. Setelah bootstrap, pilih branch uji yang
disetujui saat menjalankan workflow. Persiapan ini belum melakukan bootstrap.

Alternatif sebelum bootstrap: jalankan script dari branch uji di lingkungan
lokal terisolasi. Dry-run tidak memerlukan secret:

```sh
node scripts/test-ecosystem-alert-receipt.mjs dry-run
```

Untuk pengujian nyata, simpan kedua secret fixture melalui pengelola secrets
lingkungan uji; jangan masukkan nilai ke command, riwayat shell, atau chat.
Set `CONFIRM_ISOLATED_RECEIPT_TEST=true` secara eksplisit sebelum aksi online.

## 4. Skenario penerimaan nyata

| Tahap | Aksi workflow/script | Hasil yang diharapkan |
| --- | --- | --- |
| A | `dry-run` | `dry_run`, nol permintaan jaringan; bukan bukti penerimaan |
| B | `arm`, konfirmasi check terisolasi | Satu POST kosong ke fixture, status `armed` |
| C | Jangan kirim ping lagi selama dua kesempatan satu-menit | Check uji melewati grace, menjadi down; Email dan Telegram menerima alarm |
| D | `inspect`, dengan konfirmasi | Membaca status saja; harus `down` sebelum pemulihan |
| E | Operator memastikan alarm down diterima pada kedua kanal | Catat waktu dan hasil tanpa URL/identitas penerima |
| F | `recover`, dengan konfirmasi | Satu POST kosong; `recovery_ping_accepted`; operator memeriksa pesan up di kedua kanal |
| G | Hapus fixture setelah bukti disimpan | Hapus check/project uji dan dua environment secrets uji melalui dashboard |

Setelah arm, ping berikutnya diharapkan pada menit UTC berikutnya. Down baru
terjadi setelah batas itu ditambah 90 detik: kira-kira **90–150 detik setelah
arm**, ditambah keterlambatan pemrosesan/notifikasi provider. Pada saat itu
dua kesempatan ping satu-menit telah terlewat. Jangan menambahkan schedule
GitHub satu-menit atau sengaja merusak pemeriksa produksi; ketiadaan ping pada
fixture yang sudah di-arm adalah simulasi heartbeat gagal.

Script tidak mengirim `/fail`, tidak mengulang ping secara otomatis, dan
menolak arm ulang pada check yang bukan `new`. Bila hasil
`ping_delivery_uncertain`, jangan ulangi membabi buta: baca status fixture
melalui `inspect`, lalu tinjau di dashboard. Arm yang diterima dapat mengubah
check menjadi up meski respons pengiriman hilang. Buat fixture baru bila
perlu mengulang eksperimen, jangan reset check produksi.

Sesudah recovery, fixture yang masih aktif akan kembali down bila tidak
diping. Karena itu, hapus fixture segera setelah konfirmasi pesan up; ini
tindakan manual, bukan terminasi atau pause check produksi.

## 5. Catatan bukti yang aman

Gunakan catatan tanpa URL ping, token, alamat email, Telegram ID, atau
tangkapan layar dashboard yang menampilkan kredensial:

```text
Fixture: disposable-receipt-test
Dry-run: lulus / gagal
Dua kesempatan ping terlewat: ya / belum
Provider status down: ya / belum
Email down diterima: ya / belum; waktu UTC:
Telegram down diterima: ya / belum; waktu UTC:
Email up diterima: ya / belum; waktu UTC:
Telegram up diterima: ya / belum; waktu UTC:
Fixture dan secrets uji dihapus: ya / belum
```

Tes mock membuktikan pengaman script; status `armed` atau
`recovery_ping_accepted` hanya membuktikan respons HTTP berhasil, **bukan**
penerimaan manusia. Integrasi notifikasi tetap belum selesai sampai bukti
Email dan Telegram tersedia. Uji ini juga tidak membuktikan Cronitor atau
seluruh workflow GitHub produksi sudah aktif.

Referensi:
- https://healthchecks.io/docs/api/ (respons API read-only dan konfigurasi check).
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
