"""The Today home's ONE read (audit 2026-11-05, spec S15 / mockup M1, and S18's evening loop).

`GET /api/j2/notes/today` answers everything the Today home draws, in one member-scoped request:

  todayNote          today's daily note (ET), opened through the daily note door
                     (`note_daily.open_daily_note`) with the member's daily template, and MADE the first time
                     the member opens Today that day. Idempotent: the door's unique index answers a second tab
                     with the note the first one made.
  setups             the setups board (`setups_board.build_cards`), closest to the entry first, the member's own
                     cards only, and how many sit within `NEAR_PCT` of the entry.
  names              "Your names": the member's own lists (watchlist + flagged), each with the last price and the
                     day's move, an earnings date in the window, the expected move and the room's mentions today.
  openFromYesterday  the open checklist items in the most recent earlier daily note, plus tasks due on or before
                     today.
  onThisDay          notes created on this ET calendar date in earlier years.
  market             the regime and breadth line the dashboard already shows, from the HELD wire payload.
  session            the ET session phase that orders the cards, and whether the evening recap is offered.

⛔⛔ EVERY SECTION DEGRADES ON ITS OWN. A section that raises answers `null` and its reason in `reasons`; it never
fails the request and never blanks another section (the Research Home rule, `notebook_home.py`).

⛔⛔ NO VENDOR CALL IS REACHABLE FROM HERE, and no model call. Every market figure is a read of what this pod
already holds:
  * a price is the in-process live tick (`bar_broadcaster`) or the stored daily bars (`bars_sqlite`);
  * the earnings window is `earnings_prep.cached_window` ONLY -- never `_window`, which walks the calendar;
  * the expected move is the stored pre-report capture (`implied_store`) or the calendar's cached overlay, through
    `earnings_prep._expected_move_cell`, which computes nothing;
  * the room's mentions are the local buzz store, read only when its file exists;
  * the market line is `engine.get_breadth(held_only=True)`, never the default call (whose next step on a cold
    engine is a live fetch).
  A figure that is not held is `null`, and the client leaves its cell blank.

TOMORROW'S PLAN (S18) is pre-made the moment the member opens Today on a new day, never ahead of time (that would
need a scheduler): when this read MAKES the day's note, the note starts with a "Today's plan" checklist built from
the same figures -- the market line, the setups near their entry or that moved through their stop, and the
member's names reporting today or before tomorrow's open. Written once, at creation; opening again never re-writes
the member's note.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any, Callable

from api.services.auth_db import get_connection
from api.services.journal_two.timeutil import ET

log = logging.getLogger(__name__)

#: A setup this close to its entry (in percent of price) is "near entry" (M1: "within 3% of entry").
NEAR_PCT = 3.0
#: Rows on each list card. The response says how many more there were.
SETUPS_SHOWN = 5
NAMES_SHOWN = 8
OPEN_ITEMS_SHOWN = 8
PLAN_ITEMS_SHOWN = 6
ON_THIS_DAY_SHOWN = 3
#: How far back "yesterday's" daily note may be (a long weekend, a week away).
YESTERDAY_LOOKBACK_DAYS = 7
#: The session clock, ET. The recap is offered from RECAP_FROM (S18: "After the close (16:05 ET)").
OPEN_AT = (9, 30)
CLOSE_AT = (16, 0)
RECAP_FROM = (16, 5)
#: Mentions today at or above this read as "high" room buzz.
BUZZ_HIGH = 3
SNIPPET_CHARS = 140

SECTIONS = ("market", "setups", "names", "todayNote", "openFromYesterday", "onThisDay")


# ── the clock ──────────────────────────────────────────────────────────────────────────────

def _now_et(now: datetime | None) -> datetime:
    if now is None:
        return datetime.now(ET)
    if now.tzinfo is None:
        now = now.replace(tzinfo=ET)
    return now.astimezone(ET)


def _close_hm(day: date) -> tuple[int, int]:
    """The session's close on `day`, ET: 13:00 on a half-day (the market calendar), else 16:00."""
    try:
        from api.services import session_calendar
        ct = session_calendar.close_time(day)
        if ct is not None:
            return (ct.hour, ct.minute)
    except Exception:  # noqa: BLE001 -- no calendar: the regular close
        pass
    return CLOSE_AT


def session_of(now: datetime) -> dict[str, Any]:
    """{day, phase, minutesToOpen, recap, recapFrom} for an ET instant. `phase` is `premarket` (a session day before
    09:30), `open` (09:30 to the close), `after_close` (from the close: 16:00, or 13:00 on a half-day) or `closed`
    (not a session day). `recap` is True on a session day from five minutes after the close (S18: 16:05)."""
    from api.services.journal_two import trading_days
    day = now.date()
    try:
        session_day = trading_days.is_session(day)
    except Exception:  # noqa: BLE001 -- no calendar: a weekday is a session
        session_day = day.weekday() < 5
    close = _close_hm(day) if session_day else CLOSE_AT
    recap_from = divmod(close[0] * 60 + close[1] + 5, 60)
    hm = (now.hour, now.minute)
    if not session_day:
        phase = "closed"
    elif hm < OPEN_AT:
        phase = "premarket"
    elif hm < close:
        phase = "open"
    else:
        phase = "after_close"
    to_open = None
    if phase == "premarket":
        to_open = (OPEN_AT[0] * 60 + OPEN_AT[1]) - (now.hour * 60 + now.minute)
    return {
        "day": day.isoformat(),
        "weekday": day.strftime("%A"),
        "phase": phase,
        "minutesToOpen": to_open,
        "recap": bool(session_day and hm >= recap_from),
        "recapFrom": f"{recap_from[0]:02d}:{recap_from[1]:02d}" if session_day else None,
    }


# ── small readers ──────────────────────────────────────────────────────────────────────────

def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _r1(v: Any) -> float | None:
    n = _num(v)
    return None if n is None else round(n, 1)


def _r2(v: Any) -> float | None:
    n = _num(v)
    return None if n is None else round(n, 2)


def _plain_text(node: Any, limit: int = SNIPPET_CHARS) -> str:
    """The first `limit` characters of a TipTap doc's text, blocks joined by a space."""
    parts: list[str] = []
    size = 0

    def walk(n: Any) -> None:
        nonlocal size
        if size >= limit or not isinstance(n, dict):
            return
        if n.get("type") == "text" and isinstance(n.get("text"), str):
            parts.append(n["text"])
            size += len(n["text"])
            return
        for c in n.get("content") or []:
            walk(c)
        if n.get("type") in ("paragraph", "heading", "listItem", "taskItem", "blockquote"):
            parts.append(" ")

    walk(node)
    text = " ".join("".join(parts).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _heading_texts(body: Any) -> list[str]:
    out = []
    for n in (body or {}).get("content") or [] if isinstance(body, dict) else []:
        if isinstance(n, dict) and n.get("type") == "heading":
            out.append(_plain_text(n, 200))
    return out


def _quote(sym: str, today: str, live: dict | None) -> dict[str, Any]:
    """{price, changePct, source, asOf} from what the pod holds: the live tick when the shared stream carries the
    symbol, else the last stored daily close; the move against the last close BEFORE the price's own day."""
    from api.services import bars_sqlite
    rows = []
    try:
        rows = bars_sqlite.get_bars(sym, "D", 3) or []
    except Exception:  # noqa: BLE001 -- a store that cannot be read: no price
        rows = []
    closes = [(str(r[0])[:8], r[4]) for r in rows if r and _num(r[4]) and r[4] > 0]
    today_key = today.replace("-", "")
    if live and _num(live.get("price")) and live["price"] > 0:
        prior = [c for d, c in closes if d < today_key]
        prev = prior[-1] if prior else None
        price = float(live["price"])
        return {"price": _r2(price), "changePct": _r2((price - prev) / prev * 100) if prev else None,
                "source": "live", "asOf": live.get("asOf")}
    if closes:
        d, c = closes[-1]
        prev = closes[-2][1] if len(closes) > 1 else None
        return {"price": _r2(c), "changePct": _r2((c - prev) / prev * 100) if prev else None,
                "source": "close", "asOf": f"{d[:4]}-{d[4:6]}-{d[6:8]}"}
    return {"price": None, "changePct": None, "source": None, "asOf": None}


def _live_ticks(symbols: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        from api.services import bar_broadcaster
        bc = bar_broadcaster.get_broadcaster()
    except Exception:  # noqa: BLE001 -- not initialised (a job, a test): closes only
        return out
    for sym in symbols:
        try:
            got = bc.get_last_price(sym)
        except Exception:  # noqa: BLE001
            got = None
        if got and _num(got.get("price")):
            ts = got.get("ts")
            as_of = (datetime.fromtimestamp(ts / 1000.0, tz=ET).isoformat(timespec="minutes")
                     if _num(ts) and ts > 0 else None)
            out[sym] = {"price": got["price"], "asOf": as_of}
    return out


# ── the sections ───────────────────────────────────────────────────────────────────────────

class SectionUnavailable(Exception):
    """A section that is not this member's to see (or not held), with a reason code -- not an error."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


#: Why a paid-only figure is withheld from a session without a paid plan (fix round 1, I6). They are the figures
#: whose own routers are `require_paid`: the setups board, the earnings window and expected move (earnings prep),
#: and the market line.
PLAN_REASON = "plan"


def market_section(ctx: dict) -> dict[str, Any]:
    """The dashboard's own regime and breadth, from the HELD wire payload. Nothing held: every field null."""
    if not ctx["paid"]:
        raise SectionUnavailable(PLAN_REASON)
    from api.services import engine
    from api.services.journal_two import regime as regime_service
    from api.services.journal_two.trader_blocks import readings_from
    payload = engine.get_breadth(held_only=True)
    b = payload if isinstance(payload, dict) else {}
    reading = readings_from(b)
    exp = b.get("exposure") if isinstance(b.get("exposure"), dict) else None
    reg = regime_service.regime_from_exposure(exp)
    return {
        "held": bool(b),
        "regime": reg.get("regime"),
        "regimeWord": regime_service.regime_word(reg.get("regime")),
        "exposureScore": reading.get("exposureScore"),
        "exposureDelta": reading.get("exposureDelta"),
        "pctAbove50": reading.get("pctAbove50"),
        "pctAbove200": reading.get("pctAbove200"),
        "marketPhase": reading.get("marketPhase"),
        "asOf": reg.get("asOf") or b.get("wire_date"),
    }


def setups_section(ctx: dict) -> dict[str, Any]:
    """The setups board's answer, the member's own cards only (an example card is never one of their setups)."""
    from api.services.journal_two import setups_board
    if not ctx["paid"]:
        raise SectionUnavailable(PLAN_REASON)
    conn = ctx["conn"]
    board = setups_board.build_cards(conn, ctx["user_id"], today=ctx["day"])
    own = [c for c in board.get("cards") or [] if not c.get("example")]
    near = [c for c in own if c.get("state") in ("waiting", "watching")
            and _num(c.get("distancePct")) is not None and abs(c["distancePct"]) <= NEAR_PCT]
    rows = [{
        "noteId": c.get("noteId"), "noteTitle": c.get("noteTitle") or "", "symbol": c.get("symbol"),
        "setupTag": c.get("setupTag"), "state": c.get("state"), "side": c.get("side"),
        "entry": c.get("entry"), "stop": c.get("stop"), "distancePct": c.get("distancePct"),
        "distanceR": c.get("distanceR"), "price": c.get("price"),
    } for c in own[:SETUPS_SHOWN]]
    return {
        "count": len(own),
        "nearCount": len(near),
        "rows": rows,
        "more": max(0, len(own) - SETUPS_SHOWN),
        "exampleCount": int(board.get("exampleCount") or 0),
        # The cards that MOVED: through the entry or through the stop (S18's tomorrow's plan reads these).
        "triggered": [c.get("symbol") for c in own if c.get("state") == "triggered"],
        "belowStop": [c.get("symbol") for c in own if c.get("state") == "invalidated"],
        "planDrawing": board.get("planDrawing"),
    }


def _held_earnings_window(day: date) -> tuple | None:
    from api.services.journal_two import earnings_prep
    try:
        return earnings_prep.cached_window(day)
    except Exception:  # noqa: BLE001 -- an unreadable cache is a miss, never a walk
        return None


def _buzz_counts(symbols: list[str], now: datetime) -> dict[str, int] | None:
    """{SYM: mentions in the room today}, or None when the room's store is not on this pod. Asked for the rows
    SHOWN only (fix round 1, I5)."""
    from api.services import buzz_boards, buzz_store
    if not symbols or not os.path.exists(buzz_store.db_path()):
        return None
    start, end = buzz_boards.window_bounds("today", int(now.timestamp()))
    chans = buzz_boards._channels()
    return {s: int(buzz_store.count(s, start, end, chans)) for s in symbols}


def own_names(conn: sqlite3.Connection, user_id: str) -> list[str]:
    """The member's own names -- every list they own (Flagged is one of them), never the prebuilt index lists --
    each once, in list order (lists by creation, items by their own order). ONE query: the card never needs the
    positions and UCT20 sources `member_interest` also reads (fix round 1, I5). A read that fails RAISES, so the
    card says it could not read the names instead of asking a member who has names for three (M7)."""
    rows = conn.execute(
        "SELECT wi.sym FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id"
        " WHERE w.user_id = ? AND COALESCE(w.is_prebuilt, 0) = 0"
        " ORDER BY w.created_at, w.id, wi.sort_order, wi.added_at, wi.id",
        (user_id,)).fetchall()
    out: list[str] = []
    seen: set[str] = set()
    for r in rows:
        sym = str(r[0] or "").strip().upper()
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def names_section(ctx: dict) -> dict[str, Any]:
    """Your names: the member's own names, each with what UCT already holds about it.

    ⛔ BOUNDED (fix round 1, I5): the rows are PICKED FIRST, on what costs nothing per symbol -- reporting today (a
    lookup in the held window) first, then list order -- and cut to `NAMES_SHOWN`. Only then are the bars, the live
    tick, the room's mentions and the expected move read, for those rows alone. A 400-name list costs what an
    8-name list costs.
    ⛔ PAID (I6): the earnings date, its timing and the expected move are earnings prep's figures, a paid route;
    without a paid plan they are left out (`earnings: null`, `earningsWithheld: true`)."""
    from api.services.journal_two import earnings_prep
    symbols = own_names(ctx["conn"], ctx["user_id"])
    day = date.fromisoformat(ctx["day"])
    paid = ctx["paid"]
    window = _held_earnings_window(day) if (symbols and paid) else None
    dates, timing = ({}, {}) if window is None else (window[0] or {}, window[1] or {})
    today_iso = day.isoformat()
    reporting = [s for s in symbols if dates.get(s) == today_iso]
    first = set(reporting)
    shown = (reporting + [s for s in symbols if s not in first])[:NAMES_SHOWN]
    try:
        buzz = _buzz_counts(shown, ctx["now"])
    except Exception:  # noqa: BLE001 -- the room's count is a nicety, never the card
        log.info("[today] buzz counts unreadable", exc_info=True)
        buzz = None
    read_at = ctx["now"].isoformat(timespec="minutes")

    def earnings_of(sym: str) -> dict[str, Any] | None:
        d = dates.get(sym)
        if not d:
            return None
        try:
            days_away = (date.fromisoformat(d) - day).days
        except ValueError:
            return None
        move = None
        try:
            cell = earnings_prep._expected_move_cell(sym, d, earnings_prep._implied_rows(sym), read_at)
            v = cell.get("value") if isinstance(cell, dict) else None
            move = _r1((v or {}).get("pct")) if isinstance(v, dict) else None
        except Exception:  # noqa: BLE001 -- a stored row that cannot be read is a blank cell
            move = None
        return {"date": d, "daysAway": days_away, "timing": timing.get(sym), "expectedMovePct": move}

    live = _live_ticks(shown)
    rows = []
    for sym in shown:
        q = _quote(sym, ctx["day"], live.get(sym))
        mentions = (buzz or {}).get(sym) if buzz is not None else None
        rows.append({"symbol": sym, **q, "earnings": earnings_of(sym), "mentions": mentions,
                     "buzzHigh": bool(mentions is not None and mentions >= BUZZ_HIGH)})
    return {
        "count": len(symbols),
        "rows": rows,
        "more": max(0, len(symbols) - len(shown)),
        # True: the earnings calendar is not held right now, so a blank earnings cell is unknown, not "none".
        "earningsUnknown": bool(symbols) and paid and (window is None or bool(window[2])),
        "earningsWithheld": bool(symbols) and not paid,
        "buzzKnown": buzz is not None,
        "reportingToday": [r["symbol"] for r in rows if r.get("earnings") and r["earnings"]["daysAway"] == 0],
        # The first few names, for the plan line that names them (I9: the member's names reach today's plan).
        "first": symbols[:5],
    }


# ── S18: tomorrow's plan ───────────────────────────────────────────────────────────────────

#: ⛔ The seeded lines are recognised by their OWN WORDING, never by a node attribute: TipTap drops an attribute
#: its schema does not declare the first time the editor loads the note, so a mark on the node would be gone after
#: the member's first edit. A line the member edits no longer matches and is theirs (fix round 1, I4).
#: ⛔ ONE TABLE (fix round 2, N3): `SEED_FORMATS` is the only place a line's wording lives. The writer
#: (`_plan_lines`) fills its slots with `str.format`; the matcher is DERIVED from the same strings, the literal parts
#: escaped and each slot replaced by the pattern of the values the writer can put there. A new wording cannot be
#: written without being matched, and the matcher cannot drift to something the writer never says.
_TK = r"[A-Z][A-Z0-9.\-]{0,9}"
SEED_FORMATS: tuple[tuple[str, str], ...] = (
    ("market", "Check the market: {regime} regime, {pct}% above the 50-day"),
    ("market", "Check the market: {regime} regime"),
    ("market", "Check the market: {pct}% above the 50-day"),
    ("near", "Review the {n} {setups} within {near}% of entry"),
    ("below", "Review {sym}: below stop"),
    ("triggered", "{sym} triggered: check the entry"),
    ("earnings", "Prep ${sym} earnings ({when})"),
    ("earnings_tomorrow", "Prep ${sym} earnings (tomorrow before the open)"),
    ("names", "Check your names: {syms}"),
)
#: The values each slot can hold, as patterns. `regime` is the member-facing regime words (regime.regime_words).
_EARNINGS_WHEN = {"bmo": "before the open", "amc": "after the close"}
_SLOTS = {
    "pct": r"\d+(?:\.\d+)?",
    "n": r"\d+",
    "setups": r"setups?",
    "near": r"\d+(?:\.\d+)?",
    "sym": _TK,
    "when": "(?:" + "|".join(re.escape(w) for w in (*_EARNINGS_WHEN.values(), "today")) + ")",
    "syms": rf"{_TK}(?:, {_TK})*",
}
PLAN_HEADING = "Today's plan"
_SLOT_RE = re.compile(r"\{(\w+)\}")
_matchers: list[re.Pattern] | None = None


def _fmt(kind: str, **slots: Any) -> str:
    """The first SEED_FORMATS line of `kind` whose slots are exactly `slots`, filled in."""
    for k, f in SEED_FORMATS:
        if k == kind and set(_SLOT_RE.findall(f)) == set(slots):
            return f.format(**slots)
    raise KeyError((kind, sorted(slots)))


def _seed_matchers() -> list[re.Pattern]:
    global _matchers
    if _matchers is None:
        from api.services.journal_two.regime import regime_words
        slots = {**_SLOTS, "regime": "(?:" + "|".join(re.escape(w) for w in regime_words().values()) + ")"}
        out = []
        for _kind, f in SEED_FORMATS:
            parts, pos = [], 0
            for m in _SLOT_RE.finditer(f):
                parts.append(re.escape(f[pos:m.start()]))
                parts.append(slots[m.group(1)])
                pos = m.end()
            parts.append(re.escape(f[pos:]))
            out.append(re.compile("^" + "".join(parts) + "$"))
        _matchers = out
    return _matchers


def is_seed_line(text: Any) -> bool:
    """Is this checklist line one Today wrote (and the member has not changed)?"""
    t = " ".join(str(text or "").split())
    return any(p.match(t) for p in _seed_matchers())


def _plan_lines(ctx: dict, market: dict | None, setups: dict | None, names: dict | None, *,
                cap: int = PLAN_ITEMS_SHOWN) -> list[str]:
    lines: list[str] = []
    if market and (market.get("regimeWord") or market.get("pctAbove50") is not None):
        slots = {}
        if market.get("regimeWord"):
            slots["regime"] = market["regimeWord"]
        if market.get("pctAbove50") is not None:
            slots["pct"] = f"{market['pctAbove50']:g}"
        lines.append(_fmt("market", **slots))
    if setups:
        n = int(setups.get("nearCount") or 0)
        if n:
            lines.append(_fmt("near", n=n, setups="setup" if n == 1 else "setups", near=f"{NEAR_PCT:g}"))
        for sym in (setups.get("belowStop") or [])[:3]:
            lines.append(_fmt("below", sym=sym))
        for sym in (setups.get("triggered") or [])[:3]:
            lines.append(_fmt("triggered", sym=sym))
    if names:
        day = date.fromisoformat(ctx["day"])
        tomorrow = (day + timedelta(days=1)).isoformat()
        for r in names.get("rows") or []:
            e = r.get("earnings") or {}
            if e.get("date") == day.isoformat():
                lines.append(_fmt("earnings", sym=r["symbol"], when=_EARNINGS_WHEN.get(e.get("timing"), "today")))
            elif e.get("date") == tomorrow and e.get("timing") == "bmo":
                lines.append(_fmt("earnings_tomorrow", sym=r["symbol"]))
        first = [s for s in (names.get("first") or []) if re.fullmatch(_TK, s)]
        if first:
            lines.append(_fmt("names", syms=", ".join(first)))
    return lines[:cap]


def _plan_seed(ctx: dict, market: dict | None, setups: dict | None, names: dict | None) -> list[dict]:
    """S18's tomorrow's plan, made at the first open of the day: a "Today's plan" heading and checklist from what
    this read already holds. Empty when nothing is held (the note is then exactly the member's template).
    `note_daily` puts the checklist under the template's own "Today's plan" heading when it has one (M9)."""
    lines = _plan_lines(ctx, market, setups, names)
    if not lines:
        return []
    items = [{"type": "taskItem", "attrs": {"checked": False},
              "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]}]} for t in lines]
    return [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": PLAN_HEADING}]},
        {"type": "taskList", "content": items},
    ]


def plan_seed_for(user_id: str, *, paid: bool, now: datetime | None = None) -> list[dict]:
    """The same seed for a door that MAKES the day's note outside this read (the first run's Build, Today's "Start
    a fresh one"): the market, setups and names sections, each best-effort, then `_plan_seed`."""
    now_et = _now_et(now)
    conn = get_connection()
    try:
        conn.row_factory = sqlite3.Row
        ctx = {"user_id": str(user_id), "paid": bool(paid), "now": now_et, "day": now_et.date().isoformat(),
               "conn": conn}
        got: dict[str, Any] = {}
        for key, fn in (("market", market_section), ("setups", setups_section), ("names", names_section)):
            try:
                got[key] = fn(ctx)
            except Exception:  # noqa: BLE001 -- a part that cannot be read is left out of the plan
                got[key] = None
        return _plan_seed(ctx, got["market"], got["setups"], got["names"])
    finally:
        conn.close()


# ── today's note ───────────────────────────────────────────────────────────────────────────

def _recap_headings(day: date) -> tuple[str, str]:
    """The two headings `reviewDrafts.js recapHeading` writes for `day` ("Today's recap — Nov 5")."""
    short = f"{day.strftime('%b')} {day.day}"
    return (f"Today's recap — {short}", f"Recap — {short}")


def _trashed_daily_id(conn: sqlite3.Connection, user_id: str, day: str) -> str | None:
    row = conn.execute(
        "SELECT id FROM j2_notes WHERE user_id = ? AND daily_date = ? AND deleted_at IS NOT NULL"
        " ORDER BY deleted_at DESC LIMIT 1", (user_id, day)).fetchone()
    return row[0] if row else None


def _no_note(**state: Any) -> dict[str, Any]:
    return {"id": None, "trashed": False, "missing": False, "created": False, "items": [], "itemCount": 0,
            "openCount": 0, "recapWritten": False, **state}


def today_note_section(ctx: dict, seed: Callable[[], list[dict]]) -> dict[str, Any]:
    """Today's daily note: OPENED when it exists; MADE (through the daily note door, with the member's template and
    the seed) only when none exists, nothing of today's sits in the Trash, and the caller allows it.

    ⛔ A TRASHED day's note is never replaced by a page view (fix round 1, I3): the answer is `{trashed: true}` and
    the card offers Restore and "Start a fresh one" (the POST door, on that press only).
    ⛔ `make=False` (the first run is pending or open, I9): nothing is made; the answer is `{missing: true}`."""
    from api.services.journal_two import note_daily, note_tasks
    from api.services.journal_two import notes as notes_service
    from api.services.journal_two.note_personal_api import _daily_template_id
    conn, uid, day = ctx["conn"], ctx["user_id"], ctx["day"]
    if not notes_service.find_daily_note_id(uid, day, conn):
        trashed = _trashed_daily_id(conn, uid, day)
        if trashed:
            return _no_note(id=trashed, trashed=True)
        if not ctx.get("make", True):
            return _no_note(missing=True)
    template_id = _daily_template_id(uid)
    out = note_daily.open_daily_note(uid, day, template_id, seed_blocks=seed)
    note = out.get("note") or {}
    body = note.get("bodyJson") if isinstance(note.get("bodyJson"), dict) else {}
    try:
        tasks = note_tasks.extract_tasks(body)
    except Exception:  # noqa: BLE001
        tasks = []
    open_tasks = [t for t in tasks if not t["checked"]]
    template_name = None
    if template_id and not out.get("templateMissing"):
        try:
            from api.services.journal_two import note_templates
            tpl = note_templates.get_template(uid, template_id)
            template_name = (tpl or {}).get("name") or None
        except Exception:  # noqa: BLE001
            template_name = None
    recap = _recap_headings(date.fromisoformat(day))
    return {
        "id": note.get("id"),
        "title": note.get("title") or "",
        "updatedAt": note.get("updatedAt"),
        "created": bool(out.get("created")),
        "trashed": False,
        "missing": False,
        "templateMissing": bool(out.get("templateMissing")),
        "templateName": template_name,
        "items": [{"index": t["index"], "text": " ".join(str(t["text"]).replace("\u0000", " ").split()),
                   "checked": t["checked"]} for t in tasks[:PLAN_ITEMS_SHOWN]],
        "openCount": len(open_tasks),
        "itemCount": len(tasks),
        "snippet": None if tasks else (_plain_text(body) or None),
        # Today's own recap heading (M6), never an older day's "Recap — ..." pasted in.
        "recapWritten": any(h in recap for h in _heading_texts(body)),
    }


def open_from_yesterday_section(ctx: dict) -> dict[str, Any]:
    """The open checklist items the MEMBER wrote or kept in the most recent earlier daily note (never a line Today
    wrote that nobody touched, I4), then tasks due on or before today."""
    from api.services.journal_two import note_tasks
    conn, uid, day = ctx["conn"], ctx["user_id"], ctx["day"]
    lo = (date.fromisoformat(day) - timedelta(days=YESTERDAY_LOOKBACK_DAYS)).isoformat()
    row = conn.execute(
        "SELECT id, title, daily_date, body_json FROM j2_notes WHERE user_id = ? AND daily_date < ?"
        " AND daily_date >= ? AND deleted_at IS NULL ORDER BY daily_date DESC LIMIT 1",
        (uid, day, lo)).fetchone()
    items: list[dict] = []
    seen: set[tuple[str, int]] = set()
    prior = None
    if row:
        prior = {"noteId": row["id"], "title": row["title"] or "", "day": row["daily_date"]}
        try:
            body = json.loads(row["body_json"] or "{}")
        except (ValueError, TypeError, RecursionError):
            body = {}
        for t in note_tasks.extract_tasks(body):
            seen.add((row["id"], t["index"]))
            text = " ".join(str(t["text"]).replace("\u0000", " ").split())
            if t["checked"] or is_seed_line(text):
                continue
            items.append({"noteId": row["id"], "noteTitle": row["title"] or "", "index": t["index"],
                          "text": text, "due": t["due"], "from": "yesterday"})
    due = note_tasks.list_tasks(uid, "open", now=ctx["now"], conn=conn)
    today_note_id = ctx.get("todayNoteId")
    for t in due.get("tasks") or []:
        if not t.get("due") or t["due"] > day:
            continue
        if (t["noteId"], t["index"]) in seen or t["noteId"] == today_note_id:
            continue
        items.append({"noteId": t["noteId"], "noteTitle": t.get("noteTitle") or "", "index": t["index"],
                      "text": t.get("text") or "", "due": t["due"],
                      "from": "overdue" if t["due"] < day else "due"})
    items = [i for i in items if i["text"]]
    return {"count": len(items), "items": items[:OPEN_ITEMS_SHOWN],
            "more": max(0, len(items) - OPEN_ITEMS_SHOWN), "priorDaily": prior}


#: How many earlier years "on this day" looks back, and the rows read per year (M2: bounded per year).
ON_THIS_DAY_YEARS = 10
ON_THIS_DAY_PER_YEAR = 20


def on_this_day_section(ctx: dict) -> dict[str, Any]:
    """Notes created on this ET calendar date in earlier years, newest year first. Never a sample note.

    ⛔ One BOUNDED range per earlier year (M2): `created_at` from the day before to two days after this date in
    that year (string bounds, so a stamp in any ISO spelling falls inside), then each stamp is dated in New York.
    This year's notes are never read, so a busy today cannot crowd out the years before it."""
    from api.services.journal_two import sample_marker
    from api.services.journal_two.trading_days import et_day_of
    conn, uid = ctx["conn"], ctx["user_id"]
    d = date.fromisoformat(ctx["day"])
    md = ctx["day"][5:]
    out = []
    for y in range(d.year - 1, d.year - ON_THIS_DAY_YEARS - 1, -1):
        try:
            then = d.replace(year=y)
        except ValueError:          # Feb 29 in a year without one
            continue
        lo = (then - timedelta(days=1)).isoformat()
        hi = (then + timedelta(days=2)).isoformat()
        rows = conn.execute(
            "SELECT id, title, ticker, created_at, body_json FROM j2_notes WHERE user_id = ?"
            " AND deleted_at IS NULL AND archived_at IS NULL AND " + sample_marker.not_sample_sql() +
            " AND created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
            (uid, lo, hi, ON_THIS_DAY_PER_YEAR)).fetchall()
        for r in rows:
            et = et_day_of(r["created_at"])
            if not et or et[5:] != md or int(et[:4]) != y:
                continue
            try:
                body = json.loads(r["body_json"] or "{}")
            except (ValueError, TypeError, RecursionError):
                body = {}
            out.append({"noteId": r["id"], "title": r["title"] or "", "ticker": r["ticker"], "day": et,
                        "yearsAgo": d.year - y, "snippet": _plain_text(body) or None})
        if len(out) >= ON_THIS_DAY_SHOWN:
            break
    return {"count": len(out), "items": out[:ON_THIS_DAY_SHOWN]}


# ── the one read ───────────────────────────────────────────────────────────────────────────

def get_today(user_id: str, *, paid: bool = True, make: bool = True, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """The Today home's one answer. Every section is independent: a section that raises is `null`, with its reason
    in `reasons` (`error`, or a `SectionUnavailable` code such as `plan`). `make=False` never makes the day's note
    (the first run is pending, I9)."""
    now_et = _now_et(now)
    session = session_of(now_et)
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
    except Exception:  # noqa: BLE001
        pass
    ctx: dict[str, Any] = {"user_id": str(user_id), "paid": bool(paid), "now": now_et, "day": session["day"],
                           "conn": conn, "make": bool(make)}
    out: dict[str, Any] = {"day": session["day"], "session": session}
    reasons: dict[str, str] = {}

    def run(key: str, fn: Callable[[], Any]) -> Any:
        try:
            val = fn()
        except SectionUnavailable as e:
            reasons[key] = e.reason
            val = None
        except Exception:  # noqa: BLE001 -- one section's failure never fails Today
            log.warning("[today] section %s failed", key, exc_info=True)
            reasons[key] = "error"
            val = None
        finally:
            if conn.in_transaction:
                conn.rollback()
        out[key] = val
        return val

    try:
        market = run("market", lambda: market_section(ctx))
        setups = run("setups", lambda: setups_section(ctx))
        names = run("names", lambda: names_section(ctx))
        if names is not None and names.get("earningsWithheld"):
            reasons["namesEarnings"] = PLAN_REASON
        note = run("todayNote", lambda: today_note_section(
            ctx, lambda: _plan_seed(ctx, market, setups, names)))
        ctx["todayNoteId"] = (note or {}).get("id") if not (note or {}).get("trashed") else None
        run("openFromYesterday", lambda: open_from_yesterday_section(ctx))
        run("onThisDay", lambda: on_this_day_section(ctx))
    finally:
        if owned:
            conn.close()
    out["reasons"] = reasons
    return out
