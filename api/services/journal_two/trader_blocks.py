"""Trader blocks (Notebook P2 Tier 1, spec §P2): the server half.

A trader block is a widgetEmbed whose widgetId is a block id (docs/notebook/p1-verify-before-building.md
§a). This module builds the node a style composes and READS the market data a block shows.

⛔ NOTHING HERE WRITES A NOTE. A block's state changes only through an editor transaction (spec §P2
integrity rule); the composer places the node this module builds, and journal_styles writes the note
in its one insert. tests/test_trader_blocks_no_note_door.py reads this file and fails on any j2_notes
write or any call to a notes write function.
"""
from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

#: The three P2a blocks (`block: true` in the client registry, bound in BLOCK_COMPONENTS). The market
#: context is NOT one: it is the existing `marketcontext` capture widget (Task 3, IR-S6).
BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing")

#: The regime ids regime.classify_regime answers (journal_two/regime.py), in severity order.
REGIME_IDS = ("green", "amber", "orange", "red")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _node(block_id: str, params: dict, ctx: dict) -> dict:
    from api.services.journal_two import journal_styles as js
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": block_id, "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params,
        "capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None,
        "searchText": js._BLOCK_BY_ID[block_id]["search"],
    }}


def _settings(block: dict) -> dict:
    return block.get("settings") or {}


def build_pre_entry_checklist(block: dict, ctx: dict):
    s = _settings(block)
    return _node("preEntryChecklist", {"setup": "", "includeRules": s.get("includeRules", "yes"),
                                       "requireAll": s.get("requireAll", "no"), "checked": []}, ctx), None


def build_price_stamps(block: dict, ctx: dict):
    return _node("priceStamps", {"on": _settings(block).get("on", "no")}, ctx), None


def build_position_sizing(block: dict, ctx: dict):
    """The regime the size was built in, as the regime ID; the client maps ids to the house words
    through app/src/constants/houseSizing.json, the ONE in-repo table (IR-S10)."""
    from api.services.journal_two import regime as regime_mod
    cur = regime_mod.get_current_regime()
    params = {"grade": _settings(block).get("grade", "A")}
    if cur.get("regime") in REGIME_IDS:
        params.update({"regimeId": cur["regime"], "regimeAsOf": cur.get("asOf") or ""})
    return _node("positionSizing", params, ctx), None


BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "preEntryChecklist": build_pre_entry_checklist,
    "priceStamps": build_price_stamps,
    "positionSizing": build_position_sizing,
}


# ── The market context stamp (spec §P2 item 3) on the EXISTING marketcontext widget (IR-S6) ─────
# ⛔ ONE FACT IN TWO FILES: readings_from mirrors app/src/pages/charts/widgets/marketContextModel.js
# readingsFrom, run against it through Node by tests/test_trader_blocks_market_context.py.
# ⛔ Every sourced field stores a `missing` SENTENCE, never entry_context's `detail` (IR-S4).
# ⛔ CACHE-ONLY (integrator ruling R-W0-1): a note create never makes a blocking vendor call. The
# quotes are live_prices' shared per-ticker cache, else the last close of a HELD daily bar, else a
# sentence; get_live_prices' bounded fetch (an 8 s valve wait plus an 8 s-per-phase vendor call) is
# never asked. The breadth is what the pod already holds; a cold engine.get_breadth's next step is
# morning_wire_engine.fetch_breadth, an unbounded vendor call, so a cold hold is never asked either.
# Railed by tests/test_trader_blocks_market_context.py (the vendor doors RECORD their calls).

_MISSING_SENTENCES = {
    "wire_unavailable": "The morning wire has not published an exposure rating yet.",
    "source_error": "The regime could not be read just now.",
}
_VIX = {"value": None, "source": None, "asOf": None, "missing": "VIX unavailable"}   # IR-S5
_INDEXES = (("spy", "SPY"), ("qqq", "QQQ"))
_LAST_CLOSE_DEPTH = 3     # enough to find the last settled bar behind today's forming one


def _num(v: Any) -> float | int | None:
    """JavaScript's `typeof v === 'number' && Number.isFinite(v)`: a bool is not a number there."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v if math.isfinite(v) else None


def _round1(v: Any) -> float | None:
    """Math.round(v * 10) / 10, exactly: JavaScript rounds a half UP (floor(x + 0.5)); Python's
    round() rounds it to even, which would differ at 101.25."""
    n = _num(v)
    return None if n is None else math.floor(n * 10 + 0.5) / 10


def readings_from(breadth: dict) -> dict:
    """The wire payload -> the frozen reading set, exactly as marketContextModel.readingsFrom does."""
    b = breadth if isinstance(breadth, dict) else {}
    exp = b.get("exposure") if isinstance(b.get("exposure"), dict) else {}
    phase = b.get("market_phase")
    return {
        "marketPhase": phase if isinstance(phase, str) and phase else None,
        "exposureScore": _round1(exp.get("score")),
        "exposureDelta": _round1(exp.get("score_delta")),
        "breadthScore": _round1(b.get("breadth_score")),
        "distributionDays": _num(b.get("distribution_days")),
        "pctAbove50": _round1(b.get("pct_above_50ma")),
        "pctAbove200": _round1(b.get("pct_above_200ma")),
        "powerTrend": None,        # ⛔ null by owner direction (2026-04-17), exactly as the client
    }


def _breadth() -> dict:
    """The wire's breadth payload (the source /charts' Market Context reads), or {} when the pod
    holds none. engine.get_breadth(held_only=True) is the ONE authority on "held": it never goes on
    to the live fetch (R-W0-1, R-T3-2 m1)."""
    from api.services import engine
    payload = engine.get_breadth(held_only=True)
    return payload if isinstance(payload, dict) else {}


def _regime_field(memo: dict) -> dict:
    """The regime field as entry context reads it (entry_context._regime_fields: the wire only).
    That path asks the DEFAULT engine.get_breadth, so it is entered only when a breadth is held
    (the held read also warms engine's cache for it); a cold hold answers "not published"."""
    from api.services import engine
    if engine.get_breadth(held_only=True) is None:
        return {"missing": "wire_unavailable"}
    from api.services.journal_two import entry_context
    return entry_context._regime_fields(memo)[0]


def _bar_day(ts: Any) -> date | None:
    """A daily bar's ts (YYYYMMDD) as a date."""
    try:
        n = int(ts)
        return date(n // 10000, n // 100 % 100, n % 100)
    except (TypeError, ValueError):
        return None


def _last_completed_session(now: datetime) -> date | None:
    """The ET date of the newest session whose close is at or before `now` (the one session
    authority, api/services/session_calendar.py); None when the calendar cannot say."""
    from zoneinfo import ZoneInfo
    from api.services import session_calendar
    d = now.astimezone(ZoneInfo("America/New_York")).date()
    for _ in range(15):
        ct = session_calendar.close_time(d)
        if ct is not None and ct <= now:
            return d
        d -= timedelta(days=1)
    return None


def _last_close(sym: str, now: datetime) -> dict | None:
    """The close of the last COMPLETED session from a HELD daily bar (bars_sqlite, local), as a quote
    row; None when none is held. R-T3-2 I1: a bar counts only once its session has closed (today's
    bar is still forming mid-session, and the bar store re-fetches it), and the newest settled bar
    must BE the last completed session: an older one is not "the last close", so it is a sentence.
    Its change is against the bar before it."""
    from api.routers import live_prices
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym, "D", _LAST_CLOSE_DEPTH) or []
    cutoff = now.timestamp()
    settled = []
    for i, row in enumerate(rows):
        day = _bar_day(row[0])
        closed_at = live_prices._session_close_epoch(day) if day is not None else None
        if closed_at is not None and closed_at <= cutoff:
            settled.append((i, day, closed_at))
    if not settled:
        return None
    i, day, closed_at = settled[-1]
    last_done = _last_completed_session(now)
    if last_done is None or day < last_done:
        return None
    close = _num(rows[i][4])
    if close is None or close <= 0:
        return None
    prior = _num(rows[i - 1][4]) if i > 0 else None
    return {"price": round(close, 2),
            "change_pct": round((close - prior) / prior * 100.0, 4) if prior else None,
            "market_closed": True, "source": "last close", "asOf": _epoch_iso(closed_at)}


def _in_regular_session(now: datetime) -> bool:
    """Is `now` inside a regular session (the one session authority, api/services/session_calendar.py:
    holidays and half-days included)? Only then is a live-path quote a live price."""
    from api.services import session_calendar
    try:
        return session_calendar.session_at(now) == "rth"
    except Exception:  # noqa: BLE001 -- an instant the calendar cannot place is never "live"
        return False


def _quote_window(now: datetime) -> str:
    """R-T3-6: which session a live-path cache row read at `now` was built in. The row can be up to
    live_prices._CACHE_TTL old, so it was built in the regular session only if `now - TTL` was in it
    too: "live" when both instants are, "frozen" when neither is, "edge" (ambiguous: the row may be a
    pre-market close read after the open, or a mid-minute print read after the close) otherwise."""
    from api.routers import live_prices
    then = now - timedelta(seconds=live_prices._CACHE_TTL)
    live_now, live_then = _in_regular_session(now), _in_regular_session(then)
    if live_now and live_then:
        return "live"
    return "edge" if live_now or live_then else "frozen"


def _same_cents(a: float, b: float) -> bool:
    return round(a, 2) == round(b, 2)


def _with_proven_change(sym: str, row: dict, now: datetime) -> dict:
    """A closed row whose change the row cannot prove (R-T3-4 n1): the held daily bars' close and
    change (_last_close, calendar-checked) when held, else the row with its change OMITTED. Never a
    fabricated 0.0."""
    try:
        held = _last_close(sym, now)
    except Exception:  # noqa: BLE001 -- an unreadable bar store is no held bar
        held = None
    return held if held is not None else {**row, "change_pct": None}


def _frozen_close(sym: str, row: dict, now: datetime) -> dict | None:
    """R-T3-4 n2. Outside the regular session live_prices._fetch_snapshots prices a live-path row
    `day.c or lastTrade.p or prevDay.c` (day.c first) and leaves market_closed unset, so its price is
    a FROZEN close. It is the close of ONE session, which the row proves or it is not used (None):
      * day.c (day_close present, price equal): today's close once today's session has closed;
        before that (the overnight hours before the vendor resets its day bar, a weekend, a holiday)
        the last completed session's. In PRE-market `day` may already be today's forming bar, so it
        proves nothing there.
      * prevDay.c (no day bar, price equal to prev_close): the session before the vendor's current
        day, which is the last completed session only while TODAY's session has not closed.
    Anything else (a real extended-hours print, a disagreeing field) proves no session.
    The result is a closed row dated by that session's close (session_calendar), source "last close".
    Its change is kept only when the row proves it: day.c's change is computed against prev_close on
    the row; prevDay.c's row carries the vendor's extended-hours move, not that session's."""
    from zoneinfo import ZoneInfo
    from api.services import session_calendar
    last_done = _last_completed_session(now)
    price = _num(row.get("price"))
    if last_done is None or price is None or price <= 0:
        return None
    day_close, prev_close = _num(row.get("day_close")), _num(row.get("prev_close"))
    today = now.astimezone(ZoneInfo("America/New_York")).date()
    if day_close is not None:
        if not _same_cents(price, day_close) or session_calendar.session_at(now) == "pre":
            return None
        proven = prev_close is not None and prev_close > 0
    else:
        if last_done == today or prev_close is None or not _same_cents(price, prev_close):
            return None
        proven = False
    close_at = session_calendar.close_time(last_done)
    if close_at is None:
        return None
    frozen = {"price": round(price, 2), "change_pct": _num(row.get("change_pct")) if proven else None,
              "market_closed": True, "source": "last close", "asOf": _iso(close_at)}
    return frozen if proven else _with_proven_change(sym, frozen, now)


def _settled_cache_row(sym: str, row: dict, now: datetime) -> dict | None:
    """A live_prices cache row as the stamp may store it, or None when it is not usable."""
    if row.get("market_closed"):
        if _num(row.get("session_close_at")) is None:
            # R-T3-3: an UNDATED closed row (live_prices' grouped session map still warming or
            # disagreeing, so its change_pct is a fabricated 0.0) is not used; the calendar-checked
            # held bar answers instead, or nothing does.
            return None
        prev_close = _num(row.get("prev_close"))
        if prev_close is None or prev_close <= 0:
            # R-T3-4 n1: live_prices._last_session_row writes prev_close 0.0 (and change_pct 0.0)
            # exactly when the prior session's close is missing, so the change is fabricated; a
            # genuine flat session has prev_close > 0 and keeps its 0.0.
            return _with_proven_change(sym, row, now)
        return row
    window = _quote_window(now)
    if window == "live":
        return row
    if window == "frozen":
        return _frozen_close(sym, row, now)
    return None    # R-T3-6: within one cache age of an edge the row proves nothing; the held bar answers


def _quotes(user_id: str, symbols: tuple[str, ...], now: datetime | None = None) -> dict:
    """SPY/QQQ for the stamp, CACHE-ONLY (R-W0-1): the live-price route's shared 15 s per-ticker
    cache (the rows its own polls write), else the last completed session's close from a held daily
    bar, else absent. `user_id` is part of the seam's shape; nothing here is per member."""
    from api.routers import live_prices
    now = now or datetime.now(timezone.utc)
    out: dict = {}
    for sym in symbols:
        row = live_prices.cache.get(live_prices._px_key(sym))
        if isinstance(row, dict):
            try:
                row = _settled_cache_row(sym, row, now)
            except Exception:  # noqa: BLE001 -- an unreadable row is an absent quote
                row = None
        if not isinstance(row, dict):
            try:
                row = _last_close(sym, now)
            except Exception:  # noqa: BLE001 -- an unreadable bar store is an absent quote
                row = None
        if isinstance(row, dict):
            out[sym] = row
    return out


def _sourced(field: dict) -> dict:
    """entry_context's {value, source, asOf, missing(code), detail} -> the stored shape (a sentence)."""
    if field.get("missing"):
        code = str(field["missing"])
        return {"value": None, "source": None, "asOf": None,
                "missing": _MISSING_SENTENCES.get(code, "Not available when this note was written.")}
    return {"value": field.get("value"), "source": field.get("source"), "asOf": field.get("asOf"), "missing": None}


def _epoch_iso(v: Any) -> str | None:
    n = _num(v)
    return None if n is None else _iso(datetime.fromtimestamp(float(n), tz=timezone.utc))


def _index_field(sym: str, q: Any, now: datetime) -> dict:
    if isinstance(q, dict) and _num(q.get("price")) is not None:
        closed = bool(q.get("market_closed"))
        if not closed and _quote_window(now) != "live":
            # R-T3-4 n2 / R-T3-6: outside the regular session (or within one cache age of its edge) a
            # live-path row's price is not a live price; _quotes stores it as the session's last close
            # when the row proves which session, so one reaching here unconverted is a sentence.
            return {"value": None, "source": None, "asOf": None, "missing": f"No {sym} quote could be read just now."}
        # A live row carries the vendor's observation epoch; a closed-market row the epoch of the
        # session close it IS; a held bar its close. Only a LIVE, regular-session row the vendor did not
        # time is dated by the capture (the cache's 15 s TTL bounds its age, R-T3-2 m2); a closed row's value is a
        # past session's close, so the capture is never its date (R-T3-3): undated, it is a sentence.
        as_of = (q.get("asOf") or _epoch_iso(q.get("observed_at"))
                 or _epoch_iso(q.get("session_close_at")) or (None if closed else _iso(now)))
        if as_of is not None:
            return {"value": {"price": q["price"], "changePct": _num(q.get("change_pct")), "closed": closed},
                    # R-T3-2 m2: a row read while the market is closed is a last close, never a live price.
                    "source": q.get("source") or ("last close" if closed else "live price"),
                    "asOf": as_of, "missing": None}
    return {"value": None, "source": None, "asOf": None, "missing": f"No {sym} quote could be read just now."}


def _et_clock(now: datetime) -> str:
    from zoneinfo import ZoneInfo
    t = now.astimezone(ZoneInfo("America/New_York"))
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'} ET"


def market_context_params(memo: dict, *, user_id: str, now: datetime) -> dict:
    """The params a marketcontext stamp freezes: the wire readings (/charts' exact derivation) plus the
    regime, SPY, QQQ and VIX, each sourced and dated or carrying a sentence saying why not."""
    try:
        breadth = _breadth()
    except Exception:  # noqa: BLE001 -- one source never takes the stamp down
        breadth = {}
    readings = readings_from(breadth)
    try:
        readings["regime"] = _sourced(_regime_field(memo))
    except Exception:  # noqa: BLE001
        readings["regime"] = _sourced({"missing": "source_error"})
    try:
        quotes = _quotes(user_id, tuple(sym for _, sym in _INDEXES), now=now)
    except Exception:  # noqa: BLE001
        quotes = {}
    quotes = quotes if isinstance(quotes, dict) else {}
    for key, sym in _INDEXES:
        readings[key] = _index_field(sym, quotes.get(sym), now)
    readings["vix"] = dict(_VIX)
    wire = breadth.get("wire_date")
    return {"readings": readings, "wireDate": wire if isinstance(wire, str) and wire else None,
            "updated": _et_clock(now)}


def build_market_context(block: dict, ctx: dict):
    """A NEW note captures now; an older note offered the block by 'Update layout' gets it UNCAPTURED
    and reads nothing (IR-S11: never today's market in an older note). No `searchText`, like
    journal_styles._build_chart: the client derives an embed's searchText from its params."""
    fields = _settings(block).get("fields", "all")
    if ctx.get("mode") == "update":
        # R-T3-2 I2: no capture date either (the client renders capturedAt as "captured <day>").
        params, captured_at = {"uncaptured": True, "fields": fields}, None
    else:
        params = {**market_context_params(ctx.setdefault("memo", {}), user_id=ctx.get("user_id") or "",
                                          now=ctx["now"]), "fields": fields}
        captured_at = _iso(ctx["now"])
        # R-T4-1 I-1: the regime reading THIS build froze, for the composer's regime_at_write.
        ctx.setdefault("captured", {})["regime"] = params["readings"]["regime"]
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "marketcontext", "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params,
        "capturedAt": captured_at, "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None,
    }}, None


BUILDERS["marketcontext"] = build_market_context


# ── Log Trade's checklist for an OPEN position (R-P2-7) ─────────────────────────────────────
# The ticks are stored in the adherence store (j2_trade_adherence) under `pos:<position id>`, never
# in a note; the closed trade's adherence read (journal_two.get_trade_adherence_route) falls back to
# this record when the trade has none of its own. No market read here (R-W0-1 / R-T3-1).
PRE_ENTRY_PREFIX = "pos:"


def pre_entry_ref(position_id: str) -> str:
    """The adherence-store key of a position's pre-entry record (the ONE spelling of it)."""
    return PRE_ENTRY_PREFIX + position_id


def save_pre_entry(user_id: str, position_id: str, setup: str | None, checked: list[str],
                   total: int) -> dict | None:
    """The ticks made in Log Trade, stored in the adherence store under `pos:<position id>` (the
    closed trade's adherence read falls back to it). None when the position is not this member's,
    which the route answers with the same 404 as a position that does not exist."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import adherence_store
    c = get_connection()
    try:
        own = c.execute("SELECT 1 FROM j2_positions WHERE id = ? AND user_id = ?", (position_id, user_id)).fetchone()
    finally:
        c.close()
    if own is None:
        return None
    return adherence_store.upsert_adherence(user_id, pre_entry_ref(position_id), setup, checked, total)
