from pathlib import Path

import fitz

FILES = {
    "paid": "attached_assets/Ebook_SBU-SKK-ok_1787368451833.pdf",
    "appendix": "attached_assets/LAMPIRAN_EBOOK_1787369070797.pdf",
    "lead": "attached_assets/mini-ebook_SBU_1787369141323.pdf",
}

output = Path(".agents/outputs/sbu-skk-pdf-review")
output.mkdir(parents=True, exist_ok=True)

for label, filename in FILES.items():
    document = fitz.open(filename)
    print(f"\n[{label}] pages={document.page_count} metadata={document.metadata}")
    text = "\n".join(page.get_text() for page in document)
    (output / f"{label}-opening-text.txt").write_text(text, encoding="utf-8")
    print(text[:1500].replace("\n", " | "))
    regulation_lines = [
        line.strip()
        for line in text.splitlines()
        if "37/2025" in line
        or "37/KPTS" in line
        or "281/KPTS" in line
        or "Permen PU" in line
        or "Permen PUPR" in line
    ]
    print(f"regulation_matches={len(regulation_lines)}")
    for line in regulation_lines[:40]:
        print(f"  {line}")

    page_numbers = sorted({0, min(1, document.page_count - 1), document.page_count - 1})
    for page_number in page_numbers:
        pixmap = document[page_number].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        pixmap.save(output / f"{label}-page-{page_number + 1}.png")