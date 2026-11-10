from pathlib import Path

import fitz


REGULATION_FULL = (
    "Keputusan Direktur Jenderal Bina Konstruksi Kementerian Pekerjaan Umum "
    "Nomor 281/KPTS/DK/2026 tentang Penetapan Standar Skema Sertifikasi "
    "Badan Usaha Jasa Konstruksi"
)
REGULATION_SHORT = "Kepdirjen PU No. 281/KPTS/DK/2026"
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
PAGE = fitz.paper_rect("a4")

FILES = (
    (
        Path("attached_assets/Ebook_SBU-SKK-ok_1787497140987.pdf"),
        Path("attached_assets/sbu-skk-tanpa-bingung-v2.2.0.pdf"),
        "Ebook Utama - Versi 2.2.0",
    ),
    (
        Path("attached_assets/LAMPIRAN_EBOOK_1787369070797.pdf"),
        Path("attached_assets/sbu-skk-lampiran-toolkit-v1.1.0.pdf"),
        "Lampiran Toolkit - Versi 1.1.0",
    ),
    (
        Path("attached_assets/mini-ebook_SBU_1787369141323.pdf"),
        Path("attached_assets/mini-ebook-sbu-skk-v1.1.0.pdf"),
        "Mini Ebook - Versi 1.1.0",
    ),
)


def write_text(
    page: fitz.Page,
    rect: fitz.Rect,
    text: str,
    *,
    size: float,
    color: tuple[float, float, float],
    bold: bool = False,
    lineheight: float = 1.3,
) -> None:
    font_name = "regbold" if bold else "regregular"
    font_file = FONT_BOLD if bold else FONT_REGULAR
    page.insert_font(fontname=font_name, fontfile=font_file)
    result = page.insert_textbox(
        rect,
        text,
        fontsize=size,
        fontname=font_name,
        color=color,
        lineheight=lineheight,
    )
    if result < 0:
        raise RuntimeError(f"Text did not fit in {rect}: {text[:80]}")


def add_addendum_page(document: fitz.Document, label: str) -> None:
    page = document.new_page(pno=1, width=PAGE.width, height=PAGE.height)
    navy = (0.027, 0.075, 0.145)
    blue = (0.125, 0.678, 0.969)
    light = (0.933, 0.965, 1.0)
    muted = (0.70, 0.78, 0.88)
    white = (1.0, 1.0, 1.0)

    page.draw_rect(page.rect, fill=navy, color=navy)
    page.draw_rect(fitz.Rect(46, 48, 52, 180), fill=blue, color=blue)
    write_text(
        page,
        fitz.Rect(72, 50, 540, 84),
        "ADDENDUM REGULASI 2026",
        size=13,
        color=blue,
        bold=True,
    )
    write_text(
        page,
        fitz.Rect(72, 92, 540, 175),
        "Pembaruan Acuan\nSertifikasi BUJK / SBU",
        size=27,
        color=white,
        bold=True,
        lineheight=1.15,
    )
    write_text(
        page,
        fitz.Rect(72, 195, 525, 290),
        REGULATION_FULL,
        size=12.5,
        color=light,
        bold=True,
        lineheight=1.35,
    )

    page.draw_rect(
        fitz.Rect(60, 320, 535, 690),
        color=(0.12, 0.25, 0.39),
        fill=(0.045, 0.11, 0.20),
        width=1,
    )
    body = (
        "Status pembaruan\n"
        f"- {REGULATION_SHORT} telah diterbitkan sebagai petunjuk pelaksanaan "
        "Permen PU No. 6 Tahun 2025 untuk skema sertifikasi BUJK/SBU.\n\n"
        "Batas ruang lingkup\n"
        "- Keputusan ini tidak mengatur sertifikasi SKK tenaga kerja secara langsung. "
        "Dalam buku ini, SKK dibahas sebagai bukti kompetensi personel dan penanggung "
        "jawab yang mendukung pemenuhan persyaratan BUJK/SBU.\n\n"
        "Cara menggunakan edisi ini\n"
        "- Narasi umum dibaca bersama addendum ini. Tabel, kode, ambang, pemetaan, dan "
        "persyaratan teknis yang berasal dari acuan sebelumnya wajib dicocokkan dengan "
        "lampiran resmi Kepdirjen 281 dan informasi terkini pada kanal LPJK/LSBU.\n\n"
        "Keputusan akhir\n"
        "- Persyaratan dan hasil sertifikasi tetap mengikuti verifikasi serta keputusan "
        "lembaga yang berwenang."
    )
    write_text(
        page,
        fitz.Rect(82, 346, 510, 660),
        body,
        size=10.5,
        color=light,
        lineheight=1.35,
    )
    write_text(
        page,
        fitz.Rect(72, 730, 520, 758),
        label,
        size=9.5,
        color=muted,
    )
    write_text(
        page,
        fitz.Rect(72, 766, 520, 800),
        "Verifikasi terakhir: kanal resmi LPJK / LSBU",
        size=9.5,
        color=blue,
        bold=True,
    )


def build(source: Path, target: Path, label: str) -> None:
    document = fitz.open(source)
    add_addendum_page(document, label)
    metadata = document.metadata
    metadata["title"] = f"SBU & SKK Tanpa Bingung - {label}"
    metadata["subject"] = f"Memuat addendum {REGULATION_SHORT}"
    document.set_metadata(metadata)
    document.save(target, garbage=4, deflate=True, clean=True)
    pages = document.page_count
    document.close()
    print(f"{source.name} -> {target.name} ({pages} pages)")


if __name__ == "__main__":
    for source, target, label in FILES:
        build(source, target, label)