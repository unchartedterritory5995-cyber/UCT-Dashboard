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
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

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


# ── Document rows ────────────────────────────────────────────────────────────

def create_document(
    user_id: str, note_id: str, attachment_url: str, name: str | None,
    *, conn=None,
) -> dict[str, Any]:
    """Idempotent: UNIQUE(note_id, attachment_url) means re-attaching or
    retrying an upload of the same file returns the existing row rather than
    duplicating it."""
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
        conn.execute(
            "INSERT INTO j2_note_documents "
            "(id, user_id, note_id, attachment_url, name, status, extraction_version, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (doc_id, user_id, note_id, attachment_url, name, _STATUS_PENDING, EXTRACTION_VERSION, now),
        )
        conn.commit()
        return {
            "id": doc_id, "user_id": user_id, "note_id": note_id,
            "attachment_url": attachment_url, "name": name, "status": _STATUS_PENDING,
            "page_count": None, "extraction_version": EXTRACTION_VERSION,
            "created_at": now, "processed_at": None,
        }
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
