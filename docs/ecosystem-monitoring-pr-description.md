# Draft: monitoring manual dan uji penerimaan alarm terisolasi

Target: `penshopx/landing-page`, base `main`.
Simpan PR sebagai **draft**; **jangan merge**.

## Perubahan

- Menambahkan pemeriksa ekosistem, logika watchdog, serta pengiriman heartbeat
  ke Healthchecks dan jalur cadangan Cronitor.
- **Seluruh pemicu `schedule` dan `workflow_run` monitoring dinonaktifkan.**
  Aktivasi jadwal memerlukan perubahan serta persetujuan terpisah.
- Pemeriksa dan watchdog hanya dipanggil manual; pekerjaan operasional
  membutuhkan `allow_operational_run=true` yang default-nya false.
  Opsi tersebut dapat menulis status alarm/mengirim email operasional;
  jangan memakainya untuk tes penerimaan kanal.
- Workflow terpisah `ecosystem-alert-receipt-test.yml` menyediakan dry-run
  dan uji check Healthchecks sementara.
- Menambahkan tes regresi offline dan panduan konfigurasi secret.
- Tidak mengubah aplikasi, data bisnis, atau database.
- Berkas lama yang berubah pada repository tujuan hanya `package.json` dan
  `package-lock.json`: perintah monitoring dan deklarasi dependensi browser
  yang versinya sudah ada pada lockfile.

## Secret repository — nama saja

Tambahkan nilai secara privat melalui **Settings → Secrets and variables →
Actions**. Jangan tempel nilai di PR, issue, chat, dokumen, atau log.

| Nama | Tujuan |
| --- | --- |
| `ECOSYSTEM_CHECK_HEARTBEAT_URL` | Check Healthchecks untuk jadwal pemeriksa |
| `ECOSYSTEM_WATCHDOG_HEARTBEAT_URL` | Check Healthchecks untuk jadwal watchdog |
| `ECOSYSTEM_ALERT_STATE_HEARTBEAT_URL` | Check Healthchecks **baru dan terpisah** untuk status peringatan GitHub |

Check status GitHub: cron `31 10,18 * * *`, timezone UTC, grace 21 jam.
Aktifkan Email dan Telegram pada check tersebut dan nonaktifkan reminder
berulang. Jangan memakai ulang URL check jadwal pemeriksa atau watchdog.
Kehadiran nama secret tidak membuktikan nilai atau kanal yang benar.

Nama di atas adalah nama kanonik yang dibaca kode. Contoh
`HEALTHCHECKS_STATUS_URL` / `HEALTHCHECKS_SCHEDULE_URL` bukan alias yang
didukung dan tidak perlu ditambahkan.

Secret cadangan dan email operasional yang perlu ditinjau:
`ECOSYSTEM_CHECK_CRONITOR_URL`, `ECOSYSTEM_WATCHDOG_CRONITOR_URL`,
`ECOSYSTEM_ALERT_STATE_CRONITOR_URL`, `CRONITOR_AUDIT_API_KEY`,
`CRONITOR_AUDIT_BASELINE`, `BREVO_API_KEY`, `BREVO_ALERT_EMAIL`,
serta `BREVO_SENDER_EMAIL` bila digunakan.

## Rencana pembuktian terisolasi

1. Buat project/check Healthchecks sementara, bukan check produksi.
2. Pada environment GitHub `monitoring-receipt-test`, simpan
   `ECOSYSTEM_RECEIPT_TEST_HEARTBEAT_URL` dan
   `ECOSYSTEM_RECEIPT_TEST_READONLY_KEY`. Konfigurasi fixture dan izin
   reviewer/branch dijelaskan pada `docs/ecosystem-isolated-alarm-test.md`.
3. Jalankan `dry-run`: nol permintaan jaringan.
4. Jalankan `arm` sekali, biarkan dua kesempatan heartbeat satu-menit
   terlewat, lalu `inspect` untuk memastikan down.
5. Konfirmasi operator menerima pesan down di **Email dan Telegram**.
6. Jalankan `recover` sekali, konfirmasi pesan up di kedua kanal, lalu hapus
   fixture serta secrets uji.

Workflow manual baru harus ada pada default branch agar dapat di-dispatch.
Bootstrap workflow uji manual saja memerlukan persetujuan terpisah;
penyiapan PR ini belum melakukan merge/bootstrap tersebut.

Tidak ada fail ping ke produksi, retry otomatis untuk hasil ambigu,
penghentian jadwal produksi, atau bypass pemeriksaan izin. Metadata read-only
tidak membuktikan keterpasangan kanal maupun penerimaan manusia.

## Verifikasi

- **198 tes offline lulus**, 0 gagal, 2 tes Chromium opt-in dilewati.
- Tes tambahan memastikan ketiga workflow monitoring manual-only dan opsi
  operasional default false.
- Tidak ada pengujian pengiriman live pada perubahan ini.

**Verifikasi penerimaan alarm dan integrasi live SBU tetap belum selesai.**
