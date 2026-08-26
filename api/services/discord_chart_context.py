"""The context line under a Discord chart.

One short line the member reads beside the image: when the company reports
next, the move the options market prices into that report, and today's
catalyst if the Stock Catalysts engine ranked the name. Everything here is
best-effort and cached per ticker: a chart never waits on it (the job posts
the image first, then edits the line in), a failed lookup drops its part
silently, and the line is capped so Discord never wraps it into a paragraph.

    NVDA · Daily
    Earnings Wed Nov 19 (in 12d) · ±8.1% implied · Catalyst #2 (Earnings): Blackwell ...

Sources (read only, all already cached upstream):
  - `earnings_table.get_earnings_table` - the fundamentals widget's table; its
    forward rows carry `report_date`.
  - `earnings_enrichment.get_implied_move` - front-week ATM straddle; asked
    only when the report is inside `IMPLIED_WINDOW_DAYS` (that is the window
    where the straddle prices the event rather than ordinary drift).
  - `catalyst.store.get_ticker_for_date` - today's Stock Catalysts row.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
import re
import threading
import time
from typing import Callable, Optional
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")
CONTEXT_TTL_S = 30 * 60          # one lookup per ticker per half hour
IMPLIED_WINDOW_DAYS = 14         # ask the straddle only this close to the report
MAX_LEN = 180                    # one Discord line, never a paragraph

_cache: dict[str, tuple[float, str]] = {}
_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("DISCORD_CHART_CONTEXT", "1").strip().lower() not in ("0", "false", "off", "")


def today_et() -> _dt.date:
    return _dt.datetime.now(_ET).date()


# ── default fetchers (prod); tests inject their own ──────────────────────────

def _next_earnings(ticker: str, today: _dt.date) -> Optional[dict]:
    """The next scheduled report date - the fundamentals card's own lookup
    (`earnings_table._next_report_date`: calendar-aware, cached, 0.03 s on the
    pod), NOT the table's forward rows. Measured on the web pod 2026-08-25:
    those rows carried report_date=None for NVDA two days before its report
    (the nearest forward quarter fails the period-end sanity gate), while
    _next_report_date answered 2026-08-26."""
    from api.services import earnings_table
    d = _parse_date(earnings_table._next_report_date(ticker))
    if d is None or d < today:
        return None
    return {"report_date": d.isoformat()}


def _implied(ticker: str, report_date: str) -> Optional[dict]:
    from api.services import earnings_enrichment
    return earnings_enrichment.get_implied_move(ticker, report_date)


def _catalyst(ticker: str, today: _dt.date) -> Optional[dict]:
    from api.services.catalyst import store
    return store.get_ticker_for_date(ticker, today.isoformat())


# ── composition (pure) ───────────────────────────────────────────────────────

def _parse_date(s) -> Optional[_dt.date]:
    if not s:
        return None
    try:
        return _dt.date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def _when(d: _dt.date, today: _dt.date) -> str:
    days = (d - today).days
    if days == 0:
        return "TODAY"
    if days == 1:
        return "tomorrow"
    return f"{d:%a %b} {d.day} (in {days}d)"       # no %-d on Windows


_MD = re.compile(r"\*\*|__|`")
_WS = re.compile(r"\s+")


def _first_sentence(text: str, limit: int) -> str:
    t = _WS.sub(" ", _MD.sub("", str(text or ""))).strip()
    if not t:
        return ""
    m = re.match(r"(.+?[.!?])(\s|$)", t)
    s = m.group(1) if m else t
    if len(s) > limit:
        s = s[: max(0, limit - 1)].rstrip(" ,;:") + "…"
    return s


def compose(ticker: str, *, today: _dt.date, earnings: Optional[dict] = None,
            implied: Optional[dict] = None, catalyst: Optional[dict] = None) -> str:
    """Build the line from already-fetched parts. Missing/odd parts drop out;
    an empty string means "nothing worth saying"."""
    parts: list[str] = []
    d = _parse_date((earnings or {}).get("report_date"))
    if d is not None and d >= today:
        s = f"Earnings {_when(d, today)}"
        pct = (implied or {}).get("pct")
        if pct is not None and (d - today).days <= IMPLIED_WINDOW_DAYS:
            try:
                s += f" · ±{float(pct):.1f}% implied"
            except (TypeError, ValueError):
                pass
        parts.append(s)
    if catalyst and catalyst.get("thesis_text"):
        head = "Catalyst"
        rank = catalyst.get("rank")
        if isinstance(rank, int) and rank > 0:
            head += f" #{rank}"
        tag = str(catalyst.get("tag") or "").strip()
        if tag and tag.lower() != "catalyst":       # "Catalyst #15 (Catalyst)" reads like a stutter
            head += f" ({tag})"
        room = MAX_LEN - len(" · ".join(parts)) - (3 if parts else 0) - len(head) - 2
        sentence = _first_sentence(catalyst["thesis_text"], max(24, room))
        if sentence:
            parts.append(f"{head}: {sentence}")
    line = " · ".join(parts)
    if len(line) > MAX_LEN:
        line = line[: MAX_LEN - 1].rstrip(" ,;:·") + "…"
    return line


# ── entry point ──────────────────────────────────────────────────────────────

def context_line(ticker: str, *, today: Optional[_dt.date] = None,
                 earnings_fn: Callable = _next_earnings, implied_fn: Callable = _implied,
                 catalyst_fn: Callable = _catalyst, ttl_s: float = CONTEXT_TTL_S) -> str:
    """The line for `ticker`, cached per ticker. Never raises; a fetcher that
    fails or is slow only loses its own part."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return ""
    today = today or today_et()
    key = f"{ticker}:{today.isoformat()}"
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    earnings = implied = catalyst = None
    try:
        earnings = earnings_fn(ticker, today)
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] context earnings failed %s: %s", ticker, e)
    d = _parse_date((earnings or {}).get("report_date")) if earnings else None
    if d is not None and 0 <= (d - today).days <= IMPLIED_WINDOW_DAYS:
        try:
            implied = implied_fn(ticker, d.isoformat())
        except Exception as e:  # noqa: BLE001
            log.warning("[discord-chart] context implied move failed %s: %s", ticker, e)
    try:
        catalyst = catalyst_fn(ticker, today)
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] context catalyst failed %s: %s", ticker, e)
    line = compose(ticker, today=today, earnings=earnings, implied=implied, catalyst=catalyst)
    with _lock:
        _cache[key] = (now + ttl_s, line)
        if len(_cache) > 2000:
            for k in [k for k, (exp, _) in _cache.items() if exp <= now][:500]:
                _cache.pop(k, None)
    return line


def clear_for_tests() -> None:
    with _lock:
        _cache.clear()
