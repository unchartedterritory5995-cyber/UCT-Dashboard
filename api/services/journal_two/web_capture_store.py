"""Wave L Slice 1 — the capture write path.

⛔ WHAT EACH ROW MEANS. Reusing Wave J's storage is only correct if it preserves
semantics, so these are stated once, here, and railed:

    DOCUMENT  identity + provenance of ONE external source, scoped to (user,
              note). Carries `capture_type` so every downstream consumer can
              tell what is actually held. `page_count` is the number of
              PASSAGES captured — never a claim about the article's length.

    PAGE      ONE captured passage. `page_number` is CAPTURE ORDER, not a
              position in the article, and `text_origin='web_passage'` says so.
              ⛔ A page is NOT a representation of the external page. Nothing
              here ever means "UCT read the article".

    EXCERPT   the member's citable object for that passage: the exact text they
              selected (`captured_text`) plus their own words about it
              (`annotation`), which Wave J already keeps in separate columns.

⭐ THE ONE DUPLICATION, AND WHY IT IS REQUIRED. The passage is stored twice: as
page text and as `excerpt.captured_text`. Wave J's excerpt anchors INTO page text
(quote prefix/suffix + char offsets) and the document FTS index reads page text —
so an excerpt with no page text is uncitable AND unsearchable. The page copy is
canonical for SEARCH; the excerpt copy is canonical for CITATION.

Drift is prevented structurally, not by discipline: both copies are written in
ONE transaction from ONE sanitized value, and neither has an update path — Wave J
writes page text once ("never a partial row updated in place") and exposes only
`update_excerpt_annotation`, which touches the member's words, never the source's.

⛔ ENTITY ASSOCIATION IS NEVER INFERRED FROM PROSE. This module does not look at
captured text for ticker-shaped tokens and never resolves a symbol outbound —
the Wave K privacy defect in full. Membership comes from the destination note,
through Wave H's existing union. There is no `web_capture_tickers` table and
must not be one.
"""
from __future__ import annotations

import re
import sqlite3
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import note_excerpts, web_capture as wc

# ── Canonical capture vocabulary (Wave L §1) ─────────────────────────────────

CAPTURE_PDF_FULL_TEXT = "pdf_full_text"
CAPTURE_WEB_REFERENCE = "web_reference"
CAPTURE_WEB_PASSAGE = "web_passage"

CAPTURE_TYPES = frozenset({CAPTURE_PDF_FULL_TEXT, CAPTURE_WEB_REFERENCE, CAPTURE_WEB_PASSAGE})

#: What a retrieval consumer may claim about a document's coverage.
COVERAGE_COMPLETE = "document_complete"
COVERAGE_PASSAGE_ONLY = "selected_passage_only"
COVERAGE_METADATA_ONLY = "metadata_only"

TEXT_ORIGIN_WEB_PASSAGE = "web_passage"

_STATUS_READY = "ready"


class CaptureStoreError(RuntimeError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Coverage (Wave L §11) ────────────────────────────────────────────────────

def capture_coverage(document_row: Any) -> str:
    """What a reader is entitled to claim about this document.

    ⛔ The whole point: a `web_passage` document must never report
    `document_complete`. Ask may answer FROM the passage; it may never imply it
    searched the article.
    """
    ctype = _get(document_row, "capture_type") or CAPTURE_PDF_FULL_TEXT
    if ctype == CAPTURE_WEB_PASSAGE:
        return COVERAGE_PASSAGE_ONLY
    if ctype == CAPTURE_WEB_REFERENCE:
        return COVERAGE_METADATA_ONLY
    return COVERAGE_COMPLETE


def _get(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return None


# ── Passage dedupe normalization (Wave L §3) ─────────────────────────────────

_WS = re.compile(r"\s+")


def passage_fingerprint(text: str) -> str:
    """The explicit normalization used to decide "the same passage again".

    NFC, then every whitespace run collapsed to a single space, then stripped.
    **Case is PRESERVED** — a quote's capitalisation is part of the quote, and
    two passages differing only in case are two different quotations of the
    source, not one.
    """
    return _WS.sub(" ", unicodedata.normalize("NFC", text or "")).strip()


# ── The write path ───────────────────────────────────────────────────────────

def capture_web_source(
    user_id: str, note_id: str, payload: dict[str, Any],
    *, conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Store one capture. ONE transaction, or nothing (Wave L §5).

    Returns `{document, page_number, excerpt, deduped}`. `deduped` is True when
    the identical passage was already captured from this source into this note —
    the second capture is then a no-op that returns the first one's rows, so a
    double-click never produces two copies of one quote.
    """
    capture = wc.build_capture(payload)          # rights + provenance gate first
    owned = conn is None
    conn = conn or get_connection()
    try:
        # ⛔ TENANT ISOLATION BEFORE ANY LOOKUP OR REUSE (Wave L §6). Every read
        # below is scoped by user_id, so a matching web:<sha256> owned by
        # someone else cannot cause row reuse, metadata exposure, cross-tenant
        # dedupe, or even confirm that their capture exists.
        owner = conn.execute(
            "SELECT 1 FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (note_id, user_id),
        ).fetchone()
        if not owner:
            raise CaptureStoreError("destination note not found")

        identity = capture["identity"]
        ctype = CAPTURE_WEB_PASSAGE if capture["tier"] == wc.TIER_PASSAGE else CAPTURE_WEB_REFERENCE

        conn.execute("BEGIN")
        doc = conn.execute(
            "SELECT * FROM j2_note_documents"
            " WHERE user_id = ? AND note_id = ? AND attachment_url = ?",
            (user_id, note_id, identity),
        ).fetchone()

        if doc is None:
            doc_id = uuid.uuid4().hex
            # ⛔ `UNIQUE(note_id, attachment_url)` is NOT user-scoped, while the
            # lookup above deliberately IS. Those two facts meet in exactly one
            # place: a row that matches (note_id, identity) but belongs to
            # somebody else. The tenant guard correctly refuses to reuse it —
            # and then this INSERT collides. Surfacing that as a raw
            # sqlite3.IntegrityError would be a database error leaking to a
            # member; refusing cleanly is the honest answer, and it still never
            # reuses or reveals the other row. Found by a mutation check that
            # proved the earlier tenant rail could not see this path at all.
            conn.execute(
                "INSERT INTO j2_note_documents"
                " (id, user_id, note_id, attachment_url, name, status, page_count,"
                "  extraction_version, created_at, processed_at, source_kind, source_url,"
                "  capture_type)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (doc_id, user_id, note_id, identity, capture["title"], _STATUS_READY, 0,
                 1, capture["captured_at"], capture["captured_at"],
                 wc.SOURCE_KIND_WEB, capture["source_url"], ctype),
            )
            page_count = 0
        else:
            doc_id = doc["id"]
            page_count = int(doc["page_count"] or 0)
            # A source first captured as a reference and later quoted becomes a
            # passage capture. It never goes back: holding a passage is a
            # strictly larger claim than holding only metadata.
            if ctype == CAPTURE_WEB_PASSAGE and _get(doc, "capture_type") != CAPTURE_WEB_PASSAGE:
                conn.execute(
                    "UPDATE j2_note_documents SET capture_type = ? WHERE id = ? AND user_id = ?",
                    (CAPTURE_WEB_PASSAGE, doc_id, user_id),
                )

        if capture["tier"] == wc.TIER_REFERENCE:
            conn.commit()
            return {"document": _doc(conn, user_id, doc_id), "page_number": None,
                    "excerpt": None, "deduped": False}

        # ── the passage ──────────────────────────────────────────────────────
        fp = passage_fingerprint(capture["passage"])
        for row in conn.execute(
            "SELECT page_number, text FROM j2_note_document_pages"
            " WHERE document_id = ? AND user_id = ?", (doc_id, user_id),
        ).fetchall():
            if passage_fingerprint(row["text"]) == fp:
                existing = conn.execute(
                    "SELECT * FROM j2_note_excerpts WHERE document_id = ? AND user_id = ?"
                    " AND page_number = ?", (doc_id, user_id, row["page_number"]),
                ).fetchone()
                conn.commit()
                return {"document": _doc(conn, user_id, doc_id),
                        "page_number": row["page_number"],
                        "excerpt": dict(existing) if existing else None,
                        "deduped": True}

        page_number = page_count + 1
        conn.execute(
            "INSERT INTO j2_note_document_pages"
            " (document_id, user_id, page_number, text, text_origin) VALUES (?,?,?,?,?)",
            (doc_id, user_id, page_number, capture["passage"], TEXT_ORIGIN_WEB_PASSAGE),
        )
        conn.execute(
            "UPDATE j2_note_documents SET page_count = ?, capture_type = ? WHERE id = ? AND user_id = ?",
            (page_number, CAPTURE_WEB_PASSAGE, doc_id, user_id),
        )
        excerpt = note_excerpts.create_excerpt(
            user_id, note_id, document_id=doc_id, page_number=page_number,
            captured_text=capture["passage"],
            char_start=0, char_end=len(capture["passage"]),
            # ⭐ The member's interpretation goes in the column Wave J already
            # reserved for it. It is NEVER concatenated into captured_text —
            # that is the source's claim, and Ask/Thesis must always be able to
            # tell which sentence came from whom.
            annotation=capture["annotation"] or None,
            conn=conn,
        )
        conn.commit()
        return {"document": _doc(conn, user_id, doc_id), "page_number": page_number,
                "excerpt": excerpt, "deduped": False}
    except sqlite3.IntegrityError as e:
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        raise CaptureStoreError("this source cannot be captured into that note") from e
    except Exception:
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 — a failed rollback must not mask the cause
            pass
        raise
    finally:
        if owned:
            conn.close()


def _doc(conn: sqlite3.Connection, user_id: str, doc_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM j2_note_documents WHERE id = ? AND user_id = ?", (doc_id, user_id),
    ).fetchone()
    if row is None:
        raise CaptureStoreError("document vanished mid-write")
    d = dict(row)
    d["coverage"] = capture_coverage(d)
    return d
