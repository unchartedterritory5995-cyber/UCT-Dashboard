"""MD-1 kind `seasonality.stock` (owner: terminal-data, data wave 6) — one stock by calendar month and by weekday.

One stock's record by calendar month (the years counted, the average and the median month return, the percent of years
the month rose, and a flag on a month with too few years) and by weekday, close to close, with the window the record
covers: the Agent half of the SEAS terminal function, over the same computation as
`GET /api/research/seasonality/{sym}` (`api/services/seasonality.py: compute`).

⛔ ONLY THE BARS THE STORE ALREADY HOLDS, NEVER A FETCH (MD-1 §5). The member route reads its daily bars through the bar
serve (`api/routers/seasonality.py: _daily_bars` over `bars.serve_bars`), and a cold serve STARTS the deep history fetch
from the market-data vendor. A turn must not, so this adapter never calls either. It reads the bar store the way
`bars.daily` does (bars_daily.py): `bars_sqlite.get_bars_before` up to the newest completed session, normalised by the
serve path's own `bars_fetch._fmt_sqlite_bars` inside `bars_sanitize.suppress_meta_warm()`, which schedules no vendor
fetch. provider_calls is always 0. A rail shows the route's own reader reaching the bar serve in the same state.

A SHORT RECORD IS NEVER STATED AS THE RECORD. The store may hold only the shallow tail of a stock's history (a cold
read, before the deep read has run). The member route refuses that (`_history_is_partial`: fewer than 90% of the bars
asked for, no "this is all there is" marker, and a span under ten years) and this adapter asks the SAME function, so
the two cannot disagree about what "partial" means; the answer is then `unavailable`, with what is held, and no fetch
is started to mend it. The marker lives in memory for a few hours, so a young listing whose whole history IS held can
read as partial until the member route has read it: said in the note, and the safe way round.

WHAT IS STATED: every figure is `seasonality.compute`'s own; nothing is recomputed here. A month or a weekday with
nothing counted has `n` 0 and null figures, never 0. A month with fewer than `min_years` years counted keeps its
`thin` flag, and the note counts them. The month still running is not a return period (the service's own rule).

COMPLETED SESSIONS ONLY: the read stops at the newest completed session, so a session still trading is never in the
record. (The member route reads through the bar serve, whose daily read may carry the developing session.)

TIME (MD-1 §3): `as_of` = the regular-session close of the newest bar in the record, in UTC (the data's own time; never
the time of the read). The table is computed when it is read: that time rides as `data.read_at`. The read is `stale`,
with a note, when the newest bar held is older than the newest completed session. Every read is `historical`; the kind
is DECLARED `periodic`, the less fresh read being allowed.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the figures are computed from UCT's daily bar store, which holds the
market-data vendor's end-of-day history (docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows
T-04 and T-09: member display of daily history, and its storage) and, before 2003-09-10, yfinance history (row T-71:
the pre-2003 daily tail, class X). No row of that register names seasonality, and no row clears these figures for a
model provider (row T-14, AI processing of the vendor's numbers, is restricted and names none of them). Shown to the
member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.bars_daily import (VENDOR_FLOOR_YMD, _SYMBOL_RE, _iso_date,
                                                           _last_completed_at_or_before, _session_close_utc, _ymd)

KIND = "seasonality.stock"
SOURCE = "uct-bars"
#: a month's and a weekday's fields, by the service's own names (seasonality.compute)
MONTH_FIELDS = ("month", "label", "n", "avg_pct", "median_pct", "pct_up", "thin")
WEEKDAY_FIELDS = ("weekday", "label", "n", "avg_pct", "median_pct", "pct_up")

NOTE_WHAT = ("{symbol} by calendar month and by weekday, close to close, from the completed daily sessions UCT's bar "
             "store holds, {first} to {last} ({sessions} sessions): for each month the years counted, the average "
             "and the median month return, and the percent of those years the month rose. A record of the past, "
             "not a forecast")
NOTE_AS_OF = ("`as_of` is the close of the newest session in the record ({day}); it is never the time of the read. "
              "The table was computed at {at} (UCT's own time) from bars already held, and is not a live figure")
NOTE_COMPLETED = ("completed sessions only: a session still trading is not in the record, and the month still "
                  "running is not counted as a month")
NOTE_THIN = ("{n} of the twelve months have fewer than {min_years} years counted and are flagged `thin`: too few "
             "years to read as a pattern")
NOTE_EMPTY = "{n} of the twelve months have no year counted: their figures are null, never 0"
NOTE_STALE = ("the newest bar held is {last}; the newest completed session is {expected}. This read never fetches "
              "the missing sessions")
NOTE_PRE_FLOOR = ("the record starts before 2003-09-10: the bars before that date come from yfinance history (the "
                  "market-data vendor's daily archive starts 2003-09-10)")
NOTE_NOT_HELD = ("no completed daily bars are held for {symbol} in UCT's bar store, and this read never fetches them. "
                 "That is not the same as no pattern. Open {symbol}'s seasonality in UCT, then ask again")
NOTE_PARTIAL = ("only part of {symbol}'s daily history is held in UCT's bar store ({first} to {last}, {sessions} "
                "sessions) and it is not marked as the whole record, so a table from it would state a short record "
                "as the record. This read never starts the full read. Open {symbol}'s seasonality in UCT, then ask "
                "again")
NOTE_TOO_SHORT = ("less than one full calendar month of daily bars is held for {symbol}, so there is no month to "
                  "state. That is not the same as no pattern")
NOTE_FAILED = "the seasonality read failed; nothing is stated. That is not the same as no pattern"


def _clean(v: Any) -> Optional[str]:
    """One ticker in the bar store's own spelling (BRK-B, never BRK.B), or None."""
    s = str(v or "").strip().upper().lstrip("$").replace(".", "-") if isinstance(v, str) else ""
    return s if _SYMBOL_RE.match(s) else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    return None


def held_bars(sym: str) -> tuple[list, int, bool]:
    """(the completed daily bars the store holds, the newest completed session, whether they are only part of the
    record), WITHOUT starting a fetch: the store's own read primitives, as `bars.daily` uses them, and the member
    route's own test for a partial read."""
    from api.routers import seasonality as route
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    expected = _last_completed_at_or_before(None)
    rows = bars_sqlite.get_bars_before(sym, "D", route.DAILY_BARS, expected)
    with bars_sanitize.suppress_meta_warm():
        bars = bars_fetch._fmt_sqlite_bars(rows, "D", sym) if rows else []
    bars = [b for b in bars if isinstance(b, dict) and isinstance(b.get("t"), str) and _ymd(b["t"][:10]) <= expected]
    return bars, expected, bool(bars) and route._history_is_partial(sym, bars)


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return float(v)


def _count(v: Any) -> int:
    return int(v) if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0


def _bucket(b: Any, fields: tuple, key: str) -> Optional[dict]:
    if not isinstance(b, dict) or not isinstance(b.get(key), int) or isinstance(b.get(key), bool):
        return None
    n = _count(b.get("n"))
    out = {key: b[key], "label": b.get("label") if isinstance(b.get("label"), str) else None, "n": n,
           # nothing counted: no figure, never a 0
           "avg_pct": _num(b.get("avg_pct")) if n else None, "median_pct": _num(b.get("median_pct")) if n else None,
           "pct_up": _num(b.get("pct_up")) if n else None}
    if "thin" in fields:
        out["thin"] = b.get("thin") is not False
    return out


def read_seasonality_stock(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = _clean(params["symbol"])
    try:
        from api.services import seasonality as svc
        bars, expected, partial = held_bars(sym)              # the store only: never the bar serve, never a fetch
        if not bars:
            return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
        first, last = bars[0]["t"][:10], bars[-1]["t"][:10]
        if partial:                                           # a short record is never stated as the record
            return env.unavailable(KIND, params, SOURCE, NOTE_PARTIAL.format(symbol=sym, first=first, last=last,
                                                                             sessions=len(bars)))
        got = svc.compute(bars)
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no pattern"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    months = [x for x in (_bucket(m, MONTH_FIELDS, "month") for m in got.get("months") or []) if x]
    weekdays = [x for x in (_bucket(d, WEEKDAY_FIELDS, "weekday") for d in got.get("weekdays") or []) if x]
    full = _count(got.get("full_months"))
    if len(months) != 12 or full <= 0:
        return env.unavailable(KIND, params, SOURCE, NOTE_TOO_SHORT.format(symbol=sym))
    min_years = _count(got.get("min_years")) or int(svc.MIN_YEARS)
    newest = _ymd(last)
    stale = newest < expected
    read_at = env.utc_iso()
    empty = sum(1 for m in months if not m["n"])
    thin = sum(1 for m in months if m["n"] and m["thin"])
    pre_floor = _ymd(first) < VENDOR_FLOOR_YMD

    notes = [NOTE_WHAT.format(symbol=sym, first=first, last=last, sessions=len(bars)),
             NOTE_AS_OF.format(day=last, at=read_at), NOTE_COMPLETED]
    if thin:
        notes.append(NOTE_THIN.format(n=thin, min_years=min_years))
    if empty:
        notes.append(NOTE_EMPTY.format(n=empty))
    if stale:
        notes.append(NOTE_STALE.format(last=last, expected=_iso_date(expected)))
    if pre_floor:
        notes.append(NOTE_PRE_FLOOR)

    # `ticker` / `source` / `months` / `weekdays` / `covered_from` / `covered_to` / `full_months` / `min_years` keep
    # the route's own names
    data = {"ticker": sym, "source": "UCT daily bar store, close to close", "months": months, "weekdays": weekdays,
            "covered_from": got.get("covered_from") if isinstance(got.get("covered_from"), str) else None,
            "covered_to": got.get("covered_to") if isinstance(got.get("covered_to"), str) else None,
            "full_months": full, "min_years": min_years, "sessions": len(bars), "first_bar": first, "last_bar": last,
            "latest_completed_session": _iso_date(expected), "pre_vendor_floor": pre_floor, "read_at": read_at}
    coverage = {"evaluated": 12, "answered": 12 - empty, "dropped": 0, "not_computable": empty}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=_session_close_utc(newest),
                             source=SOURCE, data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
