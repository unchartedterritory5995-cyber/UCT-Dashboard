"""Wave P1 — OCR for scanned document pages. ENGINE-INDEPENDENT by construction.

⛔⛔ THE HIGHEST-RISK INVARIANT IN THIS WAVE, AND IT IS MEASURED, NOT ARGUED.

`j2_note_document_pages` keeps its FTS mirror through an `AFTER INSERT` and an
`AFTER DELETE` trigger, and deliberately has NO `AFTER UPDATE` trigger — the
schema's own words are "page text is written ONCE, never a partial row updated
in place". A scanned PDF ALREADY inserts one row per page with `text = ''`.

So the obvious implementation is silently, permanently wrong. Measured against
the real initialised schema:

    scanned page as stored today : search=[]            fts/map=(1, 1)
    after UPDATE ... SET text=?  : canonical row holds 34 chars of OCR text,
                                   search=[]            <- SILENTLY BLIND
    after explicit DELETE+INSERT : search=[(doc, page)] fts/map=(1, 1)

Every job-status check would be green. The member would be told OCR completed
and Search would never find a word of it.

⛔⛔ AND `REPLACE INTO` IS WORSE THAN UPDATE, WHICH IS WHY §8 FORBIDS IT TOO.
Measured on the same schema: after `REPLACE INTO`, `fts/map = (2, 1)` — SQLite's
REPLACE does not fire the DELETE trigger, so the stale FTS row survives AND the
map row that pointed at it is overwritten. The old text stays searchable and
nothing can ever remove it. That is a ghost search hit with no delete path, and
it would outlive the document itself.

⭐ THE CONTRACT IS THEREFORE AN EXPLICIT `DELETE` THEN `INSERT`, IN ONE
TRANSACTION, PRESERVING `(document_id, page_number)`. Audited before writing:
the pages table has NO foreign keys pointing at it, no cascade beyond the two
FTS triggers, and `j2_note_excerpts` stores `document_id`/`page_number` as plain
VALUES — so deleting a page row cannot orphan an excerpt, a citation or a
navigation target. Verified: the excerpt survives, and three consecutive
replacements leave exactly one page row and one FTS row.

⛔ NO ENGINE IS IMPORTED HERE. The adapter is injected. Everything in this
module — classification, job lifecycle, the write contract, recovery,
readiness — is provable with a deterministic test adapter, which is what lets
P1 close while the real engine's PACKAGING is still an open question (§37).
"""
from __future__ import annotations

import logging
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, NamedTuple

from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

# ── Text origin: the EXISTING vocabulary, not a second one (§4) ─────────────
# `j2_note_document_pages.text_origin` already carries 'native' and
# 'web_passage', and the schema comment reserved 'ocr' by name. There is no
# parallel provenance field and there must never be one.
ORIGIN_NATIVE = "native"
ORIGIN_OCR = "ocr"

# ── Page classification (§16/§17) ───────────────────────────────────────────
PAGE_NATIVE = "native"      # usable native text — OCR must NOT touch it
PAGE_SCANNED = "scanned"    # no native text, a full-page image we can read
PAGE_EMPTY = "empty"        # no text and nothing OCR can work from

# ⛔ A PAGE IS NOT "SCANNED" BECAUSE IT HAS AN IMAGE (§18). Financial filings
# carry logos and charts on pages that are otherwise perfectly good native
# text. The classifier asks about TEXT first and only consults images when
# there is no text to use.
#
# ⛔ AND "SOME TEXT" IS NOT "USABLE TEXT". A scanned page often yields a few
# stray characters from a header stamp or an embedded OCR layer fragment. This
# floor is deliberately low: it exists to reject noise, not to judge quality,
# because judging quality is what the confidence score could not do.
MIN_NATIVE_CHARS = 24

# ── OCR page job state (§12/§20/§21) ────────────────────────────────────────
OCR_REQUIRED = "required"
OCR_PROCESSING = "processing"
OCR_COMPLETE = "complete"
OCR_FAILED = "failed"

# A page left `processing` for longer than this was abandoned by a restart, not
# still running. ⛔ Generous on purpose: the P0 benchmark measured 1.8-4.2s per
# page, so a page still working at 15 minutes is not slow, it is gone.
STALLED_AFTER = timedelta(minutes=15)
# ⛔ BOUNDED RETRIES. A page that fails deterministically (an unreadable scan)
# must stop consuming the machine; §41 wants it recorded as unavailable, not
# retried forever.
MAX_ATTEMPTS = 3

# Document statuses — the EXISTING vocabulary (§12: derive, do not add an enum).
# `pending` already means "work in progress, ask again later" to every consumer
# including Ask's own refusal copy, so an OCR run reuses it rather than adding
# a status nothing downstream would recognise.
DOC_PENDING = "pending"
DOC_READY = "ready"
DOC_NO_TEXT = "no_text"
DOC_FAILED = "processing_failed"

_OCR_SEMAPHORE = threading.Semaphore(2)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── The usability gate (§17-§23) ────────────────────────────────────────────
#
# ⚰️ WHY THIS EXISTS. P1 treated any non-empty OCR result as usable text. The
# Tesseract benchmark disproved it: on a page unreadable by construction the
# engine emitted 258 characters of noise —
#
#   'meee conpenanon COMDENDED CONTA DATED STATEMENTS OF ue ter ented
#    baptembe 8 2616 oe eres ont 1) Oe ot tee eee Oe ee ma are an 8 ...'
#
# Stored, that page would have counted toward `document_complete`, put garbage
# into Search, and offered garbage as thesis evidence.
#
# ⛔⛔ IT DECIDES, IT NEVER CORRECTS (§18). The output is accepted whole or
# rejected whole. No spell-check, no dictionary, no invented spaces, no
# rewritten numbers, no expanded tickers. Source fidelity is the point of the
# whole wave; a gate that "improves" the transcription would destroy it.
#
# ⛔ AND IT IS NOT A PROSE TEST (§19). A legitimate financial page is often
# mostly numbers: `$9,242 $2,856 51% (6%) Q3 2026`. Measured, the noise page
# had MORE word-like tokens (57) and a HIGHER alphanumeric ratio (0.964) than a
# real segment table (32, 0.851). Counting "wordish" tokens would have rejected
# the table and accepted the noise.
#
# ⭐ WHAT ACTUALLY SEPARATES THEM IS TOKEN SHAPE. Noise is dominated by
# two-character fragments (`oe ee ot ma an`); real financial text is made of
# number-bearing tokens and words of four letters or more. So a token counts as
# MEANINGFUL if it carries a digit (`$12,913`, `51%`, `Q3`, `2026`) or contains
# a run of four or more letters (`Automotive`, `SEGMENT`). The ratio of those
# to all tokens is the signal.
#
# Measured on the gate corpus, DESIGN split only (the threshold was chosen
# here and never adjusted afterwards):
#     GOOD ratios 0.739 – 0.909      BAD ratios 0.000 – 0.266
# and then scored ONCE on the unseen CONTROL split:
#     GOOD 0.690 / 0.770 / 0.786     BAD 0.000 × 3     → 0 errors
#
# ⛔ THE COUNT FLOOR IS DELIBERATELY LOW. A sparse but legitimate slide yields
# 11 meaningful tokens while the noise page yields 17 — so a COUNT threshold
# separates nothing and would reject real pages. The ratio is the
# discriminator; the floor only rejects a page with almost nothing on it.
USABLE_MIN_RATIO = 0.50
USABLE_MIN_TOKENS = 4

_HAS_DIGIT = re.compile(r"\d")
_ALPHA_RUN = re.compile(r"[A-Za-z]{4,}")
_TOKEN_TRIM = ".,;:()[]{}\"'`$%*-\u2013\u2014|/\\"


def _is_meaningful(token: str) -> bool:
    core = token.strip(_TOKEN_TRIM)
    if not core:
        return False
    if _HAS_DIGIT.search(core):
        return True
    return bool(_ALPHA_RUN.search(core))


def text_is_usable(text: str) -> bool:
    """Is this OCR output searchable text, or is it noise?

    ⛔ A DECISION, NOT A TRANSFORMATION. Returns a bool and nothing else; the
    caller either stores the original text unchanged or stores none.
    """
    tokens = (text or "").split()
    if not tokens:
        return False
    meaningful = sum(1 for t in tokens if _is_meaningful(t))
    if meaningful < USABLE_MIN_TOKENS:
        return False
    return (meaningful / len(tokens)) >= USABLE_MIN_RATIO


# ── The adapter seam (§28) ──────────────────────────────────────────────────

class OcrPageResult(NamedTuple):
    """What an engine returns for ONE page.

    ⛔ THERE IS NO CONFIDENCE FIELD, AND THAT IS A MEASURED DECISION (P0 §C1).
    The candidate engine supplies a per-line score, and on this product's own
    fixtures it INVERTED: number-bearing lines read correctly averaged 0.868,
    the one read wrong scored 0.925, and a threshold catching it would have
    flagged 89% of the correct lines. Carrying that number would let a caller
    hedge the page that was perfect and speak confidently about the page that
    was wrong. §5 of the release directive rejects it outright: provenance is
    the signal, and provenance is `text_origin='ocr'`.
    """
    text: str
    engine: str
    engine_version: str


# An adapter takes the page's own image bytes/objects and returns the above.
OcrAdapter = Callable[[Any], OcrPageResult]

# ⛔⛔ OCR IS A CAPABILITY THAT MAY BE ABSENT, AND THE PRODUCT MUST TELL THE
# TRUTH IN BOTH WORLDS.
#
# P1 ships the whole pipeline with NO engine wired (§37) — the packaging
# question is still open. Without this registry, classification would mark a
# scanned page "OCR required", the document would derive `pending`, and a
# member would watch "Processing scanned text…" forever because nothing was
# ever going to read it. That is strictly WORSE than today's honest
# `no_text`, and it would look like a working feature to every status check.
#
# So planning asks first. No adapter ⇒ no page is claimed, the document keeps
# saying what it says today, and nothing regresses.
_ADAPTER: OcrAdapter | None = None


def set_adapter(adapter: OcrAdapter | None) -> None:
    """Wire (or unwire) the engine for this process."""
    global _ADAPTER
    _ADAPTER = adapter


def get_adapter() -> OcrAdapter | None:
    return _ADAPTER


def ocr_available() -> bool:
    """Can this deployment actually read a scanned page? ⛔ Ask this before
    promising a member anything."""
    return _ADAPTER is not None


# ── Classification ──────────────────────────────────────────────────────────

def classify_page(page) -> str:
    """Which path this page belongs on.

    ⭐ NO RASTERIZER, AND THAT IS THE POINT (P0 §C). Measured: a genuinely
    scanned page carries exactly one full-page embedded image that `pypdf`
    hands over directly, and a native page carries ZERO. So the classifier
    needs no poppler, no pdfium, no page rasterization — and therefore creates
    no temporary image files, which is the leak surface §35 exists to prevent.

    ⛔ CERTIFIED FOR THE TESTED SCAN CLASS ONLY (§17). A scan split into
    horizontal strips, or a page whose text is drawn as vector curves, is not
    covered by this evidence. Such a page classifies as `native` (if it yields
    text) or `empty` (if it does not) — never silently wrong, but not read
    either. Widening the classifier must not require changing anything about
    how OCR text is stored or searched, which is why this returns a label and
    nothing else.
    """
    try:
        text = (page.extract_text() or "").strip()
    except Exception:  # noqa: BLE001 — one bad page is not a bad document
        text = ""
    if len(text) >= MIN_NATIVE_CHARS:
        return PAGE_NATIVE
    try:
        has_image = any(True for _ in page.images)
    except Exception:  # noqa: BLE001
        has_image = False
    return PAGE_SCANNED if has_image else PAGE_EMPTY


def page_images(page) -> list:
    """The page's embedded images, decoded. Never raises: a page whose image
    cannot be decoded is a page with no image, which is an honest input to the
    caller rather than a crash inside a background job."""
    out = []
    try:
        for im in page.images:
            try:
                out.append(im.image)
            except Exception:  # noqa: BLE001
                continue
    except Exception:  # noqa: BLE001
        return []
    return out


# ── The write contract (§7/§8) ──────────────────────────────────────────────

def replace_page_text(conn, *, document_id: str, user_id: str,
                      page_number: int, text: str, text_origin: str) -> None:
    """Replace one page's text so the FTS mirror follows. See the module
    docstring for the measurement that makes this shape mandatory.

    ⛔ NEVER `UPDATE`. ⛔ NEVER `REPLACE INTO` / `INSERT OR REPLACE`. Both leave
    the search index wrong, in different ways, and both leave every status
    check green while they do it.

    ⛔ ONE TRANSACTION. A crash between the DELETE and the INSERT would leave
    the page row gone entirely — a page that used to exist, empty, would simply
    vanish from the document, and `pages_total` would silently shrink.
    """
    if text_origin not in (ORIGIN_NATIVE, ORIGIN_OCR):
        raise ValueError(f"unsupported text_origin {text_origin!r}")
    conn.execute("BEGIN")
    try:
        conn.execute(
            "DELETE FROM j2_note_document_pages"
            " WHERE document_id = ? AND page_number = ?",
            (document_id, page_number))
        conn.execute(
            "INSERT INTO j2_note_document_pages"
            " (document_id, user_id, page_number, text, text_origin)"
            " VALUES (?, ?, ?, ?, ?)",
            (document_id, user_id, page_number, text, text_origin))
    except Exception:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


# ── Per-page job state ──────────────────────────────────────────────────────

def mark_pages_required(conn, *, document_id: str, user_id: str,
                        page_numbers: list[int]) -> None:
    """Record which pages OCR owns. Idempotent: re-running classification on an
    unchanged document must not reset a page that has already been read, and
    must not resurrect one that exhausted its attempts."""
    now = _now()
    for n in page_numbers:
        conn.execute(
            "INSERT INTO j2_note_document_ocr_pages"
            " (document_id, user_id, page_number, status, attempts, updated_at)"
            " VALUES (?, ?, ?, ?, 0, ?)"
            " ON CONFLICT(document_id, page_number) DO NOTHING",
            (document_id, user_id, n, OCR_REQUIRED, now))
    conn.commit()


def _set_page_status(conn, document_id: str, page_number: int, status: str,
                     *, engine: str | None = None,
                     engine_version: str | None = None,
                     error_class: str | None = None,
                     bump_attempts: bool = False,
                     terminal: bool = False) -> None:
    """⛔ `terminal` exhausts the retry budget in one step. A page rejected for
    QUALITY is deterministic: the same bytes through the same engine produce
    the same noise, so re-running it twice more is pure waste. A transient
    failure (a killed process, an unreadable source) still gets its retries."""
    conn.execute(
        "UPDATE j2_note_document_ocr_pages SET status = ?,"
        " engine = COALESCE(?, engine), engine_version = COALESCE(?, engine_version),"
        " error_class = ?,"
        " attempts = CASE WHEN ? THEN ? ELSE attempts + ? END, updated_at = ?,"
        " started_at = CASE WHEN ? = 'processing' THEN ? ELSE started_at END"
        " WHERE document_id = ? AND page_number = ?",
        (status, engine, engine_version, error_class,
         1 if terminal else 0, MAX_ATTEMPTS, 1 if bump_attempts else 0,
         _now(), status, _now(), document_id, page_number))
    conn.commit()


def pages_awaiting_ocr(conn, document_id: str) -> list[int]:
    """Pages OCR should attempt now: never tried, or a retry that has budget
    left. ⛔ A page at MAX_ATTEMPTS is deliberately NOT returned — §41 wants it
    reported as unavailable, not retried until the end of time."""
    rows = conn.execute(
        "SELECT page_number FROM j2_note_document_ocr_pages"
        " WHERE document_id = ? AND status IN (?, ?) AND attempts < ?"
        " ORDER BY page_number",
        (document_id, OCR_REQUIRED, OCR_FAILED, MAX_ATTEMPTS)).fetchall()
    return [r["page_number"] if not isinstance(r, tuple) else r[0] for r in rows]


# ── Truthful state (§12/§13/§14/§15/§32) ────────────────────────────────────

def document_text_state(conn, user_id: str, document_id: str) -> dict[str, Any]:
    """What UCT actually possesses for this document.

    ⛔⛔ THIS EXISTS BECAUSE THE OLD NUMBERS WERE ROW COUNTS WEARING A COVERAGE
    NAME. Measured in P0 on a mixed PDF: text lengths `[492, 0, 781]`, document
    status `ready`, `pages_indexed` = 3. Every one of those was defensible on
    its own and together they told the member a page had been read that had
    not. `pages_with_text` counts pages with text; `pages_total` counts rows;
    they are different questions and now have different names.

    ⛔ AND JOB STATE IS NOT READINESS (§32). A page whose OCR job says
    `complete` but whose row holds no text counts as text-unavailable here,
    because the member's question is "can you read it", not "did the job exit".
    """
    doc = conn.execute(
        "SELECT id, status, page_count FROM j2_note_documents"
        " WHERE id = ? AND user_id = ?", (document_id, user_id)).fetchone()
    if doc is None:
        return {"exists": False}

    rows = conn.execute(
        "SELECT page_number, text_origin, LENGTH(TRIM(text)) AS n"
        " FROM j2_note_document_pages WHERE document_id = ? AND user_id = ?",
        (document_id, user_id)).fetchall()
    total = len(rows)
    with_text = sum(1 for r in rows if (r["n"] or 0) > 0)
    ocr_pages = sum(1 for r in rows
                    if (r["n"] or 0) > 0 and r["text_origin"] == ORIGIN_OCR)

    jobs: dict[str, int] = {}
    for r in conn.execute(
        "SELECT status, COUNT(*) c FROM j2_note_document_ocr_pages"
        " WHERE document_id = ? GROUP BY status", (document_id,)).fetchall():
        jobs[r["status"]] = r["c"]

    awaiting = jobs.get(OCR_REQUIRED, 0) + jobs.get(OCR_PROCESSING, 0)
    unreadable = total - with_text - awaiting
    return {
        "exists": True,
        "status": doc["status"],
        "pages_total": total,
        "pages_with_text": with_text,
        "pages_from_ocr": ocr_pages,
        "pages_awaiting_ocr": awaiting,
        # ⛔⛔ WAVE P2 §19: "READING…" FOREVER IS A LIE. A page is marked
        # `required` only while an engine exists to serve it — but capability
        # can go away afterwards (the flag turned off, a rebuild without the
        # binary, a deploy to a service that never had one). The pages stay
        # claimed and nothing will ever come for them, so a surface reading
        # only `pages_awaiting_ocr` shows "reading scanned text…" until the
        # heat death of the universe. This is the fact that lets the member be
        # told the truth instead: claimed, and currently unservable.
        "ocr_unavailable": bool(awaiting > 0 and not ocr_available()),
        # Pages we have tried, or never could try, and still hold nothing for.
        "pages_unreadable": max(0, unreadable),
        # ⛔ THE ONE FIELD THAT MAY NOT BE ROUNDED UP (§15). "The OCR job
        # finished" and "we have the whole document" are different facts.
        "text_complete": total > 0 and with_text == total,
        "ocr_jobs": jobs,
    }


def derive_document_status(state: dict[str, Any]) -> str:
    """The document status implied by page truth.

    ⛔ DERIVED FROM PAGES, NEVER FROM THE JOB. Reuses the EXISTING vocabulary
    (§12) so every consumer — Ask's refusal copy included — keeps working
    without learning a new word.
    """
    if not state.get("exists"):
        return DOC_FAILED
    if state["pages_awaiting_ocr"] > 0:
        return DOC_PENDING
    if state["pages_with_text"] > 0:
        return DOC_READY
    if state["pages_total"] > 0:
        return DOC_NO_TEXT
    return DOC_FAILED


def refresh_document_status(conn, user_id: str, document_id: str) -> str:
    state = document_text_state(conn, user_id, document_id)
    status = derive_document_status(state)
    conn.execute(
        "UPDATE j2_note_documents SET status = ?, processed_at = ? WHERE id = ?",
        (status, _now(), document_id))
    conn.commit()
    return status


# ── Running OCR ─────────────────────────────────────────────────────────────

def ocr_document(document_id: str, adapter: OcrAdapter, *,
                 conn=None, page_numbers: list[int] | None = None) -> dict[str, Any]:
    """Read the pages OCR owns, one at a time, and replace their text.

    ⛔ NEVER RAISES. A background job that propagates takes the thread with it
    and leaves every remaining page unattempted — §16's partial-failure rule is
    that page 73 failing must not cost pages 1-72.

    ⛔ AND IT NEVER TOUCHES A NATIVE PAGE (§18/§39). The only pages it can
    reach are those `mark_pages_required` recorded, which classification only
    ever populates from `PAGE_SCANNED`.
    """
    from pypdf import PdfReader
    from api.services.journal_two import document_extraction as dx

    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        doc = conn.execute(
            "SELECT * FROM j2_note_documents WHERE id = ?", (document_id,)).fetchone()
        if doc is None:
            return {"ok": False, "error": "document not found"}
        doc = dict(doc)
        user_id = doc["user_id"]

        targets = (page_numbers if page_numbers is not None
                   else pages_awaiting_ocr(conn, document_id))
        if not targets:
            return {"ok": True, "pages_read": 0, "pages_failed": 0,
                    "status": refresh_document_status(conn, user_id, document_id)}

        data = dx._resolve_pdf_bytes(user_id, doc["note_id"], doc["attachment_url"])
        if data is None:
            for n in targets:
                _set_page_status(conn, document_id, n, OCR_FAILED,
                                 error_class="source_unreadable", bump_attempts=True)
            return {"ok": False, "error": "source unreadable",
                    "status": refresh_document_status(conn, user_id, document_id)}

        import io
        reader = PdfReader(io.BytesIO(data))
        read = failed = 0
        for n in targets:
            if n < 1 or n > len(reader.pages):
                _set_page_status(conn, document_id, n, OCR_FAILED,
                                 error_class="page_out_of_range", bump_attempts=True)
                failed += 1
                continue
            _set_page_status(conn, document_id, n, OCR_PROCESSING)
            try:
                images = page_images(reader.pages[n - 1])
                if not images:
                    raise ValueError("no page image")
                parts = []
                engine = version = ""
                for im in images:
                    res = adapter(im)
                    if res.text:
                        parts.append(res.text)
                    engine, version = res.engine, res.engine_version
                text = "\n".join(parts).strip()
                if not text:
                    raise ValueError("no text recognised")
            except Exception as e:  # noqa: BLE001 — one page, never the job
                log.warning("[doc-ocr] %s p%s failed: %s",
                            document_id, n, type(e).__name__)
                _set_page_status(conn, document_id, n, OCR_FAILED,
                                 error_class=type(e).__name__, bump_attempts=True)
                failed += 1
                continue

            # ⛔⛔ THE GATE SITS BEFORE THE WRITE (§27). Rejected output must
            # never reach `replace_page_text`, because anything that reaches it
            # reaches the search index one trigger later. Hiding noise at the
            # UI while it sits in FTS would be the same defect wearing a
            # different coat.
            #
            # ⛔ AND THE REJECTED TEXT IS NOT PERSISTED (§24). Only the reason
            # is kept. There is no debugging value in a member's unreadable
            # page that outweighs storing their private content as garbage.
            if not text_is_usable(text):
                log.info("[doc-ocr] %s p%s: output rejected as unusable "
                         "(%s tokens)", document_id, n, len(text.split()))
                _set_page_status(conn, document_id, n, OCR_FAILED,
                                 engine=engine, engine_version=version,
                                 error_class="unusable_output", terminal=True)
                failed += 1
                continue
            replace_page_text(conn, document_id=document_id, user_id=user_id,
                              page_number=n, text=text, text_origin=ORIGIN_OCR)
            _set_page_status(conn, document_id, n, OCR_COMPLETE,
                             engine=engine, engine_version=version,
                             bump_attempts=True)
            read += 1

        return {"ok": True, "pages_read": read, "pages_failed": failed,
                "status": refresh_document_status(conn, user_id, document_id)}
    finally:
        if owned:
            conn.close()


def plan_document(document_id: str, *, conn=None) -> dict[str, Any]:
    """Classify every page and record which ones OCR owns.

    ⛔ RUNS AGAINST THE PAGES ALREADY STORED. Native extraction has already
    written one row per page (empty for a scan), so this adds no rows and
    changes no text — it only decides ownership. That keeps classification
    re-runnable: doing it twice is a no-op, which is what makes recovery safe.
    """
    from pypdf import PdfReader
    from api.services.journal_two import document_extraction as dx

    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        doc = conn.execute(
            "SELECT * FROM j2_note_documents WHERE id = ?", (document_id,)).fetchone()
        if doc is None:
            return {"ok": False, "error": "document not found"}
        doc = dict(doc)
        data = dx._resolve_pdf_bytes(doc["user_id"], doc["note_id"],
                                     doc["attachment_url"])
        if data is None:
            return {"ok": False, "error": "source unreadable"}
        import io
        reader = PdfReader(io.BytesIO(data))
        classes = {}
        scanned = []
        for i, page in enumerate(reader.pages, start=1):
            if i > dx._MAX_PAGES:
                break
            k = classify_page(page)
            classes[i] = k
            if k == PAGE_SCANNED:
                scanned.append(i)
        # ⛔ CLASSIFY ALWAYS, CLAIM ONLY IF AN ENGINE EXISTS. The classes are
        # useful on their own (they are what tells a caller a page is a scan);
        # marking a page `required` is a PROMISE that something will read it.
        claimed = scanned if (scanned and ocr_available()) else []
        if claimed:
            mark_pages_required(conn, document_id=document_id,
                                user_id=doc["user_id"], page_numbers=claimed)
        return {"ok": True, "classes": classes,
                "scanned_pages": scanned, "ocr_required": claimed,
                "ocr_available": ocr_available(),
                "status": refresh_document_status(conn, doc["user_id"], document_id)}
    finally:
        if owned:
            conn.close()


# ── Restart recovery (§20/§22) ──────────────────────────────────────────────

def recover_stalled(conn=None, *, now: datetime | None = None) -> dict[str, Any]:
    """Return abandoned pages to the retry pool.

    ⛔⛔ NATIVE EXTRACTION NEVER NEEDED THIS AND OCR CANNOT DO WITHOUT IT. A
    pypdf pass finished in milliseconds, so a redeploy catching one mid-flight
    was a rounding error; at seconds per page a Railway redeploy lands inside a
    job routinely. Without this a document sits at "Processing…" forever and
    nothing anywhere notices.

    ⛔ AGE, NOT PRESENCE. A page is only reclaimed once it has been
    `processing` for longer than any real page takes — reclaiming on sight
    would let a recovery sweep steal a page out from under a job that is still
    working on it, and then two writers would race for one row.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        cutoff = ((now or datetime.now(timezone.utc)) - STALLED_AFTER).isoformat()
        rows = conn.execute(
            "SELECT document_id, page_number, attempts FROM j2_note_document_ocr_pages"
            " WHERE status = ? AND (started_at IS NULL OR started_at < ?)",
            (OCR_PROCESSING, cutoff)).fetchall()
        reclaimed, exhausted = 0, 0
        for r in rows:
            if (r["attempts"] or 0) >= MAX_ATTEMPTS:
                _set_page_status(conn, r["document_id"], r["page_number"],
                                 OCR_FAILED, error_class="abandoned")
                exhausted += 1
            else:
                _set_page_status(conn, r["document_id"], r["page_number"],
                                 OCR_REQUIRED, error_class="restarted")
                reclaimed += 1
        # ⛔ The DOCUMENT's status has to follow, or a reclaimed page leaves a
        # document reading `ready` while it still owes work.
        for doc_id in {r["document_id"] for r in rows}:
            d = conn.execute("SELECT user_id FROM j2_note_documents WHERE id = ?",
                             (doc_id,)).fetchone()
            if d:
                refresh_document_status(conn, d["user_id"], doc_id)
        return {"reclaimed": reclaimed, "exhausted": exhausted,
                "documents": len({r["document_id"] for r in rows})}
    finally:
        if owned:
            conn.close()


def queue_ocr(document_id: str, adapter: OcrAdapter) -> None:
    """Fire-and-forget, bounded by the same discipline extraction already uses:
    a daemon thread behind a process-wide semaphore, so one large scan cannot
    starve every other member's upload."""
    def _run():
        with _OCR_SEMAPHORE:
            try:
                ocr_document(document_id, adapter)
            except Exception as e:  # noqa: BLE001 — a daemon thread must not propagate
                log.warning("[doc-ocr] background job crashed for %s: %s",
                            document_id, e)
    threading.Thread(target=_run, daemon=True, name="j2-doc-ocr").start()


# ── Wave P4 §11/§14/§40/§41 · the page transcript ───────────────────────────

def page_transcript(user_id: str, document_id: str, page_number: int,
                    *, conn=None) -> dict[str, Any] | None:
    """The canonical text UCT holds for ONE page, or None if there is none.

    ⛔⛔ IT IS A SELECTION AID, NOT THE DOCUMENT (§11). The scanned page is the
    source of truth; this is the text we derived from it, returned so a member
    can select a passage they can also see with their own eyes. Nothing here
    may be presented as "the document" or as a text layer of the PDF.

    ⛔ ONE PAGE (§40). A 500-page filing must never ship its whole transcript to
    a browser looking at page 12.

    ⛔ TENANT-SCOPED IN THE QUERY, AND NON-CONFIRMING (§41). A foreign document
    id returns None exactly like a missing one — the caller cannot learn that
    somebody else's scan exists, let alone what it says.

    ⛔ AND IT RETURNS WHAT WE ACTUALLY HOLD. A page whose OCR output the
    usability gate rejected holds an empty row, so it reports empty text and
    `available: False` — there is nothing to select, and saying so is the whole
    point of the gate.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT p.text AS text, p.text_origin AS text_origin,"
            " d.name AS name"
            " FROM j2_note_document_pages p"
            " JOIN j2_note_documents d ON d.id = p.document_id"
            " JOIN j2_notes n ON n.id = d.note_id"
            " WHERE p.document_id = ? AND p.user_id = ? AND p.page_number = ?"
            " AND n.deleted_at IS NULL",
            (document_id, user_id, int(page_number))).fetchone()
        if row is None:
            return None
        text = row["text"] or ""
        return {
            "document_id": document_id,
            "page_number": int(page_number),
            "name": row["name"],
            "text_origin": row["text_origin"],
            "text": text,
            # ⛔ "There is text" and "the page exists" are different facts, and
            # a surface that conflates them offers an empty selection box on an
            # unreadable scan.
            "available": bool(text.strip()),
        }
    finally:
        if owned:
            conn.close()
