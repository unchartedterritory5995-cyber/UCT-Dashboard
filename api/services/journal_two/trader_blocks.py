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
from datetime import date, datetime, timezone
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


def _breadth_held() -> bool:
    """True when engine.get_breadth answers from what this pod already holds (its cache, the state
    file, the pushed wire), False when its next step would be the live fetch (R-W0-1)."""
    from api.services import engine
    if engine.cache.get("breadth"):
        return True
    if (engine._load_state() or {}).get("breadth_data"):
        return True
    wire = engine._load_wire_data()
    return bool(wire and wire.get("breadth"))


def _breadth() -> dict:
    """The wire's breadth payload (the source /charts' Market Context reads), or {} when the pod
    holds none (never the live fetch)."""
    if not _breadth_held():
        return {}
    from api.services import engine
    payload = engine.get_breadth()
    return payload if isinstance(payload, dict) else {}


def _regime_field(memo: dict) -> dict:
    """The regime field as entry context reads it (entry_context._regime_fields: the wire only).
    It reaches engine.get_breadth too, so a cold hold answers "not published" without asking."""
    if not _breadth_held():
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


def _last_close(sym: str) -> dict | None:
    """The last close of the newest HELD daily bar (bars_sqlite, local), as a quote row; None when
    none is held. Its change is against the bar before it."""
    from api.routers import live_prices
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym, "D", 2)
    if not rows:
        return None
    last = rows[-1]
    close = _num(last[4])
    day = _bar_day(last[0])
    if close is None or close <= 0 or day is None:
        return None
    prior = _num(rows[-2][4]) if len(rows) > 1 else None
    closed_at = live_prices._session_close_epoch(day)
    return {"price": round(close, 2),
            "change_pct": round((close - prior) / prior * 100.0, 4) if prior else None,
            "market_closed": True, "source": "last close",
            "asOf": _epoch_iso(closed_at) if closed_at is not None else day.isoformat()}


def _quotes(user_id: str, symbols: tuple[str, ...]) -> dict:
    """SPY/QQQ for the stamp, CACHE-ONLY (R-W0-1): the live-price route's shared 15 s per-ticker
    cache (the rows its own polls write), else the last close of a held daily bar, else absent.
    `user_id` is part of the seam's shape; nothing here is per member."""
    from api.routers import live_prices
    out: dict = {}
    for sym in symbols:
        row = live_prices.cache.get(live_prices._px_key(sym))
        if not isinstance(row, dict):
            try:
                row = _last_close(sym)
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


def _index_field(sym: str, q: Any) -> dict:
    if isinstance(q, dict) and _num(q.get("price")) is not None:
        return {"value": {"price": q["price"], "changePct": _num(q.get("change_pct")),
                          "closed": bool(q.get("market_closed"))},
                "source": q.get("source") or "live price",
                # A live row carries the vendor's observation epoch; a closed-market row the
                # epoch of the session close it IS; a held bar its own date.
                "asOf": q.get("asOf") or _epoch_iso(q.get("observed_at")) or _epoch_iso(q.get("session_close_at")),
                "missing": None}
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
        quotes = _quotes(user_id, tuple(sym for _, sym in _INDEXES))
    except Exception:  # noqa: BLE001
        quotes = {}
    quotes = quotes if isinstance(quotes, dict) else {}
    for key, sym in _INDEXES:
        readings[key] = _index_field(sym, quotes.get(sym))
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
        params = {"uncaptured": True, "fields": fields}
    else:
        params = {**market_context_params(ctx.setdefault("memo", {}), user_id=ctx.get("user_id") or "",
                                          now=ctx["now"]), "fields": fields}
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "marketcontext", "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params,
        "capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None,
    }}, None


BUILDERS["marketcontext"] = build_market_context
