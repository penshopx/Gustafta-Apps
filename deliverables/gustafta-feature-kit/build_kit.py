"""Build a documentation-only, portable feature specification; no live services."""
from pathlib import Path
import csv
import hashlib
import io
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
VERSION = "1.0.0"

def module(id, name, purpose, deps, sources, screens, records, flow, safety, tests, extension):
    return dict(id=id, name=name, purpose=purpose, depends_on=deps.split(),
                evidence_paths=sources.split(), screens=screens, records=records,
                flow=flow, controls=safety, acceptance=tests, target_extension=extension,
                evidence_status="Referensi implementasi ditemukan di kode; bukan sertifikasi produksi",
                default_mode="local")

M = [
module("F01", "Akun dan sesi lokal",
 "Memberi identitas pengguna aplikasi tujuan tanpa mewajibkan akun atau login Gustafta.", "",
 "server/replit_integrations/auth/emailAuth.ts client/src/hooks/use-auth.ts",
 "Masuk, keluar, profil akun, pemulihan akses; konfigurasi provider oleh admin.",
 "users, sessions, recovery_challenges; identitas pengguna lokal atau pemetaan provider terverifikasi.",
 "Daftar/masuk melalui provider yang dipilih → verifikasi bila diwajibkan → sesi server → akses fitur → logout mencabut sesi.",
 "Jangan menyalin akun, hash sandi, session secret, allowlist founder, atau kebijakan auto-promote Gustafta. Sesi dan pemeriksaan akun nonaktif berlaku di server.",
 ["Pengguna tanpa sesi ditolak pada API privat.", "Logout atau pencabutan sesi menghentikan akses berikutnya.", "Pengguna biasa tidak dapat menetapkan dirinya sebagai admin."],
 "Pilih mekanisme auth sesuai proyek tujuan; jangan mengganti auth yang sudah berfungsi. SSO lintas aplikasi bukan bawaan kit."),
module("F02", "Peran dan batas kepemilikan",
 "Membatasi setiap aksi berdasarkan pengguna, organisasi, proyek, dan objek.", "F01",
 "server/lib/agent-authz.ts tests/agent-authz-decision.test.ts",
 "Pengelolaan anggota dan role; pesan akses ditolak; pemilihan organisasi jika benar-benar dibutuhkan.",
 "memberships, roles, permissions; owner_user_id dan organization_id pada objek privat.",
 "Identitas server → membership aktif → izin tindakan → batas objek/proyek → izinkan atau tolak; terapkan juga pada ekspor, pencarian dan chat.",
 "Bukan sekadar menyembunyikan tombol. Jangan percaya owner/role dari request. Role admin aplikasi tidak otomatis berhak atas semua organisasi.",
 ["A dan B tidak dapat membaca, mengubah, mengunduh atau menghapus objek satu sama lain.", "Mengganti ID objek pada request tetap ditolak.", "Anggota yang dicabut langsung kehilangan akses."],
 "Matriks tenant/proyek adalah kontrak penerapan baru; tidak diasumsikan sudah seragam di seluruh Gustafta."),
module("F03", "Jejak audit",
 "Mencatat siapa melakukan tindakan penting dan pada objek mana.", "F01 F02",
 "server/ruang-kelola-routes.ts server/ruang-simpan-routes.ts client/src/pages/admin-audit.tsx",
 "Riwayat per objek; filter aktor/tindakan/waktu; ekspor audit berizin.",
 "audit_events: actor, tenant, object_ref, action, revision, outcome, correlation_id, occurred_at; diff yang disanitasi.",
 "Aksi bisnis → perubahan sah dan audit keberhasilan konsisten → riwayat dapat dibaca oleh pihak berizin; penolakan keamanan dicatat tanpa payload rahasia.",
 "Jangan simpan token, raw prompt sensitif, isi lengkap dokumen atau URL bertanda tangan. Role biasa tidak boleh mengubah audit; jangan klaim kebal terhadap admin database.",
 ["Aktor berasal dari sesi server, bukan field by dari klien.", "Mutasi berhasil memiliki audit yang sesuai dan tidak menggandakan event saat retry.", "Ekspor audit tidak membocorkan data organisasi lain atau secret."],
 "Transaksi audit bersama mutasi dan kebijakan retensi wajib dirancang di target; bukan klaim seluruh route sumber sudah memenuhi."),
module("F04", "Profil resmi perusahaan lokal",
 "Menyimpan identitas perusahaan sebagai rujukan tunggal di aplikasi tujuan.", "F01 F02 F03",
 "server/ruang-simpan-app-api.ts client/src/components/ruang-simpan-integration-panel.tsx",
 "Form profil, tampilkan sumber/revisi, riwayat perubahan, konflik simpan.",
 "company_profiles: owner/tenant, nama legal, identitas usaha yang relevan, alamat, kontak, klasifikasi, revision; dokumen bukti sebagai referensi privat.",
 "Pemilik mengisi → validasi format → simpan dengan expected_revision → proses lain membaca profil lokal yang sama.",
 "Nama atau isian pengguna tidak membuktikan legalitas aktif. Jangan seed data perusahaan nyata Gustafta. Field sensitif ditampilkan sesuai izin.",
 ["Simpan pertama dan edit berikutnya sama-sama berhasil dengan batas pemilik.", "Dua edit serentak tidak menimpa diam-diam; revisi lama menghasilkan konflik.", "Perusahaan B tidak mendapat profil A meski mengganti parameter owner."],
 "Untuk berbagi profil pusat pilih F22; jangan mengganti profil lokal dengan cache pusat tanpa menentukan otoritas."),
module("F05", "Ruang Simpan lokal",
 "Mengelola arsip berkas, folder, pencarian dan status dokumen.", "F01 F02 F03",
 "server/ruang-simpan-routes.ts client/src/pages/ruang-simpan.tsx",
 "Daftar/folder, unggah, preview, unduh, metadata, status dan riwayat; keadaan kosong/gagal.",
 "files, folders, storage_objects; metadata MIME, ukuran, checksum, pemilik, status draft/aktif/kadaluarsa/arsip.",
 "Unggah tervalidasi → bytes ke storage privat → metadata lokal → preview/unduh berizin → pengarsipan atau penghapusan sesuai kebijakan.",
 "Storage bucket bukan publik. Terapkan batas ukuran, pemeriksaan tipe, karantina bila diperlukan, safe filename, SSRF guard bila impor URL diaktifkan.",
 ["Unggah, baca, edit metadata dan unduh benar-benar persisten setelah restart.", "ID/URL berkas milik akun lain tidak dapat dipakai.", "Berkas gagal unggah tidak meninggalkan metadata sukses palsu."],
 "Storage dapat mengikuti penyedia target. Scan malware, versioned bytes dan policy retensi tambahan bukan otomatis sudah tersedia dari sumber."),
module("F06", "Kuasa akses dokumen",
 "Memberi izin terbatas per berkas/folder tanpa membagikan seluruh arsip.", "F05",
 "server/ruang-simpan-routes.ts server/ruang-simpan-app-api.ts",
 "Permintaan akses, pemilik menyetujui/menolak, daftar grant, masa berlaku, pencabutan, log penggunaan.",
 "document_grants, access_requests; grantee terverifikasi, target, view/download, purpose, expires_at, revoked_at.",
 "Peminta memilih tujuan → pemilik menilai → grant eksplisit → server memeriksa grant setiap akses → habis/cabut menghentikan akses.",
 "Email yang ditulis peminta tidak cukup sebagai bukti identitas. Izin profil berbeda dari izin berkas. Keanggotaan folder dievaluasi saat akses.",
 ["Grant view tidak otomatis mengizinkan download.", "Akses kedaluwarsa/dicabut ditolak termasuk tautan lama sesuai batas lifetime URL.", "Pindah berkas keluar folder mengubah akses tanpa grant snapshot diam-diam."],
 "Penerima eksternal membutuhkan possession proof atau auth sah; jangan membangun pemulihan token dari email saja."),
module("F07", "Basis pengetahuan dan sumber",
 "Menyediakan rujukan terkurasi untuk pencarian serta jawaban AI.", "F01 F02 F03",
 "client/src/components/panels/knowledge-base-panel.tsx client/src/hooks/use-knowledge-base.ts shared/schema.ts",
 "Unggah/import sumber, status proses, kategori, revisi, kutipan dan daftar sumber.",
 "knowledge_sources, chunks, embeddings, source_versions; provenance, checksum, visibility, owner.",
 "Sumber berizin → ekstraksi → chunk → embedding bila dipakai → pencarian terbatas scope → kutipan ke sumber yang berhak dibaca.",
 "Dokumen bukan instruksi sistem. Jangan mengubah naskah sumber resmi dengan rewrite AI; pisahkan catatan turunan. Isolasi indeks dan retrieval per pemilik.",
 ["Retrieval untuk A tidak mengembalikan chunk privat B.", "Jawaban dapat merujuk sumber dan versi yang dapat diakses.", "Gagal ekstraksi/embedding tampil sebagai gagal, bukan siap palsu."],
 "Embedding dan model memerlukan provider target serta persetujuan pemrosesan data; pencarian teks dapat menjadi implementasi awal yang diberi label."),
module("F08", "Asisten AI spesialis",
 "Memberi dialog berbasis bidang aplikasi, dengan batas tugas yang jelas.", "F01 F02 F03",
 "client/src/pages/agent-chat.tsx server/lib/agent-authz.ts server/routes.ts",
 "Percakapan, status streaming, stop/retry, sumber jika memakai F07, pilihan model yang diizinkan.",
 "assistants, conversations, messages; pemilik/session pengunjung, prompt version, provider/model, usage.",
 "Pesan → hak akses → konteks berizin → provider → stream jawaban → simpan pada percakapan pengguna itu saja.",
 "API key di server. Agen tidak boleh melakukan transaksi final atau mengakses tools tanpa izin. Chat publik memakai session per pengunjung, bukan riwayat bersama.",
 ["Dua pengguna/pengunjung tidak mendapat riwayat satu sama lain.", "Provider mati menghasilkan error jelas tanpa jawaban dummy.", "Stop/retry dan akhir stream tidak menggandakan pesan tersimpan."],
 "F07 opsional untuk grounding; tanpa sumber jangan mengklaim jawaban berbasis bukti. Biaya/provider AI bukan koneksi Gustafta."),
module("F09", "Dialog menuju Blueprint",
 "Mengubah kebutuhan menjadi rancangan tujuan, peran, input, output dan batas kerja.", "F08",
 "server/blueprint-engine-routes.ts client/src/pages/blueprint-builder.tsx",
 "Dialog kebutuhan, editor blueprint, preview konfigurasi, simpan revisi, konfirmasi penerapan.",
 "blueprints, revisions, preview_result; objective, inputs, outputs, constraints, human_gate.",
 "Dialog → ekstraksi rancangan → pengguna memperbaiki → validasi → preview/dry-run → penerapan hanya setelah konfirmasi sah.",
 "Preview tidak menulis konfigurasi aktif atau mengirim pesan. Blueprint bukan hasil pekerjaan final. Penerapan mempertahankan kepemilikan pengguna.",
 ["Blueprint tersimpan dapat dibuka dan diperbaiki ulang.", "Dry-run tidak menambah agen, grant, log bisnis atau pekerjaan nyata.", "Konfigurasi tanpa konfirmasi/izin ditolak."],
 "Gunakan skema kebutuhan domain target; istilah produk Ruang X berbeda dari tahap engine Workroom."),
module("F10", "Tim AI dan kolaborasi",
 "Membagi pekerjaan ke beberapa spesialis dengan supervisi manusia.", "F08",
 "server/organization-engine-routes.ts client/src/pages/organization-builder.tsx shared/team-blueprints.ts",
 "Editor anggota, peran/tugas, hubungan delegasi, supervisor, preview sebelum aktivasi.",
 "teams, members, delegation_edges, team_revisions; referensi local_id sebelum menjadi ID tersimpan.",
 "Pilih sekitar tiga peran awal → tetapkan tujuan dan gate → validasi graph → preview → simpan konfigurasi/wiring atomik → jalankan terbatas.",
 "Tidak semua anggota boleh memanggil semua tool. Batasi kedalaman, budget dan durasi; hindari delegasi melingkar; autorisasi setiap sub-agent.",
 ["Referensi anggota salah/siklus terlarang ditolak.", "Kegagalan konfigurasi tidak meninggalkan setengah tim.", "Delegasi ke agen privat pihak lain ditolak."],
 "Tidak wajib Hermes/OpenClaw atau 16 agen. F09 hanya bila ingin membentuk tim dari blueprint; proses manual tetap tersedia."),
module("F11", "Workroom eksekusi",
 "Mengelola pekerjaan bertahap hingga menghasilkan output yang dapat ditinjau.", "F01 F02 F03 F12",
 "client/src/pages/workroom.tsx client/src/pages/workroom-detail.tsx shared/schema.ts server/routes.ts",
 "Daftar pekerjaan, detail langkah/checklist, log, lampiran, gerbang, keluaran dan status.",
 "workrooms, stages/tasks, outputs, logs, gate_refs; owner/project/revision/status.",
 "Buat pekerjaan → isi bukti/langkah → minta persetujuan saat gate → hasil keputusan menentukan kelanjutan → simpan output dan tutup.",
 "Centang checklist atau analisis AI bukan bukti penerimaan fisik, pembayaran, tanda tangan atau legalitas. Pembukaan gate tidak otomatis menjalankan aksi eksternal.",
 ["Langkah wajib dan gate pending mencegah selesai palsu.", "Output terkait pekerjaan dapat ditemukan setelah restart.", "Pengguna lain tidak dapat memutuskan gate dengan mengganti ID."],
 "Model tahap domain, automasi executor dan pengikatan versi gate perlu dibangun di target; sumber punya Workroom/log/gate dasar."),
module("F12", "Gerbang persetujuan manusia",
 "Memastikan keputusan penting dibuat oleh penanggung jawab yang sah.", "F01 F02 F03",
 "client/src/pages/workroom-detail.tsx shared/schema.ts server/routes.ts",
 "Antrean keputusan, bukti dan revisi objek, setujui/tolak beserta alasan, keputusan kedaluwarsa.",
 "approval_requests, decisions; actor_role, object_revision, payload_hash, policy_version, expires_at.",
 "Draf → pending → pemeriksaan manusia → approved/rejected → eksekusi terotorisasi idempoten; revisi baru membatalkan approval lama.",
 "AI tidak boleh menyetujui atas nama manusia. Maker/checker dan nominal mengikuti kebijakan target. Tindakan keselamatan darurat manusia tidak ditunda karena gate digital.",
 ["Approval dari revisi lama tidak dapat dipakai pada objek baru.", "Peminta tidak dapat menyetujui dirinya ketika maker/checker diwajibkan.", "Retry eksekusi approval tidak menggandakan transaksi."],
 "Binding hash/revisi/expiry dan state eksekusi adalah penguatan spesifikasi; bukan klaim gate Gustafta saat ini sudah lengkap."),
module("F13", "Generator dokumen",
 "Menyusun draf dokumen dari data terstruktur dan template berizin.", "F01 F02 F03",
 "client/src/pages/docgen-studio.tsx server/lib/docgen-generator.ts server/routes.ts",
 "Pilih template, form input, preview, edit, ekspor; tampilkan sumber dan status draf.",
 "templates, document_drafts, document_versions, export_jobs; revision dan input snapshot.",
 "Pilih template → isi data tervalidasi → susun draf → manusia memeriksa → ekspor format yang benar-benar didukung.",
 "Tidak membuat tanda tangan atau mengklaim dokumen resmi otomatis. Sanitasi HTML/template; data wajib kosong ditampilkan, bukan diisi fakta karangan.",
 ["Nilai input dan tabel penting sama pada preview serta ekspor.", "Template yang tidak tersedia memberi error jelas.", "Ekspor tidak mengambil arsip pengguna lain."],
 "PDF/DOCX dipilih sesuai kebutuhan dan library target. F05 opsional untuk penyimpanan; F08 opsional untuk bantuan penyusunan AI."),
module("F14", "Akademi dan pembelajaran",
 "Mengelola kursus, materi, progres, asesmen dan bukti penyelesaian.", "F01 F02 F03",
 "server/routes-lms.ts client/src/pages/admin-academy.tsx shared/schema.ts",
 "Katalog kursus, materi/lesson, progres, asesmen, admin kursus, verifikasi sertifikat terbatas.",
 "courses, lessons, enrollments, progress, assessments, issued_certificates; snapshot judul saat terbit.",
 "Daftar → akses materi sesuai hak → progres → penilaian sesuai rubrik → sertifikat jika semua syarat terpenuhi.",
 "Sertifikat internal bukan otomatis SKK/izin profesi. Sertifikat terbit tetap dapat diverifikasi jika kursus dihapus; publik hanya melihat field minimum.",
 ["Progres milik akun sendiri dan tidak bisa diisi silang.", "Belum memenuhi syarat tidak mendapat sertifikat.", "Sertifikat terbit bertahan setelah penghapusan course dengan snapshot."],
 "Seleksi akses berbayar memakai F17 jika diperlukan; asesmen berisiko memerlukan penilai manusia, bukan label lulus AI."),
module("F15", "Dashboard dan antrean tindak lanjut",
 "Menampilkan ringkasan serta tindakan relevan dari data aplikasi sendiri.", "F01 F02",
 "client/src/pages/dashboard.tsx server/ruang-kelola-routes.ts",
 "Kartu statistik, daftar prioritas, filter proyek/periode, drill-down, waktu pembaruan.",
 "Tidak wajib tabel baru; agregasi domain berizin, cache ber-scope, definisi KPI.",
 "Query berizin → agregasi server → ringkasan → klik menuju objek yang sama → tindakan melalui API domain.",
 "Angka tidak memakai data contoh pada produksi. Jumlah objek rahasia juga dapat bocor; semua agregasi/filter harus mematuhi scope.",
 ["Nilai kartu konsisten dengan daftar terfilter.", "Akun kosong menampilkan nol/keadaan kosong, bukan data seed pelanggan.", "Cache A tidak tersaji untuk B dan staleness ditandai."],
 "KPI setiap sektor didefinisikan pemilik proses; tidak mengimpor semua metrik dashboard Gustafta."),
module("F16", "Notifikasi dan pengingat",
 "Membawa tindakan jatuh tempo atau keputusan ke pengguna yang tepat.", "F01 F02 F03",
 "server/routes.ts server/lib/email.ts",
 "Inbox lokal, belum dibaca, buka objek, preferensi; status kanal eksternal bila dipilih.",
 "notifications, delivery_attempts, dedup_keys; recipient, object_ref, event_type, status.",
 "Event sah → penerima berizin → notifikasi dalam aplikasi → opsional email/WA melalui provider target → retry terbatas.",
 "Alamat/nomor provider Gustafta tidak disalin. Hindari isi sensitif dalam pesan; tautan tetap memerlukan akses sah. Jadwal tidak bergantung interval in-memory yang hilang.",
 ["Satu event tidak menggandakan pengiriman akibat retry.", "Penerima hanya melihat objek yang berhak diakses.", "Provider gagal tercatat dan tidak menggagalkan transaksi utama."],
 "Inbox lokal tidak butuh provider. Outbox durable dan scheduler dipilih sesuai runtime, bukan wajib VM/broker baru."),
module("F17", "Paket akses dan entitlement",
 "Mengatur fitur yang boleh dipakai berdasarkan paket/izin yang sah.", "F01 F02 F03",
 "server/routes.ts client/src/data/pricing.ts shared/schema.ts",
 "Daftar hak aktif, masa berlaku, halaman batas akses, admin pemberian akses dengan alasan.",
 "plans, feature_entitlements, subscriptions/grants; user/tenant, valid_from/to, source, granted_by.",
 "Tentukan paket aplikasi → grant sah/admin berizin atau pembayaran terverifikasi → server cek entitlement → kedaluwarsa mencabut hak paket.",
 "Nama badge bukan dasar izin. Jangan menyalin harga, pembagian pendapatan atau transaksi Gustafta. Account aktif berbeda dari langganan aktif.",
 ["Akses ditolak di backend ketika paket berakhir.", "Grant admin mencatat pemberi dan alasan, tidak mengubah audit lama.", "Pengguna tidak dapat mengaktifkan paket lewat payload klien."],
 "Model komersial aplikasi tujuan ditetapkan sendiri. Pembayaran opsional F19; paket akses bisa nonkomersial."),
module("F18", "Voucher/kode akses",
 "Memberi entitlement melalui kode terbatas tanpa pembayaran langsung.", "F17",
 "server/routes.ts shared/schema.ts client/src/pages/admin-access-codes.tsx",
 "Admin membuat kode, batas kuota/masa, redeem pengguna, hasil sudah dipakai/habis/kedaluwarsa.",
 "access_codes, redemptions; hash kode jika diperlukan, capacity, grant target, unique redemption.",
 "Masukkan kode → validasi server → lock kuota → catat redemption dan grant dalam transaksi → hasil konsisten pada retry.",
 "Kode adalah akses sensitif, jangan masuk log publik. Redeem tidak boleh mengaktifkan akun diblokir atau menaikkan role admin.",
 ["Dua redeem serentak pada kuota satu hanya memberi satu grant.", "Retry pengguna sama tidak mengurangi kuota lagi.", "Kode kedaluwarsa/habis ditolak tanpa efek parsial."],
 "Format, durasi dan kebijakan kode ditetapkan aplikasi tujuan, bukan mengambil kode produksi sumber."),
module("F19", "Katalog dan pesanan opsional",
 "Menampilkan produk/layanan aplikasi tujuan dan status pemenuhannya.", "F17",
 "client/src/pages/store.tsx server/routes.ts shared/schema.ts",
 "Katalog, detail produk, formulir pesanan, status bayar/pemenuhan, admin pengecualian.",
 "products, price_snapshots, orders, fulfillment_jobs; payment_provider_ref dan immutable order totals.",
 "Pilih produk → hitung harga server → buat pesanan idempoten → bayar bila provider dikonfigurasi → bukti provider sah → grant/pemenuhan.",
 "Halaman order confirmed bukan bukti paid. Provider/webhook harus diverifikasi; token download bukan dapat diperoleh dari email saja.",
 ["Harga dari klien tidak memengaruhi total server.", "Webhook ulang tidak menggandakan grant/pemenuhan.", "Pesanan unpaid tidak membuka produk atau unduhan berbayar."],
 "Provider pembayaran adalah integrasi target tersendiri, tidak menggunakan merchant/key Gustafta. Jika tidak ada provider, tampilkan mode manual secara jujur."),
module("F20", "Register kepatuhan dan tenggat",
 "Memantau dokumen wajib, kelengkapan, kedaluwarsa dan tindak lanjut perusahaan.", "F04 F05",
 "server/ruang-kelola-routes.ts client/src/pages/ruang-kelola.tsx",
 "Daftar kewajiban, status bukti, expiry, checklist kesiapan, riwayat tinjauan.",
 "compliance_requirements, document_register, evidence_links, reviews; rule_source dan checked_at.",
 "Pilih daftar kewajiban domain → tautkan bukti → cek tanggal/kelengkapan → tinjauan manusia → tindak lanjut.",
 "Lengkap secara checklist bukan sertifikasi legalitas. Referensi regulasi perlu sumber resmi dan versi; status AI berupa indikasi, bukan keputusan lembaga.",
 ["Tanggal kedaluwarsa dan daftar kekurangan dihitung konsisten.", "Bukti tidak tersedia tidak dianggap terpenuhi.", "Perubahan aturan/sumber ditampilkan dan tidak menimpa review historis."],
 "Aturan SBU/SKK/ISO tidak ditanam sebagai kebenaran universal; pemilik domain mengesahkan rule set aplikasi."),
module("F21", "Ruang solusi sektoral",
 "Membungkus fitur umum menjadi pengalaman domain yang relevan, bukan kloning seluruh platform.", "F01 F02",
 "client/src/lib/workroom-domains.ts client/src/pages/ruang-proyek.tsx server/ruang-proyek-routes.ts",
 "Beranda domain, profil konteks, daftar proses, navigasi fitur terpilih, bantuan bidang.",
 "Domain config dan record bisnis milik aplikasi; jangan membuat tabel duplikat untuk data yang sudah ada.",
 "Tentukan masalah/sektor → pilih fitur → sesuaikan istilah/form/rule → hubungkan alur lokal → tampilkan hasil domain.",
 "Jangan mengaktifkan sektor atau menu yang tidak dipilih. Nama, warna, harga, entitas legal dan aturan bisnis milik aplikasi tujuan.",
 ["Menu hanya memuat fitur terpilih dan dapat dijalankan.", "Alur domain memakai sumber data lokal yang sama, tanpa salinan transaksi paralel.", "Belum ada modul bisnis domain ditampilkan sebagai belum dibuat, bukan tersedia palsu."],
 "Logika khusus gudang/tender/RAB/alat tetap perlu blueprint domain; katalog Ruang tidak membuktikan semua aplikasi sektoral lengkap."),
module("F22", "Adapter data pusat Gustafta — opsional",
 "Membaca profil/berkas pusat hanya ketika memang perlu berbagi data, bukan untuk memasang fitur lokal.", "F01 F02 F03",
 "server/ruang-simpan-app-api.ts tests/ruang-simpan-app-api.test.ts",
 "Admin status koneksi tersanitasi, pilihan profil pusat, izin berkas terpisah, gagal/putus koneksi; token tidak ditampilkan.",
 "connection metadata, owner mapping, scope metadata, optional scoped cache with revision; credential di fasilitas secrets.",
 "Persetujuan pemilik → credential server → GET endpoint pusat → validasi JSON/header/status/scope → proyeksi field minimum dengan provenance.",
 "Default OFF. Base resmi https://gustafta.my.id; tidak mengganti ke domain lain diam-diam. profile:read tidak mengizinkan files:read/write. Tidak ada fallback bypass jika 403.",
 ["Tanpa token GET /api/v1/ruang-simpan/company-profile memberi 401 JSON dengan private,no-store dan X-Gustafta-RS-Contract=rs-app-v1-private-no-store.", "Token tanpa profile:read ditolak 403; token sah dibuktikan dari server aplikasi tujuan tanpa dipublikasikan.", "Uji dua pemilik dan izin berkas dilakukan terpisah; HTML 200 tidak dianggap sukses API."],
 "Tidak diterapkan jika mode local. Live SBU belum dinyatakan selesai oleh paket ini; adapter memerlukan pengujian nyata tersendiri.")
]

PRESETS = [
 dict(id="dokumen-kepatuhan", name="Arsip dan kepatuhan perusahaan",
      modules=["F04","F05","F06","F15","F20","F21"], reason="Profil, arsip, izin dokumen dan kelengkapan; tanpa AI/pembayaran."),
 dict(id="asisten-spesialis", name="Asisten AI bidang tertentu",
      modules=["F07","F08","F13","F15","F21"], reason="Dialog bersumber dan draf dokumen; satu asisten dahulu."),
 dict(id="operasional-proyek", name="Pekerjaan operasional proyek",
      modules=["F04","F05","F11","F12","F15","F16","F21"], reason="Pekerjaan, bukti, gerbang manusia dan tindak lanjut; proses sektoral tetap dirancang."),
 dict(id="akademi-internal", name="Akademi internal",
      modules=["F14","F15","F16","F21"], reason="Pembelajaran dan bukti penyelesaian; bukan otomatis sertifikasi profesi."),
 dict(id="layanan-berpaket", name="Layanan dengan paket akses",
      modules=["F04","F05","F17","F18","F21"], reason="Akses terbatas paket/voucher; katalog/pembayaran F19 dipilih terpisah.")
]
BASE = ["F01","F02","F03"]
by_id = {m["id"]:m for m in M}

def resolve(selected, mode="local"):
    ids = set(BASE + selected)
    if mode not in ("local", "hybrid_read_only"):
        raise ValueError("Unsupported integration mode")
    if "F22" in ids and mode == "local":
        raise ValueError("F22 requires explicit hybrid_read_only")
    if mode == "hybrid_read_only":
        ids.add("F22")
    changed = True
    while changed:
        changed = False
        for id in list(ids):
            if id not in by_id:
                raise ValueError("Unknown module: " + id)
            for dep in by_id[id]["depends_on"]:
                if dep not in ids:
                    ids.add(dep)
                    changed = True
    return sorted(ids)

selection = {
 "kit_version": VERSION,
 "application": {"name": "", "purpose": "", "sector": "", "target_repository": "proyek yang menerima unggahan"},
 "deployment_target": "desktop_web",
 "integration_mode": "local",
 "data_authority": "target_application",
 "preset": None,
 "selected_modules": [],
 "selection_confirmed": False,
 "excluded_modules": [],
 "identity_mode": "reuse_existing_or_choose_local",
 "organization_mode": "single_company",
 "branding": {"reuse_gustafta_name": False, "application_name": ""},
 "providers": {"ai": None, "email": None, "whatsapp": None, "payment": None, "storage": None},
 "implementation": {"respect_existing_stack": True, "replace_database": False, "copy_production_data": False},
 "acceptance": {"two_owner_isolation": True, "persistent_data": True, "no_mock_production": True},
 "notes": "Isi pilihan sebelum implementasi. Kosong bukan berarti semua fitur. Tidak ada credential di file ini."
}

INTRO = """# GUSTAFTA FEATURE KIT
## File unggahan untuk membangun fitur relevan di aplikasi lain

**Versi:** 1.0.0 · **Rujukan konsep:** Gustafta.my.id  
**Jenis paket:** spesifikasi portabel untuk agen pembuat aplikasi, bukan plugin siap-install, salinan aplikasi, atau token akses.  
**Sasaran:** web/desktop terlebih dahulu; pekerjaan khusus mobile tidak termasuk pilihan bawaan.  
**Status:** siap dipakai sebagai bahan implementasi. Kesiapan produksi aplikasi tujuan harus dibuktikan sesudah penerapan.

## 1. Mulai dari sini

Unggah **file Markdown ini saja** ke percakapan agen pada proyek aplikasi tujuan. Semua aturan dan spesifikasi inti ada di dalamnya; file lain dalam ZIP hanya memudahkan pemilihan dan pemeriksaan.

Berikan instruksi:

> Gunakan GUSTAFTA FEATURE KIT yang saya unggah untuk aplikasi ini. Tujuannya: [tujuan aplikasi]. Pilih fitur: [kode Fxx atau nama preset]. Gunakan mode mandiri/local, kecuali saya secara eksplisit meminta berbagi data pusat. Periksa fitur yang sudah ada, terapkan yang belum ada, pertahankan stack dan data aplikasi, lalu verifikasi seluruh alur serta batas akses. Jangan mengimplementasikan semua modul.

Jika belum tahu fitur yang dibutuhkan, tulis:

> Berdasarkan kebutuhan aplikasi [jelaskan], rekomendasikan fitur minimum dari kit, jelaskan dependensinya dan fitur yang tidak diperlukan. Minta keputusan saya sekali sebelum mulai menerapkan fitur.

**Contoh:** “Untuk aplikasi QA/QC saya pilih F04, F05, F11, F12, F15 dan F21. Semua data tetap lokal. Sesuaikan alur inspeksi, NCR dan penerimaan pekerjaan dengan blueprint QA/QC; AI tidak boleh menjadi penanggung jawab penerimaan.”

Tidak harus membuat proyek baru. Jika proyek sudah ada, agen harus memperluas fitur yang ada; bukan menggantinya. Mengunggah file tidak otomatis memasang fitur: agen di proyek penerima harus membangun dan mengujinya.

## 2. Prinsip arsitektur

1. Gustafta menjadi **rujukan pola fitur**. Aplikasi tujuan memiliki identitas, data, hak akses dan prosesnya sendiri.
2. **Mode local adalah bawaan:** tidak ada panggilan Gustafta, tidak memakai database Gustafta, tidak ada sinkronisasi latar belakang.
3. Provider AI, storage, email/WA dan pembayaran mungkin diperlukan oleh fitur tertentu. Itu layanan aplikasi tujuan, bukan kewajiban integrasi dengan Gustafta.
4. Membutuhkan profil atau berkas yang benar-benar disimpan di pusat adalah masalah berbeda: pilih F22 secara eksplisit. Dilarang mengklaim data lokal otomatis sama/tersinkron dengan pusat.
5. Satu objek bisnis mempunyai satu sumber otoritatif. Metadata/proyeksi/snapshot diberi sumber, versi dan waktu; tidak menjadi transaksi paralel.
6. Gunakan database, auth dan stack tujuan yang sudah ada. Jangan migrasi atau menghapus data tanpa keputusan pemilik.
7. Tidak menyalin harga, merchant, akun pelanggan, agen privat, basis pengetahuan privat, allowlist superadmin, OTP, API key, secrets, telemetry ID, session, file unggahan nyata atau konfigurasi internal Gustafta.
8. Kit bukan izin distribusi aset/kode pihak ketiga. Periksa lisensi jika mengambil library/aset; implementasikan perilaku sesuai spesifikasi menggunakan bahan yang berhak dipakai.

### Bukti dan batas klaim

“Referensi ditemukan” berarti ada file/route/skema/UI yang relevan dalam kode sumber saat paket dibuat. Itu **bukan** bukti endpoint live, semua kontrol benar, layanan provider tersedia atau fitur dapat dipindah tanpa penyesuaian.

Setiap kartu di bawah memisahkan **referensi sumber** dan **penguatan target**. Kontrol dan tes adalah kewajiban aplikasi tujuan, bukan laporan bahwa seluruh Gustafta sudah lolos tes tersebut. Path sumber hanya petunjuk jika sumber tersedia; agen tidak perlu memiliki repository Gustafta untuk membaca spesifikasi ini dan tidak boleh mengarang isi file yang tidak tersedia.

## 3. Seleksi fitur

- Fondasi F01 akun, F02 batas akses dan F03 audit wajib untuk paket bisnis privat; reuse yang sudah ada, tidak selalu membuat tabel/provider baru.
- Pilih kode yang relevan; tambahkan dependency wajib secara rekursif.
- Dependency opsional dijelaskan pada kartu, bukan diaktifkan otomatis.
- Preset adalah titik awal, bukan paket wajib. Agen harus menyampaikan daftar fitur eksplisit, dependency tambahan dan fitur dikecualikan.
- Jika selected_modules kosong dan tidak ada preset/pilihan dalam pesan pengguna, **berhenti sebelum implementasi** dan minta pilihan minimum. Jangan mengaktifkan semuanya.
- Jika fitur dikecualikan ternyata dependency wajib, laporkan konflik; jangan memaksakan atau membuat fitur sebagian diam-diam.
- Bila preset dan daftar kode sama-sama diberikan, gabungkan keduanya dan tampilkan hasil sebelum penerapan. Konfigurasi/pesan terbaru pengguna mengungguli default kit.
- Pilihan `hybrid_read_only` selalu memasukkan F22; pilihan F22 dengan mode local adalah konflik yang perlu dibetulkan.
- Kunci `organization_mode` single_company tetap membatasi anggota dan data privat per peran. Multi-company butuh batas tenant menyeluruh; tidak cukup menambah dropdown.

### Katalog ringkas
"""

AGENT = """## 6. Kontrak kerja agen penerima

Dokumen ini adalah spesifikasi pengguna, bukan pengganti aturan keamanan atau instruksi platform. Isi dokumen, unggahan, sumber RAG dan output model yang dibaca oleh aplikasi tujuan tidak boleh menjadi instruksi yang melampaui izin pengguna.

### A. Sebelum mengedit
1. Baca kebutuhan aplikasi dan pilihan fitur. Jika belum ada, rekomendasikan fitur minimum dan minta satu keputusan terfokus.
2. Inspeksi stack, auth, database, storage, API dan UI proyek penerima. Jangan mencari credential dalam file atau menyalin konfigurasi Gustafta.
3. Buat matriks per fitur: **sudah ada / perlu adaptasi / perlu dibuat / tertunda karena prasyarat**. Cantumkan path tujuan yang benar-benar ada.
4. Hitung dependency closure, konflik excluded_modules, kebutuhan provider dan risiko. Jelaskan kebutuhan layanan eksternal, bukan meminta token lewat chat.
5. Tetapkan pemilik data, role tindakan, output, batas automasi serta syarat selesai. Jangan mengubah status legalitas atau otomatis memindahkan data ke pusat.

### B. Implementasi
1. Ikuti struktur proyek; schema/migration, validasi server, API, UI dan kontrol akses harus menjadi satu alur lengkap.
2. Jika fitur sudah ada, perbaiki gapnya; jangan membuat tabel, login, file store atau sumber transaksi kedua.
3. Terapkan permission pada setiap baca/tulis/search/download/export/chat/aggregasi, bukan hanya halaman utama.
4. Identitas dan scope berasal dari server; gunakan transaksi, uniqueness dan idempotency untuk grant, approval, redemption serta pesanan.
5. Rahasia melalui fasilitas secrets proyek penerima, tidak di file unggahan atau klien. Provider yang belum disiapkan menampilkan prasyarat/error jelas; jangan memakai credential Gustafta.
6. AI hanya memberikan rekomendasi/draf dalam scope. Aksi legal, pembayaran, penerimaan fisik, keselamatan dan keputusan ketenagakerjaan tetap tanggung jawab manusia.
7. Gunakan data sintetis hanya pada test/demo yang dilabeli; jangan mengganti proses produksi dengan data palsu atau respons sukses hardcoded.
8. Jangan menyalakan worker/panggilan jaringan untuk fitur yang tidak dipilih. Terapkan cache privat terpisah per scope dan pencabutan akses.
9. UI menyediakan empty/loading/error/conflict, create/edit/archive/delete jika relevan; tindakan destruktif memerlukan penjelasan dan persetujuan.
10. Ikuti gaya aplikasi tujuan. Gustafta bukan otomatis nama, logo, harga maupun badan hukum aplikasi baru.

### C. Verifikasi dan serah terima
1. Jalankan pemeriksaan tipe/lint/build yang relevan di proyek penerima.
2. Periksa persistensi dan alur dari UI sampai API untuk fitur yang berubah.
3. Jalankan tes API dua pemilik/dua organisasi dengan data sintetis terisolasi. Jangan memodifikasi produksi hanya untuk tes.
4. Uji expired/revoked/missing rights, konflik revision, kegagalan provider, retry dan duplikasi sesuai fitur.
5. Pisahkan hasil **sudah dijalankan dan lulus**, **gagal**, dan **belum dapat diuji beserta sebabnya**. Jangan mengubah checklist rencana menjadi klaim tes lulus.
6. Laporkan fitur diterapkan, dependency, prasyarat operator dan keterbatasan. Fitur yang belum memiliki backend/UI/persistensi jangan dinyatakan selesai.
7. Jangan publish otomatis. Pemilik memutuskan setelah hasil verifikasi.

### Artefak yang dibuat di proyek penerima
- `docs/feature-kit-selection.json`: pilihan final tanpa credential.
- `docs/feature-kit-mapping.md`: fitur → komponen/API/schema tujuan; reuse/adapt/new/deferred.
- `docs/feature-kit-verification.md`: metode, hasil nyata, tanggal dan batas pengujian.
- Migration/schema, API, UI dan tes untuk fitur terpilih, mengikuti struktur lokal.

## 7. Kontrak teknis minimum

Nama tabel/API di kartu adalah **model konseptual**, bukan keharusan mengganti tabel atau route aplikasi yang sudah ada.

### Data dan transaksi
- Objek privat mempunyai owner/tenant yang berasal dari sesi server; project_id hanya jika aplikasi membutuhkannya. Foreign key lintas scope harus divalidasi.
- Revisi integer untuk optimistic concurrency: create awal dan update existing memakai cabang atomik berbeda. Revision salah → konflik, bukan last-write-wins.
- Transaksi penting meliputi perubahan bisnis, grant/kuota, audit keberhasilan dan outbox bila relevan.
- Idempotency key mengikat aktor/scope/aksi dan hash payload. Key sama dengan payload berbeda ditolak. Retry ambigu memakai key sama, tidak membuat transaksi baru.
- Semua perubahan schema memelihara data; rollback dan pemulihan disiapkan sesuai risiko. Data pribadi minim, retensi ditetapkan pemilik proses.

### API dan sesi
- API mengembalikan JSON dengan status tepat; 200 HTML dari fallback SPA bukan sukses API.
- 401 belum memiliki identitas sah; 403 identitas ada namun tindakan tidak diizinkan; 404 untuk objek hilang/tidak terlihat sesuai kebijakan; 409 konflik; 422 validasi; 429 pembatasan. Jangan bocorkan detail objek privat.
- Respons privat, termasuk error autentikasi/otorisasi, memakai `Cache-Control: private, no-store` jika mengandung atau melindungi data sensitif. Jangan cache API privat di service worker/CDN publik.
- Error memakai pesan aman dan correlation ID; jangan serialisasi exception berisi credential/request sensitif.
- Mutation berbasis cookie terlindung CSRF/same-origin. Validasi ukuran input sebelum parsing payload besar; rate limiter dipilih sesuai jumlah instance.
- URL backend pada frontend mengikuti pola same-origin proyek; bukan localhost atau domain Gustafta untuk mode local.

### Storage dan AI
- Database menyimpan metadata; berkas berada di storage privat yang dipilih target. Download selalu memeriksa hak; presigned URL terbatas waktu dan tidak masuk log.
- Jangan memberi akses arbitrary URL/filesystem/shell kepada agen AI. Tool allowlist dan scope diperiksa pada server tiap invocation.
- Retrieval memakai scope sebelum memilih chunk; permission public chat tidak sama dengan izin membuka semua sumber mentah.
- Model/provider mati → error jelas, fallback hanya jika dikonfigurasi dan dinyatakan; tidak mengarang dokumen/hasil.
- Streaming punya kontrak event/end/error yang jelas; ukuran konteks, token budget, timeout dan pembatalan dibatasi.

### Pekerjaan latar belakang
- Tidak semua aplikasi perlu queue. Jika memakai notifikasi eksternal, pembayaran atau pemrosesan lama: simpan job/outbox durable, retry dengan backoff, lease dan dedup.
- Worker lama tidak boleh menimpa hasil worker baru setelah lease habis; finalisasi memakai versi/claim yang sah.
- UI dapat membedakan queued/processing/done/failed. Restart tidak boleh menghilangkan job.

## 8. Uji penerimaan lintas fitur

Ini rencana uji aplikasi tujuan; **bukan laporan bahwa tes live sudah dilakukan**.

| ID | Skenario | Hasil yang diwajibkan |
|---|---|---|
| T01 | API privat tanpa sesi | Ditolak JSON; tidak mendapat data atau HTML sukses |
| T02 | Akun A mengganti ID ke objek B | Baca/tulis/ekspor/unduh/search/AI tidak membocorkan objek B |
| T03 | Akun/anggota/grant dicabut | Akses berikutnya ditolak, termasuk cache dan download sesuai lifetime |
| T04 | Create/edit dan restart aplikasi | Data sah tetap ada; UI bukan state sementara saja |
| T05 | Dua edit dengan revision sama | Satu berhasil; yang lain konflik tanpa overwrite |
| T06 | Retry aksi/grant/kuota/approval | Efek bisnis hanya sekali; payload beda dengan key sama ditolak |
| T07 | Provider/storage/model gagal | Error/queue status jujur; transaksi tidak dinyatakan sukses palsu |
| T08 | Scope hanya read | Mutasi tetap ditolak di server meskipun request dibuat manual |
| T09 | Payload/bukti berubah setelah approval | Approval lama tidak dapat mengeksekusi versi baru |
| T10 | Dokumen berisi instruksi menyerang | Tidak mengubah scope/tool policy atau membocorkan sumber lain |
| T11 | Ekspor dan log | Tidak mengandung token, secret atau data privat pihak lain |
| T12 | Mode local | Tidak ada request/jadwal menuju Gustafta atau database Gustafta |
| T13 | Modul tidak dipilih | Tidak ada menu aktif/worker/route bisnis baru untuk modul itu |
| T14 | Compile/build | Pemeriksaan yang dipakai proyek lulus; kegagalan tidak diabaikan |
| T15 | Alur UI pengguna terpilih | Create/read/edit serta state gagal/konflik benar-benar berfungsi |
| T16 | Hybrid F22 dipilih | Kontrak JSON/header/scope dan dua pemilik dibuktikan dari aplikasi tujuan |

Jika menggunakan database yang sama dengan produksi, tes tidak boleh mengubah data nyata. Utamakan fixture terisolasi, transaksi rollback dan identitas sintetis; bila itu tidak tersedia laporkan blocker.

## 9. Perubahan versi kit

Versi kit adalah versi spesifikasi, bukan versi aplikasi Gustafta maupun skema target. Penerapan mencatat versi dan modul yang digunakan.

Pembaruan kit **tidak otomatis mengubah aplikasi**. Bandingkan versi, schema, role, gate dan tes; rencanakan migrasi hanya untuk perubahan yang diperlukan. Jangan menimpa adaptasi domain atau pilihan pengguna.

## 10. Batas akhir

- Kit tidak menghubungkan aplikasi, tidak menerbitkan token, tidak memindahkan data dan tidak mengesahkan legalitas.
- Fitur generik bisa diterapkan tanpa integrasi Gustafta. Kebutuhan berbagi data pusat tetap perlu izin dan pembuktian terpisah.
- Integrasi live SBU bukan hasil dari pembuatan kit ini dan tidak dinyatakan selesai.
- Blueprint SIGAP/kontraktor dapat menjadi kebutuhan domain tambahan, tetapi jangan otomatis memasang seluruh aplikasi, 16 agen atau seluruh SOP.
- Keputusan pemilik aplikasi tujuan dan batas akses lebih penting daripada meniru tampilan Gustafta.
"""

def bullets(items):
    return "\n".join("- " + s for s in items)

def build():
    assert len(M) == 22 and len(by_id) == len(M)
    for m in M:
        assert all((ROOT / p).is_file() for p in m["evidence_paths"]), m["id"]
        assert all(d in by_id and d != m["id"] for d in m["depends_on"])
        assert len(m["acceptance"]) == 3
    # Verify graph, not only closure: cycles must fail.
    def visit(id, active, done):
        if id in active:
            raise AssertionError("Dependency cycle: " + id)
        if id in done:
            return
        active.add(id)
        for d in by_id[id]["depends_on"]:
            visit(d, active, done)
        active.remove(id)
        done.add(id)
    done = set()
    for id in by_id:
        visit(id, set(), done)
    for p in PRESETS:
        p["resolved_modules"] = resolve(p["modules"])
        assert "F22" not in p["resolved_modules"]

    text = INTRO + "\n| Kode | Fitur | Dependency wajib | Pemakaian |\n|---|---|---|---|\n"
    for m in M:
        text += f"| {m['id']} | {m['name']} | {', '.join(m['depends_on']) or '—'} | {'Opsional, berbagi data pusat' if m['id']=='F22' else 'Lokal'} |\n"
    text += "\n### Preset pilihan\n\n"
    for p in PRESETS:
        text += f"**{p['name']}** (`{p['id']}`)\n\n"
        text += f"- Pilihan: {', '.join(p['modules'])}.\n- Setelah dependency: {', '.join(p['resolved_modules'])}.\n- Tujuan: {p['reason']}\n\n"
    text += """## 4. Form pilihan yang dapat disalin

Isi di pesan pengguna atau file JSON pendamping. Pengguna tidak perlu mengedit JSON jika sudah menyebut kode/preset dengan jelas. Agen mencatat hasil final, bukan menganggap template kosong sebagai persetujuan.

```json
""" + json.dumps(selection, ensure_ascii=False, indent=2) + "\n```\n\n"
    text += """**Semantik pilihan:** jika preset tidak kosong, cari ID preset yang tersedia, gabungkan dengan selected_modules, lalu tambah fondasi dan dependency wajib. Tolak kode/preset yang tidak dikenal, konflik excluded_modules, atau mode tidak didukung. `selection_confirmed=true` hanya setelah pengguna benar-benar memilih/menyetujui; jangan diubah sendiri oleh agen. Pengguna yang jelas memerintahkan implementasi modul tertentu dapat dihitung sebagai konfirmasi pilihan itu.

`local` berarti data otoritatif milik aplikasi tujuan. `hybrid_read_only` berarti F22 diaktifkan secara eksplisit: data pusat tertentu dibaca, tidak ditulis. Tentukan per field/objek mana yang otoritatif di pusat; snapshot lokal diberi provenance. Mode write-back tidak disediakan kit ini.

## 5. Spesifikasi modul

"""
    for m in M:
        text += f"### {m['id']} — {m['name']}\n\n"
        for label, value in [
            ("Tujuan", m["purpose"]),
            ("Dependency wajib", ", ".join(m["depends_on"]) or "Tidak ada; fondasi"),
            ("UI minimum", m["screens"]), ("Model data konseptual", m["records"]),
            ("Alur minimum", m["flow"]), ("Kontrol wajib", m["controls"]),
            ("Penguatan/adaptasi target", m["target_extension"]),
            ("Status bukti", m["evidence_status"]),
            ("Referensi sumber", "; ".join("`"+p+"`" for p in m["evidence_paths"]))
        ]:
            text += f"**{label}:** {value}\n\n"
        text += "**Tes penerimaan modul:**\n" + bullets(m["acceptance"]) + "\n\n"
    text += AGENT

    files = {}
    files["GUSTAFTA_FEATURE_KIT_UPLOAD.md"] = text.encode()
    files["PILIHAN_FITUR_TEMPLATE.json"] = (json.dumps(selection, ensure_ascii=False, indent=2)+"\n").encode()
    catalog = dict(kit_version=VERSION, type="portable_specification_not_runtime_plugin",
                   reference_domain="https://gustafta.my.id", baseline_modules=BASE,
                   default_integration_mode="local", modules=M, presets=PRESETS)
    files["KATALOG_FITUR.json"] = (json.dumps(catalog, ensure_ascii=False, indent=2)+"\n").encode()
    output = io.StringIO(newline="")
    w = csv.writer(output)
    w.writerow(["Kode", "Fitur", "Tujuan", "Dependency wajib", "Mode", "Status bukti", "Referensi sumber"])
    for m in M:
        w.writerow([m["id"], m["name"], m["purpose"], ", ".join(m["depends_on"]),
                    "Opsional hybrid_read_only" if m["id"]=="F22" else "local",
                    m["evidence_status"], "; ".join(m["evidence_paths"])])
    files["KATALOG_FITUR.csv"] = output.getvalue().encode("utf-8-sig")
    files["PROMPT_UNTUK_AGEN.txt"] = """Gunakan GUSTAFTA_FEATURE_KIT_UPLOAD.md yang saya unggah sebagai spesifikasi.

Aplikasi tujuan: [nama dan tujuan aplikasi].
Pilihan fitur/preset: [isi kode Fxx atau ID preset].
Mode: local. Data tetap di aplikasi ini; tidak memanggil Gustafta.

Periksa proyek ini dahulu dan gunakan fitur yang sudah ada. Hitung dependency wajib dan laporkan konflik. Jangan memasang semua modul atau menyalin database, pelanggan, secrets, harga maupun konfigurasi privat Gustafta.

Jika pilihan belum diisi, rekomendasikan modul minimum dan minta keputusan sebelum implementasi. Jika sudah jelas, terapkan API, UI, penyimpanan, hak akses dan tes modul terpilih mengikuti stack yang ada. Laporkan hasil yang benar-benar diuji, prasyarat yang belum tersedia dan blocker. Tidak publish otomatis.

Gunakan credentials/provider milik aplikasi ini melalui fasilitas secrets, bukan chat atau file unggahan. Integrasi data pusat hanya bila saya meminta F22 dan hybrid_read_only secara eksplisit.
""".encode()
    files["README_MULAI_DI_SINI.md"] = """# Cara memakai paket

1. Buka proyek aplikasi tujuan.
2. Unggah **GUSTAFTA_FEATURE_KIT_UPLOAD.md**. File ini lengkap dan cukup digunakan sendiri.
3. Salin PROMPT_UNTUK_AGEN.txt, lalu isi tujuan dan kode fitur/preset.
4. Bila belum tahu pilihan, minta rekomendasi minimum sebelum implementasi.
5. Agen menerapkan fitur secara lokal, lalu membuktikan alur serta batas akses.

## Isi
- File Markdown utama: seluruh katalog, spesifikasi, dependency, preset, aturan keamanan dan tes.
- KATALOG_FITUR.json/CSV: mudah dipilih atau diolah; bukan kode plugin.
- PILIHAN_FITUR_TEMPLATE.json: pilihan kosong disengaja, bukan izin memasang semua.
- PROMPT_UNTUK_AGEN.txt: instruksi yang tinggal disalin dan diisi.
- MANIFEST.json: daftar hash untuk memeriksa integritas paket.

ZIP boleh diekstrak dahulu. Jika agen dapat membaca ZIP, minta ia membuka README dan file utama; jangan hanya membaca CSV.

Tidak ada credential, akun, data perusahaan/pelanggan, file produksi atau kode aplikasi di paket ini. Referensi kode pada modul adalah provenance kemampuan, bukan jaminan sertifikasi atau kesiapan endpoint live.

Mode awal: **mandiri/local**. AI/email/WA/storage/pembayaran opsional membutuhkan provider aplikasi tujuan. Hanya F22 menambahkan koneksi baca data Gustafta, dengan izin dan verifikasi terpisah.

Paket tidak mengubah Gustafta, tidak memperbarui Notion dan tidak menyelesaikan integrasi live SBU.
""".encode()
    manifest = dict(kit_version=VERSION, artifacts=[
        dict(path=n, bytes=len(b), sha256=hashlib.sha256(b).hexdigest()) for n,b in files.items()
    ], evidence="Static source references checked; runtime and live integration not tested",
       module_count=len(M), preset_count=len(PRESETS))
    files["MANIFEST.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2)+"\n").encode()

    # Ensure self-contained specification contains all module cards and all test IDs.
    assert set(re.findall(r"^### (F\d\d) —", text, re.M)) == set(by_id)
    assert all(f"| T{i:02d} |" in text for i in range(1,17))
    assert "Integrasi live SBU" in text
    assert selection["selection_confirmed"] is False and selection["selected_modules"] == []
    assert resolve(["F11"]) == ["F01","F02","F03","F11","F12"]
    assert "F22" in resolve(["F04"], "hybrid_read_only")
    try:
        resolve(["F22"])
    except ValueError:
        pass
    else:
        raise AssertionError("Local mode must not activate F22")
    for n,b in files.items():
        if n.endswith(".json"):
            json.loads(b)
        # Patterns that would indicate an accidentally copied credential.
        assert not re.search(rb"(?:xkeysib-[A-Za-z0-9]+|sk-[A-Za-z0-9]{20,}|postgres(?:ql)?://[^\\s]+@)", b), n
        (OUT/n).write_bytes(b)
    archive = OUT.parent / "GUSTAFTA_FEATURE_KIT_v1.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for n,b in files.items():
            z.writestr("GUSTAFTA_FEATURE_KIT/"+n, b)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert len(z.namelist()) == 7
        assert not any(n.endswith(".py") for n in z.namelist())
    print(json.dumps(dict(validation="PASS", modules=len(M), presets=len(PRESETS),
                          files=len(files), main_document_bytes=len(files["GUSTAFTA_FEATURE_KIT_UPLOAD.md"]),
                          zip_bytes=archive.stat().st_size), indent=2))

if __name__ == "__main__":
    build()
