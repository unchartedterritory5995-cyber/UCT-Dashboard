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
# ⛔ An image OCR reads is decoded into memory in full. The upload cap is 5 MB of
# COMPRESSED bytes, which a crafted PNG can turn into a bitmap of hundreds of
# megapixels. Refuse anything past this rather than rely on Pillow's own
# decompression-bomb warning threshold (~89 MP), which only WARNS.
_MAX_IMAGE_PIXELS = 50_000_000
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


def _docx_paragraphs(xml: bytes) -> list[str]:
    """Paragraph text of word/document.xml, in document order.

    `w:p` is a paragraph (joined by newlines by the caller), `w:t` runs are
    concatenated, `w:tab` is a tab, `w:br`/`w:cr` a newline. Only `w:t` carries
    text: `w:delText` (tracked deletions) and `w:instrText` (field codes) are
    NOT the words on the page and are skipped by construction.

    ⛔ STREAMING, NOT RECURSIVE. `iterparse` with a stack of open paragraphs
    handles a paragraph nested inside a text box without recursing, so a
    pathologically deep document cannot exhaust the interpreter stack.
    """
    from xml.etree import ElementTree

    out: list[str] = []
    stack: list[list[str]] = []
    for event, el in ElementTree.iterparse(BytesIO(xml), events=("start", "end")):
        tag = el.tag
        if event == "start":
            if tag == _W + "p":
                stack.append([])
            elif stack and tag == _W + "tab":
                stack[-1].append("\t")
            elif stack and tag in (_W + "br", _W + "cr"):
                stack[-1].append("\n")
            continue
        if tag == _W + "t":
            if stack and el.text:
                stack[-1].append(el.text)
        elif tag == _W + "p" and stack:
            out.append("".join(stack.pop()))
            el.clear()
    return out


def _chunk_pages(paragraphs: list[str], size: int = _DOCX_PAGE_CHARS) -> list[str]:
    """Pack paragraphs into reading pages of about `size` characters. A page
    breaks BETWEEN paragraphs; only a single paragraph longer than a whole page
    is split, and then at the last whitespace before the limit where one
    exists, so a word is never cut in half when it need not be."""
    pages: list[str] = []
    cur = ""
    for para in paragraphs:
        while len(para) > size:
            cut = para.rfind(" ", 0, size)
            if cut <= 0:
                cut = size
            head, para = para[:cut].rstrip(), para[cut:].lstrip()
            if cur:
                pages.append(cur)
                cur = ""
            pages.append(head)
        if not cur:
            cur = para
        elif len(cur) + 1 + len(para) <= size:
            cur = f"{cur}\n{para}"
        else:
            pages.append(cur)
            cur = para
    if cur or not pages:
        pages.append(cur)
    return pages


def extract_docx_pages(data: bytes) -> tuple[list[str], int] | None:
    """Text of a .docx as reading pages, stdlib only (`zipfile` +
    `xml.etree`). Returns (pages, page_count) or None when the file is not a
    readable docx. Never raises, same contract as `extract_pdf_pages`.

    ⛔ BOUNDED. word/document.xml is read through a size-limited read, so an
    archive that LIES about its inflated size still cannot hand us more than
    `_DOCX_MAX_XML_BYTES`; past that the whole document is refused. Text pages
    past `_MAX_PAGES` are not stored (page_count still reports the real count,
    exactly as it does for a long PDF).

    ⛔ NO DOCTYPE. A real Word document never carries one, and refusing it is
    the cheap, total answer to entity-expansion tricks that no parser setting
    has to be trusted for.
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
        head = xml[:4096].upper()
        if b"<!DOCTYPE" in head or b"<!ENTITY" in xml.upper():
            log.warning("[doc-extract] docx refused: document.xml carries a DOCTYPE/ENTITY")
            return None
        paragraphs = _docx_paragraphs(xml)
    except Exception as e:  # noqa: BLE001 — a malformed docx fails locally, never the thread
        log.warning("[doc-extract] docx extraction failed: %s", type(e).__name__)
        return None
    text_pages = _chunk_pages([p.replace("\x00", "") for p in paragraphs])
    page_count = len(text_pages)
    pages = [_normalize_docx_text(p) for p in text_pages[:_MAX_PAGES]]
    return pages, page_count


# ── Images (read for OCR, never stored as text here) ─────────────────────────

def load_image_for_ocr(data: bytes):
    """Decode an image attachment for the OCR adapter, or None.

    ⛔ Orientation comes from EXIF first: a phone photo is usually stored
    sideways with a rotation tag, and an engine handed the raw pixels reads a
    rotated page. ⛔ Bounded by `_MAX_IMAGE_PIXELS` before the pixels are
    decoded, so a small file cannot become an enormous bitmap. Never raises.
    """
    try:
        from PIL import Image, ImageOps
        im = Image.open(BytesIO(data))
        w, h = im.size
        if w <= 0 or h <= 0 or w * h > _MAX_IMAGE_PIXELS:
            log.warning("[doc-extract] image refused: %sx%s is past the pixel cap", w, h)
            return None
        im.load()
        return ImageOps.exif_transpose(im)
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
            result = ([""], 1) if load_image_for_ocr(data) is not None else None
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
    """The actual background-thread target: acquires the concurrency
    semaphore first so at most _MAX_CONCURRENT_EXTRACTIONS run at once
    across the whole process, then runs process_document with its own
    connection (a background thread must never share the request's)."""
    with _EXTRACTION_SEMAPHORE:
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
    """Fire-and-forget: spawns a daemon thread, same idiom as
    j2_attachments_backup/excursion_jobs' own admin-triggered background
    work (api/routers/journal_two.py) -- the ONLY difference here is this
    one fires automatically right after a PDF attachment upload, not from
    an admin action."""
    threading.Thread(
        target=_process_document_bounded,
        args=(document_id,),
        daemon=True,
        name="j2-doc-extract",
    ).start()


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
