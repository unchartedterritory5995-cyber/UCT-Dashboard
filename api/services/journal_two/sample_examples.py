"""Wave 14, lane W14-E -- one seeded example per Notebook capability, added by the
same "Add a sample notebook" click that writes the five wave-8 practice notes
(`sample_notebook.py`), and removed by the same "Remove it".

WHY A SEPARATE MODULE. `sample_notebook.py` owns the five practice notes and their own
no-ticker, no-cashtag, no-date rules (wave 8, ruling D-C6) -- a different contract than
these examples, which must each name a real-looking ticker to show its capability doing
anything. Keeping the two apart means the wave-8 rails keep reading exactly the five notes
they have always read.

⛔⛔ NO TRADE, NO POSITION, NO ENTRY CONTEXT -- EVER (wave 14 integration, round 2). The first
version of this module seeded a closed AAPL trade through `trades.create_trade_manual` so plan
grading had something to grade, plus a frozen entry-context row for it. That trade landed in
`j2_trades` UNMARKED, and `j2_trades` is read by ~60 modules with raw SQL -- P&L, analytics, the
equity curve, calendar, tax report, exports, playbook stats, discipline, community, the public
track record, Compass. There is no single choke point to filter a sample flag at, so exclusion
could not be made airtight, and a member's numbers must never include an example. So the trade
is not seeded at all; the entry-context row went with it, because that table is keyed by
(member, symbol, day) and a real AAPL trade on the same day would have read -- and been blocked
from freezing -- the sample's fabricated context. The plan note stays, unlinked: it still shows
the chart plan, the drawn levels and the frozen fingerprint, and it tells the member how to get
a grade (link one of their own trades). `tests/test_sample_notebook_trade_exclusion.py` is the
rail: seeding writes no row to any trade-side table, and every trade consumer reads the same
for a seeded member as for an empty one. `remove()` deletes no trade and no entry context at all (fin-data
M4): there is none to delete, and the ids it used to act on came from a preference a client can write.

ONE REAL DOOR PER PIECE, NEVER RAW SQL THAT SKIPS AN INVARIANT:
  * the plan / setup notes `notes.import_confirm`        -- the sample notebook's own door
  * the thesis property    `notes.update_note({"properties": ...})` -- the editor's own door
  * the chart-block index  `chart_blocks.catch_up`       -- pure projection of the note body
  * the level index        `note_levels.project_note`     -- pure projection of the note body
                                                             (shown on the note's own page)
  * the passed setup       `passed_setups.add_example`    -- a row marked as the sample's own,
                                                             scored like any pass from bars.db;
                                                             zero vendor or model calls. Never
                                                             `add_manual`, which answers a row
                                                             the member already has

R6 (no live paid model or vendor call on sample data): every number below is written once,
by hand, here. Nothing in this module calls an LLM, fetches a quote, or reads an earnings
calendar. `tech_fingerprint.compute` and `entry_context.build_context` are never imported.
Reading real bars.db rows through `passed_setups.add_example` is the one exception, and it is
not a vendor call either -- that module's own docstring states "Zero model calls, zero
vendor calls" (it reads only what the app's own background prewarm already cached); a cold
cache answers with the labelled `no_bars`/`pending` states the capability already renders
for a real member, never a crash and never an invented number.

⛔⛔ AN EXAMPLE IS READ AS A NOTE, NEVER AS A FACT ABOUT THE MEMBER (fin-data I3). These notes
name real tickers and real-looking levels, and a note is also data: a plan a trade is graded
against, "what you wrote before a loss", "a symbol you have research on", a stop on a chip.
Before this rule the example NVDA thesis froze itself as the plan of a real NVDA trade (the
trade stopped being Unplanned, the plan rate rose), the six tickers became "symbols you have
research on" for the stop alert, and its stop sat on a real NVDA position's chip. Every note
written here carries `import_source = sample_marker.SAMPLE_SOURCE`, and every reader that
turns a note into a statistic, a grade, an alert or a chip leaves those out through that one
module. The example still shows as itself: its own note, its card on the setups board and in
the visual playbook. Rail and ledger: `tests/test_sample_never_feeds_real_numbers.py`.

SIX SYMBOLS, ONE EACH, ON PURPOSE. Readers that pick "the most recently updated note that
names this symbol" would let two notes on the same ticker answer for each other. The setups board and passed setups read different
populations too (the untraded AAPL plan also shows on the setups board, truthfully: a drawn
entry and stop with no linked trade is exactly what that board watches). Picking six real, highly-liquid large-caps removes the
ambiguity a shared or invented symbol would create, while keeping every WRITE here static.

⛔⛔ THE RESURFACING EXAMPLE IS SHOWN IN THE NOTE, NEVER IN AN INBOX (wave 14 docs lane). The
first version queued a real `voice_proactive_insights` row at importance 8 -- above every real
resurfacing (R7-R9 never exceed 7) and at the away floor -- so a sample led the Compass inbox,
was mirrored into the member's Compass chat thread (which no dismissal undoes), opened their
next voice session as an "FYI", spent one of the two resurfacing slots a day and put NVDA on a
6-hour cooldown that would swallow a REAL NVDA resurfacing. A sample must never compete with a
real alert. So no insight and no ledger row are written: the thesis note itself carries the
example notice, in a callout labelled as an example, which is the one place that explains it.
Trashing the note (`sample_notebook.remove`) clears it. And the level the note names is left out
of the resurfacing scan (`note_levels.load_index` skips `import_source = 'sample'`), so the
example can never fire a real one either. `remove()` still dismisses an `insightId` recorded by
the earlier version. Rail: `tests/test_sample_notebook_examples.py`.

DARK WHILE A CAPABILITY'S OWN FLAG IS OFF, ON PURPOSE (plan section 4.5): the row is written
regardless (seeding never reads a capability's flag), and every one of the modules above
already renders nothing for a member whose flag is off. A dark example is data sitting
quietly in a table; it is the gated SURFACE that decides whether anything is shown.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from api.services.journal_two import (
    chart_blocks,
    note_levels,
    note_properties,
    passed_setups,
    sample_marker,
)
from api.services.journal_two import notes as notes_service
from api.services.journal_two.timeutil import ET, compute_trading_day_et

log = logging.getLogger(__name__)

#: One symbol per capability that needs a real-looking ticker, each used exactly once so
#: "newest note on this symbol" can never cross capabilities.
SYM_PLAN = "AAPL"        # chart plan, TA fingerprint, visual playbook (an UNTRADED plan; no trade)
SYM_SETUP = "MSFT"       # the active setups board
SYM_THESIS = "NVDA"      # thesis chips, resurfacing
SYM_PASSED = "GOOGL"     # passed setups
SYM_TRANSCRIPT = "TSLA"  # transcript capture
SYM_EARNINGS = "AMZN"    # earnings prep (cosmetic ticker only; no calendar row is fabricated)

EXAMPLES_FOLDER_PATH = ("Sample notebook", "Capability examples")

IMPORT_SOURCE = sample_marker.SAMPLE_SOURCE   # the ONE durable marker: j2_notes.import_source
KEY_PREFIX = "sample-example:"

#: The example resurfacing notice, shown ONLY inside the thesis note (a callout), worded the
#: way `awareness/rules.py` R7 words a real stop touch. Never an insight row (see above).
RESURFACE_HEADLINE = "Example: NVDA reached 110.00, the stop you named"
RESURFACE_BODY = ("This is what a resurfacing notice looks like: a price your note named was "
                   "touched, and the notice opens the note as you wrote it then. It is an "
                   "example, not a live alert, and it appears only here.")

EARNINGS_PREP_TAG = "earnings-prep"

#: FINGERPRINT_VERSION / FIELDS, duplicated as a plain tuple rather than imported, so this
#: module never imports `tech_fingerprint` (it must never be tempted to call `.compute`).
FINGERPRINT_VERSION = 1


def _field(value: Any, source: str, as_of: str | None = None, detail: dict | None = None) -> dict:
    return {"value": value, "source": source, "asOf": as_of, "missing": None, "detail": detail}


def _et_today() -> date:
    return datetime.now(ET).date()


def _iso(d: date) -> str:
    return d.isoformat()


def _unix_seconds_et_close(d: date) -> int:
    """20:00 UTC (16:00 ET) on `d`, as the chart embed's frozen right edge (`params.to`)."""
    dt = datetime(d.year, d.month, d.day, 16, 0, tzinfo=ET)
    return int(dt.astimezone(timezone.utc).timestamp())


def _static_fingerprint(symbol: str, as_of_day: str) -> dict:
    """A plausible, hand-written fingerprint -- the same shape `tech_fingerprint.compute`
    returns, never computed by it. Used both as the chart embed's `ta.fingerprint` (which
    `chart_blocks.extract_blocks` reads straight off the note, no live call)."""
    src = "bars"
    return {
        "v": FINGERPRINT_VERSION, "symbol": symbol, "requested_as_of": as_of_day,
        "as_of": as_of_day, "mode": "bars",
        "fields": {
            "adr_pct": _field(3.2, src), "pct_vs_sma10": _field(1.8, src),
            "pct_vs_sma20": _field(3.5, src), "pct_vs_sma50": _field(6.1, src),
            "pct_vs_sma200": _field(14.2, src), "ma_stack": _field(True, src),
            "ema_stack_intact": _field(True, src), "rs_rank": _field(92, src),
            "rs_line_trend": _field("up", src), "base_length_bars": _field(18, src),
            "base_depth_pct": _field(9.4, src), "pullback_depth_pct": _field(4.1, src),
            "vol_nweek_low": _field(3, src), "close_cv_pct": _field(2.1, src),
            "pole_pct": _field(28.5, src), "patterns": _field([], src),
        },
    }


# ── note bodies (TipTap JSON) ─────────────────────────────────────────────────────────────

def _p(*text_or_marks) -> dict:
    """One paragraph of plain inline text runs. Each item is a str, or (str, [marks])."""
    content = []
    for item in text_or_marks:
        if isinstance(item, tuple):
            text, marks = item
            content.append({"type": "text", "text": text, "marks": marks})
        else:
            content.append({"type": "text", "text": item})
    return {"type": "paragraph", "content": content}


def _h(level: int, text: str) -> dict:
    return {"type": "heading", "attrs": {"level": level},
            "content": [{"type": "text", "text": text}]}


def _callout(*blocks: dict) -> dict:
    return {"type": "callout", "attrs": {"variant": "info"}, "content": list(blocks)}


def _bullets(*items: str) -> dict:
    return {"type": "bulletList", "content": [
        {"type": "listItem", "content": [_p(it)]} for it in items]}


def _chart_embed(*, embed_id: str, symbol: str, as_of_day: str, annotations: list[dict],
                 setup_tag: str | None = None, shares: float | None = None,
                 fingerprint: dict | None = None,
                 captured_at: str) -> dict:
    ta: dict[str, Any] = {}
    if setup_tag:
        ta["setupTag"] = setup_tag
    if shares is not None:
        ta["planBlock"] = {"shares": shares}
    if fingerprint is not None:
        ta["fingerprint"] = fingerprint
    attrs: dict[str, Any] = {
        "v": 1, "widgetId": "chart", "embedId": embed_id, "mode": "snapshot",
        "params": {"symbol": symbol, "tf": "D", "to": _unix_seconds_et_close(date.fromisoformat(as_of_day))},
        "capturedAt": captured_at, "annotations": annotations,
    }
    if ta:
        attrs["ta"] = ta
    return {"type": "widgetEmbed", "attrs": attrs}


def _plan_note_body(symbol: str, as_of_day: str, captured_at: str, entry: float, stop: float,
                    target: float, shares: float, setup_tag: str, fingerprint: dict) -> dict:
    annotations = [
        {"role": "entry", "type": "horizontal", "price": entry},
        {"role": "stop", "type": "horizontal", "price": stop},
        {"role": "target", "type": "horizontal", "price": target},
    ]
    return {"type": "doc", "content": [
        _p(("Example", [{"type": "bold"}]), " -- a plan written BEFORE a trade. "
           f"{symbol} is a real ticker; the numbers are hand-written for this example, not "
           "advice, and no trade was added to your journal."),
        _h(2, "The plan"),
        _bullets(f"Entry {entry:.2f}, stop {stop:.2f}, target {target:.2f}, {int(shares)} shares.",
                 f"Setup: {setup_tag}."),
        _p("The chart below carries the same three lines as drawn levels, plus the "
           "technical fingerprint frozen for this day -- open it to see the fingerprint panel."),
        _chart_embed(embed_id="ex-plan", symbol=symbol, as_of_day=as_of_day, captured_at=captured_at,
                    annotations=annotations, setup_tag=setup_tag, shares=shares,
                    fingerprint=fingerprint),
        _p("When you write a plan like this before one of your own trades and link that "
           "trade to the note, Plan vs. Execution grading checks the entry, stop, size and "
           "target against what you actually did."),
    ]}


def _active_setup_note_body(symbol: str, as_of_day: str, captured_at: str, entry: float,
                            stop: float, setup_tag: str) -> dict:
    annotations = [
        {"role": "entry", "type": "horizontal", "price": entry},
        {"role": "stop", "type": "horizontal", "price": stop},
    ]
    return {"type": "doc", "content": [
        _p(("Example", [{"type": "bold"}]), " -- a plan that has not been traded yet. "
           "Notes like this one, with a drawn entry and stop and no linked trade, are what "
           "the active setups board watches."),
        _h(2, "Watching for"),
        _bullets(f"Entry {entry:.2f}, stop {stop:.2f}.", f"Setup: {setup_tag}."),
        _chart_embed(embed_id="ex-setup", symbol=symbol, as_of_day=as_of_day, captured_at=captured_at,
                    annotations=annotations, setup_tag=setup_tag),
        _p("Open the active setups board to see this card -- distance to the entry, and "
           "how many days it has been on the board."),
    ]}


def _thesis_note_body(symbol: str, stop: float) -> dict:
    return {"type": "doc", "content": [
        _p(("Example", [{"type": "bold"}]), f" -- a thesis on {symbol}, with a status and a "
           "stop written in the note's own words. In a note of your own, thesis chips read the "
           "status and the stop from here, and resurfacing watches the stop."),
        _h(2, "The thesis"),
        _p("Leadership names that held up best through the last pullback make new highs first."),
        _p(f"Stop: {stop:.2f}"),
        _p("When you write a thesis like this yourself, the Watchlist or Open Positions row "
           "for its symbol shows a small chip with the status and the stop, and when a level "
           "your note names is touched, a resurfacing notice arrives in the Voice Insights "
           "Inbox (Settings > Compass). This example does neither, so it can never be mistaken "
           "for your own research; this is what a notice would say:"),
        _callout(_p((RESURFACE_HEADLINE, [{"type": "bold"}])), _p(RESURFACE_BODY)),
    ]}


def _earnings_prep_note_body(symbol: str) -> dict:
    return {"type": "doc", "content": [
        _p(("Example", [{"type": "bold"}]), f" -- a one-click earnings-prep draft for "
           f"{symbol}, written out so you can see its shape. A real draft reads the "
           "actual reporting date, estimates, implied move and your own notes and trades; "
           "this example is static, pre-written text standing in for that reading, not a "
           "live earnings calendar."),
        _h(2, "What to watch"),
        _bullets("The implied move vs. the last few quarters' actual moves.",
                 "Guidance language vs. last quarter's.", "How the stock trades into the print."),
        _h(2, "My plan for the print"),
        _p("Example -- size down or close into the report; re-enter on the reaction, not "
           "the headline."),
    ]}


def _transcript_note_body(symbol: str) -> dict:
    """No `documentExcerpt` node yet -- the excerpt row cannot exist before this note does
    (`note_excerpts.create_excerpt` is keyed to a note id), so the citation node is appended
    AFTER, by `notes.append_document_excerpt`, the same order the real capture uses."""
    return {"type": "doc", "content": [
        _p(("Example", [{"type": "bold"}]), " -- a cited passage from an earnings call, the "
           "way transcript capture saves one. The quote cited below is written for this "
           "example (not a real call)."),
        _h(2, "From the call"),
    ]}


def _own_import(user_id: str, conn: sqlite3.Connection, key: str, title: str, body: dict,
                ticker: str | None = None, tags: list[str] | None = None) -> str:
    out = notes_service.import_confirm(user_id, {
        "source": IMPORT_SOURCE,
        "notes": [{
            "importKey": f"{KEY_PREFIX}{key}", "title": title, "bodyJson": body,
            "tags": tags or [], "ticker": ticker, "folderPath": list(EXAMPLES_FOLDER_PATH),
        }],
    }, conn=conn)
    if out["failed"]:
        raise RuntimeError(f"sample example note {key!r} failed: {out['failed']}")
    created = out["created"] or out["updated"]
    return created[0]["id"]


# ── the seed ───────────────────────────────────────────────────────────────────────────────

def seed(user_id: str, conn: sqlite3.Connection) -> dict[str, Any]:
    """Write one example per capability, inside the caller's own transaction/connection
    (the same one `sample_notebook.seed` already holds the write lock on). Every piece is
    independent and defensive: one capability's failure is recorded and never stops the
    rest, so `remove()` below can always clean up exactly what this call actually created.

    Returns {"noteIds": [...], "tradeId": None, "entryContext": None, "passedSetupId": str|None,
    "insightId": None, "errors": {capability: str}}. `tradeId`, `entryContext` and `insightId`
    are always None now (no trade and no inbox notice is seeded) and are kept so a preference
    written by either version reads the same way."""
    today = _et_today()
    note_ids: list[str] = []
    errors: dict[str, str] = {}
    result: dict[str, Any] = {"noteIds": note_ids, "tradeId": None, "entryContext": None,
                              "passedSetupId": None, "insightId": None, "errors": errors}

    # -- chart plan / TA fingerprint / visual playbook: an UNTRADED plan ----------------------
    # No trade and no entry context are written (see the module docstring): a member's P&L,
    # stats and analytics read `j2_trades` from ~60 places with no sample filter to hide behind.
    as_of = today - timedelta(days=10)
    entry_price, stop_price, target_price, shares = 180.0, 170.0, 205.0, 100.0
    setup_tag = "Classic Flag/Pullback"
    as_of_day = compute_trading_day_et(f"{_iso(as_of)}T16:00:00Z") or _iso(as_of)
    try:
        fp = _static_fingerprint(SYM_PLAN, as_of_day)
        plan_note_id = _own_import(
            user_id, conn, "plan",
            f"Trade plan: example -- {SYM_PLAN} pullback",
            _plan_note_body(SYM_PLAN, as_of_day, f"{as_of_day}T16:00:00Z", entry_price, stop_price,
                            target_price, shares, setup_tag, fp))
        note_ids.append(plan_note_id)
        # Pure projection of the note body -- no live read.
        chart_blocks.catch_up(user_id, conn=conn)
    except Exception as e:  # noqa: BLE001 -- one capability's failure never stops the rest
        log.warning("[sample_examples] chart-plan example failed", exc_info=True)
        errors["chartPlan"] = str(e)

    # -- active setups board ------------------------------------------------------------------
    try:
        setup_note_id = _own_import(
            user_id, conn, "active_setup",
            f"Active setup: example -- {SYM_SETUP} base breakout",
            _active_setup_note_body(SYM_SETUP, _iso(today), f"{_iso(today)}T16:00:00Z",
                                    410.0, 395.0, "Flat Base Breakout"))
        note_ids.append(setup_note_id)
    except Exception as e:  # noqa: BLE001
        log.warning("[sample_examples] setups-board example failed", exc_info=True)
        errors["setupsBoard"] = str(e)

    # -- thesis chips (+ the resurfacing example, which lives in the note body only) -----------
    try:
        thesis_note_id = _own_import(
            user_id, conn, "thesis", f"Thesis: example -- {SYM_THESIS} leadership",
            _thesis_note_body(SYM_THESIS, 110.0), ticker=SYM_THESIS)
        note_ids.append(thesis_note_id)
        notes_service.update_note(user_id, thesis_note_id,
                                  {"properties": {"builtin:thesis_status": "active"}}, conn=conn)
        note_row = conn.execute(
            "SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
            " WHERE id = ? AND user_id = ?", (thesis_note_id, user_id)).fetchone()
        if note_row is not None:
            note_levels.ensure_schema(conn)
            note_levels.project_note(conn, user_id, note_row)
            conn.commit()
            # ⛔ No `add_insight`, no `record_fire`: the example notice is the callout in the
            # note body (module docstring). `insightId` stays None.
    except Exception as e:  # noqa: BLE001
        log.warning("[sample_examples] thesis/resurfacing example failed", exc_info=True)
        errors["thesisResurfacing"] = str(e)

    # -- passed setups --------------------------------------------------------------------------
    try:
        saved_on = _iso(today - timedelta(days=20))
        # ⛔ `add_example`, never `add_manual` (fin-data I4): the member's door answers an
        # existing row, and the sample must only ever record -- and later remove -- a row it
        # made. None means the member already has their own pass on this name and day.
        made = passed_setups.add_example(user_id, SYM_PASSED, saved_on, conn=conn)
        result["passedSetupId"] = made["id"] if made else None
    except Exception as e:  # noqa: BLE001
        log.warning("[sample_examples] passed-setups example failed", exc_info=True)
        errors["passedSetups"] = str(e)

    # -- earnings prep ---------------------------------------------------------------------------
    try:
        prep_note_id = _own_import(
            user_id, conn, "earnings_prep", f"Earnings prep draft: example -- {SYM_EARNINGS}",
            _earnings_prep_note_body(SYM_EARNINGS), ticker=SYM_EARNINGS, tags=[EARNINGS_PREP_TAG])
        note_ids.append(prep_note_id)
    except Exception as e:  # noqa: BLE001
        log.warning("[sample_examples] earnings-prep example failed", exc_info=True)
        errors["earningsPrep"] = str(e)

    # -- transcript capture -----------------------------------------------------------------------
    try:
        note_ids.append(_seed_transcript_example(user_id, conn))
    except Exception as e:  # noqa: BLE001
        log.warning("[sample_examples] transcript-capture example failed", exc_info=True)
        errors["transcriptCapture"] = str(e)

    return result


_TRANSCRIPT_PASSAGE = ("We are pleased with the pace of deliveries this quarter and remain "
                       "confident in the production ramp into next year.")
_TRANSCRIPT_DOC_IDENTITY = "sample:transcript:" + SYM_TRANSCRIPT + ":example"
_TRANSCRIPT_DOC_NAME = f"{SYM_TRANSCRIPT} earnings call -- EXAMPLE (not a real transcript)"


def _seed_transcript_example(user_id: str, conn: sqlite3.Connection) -> str:
    """One cited excerpt, placed the same way `transcript_capture.save_passage` places a
    real one (`note_excerpts.create_excerpt` then `notes.append_document_excerpt`) -- the
    one piece this door skips is `read_transcript`, which would need a real, possibly
    unfetched AlphaVantage transcript. The document this excerpt cites is clearly namespaced
    `sample:` and labelled EXAMPLE; it can never resolve as a real UCT-held transcript."""
    from api.services.journal_two import note_excerpts

    note_id = _own_import(
        user_id, conn, "transcript", f"Call excerpt: example -- {SYM_TRANSCRIPT}",
        _transcript_note_body(SYM_TRANSCRIPT), ticker=SYM_TRANSCRIPT)

    now = notes_service._now_iso()
    doc_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO j2_note_documents"
        " (id, user_id, note_id, attachment_url, name, status, page_count,"
        "  extraction_version, created_at, processed_at, source_kind, source_url, capture_type)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (doc_id, user_id, note_id, _TRANSCRIPT_DOC_IDENTITY, _TRANSCRIPT_DOC_NAME, "ready", 1, 1,
         now, now, "web", None, "sample_example"))
    conn.execute(
        "INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text, text_origin)"
        " VALUES (?,?,?,?,?)",
        (doc_id, user_id, 1, _TRANSCRIPT_PASSAGE, "web_passage"))
    conn.commit()

    excerpt = note_excerpts.create_excerpt(
        user_id, note_id, document_id=doc_id, page_number=1, captured_text=_TRANSCRIPT_PASSAGE,
        char_start=0, char_end=len(_TRANSCRIPT_PASSAGE),
        annotation="Example -- a cited passage, not a live transcript.", conn=conn)
    note = notes_service.append_document_excerpt(user_id, note_id, excerpt["id"], conn=conn)
    if note is None:
        raise RuntimeError("could not place the example excerpt node")
    return note_id


# ── removal ────────────────────────────────────────────────────────────────────────────────

def remove(user_id: str, recorded: dict[str, Any], conn: sqlite3.Connection) -> dict[str, Any]:
    """Undo everything `seed()` wrote that a note's own Trash cannot: the passed setup (dismissed -- that capability's own "remove" verb, same as a
    member's), and -- for a preference recorded by the earlier version only -- the resurfacing
    insight it queued (dismissed -- same; today's `seed()` queues none). The example NOTES are not
    handled here: their ids are folded into `sample_notebook`'s own `ids` list, so the
    existing Trash loop in `sample_notebook.remove()` covers them for free, exactly like the
    five base notes -- restorable, consistent with how this whole feature already treats
    "removed".

    ⛔ NO TRADE AND NO ENTRY CONTEXT IS EVER DELETED HERE (fin-data M4). `seed()` writes
    neither, and no shipped build ever did. This function used to hard-delete whatever trade
    id and entry-context key `recorded` named, "for a preference recorded by the earlier
    version" -- but `recorded` comes from a preference a client can write, so that was a
    member's real trade deleted on the strength of one JSON value. `recorded["tradeId"]` and
    `recorded["entryContext"]` are not read."""
    out = {"passedSetupDismissed": False, "insightDismissed": False}
    # ⛔ By the row's own marker, never by `recorded["passedSetupId"]` (fin-data I4): that id
    # comes from a preference a client can write, and before this rule it could be the id of a
    # pass the MEMBER made. Only rows the sample itself inserted carry the marker.
    try:
        out["passedSetupDismissed"] = passed_setups.dismiss_examples(user_id, conn=conn) > 0
    except Exception:  # noqa: BLE001
        log.warning("[sample_examples] could not dismiss the example passed setup", exc_info=True)
    insight_id = recorded.get("insightId")
    if insight_id:
        try:
            from api.services import voice_proactive_service
            out["insightDismissed"] = voice_proactive_service.dismiss(int(insight_id), user_id)
        except Exception:  # noqa: BLE001
            log.warning("[sample_examples] could not dismiss the example insight", exc_info=True)
    return out
