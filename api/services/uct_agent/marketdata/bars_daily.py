"""MD-1 kind `bars.daily` (owner: agent-md) — contract MD-1 §4.

Completed daily sessions read from UCT's canonical bars store (`services/bars_fetch.py` over
`services/bars_sqlite.py`, the same rows the charts serve), read-only and with zero provider calls.

Why the store's read primitives and not `bars_fetch._get_bars_inner` (the /api/bars core): that path
records the request, may kick a background deep-fill or cold fetch, and writes the memory cache — side
effects MD-1 §6.2 forbids. The reads used here are:
  * `bars_sqlite.get_bars_before(ticker, "D", n, to_key)` — point-in-time window ending at `to_key`;
  * `bars_fetch._fmt_sqlite_bars(rows, "D", ticker)` — the serve path's own normalisation (garbage-bar
    filter + `bars_sanitize` listing-cutoff/split repair), inside `bars_sanitize.suppress_meta_warm()`, the
    existing switch that makes a cold metadata miss schedule NO provider fetch;
  * `bars_fetch._last_closed_session_yyyymmdd` / `_session_close_minutes` — the product's own session
    calendar (weekends, NYSE holidays, early closes).

Semantics:
  * only COMPLETED sessions: the window ends at the most recent closed session (or the caller's `to`
    date, whichever is earlier), so today's developing bar is never returned as a daily bar;
  * freshness is always `historical`;
  * `as_of` = the regular-session close of the newest bar returned, in UTC (the data's own time);
  * `stale` = the newest bar is older than the newest completed session at or before the cutoff
    (MD-1 budget: 1 session);
  * a symbol the store does not hold is `unavailable` with a note — this adapter never fetches it.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-bars"
DEFAULT_BARS = 60
MAX_BARS = 500
_ET = ZoneInfo("America/New_York")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_COMPLETED = "completed sessions only — the current session's developing bar is never included"


def _ymd(d: str) -> int:
    return int(d.replace("-", ""))


def _iso_date(ymd: int) -> str:
    s = str(ymd)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def _session_close_utc(ymd: int) -> str:
    from api.services import bars_fetch
    s = str(ymd)
    mins = bars_fetch._session_close_minutes(ymd)
    close = datetime(int(s[:4]), int(s[4:6]), int(s[6:]), tzinfo=_ET) + timedelta(minutes=mins)
    return env.utc_iso(close)


def _last_completed_at_or_before(cutoff: Optional[int]) -> int:
    """The newest closed session; with a cutoff date, the newest closed session on or before it."""
    from api.services.uct_agent.marketdata.sessions import last_completed_session
    latest = last_completed_session()          # half days count from their own close (agent-qa F-23)
    if cutoff is None or cutoff >= latest:
        return latest
    s = str(cutoff)
    # the end of the cutoff day (ET) -> that day if it was a session, else the prior session
    end_of_day = datetime(int(s[:4]), int(s[4:6]), int(s[6:]), 23, 59, tzinfo=_ET)
    return last_completed_session(now=end_of_day)


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission (Kind.validate), so a malformed request
    is refused and spends no read or provider budget. Returns the reason, or None when the request is
    well-formed. The adapter asks it again, so a direct call cannot bypass it."""
    sym = str(params.get("symbol") or "").strip().upper()
    if not _SYMBOL_RE.match(sym):
        return "a valid ticker symbol is required"
    n = params.get("bars", DEFAULT_BARS)
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        return "`bars` must be a positive whole number"
    to = params.get("to")
    if to is not None:
        if not isinstance(to, str) or not _DATE_RE.match(to):
            return "`to` must be a date like 2026-10-30"
        try:
            datetime.strptime(to, "%Y-%m-%d")
        except ValueError:
            return "`to` is not a real calendar date"
    return None


def read_bars_daily(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "bars.daily"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    sym = str(params["symbol"]).strip().upper()
    n = min(params.get("bars", DEFAULT_BARS), MAX_BARS)
    to = params.get("to")
    cutoff: Optional[int] = _ymd(to) if to is not None else None

    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    expected = _last_completed_at_or_before(cutoff)
    rows = bars_sqlite.get_bars_before(sym, "D", n, expected)
    with bars_sanitize.suppress_meta_warm():
        bars = bars_fetch._fmt_sqlite_bars(rows, "D", sym) if rows else []
    bars = [b for b in bars if isinstance(b.get("t"), str) and _ymd(b["t"]) <= expected]
    if not bars:
        return env.unavailable(kind, params, SOURCE, f"no completed daily bars are held for {sym}")

    newest = _ymd(bars[-1]["t"])
    stale = newest < expected
    notes = [NOTE_COMPLETED]
    if stale:
        notes.append(f"the newest bar held is {bars[-1]['t']}; the newest completed session is "
                     f"{_iso_date(expected)}")
    if cutoff is not None:
        notes.append(f"point-in-time: bars on or before {to}")
    if len(bars) < n:
        notes.append(f"{len(bars)} of {n} requested bars are held")
    out_bars = [{"date": b["t"], "open": _num(b.get("o")), "high": _num(b.get("h")), "low": _num(b.get("l")),
                 "close": _num(b.get("c")), "volume": int(b["v"]) if _num(b.get("v")) is not None else None}
                for b in bars]
    status = "ok" if len(bars) >= n else "partial"
    data = {"symbol": sym, "bars": out_bars, "through": bars[-1]["t"],
            "latest_completed_session": _iso_date(expected)}
    return env.make_envelope(kind, params, status=status, freshness="historical",
                             as_of=_session_close_utc(newest), source=SOURCE, data=data, stale=stale,
                             notes=notes, provider_calls=0)
