"""Render only public regulatory evidence; no tenant or application data."""
from pathlib import Path

import fitz

source = next(Path("attached_assets").glob("KEP_DIRJEN_BK_281_STANDAR*"))
out = Path("generated-artifacts/blueprint-sbu-review/visual")
out.mkdir(parents=True, exist_ok=True)
with fitz.open(source) as document:
    for number in (1, 3, 4, 5, 19, 21, 23):
        document[number - 1].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(
            str(out / f"kepdirjen-281-pdf-{number:03}.png")
        )
