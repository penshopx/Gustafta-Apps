"""Build a document-only regulatory comparison; never connects to application data.

Requires PyMuPDF and the retained government text captures listed in the report.
Generated CSVs are deliverables, not application seeds or a tenant SBU inventory.
"""
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/blueprint-sbu-review"
CAP = ROOT / "generated-artifacts/blueprint-sbu-review/sources"
KZIP = ROOT / "attached_assets/BLUE_PRINT_KONTRAKTOR_OTONOM_1791516038813.zip"
SZIP = ROOT / "attached_assets/SPESIFIKASI_INTEGRASI_SIGAP_1791516051939"
PDF = ROOT / ("attached_assets/KEP_DIRJEN_BK_281_STANDAR_SKEMA_SERTIFIKASI_"
              "26_AGUSTUS_2026_SU_1788273103134.pdf")
PURL = ("https://peraturan.bpk.go.id/Download/421467/"
        "Permen%20PU%20No%206%20Tahun%202025.pdf")
KURL = "https://s.pu.go.id/MTY4Mg/KepdirjenBK281StandarSkemaSertifikasiBUJK"
NORM = re.compile(r"^(BG|BS|IN|KK|KP|PA|PB|PL)\d{3}$")
MB_ONLY = set("BS013 BS014 BS015 BS018 BS019 IN003 IN010 KK002 KK003 KK010 KK014 PL001".split())
UNCLEAR = set("BG008 BS006 BS011 BS014 BS016 BS018 IN003 IN010 KP002 PB003 PB005 PB011 PL005".split())
RENAMED = {
    "KK003": "Konstruksi Intake, Control Gate, Penstock dan Outflow Pembangkit Listrik Tenaga Air",
    "PA001": "Penyewaan Peralatan",
    "PB001": "Pengerjaan Pemasangan Kaca dan Alumunium",
    "PB010": "Pekerjaan Lansekap, Pertamanan, dan Penanaman Vegetasi",
}
ADDED = {
    "IN011": "Instalasi Sinyal dan Rambu-Rambu Jalan Raya",
    "IN012": "Instalasi Sinyal dan Telekomunikasi Kereta Api",
    "IN013": "Instalasi Pemanas dan Geotermal",
    "IN014": "Instalasi Meteorologi, Klimatologi dan Geofisika",
}


def flat(text):
    return " ".join((text or "").split())


def normalized(text):
    return re.sub(r"\W", "", text.casefold())


def read_archive(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) == 1 and names[0].endswith(".md"), names
        return archive.read(names[0]).decode("utf-8"), names[0]


def write_csv(name, rows):
    assert rows
    with (OUT / name).open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def extract_original(text):
    rows = {}
    for number, line in enumerate(text.splitlines(), 1):
        cells = [c.strip() for c in line.strip("|").split("|")]
        if line.startswith("| ") and NORM.fullmatch(cells[0]):
            assert cells[0] not in rows, cells[0]
            rows[cells[0]] = {
                "nama": cells[1], "kualifikasi": cells[2] if len(cells) > 2 else "— (tidak dicantumkan)",
                "baris": number,
            }
    return rows


def extract_281():
    import fitz
    evidence = {}
    last_code = None
    with fitz.open(PDF) as document:
        assert len(document) == 186
        for page_index in range(17, 24):
            for table in document[page_index].find_tables().tables:
                for row in table.extract():
                    if len(row) != 5:
                        continue
                    kbli, title, code, nature, qualification = map(flat, row)
                    if NORM.fullmatch(code):
                        assert code not in evidence, code
                        evidence[code] = {
                            "kode": code, "kbli": kbli, "judul_kbli": title,
                            "sifat": nature, "kualifikasi_kutipan": qualification,
                            "pdf": str(page_index + 1), "lampiran": str(page_index - 8),
                        }
                        last_code = code
                    elif not code and not kbli and qualification and last_code:
                        # BS009 and PL007 continue on the following PDF page.
                        evidence[last_code]["kualifikasi_kutipan"] += " " + qualification
                        evidence[last_code]["pdf"] += f"–{page_index + 1}"
                        evidence[last_code]["lampiran"] += f"–{page_index - 8}"
    assert len(evidence) == 77, len(evidence)
    for code, row in evidence.items():
        assert ("K (K1" not in row["kualifikasi_kutipan"]) == (code in MB_ONLY), code
        assert "B BUJK PMA" in row["kualifikasi_kutipan"], code
        assert "B KPBUJKA" in row["kualifikasi_kutipan"], code
    return evidence


def main():
    original_text, kentry = read_archive(KZIP)
    sigap, sentry = read_archive(SZIP)
    original = extract_original(original_text)
    assert len(original) == 73
    assert Counter(c[:2] for c in original) == dict(BG=9, BS=20, IN=9, KK=16, KP=2, PA=1, PB=8, PL=8)
    assert "73 Paket Bidang SIGAP (BG, BS, IN, KK, KP, PB, PL)" in sigap
    evidence = extract_281()
    assert set(evidence) - set(original) == set(ADDED)
    assert not set(original) - set(evidence)
    parts = [CAP / "reg-0.md", CAP / "permen-next.md"] + [
        CAP / f"permen-{n}.md" for n in range(100000, 550000, 50000)
    ]
    for path in parts:
        if not path.exists():
            raise SystemExit(f"Bukti resmi belum tersedia: {path.relative_to(ROOT)}. Lihat SUMBER_DAN_BATAS_BUKTI.md.")
    # Preserve exact character offsets between independently fetched slices.
    permen = "".join(p.read_text().removesuffix("\n…[truncated]") for p in parts)
    assert len(permen) == 550000
    pages = permen.split("\n---\n")
    catalog, claims, quotes = [], [], []

    def claim(identifier, source, dimension, status, finding, reference):
        assert status in {"verified", "corrected", "unresolved"}
        claims.append(dict(id=identifier, sumber_klaim=source, dimensi=dimension,
                           status=status, hasil_dan_koreksi=finding, rujukan=reference))

    for code, ev in evidence.items():
        src = original.get(code)
        source_name = src["nama"] if src else "(tidak tercantum)"
        # A name must be present in the primary text, not inferred from KBLI.
        matches = list(re.finditer(rf"\b{code}\s*\(", permen))
        if matches:
            start = matches[0].start()
        else:
            found = re.search(rf"\b{code}\b", permen)
            assert found, code
            start = found.start()
        segment = permen[:start].count("\n---\n") + 1
        quote = permen[max(0, start - 120):start + 750]
        official_name = RENAMED.get(code, ADDED.get(code, source_name))
        if code in UNCLEAR:
            name_status = "unresolved"
            official_name = "(belum dipastikan; jangan substitusi judul KBLI)"
        else:
            # Ignore only punctuation/spacing/case. Do not silently reorder words.
            local = permen[start:start + 500]
            if code == "KK010":
                local = local.replace("|", "").replace("---", "")
            assert normalized(official_name) in normalized(local), (code, official_name)
            name_status = "corrected" if code in RENAMED or not src else "verified"
        reference_281 = f"S281 Lampiran 2.1.5.b; PDF {ev['pdf']}; lampiran hlm {ev['lampiran']}"
        reference_name = (f"SP6 Lampiran I A.1; kode {code}; segmen ekstraksi {segment} "
                          "(bukan nomor halaman); lihat R-PAGINASI")
        qualification = "Menengah, Besar" if code in MB_ONLY else "Kecil 1, Kecil 2, Kecil 3, Menengah, Besar"
        qualification += "; BUJK PMA: Besar; KPBUJKA: Besar"
        note = "Bukan bukti kepemilikan SBU tenant; mulai layanan/konversi mengikuti Pasal 20–21."
        if code == "PA001":
            note += " Dengan operator; sewa tanpa operator bukan otomatis PA001."
        if code in UNCLEAR:
            note += " Nama terurai tidak utuh/berurutan pada ekstraksi primer; jangan ditebak."
        catalog.append(dict(
            kode=code, asal="blueprint" if src else "tambahan tabel resmi",
            baris_blueprint=src["baris"] if src else "", nama_blueprint=source_name,
            status_kode="verified" if src else "corrected",
            nama_subklasifikasi_hasil=official_name, status_nama=name_status,
            kualifikasi_blueprint=src["kualifikasi"] if src else "(tidak tercantum)",
            kualifikasi_hasil="BUJKN: " + qualification, status_kualifikasi="corrected",
            sifat=ev["sifat"], kode_kbli_tabel_281=ev["kbli"],
            judul_kbli_tabel_281_bukan_nama_sbu=ev["judul_kbli"],
            rujukan_kode_kualifikasi=reference_281, rujukan_nama=reference_name,
            catatan=note,
        ))
        source = f"K:{src['baris']}" if src else "K:41,91–99 (belum memuat kode ini)"
        claim(f"{code}-KODE", source, "kode", "verified" if src else "corrected",
              "Kode ada dalam tabel resmi" if src else "Tambahkan bila mengklaim cakupan lengkap; jangan klaim dimiliki tenant", reference_281)
        claim(f"{code}-NAMA", source, "nama", name_status, official_name, reference_name)
        claim(f"{code}-KUALIFIKASI", source, "kualifikasi", "corrected",
              "Lengkapi rincian, bukan otomatis semua dimiliki: BUJKN: " + qualification, reference_281)
        quotes.append(f"## {code}\n\n{reference_name}\n\nStatus nama: **{name_status}**.\n\n"
                      f"```text\n{quote}\n```\n")

    general = [
        ("R-JUMLAH-SUMBER", "K:39–46,52–149", "jumlah", "verified", "73 kode unik adalah jumlah daftar sumber, bukan jumlah keseluruhan norma atau SBU tenant", "ZIP K, tabel rincian; MANIFEST_SUMBER.csv"),
        ("R-JUMLAH-NORMA", "K:35–46; S:459", "kelengkapan", "corrected", "Tabel 8 kelompok memuat 77 kode: IN 13, bukan 9; empat tambahan IN011–IN014", "S281 PDF 18–24; Lampiran 2.1.5.b hlm 9–15"),
        ("R-PA-SIGAP", "S:459", "kelompok", "corrected", "Tambahkan PA dalam kelompok; kekurangan PA tidak menghapus PA001 dari sumber K", "K:44, PA001; S281 PDF 23, Lampiran 14"),
        ("R-UU-PAYUNG", "K:19,30", "dasar hukum", "verified", "UU 2/2017 berjudul Jasa Konstruksi; awal berlaku 12 Januari 2017", "SUU2 metadata resmi; PDF 1; definisi PDF 3"),
        ("R-UU-PERUBAHAN", "K:30", "hubungan perubahan", "corrected", "Tulis sebagaimana diubah UU 6/2023; naskah 2017 tidak otomatis naskah konsolidasi terbaru", "SUU2 metadata status; S281 PDF 3/Mengingat; SP6 Mengingat angka 4"),
        ("R-PP-JUDUL", "K:19,31", "dasar hukum", "verified", "PP 28/2025 = Penyelenggaraan Perizinan Berusaha Berbasis Risiko", "SPP28 PDF awal 1; Pasal 5"),
        ("R-PP-CABUT", "K:31", "hubungan perubahan", "verified", "PP 28/2025 mencabut PP 5/2021, berlaku 5 Juni 2025", "SPP28 Pasal 550 b dan 552, hlm cetak 309; pengundangan hlm 310"),
        ("R-PERMEN-JUDUL", "K:32", "judul", "corrected", "Gunakan judul lengkap termasuk Pelaksanaan Pengawasan dan Pengenaan Sanksi", "SP6 halaman judul; SUMBER_DAN_BATAS_BUKTI.md"),
        ("R-PERMEN-CABUT", "K:32", "hubungan perubahan", "verified", "Permen PU 6/2025 mencabut Permen PUPR 6/2021; 8/2022 tetap sepanjang tidak bertentangan", "SP6 Pasal 23 b dan 24"),
        ("R-PERMEN-EFEKTIF", "K:28–33", "tanggal efektif", "corrected", "Penetapan 22 Desember 2025; berlaku/pengundangan 30 Desember 2025", "SP6 Pasal 25 dan metadata JDIH BPK; tanggal OCR rusak tidak digunakan"),
        ("R-281-IDENTITAS", "K:33", "dasar hukum", "verified", "281/KPTS/DK/2026 tentang Penetapan Standar Skema Sertifikasi BUJK, bukan skema SKK", "S281 PDF 3–4; Diktum KESATU–KETIGA"),
        ("R-281-CABUT", "K:33", "hubungan perubahan", "verified", "Mencabut 37/KPTS/DK/2025", "S281 PDF 4, Diktum KELIMA"),
        ("R-281-EFEKTIF", "K:28–33", "tanggal efektif", "corrected", "Berlaku 26 Agustus 2026 sejak ditetapkan; beda dari dimulainya layanan SIJK", "S281 PDF 5 (visual), Diktum KEENAM; PDF 1 surat pengantar"),
        ("R-LSBU-TRANSISI", "K:28–33", "transisi", "corrected", "Penyesuaian skema/implementasi LSBU paling lambat 6 bulan sejak penetapan; bukan pemicu tenggat konversi SBU tenant", "S281 PDF 4 Diktum KEEMPAT; SP6 Pasal 21(2)"),
        ("R-SIJK-SURAT", "K:8,28–35", "operasional", "unresolved", "Belum memperoleh surat pemicu Pasal 20(2); tidak menyatakan surat itu tidak ada dan tidak menetapkan tanggal operasional", "SP6 Pasal 20–21; S281 PDF 1 angka 2"),
        ("R-KONVERSI", "K:28–35", "transisi", "corrected", "Konversi 6 bulan sejak surat Pasal 20(2), tanpa asesmen; masa berlaku mengikuti SBU lama; ada ketentuan pemilihan/kontrak berjalan", "SP6 Pasal 21(2)–(7)"),
        ("R-SPESIALIS", "K:41–46,87–149", "kualifikasi", "corrected", "Spesialis tetap berkualifikasi; PMA/KPBUJKA besar, satu BUJK satu kualifikasi/subkualifikasi", "S281 PDF 15, Lampiran 2.1.3 hlm 6; PDF 18–24"),
        ("R-NAMA-VS-KBLI", "K:50–149", "nomenklatur", "corrected", "Pisahkan nama subklasifikasi SP6 dari JUDUL KBLI S281; kesamaan kode tidak membenarkan substitusi nama", "S281 PDF 16, 18–24; SP6 Lampiran I A.1"),
        ("R-PA-OPERATOR", "K:44,PA001", "ruang lingkup", "corrected", "PA001 = Penyewaan Peralatan dengan operator; tanpa operator disebut kelompok 77393 dalam SP6", "SP6 Lampiran I A.1 KBLI 43905; S281 PDF 23/lampiran 14"),
        ("R-NIB-SBU", "K:20", "perizinan", "corrected", "Pisahkan NIB, Sertifikat Standar dan SBU; daftar kebutuhan bukan bukti pemenuhan", "S281 PDF 10/Lampiran 1; SP6 Pasal 5"),
        ("R-SKK", "K:20", "kompetensi", "corrected", "SKK adalah bukti kompetensi tenaga kerja, bukan izin usaha atau kepemilikan seluruh kode SBU; 281 tidak langsung mengatur semua penerbitan SKK/SKKNI", "SUU2 PDF 3 Pasal 1 angka 11–13 (historis); SP6 Pasal 5(8)–(9); S281 PDF 4"),
        ("R-PBJ", "K:22,28–33", "pengadaan", "corrected", "Pisahkan PBJP: Perpres 16/2018 sebagaimana diubah 12/2021 dan 46/2025 (perubahan kedua, bukan pencabutan seluruh 16/2018)", "SPBJ metadata LKPP, Riwayat perubahan; 30 April 2025"),
        ("R-TENANT", "K:8,16–20,35; S:373", "kepemilikan", "unresolved", "Tidak ada pemeriksaan dokumen perusahaan; katalog bukan SBU tenant; kategori BUJKN/PMA/KPBUJKA aktual tidak ditetapkan", "K dan S adalah rancangan; S281 membatasi norma, bukan data tenant"),
        ("R-ISO-SMKK", "K:20", "pemenuhan", "unresolved", "SMKK dan ISO 9001/14001/45001 tidak diverifikasi; jangan tampilkan sebagai sertifikat yang telah dimiliki atau syarat identik semua paket", "Tidak ada bukti perusahaan/paket yang diperiksa"),
        ("R-PAGINASI", "Seluruh kutipan nama SP6", "halaman", "unresolved", "Nomor segmen ekstraksi bukan nomor halaman PDF/cetak. Paginasi tepat dan nama tabel rusak memerlukan salinan yang dapat dirender; jangan mengarang", "SP6 segmen 43 menunjukkan cetak 45; segmen 123 menunjukkan cetak 125"),
        ("R-AUTENTIKASI", "Salinan S281", "asal-usul", "unresolved", "Isi salinan diperiksa, tetapi kesamaan byte unduhan instansi dan validitas tanda tangan elektronik belum dibuktikan", "S281 lokal dengan hash; tautan s.pu.go.id menolak akses"),
    ]
    for values in general:
        claim(*values)
    write_csv("KATALOG_PERBANDINGAN.csv", catalog)
    write_csv("REGISTER_KLAIM.csv", claims)
    write_csv("BUKTI_TABEL_281.csv", list(evidence.values()))
    (OUT / "BUKTI_NAMA_PERMEN.md").write_text(
        "# Cuplikan naskah pemerintah untuk nama subklasifikasi\n\n"
        f"Sumber: {PURL}\n\n"
        "Cuplikan verbatim dari ekstraksi, bukan rekonstruksi tabel. Segmen bukan nomor halaman. "
        "Nama yang tidak utuh tidak dilengkapi dengan judul KBLI. Hash tangkapan ada pada manifest.\n\n"
        + "\n".join(quotes), encoding="utf-8")
    inputs = [KZIP, SZIP, PDF] + parts + [
        CAP / p for p in ["permen-metadata.md", "web-1.md", "web-2.md",
                          "reg-1.md", "reg-2.md", "uu-end.md", "pp-late.md", "pp-end.md",
                          "procurement-official.md"]
    ]
    manifest = []
    for path in inputs:
        raw = path.read_bytes()
        manifest.append(dict(path=str(path.relative_to(ROOT)), bytes=len(raw),
                             sha256=hashlib.sha256(raw).hexdigest(),
                             keterangan="arsip sumber asli" if path in [KZIP, SZIP] else
                             "salinan primer lokal; autentikasi daring belum terbukti" if path == PDF else
                             "tangkapan ekstraksi teks daring; bukan byte PDF asli"))
    write_csv("MANIFEST_SUMBER.csv", manifest)
    summary = dict(
        tanggal="2026-10-18", blueprint_entry=kentry, sigap_entry=sentry,
        kode_sumber=len(original), kode_tabel_delapan_kelompok=len(evidence),
        kelompok_sumber=dict(Counter(c[:2] for c in original)),
        kelompok_tabel=dict(Counter(c[:2] for c in evidence)),
        tambahan=sorted(ADDED), kode_sumber_tidak_ditemukan=[],
        klaim_per_status=dict(Counter(c["status"] for c in claims)),
        nama_sumber_per_status=dict(Counter(c["status_nama"] for c in catalog if c["asal"] == "blueprint")),
        nama_unresolved=sorted(UNCLEAR), total_klaim=len(claims),
        batas="Validasi dokumen; tidak membuktikan legalitas tenant, operasi SIJK atau keaslian digital salinan.",
    )
    assert len(claims) == 3 * 77 + len(general)
    assert len({r["id"] for r in claims}) == len(claims)
    assert len(catalog) == 77
    (OUT / "RINGKASAN_VALIDASI.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
