"""Trader blocks (Notebook P2 Tier 1, spec §P2): the server half.

A trader block is a widgetEmbed whose widgetId is a block id (docs/notebook/p1-verify-before-building.md
§a). This module builds the node a style composes and READS the market data a block shows.

⛔ NOTHING HERE WRITES A NOTE. A block's state changes only through an editor transaction (spec §P2
integrity rule); the composer places the node this module builds, and journal_styles writes the note
in its one insert. tests/test_trader_blocks_no_note_door.py reads this file and fails on any j2_notes
write or any call to a notes write function.
"""
from __future__ import annotations

import contextvars
import math
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

#: The trader blocks (`block: true` in the client registry, bound in BLOCK_COMPONENTS): part a's three,
#: then part b's six. The market context is NOT one: it is the existing `marketcontext` capture widget
#: (Task 3, IR-S6).
BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing",
             "myRules", "prepWire", "prepEarnings", "prepMovers", "prepLevels", "tradeReview")

#: The regime ids regime.classify_regime answers (journal_two/regime.py), in severity order.
REGIME_IDS = ("green", "amber", "orange", "red")


#: R-T12-C: the ONE read budget, in seconds, for a note create's market and prep reads (and for one
#: prep part's "Capture now"). Both run on the web pod's shared request threadpool, and the Task 15b
#: probe measured a Daily prep create holding a worker for the serial sum of every read with nothing
#: cutting it short. Read in ONE place: start_budget.
PREP_CREATE_BUDGET_S = 3.0
_DEADLINE = "deadline"      # the memo key holding the monotonic deadline
#: The memo of the prep part being read right now (set by prep_part), so a read nested below a reader's
#: own signature (_my_names' per-source reads) can check the SAME budget without a new parameter.
_ACTIVE_BUDGET: contextvars.ContextVar = contextvars.ContextVar("trader_blocks_budget", default=None)


class BudgetSpent(Exception):
    """The read budget ran out before the next read. The block it interrupts is written UNCAPTURED
    (the IR-S11 shape, with "Capture now"), never as a partial snapshot."""


def start_budget(memo: dict) -> dict:
    """Start the budget on `memo` unless one is running (a compose shares ONE deadline across every
    block it builds: the first start wins). Returns `memo`."""
    memo.setdefault(_DEADLINE, time.monotonic() + PREP_CREATE_BUDGET_S)
    return memo


def _spent(memo: Any) -> bool:
    """Has the budget on `memo` run out? False when the memo carries none."""
    deadline = memo.get(_DEADLINE) if isinstance(memo, dict) else None
    return deadline is not None and time.monotonic() >= deadline


def _spend(memo: Any) -> None:
    """Called BEFORE each read (and before each name in a scan): BudgetSpent once the deadline has
    passed. No deadline on the memo (a caller that started none) means no limit.
    ⛔ A read already running is not interrupted: the bound is the budget plus the one read in flight
    (each read's own bound: sqlite lock waits of 2-5 s; a local file read has none)."""
    if _spent(memo):
        raise BudgetSpent()


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
    through app/src/constants/houseSizing.json, the ONE in-repo table (IR-S10).

    R-W0-2: the regime is read and DATED exactly as entry_context._regime_fields reads it (the wire's
    exposure, dated by the reading's own date or else the wire run's), through the compose's memo, so
    every block in one compose stamps the same frozen reading. HELD-ONLY (R-W0-1): it is entered only
    when the pod already holds a breadth payload, because the default engine.get_breadth goes on to the
    breadth vendor fetch on a cold box. A cold hold leaves the block unstamped; the client stamps
    today's regime on the member's first change.

    R-T11-1 / R-RC-1 (IR-S11, as build_market_context): "Update layout" on an older note ("update")
    offers the sizer UNSTAMPED and reads no regime; only a new note ("create", which an empty note's
    outline insert is too) stamps the regime it was built in.

    R-M2-1 (d): the held gate is _regime_field, the ONE copy the market context also asks."""
    params = {"grade": _settings(block).get("grade", "A")}
    if ctx.get("mode") == "update":
        return _node("positionSizing", params, ctx), None
    try:
        memo = ctx.setdefault("memo", {})
        _spend(memo)                    # R-T12-C: a spent budget leaves the sizer unstamped
        field = _regime_field(memo)
    except Exception:  # noqa: BLE001 -- an unreadable hold (or a spent budget) is a missing regime, never a failed note
        field = {}
    if field.get("value") in REGIME_IDS:
        params.update({"regimeId": field["value"], "regimeAsOf": field.get("asOf") or ""})
    return _node("positionSizing", params, ctx), None


BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "preEntryChecklist": build_pre_entry_checklist,
    "priceStamps": build_price_stamps,
    "positionSizing": build_position_sizing,
}


def _empty(block_id: str, params: dict | None = None):
    """Part b's placeholder builders (P2b Task 2): the node with fixed params. `tradeReview` keeps this
    one (the member picks the trade, Task 7); the four prep blocks capture (Task 6, `_prep_builder`
    below)."""
    def build(block: dict, ctx: dict):
        return _node(block_id, dict(params or {}), ctx), None
    return build


def build_my_rules(block: dict, ctx: dict):
    """The block reads `params.which` (MyRulesBlock.jsx), so the style's setting goes onto the node --
    the same stored shape the slash path's normalizeParams writes (Task 12 review, finding 5)."""
    return _node("myRules", {"which": _settings(block).get("which", "active")}, ctx), None


BUILDERS.update({
    "myRules": build_my_rules,
    "tradeReview": _empty("tradeReview", {"tradeId": ""}),
})


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
    """The regime field, from HELD data only: the held breadth payload's own exposure block, shaped and
    dated by the same two functions entry context uses (regime.regime_from_exposure,
    entry_context.regime_fields_from: R-W0-2's dating), and stored in the memo in entry_context's shape
    so every block of one compose stamps the same frozen reading.
    ⛔ R-T12-C: it never asks the DEFAULT engine.get_breadth. That call's next step on a cold engine is
    morning_wire_engine.fetch_breadth, an unbounded vendor call (the module note above), and the old
    path reached it through entry_context._regime_fields -> regime.get_current_regime whenever the held
    read answered. Nothing held: "not published" (wire_unavailable), never a guess."""
    from api.services import engine
    payload = engine.get_breadth(held_only=True)
    if payload is None:
        return {"missing": "wire_unavailable"}
    if "regime" in memo:
        return memo["regime"][0]
    from api.services.journal_two import entry_context
    from api.services.journal_two import regime as regime_service
    exp = payload.get("exposure") if isinstance(payload, dict) else None
    try:
        out = entry_context.regime_fields_from(regime_service.regime_from_exposure(exp),
                                               lambda: payload.get("wire_date"))
    except Exception:  # noqa: BLE001 -- an unreadable hold is a missing regime, never a failed note
        out = (entry_context._missing(entry_context.SRC_REGIME, "source_error"),
               entry_context._missing(entry_context.SRC_EXPOSURE, "source_error"))
    memo["regime"] = out
    return out[0]


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


def price_stamp_quote(sym: str, now: datetime | None = None) -> dict | None:
    """P2a Task 10: the price a stamp stores, with its real source and as-of, or None (no stamp).

    A stamp captures a price at a moment, so unlike the market context (cache-only, R-W0-1: that read
    sits inside a note write) it asks live_prices once, the bounded read /price has always made (its
    valve and per-phase vendor bounds; the client gives the whole stamp 2 s). The answer then goes
    through the SAME classification the market context stamp uses (_quotes -> _settled_cache_row /
    _frozen_close / _last_close, then _index_field): a live price only inside the regular session;
    outside it the frozen close is the "last close", dated by THAT session's close; a row that proves
    no session is no stamp. The capture time never dates a close (R-T3). A change the row cannot prove
    is None, never 0.0. Writes nothing."""
    from api.routers import live_prices
    now = now or datetime.now(timezone.utc)
    try:
        live_prices.get_live_prices(tickers=sym)        # fills the shared per-ticker cache _quotes reads
    except Exception:  # noqa: BLE001 -- a failed read leaves the cache (or the held bar) to answer
        pass
    field = _index_field(sym, _quotes("", (sym,), now).get(sym), now)
    if field["missing"]:
        return None
    v = field["value"]
    return {"price": v["price"], "changePct": v["changePct"], "source": field["source"], "asOf": field["asOf"]}


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
    regime, SPY, QQQ and VIX, each sourced and dated or carrying a sentence saying why not.
    R-T12-C: BudgetSpent (raised BEFORE a read, outside every per-source catch) when `memo` carries a
    spent budget; the caller writes the stamp uncaptured rather than a part-read one."""
    _spend(memo)
    try:
        breadth = _breadth()
    except Exception:  # noqa: BLE001 -- one source never takes the stamp down
        breadth = {}
    readings = readings_from(breadth)
    _spend(memo)
    try:
        readings["regime"] = _sourced(_regime_field(memo))
    except Exception:  # noqa: BLE001
        readings["regime"] = _sourced({"missing": "source_error"})
    quotes: dict = {}
    for _, sym in _INDEXES:
        _spend(memo)                    # one read per index, each behind the budget
        try:
            got = _quotes(user_id, (sym,), now=now)
        except Exception:  # noqa: BLE001
            got = {}
        if isinstance(got, dict):
            quotes.update(got)
    for key, sym in _INDEXES:
        readings[key] = _index_field(sym, quotes.get(sym), now)
    readings["vix"] = dict(_VIX)
    wire = breadth.get("wire_date")
    _spend(memo)                        # only a stamp read in full inside the budget is kept
    return {"readings": readings, "wireDate": wire if isinstance(wire, str) and wire else None,
            "updated": _et_clock(now)}


def build_market_context(block: dict, ctx: dict):
    """A NEW note captures now; an older note offered the block by 'Update layout' gets it UNCAPTURED
    and reads nothing (IR-S11: never today's market in an older note). No `searchText`, like
    journal_styles._build_chart: the client derives an embed's searchText from its params."""
    fields = _settings(block).get("fields", "all")
    # R-T3-2 I2: an uncaptured stamp has no capture date either (the client renders capturedAt as
    # "captured <day>").
    params, captured_at = {"uncaptured": True, "fields": fields}, None
    if ctx.get("mode") != "update":
        try:
            read = market_context_params(ctx.setdefault("memo", {}), user_id=ctx.get("user_id") or "",
                                         now=ctx["now"])
        except BudgetSpent:
            # R-T12-C: the create's read budget ran out: the stamp lands UNCAPTURED (the IR-S11 shape),
            # never part-read, and freezes no regime, so regime_at_write stays absent.
            read = None
        if read is not None:
            params, captured_at = {**read, "fields": fields}, _iso(ctx["now"])
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


def adherence_of_trade(lookup: Callable[[str], dict | None], trade_ref: str,
                       position_id: str | None) -> dict | None:
    """A closed trade's adherence record: its own (by its stable trade ref), else the ticks made in
    Log Trade while its position was open (pre_entry_ref). THE one join (R-PF-N7): the before / after
    numbers (rule_versions.before_after) and the trade review read it through here, so the two can
    never disagree about a Log-Trade-ticked trade. `lookup` answers one ref: `dict.get` over
    adherence_store.list_adherence_for_user, or a get_adherence call."""
    own = lookup(trade_ref)
    if own is None and isinstance(position_id, str) and position_id:
        return lookup(pre_entry_ref(position_id))
    return own


#: The 409 sentence (R-T5-1): the position already has an exit, so its ticks belong on the trade.
PRE_ENTRY_EXITED_SENTENCE = ("This trade is already closed or partly closed. "
                             "Record its rules on the trade instead.")


class PositionHasExit(Exception):
    """The position is the member's but already has an exit (a j2_trades row carved from it)."""


def save_pre_entry(user_id: str, position_id: str, setup: str | None, checked: list[str],
                   total: int) -> dict | None:
    """The ticks made in Log Trade, stored in the adherence store under `pos:<position id>` (the
    closed trade's adherence read falls back to it), so `pos:` means "ticked before any outcome".
      * None when the position is not this member's: the route's 404, the same as a missing one.
      * PositionHasExit when it is theirs and ANY trade has been carved from it (a partial close
        included; shares == original_shares would miss it, since update_position edits shares).
    Ownership, the exit check and the upsert run on ONE connection in ONE transaction (BEGIN
    IMMEDIATE), so a position deleted or closed in between can never leave an orphan pos: row."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import adherence_store
    c = get_connection()
    try:
        c.execute("BEGIN IMMEDIATE")
        own = c.execute("SELECT 1 FROM j2_positions WHERE id = ? AND user_id = ?", (position_id, user_id)).fetchone()
        if own is None:
            c.rollback()
            return None
        exited = c.execute("SELECT EXISTS (SELECT 1 FROM j2_trades WHERE user_id = ? AND position_id = ?)",
                           (user_id, position_id)).fetchone()[0]
        if exited:
            c.rollback()
            raise PositionHasExit(position_id)
        return adherence_store.upsert_adherence(user_id, pre_entry_ref(position_id), setup, checked, total, conn=c)
    finally:
        if c.in_transaction:
            c.rollback()
        c.close()


# ── The daily prep pack (spec §P2 item 6; R-P2b-6) ─────────────────────────────────────────
# Four parts, each a frozen snapshot the member captures (a NEW note captures on create; an older
# note offered the block by "Update layout" gets it uncaptured, IR-S11 part b). Every gap is named:
# a `missing` code and a `detail` sentence, never an empty block that reads as "nothing happened".
# ⛔ CACHE-ONLY (R-W0-1, pre-flight B5): quotes through `_cached_quote` (the market context's own
# classified cache read, never `price_stamp_quote`, which asks the vendor); the regime through the
# held gate `_regime_field`; the earnings list from the engine's cache key, never a build.
# ⛔ N10: a read that raises is a snapshot with `missing: "source_error"`, never a failed note.
PREP_PARTS = ("wire", "earnings", "movers", "levels")
PREP_BLOCK = {"wire": "prepWire", "earnings": "prepEarnings", "movers": "prepMovers", "levels": "prepLevels"}
MOVERS_MAX = 8
#: How many of the member's names the movers part reads. A name the live cache misses is a bar-store
#: read, on the request path and inside a Daily prep note create, so the scan is bounded; the snapshot
#: carries `scanned` and `total` so a bounded scan is said, never hidden. Names go in _my_names' order.
MOVERS_SCAN_MAX = 200

#: The sentence for each gap code (the client shows `detail`; the code is for rails and logic).
PREP_GAPS = {
    "no_wire": "The morning wire has not published yet today.",
    "no_earnings_yet": "Today's earnings list has not been loaded yet. Capture again in a few minutes.",
    "no_names": "Add names to a watchlist, flag them, or hold a position to see them here.",
    "no_quotes": "None of your names has a price yet. Capture again in a few minutes.",
    "no_setups": "No setups on your board yet. Draw a plan's entry on a chart to see its levels here.",
    "source_error": "This could not be read just now. Capture again in a moment.",
}
#: What the levels part needs when the setups board is off (BlockNeedsSwitch's `what`).
LEVELS_NEEDS = "the active setups board"


def _my_names(user_id: str) -> list[str]:
    """The MEMBER's own names: open positions, watchlists, flagged (member_interest's per-source
    reads, local auth.db). N11: `all_mine` also unions the UCT 20, which is the firm's list, not the
    member's, so it is left out here; the sources are derived from member_interest.SOURCES.
    Ordered and deduplicated: by member_interest's source order (positions first), then by name, so a
    bounded reader (the movers scan) reads the names that matter most first."""
    from api.services import member_interest
    memo = _ACTIVE_BUDGET.get()
    # R-T12-C: inside a prep read, the budget is checked before EACH source read (a spent one raises
    # through, never an empty list that would read as "no names"). Outside one: the plain call.
    hook = {"before_source": lambda _name: _spend(memo)} if memo is not None else {}
    try:
        by_source = member_interest.interest_for(user_id, **hook).get("by_source") or {}
    except BudgetSpent:
        raise
    except Exception:  # noqa: BLE001 -- interest_for never raises by its own contract; belt and braces
        return []
    out: dict[str, None] = {}
    for name in member_interest.SOURCES:
        if name != "uct20":
            for sym in sorted({str(s).upper() for s in (by_source.get(name) or ()) if s}):
                out.setdefault(sym, None)
    return list(out)


def _cached_quote(sym: str, now: datetime | None = None) -> dict | None:
    """One symbol's price CACHE-ONLY (pre-flight B5): `_quotes` (live_prices' shared per-ticker cache,
    else a held daily bar's last close) classified by `_index_field`, the market context's own rules.
    {price, change_pct, source, asOf}, or None when nothing classifies. A change the row cannot prove
    is None ("change unavailable", R-T3-5), never 0.0."""
    now = now or datetime.now(timezone.utc)
    field = _index_field(sym, _quotes("", (sym,), now).get(sym), now)
    if field["missing"]:
        return None
    v = field["value"]
    return {"price": v["price"], "change_pct": v["changePct"], "source": field["source"], "asOf": field["asOf"]}


def _base(part: str, now: datetime) -> dict:
    return {"part": part, "capturedAt": _iso(now), "missing": None, "detail": None}


def _gap(out: dict, code: str) -> dict:
    out.update(missing=code, detail=PREP_GAPS[code])
    return out


def _headline(html: str) -> str | None:
    """The wire's headline: the narrative's FIRST SENTENCE (pre-flight N13). The briefing text is
    rundown_speech's (the read-aloud's one extractor); `.rd-sections` opens with the TODAY'S FOCUS
    heading and its bullet lines, none of which ends a sentence, so the first unit that does (and is
    not shouting) is the narrative's first sentence."""
    from api.services.rundown_speech import extract_rundown_speech_text, split_sentences
    for unit in split_sentences(extract_rundown_speech_text(html or "")):
        if unit[-1] in ".!?" and any(ch.islower() for ch in unit):
            return unit
    return None


def _prep_wire(user_id: str, now: datetime, memo: dict) -> dict:
    """The wire's headline, the regime (the held gate, R-M2-1 d: the same reading every block of the
    compose stamps) and the exposure (the held breadth, dated by the reading or else the wire run)."""
    from api.services import engine
    out = _base("wire", now)
    _spend(memo)
    r = engine.get_rundown() or {}
    headline = _headline(r.get("html") or "") if r.get("html") else None
    _spend(memo)
    field = _regime_field(memo)
    regime_id = field.get("value") if field.get("value") in REGIME_IDS else None
    _spend(memo)
    breadth = _breadth()
    exp = breadth.get("exposure") if isinstance(breadth.get("exposure"), dict) else {}
    score = _round1(exp.get("score"))
    as_of = exp.get("as_of") or exp.get("date") or breadth.get("wire_date") or field.get("asOf")
    out.update(headline=headline, wireDate=r.get("date") or None, regime=regime_id, exposure=score,
               exposureAsOf=(as_of or None) if score is not None else None)
    if headline is None and regime_id is None and score is None:
        _gap(out, "no_wire")
    return out


def _prep_earnings(user_id: str, now: datetime, memo: dict) -> dict:
    """Today's reporters among the member's names, from the engine's earnings CACHE only (never a
    build: engine.get_earnings goes to the vendors). `bmo` before today's open, `amc` last night after
    the close, `amcTonight` after today's close (engine.py's three buckets)."""
    from api.services import engine
    from api.services.cache import cache
    out = _base("earnings", now)
    out.update(asOf=None, bmo=[], amc=[], amcTonight=[])
    data = cache.get(engine.EARNINGS_CACHE_KEY)
    if not isinstance(data, dict) or not data:
        return _gap(out, "no_earnings_yet")
    mine = set(_my_names(user_id))
    if not mine:
        return _gap(out, "no_names")

    def pick(rows: Any) -> list[str]:
        seen: list[str] = []
        for row in rows if isinstance(rows, list) else []:
            sym = str(row.get("sym") or "").upper() if isinstance(row, dict) else ""
            if sym in mine and sym not in seen:
                seen.append(sym)
        return seen
    out.update(asOf=data.get("date") or None, bmo=pick(data.get("bmo")), amc=pick(data.get("amc")),
               amcTonight=pick(data.get("amc_tonight")))
    return out


def _prep_movers(user_id: str, now: datetime, memo: dict) -> dict:
    """The member's names, CACHED quotes only, the top MOVERS_MAX by the size of the move. A name with a
    price and no provable change is listed after every move ("change unavailable"); a name with no
    price at all is counted in `unquoted`. At most MOVERS_SCAN_MAX names are read (`scanned` of
    `total`), in _my_names' order."""
    out = _base("movers", now)
    names = list(dict.fromkeys(_my_names(user_id)))
    out.update(items=[], unquoted=0, scanned=0, total=len(names))
    if not names:
        return _gap(out, "no_names")
    scan = names[:MOVERS_SCAN_MAX]
    out.update(scanned=len(scan))
    items, unquoted = [], 0
    for sym in scan:
        # R-T12-C: the budget is checked before EVERY name. A spent budget raises out of the scan, so a
        # list cut off part way is never frozen as if it were the list (the block lands uncaptured).
        # bars_sqlite has no multi-ticker read of this shape (closes_asof loops per ticker and returns a
        # close without the prior bar's change), so the scan stays serial, under the budget.
        _spend(memo)
        q = _cached_quote(sym, now)
        if q and _num(q.get("price")) is not None:
            items.append({"symbol": sym, "price": q["price"], "changePct": _num(q.get("change_pct")),
                          "source": q.get("source"), "asOf": q.get("asOf")})
        else:
            unquoted += 1
    items.sort(key=lambda i: (i["changePct"] is None, -abs(i["changePct"] or 0.0), i["symbol"]))
    out.update(items=items[:MOVERS_MAX], unquoted=unquoted)
    if not items:
        _gap(out, "no_quotes")
    return out


def _prep_levels(user_id: str, now: datetime, memo: dict) -> dict:
    """The member's setups board, its prices CACHE-ONLY (the `prices` seam, so the board's own
    reader never runs). N12: sample (example) cards are never frozen into a member's note; one board
    page at most, with the member's own total. Off, it says what it needs."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import setups_board
    out = _base("levels", now)
    if not setups_board.enabled():
        out.update(needs=LEVELS_NEEDS)
        return out

    def prices(symbols) -> dict:
        got: dict = {}
        for s in symbols:
            _spend(memo)                # R-T12-C: before each card's price read
            if q := _cached_quote(s, now):
                got[s] = q
        return got

    def read_plan(*args):
        _spend(memo)                    # R-T12-C: inside the board's note scan, before each plan read
        return setups_board.plan_extract.read_note_plan(*args)
    _spend(memo)
    conn = get_connection()
    try:
        board = setups_board.build_cards(conn, user_id, prices=prices, read_plan=read_plan)
    finally:
        conn.close()
    own = [c for c in (board.get("cards") or []) if not c.get("example")]
    out.update(cards=own[:setups_board.PAGE_SIZE], total=len(own))
    if not own:
        _gap(out, "no_setups")
    return out


#: part -> the reader's NAME, resolved per call so a module patch reaches it (late binding).
_PREP_READERS = {"wire": "_prep_wire", "earnings": "_prep_earnings", "movers": "_prep_movers",
                 "levels": "_prep_levels"}


def prep_part(user_id: str, part: str, *, now: datetime | None = None, memo: dict | None = None,
              on_spent: str = "gap") -> dict:
    """One prep part's snapshot: `{part, capturedAt, missing, detail, ...}`. KeyError for an unknown
    part (the route's 404). A read that raises is that part's `source_error` gap, never an exception
    (N10): one unreadable cache never fails a Daily prep note create, nor the Capture now route.

    R-T12-C: the reads run under the read budget (start_budget: the compose's own when the memo has
    one, else a fresh one, so the Capture now route is bounded too). A spent budget is the route's
    existing failure shape, the `source_error` gap (the client shows its detail, "could not be read
    just now, capture again"), or, with on_spent="raise" (the composer's builder), BudgetSpent so the
    block lands uncaptured instead."""
    reader = globals()[_PREP_READERS[part]]
    now = now or datetime.now(timezone.utc)
    memo = start_budget(memo if memo is not None else {})
    token = _ACTIVE_BUDGET.set(memo)
    try:
        _spend(memo)            # a part whose turn comes after the budget is spent reads nothing
        snap = reader(user_id, now, memo)
        _spend(memo)            # only a part that FINISHED inside the budget keeps its snapshot
        return snap
    except BudgetSpent:
        if on_spent == "raise":
            raise
        import logging
        logging.getLogger(__name__).warning("[trader_blocks] prep %s: read budget spent", part)
        return _gap(_base(part, now), "source_error")
    except Exception:  # noqa: BLE001 -- an unreadable source is a named gap, never a failed note
        import logging
        logging.getLogger(__name__).warning("[trader_blocks] prep %s unreadable", part, exc_info=True)
        if on_spent == "raise" and _spent(memo):
            # A read that failed AFTER the budget ran out did not finish inside it either: the block
            # lands uncaptured, like any other part the budget stopped (R-T12-C ruling 1).
            raise BudgetSpent() from None
        return _gap(_base(part, now), "source_error")
    finally:
        _ACTIVE_BUDGET.reset(token)


def _prep_builder(part: str):
    block_id = PREP_BLOCK[part]

    def build(block: dict, ctx: dict):
        uid = ctx.get("user_id")
        # IR-S11 (part b): an older note offered the block by "Update layout" gets it with no snapshot
        # and reads nothing; never today's data in an older note. Its "Capture now" is the member's own act.
        if not uid or ctx.get("mode") == "update":
            return _node(block_id, {}, ctx), None
        try:
            snap = prep_part(uid, part, now=ctx["now"], memo=ctx.setdefault("memo", {}), on_spent="raise")
        except BudgetSpent:
            # R-T12-C: the create's read budget ran out: UNCAPTURED (the IR-S11 shape, with "Capture
            # now"), never a partial snapshot.
            return _node(block_id, {}, ctx), None
        return _node(block_id, {"snapshot": snap}, ctx), None
    return build


BUILDERS.update({PREP_BLOCK[p]: _prep_builder(p) for p in PREP_PARTS})


# ── The post-trade review pack (spec §P2 item 7; R-P2b-4, R-P2b-5) ──────────────────────────
# One read for the review block: the trade, its tags, the rules ticked before entry and the plan
# grade (or what it needs). Read-only, like every trader-blocks read: the block stores only the trade
# it names, through an editor transaction (`tradeReview`'s builder stays Task 2's empty one).
# ⛔ B6: get_trade_detail answers {"trade": {...}, "tradeRef": ...}; everything is read from the trade.
# ⛔ N15: a j2_trades uuid is reissued on every broker resync, so the review also takes the STABLE ref
# (`id:<row id>` / `ext:<external id>`, trade_refs.trade_ref_for_row) and the trade list carries it.
_TRADE_KEYS = ("id", "symbol", "side", "entryDate", "exitDate", "entryPrice", "exitPrice", "rMultiple",
               "result", "setup", "pnlPercent")
#: What the plan grade needs when its switch is off (BlockNeedsSwitch's `what`).
PLAN_GRADE_NEEDS = "plan grading"


def recent_closed_trades(user_id: str, limit: int = 20) -> list[dict]:
    """The member's closed trades, newest exit first, for the review block's picker: `{id, tradeRef,
    symbol, exitDate, result}`. `tradeRef` is what a note should store (N15)."""
    from api.services.auth_db import get_connection
    from api.services.journal_two.trade_refs import trade_ref_for_row
    c = get_connection()
    try:
        rows = c.execute("SELECT * FROM j2_trades WHERE user_id = ? ORDER BY exit_date DESC, rowid DESC LIMIT ?",
                         (user_id, int(limit))).fetchall()
        return [{"id": r["id"], "tradeRef": trade_ref_for_row(r), "symbol": r["symbol"],
                 "exitDate": r["exit_date"], "result": r["result"]} for r in rows]
    finally:
        c.close()


def _review_trade_id(conn, user_id: str, key: str) -> str | None:
    """A review key is a trade's stable ref (`id:` / `ext:`) or, as Task 2's `tradeId` param, its row id.
    A ref must BE that trade's stable ref: a broker row's ref is `ext:`, never `id:<a uuid a resync
    reissues>`."""
    from api.services.journal_two.trade_refs import resolve_trade_by_ref, trade_ref_for_row
    if key.startswith(("id:", "ext:")):
        row = resolve_trade_by_ref(user_id, key, conn)
        return row["id"] if row is not None and trade_ref_for_row(row) == key else None
    return key


def trade_review(user_id: str, trade_key: str) -> dict | None:
    """`{"trade": {_TRADE_KEYS..., tradeRef}, "tags": {"mistakes", "emotions"}, "preEntry": {setup,
    checkedRuleIds, totalRules} | None, "accountId": <the trade's account> | None, "planGrade":
    <grade_payload> | {"needs": "plan grading"}}`; None
    when the key names no trade of this member's (the route's 404, the same for another member's)."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import plan_grading
    from api.services.journal_two import trades as trades_service
    c = get_connection()
    try:
        trade_id = _review_trade_id(c, user_id, trade_key) if isinstance(trade_key, str) and trade_key else None
        detail = trades_service.get_trade_detail(user_id, trade_id, conn=c) if trade_id else None
        if detail is None:
            return None
        t = detail["trade"]
        from api.services.journal_two import adherence_store
        # THE one join (R-PF-N7, adherence_of_trade): the same fallback the before/after numbers use.
        pre = adherence_of_trade(lambda ref: adherence_store.get_adherence(user_id, ref, conn=c),
                                 detail["tradeRef"], t.get("positionId"))
        if plan_grading.enabled():
            row = plan_grading.get_trade(c, user_id, t["id"])
            grade = plan_grading.grade_payload(c, user_id, row) if row is not None else None
        else:
            grade = {"needs": PLAN_GRADE_NEEDS}
        return {"trade": {**{k: t.get(k) for k in _TRADE_KEYS}, "tradeRef": detail["tradeRef"]},
                "tags": {"mistakes": t.get("mistakeTags") or [], "emotions": t.get("emotionTags") or []},
                "preEntry": ({"setup": pre.get("setup"), "checkedRuleIds": pre.get("checkedRuleIds") or [],
                              "totalRules": pre.get("totalRules") or 0} if pre else None),
                # The account the trade is in: the block names a checklist's items from ONE account's
                # settings, so it must know whether the member's selected account is this one.
                "accountId": t.get("accountId"),
                "planGrade": grade}
    finally:
        c.close()
