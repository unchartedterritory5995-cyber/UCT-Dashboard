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

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

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
        for i, page in enumerate(reader.pages):
            if i >= _MAX_PAGES:
                break
            try:
                pages.append(_normalize_page_text(page.extract_text() or ""))
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
    """
    from xml.parsers import expat

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

    def refuse_doctype(*_args):
        raise _DocxRefused("DOCTYPE")

    parser = expat.ParserCreate(namespace_separator=" ")
    parser.buffer_text = True
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = chars
    parser.StartDoctypeDeclHandler = refuse_doctype
    parser.Parse(xml, True)
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
    a .docx file (stdlib text extraction). Everything else returns None.

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
    return None
