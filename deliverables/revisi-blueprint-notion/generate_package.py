"""Generate document deliverables using only the Python standard library."""
import csv
import hashlib
import html
import io
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
SOURCES = [
    "BLUE_PRINT_APLIKASI_PENUTUP_CELAH_OPERASIONAL_1791516038811.zip",
    "BLUE_PRINT_KONTRAKTOR_OTONOM_1791516038813.zip",
    "SOP_AGENTIC_1791516051937.zip",
    "SOP_KONVENSIONAL_1791516051938.zip",
    "SPESIFIKASI_INTEGRASI_SIGAP_1791516051939",
]

# Each row: accountable human, final reviewer, official data owner, output,
# minimum workflow, safety boundary, specific acceptance test.
DETAILS = {
    1: ("Site Manager", "Site Manager untuk MR; pejabat PO sesuai policy", "Gudang/Procure",
        "MR draf -> MR approved; PO draf terpisah",
        "Baca jadwal/BoQ dan stok berstatus -> hitung kebutuhan -> MR draf -> review kebutuhan -> approval -> RFQ/PO draf",
        "Tidak mengesahkan PO; limit berdasarkan policy versi dan transaksi terkait",
        "Stok quarantine tidak dihitung tersedia; split PO tidak melewati approval"),
    2: ("Kepala Gudang", "Storekeeper untuk jumlah; QC untuk mutu", "Gudang/Procure + acceptance QA/QC",
        "Receipt kandidat; GRN accepted atau rejected",
        "Identifikasi PO -> cek fisik/surat jalan -> receipt kandidat -> quarantine -> acceptance QC -> ledger stok",
        "OCR/foto bukan penerimaan final; retur hanya draf sampai berwenang",
        "Receipt diulang tidak menambah stok dua kali; rejected tidak menjadi available"),
    3: ("Kepala Gudang", "Kepala Gudang; Finance untuk adjustment material", "Gudang/Procure",
        "Ledger mutasi; reservation; adjustment proposal",
        "Tempatkan material -> identifikasi lot/uom -> reserve/issue dengan bukti -> cocokkan saldo -> ajukan selisih",
        "Tidak edit saldo langsung; reversal tercatat; FEFO bila applicable",
        "Issue paralel tidak membuat saldo negatif di luar policy; konversi unit konsisten"),
    4: ("Kepala Alat", "Operator pemeriksa; Kepala Alat untuk release", "Alat + safety reference",
        "Checklist terverifikasi; izin administratif pakai/hold",
        "Baca booking -> operator checklist -> hold bila gagal -> pemeriksaan manusia -> release berwenang -> log operasi",
        "AI tidak mengesahkan alat aman; petugas tetap mengendalikan operasi fisik",
        "Inspection failed memblokir booking operasi; release butuh bukti pemeriksaan"),
    5: ("Kepala Alat", "Petugas serah-terima; Kepala Alat", "Alat",
        "Register lokasi/kondisi alat terverifikasi",
        "Alat kembali -> petugas cek fisik -> capture kondisi/lokasi -> update register -> review ketidaksesuaian",
        "Rekap lokasi otomatis bukan proof kondisi fisik; tidak otomatis available",
        "Alat rusak yang disimpan tidak berubah menjadi siap operasi"),
    6: ("Quantity Control / Site Engineer", "Site Manager; pengawas/pihak owner sesuai kontrak", "Project + QA/QC acceptance",
        "Opname draf; BA accepted terikat versi",
        "Ukur fisik -> cocokkan drawing/baseline -> cek acceptance mutu -> hitung deterministik -> review -> BA",
        "Foto tidak menjadi volume final; QA/QC bukan satu-satunya owner pengukuran",
        "Volume unsupported ditandai; BA stale tidak menjadi dasar invoice"),
    7: ("Site Manager", "Site Manager/PM sebelum penerbitan eksternal", "Project",
        "Rekap internal; laporan eksternal approved",
        "Kumpulkan observation -> verifikasi -> hitung progres accepted -> rekap -> review laporan eksternal -> kirim",
        "L4 hanya rekap sumber accepted; tidak menerbitkan klaim kemajuan dari tebakan",
        "Laporan rejected tidak terkirim ke owner; revisi sumber terlihat"),
    8: ("Finance Manager", "Finance checker; Direktur/auditor sesuai kewajiban", "ERP",
        "Laporan keuangan draf/approved; close reference",
        "Ambil ledger ERP -> reconcile -> daftar exception -> review finance -> close oleh otoritas -> laporan",
        "AI tidak post jurnal/tutup periode; auditor bukan persetujuan rutin tiap transaksi",
        "Unbalanced ledger dan mismatch ditandai; laporan dapat ditelusuri ke ledger"),
    9: ("Kepala Bagian Keuangan", "Checker keuangan; PM sesuai delegasi", "ERP",
        "Petty cash request; settlement terverifikasi",
        "Ajukan kebutuhan/bukti -> cek limit -> gate -> disbursement manusia -> bukti belanja -> reconcile",
        "Tidak transfer dana; no auto-approve; maker-checker",
        "Bukti nota duplikat ditandai; pembayaran tidak dianggap terjadi dari pesan WA"),
    10: ("HR Manager", "PM dan checker keuangan; otoritas pembayaran terpisah", "HR untuk input; ERP untuk pembayaran",
         "Payroll input accepted; batch payroll draf; payment reference",
         "Absensi/lembur accepted -> ruleset effective-date -> hitung -> dispute review -> approve batch -> pembayaran berwenang",
         "Tidak agent pay; approval payroll tidak sama transfer; slip privat",
         "Absensi direvisi setelah approval meng-invalidasi batch; akun lain tidak melihat slip"),
    11: ("Finance Manager", "Finance checker dan pejabat penerbit invoice", "ERP + BA Project",
         "Invoice draf -> issued; aging resmi",
         "Cek kontrak/BA accepted -> hitung termin/retensi -> draft -> review -> issue -> reconcile pembayaran",
         "Status kirim/reminder bukan paid; tidak invoice dari progres unverified",
         "Invoice retry tidak ganda; BA revision berubah perlu review ulang"),
    12: ("Site Engineer / Surveyor", "Site Engineer; Quantity Control", "Project measurement",
         "Measurement report accepted; kandidat perubahan baseline",
         "Rencanakan ukur -> ukur manusia -> upload bukti -> banding baseline -> review -> ajukan delta",
         "AI tidak mengganti survei fisik; delta tidak mengubah kontrak otomatis",
         "Unit/revision drawing mismatch ditolak sebelum delta diterima"),
    13: ("Project Manager", "Direktur dan pihak penerima sesuai kontrak", "Project + CDE references",
         "Paket final handover/FHO sesuai applicability",
         "Identifikasi jenis serah-terima -> checklist kontrak -> kumpulkan as-built/BA -> inspeksi -> gate -> arsip",
         "Pisahkan dari PHO27 dan consumer BAST26; AI bukan penandatangan",
         "Dokumen wajib missing memblokir readiness; PHO tidak dianggap FHO"),
    14: ("Tax Officer / Finance Manager", "Tax Officer/konsultan pajak; pejabat pelapor", "ERP + tax ruleset",
         "Rekap pajak/SPT draf; bukti lapor/setor resmi",
         "Baca transaksi -> tentukan ruleset periode -> hitung -> review tax -> pelaporan manusia -> arsip proof",
         "Tidak menetapkan tarif dari LLM; no agent filing/payment final",
         "Aturan beda effective date dihitung sesuai periode; draft tidak dianggap filed"),
    15: ("HR Manager", "HR Manager dan PM", "HR + Project schedule",
         "Resource plan draf/approved",
         "Ambil kebutuhan jadwal -> skill/capacity matching -> rencana -> review HR/PM -> penempatan sah",
         "Tidak mengambil keputusan pekerjaan manusia dari skor AI",
         "Personel expired/overallocated ditandai; kebutuhan unknown perlu review"),
    16: ("HR Manager", "HR Manager; pihak penandatangan kontrak kerja", "HR",
         "Permintaan tenaga; kandidat; keputusan HR; kontrak draf",
         "Review request -> cari kandidat -> cek bukti -> wawancara manusia -> keputusan -> kontrak berwenang",
         "No auto-reject/auto-hire; minimisasi CV/PII",
         "Kandidat tanpa bukti tidak dinyatakan qualified; pembatasan data kandidat lulus"),
    17: ("HR Manager / Atasan Langsung", "Atasan langsung sesuai delegasi lembur", "HR",
         "Permintaan lembur approved; rekap accepted",
         "Ajukan lembur -> cek jadwal/aturan -> approval manusia -> bukti jam -> verifikasi -> rekap payroll",
         "L4 hanya rekap; izin lembur dan upah tetap dikendalikan",
         "Rekap tanpa approval tidak otomatis menjadi payroll accepted"),
    18: ("Site Supervisor / Kepala Keamanan", "Petugas akses; PM sesuai policy", "Safety/Security",
         "Access log; alert; izin akses berwenang",
         "Verifikasi identitas/izin -> petugas kontrol akses -> log -> alarm pelanggaran -> review",
         "Vision bukan identitas pasti; no AI-only physical access authorization",
         "Alarm bypass antrean LLM; pengguna revoked tidak dapat masuk via izin lama"),
    19: ("Kepala Keamanan / Manajemen", "Direktur; legal untuk laporan eksternal", "Security + Gudang evidence",
         "Laporan indikasi; investigation record; tindakan manusia",
         "Terima indikasi -> amankan bukti -> cross-check stok/akses -> investigasi manusia -> keputusan -> arsip",
         "Selisih bukan bukti pencurian; tidak menuduh/melapor polisi otomatis",
         "False alarm tidak membuat tindakan disipliner; bukti restricted"),
    20: ("HSE Officer", "Petugas darurat/HSE; PM untuk koordinasi", "Safety/K3",
         "Alarm; respons manusia; incident record; izin lanjut",
         "Alarm segera -> manusia mengikuti prosedur darurat -> stabilisasi -> dokumentasi -> investigasi -> release berwenang",
         "Tidak tunggu approval digital; no diagnosis/pertolongan fisik AI",
         "Jalur darurat tetap bekerja ketika AI/HUB down"),
    21: ("Kepala Gudang", "Checker stock opname; Finance untuk adjustment", "Gudang/Procure",
         "Count sheet; variance; adjustment approved",
         "Tentukan cutoff/movement -> hitung manusia -> reconcile ledger -> investigasi -> gate adjustment -> reversal/posting",
         "Pisahkan counter dan checker; tidak edit saldo untuk menyamakan hitung",
         "Movement saat opname tercatat; adjustment stale tidak dieksekusi"),
    22: ("Kepala Alat", "Teknisi untuk tindakan; Kepala Alat/PM untuk biaya", "Alat",
         "Repair work order; inspeksi release",
         "Tiket -> hold -> diagnosis teknisi -> draf biaya -> approval -> repair -> test -> release",
         "Rekomendasi AI bukan instruksi teknis final",
         "Alat tetap hold sampai test/release accepted; retry WO tidak duplikat"),
    23: ("Kepala Alat", "Kepala Alat; teknisi/operator untuk bukti servis", "Alat",
         "Jadwal/reminder; maintenance work order; bukti servis",
         "Meter accepted -> aturan pabrikan -> jadwal -> reminder -> servis manusia -> proof -> next due",
         "L4 penjadwalan saja; no auto-maintained state dari reminder",
         "Reminder terkirim tidak menutup servis; overdue terlihat"),
    24: ("Project Manager", "PM untuk baseline/recovery", "Project",
         "Deviasi; recovery proposal; baseline revision approved",
         "Baca accepted progress -> compare baseline -> alert -> simulasi recovery -> PM review -> revision",
         "Tidak update progres accepted dari AI; ambang poin persentase jelas",
         "Progress stale ditandai; baseline revision lama tetap tersimpan"),
    25: ("Site Engineer", "Perencana/pejabat teknis; QC sesuai ITP", "CDE + QA/QC",
         "Matriks spesifikasi dan checklist versi berlaku",
         "Ambil dokumen approved -> map requirement -> cek konflik -> review engineer -> publish controlled reference",
         "AI tidak menyetujui desain; dokumen superseded tidak dipakai",
         "Drawing revision berbeda memicu review; requirement unknown tidak dikarang"),
    26: ("Manajer Aftersales", "PM/pihak penerima unit sesuai kontrak", "Layan + Project handover refs",
         "Checklist per unit; consumer BAST sah",
         "Cek readiness unit -> inspeksi konsumen -> punch list -> manual/garansi -> BAST -> arsip",
         "Tidak menyamakan BAST konsumen dengan PHO/FHO proyek",
         "Unit pelanggan lain tidak terlihat; punch list unresolved sesuai kontrak ditangani"),
    27: ("Project Manager", "Direktur dan pihak pengawas/penerima berwenang", "Project",
         "Permohonan PHO; BA; punch list",
         "Cek persyaratan PHO -> inspect -> punch list -> review pihak -> BA -> pemeliharaan",
         "100% angka progres tidak otomatis PHO accepted",
         "PHO readiness gagal bila bukti kontrak wajib belum lengkap"),
    28: ("Manajer Aftersales", "Manajer Aftersales sesuai batas komitmen", "Layan",
         "Warranty ticket; scope decision; repair/closure evidence",
         "Terima tiket -> triase urgent -> cek kontrak/garansi -> keputusan manusia -> WO -> kunjungan -> closure",
         "Acknowledgment bukan diagnosis/garansi diterima; biaya perlu gate",
         "Tanggal/jenis garansi applicable diverifikasi; tiket duplikat digabung terkontrol"),
    29: ("Manajer Aftersales", "Manajer Aftersales; PM untuk perubahan scope", "Layan",
         "Complaint case; opsi perbaikan; closure",
         "Catat keluhan -> triase -> cek fakta -> respons draf -> gate komitmen -> tindakan -> bukti",
         "Tidak janji biaya/waktu baru otomatis; bahaya langsung jalur darurat",
         "Pengguna hanya melihat kasus berizin; respons substantive dibedakan auto-reply"),
    30: ("Project Manager", "Direktur untuk delegasi strategis", "Project + ERP read refs",
         "Decision log PM; delegasi dan action plan",
         "Copilot rangkum -> PM review risiko -> PM keputusan -> delegasi -> tracking manusia",
         "Jabatan PM tidak digantikan orkestrator; izin domain tetap berlaku",
         "Copilot tidak dapat approve atas nama PM"),
    31: ("Site Manager", "PM sesuai delegasi", "Project",
         "Rencana lapangan; validasi laporan; koordinasi",
         "Copilot siapkan -> Site Manager cek lapangan -> prioritas -> instruksi manusia -> verifikasi",
         "Tanggung jawab lapangan tetap manusia",
         "Laporan tanpa validasi tidak accepted; delegasi tercatat"),
    32: ("Site Engineer", "Site Manager; perencana untuk perubahan desain", "Project/CDE + QA/QC refs",
         "Review teknis; solusi terverifikasi",
         "Baca revision -> analisis copilot -> engineer verifikasi -> review desain bila perlu -> record",
         "Scheduler bukan pejabat teknis pengganti",
         "AI suggestion tidak mengubah spesifikasi approved"),
    33: ("QC Engineer", "Pejabat QC sesuai ITP; pihak owner bila applicable", "QA/QC",
         "Acceptance mutu; NCR; bukti uji",
         "AI siapkan checklist -> inspeksi/lab manusia -> QC keputusan -> NCR/CAPA ref -> release",
         "NCR final milik QA/QC, bukan Project atau AI",
         "Acceptance tanpa hasil uji wajib ditolak"),
    34: ("Quantity Control", "Site Engineer/PM; counterpart sesuai kontrak", "Project measurement + Gudang refs",
         "Measurement accepted; quantity reconciliation",
         "Ukur -> AI rekonsiliasi BoQ/material -> investigasi -> quantity review -> record",
         "Bukan hanya SOP gudang; volume diterima melalui pengukuran",
         "Pemakaian material tidak dianggap otomatis volume pekerjaan"),
    35: ("Site Supervisor", "Site Manager", "Project + Safety refs",
         "Pengawasan mandor; laporan terverifikasi",
         "Rangkum rencana -> briefing manusia -> awasi lokasi -> validasi observation -> eskalasi",
         "Copilot tidak memerintah pekerjaan berbahaya tanpa kontrol petugas",
         "Bahaya dilaporkan tanpa menunggu laporan harian"),
    36: ("Pejabat Logistik-Purchasing", "PM/direktur sesuai purchasing policy", "Gudang/Procure",
         "Vendor evaluation; negosiasi; PO draf/issued berwenang",
         "AI compare -> human negotiate -> due diligence -> review budget -> gate PO -> delivery tracking",
         "Tidak konflik kepentingan/pecah transaksi; vendor master satu owner",
         "Vendor COI/high-risk ter-eskalasi; tidak otomatis PO"),
    37: ("Staff Admin / Document Controller", "Site Manager/process owner", "CDE/ISO + Project refs",
         "Dokumen terkendali; notulen dan distribusi",
         "AI draft/index -> admin cek akses/versi -> review -> distribusi berizin -> arsip",
         "Admin bukan orkestrator accountable; tidak menyebar file privat",
         "Dokumen superseded ditandai; salah grant memblokir distribusi"),
    38: ("Staff Keuangan", "Finance Manager/checker", "ERP",
         "Input/reconcile draf; exception list",
         "Bukti transaksi -> AI extract -> finance cek -> maker input -> checker -> reconcile",
         "AI tidak menggunakan kredensial bank atau post tanpa checker",
         "Duplicate invoice dan unmatched transaction ditandai"),
    39: ("Kepala/Bagian Alat Proyek", "Kepala Alat; PM/direktur sesuai biaya", "Alat + ERP refs",
         "Keputusan mobilisasi/servis/sewa manusia",
         "Copilot rangkum utilization -> human inspect -> opsi -> keputusan berwenang -> WO/booking",
         "Alat idle tidak otomatis ditawarkan/terikat sewa",
         "Overlapping booking dan hold inspection memblokir mobilisasi"),
    40: ("Manajer Tender", "Direktur untuk Go/No-Go", "Tender + legal evidence",
         "Eligibility review; Go/No-Go decision",
         "Cari sumber sah -> ekstrak syarat -> cocokkan bukti -> review unknown -> gate -> record",
         "Tidak auto-bid; no access-control bypass; unknown bukan pasti No-Go",
         "Paket/bukti outdated ditandai; keputusan punya alasan dan sumber"),
    41: ("Estimator Senior", "Estimator senior; PM/direktur sesuai policy penawaran", "Estimasi",
         "RAB revision accepted; source/assumption list",
         "Verifikasi BoQ -> ruleset/harga -> hitung deterministik -> review -> gate -> export",
         "Tidak mengarang koefisien/harga; estimasi internal bukan HPS resmi",
         "Semua subtotal reproducible; perubahan input meng-invalidasi approval"),
    42: ("Manajer Tender", "Manajer tender dan pejabat penandatangan", "Tender + document refs",
         "Bid package reviewed; submission proof",
         "Checklist syarat -> assemble -> cross-check -> gate -> upload manusia -> proof",
         "No upload/sign otomatis; status submitted berdasar receipt resmi",
         "Angka/kualifikasi mismatch memblokir readiness"),
    43: ("Legal / Contract Manager", "Pejabat berwenang perusahaan", "KontrakKonstruksi/Legal",
         "Risk memo; contract/addendum draft; signed reference",
         "Versi dokumen -> redline -> legal review -> negosiasi -> signature manusia -> handover",
         "Chat approval bukan tanda tangan sah; no autonomous legal decision",
         "Signed version tidak berubah; signature proof dan kewenangan diperiksa"),
    44: ("Project Manager / Contract Manager", "Otoritas kontrak perusahaan dan counterpart applicable", "Legal + Project + ERP",
         "CR; impact package; approved baseline delta",
         "Catat request -> dampak biaya/waktu -> opsi -> gate kontrak -> update revision -> audit",
         "No paid variation dari chat semata; baseline historis tidak dihapus",
         "Rejected CR tidak mengubah baseline/budget"),
    45: ("AgentOps Lead", "Process owner dan AgentOps reviewer", "Gustafta/SIGAP registry",
         "Release evidence; model/skill version; rollback/incident record",
         "Propose -> sandbox eval -> review -> canary -> monitor -> rollback bila perlu",
         "No self-promote; allowlist tools; budget/steps/time cap",
         "Injection, loop dan revoked tools dihentikan; rollback diuji"),
    46: ("Security & Privacy Owner", "Pemilik data/security; legal sesuai applicability", "Access/retention registry",
         "Grant review; privacy policy; restore evidence",
         "Klasifikasi -> grant -> provider review -> negative tests/restore -> gate -> periodic review",
         "No secret/PII di prompt log terbuka; default deny tenant/project",
         "Cross-tenant/revoked access gagal; restore memenuhi RPO/RTO disahkan"),
}

LEVELS = {
    1: "L3 Draf/Propose + Approval", 2: "L2 Kolaboratif", 3: "L2 + L3 untuk adjustment",
    4: "L2 Kolaboratif", 5: "L2 fisik; L4 rekap", 6: "L2 Kolaboratif",
    7: "L4 rekap accepted; L3 penerbitan eksternal", 8: "L3 Draf/Propose + Approval",
    9: "L3 Draf/Propose + Approval", 10: "L3 Draf/Propose + Approval",
    11: "L3 Draf/Propose + Approval", 12: "L2 Kolaboratif", 13: "L2 Kolaboratif",
    14: "L3 Draf/Propose + Approval", 15: "L3 Draf/Propose + Approval",
    16: "L3 Draf/Propose + Approval", 17: "L4 rekap; L3 izin lembur",
    18: "L2 kontrol fisik; L4 alarm", 19: "L2 Kolaboratif", 20: "L1 Asisten",
    21: "L2 hitung; L3 adjustment", 22: "L2 servis; L3 biaya/WO",
    23: "L4 jadwal; L2 servis/release", 24: "L4 monitoring; L3 recovery",
    25: "L2 Kolaboratif", 26: "L2 Kolaboratif", 27: "L2 Kolaboratif",
    28: "L4 acknowledgment; L3 komitmen", 29: "L4 acknowledgment; L3 komitmen",
    **{n: "Copilot jabatan; level mengikuti langkah SOP proses" for n in range(30, 40)},
    **{n: "L3 Draf/Propose + Approval" for n in range(40, 46)},
    46: "L2 review; L3 perubahan akses/policy",
}
NEW = [
    (40, "SOP Pencarian Tender dan Go/No-Go", "Tender Hunter", "Legal & Kontrak, HR & SKK", "Peluang masuk / dokumen pemilihan berubah", "Review sebelum deadline internal; SLA ditetapkan manajer tender"),
    (41, "SOP Estimasi dan Penyusunan RAB", "Estimator RAB", "Scheduler, Procurement", "Go accepted / input estimasi berubah", "Sesuai kompleksitas dan deadline internal; estimasi lead time setelah input lengkap"),
    (42, "SOP Penyusunan Dokumen Penawaran", "Bid Document", "Estimator RAB, Legal & Kontrak, HR & SKK", "Go accepted / RAB accepted / amendment tender", "Paket reviewed sebelum cutoff internal, bukan tepat deadline portal"),
    (43, "SOP Review Kontrak dan Adendum", "Legal & Kontrak", "Finance & Termin, Scheduler", "Rancangan kontrak/adendum diterima", "Review sebelum komitmen/signature; clock saat paket lengkap"),
    (44, "SOP Change Order", "Client Relations", "Estimator RAB, Scheduler, Legal & Kontrak", "Permintaan perubahan teridentifikasi", "Registrasi segera; kajian/approval sesuai kontrak dan risk tier"),
    (45, "SOP Tata Kelola Agen AI / AgentOps", "Hermes Commander (copilot)", "Seluruh role aktif sesuai scope", "Rilis/perubahan model/skill/tool / insiden", "Tidak rilis sebelum gate; incident response sesuai severity"),
    (46, "SOP Keamanan dan Privasi Data", "Security copilot terbatas", "AgentOps, pemilik domain", "Grant/data/provider baru / review berkala / insiden", "Validasi sebelum akses; revoke segera sesuai prosedur insiden"),
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def stage(n):
    if n in (45, 46) or 30 <= n <= 39:
        return "Fase 0: governance/peran; aktif sebelum proses terkait"
    if n in (18, 19, 20):
        return "Fase 0 prosedur manusia; AI bertahap Fase 1-4"
    if n in (7, 24):
        return "Fase 1: read/draft pilot"
    if n in (1, 2, 3, 21):
        return "Fase 2: logistik terkendali"
    if n in (8, 9, 10, 11, 14, 15, 16, 17):
        return "Fase 3: tenaga/finansial; prosedur manual tetap berlaku"
    return "Fase 4 sesuai kesiapan; proses kontraktual manual tidak ditunda"

def inline(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    return text

def render_md(text):
    lines = text.splitlines()
    result, paragraph = [], []
    i = 0
    def flush():
        if paragraph:
            result.append("<p>" + inline(" ".join(paragraph)) + "</p>")
            paragraph.clear()
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush()
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            result.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
        elif line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|\s*:?-+", lines[i + 1]):
            flush()
            headers = [x.strip() for x in line.strip("|").split("|")]
            table = ["<div class='table-scroll'><table><thead><tr>" +
                     "".join("<th>" + inline(x) + "</th>" for x in headers) +
                     "</tr></thead><tbody>"]
            i += 2
            while i < len(lines) and lines[i].startswith("|"):
                cells = [x.strip() for x in lines[i].strip("|").split("|")]
                table.append("<tr>" + "".join("<td>" + inline(x) + "</td>" for x in cells) + "</tr>")
                i += 1
            table.append("</tbody></table></div>")
            result.append("\n".join(table))
            continue
        elif re.match(r"^#{1,6} ", line):
            flush()
            count = len(line) - len(line.lstrip("#"))
            result.append(f"<h{count}>" + inline(line[count:].strip()) + f"</h{count}>")
        elif line.startswith("- ") or re.match(r"^\d+[.] ", line):
            flush()
            result.append("<p class='list-item'>" + inline(line) + "</p>")
        elif not line.strip():
            flush()
        elif line == "---":
            flush()
            result.append("<hr>")
        else:
            paragraph.append(line)
        i += 1
    flush()
    return "\n".join(result)

def main():
    inventory, csv_hashes, csv_semantic_hashes = [], [], []
    base_rows = None
    for name in SOURCES:
        path = ROOT / "attached_assets" / name
        assert path.exists()
        entries = []
        with zipfile.ZipFile(path) as archive:
            assert sum(info.file_size for info in archive.infolist()) < 2_000_000
            for info in archive.infolist():
                assert not info.is_dir()
                assert not Path(info.filename).is_absolute() and ".." not in Path(info.filename).parts
                assert Path(info.filename).suffix.lower() in (".md", ".csv")
                content = archive.read(info)
                entry = {"name": info.filename, "bytes": len(content), "sha256": sha(content)}
                if info.filename.endswith(".csv"):
                    rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
                    entry["rows"] = len(rows)
                    entry["columns"] = list(rows[0])
                    csv_hashes.append(sha(content))
                    canonical = json.dumps(
                        sorted(rows, key=lambda row: int(row["No"])),
                        ensure_ascii=False, sort_keys=True,
                    ).encode("utf-8")
                    csv_semantic_hashes.append(sha(canonical))
                    if name.startswith("SOP_AGENTIC") and info.filename.endswith("_all.csv"):
                        base_rows = rows
                entries.append(entry)
        inventory.append({"attachment": name, "bytes": path.stat().st_size, "sha256": sha(path.read_bytes()), "entries": entries})
    assert base_rows is not None
    assert len(base_rows) == 39
    assert sorted(int(r["No"]) for r in base_rows) == list(range(1, 40))
    assert len(set(csv_semantic_hashes)) == 1, "Source CSV values differ: review before merging"

    rows = []
    for original in sorted(base_rows, key=lambda x: int(x["No"])):
        n = int(original["No"])
        accountable, approver, owner, output, workflow, guardrail, acceptance = DETAILS[n]
        row = {
            "No": n, "Kode SOP": f"SOP-{n:02d}", "Nama SOP": original["Nama SOP"],
            "Jenis": original["Jenis"], "Alur Nilai": original["Alur Nilai"],
            "Agen Utama (Copilot)": original["Agen Utama"],
            "Agen Pendukung": original["Agen Pendukung"] or "Tidak ditetapkan pada sumber; pilih sesuai scope jika diperlukan",
            "Accountable Manusia": accountable, "Approver Revisi": approver,
            "Pemilik Data Resmi": owner, "Trigger": original["Trigger"],
            "Level Sumber": original["Level Otomasi"], "Level Revisi": LEVELS[n],
            "Tahap Revisi": stage(n),
            "SLA Target Usulan": original["SLA"] + "; belum disahkan, definisikan jam kerja/cutoff/timezone",
            "Input Minimum": "Data dari pemilik resmi, revision berlaku, bukti sumber; lihat workflow dan template SOP",
            "Langkah Minimum": workflow, "Output dan Status": output,
            "Gate dan Audit": "Gate per action, tenant/proyek, actor server, object revision, evidence hash, policy version, expiry",
            "Eskalasi": f"Process owner: {accountable}; pejabat pengganti sesuai delegasi; tidak auto-approve",
            "KPI Minimum": "Lead time sampai accepted; rework; kelengkapan bukti; lihat KPI keluarga SOP",
            "Guardrail": guardrail,
            "Uji Penerimaan Minimum": acceptance + "; akses di luar grant ditolak dan jalur manual tersedia",
            "Status Revisi": "Usulan revisi - belum disahkan",
            "Catatan": "Nomor dipertahankan; isi matriks dikembangkan dari ringkasan, bukan naskah SOP asli",
        }
        # Align role with corrected accountability where source aliases disagree.
        if n == 6:
            row["Agen Utama (Copilot)"] = "Estimator RAB / Quantity copilot"
            row["Agen Pendukung"] = "QA/QC, Finance & Termin, Site Reporter"
        if n == 34:
            row["Alur Nilai"] = "C. Pelaksanaan & Mutu; dukungan A. Material & Logistik"
        if n == 13:
            row["Trigger"] = "Readiness final handover/FHO sesuai kontrak; PHO di SOP27"
        if n == 17:
            row["Trigger"] = "Pengajuan lembur sebelum pekerjaan; rekap dari jam accepted"
        if n == 23:
            row["SLA Target Usulan"] = "Pengingat sebelum due date; servis manusia sesuai manual dan aturan applicable"
        if n == 20:
            row["SLA Target Usulan"] = "Alarm segera; target delivery ≤1 menit harus diuji; respons darurat manusia tidak menunggu AI"
        if n >= 30:
            row["Catatan"] = "SOP jabatan: accountable manusia; agen copilot; SLA dan gate mengikuti proses terkait"
        rows.append(row)

    for n, title, agent, supports, trigger, sla in NEW:
        accountable, approver, owner, output, workflow, guardrail, acceptance = DETAILS[n]
        rows.append({
            "No": n, "Kode SOP": f"SOP-{n:02d}", "Nama SOP": title,
            "Jenis": "SOP Proses Baru", "Alur Nilai": "H. Pra-kontrak & Perubahan" if n < 45 else "I. Governance",
            "Agen Utama (Copilot)": agent, "Agen Pendukung": supports,
            "Accountable Manusia": accountable, "Approver Revisi": approver,
            "Pemilik Data Resmi": owner, "Trigger": trigger,
            "Level Sumber": "Belum dirinci dalam CSV sumber", "Level Revisi": LEVELS[n],
            "Tahap Revisi": stage(n), "SLA Target Usulan": sla + "; belum disahkan",
            "Input Minimum": "Bukti/version resmi dan izin sesuai scope; lihat SOP40-46 dalam dokumen",
            "Langkah Minimum": workflow, "Output dan Status": output,
            "Gate dan Audit": "Gate per action; actor server; revision/hash bukti; policy version; expiry; auditable",
            "Eskalasi": f"Process owner: {accountable}; jangan menjalankan aksi final saat gagal/unknown",
            "KPI Minimum": "Lead time accepted; kualitas/sumber; failure/rework; biaya dan insiden sesuai domain",
            "Guardrail": guardrail,
            "Uji Penerimaan Minimum": acceptance + "; negative authorization dan fallback diuji",
            "Status Revisi": "Usulan revisi - belum disahkan",
            "Catatan": "SOP tambahan usulan; perlu formulir, parameter lokal dan pengesahan",
        })
    assert len(rows) == 46 and [r["No"] for r in rows] == list(range(1, 47))
    assert set(DETAILS) == set(LEVELS) == set(range(1, 47))
    fields = list(rows[0])
    assert all(set(row) == set(fields) for row in rows)
    assert all(all(str(value).strip() for value in row.values()) for row in rows)
    csv_path = OUT / "06-matriks-sop-revisi.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    source_manifest = {
        "evaluation_date": "2026-10-09",
        "scope": "Uploaded Notion exports only; no child page fetch, live-app audit or official legal validation",
        "attachments": inventory, "source_csv_rows": 39,
        "source_csv_copies": len(csv_hashes),
        "source_csv_byte_identical": len(set(csv_hashes)) == 1,
        "source_csv_values_identical_by_sop_number": True,
        "revised_sop_rows": 46,
    }
    (OUT / "manifest-sumber.json").write_text(json.dumps(source_manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    chapters = sorted(OUT.glob("0[1-5]-*.md"))
    assert len(chapters) == 5
    full = "# Paket Revisi Blueprint Gustafta × SIGAP\n\n"
    full += "Evaluasi dan revisi usulan • 9 Oktober 2026 • Belum disahkan untuk produksi\n\n"
    full += "## Daftar isi\n\n"
    for path in chapters:
        full += "- " + path.read_text(encoding="utf-8").splitlines()[0].lstrip("# ") + "\n"
    full += "- Lampiran matriks 46 SOP; CSV lengkap tersedia terpisah\n\n"
    full += "\n\n---\n\n".join(path.read_text(encoding="utf-8") for path in chapters)
    full += "\n\n---\n\n# Lampiran: Ringkasan Matriks 46 SOP\n\n"
    full += "CSV lengkap memuat trigger, langkah, SLA usulan, gate, guardrail, eskalasi dan uji penerimaan per SOP.\n\n"
    full += "| No | SOP | Accountable manusia | Level revisi | Output |\n| --- | --- | --- | --- | --- |\n"
    for row in rows:
        full += "| " + " | ".join(str(row[key]).replace("|", "/") for key in ("No", "Nama SOP", "Accountable Manusia", "Level Revisi", "Output dan Status")) + " |\n"
    (OUT / "BLUEPRINT_REVISI_LENGKAP.md").write_text(full, encoding="utf-8")

    css = """
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#152238;
    font:16px/1.7 system-ui,-apple-system,Segoe UI,sans-serif}header{background:#0b1423;color:#f5faff;padding:40px 5vw}
    header p{color:#c4ddf5;margin:8px 0}main{max-width:1200px;margin:24px auto;padding:32px;background:white;
    border:1px solid #dbe5f0;border-radius:12px}h1,h2,h3{line-height:1.3;color:#102a48}header h1{color:#fff}
    h1{font-size:28px;border-top:2px solid #d7e5f4;padding-top:24px}h2{font-size:23px;margin-top:32px}
    h3{font-size:19px;margin-top:26px}p{margin:12px 0}.list-item{padding-left:16px;margin:6px 0}
    .table-scroll{overflow-x:auto;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:14px}
    th,td{border:1px solid #cddae8;padding:10px 12px;text-align:left;vertical-align:top;min-width:140px}
    th{background:#15385d;color:#fff}tr:nth-child(even) td{background:#f3f7fb}
    pre{padding:18px;overflow-x:auto;background:#0c1828;color:#e8f3ff;border-radius:8px;font-size:13px;line-height:1.6}
    p code,td code{background:#eaf1f9;padding:2px 5px;border-radius:4px}hr{border:0;border-top:1px solid #ccdbea;margin:44px 0}
    footer{max-width:1200px;margin:20px auto;padding:16px;color:#485c73}
    @media(max-width:640px){main{margin:12px;padding:18px}header{padding:24px}h1{font-size:24px}body{font-size:15px}}
    @media print{body{background:white;font-size:11pt}main{border:0;max-width:none;margin:0;padding:0}
    header{background:white;color:#102a48;padding:0}header h1,header p{color:#102a48}pre{white-space:pre-wrap;background:#eef3f8;color:#102a48}
    th{background:#eaf1f9;color:#102a48}.table-scroll{overflow:visible}th,td{min-width:0;font-size:9pt;padding:5px}tr{break-inside:avoid}}
    """
    document = '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    document += '<title>Evaluasi dan Revisi Blueprint Gustafta × SIGAP</title><style>' + css + '</style></head><body>'
    document += '<header><h1>Evaluasi dan Revisi Blueprint</h1><p>Gustafta × SIGAP • Kontraktor berbasis AI</p>'
    document += '<p>9 Oktober 2026 — Dokumen usulan, bukan persetujuan produksi.</p></header><main>'
    document += render_md(full)
    document += '</main><footer>Disusun dari lima lampiran ekspor Notion. Rincian tautan turunan dan naskah SOP asli belum tersedia. Tidak ada aplikasi atau data perusahaan yang diubah.</footer></body></html>'
    html_path = OUT / "BLUEPRINT_REVISI_LENGKAP.html"
    html_path.write_text(document, encoding="utf-8")
    assert "<script" not in document.lower()
    assert not re.search(r'<(?:img|iframe|link)[^>]+(?:src|href)=', document)
    assert document.count("<table>") == document.count("</table>")

    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        check = list(csv.DictReader(f))
        assert len(check) == 46
        assert len({r["Kode SOP"] for r in check}) == 46
        assert sum(r["Jenis"] == "SOP Jabatan" for r in check) == 10
    assets = chapters + [csv_path, OUT / "manifest-sumber.json", OUT / "BLUEPRINT_REVISI_LENGKAP.md", html_path]
    zip_path = OUT.parent / "Paket_Revisi_Blueprint_Gustafta_SIGAP.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in assets:
            archive.write(path, arcname="Revisi_Blueprint/" + path.name)
    with zipfile.ZipFile(zip_path) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == 9
    print(json.dumps({
        "source_attachments": len(inventory), "source_csv_rows": 39,
        "semantically_identical_source_csv_copies": len(csv_hashes), "revised_sop_rows": 46,
        "chapters": len(chapters), "zip_files": 9, "zip_bytes": zip_path.stat().st_size,
        "html_bytes": html_path.stat().st_size, "validation": "PASS",
    }, indent=2))

if __name__ == "__main__":
    main()
