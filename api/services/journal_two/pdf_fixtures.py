"""Wave I test helper — builds a minimal, REAL, pypdf-extractable multi-page
PDF in-memory, no external fixture file and no extra dependency (reportlab
isn't in this repo). Not imported by any shipped code path — test-only.
"""
from __future__ import annotations

import io


def make_pdf(pages_text: list[str]) -> bytes:
    """A valid PDF with one page per string in `pages_text`, each page's
    text genuinely extractable via pypdf (built through pypdf's own
    PdfWriter object graph, not hand-serialized PDF syntax, so it matches
    exactly what pypdf's reader expects)."""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    w = PdfWriter()
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    font_ref = w._add_object(font)

    for text in pages_text:
        page = w.add_blank_page(width=612, height=792)
        stream_bytes = f"BT /F1 24 Tf 72 700 Td ({text}) Tj ET".encode("latin-1")
        content = DecodedStreamObject()
        content.set_data(stream_bytes)
        content_ref = w._add_object(content)
        page[NameObject("/Contents")] = content_ref
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref}),
        })

    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def make_blank_pdf(n_pages: int = 1) -> bytes:
    """A valid PDF with zero extractable text on every page — the
    image-only/scanned-PDF case."""
    from pypdf import PdfWriter
    w = PdfWriter()
    for _ in range(n_pages):
        w.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()
