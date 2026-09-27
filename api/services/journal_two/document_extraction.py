"""Wave I — PDF text extraction, page-aware.

Two new tables (`j2_note_documents` + `j2_note_document_pages`, db.py) sit
ALONGSIDE the existing note-attachment model (attachment_root.py / notes.py's
`save_note_attachment_bytes`) rather than replacing it -- the original PDF
file remains the sole authoritative artifact; everything in these two tables
is derived and rebuildable by re-running extraction against the unchanged
original.

`attachment_url` (the exact `/api/j2/notes/attachments/{user}/{note}/{sub}/
{filename}` string already embedded in the note's AttachmentChip node) is the
join key back to the original bytes -- attachments carry no id of their own
(checkpoint decision, see the Wave I entry checkpoint), so this is the
natural key rather than a new parallel identity scheme.

Runs OFF the request path: `create_document` + `queue_extraction` are called
right after a PDF attachment upload returns 200 (router), never blocking the
upload response. `_EXTRACTION_SEMAPHORE` bounds concurrent extractions --
the same "don't destabilize the machine" discipline `theme_performance.py`'s
`_MAX_WORKERS` already established elsewhere in this codebase, and directly
informed by this session's own disk-full incident (§179/§180 of the
governing directive): a malformed or huge PDF must fail LOCALLY, never take
the process down or accumulate unbounded temp state.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.permit_pool import PermitPool

log = logging.getLogger(__name__)

# ── Wave 7 lane G (G4): image + docx attachments as documents ────────────────
#
# ⛔ DARK BY DEFAULT, AND THE GATE IS READ PER CALL. Unset means OFF and that is
# the decision: an image or a .docx upload then creates no document row and the
# member sees exactly the behaviour they had before wave 7. `J2_OCR_ENABLED` is a
# DIFFERENT switch -- it only says whether a tesseract engine is wired in this
# process -- so this gate cannot be folded into it (that one is armed on web, and
# image OCR would have shipped live the day this merged).
#
# ⛔ The read shape copies `note_tasks.KILL_SWITCH` on purpose: an env name held
# in a module constant, read with no literal default, which is the form
# `feature_flag_index` resolves (and therefore the form
# tests/test_feature_flag_ledger.py can hold to its ledger row).
IMAGE_DOCX_GATE = "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED"
_GATE_ON_VALUES = {"1", "true", "yes", "on"}

# `j2_note_documents.source_kind` is free text (`db.py` adds it with DEFAULT
# 'attachment'). Two new values, both still FILESYSTEM attachments -- so
# `ask_evidence.is_web_capture` stays False for them and every consumer that asks
# "is this a web capture?" keeps treating them as attachments, which they are.
SOURCE_KIND_ATTACHMENT = "attachment"
SOURCE_KIND_IMAGE = "attachment_image"
SOURCE_KIND_DOCX = "attachment_docx"
# Wave 10 (G-160, ruling R-4): a spreadsheet rides the SAME gate as images and
# .docx. Its text is native (cell values), so like a docx it is never OCR's.
SOURCE_KIND_XLSX = "attachment_xlsx"
# The kinds whose pages are read natively and that OCR must never plan or claim
# (document_ocr.py asks this set, not a single kind).
NATIVE_TEXT_KINDS = frozenset({SOURCE_KIND_DOCX, SOURCE_KIND_XLSX})

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# ⛔ A docx is a ZIP, so its text part can be a zip bomb: a few KB on the wire
# that inflates to gigabytes. The member-facing cap is the 25 MB upload limit;
# this is the INFLATED ceiling for word/document.xml, enforced on the bytes we
# actually read, never on the size the archive claims for itself.
_DOCX_MAX_XML_BYTES = 20 * 1024 * 1024
# One stored "page" of docx text. A .docx has no pages of its own (pagination is
# a rendering decision Word makes at print time), so this is a READING unit:
# small enough that a search hit lands the member near the passage, large enough
# that a normal memo is a handful of pages.
_DOCX_PAGE_CHARS = 3000
# ⛔ AN IMAGE'S MEMORY IS A BUDGET IN BYTES, NOT A PIXEL COUNT. The upload cap is
# 5 MB of COMPRESSED bytes; a 7000x7000 RGBA PNG is 199 KB on the wire and
# 196 MB decoded. So the bound is on what the DECODE costs:
#
#   `_IMAGE_DECODE_BUDGET_BYTES` -- the most one image's decoded bitmap may take,
#   charged at `_DECODED_BYTES_PER_PIXEL` = 4, the widest pixel Pillow stores for
#   any mode PNG/JPEG/GIF/WebP decode to (RGB is held as 32-bit too). A JPEG is
#   first `draft()`-ed toward the OCR size, so it is charged for the reduced
#   bitmap its decoder will actually produce.
#
# After the decode the image is converted to greyscale (1 B/px, which releases
# the colour bitmap), shrunk to `_OCR_LONG_EDGE` on its long side, and only then
# rotated upright -- so every working copy after the decode is a greyscale one.
# Transient peak for one image, MEASURED 2026-09-25 at the 25 MP maximum
# (5000x5000), one call in a fresh process, peak commit on Windows: +121 MiB for
# RGBA and for RGB alike -- the budgeted decode plus one greyscale copy.
# ⚰️ Before the greyscale step the same measurement read +331 MiB (RGBA) and
# +235 MiB (RGB): Pillow's resize builds a full-width intermediate, and for RGBA
# a premultiplied full-size copy first. This comment said "budget + 64 MB" on
# arithmetic alone. Rail: `TestImageMemory::test_one_image_at_the_budget_...`.
# Pillow's own decompression-bomb threshold (~89 MP) only WARNS, so it is not
# what bounds this.
# ⚰️ The first cap was 50 MP and the image was decoded, copied by
# `exif_transpose`, then converted: ~440 MB transient for one image, and a
# second full decode thrown away just to validate the file.
_IMAGE_DECODE_BUDGET_BYTES = 100_000_000    # = 25 MP at 4 bytes a pixel
_DECODED_BYTES_PER_PIXEL = 4
# Long edge handed to OCR. A phone photo of a page at 4000 px is ~350 DPI on a
# letter sheet, past what tesseract needs; more pixels are memory, not accuracy.
_OCR_LONG_EDGE = 4000
_IMAGE_DOC_NAME = "Image"

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def image_docx_documents_enabled() -> bool:
    """Is the wave-7 image/docx document path ON for this call? Read per call,
    never cached, so a flip needs no restart."""
    raw = os.environ.get(IMAGE_DOCX_GATE)
    return raw is not None and raw.strip().lower() in _GATE_ON_VALUES

# Bounds worst-case per-document processing time/memory -- a 400-page filing
# is real and expected; an unbounded page count is not. Text extraction past
# this point is simply not attempted (page_count still reflects the PDF's
# real page count where readable; only page TEXT is capped).
_MAX_PAGES = 500

# ⛔⛔ A PDF'S TEXT IS BOUNDED BY WHAT IT PRODUCES, NOT BY ITS SIZE (H14 hotfix,
# 2026-09-26). A page can draw one text-carrying form XObject any number of times:
# its content stream is `/X1 Do` repeated, which compresses to almost nothing, and
# pypdf re-extracts the form's text on every draw. Measured with pypdf 6.15 on a
# ~1 KB PDF: text grows linearly with the draws (5,000 draws -> 1,004,999 chars),
# at ~1.1 ms of CPU per draw -- so a small upload could hold a CPU (and the GIL) in
# the one web process for hours, or grow text into gigabytes with a larger form.
# `_MAX_PAGES` bounds pages, not this. These three bound the WHOLE document; the
# first one crossed stops extraction, keeps the pages already read (the same honest
# truncation as `_MAX_PAGES`) and logs which budget stopped it.
_PDF_MAX_FORM_DRAWS = 10_000        # form/image XObject draws across the document
_PDF_MAX_TEXT_CHARS = 5_000_000     # characters of text produced across the document
_PDF_MAX_SECONDS = 120.0            # wall clock for the whole document's extraction
# Never more than this many extractions running at once, across all users on
# this process. Two, not one: keeps a single large filing from starving every
# other member's upload behind it, without opening the door to the kind of
# unbounded-thread-per-upload herd this codebase has been burned by before
# (bars_prewarm's own pool-size precedent).
_MAX_CONCURRENT_EXTRACTIONS = 2
_EXTRACTION_SEMAPHORE = threading.Semaphore(_MAX_CONCURRENT_EXTRACTIONS)
# The workers that run extractions. Its size IS the semaphore's permits
# (permit_pool.py), so the semaphore stays the one number that bounds both how
# many extractions run and how many threads exist.
_EXTRACTION_POOL = PermitPool("j2-doc-extract", _EXTRACTION_SEMAPHORE)

EXTRACTION_VERSION = 1

_STATUS_PENDING = "pending"
_STATUS_READY = "ready"
_STATUS_FAILED = "processing_failed"
_STATUS_NO_TEXT = "no_text"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Text normalization ───────────────────────────────────────────────────────

def _normalize_page_text(text: str) -> str:
    """Preserve financial punctuation ($ % - ( ) and decimals) untouched --
    only whitespace/null-byte noise is collapsed."""
    if not text:
        return ""
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── Extraction (pypdf) ───────────────────────────────────────────────────────

class _PdfBudgetExceeded(Exception):
    """Raised from pypdf's visitors when a document crosses a `_PDF_MAX_*` budget."""


def _pdf_budget_visitors():
    """(state, visitor_operand_before, visitor_text) sharing ONE budget per document.

    pypdf calls `visitor_operand_before` for every operator, including those inside a
    drawn form, and `visitor_text` for every piece of text it produces. Both raise
    once the document is over a budget -- and keep raising, so an exception pypdf
    swallows around a nested form still stops the next top-level operator."""
    state = {"draws": 0, "chars": 0, "t0": time.monotonic(), "why": None}

    def over(why: str) -> None:
        state["why"] = why
        raise _PdfBudgetExceeded(why)

    def before(operator, operands, cm, tm) -> None:
        if state["why"]:
            raise _PdfBudgetExceeded(state["why"])
        if operator == b"Do":
            state["draws"] += 1
            if state["draws"] > _PDF_MAX_FORM_DRAWS:
                over(f"more than {_PDF_MAX_FORM_DRAWS} form draws")
        if time.monotonic() - state["t0"] > _PDF_MAX_SECONDS:
            over(f"more than {_PDF_MAX_SECONDS:.0f} s of extraction")

    def text(t, cm, tm, font_dict, font_size) -> None:
        if state["why"]:
            raise _PdfBudgetExceeded(state["why"])
        state["chars"] += len(t or "")
        if state["chars"] > _PDF_MAX_TEXT_CHARS:
            over(f"more than {_PDF_MAX_TEXT_CHARS} characters of text")

    return state, before, text


def extract_pdf_pages(data: bytes) -> tuple[list[str], int] | None:
    """Best-effort, per-page text extraction. Returns (pages, real_page_count)
    or None on total failure (corrupt, unreadable, or password-protected with
    no recoverable empty-password decrypt). Never raises -- a malformed PDF
    must fail locally, never take a worker thread down with it. One bad PAGE
    inside an otherwise-good PDF yields an empty string for that page only,
    never aborts the whole document."""
    try:
        from io import BytesIO

        from pypdf import PdfReader
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            # Some PDFs are "encrypted" only with an empty owner password
            # (permissions-only, no real secret) -- pypdf can open those.
            # A genuinely password-protected PDF fails this and is honestly
            # reported as unreadable, per the checkpoint's own "do not
            # support server-side password extraction" decision.
            try:
                reader.decrypt("")
            except Exception:
                return None
        real_page_count = len(reader.pages)
        pages: list[str] = []
        budget, before, on_text = _pdf_budget_visitors()
        for i, page in enumerate(reader.pages):
            if i >= _MAX_PAGES or budget["why"]:
                break
            try:
                pages.append(_normalize_page_text(page.extract_text(
                    visitor_operand_before=before, visitor_text=on_text) or ""))
            except _PdfBudgetExceeded:
                # The page that crossed the budget contributes nothing (its text
                # is exactly what was unbounded); earlier pages are kept.
                pages.append("")
                log.warning("[doc-extract] pdf extraction stopped at page %s: %s",
                            i, budget["why"])
            except Exception as e:  # noqa: BLE001 — one bad page, not the document
                log.warning("[doc-extract] page %s failed: %s", i, e)
                pages.append("")
        return pages, real_page_count
    except Exception as e:  # noqa: BLE001 — corrupt/unreadable PDF, never propagate
        log.warning("[doc-extract] extraction failed: %s", e)
        return None


# ── Extraction (docx, stdlib only) ───────────────────────────────────────────

def _normalize_docx_text(text: str) -> str:
    """Like `_normalize_page_text`, minus the space/tab collapse: a `w:tab` is
    deliberately a TAB here (columns in a memo line up on it), so only null
    bytes and runs of blank lines are cleaned."""
    if not text:
        return ""
    text = text.replace("\x00", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class _DocxRefused(Exception):
    """word/document.xml declares a DOCTYPE. Raised from inside the parser."""


def _docx_paragraphs(xml: bytes) -> list[str]:
    """Paragraph text of word/document.xml, in document order.

    `w:p` is a paragraph (joined by newlines by the caller), `w:t` runs are
    concatenated, `w:tab` is a tab, `w:br`/`w:cr` a newline. Only `w:t` carries
    text: `w:delText` (tracked deletions) and `w:instrText` (field codes) are
    NOT the words on the page and are skipped by construction.

    ⛔ STREAMING, NOT RECURSIVE. expat's callbacks with a stack of open
    paragraphs handle a paragraph nested inside a text box without recursing,
    so a pathologically deep document cannot exhaust the interpreter stack.

    ⛔ A DOCTYPE IS REFUSED BY THE PARSER, NOT BY A BYTE SCAN. The handler
    below fires on the declaration itself, AFTER expat has decoded the input,
    so it sees a DOCTYPE in UTF-16 (or any encoding expat reads) and at any
    offset. An entity can only be declared inside a DOCTYPE, so it is refused
    before any entity exists and nothing can expand. A real Word document never
    carries one. ⚰️ This was a scan of the RAW BYTES for `<!DOCTYPE` in the
    first 4 KB: a UTF-16 document.xml walked straight past it and expanded its
    entity, and so did a DOCTYPE placed after a 5 KB prolog comment.

    Raises `_DocxRefused` for a DOCTYPE and expat's own error for anything
    that is not well-formed XML; the caller turns both into None.

    ⛔ ONE PARSER SET-UP, ONE DOCTYPE GUARD: `_parse_xml` (wave 10) is what the
    xlsx parts go through too, so the refusal cannot hold for one format and
    not the other.
    """
    w = _W[1:-1] + " "                      # expat's "<uri> <local>" tag form
    p_tag, t_tag, tab_tag = w + "p", w + "t", w + "tab"
    breaks = (w + "br", w + "cr")
    out: list[str] = []
    stack: list[list[str]] = []             # the open paragraphs' text parts
    open_tags: list[str] = []               # every open element, innermost last

    def start(tag, _attrs):
        open_tags.append(tag)
        if tag == p_tag:
            stack.append([])
        elif stack and tag == tab_tag:
            stack[-1].append("\t")
        elif stack and tag in breaks:
            stack[-1].append("\n")

    def end(tag):
        open_tags.pop()
        if tag == p_tag and stack:
            out.append("".join(stack.pop()))

    def chars(data):
        # Only a `w:t`'s own text, the same text ElementTree called `.text`.
        if stack and open_tags and open_tags[-1] == t_tag:
            stack[-1].append(data)

    _parse_xml(xml, start, end, chars)
    return out


_NON_SPACE = re.compile(r"\S")   # matches exactly what `str.lstrip()` keeps


def _chunk_pages(
    paragraphs: list[str], size: int = _DOCX_PAGE_CHARS, max_pages: int | None = None,
) -> tuple[list[str], int]:
    """Pack paragraphs into reading pages of about `size` characters.

    Returns `(pages, page_count)`: the text of at most `max_pages` pages
    (default `_MAX_PAGES`, read per call) and the REAL number of pages the
    document makes. A page breaks BETWEEN paragraphs; only a single paragraph
    longer than a whole page is split, and then at the last whitespace before
    the limit where one exists, so a word is never cut in half when it need
    not be.

    ⛔ LINEAR, AND CAPPED WHILE IT RUNS. A long paragraph is walked with an
    INDEX, never by re-slicing its remainder, and past `max_pages` no page text
    is built at all -- only its length is counted, so `page_count` stays exact.
    ⚰️ The first version re-sliced the remainder once per page and built every
    page before cutting the list: a 19 MB single-character run (a few KB on the
    wire once deflated) cost 14.2 s of GIL-holding copying on the one web
    process, 6,641 pages built to keep 500.
    """
    if max_pages is None:
        max_pages = _MAX_PAGES
    pages: list[str] = []
    count = 0
    cur_parts: list[str] = []   # the page being packed (text kept only while it can be stored)
    cur_len = 0                 # its length, always; `cur_len == 0` is "no page open"

    def flush(text: str | None) -> None:
        nonlocal count
        if count < max_pages:
            pages.append(text if text is not None else "\n".join(cur_parts))
        count += 1

    for para in paragraphs:
        n = len(para)
        i = 0
        while n - i > size:
            cut = para.rfind(" ", i, i + size)
            if cut <= i:
                cut = i + size
            if cur_len:
                flush(None)
                cur_parts, cur_len = [], 0
            flush(para[i:cut].rstrip() if count < max_pages else "")
            m = _NON_SPACE.search(para, cut)
            i = m.start() if m else n
        rest_len = n - i
        keep = count < max_pages
        rest = (para[i:] if i else para) if keep else ""
        if not cur_len:
            cur_parts, cur_len = ([rest] if keep else []), rest_len
        elif cur_len + 1 + rest_len <= size:
            if keep:
                cur_parts.append(rest)
            cur_len += 1 + rest_len
        else:
            flush(None)
            # `rest` was built above whenever this new page can still be stored
            # (the count only grows, so "storable now" implies "storable then").
            cur_parts, cur_len = ([rest] if count < max_pages else []), rest_len
    if cur_len or count == 0:
        flush(None)
    return pages, count


def extract_docx_pages(data: bytes) -> tuple[list[str], int] | None:
    """Text of a .docx as reading pages, stdlib only (`zipfile` +
    `xml.etree`). Returns (pages, page_count) or None when the file is not a
    readable docx. Never raises, same contract as `extract_pdf_pages`.

    ⛔ BOUNDED. word/document.xml is read through a size-limited read, so an
    archive that LIES about its inflated size still cannot hand us more than
    `_DOCX_MAX_XML_BYTES`; past that the whole document is refused. Text pages
    past `_MAX_PAGES` are never built (page_count still reports the real count,
    exactly as it does for a long PDF), and the paging is linear in the text.

    ⛔ NO DOCTYPE, refused inside the parser whatever the encoding -- see
    `_docx_paragraphs`. That is the guard against entity expansion; expat's
    own amplification limit is a second line we do not lean on.
    """
    try:
        with zipfile.ZipFile(BytesIO(data)) as zf:
            try:
                info = zf.getinfo("word/document.xml")
            except KeyError:
                return None
            if info.file_size > _DOCX_MAX_XML_BYTES:
                log.warning("[doc-extract] docx refused: document.xml declares %s bytes",
                            info.file_size)
                return None
            with zf.open(info) as fh:
                xml = fh.read(_DOCX_MAX_XML_BYTES + 1)
        if len(xml) > _DOCX_MAX_XML_BYTES:
            log.warning("[doc-extract] docx refused: document.xml inflates past the cap")
            return None
        paragraphs = _docx_paragraphs(xml)
    except _DocxRefused:
        log.warning("[doc-extract] docx refused: document.xml carries a DOCTYPE")
        return None
    except Exception as e:  # noqa: BLE001 — a malformed docx fails locally, never the thread
        log.warning("[doc-extract] docx extraction failed: %s", type(e).__name__)
        return None
    text_pages, page_count = _chunk_pages([p.replace("\x00", "") for p in paragraphs])
    return [_normalize_docx_text(p) for p in text_pages], page_count


# ── Extraction (xlsx, stdlib only) — wave 10, G-160 ─────────────────────────
#
# A workbook is a ZIP of XML parts: `xl/workbook.xml` lists the sheets in tab
# order, `xl/_rels/workbook.xml.rels` says which part each sheet is,
# `xl/sharedStrings.xml` holds the TEXT of most text cells (a cell stores only
# an index into it), `xl/styles.xml` says which cells are formatted as dates,
# and `xl/worksheets/sheetN.xml` holds the cells.
#
# ⛔ THE SHARED STRINGS ARE THE TEXT. A text cell is `<c t="s"><v>7</v></c>` --
# the 7 is not the word, it is the eighth `<si>` of sharedStrings.xml. An
# extractor that ignores that part indexes a column of small integers and
# finds none of a spreadsheet's words.
#
# ⛔ A FORMULA CELL SHOWS ITS CACHED VALUE ONLY. Nothing here evaluates a
# formula: a cell's text is the value Excel (or whatever wrote the file) last
# calculated and stored in `<v>`. A formula the writer never calculated has no
# value and reads as empty. The viewer says so.
#
# ⛔ THE SAME CAPS AS A DOCX, PLUS ONE. Every part is read through a
# size-limited read (`_DOCX_MAX_XML_BYTES` each -- an archive that lies about
# its inflated size still cannot hand over more), AND the parts together may
# inflate to no more than `_XLSX_MAX_TOTAL_XML_BYTES`: a workbook is many
# parts, and a per-part cap alone would let fifty of them add up. Pages past
# `_MAX_PAGES` are counted, never built. Every part is parsed by expat with a
# DOCTYPE refused by the parser itself (`_DocxRefused`), the docx guard.
_XLSX_MAX_TOTAL_XML_BYTES = 2 * _DOCX_MAX_XML_BYTES
# ⛔⛔ AND THE TEXT IS CAPPED, NOT ONLY THE XML (review C-1). A docx's text is
# bounded by its XML; a workbook's is NOT: `<c t="s"><v>0</v></c>` is 25 bytes
# that stands for the whole of shared string 0, so a few KB of XML referencing
# one long string N times is N copies of it. MEASURED at the lane tip: a
# 3,890-byte file (one 1 MB shared string, 100 rows of two cells) peaked at
# 204 MB of Python strings, 200 rows at 404 MB -- linear, on the one web
# process. Two caps, and each one is railed by its own mutation:
#   * one cell's text is at most `_XLSX_MAX_CELL_CHARS` (Excel's own per-cell
#     limit, so a file Excel wrote never meets it);
#   * the whole workbook produces at most `_xlsx_text_budget()` characters of
#     row text, across ALL its sheets. Past it no row is built, no further
#     sheet is read, and the last stored page SAYS the rest was not read --
#     a readable truncated state, never `processing_failed`.
_XLSX_MAX_CELL_CHARS = 32_767
_XLSX_MAX_TEXT_CHARS = _MAX_PAGES * _DOCX_PAGE_CHARS     # as much text as the stored pages hold
_XLSX_MAX_SHEETS = 100
# A row is read up to this column (IV, Excel's pre-2007 width). Past it a
# member's table is a data dump, not something read a page at a time.
_XLSX_MAX_COLUMNS = 256
# Excel's BUILT-IN date and time number formats (ECMA-376 §18.8.30).
_XLSX_BUILTIN_DATE_FORMATS = frozenset({14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47})


class _XlsxRefused(Exception):
    """A part is past a cap, or the workbook is not a readable spreadsheet."""


def _xlsx_text_budget() -> int:
    """The produced-text budget for ONE workbook: `_XLSX_MAX_TEXT_CHARS`, read
    per call. Deliberately NOT derived from `_MAX_PAGES` at call time: the two
    are separate caps with separate meanings (pages past `_MAX_PAGES` are
    COUNTED, never built; text past the budget is never read at all), and a
    test that lowers one must not silently move the other."""
    return _XLSX_MAX_TEXT_CHARS


class _XlsxBudget:
    """ONE running produced-characters budget, shared by every sheet of a
    workbook (a per-sheet budget would let a hundred sheets add up)."""

    def __init__(self, limit: int):
        self.left = limit
        self.truncated = False    # some cell text was not read -- the member is told
        self.spent = False        # a row did not fit: stop reading rows AND sheets


class _XlsxBudgetSpent(Exception):
    """Raised from inside the parser the moment a row does not fit the
    budget: the rest of that sheet's XML is not walked at all."""


def _budgeted_row(row_cells: dict[int, str], width: int, budget: _XlsxBudget) -> str | None:
    """One row's cells joined by TABs, charged to the budget (plus the newline
    that will follow it). A row that does not fit is cut at the budget --
    built piece by piece up to what is left, so the row itself can never be a
    larger copy than the budget -- and the budget is marked spent."""
    need = sum(len(v) for v in row_cells.values()) + (width - 1) + 1
    if need <= budget.left:
        budget.left -= need
        return "\t".join(row_cells.get(i, "") for i in range(width))
    parts: list[str] = []
    left = max(budget.left - 1, 0)
    for i in range(width):
        if left <= 0:
            break
        if i:
            parts.append("\t")
            left -= 1
        cell = row_cells.get(i, "")[:left]
        parts.append(cell)
        left -= len(cell)
    budget.left = 0
    budget.truncated = True
    budget.spent = True
    line = "".join(parts).rstrip("\t")
    return line or None


def _local(name: str) -> str:
    """expat's "<uri> <local>" name -> the local name. Namespace-agnostic on
    purpose: transitional and strict OOXML name the same elements under two
    different URIs."""
    return name.rsplit(" ", 1)[-1]


def _parse_xml(xml: bytes, start, end=None, chars=None) -> None:
    """Stream `xml` through expat with a DOCTYPE refused by the parser (the
    docx guard: it fires after decoding, so any encoding and any offset)."""
    from xml.parsers import expat

    def refuse_doctype(*_args):
        raise _DocxRefused("DOCTYPE")

    parser = expat.ParserCreate(namespace_separator=" ")
    parser.buffer_text = True
    parser.StartElementHandler = start
    if end is not None:
        parser.EndElementHandler = end
    if chars is not None:
        parser.CharacterDataHandler = chars
    parser.StartDoctypeDeclHandler = refuse_doctype
    parser.Parse(xml, True)


class _XlsxParts:
    """Reads a workbook's parts under a per-part AND a whole-workbook budget."""

    def __init__(self, zf: zipfile.ZipFile):
        self.zf = zf
        self.spent = 0

    def read(self, name: str) -> bytes | None:
        try:
            info = self.zf.getinfo(name)
        except KeyError:
            return None
        if info.file_size > _DOCX_MAX_XML_BYTES:
            raise _XlsxRefused(f"{name} declares {info.file_size} bytes")
        cap = min(_DOCX_MAX_XML_BYTES, _XLSX_MAX_TOTAL_XML_BYTES - self.spent)
        with self.zf.open(info) as fh:
            data = fh.read(cap + 1)
        if len(data) > cap:
            raise _XlsxRefused(f"{name} inflates past the cap")
        self.spent += len(data)
        return data


def _xlsx_sheets(workbook: bytes) -> tuple[list[tuple[str, str]], bool]:
    """(`[(sheet name, relationship id)]` in tab order, the 1904 date system?)."""
    sheets: list[tuple[str, str]] = []
    date1904 = [False]

    def start(tag, attrs):
        local = _local(tag)
        if local == "sheet":
            rid = next((v for k, v in attrs.items() if _local(k) == "id" and " " in k), None)
            if rid:
                sheets.append((attrs.get("name") or "Sheet", rid))
        elif local == "workbookPr":
            date1904[0] = str(attrs.get("date1904", "")).strip().lower() in ("1", "true")

    _parse_xml(workbook, start)
    return sheets, date1904[0]


def _xlsx_rels(rels: bytes | None) -> dict[str, str]:
    """Relationship id -> the zip member it names (resolved against `xl/`)."""
    import posixpath

    out: dict[str, str] = {}
    if not rels:
        return out

    def start(tag, attrs):
        if _local(tag) == "Relationship" and attrs.get("Id") and attrs.get("Target"):
            target = attrs["Target"]
            path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(
                posixpath.join("xl", target))
            out[attrs["Id"]] = path

    _parse_xml(rels, start)
    return out


def _xlsx_shared_strings(xml: bytes | None) -> tuple[list[str], bool]:
    """(the text of every `<si>` in order, was any string cut?). A rich-text
    string is its runs' `<t>` joined; `<rPh>` (a phonetic reading shown ABOVE
    East Asian text, not part of it) is skipped. Each string keeps at most
    `_XLSX_MAX_CELL_CHARS` characters -- counted WHILE parsing, so a long
    string is never assembled whole only to be sliced."""
    out: list[str] = []
    capped = [False]
    if not xml:
        return out, False
    cur: list[str] | None = None
    cur_len = [0]
    depth = {"rPh": 0, "t": 0}

    def start(tag, _attrs):
        nonlocal cur
        local = _local(tag)
        if local == "si":
            cur = []
            cur_len[0] = 0
        elif local in depth:
            depth[local] += 1

    def end(tag):
        nonlocal cur
        local = _local(tag)
        if local == "si" and cur is not None:
            out.append("".join(cur))
            cur = None
        elif local in depth:
            depth[local] -= 1

    def chars(data):
        if cur is not None and depth["t"] and not depth["rPh"]:
            room = _XLSX_MAX_CELL_CHARS - cur_len[0]
            if len(data) > room:
                data = data[:max(room, 0)]
                capped[0] = True
            if data:
                cur.append(data)
                cur_len[0] += len(data)

    _parse_xml(xml, start, end, chars)
    return out, capped[0]


def _is_date_format(code: str) -> tuple[bool, bool]:
    """(has a date part, has a time part) for a number-format code. Quoted
    literals, escaped characters and `[...]` sections (colours, locales,
    elapsed-time brackets) are not format letters and are dropped first."""
    c = re.sub(r'"[^"]*"|\\.|\[[^\]]*\]', "", code or "").lower()
    return bool(re.search(r"[dy]", c)), bool(re.search(r"[hs]", c))


def _xlsx_date_styles(xml: bytes | None) -> dict[int, tuple[bool, bool]]:
    """Cell style index (a cell's `s`) -> (date part, time part), for the
    styles whose number format is a date or a time. Others are absent."""
    if not xml:
        return {}
    custom: dict[int, str] = {}
    xf_formats: list[int] = []
    in_cell_xfs = [0]

    def start(tag, attrs):
        local = _local(tag)
        if local == "numFmt":
            try:
                custom[int(attrs.get("numFmtId", ""))] = attrs.get("formatCode", "")
            except ValueError:
                pass
        elif local == "cellXfs":
            in_cell_xfs[0] += 1
        elif local == "xf" and in_cell_xfs[0]:
            try:
                xf_formats.append(int(attrs.get("numFmtId", "0")))
            except ValueError:
                xf_formats.append(0)

    def end(tag):
        if _local(tag) == "cellXfs":
            in_cell_xfs[0] -= 1

    _parse_xml(xml, start, end)
    out: dict[int, tuple[bool, bool]] = {}
    for index, fmt in enumerate(xf_formats):
        if fmt in custom:
            kind = _is_date_format(custom[fmt])
        elif fmt in _XLSX_BUILTIN_DATE_FORMATS:
            kind = (fmt not in (18, 19, 20, 21, 45, 46, 47), fmt in (18, 19, 20, 21, 22, 45, 46, 47))
        else:
            continue
        if kind[0] or kind[1]:
            out[index] = kind
    return out


def _xlsx_number(raw: str) -> str:
    """A stored number as a person reads it: 15 significant digits, so the
    binary noise of 0.1 + 0.2 reads 0.3 and 120.5 stays 120.5."""
    try:
        x = float(raw)
    except ValueError:
        return raw.strip()
    if x != x or x in (float("inf"), float("-inf")):
        return raw.strip()
    return format(x, ".15g")


def _xlsx_serial(raw: str, date1904: bool, has_date: bool, has_time: bool) -> str:
    """An Excel date serial as ISO text (`2026-09-26`, `2026-09-26 14:30`,
    `14:30`). A value outside a real calendar is left as the number."""
    from datetime import timedelta
    try:
        x = float(raw)
    except ValueError:
        return raw.strip()
    if not (0 <= x < 2958466):
        return _xlsx_number(raw)
    epoch = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 30)
    # ⛔ PER CELL (review M-1). The range above is the 1900 system's; the 1904
    # epoch starts 1,462 days later, so a 1904 serial near the top of that
    # range is past year 9999 and `timedelta` raises. Caught HERE, one cell
    # reads as its number -- it used to escape to the workbook level and fail
    # the whole document for one odd cell.
    try:
        when = epoch + timedelta(days=x)
    except (OverflowError, ValueError):
        return _xlsx_number(raw)
    if has_date and has_time:
        return when.strftime("%Y-%m-%d %H:%M")
    if has_date:
        return when.strftime("%Y-%m-%d")
    return when.strftime("%H:%M")


def _column_index(ref: str | None) -> int | None:
    """"B12" -> 1 (zero-based column), or None."""
    if not ref:
        return None
    m = re.match(r"([A-Za-z]{1,3})", ref)
    if not m:
        return None
    n = 0
    for ch in m.group(1).upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _xlsx_sheet_rows(xml: bytes, shared: list[str], date_styles: dict[int, tuple[bool, bool]],
                     date1904: bool, budget: _XlsxBudget | None = None) -> list[str]:
    """Each non-empty row of one sheet as its cells' text joined by TABs (a
    gap keeps its column), in sheet order -- charged to the workbook's
    `budget`, and stopped (mid-sheet) the moment a row does not fit it."""
    if budget is None:
        budget = _XlsxBudget(_xlsx_text_budget())
    rows: list[str] = []
    row_cells: dict[int, str] | None = None
    cell: dict[str, Any] | None = None
    buf: list[str] = []
    capture = [None]          # "v" | "t" (inline string text) | None
    depth = {"is": 0, "rPh": 0}
    next_col = [0]

    def start(tag, attrs):
        nonlocal row_cells, cell, buf
        local = _local(tag)
        if local == "row":
            row_cells = {}
            next_col[0] = 0
        elif local == "c" and row_cells is not None:
            col = _column_index(attrs.get("r"))
            cell = {"t": attrs.get("t") or "n", "s": attrs.get("s"),
                    "col": col if col is not None else next_col[0], "v": None, "inline": []}
        elif cell is not None and local == "v":
            capture[0], buf = "v", []
        elif cell is not None and local in depth:
            depth[local] += 1
        elif cell is not None and local == "t" and depth["is"] and not depth["rPh"]:
            capture[0] = "t"

    def end(tag):
        nonlocal row_cells, cell
        local = _local(tag)
        if local == "v" and cell is not None:
            cell["v"] = "".join(buf)
            capture[0] = None
        elif local == "t" and capture[0] == "t":
            capture[0] = None
        elif local in depth and cell is not None:
            depth[local] -= 1
        elif local == "c" and cell is not None and row_cells is not None:
            text = _xlsx_cell_text(cell, shared, date_styles, date1904) if cell["col"] < _XLSX_MAX_COLUMNS else ""
            # ONE cap per text kind, never two copies of one: a shared string
            # was capped as it was parsed (`_xlsx_shared_strings`); every other
            # kind (inline, a formula's string, an error, an ISO date) is
            # capped here. Re-capping shared text here would make the parse-
            # time cap unprovable (a mutation to it would stay green).
            if cell["t"] != "s" and len(text) > _XLSX_MAX_CELL_CHARS:
                text = text[:_XLSX_MAX_CELL_CHARS]
                budget.truncated = True
            if text:
                row_cells[cell["col"]] = text
            next_col[0] = cell["col"] + 1
            cell = None
        elif local == "row" and row_cells is not None:
            if row_cells:
                width = max(row_cells) + 1
                line = _budgeted_row(row_cells, width, budget)
                if line is not None:
                    rows.append(line)
            row_cells = None
            if budget.spent:
                raise _XlsxBudgetSpent

    def chars(data):
        if capture[0] == "v":
            buf.append(data)
        elif capture[0] == "t" and cell is not None:
            cell["inline"].append(data)

    try:
        _parse_xml(xml, start, end, chars)
    except _XlsxBudgetSpent:
        pass
    return rows


def _xlsx_cell_text(cell: dict[str, Any], shared: list[str],
                    date_styles: dict[int, tuple[bool, bool]], date1904: bool) -> str:
    """One cell as text. `t`: s (a shared string, by index), inlineStr, str (a
    formula's text result), b (TRUE/FALSE), e (an error such as #DIV/0!), d
    (an ISO date), n / absent (a number -- a date when its style says so)."""
    t, v = cell["t"], cell["v"]
    if t == "inlineStr":
        return "".join(cell["inline"]).replace("\x00", "").strip()
    if v is None:
        return ""                     # a formula never calculated, or an empty cell
    if t == "s":
        try:
            i = int(v.strip())
        except ValueError:
            return ""
        return shared[i].replace("\x00", "").strip() if 0 <= i < len(shared) else ""
    if t in ("str", "e", "d"):
        return v.replace("\x00", "").strip()
    if t == "b":
        return "TRUE" if v.strip() == "1" else "FALSE"
    try:
        style = int(cell["s"]) if cell["s"] is not None else None
    except ValueError:
        style = None
    if style is not None and style in date_styles:
        return _xlsx_serial(v, date1904, *date_styles[style])
    return _xlsx_number(v)


def extract_xlsx_pages(data: bytes) -> tuple[list[str], int] | None:
    """Text of an .xlsx as reading pages, stdlib only (`zipfile` + expat).
    Returns (pages, page_count) or None when the file is not a readable
    workbook. Never raises, same contract as `extract_docx_pages`.

    Each sheet, in tab order, becomes its own run of pages, and every page
    opens with the sheet's name (`Sheet: Trades`, then `Sheet: Trades
    (continued)`), so a search hit's page says which sheet it is on. A row is
    its cells' text joined by tabs. Text cells come from the shared-strings
    table, formula cells show their CACHED value, dates are written as ISO
    dates. Sheets past `_XLSX_MAX_SHEETS` are not read; pages past
    `_MAX_PAGES` are counted, never built.

    ⛔ THE TEXT IS BUDGETED (review C-1): one cell is at most
    `_XLSX_MAX_CELL_CHARS`, and the workbook produces at most
    `_xlsx_text_budget()` characters of rows across all its sheets. A workbook
    cut at either cap is still a READABLE document: its pages are what was
    read, `page_count` counts the pages of THAT text (the part never read is
    never built, so it cannot be counted without the very walk the budget
    exists to prevent), and the last stored page ends with
    `_xlsx_truncated_note()`, so the member is told rather than shown a
    quietly shorter spreadsheet.
    """
    budget = _XlsxBudget(_xlsx_text_budget())
    try:
        with zipfile.ZipFile(BytesIO(data)) as zf:
            parts = _XlsxParts(zf)
            workbook = parts.read("xl/workbook.xml")
            if workbook is None:
                return None
            sheets, date1904 = _xlsx_sheets(workbook)
            rels = _xlsx_rels(parts.read("xl/_rels/workbook.xml.rels"))
            shared, shared_capped = _xlsx_shared_strings(parts.read("xl/sharedStrings.xml"))
            if shared_capped:
                budget.truncated = True
            date_styles = _xlsx_date_styles(parts.read("xl/styles.xml"))
            per_sheet: list[tuple[str, list[str]]] = []
            for name, rid in sheets[:_XLSX_MAX_SHEETS]:
                if budget.spent:
                    break                   # no further sheet is even read
                member = rels.get(rid)
                xml = parts.read(member) if member else None
                if xml is None:
                    continue
                rows = _xlsx_sheet_rows(xml, shared, date_styles, date1904, budget)
                if rows:
                    per_sheet.append((name.replace("\x00", "").strip() or "Sheet", rows))
    except (_DocxRefused, _XlsxRefused) as e:
        log.warning("[doc-extract] xlsx refused: %s", type(e).__name__)
        return None
    except Exception as e:  # noqa: BLE001 — a malformed workbook fails locally, never the thread
        log.warning("[doc-extract] xlsx extraction failed: %s", type(e).__name__)
        return None

    pages: list[str] = []
    count = 0
    for name, rows in per_sheet:
        head = f"Sheet: {name}"
        more = f"Sheet: {name} (continued)"
        room = max(_MAX_PAGES - len(pages), 0)
        sheet_pages, sheet_count = _chunk_pages(
            rows, size=max(_DOCX_PAGE_CHARS - len(more) - 1, 200), max_pages=room)
        for i, text in enumerate(sheet_pages):
            pages.append(_normalize_docx_text(f"{head if i == 0 else more}\n{text}"))
        count += sheet_count
    if budget.truncated:
        note = _xlsx_truncated_note()
        if not pages:
            return [note], 1
        pages[-1] = f"{pages[-1]}\n\n{note}"
    if count == 0:
        return [""], 1
    return pages, count


def _xlsx_truncated_note() -> str:
    """The sentence the last stored page of a budget-cut workbook ends with."""
    return ("[The rest of this spreadsheet is not in the Notebook. It keeps up to "
            f"{_xlsx_text_budget():,} characters of a workbook's cell values, and up to "
            f"{_XLSX_MAX_CELL_CHARS:,} in one cell, so anything past that is not searchable "
            "here. Open or download the file to see all of it.]")


# ── Images (read for OCR, never stored as text here) ─────────────────────────

def _open_within_budget(data: bytes):
    """`Image.open` (which reads the HEADER only) plus the byte budget, or None.

    A JPEG is `draft()`-ed toward `_OCR_LONG_EDGE` first: that only tells the
    decoder to decode at 1/2, 1/4 or 1/8 scale, and `size` then reports the
    bitmap the decode will really make -- which is what the budget charges.
    Raises on a file Pillow cannot identify; callers catch."""
    from PIL import Image
    im = Image.open(BytesIO(data))
    w, h = im.size
    if im.format == "JPEG" and max(w, h) > _OCR_LONG_EDGE:
        # The target keeps the photo's aspect: Pillow scales only when BOTH
        # sides are at least twice the request, so a square (4000, 4000) box
        # would leave an 8064x6048 phone photo undrafted and over budget.
        k = _OCR_LONG_EDGE / max(w, h)
        im.draft(im.mode, (max(1, int(w * k)), max(1, int(h * k))))
        w, h = im.size
    if w <= 0 or h <= 0 or w * h * _DECODED_BYTES_PER_PIXEL > _IMAGE_DECODE_BUDGET_BYTES:
        log.warning("[doc-extract] image refused: %sx%s decodes past the %s-byte budget",
                    w, h, _IMAGE_DECODE_BUDGET_BYTES)
        return None
    return im


def probe_image(data: bytes) -> bool:
    """Is this an image OCR could read? Answered from the HEADER, never by
    decoding the pixels: `Image.open` + the budget + `verify()` (which checks a
    PNG's chunk CRCs without inflating them). Never raises.

    ⛔ Extraction only needs a yes/no. ⚰️ It used to fully decode (and rotate)
    the image to find out, throw the bitmap away, and let OCR decode it again."""
    try:
        im = _open_within_budget(data)
        if im is None:
            return False
        im.verify()
        return True
    except Exception as e:  # noqa: BLE001 — an unreadable image is a no-text image
        log.warning("[doc-extract] image could not be read: %s", type(e).__name__)
        return False


def load_image_for_ocr(data: bytes):
    """Decode an image attachment for the OCR adapter, or None.

    ⛔ Bounded before the pixels are decoded (`_open_within_budget`), made
    greyscale, shrunk to `_OCR_LONG_EDGE` on its long side (`thumbnail` works in
    place and never enlarges), and only THEN rotated upright from its EXIF tag,
    in place. The result is always mode "L". A phone photo is usually stored
    sideways with a rotation tag, and an engine handed the raw pixels reads a
    rotated page. Never raises.
    """
    try:
        from PIL import ImageOps
        im = _open_within_budget(data)
        if im is None:
            return None
        im.load()
        # ⛔ GREYSCALE BEFORE THE RESIZE (fix round 2, N-1). The engine reads
        # greyscale anyway (the tesseract adapter converts to "L"), so this
        # changes nothing it sees -- and it is what keeps the resize small: on
        # a colour image Pillow's resize allocates a full-width intermediate
        # and, for RGBA, a premultiplied full-size copy first.
        im = im.convert("L")
        im.thumbnail((_OCR_LONG_EDGE, _OCR_LONG_EDGE))
        ImageOps.exif_transpose(im, in_place=True)
        return im
    except Exception as e:  # noqa: BLE001 — an unreadable image is a no-text image
        log.warning("[doc-extract] image could not be decoded: %s", type(e).__name__)
        return None


def document_source_kind(doc: dict[str, Any] | None) -> str:
    """The row's `source_kind`, defaulting to the pre-wave-L 'attachment'."""
    return ((doc or {}).get("source_kind") or SOURCE_KIND_ATTACHMENT)


# ── Document rows ────────────────────────────────────────────────────────────

def create_document(
    user_id: str, note_id: str, attachment_url: str, name: str | None,
    *, conn=None, source_kind: str = SOURCE_KIND_ATTACHMENT,
) -> dict[str, Any]:
    """Idempotent: UNIQUE(note_id, attachment_url) means re-attaching or
    retrying an upload of the same file returns the existing row rather than
    duplicating it.

    ``source_kind`` is written only when it is not the column's own default,
    so the PDF insert is byte-for-byte the one Wave I shipped."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_note_documents WHERE note_id = ? AND attachment_url = ?",
            (note_id, attachment_url),
        ).fetchone()
        if existing:
            return dict(existing)
        doc_id = uuid.uuid4().hex
        now = _now_iso()
        if source_kind == SOURCE_KIND_ATTACHMENT:
            conn.execute(
                "INSERT INTO j2_note_documents "
                "(id, user_id, note_id, attachment_url, name, status, extraction_version, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (doc_id, user_id, note_id, attachment_url, name, _STATUS_PENDING, EXTRACTION_VERSION, now),
            )
        else:
            conn.execute(
                "INSERT INTO j2_note_documents "
                "(id, user_id, note_id, attachment_url, name, status, extraction_version, created_at,"
                " source_kind) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (doc_id, user_id, note_id, attachment_url, name, _STATUS_PENDING, EXTRACTION_VERSION,
                 now, source_kind),
            )
        conn.commit()
        out = {
            "id": doc_id, "user_id": user_id, "note_id": note_id,
            "attachment_url": attachment_url, "name": name, "status": _STATUS_PENDING,
            "page_count": None, "extraction_version": EXTRACTION_VERSION,
            "created_at": now, "processed_at": None,
        }
        if source_kind != SOURCE_KIND_ATTACHMENT:
            out["source_kind"] = source_kind
        return out
    finally:
        if owned:
            conn.close()


def get_document(user_id: str, document_id: str, *, conn=None) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_documents WHERE id = ? AND user_id = ?",
            (document_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        if owned:
            conn.close()


def get_document_by_attachment(
    user_id: str, note_id: str, attachment_url: str, *, conn=None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_documents WHERE user_id = ? AND note_id = ? AND attachment_url = ?",
            (user_id, note_id, attachment_url),
        ).fetchone()
        return dict(row) if row else None
    finally:
        if owned:
            conn.close()


def list_document_pages(user_id: str, document_id: str, *, conn=None) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT page_number, text, text_origin FROM j2_note_document_pages "
            "WHERE document_id = ? AND user_id = ? ORDER BY page_number",
            (document_id, user_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        if owned:
            conn.close()


def _resolve_pdf_bytes(user_id: str, note_id: str, attachment_url: str) -> bytes | None:
    """Read the ORIGINAL PDF bytes off disk for a stored attachment URL.
    Reuses the ONE URL-shape regex notes_export.py already owns ("keep it
    byte-identical to the f-string that builds it") and notes.py's own
    root-anchored, containment-checked path resolver -- never a second
    parsing/serving implementation."""
    from api.services.journal_two import notes as notes_mod
    from api.services.journal_two.notes_export import _ATTACHMENT_URL_RE

    m = _ATTACHMENT_URL_RE.match(attachment_url)
    if not m:
        return None
    url_user_id, url_note_id, sub, filename = m.groups()
    if url_user_id != user_id or url_note_id != note_id:
        return None  # never resolve across a tenant/note boundary
    path = notes_mod.serve_note_image_path(url_user_id, url_note_id, sub, filename)
    if path is None:
        return None
    try:
        return path.read_bytes()
    except OSError:
        return None


def process_document(document_id: str, *, conn=None) -> dict[str, Any]:
    """Runs extraction synchronously for one document row -- the caller
    (queue_extraction below) is what makes this async relative to the
    upload request. Never raises: every failure path writes an honest
    status and returns normally, so a bad PDF can never take the background
    thread (or, if ever called inline in a test, the caller) down with it."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_documents WHERE id = ?", (document_id,),
        ).fetchone()
        if row is None:
            return {"ok": False, "error": "document not found"}
        doc = dict(row)
        data = _resolve_pdf_bytes(doc["user_id"], doc["note_id"], doc["attachment_url"])
        if data is None:
            conn.execute(
                "UPDATE j2_note_documents SET status = ?, processed_at = ? WHERE id = ?",
                (_STATUS_FAILED, _now_iso(), document_id),
            )
            conn.commit()
            return {"ok": False, "status": _STATUS_FAILED}

        # Wave 7 (G4): the extractor follows the row's kind. An image has no
        # native text at all -- it gets ONE empty page row, exactly the shape a
        # scanned PDF page already has, so OCR planning, the FTS-safe replace,
        # recovery and readiness all apply to it unchanged.
        kind = document_source_kind(doc)
        if kind == SOURCE_KIND_IMAGE:
            result = ([""], 1) if probe_image(data) else None
        elif kind == SOURCE_KIND_DOCX:
            result = extract_docx_pages(data)
        elif kind == SOURCE_KIND_XLSX:
            result = extract_xlsx_pages(data)
        else:
            result = extract_pdf_pages(data)
        if result is None:
            conn.execute(
                "UPDATE j2_note_documents SET status = ?, processed_at = ? WHERE id = ?",
                (_STATUS_FAILED, _now_iso(), document_id),
            )
            conn.commit()
            return {"ok": False, "status": _STATUS_FAILED}

        pages, page_count = result
        has_text = any(p.strip() for p in pages)
        status = _STATUS_READY if has_text else _STATUS_NO_TEXT
        for i, text in enumerate(pages, start=1):
            conn.execute(
                "INSERT OR IGNORE INTO j2_note_document_pages "
                "(document_id, user_id, page_number, text, text_origin) VALUES (?, ?, ?, ?, 'native')",
                (document_id, doc["user_id"], i, text),
            )
        conn.execute(
            "UPDATE j2_note_documents SET status = ?, page_count = ?, processed_at = ? WHERE id = ?",
            (status, page_count, _now_iso(), document_id),
        )
        conn.commit()
        return {"ok": True, "status": status, "page_count": page_count}
    finally:
        if owned:
            conn.close()


def _process_document_bounded(document_id: str) -> None:
    """The background job: runs process_document with its own connection (a
    background thread must never share the request's). It runs on an
    `_EXTRACTION_POOL` worker, which already holds one of the semaphore's
    permits -- so at most `_MAX_CONCURRENT_EXTRACTIONS` run at once, and it
    must NOT take the semaphore again (that would deadlock the pool)."""
    try:
        process_document(document_id)
    except Exception as e:  # noqa: BLE001 — a background thread must never propagate
        log.warning("[doc-extract] background extraction crashed for %s: %s", document_id, e)
        return
    # ⭐ WAVE P1: classify the pages extraction could not read.
    #
    # ⛔ SEPARATE PASS, NOT A BRANCH INSIDE `process_document`. Extraction
    # answers "what text does this PDF carry"; classification answers "which
    # pages is OCR responsible for". Keeping them apart is what makes
    # classification re-runnable on its own, which is what restart recovery
    # needs — and it means a change to one cannot silently alter the other.
    #
    # ⛔ AND IT PROMISES NOTHING WHEN NO ENGINE IS WIRED. `plan_document`
    # asks `ocr_available()` before claiming a page, so with no adapter the
    # document keeps its honest `no_text` rather than sitting on
    # "Processing..." forever.
    try:
        from api.services.journal_two import document_ocr
        plan = document_ocr.plan_document(document_id)
        if plan.get("ocr_required"):
            document_ocr.queue_ocr(document_id, document_ocr.get_adapter())
    except Exception as e:  # noqa: BLE001 — classification must never
        # cost the extraction that already succeeded.
        log.warning("[doc-extract] OCR planning failed for %s: %s",
                    document_id, e)


def queue_extraction(document_id: str) -> None:
    """Fire-and-forget: queues the document on `_EXTRACTION_POOL` and returns.

    ⛔ BOUNDED IN THREADS, NOT ONLY IN CONCURRENCY. A worker thread exists only
    while it holds one of `_EXTRACTION_SEMAPHORE`'s permits, so at most
    `_MAX_CONCURRENT_EXTRACTIONS` threads exist however many documents arrive;
    the rest wait as ids in the pool's queue. ⚰️ This used to start one daemon
    thread per document that then parked on the semaphore -- unbounded, and
    email-in can hand over 20 attachments per message."""
    _EXTRACTION_POOL.submit(_process_document_bounded, document_id)


# ── Seam S1 (wave 7) ─────────────────────────────────────────────────────────

def on_attachment_saved(
    user_id: str,
    note_id: str,
    att: dict[str, Any],
    content_type: str | None,
    *,
    kind: str = "file",
) -> dict[str, Any] | None:
    """The ONE place that decides whether a freshly saved attachment becomes
    a searchable document. Called by BOTH upload routes in
    api/routers/journal_two.py (``kind="image"`` from /images, ``kind="file"``
    from /attachments) AFTER the bytes are on disk, so a failure here can
    never make the upload look broken (callers do not await anything of it
    beyond the synchronous row insert).

    A PDF file gets a pending document row + async extraction (the Wave I
    behaviour, unchanged, and NOT behind the wave-7 gate). Under
    `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` (read here, per call) two more
    kinds become documents: an inline image (OCR through the existing
    tesseract adapter, honouring `J2_OCR_ENABLED` exactly as a scanned PDF
    page does -- no engine means the row lands `no_text`, never an error) and
    a .docx file (stdlib text extraction) -- and, since wave 10 (G-160), a
    .xlsx file (stdlib, cell text; `extract_xlsx_pages`). Everything else
    returns None.

    ``att`` is the dict the save function returned: ``{url, name, size}`` for
    a file, ``{url, width, height}`` for an image (no ``name`` key).

    ⛔ THE URL MUST SAY WHAT THE ROW IS. The document preview decides its
    viewer from the attachment URL alone (its mounts pass no kind), so a docx
    row is created only when the saved URL really ends in `.docx` -- a docx
    uploaded under another filename stays a plain attachment rather than
    becoming a row the preview would open in the wrong viewer. Images are
    always `/inline/<hash>.<png|jpg|gif|webp>`: the extension is derived from
    the validated content type by `save_note_image_bytes`.
    """
    if kind == "file" and content_type == "application/pdf":
        doc = create_document(user_id, note_id, att["url"], att.get("name"))
        queue_extraction(doc["id"])
        return doc
    if not image_docx_documents_enabled():
        return None
    url = att.get("url") or ""
    if kind == "image":
        from api.services.journal_two.notes import _ALLOWED_IMAGE_MIMES
        if content_type not in _ALLOWED_IMAGE_MIMES or "/inline/" not in url:
            return None
        doc = create_document(user_id, note_id, url, _IMAGE_DOC_NAME,
                              source_kind=SOURCE_KIND_IMAGE)
        queue_extraction(doc["id"])
        return doc
    if kind == "file" and content_type == DOCX_MIME and url.lower().endswith(".docx"):
        doc = create_document(user_id, note_id, url, att.get("name"),
                              source_kind=SOURCE_KIND_DOCX)
        queue_extraction(doc["id"])
        return doc
    # Wave 10 (G-160, R-4): a spreadsheet, under the SAME gate and the same
    # rule -- the saved URL must really end in `.xlsx`, so the preview (which
    # decides its viewer from the URL, documentKind.js) opens it as text.
    if kind == "file" and content_type == XLSX_MIME and url.lower().endswith(".xlsx"):
        doc = create_document(user_id, note_id, url, att.get("name"),
                              source_kind=SOURCE_KIND_XLSX)
        queue_extraction(doc["id"])
        return doc
    return None
