"""H14 hotfix rail (2026-09-26): a PDF's extracted text is bounded by what it PRODUCES.

A page can draw one text-carrying form XObject any number of times, and pypdf re-extracts
the form's text on every draw -- so a ~1 KB PDF could hold a CPU in the web process for
hours or grow text without bound. `extract_pdf_pages` now carries one budget per document
(form draws, characters produced, wall clock); the page that crosses it contributes
nothing, earlier pages are kept, later pages are not attempted.

The fixtures are built in memory here -- no file on disk, nothing near C:\\data.
"""
import time
import zlib
from io import BytesIO

import pytest
from pypdf import PdfReader

from api.services.journal_two import document_extraction as de


def _pdf(pages: list[tuple[int, str]]) -> bytes:
    """A PDF with one page per (draws, form_text): the page's content stream is
    `/X1 Do` repeated `draws` times, and X1 is a form showing `form_text`."""
    objs: list[bytes] = []

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    catalog = add(b"")          # 1, filled below
    pages_obj = add(b"")        # 2, filled below
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = []
    for draws, form_text in pages:
        form = ("BT /F1 12 Tf 10 10 Td (" + form_text + ") Tj ET").encode()
        form_id = add(b"<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] "
                      b"/Resources << /Font << /F1 %d 0 R >> >> /Length %d >>\nstream\n"
                      % (font, len(form)) + form + b"\nendstream")
        content = zlib.compress(b"/X1 Do\n" * draws)
        content_id = add(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(content)
                         + content + b"\nendstream")
        kids.append(add(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                        b"/Resources << /Font << /F1 %d 0 R >> /XObject << /X1 %d 0 R >> >> "
                        b"/Contents %d 0 R >>" % (font, form_id, content_id)))
    objs[catalog - 1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[pages_obj - 1] = (b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kids)
                           + b"] /Count %d >>" % len(kids))
    out = BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for off in offsets:
        out.write(b"%010d 00000 n \n" % off)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
              % (len(objs) + 1, xref))
    return out.getvalue()


def test_an_ordinary_pdf_extracts_exactly_as_it_did_before():
    """The visitors observe; they must not change what a normal PDF yields."""
    data = _pdf([(3, "Revenue grew 12% to $4.1B"), (1, "Guidance raised")])
    got = de.extract_pdf_pages(data)
    assert got is not None
    pages, count = got
    plain = [de._normalize_page_text(p.extract_text() or "") for p in PdfReader(BytesIO(data)).pages]
    assert count == 2
    assert pages == plain
    assert "Revenue grew 12% to $4.1B" in pages[0]


def test_form_draws_are_bounded_and_earlier_pages_are_kept(monkeypatch):
    monkeypatch.setattr(de, "_PDF_MAX_FORM_DRAWS", 50)
    data = _pdf([(5, "first page text"), (500, "A" * 50), (5, "never reached")])
    pages, count = de.extract_pdf_pages(data)
    assert count == 3                      # the real page count is still reported
    assert pages[0] == de._normalize_page_text(PdfReader(BytesIO(data)).pages[0].extract_text())
    assert pages[1:] == [""]               # the crossing page yields nothing; page 3 not attempted


def test_text_produced_is_bounded(monkeypatch):
    monkeypatch.setattr(de, "_PDF_MAX_TEXT_CHARS", 10_000)
    pages, count = de.extract_pdf_pages(_pdf([(20, "B" * 2_000)]))   # 40,000 chars unbounded
    assert count == 1
    assert pages == [""]


def test_wall_clock_is_bounded(monkeypatch):
    monkeypatch.setattr(de, "_PDF_MAX_SECONDS", 0.0)
    pages, count = de.extract_pdf_pages(_pdf([(5, "anything")]))
    assert (pages, count) == ([""], 1)


def test_the_production_budget_stops_the_amplifier_in_bounded_time():
    """At the shipped values: a ~1 KB page drawing its form past the draw budget
    returns, and returns nothing for that page, instead of running unbounded."""
    draws = de._PDF_MAX_FORM_DRAWS + 1_000
    data = _pdf([(draws, "C" * 200)])
    assert len(data) < 2_000
    t0 = time.perf_counter()
    pages, count = de.extract_pdf_pages(data)
    elapsed = time.perf_counter() - t0
    assert (pages, count) == ([""], 1)
    assert elapsed < 90, f"took {elapsed:.1f}s"


@pytest.mark.parametrize("budget", ["_PDF_MAX_FORM_DRAWS", "_PDF_MAX_TEXT_CHARS", "_PDF_MAX_SECONDS"])
def test_every_budget_is_a_positive_module_constant(budget):
    value = getattr(de, budget)
    assert isinstance(value, (int, float)) and value > 0
