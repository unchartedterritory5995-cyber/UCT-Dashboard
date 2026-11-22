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
  * a symbol the store does not hold is `unavailable` with a note — this adapter never fetches it;
  * W2-B2 (builder-b): `from` (an ISO day) opens a WINDOW — the bars on or after it, up to the cutoff — read as ONE
    `get_bars_before` of up to MAX_BARS (or `bars`, when given, as a cap) and filtered here; when the store's oldest
    held bar is after `from`, the read is `partial` and says where the held bars start.
  * Phase 2 history (hist-builder): `tf` = D (default) | W | M. A weekly / monthly read is the SAME daily store read,
    resampled by the product's OWN resamplers — `bars_fetch._resample_weekly_iso` (friday-close dating: the startup
    fingerprint's `weekly_dating=friday-close`) and `_resample_monthly_iso` (keyed on the 1st) — never a new one. Each
    period carries the sessions it holds, its close-to-close change vs the previous period's close, and `partial`: a
    period with an NYSE session after its last held session, up to its own end, is NOT closed — `forming` when that
    session is after the newest completed session (the current week / month), else `missing_sessions`. A forming
    period is never presented as a closed bar.
  * a row dated before Massive's daily archive floor (2003-09-10) came from the yfinance pre-2003 graft
    (bars_fetch deep path): it carries `pre_vendor_floor: true` and the read says so in a note.
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
TIMEFRAMES = ("D", "W", "M")
#: periods one W / M read may return (W: ~10 years, M: 25 years) and the daily rows that may feed them
MAX_PERIODS = {"W": 520, "M": 300}
SESSIONS_PER_PERIOD = {"W": 5, "M": 23}
MAX_DAILY_FOR_PERIODS = 7000
#: Massive's daily archive starts here (bars_fetch deep path; deep_history_warm._VENDOR_FLOOR_YMD["D"]): an older row
#: in the store came from the yfinance pre-2003 graft
VENDOR_FLOOR_YMD = 20030910
_ET = ZoneInfo("America/New_York")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_COMPLETED = "completed sessions only — the current session's developing bar is never included"
NOTE_FROM = "window: bars on or after {d}"
NOTE_FROM_SHORT = "the store's oldest held bar in the window is {first}, after the {d} asked for"
NOTE_RESAMPLED = {"W": "weekly bars resampled from completed daily sessions by the product's own resampler, each dated by its week's Friday (friday-close)",
                  "M": "monthly bars resampled from completed daily sessions by the product's own resampler, each dated by its month's 1st"}
NOTE_FORMING = "the newest {unit} ({d}) is still forming: it is partial, not a closed bar"
NOTE_PRE_FLOOR = "rows before 2003-09-10 come from yfinance history (Massive's daily archive starts 2003-09-10)"


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
    for key in ("to", "from"):
        v = params.get(key)
        if v is None:
            continue
        if not isinstance(v, str) or not _DATE_RE.match(v):
            return f"`{key}` must be a date like 2026-10-30"
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            return f"`{key}` is not a real calendar date"
    if params.get("from") is not None and params.get("to") is not None and params["from"] > params["to"]:
        return "`from` must be on or before `to`"
    tf = params.get("tf", "D")
    if tf not in TIMEFRAMES:
        return "`tf` is D (daily), W (weekly) or M (monthly)"
    if tf != "D" and n > MAX_PERIODS[tf]:
        return f"`bars` for {tf} is at most {MAX_PERIODS[tf]}"
    return None


def read_bars_daily(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "bars.daily"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    if params.get("tf", "D") != "D":
        return _read_periods(params)
    sym = str(params["symbol"]).strip().upper()
    frm = params.get("from")
    # a window read (`from`) takes the whole held depth unless `bars` caps it; a count read takes `bars`
    n = min(params.get("bars", MAX_BARS if frm is not None else DEFAULT_BARS), MAX_BARS)
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
    short_window = False
    if frm is not None:
        oldest_held = bars[0]["t"]
        bars = [b for b in bars if b["t"] >= frm]
        if not bars:
            return env.unavailable(kind, params, SOURCE, f"no completed daily bars are held for {sym} on or after {frm}")
        # the read returned fewer than it could hold AND its oldest bar is after `from`: the store does not go back that far
        short_window = oldest_held > frm and len(rows) < n

    newest = _ymd(bars[-1]["t"])
    stale = newest < expected
    notes = [NOTE_COMPLETED]
    if stale:
        notes.append(f"the newest bar held is {bars[-1]['t']}; the newest completed session is "
                     f"{_iso_date(expected)}")
    if cutoff is not None:
        notes.append(f"point-in-time: bars on or before {to}")
    if frm is not None:
        notes.append(NOTE_FROM.format(d=frm))
        if short_window:
            notes.append(NOTE_FROM_SHORT.format(d=frm, first=bars[0]["t"]))
    elif len(bars) < n:
        notes.append(f"{len(bars)} of {n} requested bars are held")
    out_bars = [{"date": b["t"], "open": _num(b.get("o")), "high": _num(b.get("h")), "low": _num(b.get("l")),
                 "close": _num(b.get("c")), "volume": int(b["v"]) if _num(b.get("v")) is not None else None,
                 **({"pre_vendor_floor": True} if _ymd(b["t"]) < VENDOR_FLOOR_YMD else {})}
                for b in bars]
    if out_bars and _ymd(out_bars[0]["date"]) < VENDOR_FLOOR_YMD:
        notes.append(NOTE_PRE_FLOOR)
    status = ("partial" if short_window else "ok") if frm is not None else ("ok" if len(bars) >= n else "partial")
    data = {"symbol": sym, "bars": out_bars, "through": bars[-1]["t"],
            "latest_completed_session": _iso_date(expected), **({"window_from": frm} if frm is not None else {})}
    return env.make_envelope(kind, params, status=status, freshness="historical",
                             as_of=_session_close_utc(newest), source=SOURCE, data=data, stale=stale,
                             notes=notes, provider_calls=0)


# ── W / M: the daily store read, resampled by the product's own resamplers ──────────────────────────────────

def _is_session(ymd: int) -> bool:
    from api.services import bars_fetch
    s = str(ymd)
    return datetime(int(s[:4]), int(s[4:6]), int(s[6:])).weekday() < 5 and not bars_fetch._is_nyse_holiday(ymd)


def _period_end(tf: str, key: str) -> datetime:
    """The last calendar day a period can hold a session: its Friday (a W key IS the Friday) or its month's last day."""
    d = datetime.strptime(key, "%Y-%m-%d")
    if tf == "W":
        return d
    return datetime(d.year + (d.month == 12), d.month % 12 + 1, 1) - timedelta(days=1)


def _sessions_after(last_session: str, end: datetime) -> list[int]:
    """NYSE sessions strictly after `last_session`, up to `end` (the period's own last day)."""
    out, d = [], datetime.strptime(last_session, "%Y-%m-%d") + timedelta(days=1)
    while d <= end:
        ymd = int(d.strftime("%Y%m%d"))
        if _is_session(ymd):
            out.append(ymd)
        d += timedelta(days=1)
    return out


def period_key(tf: str, iso: str) -> str:
    """The key the product's resampler stamps on the period holding `iso`: the ISO week's Friday, or the month's 1st."""
    d = datetime.strptime(iso, "%Y-%m-%d")
    if tf == "W":
        y, w, _ = d.isocalendar()
        return datetime.fromisocalendar(y, w, 5).strftime("%Y-%m-%d")
    return d.replace(day=1).strftime("%Y-%m-%d")


def _read_periods(params: dict) -> dict:
    kind = "bars.daily"
    tf = params["tf"]
    unit = {"W": "week", "M": "month"}[tf]
    sym = str(params["symbol"]).strip().upper()
    frm = params.get("from")
    to = params.get("to")
    cutoff: Optional[int] = _ymd(to) if to is not None else None
    # a window read (`from`) takes every period in the window unless `bars` caps it; a count read takes `bars`
    want = None if (frm is not None and params.get("bars") is None) else min(params.get("bars", DEFAULT_BARS), MAX_PERIODS[tf])
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    expected = _last_completed_at_or_before(cutoff)
    per = SESSIONS_PER_PERIOD[tf]
    if frm is not None:
        days = (datetime.strptime(_iso_date(expected), "%Y-%m-%d") - datetime.strptime(frm, "%Y-%m-%d")).days
        n_daily = int(max(days, 0) * 252 / 365) + 2 * per + 10        # + the period before `from`, for its change
    else:
        n_daily = (want + 2) * per                                     # + the period before the first, for its change
    n_daily = min(n_daily, MAX_DAILY_FOR_PERIODS)
    rows = bars_sqlite.get_bars_before(sym, "D", n_daily, expected)
    with bars_sanitize.suppress_meta_warm():
        daily = bars_fetch._fmt_sqlite_bars(rows, "D", sym) if rows else []
    daily = [b for b in daily if isinstance(b.get("t"), str) and _ymd(b["t"]) <= expected]
    if not daily:
        return env.unavailable(kind, params, SOURCE, f"no completed daily bars are held for {sym}")
    # the product's own resamplers (friday-close weekly dating) — never a new one
    resample = bars_fetch._resample_weekly_iso if tf == "W" else bars_fetch._resample_monthly_iso
    periods = resample(daily, sym)
    held_by: dict[str, list[str]] = {}
    for b in daily:
        held_by.setdefault(period_key(tf, b["t"]), []).append(b["t"])
    out, prev_close = [], None
    for p in periods:
        held = held_by.get(p["t"]) or []
        c = _num(p.get("c"))
        if not held or c is None:
            continue
        missing = _sessions_after(held[-1], _period_end(tf, p["t"]))
        forming = any(d > expected for d in missing)
        out.append({"date": p["t"], "first_session": held[0], "last_session": held[-1], "sessions": len(held),
                    "open": _num(p.get("o")), "high": _num(p.get("h")), "low": _num(p.get("l")), "close": c,
                    "volume": int(p["v"]) if _num(p.get("v")) is not None else None,
                    "change_pct": (c / prev_close - 1.0) * 100.0 if prev_close else None,
                    "partial": bool(missing),
                    **({"partial_reason": "forming" if forming else "missing_sessions"} if missing else {}),
                    **({"pre_vendor_floor": True} if _ymd(held[0]) < VENDOR_FLOOR_YMD else {})})
        prev_close = c
    # a read that reached its row cap may have cut the OLDEST period mid-way: its close still dates the next period's
    # change, but it is never shown as a whole period
    if len(rows) >= n_daily and len(out) > 1:
        out = out[1:]
    short_window = False
    if frm is not None:
        oldest_held = out[0]["first_session"] if out else None
        out = [r for r in out if r["date"] >= period_key(tf, frm)]
        if not out:
            return env.unavailable(kind, params, SOURCE, f"no completed daily bars are held for {sym} on or after {frm}")
        short_window = bool(oldest_held) and oldest_held > frm and len(rows) < n_daily
        if want is not None:
            out = out[-want:]
    else:
        out = out[-want:]
    newest = _ymd(out[-1]["last_session"])
    stale = newest < expected
    notes = [NOTE_COMPLETED, NOTE_RESAMPLED[tf]]
    if out[-1].get("partial_reason") == "forming":
        notes.append(NOTE_FORMING.format(unit=unit, d=out[-1]["date"]))
    if stale:
        notes.append(f"the newest bar held is {out[-1]['last_session']}; the newest completed session is {_iso_date(expected)}")
    if cutoff is not None:
        notes.append(f"point-in-time: sessions on or before {to}")
    if frm is not None:
        notes.append(NOTE_FROM.format(d=frm))
        if short_window:
            notes.append(NOTE_FROM_SHORT.format(d=frm, first=out[0]["first_session"]))
    elif len(out) < want:
        notes.append(f"{len(out)} of {want} requested {unit}s are held")
    if any(r.get("pre_vendor_floor") for r in out):
        notes.append(NOTE_PRE_FLOOR)
    status = ("partial" if short_window else "ok") if frm is not None else ("ok" if len(out) >= want else "partial")
    data = {"symbol": sym, "timeframe": tf, "bars": out, "through": out[-1]["last_session"],
            "latest_completed_session": _iso_date(expected), "current_period_partial": bool(out[-1]["partial"]),
            **({"window_from": frm} if frm is not None else {})}
    return env.make_envelope(kind, params, status=status, freshness="historical", as_of=_session_close_utc(newest),
                             source=SOURCE, data=data, stale=stale, notes=notes, provider_calls=0)
