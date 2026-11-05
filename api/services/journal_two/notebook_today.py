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


def session_of(now: datetime) -> dict[str, Any]:
    """{day, phase, minutesToOpen, recap} for an ET instant. `phase` is `premarket` (a session day before 09:30),
    `open` (09:30 to 16:00), `after_close` (from 16:00) or `closed` (not a session day). `recap` is True on a
    session day from 16:05 (S18)."""
    from api.services.journal_two import trading_days
    day = now.date()
    try:
        session_day = trading_days.is_session(day)
    except Exception:  # noqa: BLE001 -- no calendar: a weekday is a session
        session_day = day.weekday() < 5
    hm = (now.hour, now.minute)
    if not session_day:
        phase = "closed"
    elif hm < OPEN_AT:
        phase = "premarket"
    elif hm < CLOSE_AT:
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
        "recap": bool(session_day and hm >= RECAP_FROM),
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

def market_section(ctx: dict) -> dict[str, Any]:
    """The dashboard's own regime and breadth, from the HELD wire payload. Nothing held: every field null."""
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
        raise SectionUnavailable("paid_plan")
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
    """{SYM: mentions in the room today}, or None when the room's store is not on this pod."""
    from api.services import buzz_boards, buzz_store
    if not symbols or not os.path.exists(buzz_store.db_path()):
        return None
    start, end = buzz_boards.window_bounds("today", int(now.timestamp()))
    chans = buzz_boards._channels()
    return {s: int(buzz_store.count(s, start, end, chans)) for s in symbols}


def names_section(ctx: dict) -> dict[str, Any]:
    """Your names: the member's watchlist and flagged names, each with what UCT already holds about it."""
    from api.services import calendar_personalization
    from api.services.journal_two import earnings_prep
    sets = calendar_personalization.get_user_ticker_sets(ctx["user_id"]) or {}
    symbols = sorted({str(s).upper() for k in ("watchlist", "flagged") for s in (sets.get(k) or ()) if s})
    day = date.fromisoformat(ctx["day"])
    window = _held_earnings_window(day) if symbols else None
    dates, timing = ({}, {}) if window is None else (window[0] or {}, window[1] or {})
    try:
        buzz = _buzz_counts(symbols, ctx["now"])
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

    def rank(r: dict) -> tuple:
        e = r.get("earnings")
        return (0 if e and e["daysAway"] == 0 else 1 if e else 2, -(r.get("mentions") or 0), r["symbol"])

    shown_syms = symbols
    live = _live_ticks(shown_syms)
    rows = []
    for sym in shown_syms:
        q = _quote(sym, ctx["day"], live.get(sym))
        rows.append({"symbol": sym, **q, "earnings": earnings_of(sym),
                     "mentions": (buzz or {}).get(sym) if buzz is not None else None})
    rows.sort(key=rank)
    for r in rows:
        r["buzzHigh"] = bool(r["mentions"] is not None and r["mentions"] >= BUZZ_HIGH)
    return {
        "count": len(symbols),
        "rows": rows[:NAMES_SHOWN],
        "more": max(0, len(rows) - NAMES_SHOWN),
        # True: the earnings calendar is not held right now, so a blank earnings cell is unknown, not "none".
        "earningsUnknown": bool(symbols) and (window is None or bool(window[2])),
        "buzzKnown": buzz is not None,
        "reportingToday": [r["symbol"] for r in rows if r.get("earnings") and r["earnings"]["daysAway"] == 0],
    }


def _plan_seed(ctx: dict, market: dict | None, setups: dict | None, names: dict | None) -> list[dict]:
    """S18's tomorrow's plan, made at the first open of the day: a "Today's plan" checklist from what this read
    already holds. Empty when nothing is held (the note is then exactly the member's template)."""
    lines: list[str] = []
    if market and (market.get("regimeWord") or market.get("pctAbove50") is not None):
        bits = []
        if market.get("regimeWord"):
            bits.append(f"{market['regimeWord']} regime")
        if market.get("pctAbove50") is not None:
            bits.append(f"{market['pctAbove50']:g}% above the 50-day")
        lines.append("Check the market: " + ", ".join(bits))
    if setups:
        n = int(setups.get("nearCount") or 0)
        if n:
            lines.append(f"Review the {n} {'setup' if n == 1 else 'setups'} within {NEAR_PCT:g}% of entry")
        for sym in (setups.get("belowStop") or [])[:3]:
            lines.append(f"Review {sym}: below stop")
        for sym in (setups.get("triggered") or [])[:3]:
            lines.append(f"{sym} triggered: check the entry")
    if names:
        day = date.fromisoformat(ctx["day"])
        tomorrow = day + timedelta(days=1)
        window = _held_earnings_window(day)
        dates, timing = ({}, {}) if window is None else (window[0] or {}, window[1] or {})
        words = {"bmo": "before the open", "amc": "after the close"}
        for r in names.get("rows") or []:
            sym = r["symbol"]
            d = dates.get(sym)
            t = timing.get(sym)
            if d == day.isoformat():
                lines.append(f"Prep ${sym} earnings ({words.get(t, 'today')})")
            elif d == tomorrow.isoformat() and t == "bmo":
                lines.append(f"Prep ${sym} earnings (tomorrow before the open)")
    lines = lines[:PLAN_ITEMS_SHOWN]
    if not lines:
        return []
    items = [{"type": "taskItem", "attrs": {"checked": False},
              "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]}]} for t in lines]
    return [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Today's plan"}]},
        {"type": "taskList", "content": items},
    ]


RECAP_HEADING_PREFIXES = ("Today's recap — ", "Recap — ")


def today_note_section(ctx: dict, seed: Callable[[], list[dict]]) -> dict[str, Any]:
    """Today's daily note, made the first time today through the daily note door, with the member's template."""
    from api.services.journal_two import note_daily, note_tasks
    from api.services.journal_two.note_personal_api import _daily_template_id
    template_id = _daily_template_id(ctx["user_id"])
    out = note_daily.open_daily_note(ctx["user_id"], ctx["day"], template_id, seed_blocks=seed)
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
            tpl = note_templates.get_template(ctx["user_id"], template_id)
            template_name = (tpl or {}).get("name") or None
        except Exception:  # noqa: BLE001
            template_name = None
    headings = _heading_texts(body)
    return {
        "id": note.get("id"),
        "title": note.get("title") or "",
        "updatedAt": note.get("updatedAt"),
        "created": bool(out.get("created")),
        "templateMissing": bool(out.get("templateMissing")),
        "templateName": template_name,
        "items": [{"index": t["index"], "text": " ".join(str(t["text"]).replace("\u0000", " ").split()),
                   "checked": t["checked"]} for t in tasks[:PLAN_ITEMS_SHOWN]],
        "openCount": len(open_tasks),
        "itemCount": len(tasks),
        "snippet": None if tasks else (_plain_text(body) or None),
        "recapWritten": any(h.startswith(RECAP_HEADING_PREFIXES) for h in headings),
    }


def open_from_yesterday_section(ctx: dict) -> dict[str, Any]:
    """The open checklist items in the most recent earlier daily note, then tasks due on or before today."""
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
            if t["checked"]:
                continue
            seen.add((row["id"], t["index"]))
            items.append({"noteId": row["id"], "noteTitle": row["title"] or "", "index": t["index"],
                          "text": " ".join(str(t["text"]).replace("\u0000", " ").split()), "due": t["due"],
                          "from": "yesterday"})
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


def on_this_day_section(ctx: dict) -> dict[str, Any]:
    """Notes created on this ET calendar date in earlier years, newest year first. Never a sample note."""
    from api.services.journal_two import sample_marker
    from api.services.journal_two.trading_days import et_day_of
    conn, uid = ctx["conn"], ctx["user_id"]
    d = date.fromisoformat(ctx["day"])
    md = ctx["day"][5:]
    # A stored stamp is UTC, so the ET date can be the UTC date or the day before it: read both, then date each
    # note in New York.
    nxt = (d + timedelta(days=1)).isoformat()[5:]
    rows = conn.execute(
        "SELECT id, title, ticker, created_at, body_json FROM j2_notes WHERE user_id = ?"
        " AND deleted_at IS NULL AND archived_at IS NULL AND " + sample_marker.not_sample_sql() +
        " AND substr(created_at, 6, 5) IN (?, ?) AND substr(created_at, 1, 4) < ?"
        " ORDER BY created_at DESC LIMIT 50",
        (uid, md, nxt, str(d.year + 1))).fetchall()
    out = []
    for r in rows:
        et = et_day_of(r["created_at"])
        if not et or et[5:] != md or int(et[:4]) >= d.year:
            continue
        try:
            body = json.loads(r["body_json"] or "{}")
        except (ValueError, TypeError, RecursionError):
            body = {}
        out.append({"noteId": r["id"], "title": r["title"] or "", "ticker": r["ticker"], "day": et,
                    "yearsAgo": d.year - int(et[:4]), "snippet": _plain_text(body) or None})
    return {"count": len(out), "items": out[:ON_THIS_DAY_SHOWN]}


# ── the one read ───────────────────────────────────────────────────────────────────────────

class SectionUnavailable(Exception):
    """A section that is not this member's to see (or not held), with a reason code -- not an error."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def get_today(user_id: str, *, paid: bool = True, now: datetime | None = None,
              conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """The Today home's one answer. Every section is independent: a section that raises is `null`, with its reason
    in `reasons` (`error`, or a `SectionUnavailable` code such as `paid_plan`)."""
    now_et = _now_et(now)
    session = session_of(now_et)
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.row_factory = sqlite3.Row
    except Exception:  # noqa: BLE001
        pass
    ctx: dict[str, Any] = {"user_id": str(user_id), "paid": bool(paid), "now": now_et, "day": session["day"],
                           "conn": conn}
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
        note = run("todayNote", lambda: today_note_section(
            ctx, lambda: _plan_seed(ctx, market, setups, names)))
        ctx["todayNoteId"] = (note or {}).get("id")
        run("openFromYesterday", lambda: open_from_yesterday_section(ctx))
        run("onThisDay", lambda: on_this_day_section(ctx))
    finally:
        if owned:
            conn.close()
    out["reasons"] = reasons
    return out
