"""Notebook export formats -- HTML, JSON and Word beside the Markdown zip (wave 8, lane 8C).

Mounted by seam S8-2 under `/api/j2/export`. Two routes:

  * `GET /api/j2/export/notebook?format=md|html|json|docx` -- every active note, as one
    zip, built to a TEMP FILE and streamed back on the existing export slot. The shape of
    `journal_two.export_notes` (the Markdown route this sits beside), copied deliberately:
    `acquire_export_slot()` first, the same 429 sentence when it is taken, the slot released
    on every path (the stream's own `finally` on success, the except below when the build
    raises before a response exists, the lease's TTL when a client disconnects).
  * `GET /api/j2/export/notes/{note_id}?format=...` -- one note, built in memory and
    bounded by one note (`notes_export.build_single_note_export`). Word is always one
    `.docx`; HTML and JSON are a bare file when the note has no attachments and a zip when
    it has some; Markdown is byte-for-byte what `GET /api/j2/notes/{id}/export` gives today.
    ⛔ Bounded in CONCURRENCY too (wave-8 final review I-2): "bounded by one note" is a
    bound per build, not per pod -- the formats ship ungated (D-C5), so every signed-in
    member reaches this door, and a Word build decodes images and holds its embedded
    blobs (up to the export byte cap) in memory until the document is zipped. At most
    `SINGLE_NOTE_CONCURRENCY` builds run at once on this pod (a DEDICATED, non-blocking
    semaphore, so a multi-minute whole-notebook export never blocks a one-note download);
    one more is refused with the export slot's own 429 sentence.

The rules, each a decision:
  * ⛔ The existing Markdown routes in `journal_two.py` stay byte-identical and untouched;
    these routes are ADDITIONAL doors to the same builders, never a second Markdown writer.
  * No gate (ruling D-C5): the formats are additive reads of the member's own data.
  * An unknown `format` is a 422 with a sentence, decided BEFORE the export slot is taken
    (a refused request must never cost another member the slot).
  * A foreign, missing or trashed note is 404 -- the same answer, never distinguished.
  * Auth is `get_current_user`, the same as every export route.
  * Selected-notes export stays Markdown in wave 8 (ruling D-C8); it has no route here.
  * The prefix is outside `/api/j2/notes/...`, so mount order against `journal_two` does
    not matter (`tests/test_main_router_order.py`).
"""
from __future__ import annotations

import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from api.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/j2/export", tags=["journal-2-0", "notebook-export"])

BUSY_SENTENCE = "An export is already running. Please wait a moment and try again."

#: One-note builds allowed at once on this pod (I-2). ⚠️ PER-PROCESS STATE: a second web
#: process would double it, like the whole-notebook export slot beside it.
SINGLE_NOTE_CONCURRENCY = 2
_SINGLE_NOTE_SLOTS = threading.BoundedSemaphore(SINGLE_NOTE_CONCURRENCY)


def _format_or_422(raw: Optional[str]) -> str:
    from api.services.journal_two.notes_export_formats import UNKNOWN_FORMAT_SENTENCE, normalize_format

    fmt = normalize_format(raw)
    if fmt is None:
        raise HTTPException(status_code=422, detail=UNKNOWN_FORMAT_SENTENCE)
    return fmt


@router.get("/notebook")
def export_notebook(
    format: Optional[str] = Query(default=None),  # noqa: A002 -- the public query name
    user: dict = Depends(get_current_user),
) -> StreamingResponse:
    """Every active note in `format`, as one zip streamed from a temp file."""
    # `content_disposition` has ONE definition, beside the single-note Markdown route's
    # builder: this router carried a second copy of it until the wave-8 whole-branch pass.
    from api.services.journal_two.notes_export import (
        acquire_export_slot, build_export_zip_to_tempfile, content_disposition,
        release_export_slot, stream_export_file,
    )

    fmt = _format_or_422(format)
    if not acquire_export_slot():
        raise HTTPException(status_code=429, detail=BUSY_SENTENCE)
    try:
        tmp_path, filename = build_export_zip_to_tempfile(user["id"], fmt=fmt)
    except Exception:
        release_export_slot()
        raise
    return StreamingResponse(
        stream_export_file(tmp_path),
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition(filename)},
    )


@router.get("/notes/{note_id}")
def export_one_note(
    note_id: str,
    format: Optional[str] = Query(default=None),  # noqa: A002 -- the public query name
    user: dict = Depends(get_current_user),
) -> Response:
    """ONE note in `format`: bounded by one note, so built in memory -- and at most
    `SINGLE_NOTE_CONCURRENCY` at once (I-2): one more answers 429 with the export slot's own
    sentence. The format is decided BEFORE a slot is taken; the slot is given back on every
    path, the build is synchronous, so no disconnect can strand it."""
    from api.services.journal_two.notes_export import build_single_note_export, content_disposition

    fmt = _format_or_422(format)
    if not _SINGLE_NOTE_SLOTS.acquire(blocking=False):
        raise HTTPException(status_code=429, detail=BUSY_SENTENCE)
    try:
        built = build_single_note_export(user["id"], note_id, fmt=fmt)
    finally:
        _SINGLE_NOTE_SLOTS.release()
    if built is None:
        raise HTTPException(status_code=404, detail="Not found")
    content, filename, media_type = built
    return Response(
        content=content, media_type=media_type,
        headers={"Content-Disposition": content_disposition(filename)},
    )
