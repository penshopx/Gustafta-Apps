# Blueprint Penutup Celah Operasional — Portofolio SIAP/SIGAP

Status: rancangan scope dan ownership; tidak menyatakan semua aplikasi sudah dibangun.

## 1. Aturan inventaris

Nama aplikasi tidak cukup untuk membuktikan domain atau kemampuan. Buat registry dengan app_id stabil, nama dagang/alias, workspace, URL deployment terverifikasi, owner proses, tenant model, API version, auth scheme, event types, contract-test date dan status.

Status kemampuan: **belum diketahui -> dokumen tersedia -> prototype -> endpoint terverifikasi -> pilot diterima -> produksi disetujui**. “Sudah dibuat” tidak otomatis berarti API read/write, MCP, outbox dan approval siap.

Rincian per aplikasi yang hanya ditautkan dalam ekspor masih merupakan dependency dokumen. Scope di bawah adalah proposal pengganti minimal untuk review, bukan rekonstruksi rincian Notion yang tidak tersedia.

## 2. Registry domain dan alias

| Domain | Nama/alias dari sumber | Keputusan revisi |
| --- | --- | --- |
| Project control | SIAP PROYEK / SIGAP Project | Satu engine; Ruang Proyek Gustafta pintu masuk, bukan ledger proyek kedua |
| Keuangan | ERP Keuangan / SIGAP Finance | Satu owner jurnal, anggaran, invoice, pajak dan pembayaran |
| Pengadaan + gudang | SIAP GUDANG / SIGAP Procure | Satu domain logistik; pisah modul procurement/gudang jika perlu, tidak dua master vendor/stok |
| Tenaga | SIAP TENAGA / SIGAP HR & SKK | Satu owner personel/absensi; payroll finansial tetap ERP |
| Alat | SIAP ALAT / SIGAP Aset & Alat / perluasan TATABANGUN | Tentukan host modul setelah audit; satu register aset dan booking |
| Purnajual | SIAP LAYAN / SIGAP Klien & Purnajual / TATABANGUN | Satu owner tiket/garansi; CRM dan work order lewat referensi |
| Estimasi | SIAP RAB / SIGAP Tender & Estimasi | Tender pipeline dan estimator bisa modul; satu versi RAB penawaran |
| Legal | SIAP LKUT / KontrakKonstruksi / SIGAP Legal | SBU/perizinan dan kontrak boleh berbeda owner objek; bukan tiga register identik |
| Mutu | QA/QC Core + ISO Hub | QA/QC owner keputusan mutu proyek; ISO owner SOP/audit/CAPA sistem; saling referensi |
| Keselamatan | Contractor Safety Passport / SIGAP K3 | Satu owner keputusan keselamatan; worker qualifications direferensi HR |
| Integritas | SMAP / Pancek / ProComply | Domain terkait tetapi tidak identik; kasus whistleblowing tetap terpisah dan restricted |
| Lintas domain | SIGAP HUB / Insight / Akademi | Registry/proyeksi/knowledge, tidak mengambil ledger owner |
| Dokumen | Ruang Simpan / CDE / ISO documents | Bytes/arsip, status drawing, dan dokumen terkendali dibedakan; grant eksplisit |

## 3. Pemilik data yang diselaraskan

| Objek | Owner otoritatif | Konsumen dan syarat |
| --- | --- | --- |
| Profil resmi perusahaan dan arsip berizin | Ruang Simpan sesuai kontrak koneksi | Aplikasi sektoral read sesuai scope/grant; tidak otomatis baca berkas |
| Project ID, WBS, baseline pelaksanaan, jadwal, progres accepted | SIAP PROYEK | ERP, gudang, alat membaca referensi/revision |
| RAB/BoQ penawaran | Estimasi | Baseline kontrak diserahkan lewat handover accepted; sumber versi tetap tersimpan |
| Nilai kontrak legal dan adendum | KontrakKonstruksi/legal owner | Project dan ERP menyimpan referensi beserta snapshot terkontrol |
| Anggaran/COA/kode biaya/jurnal/invoice/pajak | ERP | Project tidak boleh menjadikan hasil LLM angka finansial resmi |
| Vendor/material/MR/PO/mutasi stok | Gudang/Procure owner | ERP payable setelah validasi; QC acceptance dari QA/QC |
| SDM/absensi/SKK dan bukti personel | Tenaga/HR owner | Minimal fields ke K3/Legal/Project; ERP untuk pembayaran |
| SIO/izin dan fitness yang relevan | Registry jenis sertifikat sesuai penerbit/domain | Jangan samakan SKK dan SIO; sumber bukti selalu terlihat |
| Aset/log jam/servis/booking/sewa operasional | Alat owner | ERP penyusutan/tagihan; kontrak sewa legal melalui referensi |
| NCR/acceptance hasil uji | QA/QC Core | Project progres; ISO read reference untuk analisis/CAPA |
| Insiden/permit K3/izin lanjut kerja | Safety Passport/K3 owner | Project mendapat status minimal sesuai izin |
| SOP resmi, audit dan CAPA sistem | ISO Hub | Aplikasi menaut versi yang berlaku |
| Tiket garansi/komplain | Layan owner | Work order TATABANGUN referensi; retensi finansial ERP |
| App/project/vendor/person mapping | HUB registry | Hanya ID dan pemetaan, tidak mengedit master bisnis milik aplikasi |

Tidak semua aplikasi menyimpan hanya ID tanpa data: read model atau snapshot historis dapat diperlukan. Snapshot harus memuat source_app, source_id, source_revision, captured_at dan tidak diedit sebagai master.

## 4. MVP per modul

### 4.1 HUB — fondasi minimum, bukan aplikasi master raksasa

Scope: app/capability registry, mapping ID, credential reference, event schema registry, inbox dedup, delivery status, task references, approval deep link dan audit koordinasi. Kredensial disimpan di Secrets/secret manager, bukan kolom plaintext.

Tidak termasuk: master personel lengkap, jurnal, saldo stok, database approval final paralel, atau seluruh data transaksi semua aplikasi.

Acceptance: alias tidak membuat duplikat; app down tidak mematikan aplikasi lain; revoke koneksi efektif; outbox backlog dan schema mismatch terlihat; isolasi tenant/project lulus.

### 4.2 GUDANG / Procure

Entitas minimum: vendor, material + uom conversion, gudang/lokasi, MR, RFQ, PO, receipt kandidat, acceptance reference, stock ledger, reservation, adjustment proposal.

Status: MR draft -> pending -> approved/rejected; PO draft -> approved -> issued; receipt recorded -> quarantined -> accepted/rejected. available stock tidak termasuk quarantined.

Kontrol: mutasi append-only dan reversal, anti-negative stock sesuai kebijakan, penguncian saldo/reservation, unit conversion deterministik, three-way matching, audit item/lot, FEFO bila masa kedaluwarsa relevan.

Acceptance: receipt duplikat tidak menambah stok; dua issue serentak tidak overdraw; stale approval gagal; adjustment perlu alasan dan reviewer independen.

### 4.3 TENAGA / HR

Entitas: pekerja, hubungan kerja, penempatan proyek, bukti keahlian, attendance observation, attendance accepted, overtime request, approved recap dan payroll input snapshot.

Kontrol: minimisasi data, pembatasan field upah/identitas, mekanisme dispute absensi, effective-date rules, approval lembur terpisah rekap.

Tidak termasuk transfer dana, penandatanganan kontrak otomatis, atau keputusan disiplin dari AI. Slip upah tidak disebar ke grup WA; portal pribadi/kanal terverifikasi.

Acceptance: pengguna hanya melihat pekerja yang diizinkan; revisi absensi merubah draft payroll bukan payroll posted; snapshot approved tidak diam-diam berubah.

### 4.4 ALAT

Entitas: asset, meter reading, inspeksi, maintenance plan, work order, booking, rental draft, handover dan return.

Kontrol: hold administratif ketika inspection failed; release oleh petugas berwenang; konflik booking; jam operasi/BBM anomali menjadi investigasi; sewa tidak ditawarkan otomatis karena idle tujuh hari.

Acceptance: tidak double-booking; alat hold tidak bisa dipesan untuk operasi; jadwal maintenance boleh otomatis tetapi servis/kelayakan tetap manusia; billing tetap ERP.

### 4.5 LAYAN

Entitas: kontrak/unit, handover reference, warranty rules, ticket, triage, work order reference, visit, closure evidence.

Kontrol: acknowledgment berbeda diagnosis; urgent safety issue langsung dialihkan; cakupan garansi sesuai kontrak/version; pelanggan tidak membaca tiket pelanggan lain.

Acceptance: tiket idempoten, SLA business-hours jelas, komitmen biaya perlu approval, closure menyimpan bukti.

### 4.6 RAB / Tender

Entitas: tender opportunity, source document version, eligibility evidence, BoQ, AHSP ruleset, price source date/location, estimates, exclusions, contingency, bid package dan handover baseline.

Kontrol: decimal arithmetic, unit conversion, rounding, koefisien/satuan divalidasi; no-price = missing bukan angka karangan; rumus transparan; HPS resmi tidak digantikan estimasi kontraktor.

Acceptance: setiap subtotal dapat direproduksi; sumber volume/harga tersedia; perubahan input menciptakan revision dan approval baru; tidak unggah/tanda tangan otomatis.

## 5. Pembangunan dan deployment

Gunakan stack/proses proyek yang sudah ada; jangan menjadikan React/Fastify atau DB baru sebagai migrasi wajib tanpa kebutuhan. Pada Gustafta, pertahankan modular monolith; aplikasi sektoral yang sudah terpisah dihubungkan melalui adapter.

UI/API stateless dapat memakai deployment Autoscale. Worker terjadwal harus memiliki runtime yang benar-benar berjalan atau penjadwal eksternal; jangan mengandalkan interval in-memory pada service yang dapat tidur. Pemilihan runtime dilakukan setelah mengukur volume/latensi dan biaya. Tidak mewajibkan satu Reserved VM per aplikasi.

Database queue/outbox dapat cukup untuk pilot. NATS/RabbitMQ/Redis bukan tiga komponen yang harus dipasang bersamaan. Tambah broker jika kebutuhan throughput/routing terukur membuktikannya.

## 6. Urutan yang disepakati

Ikuti fase pada blueprint utama: governance + inventory -> read pilot -> draft + gate -> event/reconciliation -> modul lanjutan. Gudang dan tenaga paralel hanya jika pemilik dan tim independen siap.

Jangan membangun aplikasi baru sebelum capability audit memastikan fungsi tidak tersedia atau tidak dapat diperluas pada aplikasi yang ada.
