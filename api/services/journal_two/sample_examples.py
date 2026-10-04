"""Wave 14, lane W14-E -- one seeded example per Notebook capability, added by the
same "Add a sample notebook" click that writes the five wave-8 practice notes
(`sample_notebook.py`), and removed by the same "Remove it".

WHY A SEPARATE MODULE. `sample_notebook.py` owns the five practice notes and their own
no-ticker, no-cashtag, no-date rules (wave 8, ruling D-C6) -- a different contract than
these examples, which must each name a real-looking ticker to show its capability doing
anything. Keeping the two apart means the wave-8 rails keep reading exactly the five notes
they have always read.

ONE REAL DOOR PER PIECE, NEVER RAW SQL THAT SKIPS AN INVARIANT:
  * the trade              `trades.create_trade_manual` -- the same function Add Trade calls
  * the plan / setup notes `notes.import_confirm`        -- the sample notebook's own door
  * the thesis property    `notes.update_note({"properties": ...})` -- the editor's own door
  * the plan's grade       `plan_grading.grade_payload`  -- pure arithmetic; freezing it here
                                                             means the grade already shows
                                                             working, not "visit this page
                                                             first" (same guarantee a GET
                                                             would give, computed once)
  * the chart-block index  `chart_blocks.catch_up`       -- pure projection of the note body
  * the resurfacing index  `note_levels.project_note`     -- pure projection of the note body
  * the resurfacing insight `voice_proactive_service.add_insight` -- the ONE insight door
  * the resurfacing ledger `note_levels.record_fire`      -- the ledger's own writer
  * the passed setup       `passed_setups.add_manual`     -- the member's own "I passed on
                                                             this" door; scores from bars.db,
                                                             zero vendor or model calls
  * the entry context      `entry_context.freeze_static`  -- added alongside this lane
                                                             (entry_context.py), because the
                                                             real `freeze()` always calls
                                                             `build_context()`, which can read
                                                             a live earnings-date vendor. A
                                                             sample must never make that call.

R6 (no live paid model or vendor call on sample data): every number below is written once,
by hand, here. Nothing in this module calls an LLM, fetches a quote, or reads an earnings
calendar. `tech_fingerprint.compute` and `entry_context.build_context` are never imported.
Reading real bars.db rows through `passed_setups.add_manual` is the one exception, and it is
not a vendor call either -- that module's own docstring states "Zero model calls, zero
vendor calls" (it reads only what the app's own background prewarm already cached); a cold
cache answers with the labelled `no_bars`/`pending` states the capability already renders
for a real member, never a crash and never an invented number.

SIX SYMBOLS, ONE EACH, ON PURPOSE. Thesis chips and resurfacing read "the most recently
updated note that names this symbol" -- two notes on the same ticker would make one example
silently answer for the other. Plan grading, the setups board and passed setups each read a
DIFFERENT note/trade population too. Picking six real, highly-liquid large-caps removes the
ambiguity a shared or invented symbol would create, while keeping every WRITE here static.

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
    entry_context,
    note_levels,
    note_properties,
    passed_setups,
    plan_grading,
    trades as trades_service,
)
from api.services.journal_two import notes as notes_service
from api.services.journal_two.timeutil import ET, compute_trading_day_et

log = logging.getLogger(__name__)

#: One symbol per capability that needs a real-looking ticker, each used exactly once so
#: "newest note on this symbol" can never cross capabilities.
SYM_PLAN = "AAPL"        # plan grading, chart plan, TA fingerprint, entry context, visual playbook
SYM_SETUP = "MSFT"       # the active setups board
SYM_THESIS = "NVDA"      # thesis chips, resurfacing
SYM_PASSED = "GOOGL"     # passed setups (must never also be a traded symbol above)
SYM_TRANSCRIPT = "TSLA"  # transcript capture
SYM_EARNINGS = "AMZN"    # earnings prep (cosmetic ticker only; no calendar row is fabricated)

EXAMPLES_FOLDER_PATH = ("Sample notebook", "Capability examples")

IMPORT_SOURCE = "sample"
KEY_PREFIX = "sample-example:"

#: `j2_note_resurface_fires.fire_key` for the one static resurfacing example -- shaped like
#: `awareness/rules.py` would key a real R7 price-touch fire, namespaced so it can never
#: collide with a real fire for this member.
RESURFACE_FIRE_KEY = "sample_example:stop@NVDA"
RESURFACE_KIND = "note_level_touch"
RESURFACE_HEADLINE = "Example: NVDA reached 110.00, the stop you wrote about"
RESURFACE_BODY = ("Example -- this is what resurfacing looks like: a price your note named, "
                   "touched. Not a live alert.")

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
    `chart_blocks.extract_blocks` reads straight off the note, no live call) and as the
    entry context's `fingerprint` field."""
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


def _static_entry_context_fields(symbol: str, entry_day: str, report_day: str) -> dict[str, dict]:
    """The eight `entry_context.FIELDS`, hand-written -- never `build_context()`, which can
    make a live earnings-date vendor read (`_next_report_date`). See `entry_context.freeze_static`."""
    fp = _static_fingerprint(symbol, entry_day)
    return {
        "regime": _field("Confirmed Uptrend", entry_context.SRC_REGIME, entry_day),
        "exposure": _field(96.0, entry_context.SRC_EXPOSURE, entry_day),
        "breadth_pct_above_50": _field(61.4, entry_context.SRC_BREADTH_WIRE, entry_day,
                                        {"universe": "wire"}),
        "rs_rank": _field(92, entry_context.SRC_RS, entry_day, {"rsScore": 2.7}),
        "days_to_earnings": _field(34, entry_context.SRC_EARNINGS, entry_day,
                                    {"reportDate": report_day, "countedFrom": entry_day}),
        "uct_scans": _field(["pullback_ma"], entry_context.SRC_UCT_SCANS, entry_day,
                             {"scans": ["pullback_ma", "remount", "gapper_news"]}),
        "member_screens": _field([], entry_context.SRC_SCREENS, entry_day, {"swept": 0}),
        "fingerprint": _field(fp, entry_context.SRC_FINGERPRINT, entry_day,
                               {"version": fp["v"], "mode": fp["mode"]}),
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


def _bullets(*items: str) -> dict:
    return {"type": "bulletList", "content": [
        {"type": "listItem", "content": [_p(it)]} for it in items]}


def _chart_embed(*, embed_id: str, symbol: str, as_of_day: str, annotations: list[dict],
                 setup_tag: str | None = None, shares: float | None = None,
                 fingerprint: dict | None = None, trade_id: str | None = None,
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
    if trade_id:
        attrs["tradeRef"] = trade_id
        attrs["tradeRefType"] = "equity_trade"
    return {"type": "widgetEmbed", "attrs": attrs}


def _plan_note_body(symbol: str, as_of_day: str, captured_at: str, entry: float, stop: float,
                    target: float, shares: float, setup_tag: str, fingerprint: dict,
                    trade_id: str) -> dict:
    annotations = [
        {"role": "entry", "type": "horizontal", "price": entry},
        {"role": "stop", "type": "horizontal", "price": stop},
        {"role": "target", "type": "horizontal", "price": target},
    ]
    return {"type": "doc", "content": [
        _p(("Example", [{"type": "bold"}]), " -- a plan written BEFORE a trade, so plan "
           f"grading has something to check it against. {symbol} is a real ticker; the "
           "numbers are hand-written for this example, not advice."),
        _h(2, "The plan"),
        _bullets(f"Entry {entry:.2f}, stop {stop:.2f}, target {target:.2f}, {int(shares)} shares.",
                 f"Setup: {setup_tag}."),
        _p("The chart below carries the same three lines as drawn levels, plus the "
           "technical fingerprint frozen for this day -- open it to see the fingerprint panel."),
        _chart_embed(embed_id="ex-plan", symbol=symbol, as_of_day=as_of_day, captured_at=captured_at,
                    annotations=annotations, setup_tag=setup_tag, shares=shares,
                    fingerprint=fingerprint, trade_id=trade_id),
        _p("A closed trade is linked to this note already, so Plan vs. Execution grading "
           "has already run -- open the trade in the Trade Journal to see the four checks."),
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
           "stop written in the note's own words. Thesis chips read the status and the "
           "stop from here; resurfacing watches the stop."),
        _h(2, "The thesis"),
        _p("Leadership names that held up best through the last pullback make new highs first."),
        _p(f"Stop: {stop:.2f}"),
        _p("A Watchlist or Open Positions row for this symbol shows a small chip with the "
           "status above and this stop. This example also seeds one resurfacing notice in "
           "the Voice Insights Inbox (Settings > Compass), as if the stop had just been "
           "touched -- \"here's what you thought then.\""),
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

    Returns {"noteIds": [...], "tradeId": str|None, "entryContext": {symbol, entryDay}|None,
    "passedSetupId": str|None, "insightId": int|None, "errors": {capability: str}}."""
    today = _et_today()
    note_ids: list[str] = []
    errors: dict[str, str] = {}
    result: dict[str, Any] = {"noteIds": note_ids, "tradeId": None, "entryContext": None,
                              "passedSetupId": None, "insightId": None, "errors": errors}

    # -- plan grading / chart plan / TA fingerprint / entry context / visual playbook -------
    entry_date = today - timedelta(days=45)
    exit_date = today - timedelta(days=10)
    entry_price, stop_price, target_price, shares = 180.0, 170.0, 205.0, 100.0
    exit_price = 207.5   # beyond the target's 0.25R shortfall line: an unambiguous "hit"
    setup_tag = "Classic Flag/Pullback"
    entry_day = compute_trading_day_et(f"{_iso(entry_date)}T16:00:00Z") or _iso(entry_date)
    try:
        trade = trades_service.create_trade_manual(user_id, {
            "symbol": SYM_PLAN, "side": "Long", "shares": shares, "entryPrice": entry_price,
            "entryDate": _iso(entry_date), "exitPrice": exit_price, "exitDate": _iso(exit_date),
            "originalStop": stop_price, "setup": setup_tag,
            "notes": "Example trade seeded with the sample notebook, for Plan vs. Execution grading.",
        }, {"breakevenRange": {"enabled": False, "unit": "$", "value": 0}}, conn=conn)
        trade_id = trade["id"]
        result["tradeId"] = trade_id
        fp = _static_fingerprint(SYM_PLAN, entry_day)
        plan_note_id = _own_import(
            user_id, conn, "plan",
            f"Trade plan: example -- {SYM_PLAN} pullback",
            _plan_note_body(SYM_PLAN, entry_day, f"{entry_day}T16:00:00Z", entry_price, stop_price,
                            target_price, shares, setup_tag, fp, trade_id))
        note_ids.append(plan_note_id)
        # Pure projections and pure arithmetic -- no live read reaches any of these three.
        chart_blocks.catch_up(user_id, conn=conn)
        report_day = _iso(entry_date + timedelta(days=34))
        entry_context.freeze_static(
            user_id, SYM_PLAN, entry_day,
            _static_entry_context_fields(SYM_PLAN, entry_day, report_day),
            capture_day=entry_day, conn=conn)
        result["entryContext"] = {"symbol": SYM_PLAN, "entryDay": entry_day}
        trade_row = plan_grading.get_trade(conn, user_id, trade_id)
        if trade_row is not None:
            plan_grading.grade_payload(conn, user_id, trade_row)
    except Exception as e:  # noqa: BLE001 -- one capability's failure never stops the rest
        log.warning("[sample_examples] plan-grading example failed", exc_info=True)
        errors["planGrading"] = str(e)

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

    # -- thesis chips / resurfacing -------------------------------------------------------------
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
            insight_id = _add_resurface_insight(user_id)
            if insight_id is not None:
                result["insightId"] = insight_id
                note_levels.record_fire(conn, user_id, RESURFACE_FIRE_KEY, _iso(today),
                                        insight_id, RESURFACE_KIND, thesis_note_id, None)
    except Exception as e:  # noqa: BLE001
        log.warning("[sample_examples] thesis/resurfacing example failed", exc_info=True)
        errors["thesisResurfacing"] = str(e)

    # -- passed setups --------------------------------------------------------------------------
    try:
        saved_on = _iso(today - timedelta(days=20))
        out = passed_setups.add_manual(user_id, SYM_PASSED, saved_on, conn=conn)
        result["passedSetupId"] = out["item"]["id"]
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


def _add_resurface_insight(user_id: str) -> int | None:
    from api.services import voice_proactive_service
    return voice_proactive_service.add_insight(
        user_id, kind=RESURFACE_KIND, headline=RESURFACE_HEADLINE, symbol=SYM_THESIS,
        body=RESURFACE_BODY, importance=8)


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
    """Undo everything `seed()` wrote that a note's own Trash cannot: the trade (hard
    delete, the trades door's own), the entry context row (hard delete, `entry_context.
    forget`), the passed setup (dismissed -- that capability's own "remove" verb, same as a
    member's), and the resurfacing insight (dismissed -- same). The example NOTES are not
    handled here: their ids are folded into `sample_notebook`'s own `ids` list, so the
    existing Trash loop in `sample_notebook.remove()` covers them for free, exactly like the
    five base notes -- restorable, consistent with how this whole feature already treats
    "removed"."""
    out = {"tradeDeleted": False, "entryContextDeleted": False, "passedSetupDismissed": False,
          "insightDismissed": False}
    trade_id = recorded.get("tradeId")
    if trade_id:
        try:
            out["tradeDeleted"] = trades_service.delete_trade(user_id, trade_id, conn=conn)
        except Exception:  # noqa: BLE001 -- one piece failing must not block the rest
            log.warning("[sample_examples] could not delete the example trade", exc_info=True)
    ectx = recorded.get("entryContext")
    if isinstance(ectx, dict) and ectx.get("symbol") and ectx.get("entryDay"):
        try:
            out["entryContextDeleted"] = entry_context.forget(
                user_id, ectx["symbol"], ectx["entryDay"], conn=conn)
        except Exception:  # noqa: BLE001
            log.warning("[sample_examples] could not forget the example entry context", exc_info=True)
    passed_id = recorded.get("passedSetupId")
    if passed_id:
        try:
            out["passedSetupDismissed"] = passed_setups.dismiss(user_id, passed_id, conn=conn)
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
