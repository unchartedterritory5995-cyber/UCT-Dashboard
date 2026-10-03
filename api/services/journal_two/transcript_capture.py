"""Wave 13 lane 13G-1 -- a call-transcript passage saved into a note as a citable excerpt.

⭐ NO NEW PIPELINE. A transcript passage becomes the SAME objects a PDF or web passage
becomes (Wave J / Wave L, gap rows G-116 to G-120):

    DOCUMENT  one per (note, symbol, fiscal quarter): `j2_note_documents`, identity
              `transcript:fmp:<SYM>:<YYYY>Q<q>` in `attachment_url` (an IDENTITY, never a
              file -- the attachments regex cannot match it, so no PDF path ever reads it),
              named with its source and its call date. Stored ONCE per note.
    PAGE      one per SPEAKER TURN the member quoted from: `page_number` IS the turn's
              position in the call (1-based, the calendar panel's `data-segment` + 1), and
              the page text is that turn, in the transcript's own "Speaker: words" form, so
              the speaker is kept. Only turns the member quoted are stored -- never the call.
    EXCERPT   `note_excerpts.create_excerpt`: the exact source characters, a 200-character
              quote anchor on both sides, char offsets into the turn. Placed in the note by
              `notes.append_document_excerpt`, the existing "Save excerpt" server half.

So the citation, the captured-passage sheet, search's Evidence section, thesis evidence
(`document_excerpt`, attachable FOR or AGAINST through the existing picker) and the account
purge cascade are all inherited, unchanged.

⛔ CAPTURE KIND. The document is written with `source_kind='web'` and
`capture_type='web_passage'`: the two columns every consumer already reads to mean "a
captured outside source of which we hold only the passages", never a paginated file. That
keeps a transcript out of the PDF viewer and keeps Ask's coverage at `selected_passage_only`
-- the truth, since we hold quoted turns, not the call. `source_url` is NULL: there is no
public page to send a member to, and the sheet says nothing rather than something invented.

⛔⛔ READ ONLY FROM WHAT UCT ALREADY HOLDS. Two places, both FMP text:
  * the FMP transcript cache (`fmp_transcripts.cache`, key `fmp_transcript_<SYM>_<Y>_<Q>`),
    filled when the calendar's transcript panel opens a call; and
  * the cross-company transcript index (`transcript_index.db`, table `transcripts` +
    `transcript_fts`), the stored FMP content with its call date.
Nothing here fetches. Never AlphaVantage (`av_transcripts` and `alphavantage_client` run on a
25-a-day budget held in process memory -- `alphavantage_client.py`), never the transcript
route's AlphaVantage fallback (`earnings_intel.py`), never `fmp_transcripts.get_transcript`
(which fetches on a miss). A quarter UCT does not hold refuses honestly. Rails:
`tests/test_notebook_transcript_capture.py` (an AST import-graph walk with a control, and a
runtime trap on every AlphaVantage door and on the FMP fetch).

⛔ THE QUOTE IS RE-VERIFIED against the held transcript at save time: the passage must be on
the turn it names (whitespace forgiven, nothing else), and what is stored is the SOURCE's own
characters, never the client's copy of them.

Zero model calls.
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
import uuid
from typing import Any

from api.services.notebook_flags import flag_on

_log = logging.getLogger(__name__)

FLAG = "NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED"

#: Names the provider in the document title. Both held copies are FMP's text.
SOURCE_LABEL = "FMP transcript"
IDENTITY_PREFIX = "transcript:fmp:"

#: A turn is stored whole (it is the page). A CEO's prepared remarks run to ~15k
#: characters; this bound only stops a pathological row from filling auth.db.
MAX_TURN_CHARS = 60_000
#: The quote anchor window, the same 200 characters Wave J keeps on each side.
QUOTE_CONTEXT_CHARS = 200

_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")


class TranscriptCaptureError(ValueError):
    """A refusal with the HTTP status the router answers and the sentence a member reads."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse."""
    return flag_on(FLAG, False)


def clean_symbol(raw: Any) -> str:
    sym = str(raw or "").strip().upper().lstrip("$")
    if not _SYMBOL_RE.match(sym):
        raise TranscriptCaptureError("That is not a ticker symbol.")
    return sym


def parse_quarter(raw: Any) -> tuple[int, int]:
    """'2026Q2' -> (2026, 2), through the transcript service's own parse."""
    from api.services.fmp_transcripts import _parse_quarter
    year, q = _parse_quarter(str(raw or ""))
    if year is None or q is None:
        raise TranscriptCaptureError("That is not a quarter (expected e.g. 2026Q2).")
    return year, q


def quarter_label(year: int, q: int) -> str:
    return f"{year}Q{q}"


# ── the two held copies ──────────────────────────────────────────────────────

def cache_key(sym: str, year: int, q: int) -> str:
    """The FMP transcript cache key. ⛔ It must be the key `fmp_transcripts.get_transcript`
    writes -- `test_the_cache_key_is_the_one_the_fmp_service_writes` proves it by filling the
    cache THROUGH that function and reading it back through this module."""
    return f"fmp_transcript_{sym}_{year}_{q}"


def _cache():
    from api.services import fmp_transcripts
    return fmp_transcripts.cache


def _cached(sym: str, year: int, q: int) -> dict | None:
    hit = _cache().get(cache_key(sym, year, q))
    if not isinstance(hit, dict) or hit.get("_miss"):
        return None
    segs = hit.get("segments")
    return hit if isinstance(segs, list) and segs else None


def _index_path() -> str:
    from api.services import transcript_index
    return transcript_index.DB_PATH


def _index_rows(sql: str, args: tuple) -> list[sqlite3.Row]:
    """A READ-ONLY query of the stored transcript index. A pod (or sandbox) that never built
    the index holds nothing, and this must never create the file to find that out."""
    path = _index_path()
    if not path or not os.path.exists(path):
        return []
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
    except sqlite3.Error:
        return []
    try:
        c.row_factory = sqlite3.Row
        return c.execute(sql, args).fetchall()
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            return []
        raise
    finally:
        c.close()


def _stored(sym: str, year: int, q: int) -> tuple[str | None, str | None]:
    """(content, call_date) from the stored index; (None, date-or-None) when absent."""
    meta = _index_rows(
        "SELECT call_date FROM transcripts WHERE symbol = ? AND fiscal_year = ? AND quarter = ?",
        (sym, year, q))
    call_date = (meta[0]["call_date"] or None) if meta else None
    rows = _index_rows(
        "SELECT content FROM transcript_fts WHERE symbol = ? AND fiscal_year = ? AND quarter = ?",
        (sym, year, q))
    content = rows[0]["content"] if rows else None
    return (content or None), call_date


def quarters(symbol: str) -> list[dict[str, Any]]:
    """Every quarter of `symbol` UCT already holds, newest first. Reads only."""
    sym = clean_symbol(symbol)
    found: dict[tuple[int, int], dict[str, Any]] = {}
    prefix = f"fmp_transcript_{sym}_"
    for key in _cache().keys_with_prefix(prefix):
        m = re.fullmatch(r"(\d{4})_([1-4])", key[len(prefix):])
        if not m:
            continue            # e.g. the quarter-list key, or another ticker sharing a prefix
        y, q = int(m.group(1)), int(m.group(2))
        if _cached(sym, y, q) is not None:
            found[(y, q)] = {"quarter": quarter_label(y, q), "year": y, "q": q,
                             "callDate": None, "held": "cache"}
    for r in _index_rows(
            "SELECT fiscal_year, quarter, call_date FROM transcripts WHERE symbol = ?", (sym,)):
        y, q = int(r["fiscal_year"]), int(r["quarter"])
        row = found.setdefault((y, q), {"quarter": quarter_label(y, q), "year": y, "q": q,
                                         "callDate": None, "held": "store"})
        row["callDate"] = row["callDate"] or (r["call_date"] or None)
    return [found[k] for k in sorted(found, reverse=True)]


def _turn_text(seg: dict) -> str:
    from api.services.journal_two.web_capture import sanitize_text
    speaker = sanitize_text(seg.get("speaker"), limit=200)
    content = str(seg.get("content") or "")
    return sanitize_text(f"{speaker}: {content}" if speaker else content, limit=MAX_TURN_CHARS)


def read_transcript(symbol: str, quarter: str) -> dict[str, Any] | None:
    """The held transcript of one quarter as numbered turns, or None when UCT holds none.

    The cache is read first; the stored index is segmented by the SAME function the FMP
    service uses (`fmp_transcripts._segment`), so a turn's number is the calendar panel's.
    """
    sym = clean_symbol(symbol)
    year, q = parse_quarter(quarter)
    held = "cache"
    payload = _cached(sym, year, q)
    content, call_date = _stored(sym, year, q)
    if payload is not None:
        segments = payload.get("segments") or []
    elif content:
        from api.services.fmp_transcripts import _segment
        segments = _segment(content)
        held = "store"
    else:
        return None
    from api.services.journal_two.web_capture import sanitize_text
    turns = []
    for i, seg in enumerate(segments):
        if not isinstance(seg, dict):
            continue
        text = _turn_text(seg)
        if not text:
            continue
        turns.append({"turn": i + 1,
                      "speaker": sanitize_text(seg.get("speaker"), limit=200) or None,
                      "text": text})
    if not turns:
        return None
    return {"symbol": sym, "quarter": quarter_label(year, q), "year": year, "q": q,
            "callDate": call_date, "held": held, "source": SOURCE_LABEL, "turns": turns}


# ── locating the quote ───────────────────────────────────────────────────────

def locate(passage: str, page_text: str) -> tuple[int, int] | None:
    """(start, end) of `passage` inside `page_text`, forgiving whitespace ONLY -- the same
    rule as the OCR quote check (`note_excerpts._normalise_for_match`): no case folding, no
    punctuation stripping, never two different sentences made equal."""
    words = (passage or "").split()
    if not words or not page_text:
        return None
    rx = re.compile(r"\s+".join(re.escape(w) for w in words))
    m = rx.search(page_text)
    return (m.start(), m.end()) if m else None


def document_identity(sym: str, year: int, q: int) -> str:
    return f"{IDENTITY_PREFIX}{sym}:{quarter_label(year, q)}"


def document_name(sym: str, year: int, q: int, call_date: str | None) -> str:
    """Source and date, in the name, because the excerpt card cites `{name} · p.{turn}`."""
    when = call_date[:10] if call_date else "call date not stored"
    return f"{sym} earnings call FY{year} Q{q} · {when} · {SOURCE_LABEL}"


# ── the save ─────────────────────────────────────────────────────────────────

def save_passage(user_id: str, note_id: str, *, symbol: Any, quarter: Any, turn: Any,
                 passage: Any, annotation: Any = None,
                 conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Save one passage of one held transcript into `note_id` as a cited excerpt.

    Returns {excerpt, note: {id, updatedAt}, deduped, document, turn, speaker, quarter,
    callDate}. Raises TranscriptCaptureError (with its status) on every refusal, and leaves
    nothing behind when the note refuses the node.
    """
    from api.services.journal_two import note_excerpts, notes as notes_service
    from api.services.journal_two.web_capture import MAX_PASSAGE_CHARS, sanitize_text
    from api.services.journal_two.web_capture_store import TEXT_ORIGIN_WEB_PASSAGE

    sym = clean_symbol(symbol)
    year, q = parse_quarter(quarter)
    try:
        turn_no = int(turn)
    except (TypeError, ValueError):
        raise TranscriptCaptureError("Pick the speaker turn the passage comes from.")
    raw = str(passage or "")
    if len(raw) > MAX_PASSAGE_CHARS:
        raise TranscriptCaptureError(
            f"That passage is {len(raw)} characters, over the {MAX_PASSAGE_CHARS} limit -- "
            "save a quote, not the transcript.")
    if not raw.strip():
        raise TranscriptCaptureError("Select the words to save first.")
    if not isinstance(note_id, str) or not note_id:
        raise TranscriptCaptureError("Pick the note to save into.")

    t = read_transcript(sym, quarter_label(year, q))
    if t is None:
        raise TranscriptCaptureError(
            f"UCT does not hold the {sym} {quarter_label(year, q)} transcript yet. Open it in the "
            "UCT Terminal's transcript panel first, then save from it here.", status=404)
    by_turn = {x["turn"]: x for x in t["turns"]}
    if turn_no not in by_turn:
        raise TranscriptCaptureError("That speaker turn is not in this transcript.")
    held_text = by_turn[turn_no]["text"]
    if locate(raw, held_text) is None:
        raise TranscriptCaptureError(
            f"That passage is not in turn {turn_no} of the {sym} {quarter_label(year, q)} "
            "transcript UCT holds, so it cannot be saved as a quote. Your note is unchanged.",
            status=422)

    owned = conn is None
    conn = conn or notes_service.get_connection()
    created_doc = created_page = False
    doc_id = None
    try:
        if notes_service.get_note(user_id, note_id, conn=conn) is None:
            raise TranscriptCaptureError("Note not found.", status=404)
        identity = document_identity(sym, year, q)
        if conn.in_transaction:     # get_note may have opened one (its thumbnail write)
            conn.commit()
        conn.execute("BEGIN IMMEDIATE")
        doc = conn.execute(
            "SELECT id, page_count FROM j2_note_documents"
            " WHERE user_id = ? AND note_id = ? AND attachment_url = ?",
            (user_id, note_id, identity)).fetchone()
        if doc is None:
            doc_id = uuid.uuid4().hex
            now = notes_service._now_iso()
            conn.execute(
                "INSERT INTO j2_note_documents"
                " (id, user_id, note_id, attachment_url, name, status, page_count,"
                "  extraction_version, created_at, processed_at, source_kind, source_url,"
                "  capture_type)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (doc_id, user_id, note_id, identity,
                 document_name(sym, year, q, t["callDate"]), "ready", 0, 1, now, now,
                 "web", None, "web_passage"))
            created_doc = True
        else:
            doc_id = doc["id"]

        page = conn.execute(
            "SELECT text FROM j2_note_document_pages"
            " WHERE document_id = ? AND user_id = ? AND page_number = ?",
            (doc_id, user_id, turn_no)).fetchone()
        if page is None:
            page_text = held_text
            conn.execute(
                "INSERT INTO j2_note_document_pages"
                " (document_id, user_id, page_number, text, text_origin) VALUES (?,?,?,?,?)",
                (doc_id, user_id, turn_no, page_text, TEXT_ORIGIN_WEB_PASSAGE))
            n_pages = conn.execute(
                "SELECT COUNT(*) FROM j2_note_document_pages WHERE document_id = ? AND user_id = ?",
                (doc_id, user_id)).fetchone()[0]
            conn.execute("UPDATE j2_note_documents SET page_count = ? WHERE id = ? AND user_id = ?",
                         (int(n_pages), doc_id, user_id))
            created_page = True
        else:
            # A page is written ONCE (Wave J): the turn already stored is the anchor's text.
            page_text = page["text"]

        span = locate(raw, page_text)
        if span is None:
            # Verified against the held turn above, but the stored turn differs (the
            # provider re-segmented since). The stored page is the one a citation opens.
            conn.rollback()
            raise TranscriptCaptureError(
                f"Turn {turn_no} of this call was saved earlier in a different form, and this "
                "passage is not in it. Your note is unchanged.", status=409)
        s, e = span
        captured = page_text[s:e]

        dup = conn.execute(
            "SELECT id FROM j2_note_excerpts WHERE user_id = ? AND note_id = ? AND document_id = ?"
            " AND page_number = ? AND captured_text = ? ORDER BY created_at LIMIT 1",
            (user_id, note_id, doc_id, turn_no, captured)).fetchone()
        if dup is not None:
            conn.commit()
            row = conn.execute("SELECT updated_at FROM j2_notes WHERE id = ? AND user_id = ?",
                               (note_id, user_id)).fetchone()
            return _result(note_excerpts.get_excerpt(user_id, dup["id"], conn=conn),
                           {"id": note_id, "updatedAt": row["updated_at"] if row else None},
                           True, doc_id, t, turn_no, by_turn[turn_no])

        excerpt = note_excerpts.create_excerpt(
            user_id, note_id, document_id=doc_id, page_number=turn_no, captured_text=captured,
            quote_prefix=page_text[max(0, s - QUOTE_CONTEXT_CHARS):s] or None,
            quote_suffix=page_text[e:e + QUOTE_CONTEXT_CHARS] or None,
            char_start=s, char_end=e,
            annotation=sanitize_text(annotation, limit=MAX_PASSAGE_CHARS) or None,
            conn=conn)          # commits the document, the page and the excerpt together
    except TranscriptCaptureError:
        _rollback(conn)
        if owned:
            conn.close()
        raise
    except note_excerpts.ExcerptValidationError as ex:
        _rollback(conn)
        if owned:
            conn.close()
        raise TranscriptCaptureError(str(ex)) from ex
    except sqlite3.IntegrityError as ex:
        _rollback(conn)
        if owned:
            conn.close()
        raise TranscriptCaptureError("This transcript cannot be saved into that note.",
                                     status=404) from ex
    except Exception:
        _rollback(conn)
        if owned:
            conn.close()
        raise

    try:
        # The existing server half of "Save excerpt": the node goes in the note, sidecars sync.
        try:
            note = notes_service.append_document_excerpt(user_id, note_id, excerpt["id"], conn=conn)
        except notes_service.NoteLockedError as ex:
            _undo(conn, user_id, excerpt["id"], doc_id, turn_no, created_doc, created_page)
            raise TranscriptCaptureError(str(ex), status=423) from ex
        except notes_service.NoteValidationError as ex:
            _undo(conn, user_id, excerpt["id"], doc_id, turn_no, created_doc, created_page)
            raise TranscriptCaptureError(str(ex)) from ex
        if note is None:
            _undo(conn, user_id, excerpt["id"], doc_id, turn_no, created_doc, created_page)
            raise TranscriptCaptureError("Note not found.", status=404)
        fresh = note_excerpts.get_excerpt(user_id, excerpt["id"], conn=conn) or excerpt
        return _result(fresh, {"id": note_id, "updatedAt": note.get("updatedAt")}, False,
                       doc_id, t, turn_no, by_turn[turn_no])
    finally:
        if owned:
            conn.close()


def _rollback(conn) -> None:
    try:
        if conn.in_transaction:
            conn.rollback()
    except Exception:  # noqa: BLE001 -- a failed rollback must not mask the cause
        pass


def _undo(conn, user_id: str, excerpt_id: str, doc_id: str, turn_no: int,
          created_doc: bool, created_page: bool) -> None:
    """A refused placement leaves nothing behind: the excerpt this request made, and the page
    and document too when this request made them and nothing else now cites them."""
    from api.services.journal_two import note_excerpts
    note_excerpts.delete_excerpt(user_id, excerpt_id, conn=conn)
    left = conn.execute(
        "SELECT COUNT(*) FROM j2_note_excerpts WHERE user_id = ? AND document_id = ? AND page_number = ?",
        (user_id, doc_id, turn_no)).fetchone()[0]
    if created_page and not left:
        conn.execute("DELETE FROM j2_note_document_pages WHERE document_id = ? AND user_id = ?"
                     " AND page_number = ?", (doc_id, user_id, turn_no))
    if created_doc:
        pages = conn.execute("SELECT COUNT(*) FROM j2_note_document_pages WHERE document_id = ?",
                             (doc_id,)).fetchone()[0]
        if not pages:
            conn.execute("DELETE FROM j2_note_documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
    conn.commit()


def _result(excerpt: dict | None, note: dict, deduped: bool, doc_id: str, t: dict,
            turn_no: int, turn: dict) -> dict[str, Any]:
    return {
        "excerpt": excerpt,
        "note": note,
        "deduped": deduped,
        "document": {"id": doc_id, "name": (excerpt or {}).get("documentName")},
        "symbol": t["symbol"],
        "quarter": t["quarter"],
        "callDate": t["callDate"],
        "source": t["source"],
        "turn": turn_no,
        "speaker": turn.get("speaker"),
    }
