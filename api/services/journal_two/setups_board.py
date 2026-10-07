"""The active setups board: the member's open plans, closest to trigger first (wave 13, lane 13J).

Every open plan or watch note with plan levels DRAWN on a chart becomes one card: the symbol,
the member's own lines (entry, stop, target), the distance from the last price to the entry in
percent and in R, and the days the setup has been on the board. The route is
`api/routers/notebook_setups_board.py`; the page is `components/notebook/SetupsBoard.jsx`.

⛔⛔ THE LEVELS ARE READ BY `plan_extract.read_note_plan` AND BY NOTHING HERE. This module never
looks inside an annotation, a canvas or a labelled line for a number: it asks the one reader
(`plan_extract.py`, the authority 13A grades from) for the note's plan per symbol, and keeps the
card only when the ENTRY was read off a drawn shape (`chart`, or the trade-plan `canvas`). A
second parser here would be a second authority over the member's numbers, and it would drift
from the grade the first time a template changed. The rail is
`tests/test_notebook_setups_board.py::test_the_board_reads_levels_only_through_plan_extract`,
which swaps the reader and watches every number on the card follow it.

WHICH NOTES (all deterministic, all read-only):
  * the member's live notes (not trashed, not archived) that hold a chart embed, per the save
    path's own `j2_note_embeds` sidecar -- the same "which notes hold a chart" answer
    `chart_blocks.catch_up` uses -- newest edit first, at most `SCAN_CAP` notes per read;
  * one card per (note, symbol): the note's ticker and every chart block's symbol
    (`chart_blocks.extract_blocks`, the index's own pure reader of a block's symbol);
  * OPEN means not yet acted on: a plan 13A has already frozen against a trade for this note
    and symbol (`j2_trade_plan_links`) is done, and a note tagged as a plan REVIEW
    (`plan_grading.REVIEW_TAG`) is a look back, never a setup.

THE MATHS (pure, pinned on fixtures in the tests):
  * side: long when the stop is below the entry, short when above, unknown without a stop
    (a WATCH note is often just a trigger line);
  * distance: how far price still has to travel to the entry, in the trade's direction:
        long   gap = entry - price        short  gap = price - entry
        pct    = gap / price x 100        R      = gap / |entry - stop|
    positive is still waiting, zero or negative has triggered. Without a stop the side is
    unknown, so the gap is unsigned and R is not defined;
  * state: `waiting`, `triggered`, `invalidated` (price is through the stop: a long at or below
    it, a short at or above it), `watching` (no stop), or `no_price`;
  * days in setup: calendar days from the note's creation (ET) to today (ET);
  * the order: waiting / watching / triggered by |pct| ascending, then the invalidated, then the
    cards with no price; ties by symbol, then note id. `sort_key` is the one place it lives.

THE PRICE. The last price is the server's live tick when the shared stream is already carrying
the symbol (`bar_broadcaster.get_last_price`, the one in-process feed every chart rides), else
the last stored daily close (`bars_sqlite`, one indexed row). Each card says which, and when.
No vendor call and no model call is reachable from here, and nothing here writes a note.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date, datetime
from typing import Any, Callable, Iterable

from api.services.journal_two import chart_blocks, chart_plan, plan_extract, sample_marker
from api.services.journal_two.timeutil import ET, compute_trading_day_et
from api.services.notebook_flags import flag_on

log = logging.getLogger(__name__)

#: The enablement gate (unset = OFF; WAVE-13-PLAN section 3.6).
FLAG = "NOTEBOOK_SETUPS_BOARD_ENABLED"

#: Notes read per board request, newest edit first. A member with more chart notes than this
#: sees the most recently worked ones; the response says it was capped.
SCAN_CAP = 200

#: The shapes that count as DRAWN levels (plan_extract.NOTE_SHAPES' first two).
DRAWN_SHAPES = ("chart", "canvas")

#: Cards on one page of the board: the multi-chart grid's own cell cap
#: (`app/src/pages/charts/grid/gridLayouts.js` GRID_MAX_CELLS = 16). The client imports that
#: constant; this copy only shapes the response and is pinned equal to it by a test.
PAGE_SIZE = 16

STATES = ("waiting", "watching", "triggered", "invalidated", "no_price")
#: The sort bucket of each state: the live setups first, then the broken ones, then the blind.
_BUCKET = {"waiting": 0, "watching": 0, "triggered": 0, "invalidated": 1, "no_price": 2}


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(FLAG, False)


def plan_drawing() -> dict[str, Any]:
    """Whether a member can draw a NEW plan on a chart right now (fin walk P7).

    A card comes from an entry line drawn in the chart plan panel, which has its own switch.
    The board still shows cards that already exist while that switch is off, but its empty
    state tells the member to draw one. This says whether they can, read from the chart plan's
    own gate and never restated here."""
    if chart_plan.enabled():
        return {"available": True, "reason": None, "sentence": None}
    return {"available": False, "reason": "chart_plan_off",
            "sentence": "Drawing a plan on a chart is switched off, so no new setup can be added here yet."}


# ── the pure maths ──────────────────────────────────────────────────────────────────────────

def _r2(v: float | None) -> float | None:
    return None if v is None else round(v + 0.0, 2)


def plan_side(entry: float | None, stop: float | None) -> str | None:
    if entry is None or stop is None or entry == stop:
        return None
    return "long" if stop < entry else "short"


def distance_to_trigger(entry: float | None, stop: float | None, price: float | None) -> dict[str, Any]:
    """{side, state, gap, pct, r} for one setup. Pure; see the module docstring."""
    side = plan_side(entry, stop)
    if entry is None or price is None or not (price > 0):
        return {"side": side, "state": "no_price", "gap": None, "pct": None, "r": None}
    if side == "long":
        gap = entry - price
        broken = price <= stop
    elif side == "short":
        gap = price - entry
        broken = price >= stop
    else:
        gap = abs(entry - price)
        broken = False
    risk = abs(entry - stop) if side else None
    pct = gap / price * 100.0
    r = gap / risk if risk else None
    if side is None:
        state = "watching"
    elif broken:
        state = "invalidated"
    elif gap > 0:
        state = "waiting"
    else:
        state = "triggered"
    return {"side": side, "state": state, "gap": _r2(gap), "pct": _r2(pct), "r": _r2(r)}


def days_in_setup(created_at: str | None, today: str) -> int | None:
    """Calendar days from the note's creation day (ET) to `today` ('YYYY-MM-DD', ET)."""
    day = compute_trading_day_et(created_at) if created_at else None
    if not day:
        return None
    try:
        return max(0, (date.fromisoformat(today) - date.fromisoformat(day)).days)
    except ValueError:
        return None


def sort_key(card: dict[str, Any]) -> tuple:
    """THE board order: closeness to entry. One function, so the route and the tests agree."""
    pct = card.get("distancePct")
    return (_BUCKET.get(card.get("state"), 2),
            abs(pct) if pct is not None else float("inf"),
            card.get("symbol") or "", card.get("noteId") or "")


# ── the price ───────────────────────────────────────────────────────────────────────────────

def _ymd_iso(ts: Any) -> str | None:
    s = str(ts or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 and s[:8].isdigit() else None


def read_prices(symbols: Iterable[str]) -> dict[str, dict[str, Any]]:
    """{symbol: {price, source, asOf}} -- the live tick when the shared stream carries the symbol,
    else the last stored daily close. A symbol neither can answer is absent."""
    out: dict[str, dict[str, Any]] = {}
    try:
        from api.services import bar_broadcaster
        bc = bar_broadcaster.get_broadcaster()
    except Exception:  # noqa: BLE001 -- not initialised (a job, a test): closes only
        bc = None
    for sym in symbols:
        if bc is not None:
            try:
                live = bc.get_last_price(sym)
            except Exception:  # noqa: BLE001
                live = None
            if live and isinstance(live.get("price"), (int, float)) and live["price"] > 0:
                ts = live.get("ts")
                as_of = (datetime.fromtimestamp(ts / 1000.0, tz=ET).isoformat(timespec="minutes")
                         if isinstance(ts, (int, float)) and ts > 0 else None)
                out[sym] = {"price": float(live["price"]), "source": "live", "asOf": as_of}
                continue
        try:
            from api.services import bars_sqlite
            rows = bars_sqlite.get_bars(sym, "D", 1) or []
        except Exception:  # noqa: BLE001 -- a store that cannot be read: no price, said so
            log.warning("[setups_board] last close unreadable for %s", sym, exc_info=True)
            rows = []
        if rows and rows[-1][4] is not None and rows[-1][4] > 0:
            out[sym] = {"price": float(rows[-1][4]), "source": "close", "asOf": _ymd_iso(rows[-1][0])}
    return out


# ── the board ───────────────────────────────────────────────────────────────────────────────

def _today_et() -> str:
    return datetime.now(ET).date().isoformat()


def _prop_defs(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    try:
        from api.services.journal_two.note_properties import list_property_defs
        return list_property_defs(user_id, conn=conn)
    except Exception:  # noqa: BLE001 -- no property shape is then read; never a 500
        return []


def _candidate_notes(conn: sqlite3.Connection, user_id: str, cap: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT n.id, n.title, n.ticker, n.tags, n.body_json, n.properties_json, n.created_at,"
        " n.updated_at, n.import_source FROM j2_notes n"
        " WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL"
        "   AND n.id IN (SELECT e.note_id FROM j2_note_embeds e WHERE e.user_id = ? AND e.widget_id = ?)"
        " ORDER BY n.updated_at DESC, n.id LIMIT ?",
        (user_id, user_id, chart_blocks.CHART_WIDGET, cap + 1)).fetchall()


def _consumed(conn: sqlite3.Connection, user_id: str) -> set[tuple[str, str]]:
    """(note id, symbol) pairs 13A already froze against a trade: the plan was acted on."""
    try:
        return {(r[0], (r[1] or "").upper()) for r in conn.execute(
            "SELECT note_id, symbol FROM j2_trade_plan_links WHERE user_id = ? AND note_id IS NOT NULL",
            (user_id,))}
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            return set()
        raise


def _is_review(tags_json: Any) -> bool:
    from api.services.journal_two.plan_grading import REVIEW_TAG
    try:
        tags = json.loads(tags_json or "[]")
    except (ValueError, TypeError):
        return False
    return isinstance(tags, list) and REVIEW_TAG in tags


def _symbols(note: sqlite3.Row, blocks: list[dict]) -> list[str]:
    seen: list[str] = []
    for s in [note["ticker"]] + [b["symbol"] for b in blocks]:
        s = (s or "").strip().lstrip("$").upper() if isinstance(s, str) else ""
        if s and s not in seen:
            seen.append(s)
    return seen


def build_cards(conn: sqlite3.Connection, user_id: str, *, today: str | None = None,
                prices: Callable[[Iterable[str]], dict] | None = None,
                read_plan: Callable[..., Any] | None = None,
                cap: int = SCAN_CAP) -> dict[str, Any]:
    """The member's board, sorted. `prices` and `read_plan` are injectable for the rails only;
    production passes neither (`read_prices`, `plan_extract.read_note_plan`)."""
    today = today or _today_et()
    reader = read_plan or plan_extract.read_note_plan
    rows = _candidate_notes(conn, user_id, cap)
    capped = len(rows) > cap
    rows = rows[:cap]
    defs = _prop_defs(conn, user_id)
    consumed = _consumed(conn, user_id)
    pending: list[dict[str, Any]] = []
    for note in rows:
        if _is_review(note["tags"]):
            continue
        try:
            body = json.loads(note["body_json"] or "{}")
        except (ValueError, TypeError, RecursionError):      # too deep to parse: no card (M-4)
            continue
        blocks = chart_blocks.extract_blocks(body)
        for sym in _symbols(note, blocks):
            if (note["id"], sym) in consumed:
                continue
            reading = reader(body, note["properties_json"], defs, sym)
            entry_role = reading.role("entry")
            if entry_role.state != plan_extract.STATE_OK or entry_role.shape not in DRAWN_SHAPES:
                continue
            tagged = next((b for b in blocks if b["symbol"] == sym and b["setup_tag"]), None)
            pending.append({
                "noteId": note["id"],
                "noteTitle": note["title"] or "",
                "symbol": sym,
                "entry": reading.value("entry"),
                "stop": reading.value("stop"),
                "target": reading.value("target"),
                "levelShape": entry_role.shape,
                "setupTag": reading.setup,
                "daysInSetup": days_in_setup(note["created_at"], today),
                "since": compute_trading_day_et(note["created_at"]),
                "similarEmbedKey": tagged["embed_key"] if tagged else None,
                # ⛔ MARKED BY THE SERVER, with the one predicate (owner ruling, fin-data round
                # 2). A sample's card is shown -- that is what the sample is for -- and it is
                # never one of the member's setups: it is in no count below, and the client
                # labels it "Example" from this flag, never by guessing from a title.
                "example": sample_marker.is_sample(note["import_source"]),
            })
    quotes = (prices or read_prices)(sorted({c["symbol"] for c in pending}))
    cards = []
    for c in pending:
        q = quotes.get(c["symbol"]) or {}
        d = distance_to_trigger(c["entry"], c["stop"], q.get("price"))
        cards.append({**c, "side": d["side"], "state": d["state"], "price": q.get("price"),
                      "priceSource": q.get("source"), "priceAsOf": q.get("asOf"),
                      "distancePct": d["pct"], "distanceR": d["r"]})
    cards.sort(key=sort_key)
    own = [c for c in cards if not c["example"]]
    examples = [c for c in cards if c["example"]]
    # The member's own setups first, in the board's order; examples after them. `count` is the
    # member's own and is what every "N setups" and every empty-state decision reads.
    return {"cards": own + examples, "count": len(own), "exampleCount": len(examples),
            "today": today, "pageSize": PAGE_SIZE, "scanned": len(rows), "capped": capped,
            "planDrawing": plan_drawing()}
