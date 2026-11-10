"""Package the finished document review without running or touching the app."""
import base64
import csv
import hashlib
import html
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs/blueprint-sbu-review"
OUT = ROOT / "generated-artifacts/blueprint-sbu-review"
summary = json.loads((DOCS / "RINGKASAN_VALIDASI.json").read_text())
with (DOCS / "KATALOG_PERBANDINGAN.csv").open(encoding="utf-8-sig") as stream:
    catalog = list(csv.DictReader(stream))
with (DOCS / "REGISTER_KLAIM.csv").open(encoding="utf-8-sig") as stream:
    claims = list(csv.DictReader(stream))
assert len(catalog) == 77 and len(claims) == 257

# Validate the retained bytes independently of extraction/build code.
with (DOCS / "MANIFEST_SUMBER.csv").open(encoding="utf-8-sig") as stream:
    for row in csv.DictReader(stream):
        raw = (ROOT / row["path"]).read_bytes()
        assert len(raw) == int(row["bytes"]), row["path"]
        assert hashlib.sha256(raw).hexdigest() == row["sha256"], row["path"]


def table(rows, fields):
    head = "".join(f"<th>{html.escape(label)}</th>" for _, label in fields)
    body = "".join(
        "<tr>" + "".join(f"<td>{html.escape(row[key])}</td>" for key, _ in fields) + "</tr>"
        for row in rows
    )
    return f'<div class="scroll"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


downloads = []
for name in ("REGISTER_KLAIM.csv", "KATALOG_PERBANDINGAN.csv", "BUKTI_TABEL_281.csv",
             "MANIFEST_SUMBER.csv", "MEMO_KOREKSI.md", "SUMBER_DAN_BATAS_BUKTI.md"):
    mime = "text/csv" if name.endswith(".csv") else "text/markdown"
    encoded = base64.b64encode((DOCS / name).read_bytes()).decode()
    downloads.append(f'<a download="{name}" href="data:{mime};base64,{encoded}">{name}</a>')
sections = []
for name, title in [("MEMO_KOREKSI.md", "Memo koreksi lengkap"),
                    ("SUMBER_DAN_BATAS_BUKTI.md", "Sumber resmi dan batas bukti"),
                    ("BUKTI_NAMA_PERMEN.md", "Cuplikan nama dari naskah pemerintah")]:
    sections.append(f"<details><summary>{title}</summary><pre>"
                    + html.escape((DOCS / name).read_text()) + "</pre></details>")
report = """<!doctype html><html lang="id"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pemeriksaan Blueprint SBU — 18 Oktober 2026</title>
<style>
body{font:16px/1.6 system-ui,sans-serif;background:#f3f6fa;color:#15253b;margin:0}
main{max-width:1250px;margin:auto;padding:30px}header{background:#112742;color:white;padding:26px;border-radius:12px}
h1{line-height:1.25}h2{margin-top:34px}.notice{border-left:5px solid #c57912;background:#fff3d9;padding:18px;margin:22px 0}
a{color:#005db4;overflow-wrap:anywhere}nav a{display:inline-block;background:white;border:1px solid #ccd8e6;padding:8px 12px;margin:4px;border-radius:6px}
.scroll{overflow:auto}table{border-collapse:collapse;background:white;width:100%;font-size:13px}td,th{padding:10px;text-align:left;border:1px solid #ccd8e6;vertical-align:top}th{background:#dfebf7}
details{background:white;border:1px solid #ccd8e6;padding:16px;margin:16px 0}summary{font-weight:650;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 system-ui,sans-serif}
@media print{main{padding:0}header{color:black;background:white}nav{display:none}.scroll{overflow:visible}table{font-size:9px}}
</style><main><header><p>TINJAUAN DOKUMEN • 18 OKTOBER 2026</p>
<h1>Kode SBU dan dasar hukum blueprint kontraktor</h1>
<p>73 kode sumber diperiksa terhadap tabel pemerintah; 77 kode ditemukan pada delapan kelompok yang sama.</p></header>
<div class="notice"><strong>Bukan pengesahan legalitas perusahaan.</strong> Tidak ada perubahan aplikasi,
database, konektor, atau SOP. Nama yang belum terbaca utuh, surat operasional SIJK,
dan autentikasi digital tetap dinyatakan belum terselesaikan.</div>
<h2>Ringkasan keputusan</h2><ul>
<li>Semua 73 kode sumber ditemukan. Tabel Kepdirjen juga mencakup IN011–IN014.</li>
<li>Ringkasan SIGAP perlu memasukkan PA. Kualifikasi spesialis perlu dilengkapi.</li>
<li>Nama subklasifikasi dipisahkan dari judul KBLI; katalog bukan SBU milik tenant.</li>
<li>Berlaku normatif tidak otomatis membuktikan layanan SIJK baru telah dimulai.</li></ul>
"""
report += "<p>257 klaim: " + html.escape(
    ", ".join(f"{count} {status}" for status, count in summary["klaim_per_status"].items())
) + ". Status diberikan per klaim, bukan per perusahaan.</p>"
report += "<h2>Unduh register dan memo</h2><nav>" + "".join(downloads) + "</nav>"
report += "".join(sections)
report += "<h2>Perbandingan katalog</h2>" + table(catalog, [
    ("kode", "Kode"), ("nama_blueprint", "Nama sumber"), ("nama_subklasifikasi_hasil", "Hasil nama"),
    ("status_nama", "Status nama"), ("kualifikasi_hasil", "Kualifikasi normatif"),
    ("judul_kbli_tabel_281_bukan_nama_sbu", "Judul KBLI — bukan nama SBU"),
    ("rujukan_kode_kualifikasi", "Halaman bukti kode/kualifikasi"),
])
report += "<h2>Register semua klaim</h2>" + table(claims, [
    ("id", "ID klaim"), ("sumber_klaim", "Asal"), ("status", "Status"),
    ("hasil_dan_koreksi", "Hasil / koreksi"), ("rujukan", "Rujukan"),
]) + "</main></html>"
destination = OUT / "LAPORAN_PEMERIKSAAN_BLUEPRINT_SBU.html"
destination.write_text(report, encoding="utf-8")
with zipfile.ZipFile(OUT / "PAKET_PEMERIKSAAN_BLUEPRINT_SBU.zip", "w", zipfile.ZIP_DEFLATED) as package:
    for path in sorted(DOCS.iterdir()):
        if path.is_file():
            package.write(path, "hasil/" + path.name)
    package.write(destination, destination.name)
    with (DOCS / "MANIFEST_SUMBER.csv").open(encoding="utf-8-sig") as stream:
        for row in csv.DictReader(stream):
            path = ROOT / row["path"]
            # Original normative evidence only; no unrelated uploads or company data.
            package.write(path, row["path"])
    for script in ["build-blueprint-sbu-review.py", "package-blueprint-sbu-review.py"]:
        package.write(ROOT / "scripts" / script, "scripts/" + script)
    for path in (OUT / "visual").glob("*.png"):
        package.write(path, "visual/" + path.name)
print(json.dumps({"status": "passed", "catalog_rows": len(catalog),
                  "claim_rows": len(claims), "manifest_hashes": "all matched",
                  "report": str(destination.relative_to(ROOT))}, indent=2))
