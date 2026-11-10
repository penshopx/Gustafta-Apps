# Revisi SOP dan Kriteria Penerimaan

## 1. Struktur katalog

Nomor 1–29 tetap SOP proses. Nomor 30–39 tetap SOP jabatan, bukan workflow agen pengganti jabatan. Tambahan 40–46 menutup pra-kontrak dan governance:

40. Pencarian Tender dan Go/No-Go.
41. Estimasi dan Penyusunan RAB.
42. Penyusunan Dokumen Penawaran.
43. Review Kontrak dan Adendum.
44. Change Order.
45. Tata Kelola Agen AI / AgentOps.
46. Keamanan dan Privasi Data.

Alur A–G dipertahankan; H = Pra-kontrak & Perubahan; I = Governance. H/I merupakan pengelompokan tambahan, bukan klaim bahwa sumber awal memiliki sembilan alur.

Matriks CSV memuat 46 baris. Semua berstatus **Usulan revisi - belum disahkan**, bukan Aktif. Field kebijakan lokal seperti nama pejabat, limit, jam kerja, nomor formulir dan aturan hukum tetap harus dilengkapi process owner.

## 2. Level otomasi yang diperjelas

| Level | Batas yang diizinkan |
| --- | --- |
| L1 Asisten | Checklist, penjelasan dan dukungan dokumentasi; manusia menjalankan keputusan/aksi |
| L2 Kolaboratif | AI mengolah kandidat fakta; manusia verifikasi fisik/teknis sebelum acceptance |
| L3 Draf/Propose + Approval | AI menyiapkan paket proses; aksi final mengikuti gate dan executor aplikasi |
| L4 Administratif berisiko rendah | Read, rekap, reminder terkonfigurasi; tidak mengesahkan angka/izin/komitmen baru |

Level ditentukan **per langkah**, bukan otomatis semua langkah satu SOP. Rekap lembur boleh L4; izin lembur tetap manusia. Pengingat servis boleh L4; pekerjaan servis dan kelayakan alat tidak.

## 3. Template wajib SOP operasional

Setiap SOP disahkan setelah memiliki:

1. ID, judul, revisi, effective date, reviewer dan pejabat pengesah.
2. Tujuan, applicability proyek/kontrak dan exclusions.
3. Trigger yang membedakan observation, proposed dan accepted.
4. Input resmi, source owner, revision, freshness dan bukti.
5. **RACI manusia:** satu accountable owner; responsible/checker/consulted/informed jelas. Agen selalu copilot, bukan legal accountable.
6. Langkah AI vs manusia dan precondition/postcondition.
7. Gate bernama, approver, revision/hash bukti, expiry dan kebijakan eskalasi.
8. Output, status, formulir, audit dan siapa yang dapat membaca.
9. SLA: business/calendar time, start/stop clock, timezone, exception, escalation.
10. KPI: numerator/denominator, sumber, baseline, target dan frekuensi.
11. Guardrail: larangan, confidentiality, value cap, unknown/error path.
12. Jalur manual saat dependency gagal dan rekonsiliasi setelah pulih.
13. Acceptance test termasuk negatif, concurrent, replay dan stale evidence.

Bila gate melewati SLA, eskalasi ke pejabat pengganti sesuai delegasi tercatat; tidak auto-approve. Prioritas darurat menggunakan SOP keselamatan manusia, bukan timer approval administrasi.

## 4. Langkah minimum per keluarga proses

### A — Material & Logistik (1, 2, 3, 21; dukungan jabatan34/36)

Input: jadwal/BoQ accepted, stok by status, reservation, vendor quotation, budget. MR -> review kebutuhan -> draf pengadaan -> gate PO -> bukti fisik receipt -> gate QC -> stock ledger -> issuance per cost/WBS -> opname -> adjustment proposal.

KPI: kebutuhan terpenuhi tepat waktu, receipt verified, mismatch opname, stockout dan supplier defect. Tidak menghitung barang quarantine sebagai stok tersedia.

### B — Alat (4, 5, 22, 23; jabatan39)

Input: register, manual pabrikan, jam operasi accepted, inspection dan booking. Operator checklist -> hold bila gagal -> review Kepala Alat -> maintenance/repair work order -> teknisi melakukan -> bukti uji -> release manusia.

KPI: availability, downtime, overdue maintenance, confirmed fuel anomaly. Log AI tidak membuktikan servis terlaksana.

### C — Pelaksanaan & Mutu (6, 7, 12, 24, 25; jabatan30–33/35/37)

Input: kontrak/baseline, drawing versi berlaku, field measurement, test results. Observasi -> verifikasi volume/teknis -> acceptance mutu -> progres deterministik -> deviasi -> recovery proposal -> gate PM -> laporan eksternal.

KPI: bukti diterima, laporan tepat waktu, rework, variation tanpa approval. Quantity measurement dan QC acceptance tidak digabung menjadi keputusan satu agen.

### D — Keuangan & Pajak (8, 9, 10, 11, 14; jabatan38)

Input: ERP, BA accepted, kontrak, payroll accepted, ruleset pajak. Draft -> validasi angka/sumber -> maker-checker -> issued/posted manusia/aplikasi terotorisasi -> reconcile source proof.

KPI: close timeliness, invoice lead time, unresolved reconciliation, payroll disputes. Pengajuan upah cross-reference HR; tidak ada duplikasi employee master di ERP.

### E — SDM (15, 16, 17; handoff10)

Input: resource need, kontrak kerja, attendance accepted, sertifikat. HR validasi kebutuhan -> review kandidat -> keputusan manusia -> kontrak -> izin lembur -> rekap accepted -> payroll draft.

KPI: kebutuhan personel terpenuhi, sertifikat diverifikasi, dispute selesai. SKK/SKKNI/SIO tidak diperlakukan sebagai sertifikat identik.

### F — K3 & Keamanan (18, 19, 20)

Input: izin akses, prosedur darurat, CCTV/foto berizin, laporan manusia. Deteksi -> alarm -> tindakan petugas -> amankan bukti -> verifikasi/investigasi manusia -> tindakan korektif -> izin lanjut/closure berwenang.

KPI: alarm ter-deliver, response manusia, closure berbukti, false alarms. Tidak ada tuduhan pencurian, sanksi atau penentuan kondisi medis otomatis.

### G — Serah Terima & Purnajual (13, 26, 27, 28, 29)

Input: kontrak, acceptance, punch list, as-built, warranty. Checklist -> inspeksi pihak berwenang -> BA sah -> maintenance obligation -> ticket -> scope decision -> work order -> evidence closure.

KPI: handover completeness, complaint lead time, repeat defect, accepted closure. PHO, FHO dan consumer BAST dipisah.

## 5. Tujuh SOP baru — minimum langkah dan gate

### SOP40 — Tender dan Go/No-Go

1. AI mengumpulkan peluang dari sumber sah dan bertimestamp.
2. AI mengekstrak persyaratan paket, sumber/halaman dan deadline.
3. Server mencocokkan bukti legalitas/kualifikasi perusahaan; unknown -> review.
4. Manajer tender meninjau eligibility dan kapasitas.
5. Direktur memutuskan Go/No-Go dengan alasan.
6. Catat keputusan, versi sumber, reviewer, deadline dan tindak lanjut.

Output: opportunity review dan decision record. Larangan: login portal pakai kredensial bebas, bypass CAPTCHA/access control, atau final rejection dari tebakan.

### SOP41 — Estimasi dan RAB

1. Terima BoQ/gambar revision sah; deteksi unit/volume missing.
2. Tentukan ruleset AHSP applicable dan sumber harga date/location.
3. Engine menghitung subtotal, overhead/risiko/margin sesuai policy versi.
4. Estimator memverifikasi volume/koefisien/asumsi dan sensitivity.
5. Gate Estimator Senior; perubahan input mengganti revision.
6. Ekspor RAB immutable revision dan handover reference.

Output: RAB draf/accepted, assumptions, source evidence, rounding record. Larangan: mengarang harga, mengklaim estimasi internal sebagai HPS resmi.

### SOP42 — Dokumen Penawaran

1. AI membuat compliance checklist dari dokumen pemilihan revision terbaru.
2. AI merakit draf dari bukti legalitas, RAB accepted dan metode/jadwal.
3. Cross-check angka, tanggal, tenaga dan dokumen.
4. Manajer tender/legal mereview.
5. Gate pejabat penandatangan; upload manusia ke kanal resmi.
6. Simpan checksum paket dan bukti submission; status submitted berdasarkan bukti.

Output: paket dan submission reference; bukan jaminan menang.

### SOP43 — Kontrak dan Adendum

1. AI menerima versi kontrak dan memetakan klausul/risiko.
2. Legal menilai kewenangan, obligations, jaminan, pembayaran, perubahan dan sengketa.
3. AI menyiapkan redline/draf.
4. Negosiasi/review manusia.
5. Gate pejabat berwenang; signature bukan tanda “approved” chat.
6. Aplikasi menyimpan signed version dan menyerahkan revision ke Project/ERP.

Output: signed contract reference hanya setelah bukti sah; legal memo terpisah.

### SOP44 — Change Order

1. Catat permintaan, originator, sumber dan konteks kontrak.
2. Quantity/Estimator, Scheduler dan Legal menghitung dampak.
3. AI merakit opsi/risk package.
4. PM meninjau; otoritas kontrak dan counterpart mengesahkan bila diperlukan.
5. Update baseline hanya berdasarkan adendum/keputusan sah.
6. Simpan histori baseline lama, delta dan audit.

Larangan: chat klien menjadi instruksi pekerjaan tambah berbayar final tanpa kewenangan sah.

### SOP45 — AgentOps

1. Registrasi role/model/skill/tools, izin, budget, owner dan versi.
2. Perubahan diajukan sebagai proposal; dilarang self-promote.
3. Jalankan evaluasi sumber/angka, injection, auth, scope, timeout, loops dan biaya.
4. Gate Process Owner + AgentOps; sandbox dan canary.
5. Monitor accepted/rejected outputs, cost, error, latency dan incident.
6. Kill switch, credential revoke, rollback versi dan root-cause review.

Output: release evidence dan incident record; governance aktif sebelum pilot.

### SOP46 — Keamanan dan Privasi

1. Klasifikasikan data, dasar penggunaan, retensi, pihak yang dapat mengakses.
2. Berikan grant minimal terikat tenant/project/resource/field.
3. Review provider/model transfer policy dan logging/redaction.
4. Uji negative access, token revoke, file grants, backup dan restore.
5. Security owner/pemilik data menyetujui penggunaan.
6. Review akses berkala; penanganan insiden mengikuti prosedur dan kewajiban applicable.

Output: access registry, review evidence, retention schedule, restore report. Larangan: token dalam chat/CSV/Notion; wildcard seluruh dokumen.

## 6. Migrasi dan penerimaan

- Original SOP tetap referensi sampai revisi disahkan. Jika ada konflik, satu SOP berlaku resmi; jangan dua proses transaksi berjalan paralel tanpa rekonsiliasi.
- Shadow mode membandingkan hasil AI terhadap proses resmi, bukan membuat pembayaran/stock posting kedua.
- UAT harus mencakup contoh benar/salah, pengguna tanpa izin, perubahan revision setelah approval, concurrency, outage dan jalur manual.
- Keberhasilan empat minggu tanpa insiden hanya salah satu bukti, bukan syarat tunggal.
- Setiap SOP jabatan disahkan bersama batas delegasi manusia; AI tidak “mengambil alih” jabatan.
- Perlu ekspor naskah asli SOP konvensional dan child blueprint untuk audit per langkah yang lengkap. Ketiadaan itu dicatat sebagai evidence gap, bukan dianggap sudah ditutup.
