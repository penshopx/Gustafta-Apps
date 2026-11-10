# Prasyarat penggabungan monitoring Gustafta

Target repository yang dipilih pengelola: `penshopx/landing-page`.

## Status dan batas perubahan

Pull request ini menambahkan monitoring yang sebelumnya belum tercatat pada
workflow repository tujuan. Ini **bukan** bukti aktivasi atau penerimaan alarm.
Catatan konfirmasi operator terdahulu di `ecosystem-external-heartbeats.md`
merupakan riwayat, bukan verifikasi konfigurasi saat ini.

- Jangan merge sebelum prasyarat di bawah diperiksa.
- Semua pemicu schedule/workflow_run monitoring dinonaktifkan pada draf ini.
  Merge draf tidak mengaktifkan jadwal; aktivasi memerlukan perubahan dan
  persetujuan terpisah.
- Pemeriksa dan watchdog manual juga memiliki `allow_operational_run=false`
  secara default. Jangan nyalakan untuk tes kanal; gunakan fixture terisolasi.
- Tidak ada pengiriman alarm, ping penyedia, atau perubahan check produksi
  sebagai bagian dari penyiapan PR.
- Workflow `ecosystem-monitor-tests.yml` menjalankan tes fixture offline tanpa secrets.
- Uji Chromium nyata bersifat opt-in. Tes offline yang melewatinya tidak boleh
  dilaporkan sebagai bukti Chromium nyata.

## Repository Actions secrets

Nilai secret harus dimasukkan langsung melalui pengelolaan GitHub Actions
secrets. Jangan tempel token, ping URL, baseline penerima, atau alamat penerima
di chat, PR, issue, dokumen, maupun log.

Saat pemeriksaan awal, hanya dua secret heartbeat jadwal tercantum pada
tingkat repository. Nama yang tercantum tidak membuktikan nilai tersebut
valid atau provider/check masih aktif. Periksa juga sumber secret tingkat
organization/environment jika digunakan; workflow ini tidak menetapkan
environment khusus.

| Secret | Kebutuhan |
| --- | --- |
| `ECOSYSTEM_CHECK_HEARTBEAT_URL` | Healthchecks: jadwal pemeriksa |
| `ECOSYSTEM_WATCHDOG_HEARTBEAT_URL` | Healthchecks: jadwal watchdog |
| `ECOSYSTEM_ALERT_STATE_HEARTBEAT_URL` | Healthchecks: status API/klaim alarm GitHub; check terpisah |
| `ECOSYSTEM_CHECK_CRONITOR_URL` | Cronitor: jadwal pemeriksa |
| `ECOSYSTEM_WATCHDOG_CRONITOR_URL` | Cronitor: jadwal watchdog |
| `ECOSYSTEM_ALERT_STATE_CRONITOR_URL` | Cronitor: status API/klaim alarm GitHub; monitor terpisah |
| `ECOSYSTEM_CONFIG_AUDIT_HEARTBEAT_URL` | Healthchecks: jadwal audit mingguan; check baru terpisah |
| `ECOSYSTEM_CONFIG_AUDIT_CRONITOR_URL` | Cronitor: jadwal audit mingguan; monitor baru terpisah |
| `CRONITOR_AUDIT_API_KEY` | Kunci audit terpisah, izin baca saja |
| `CRONITOR_AUDIT_BASELINE` | Baseline privat monitor dan kanal penerima |
| `BREVO_API_KEY` | Pengiriman email operasional/audit |
| `BREVO_ALERT_EMAIL` | Penerima email operasional |
| `BREVO_SENDER_EMAIL` | Opsional; bila digunakan, pengirim terverifikasi |

Panduan cron, grace, provider, dan format baseline ada di
[`ecosystem-external-heartbeats.md`](ecosystem-external-heartbeats.md).
Petunjuk penambahan secret status GitHub dan uji penerimaan manual yang
terisolasi ada di [`ecosystem-isolated-alarm-test.md`](ecosystem-isolated-alarm-test.md).
Heartbeat audit juga memerlukan Actions variable
`ECOSYSTEM_CONFIG_AUDIT_HEARTBEATS_ENABLED` tepat `true` **dan** persetujuan
terpisah untuk penambahan cron Senin `13 7 * * 1` UTC. Variable tidak
mengaktifkan jadwal. Kedua target baru harus berbeda dari pemeriksa/watchdog
dan status GitHub, memakai grace 24 jam dan kanal independen; lihat bagian
timer audit pada panduan. Persiapan ini tidak membuat atau mengaktifkan akun.

## Sebelum merge

1. Periksa diff PR: hanya monitoring, data target ekosistem, tes, dokumentasi,
   dan perubahan paket yang diperlukan. Jangan ganti aplikasi atau data bisnis.
2. Pastikan CI offline lulus. Tidak perlu menjalankan pemeriksa terhadap
   aplikasi produksi untuk menilai PR.
3. Pastikan GitHub Actions diizinkan dan Issues repository aktif untuk klaim
   deduplikasi serta status pemulihan. Jangan hapus/ubah issue status lama tanpa
   memeriksa klaim pengiriman yang ambigu.
4. Periksa konfigurasi Healthchecks dan Cronitor langsung pada akun penyedia,
   termasuk check **status peringatan** yang berbeda dari check jadwal.
5. Periksa semua secrets dan tujuan penerima secara privat.
6. Dapatkan persetujuan pengelola untuk merge dan aktivasi jadwal. Penyusunan
   PR sendiri tidak memberikan persetujuan tersebut.

## Sesudah aktivasi yang disetujui

- Konfirmasi ping berasal dari event **schedule**; manual run tidak boleh
  dipakai sebagai bukti jadwal hidup.
- Jangan memakai manual dispatch pemeriksa utama/watchdog sebagai uji offline:
  keduanya dapat membuat issue status atau mengirim email operasional.
- Buktikan pesan down/up pada check/monitor uji sementara dengan kanal penerima
  yang sama, tanpa menghentikan ping atau mengirim fail ke check produksi.
- Untuk jalur status GitHub, verifikasi cron dan grace yang mewakili dua
  kesempatan terjadwal gagal. Uji penundaan tersebut pada check terisolasi;
  jangan sengaja merusak izin GitHub produksi.
- Catat hanya hasil aman (kanal diterima/tidak, waktu, skenario). Respons API
  sukses atau status email accepted tidak membuktikan manusia menerima pesan.
- Hapus fixture provider setelah uji. Verifikasi penerimaan alarm tetap
  **belum selesai** sampai bukti tersebut tersedia.
