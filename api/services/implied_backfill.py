"""Historical expected move — reconstruct the pre-earnings ATM straddle for a
report that already happened.

WHY THIS EXISTS
    `implied_store` captures an expected move the night before each report, so
    the RICH/CHEAP verdict (was the option market's implied move too dear or
    too cheap versus what the stock actually did?) needs several PAIRED
    quarters before it can say anything. Waiting for those to accumulate means
    the feature stays dark for the better part of a year. Massive keeps both
    halves of what the nightly job would have seen, so the same quarters can be
    reconstructed today.

WHAT MAKES IT FAITHFUL
    Two things had to be true, and both were verified against the live API
    before this module was written (2026-08-06):

    1. Contract discovery `as_of` a past date. `/v3/reference/options/contracts`
       accepts `as_of`, so the strike ladder is the one that EXISTED then --
       not today's, which would silently include strikes listed after the fact.

    2. Historical NBBO. The live path prices a straddle off bid/ask MIDS
       (`implied_move._mid`). Daily aggregates carry only trade prices, and a
       backfill built on closes would be a different statistic wearing the same
       name -- worse than no backfill, because the verdict compares backfilled
       quarters against live ones and a method fork would read as a real edge.
       `/v3/quotes/{optionsTicker}` returns historical bid/ask, so the mid math
       is identical.

    The straddle itself is NOT reimplemented here: `implied_move.straddle_from_rows`
    and `implied_move.select_report_expiry` are imported and called. That is
    deliberate -- a second copy of this arithmetic would drift.

WHAT IS NOT IDENTICAL, AND IS RECORDED AS SUCH
    Rows are stamped `source="massive-backfill"` so they are never mistaken for
    live captures. The nightly job snapshots at whatever moment it runs; this
    reconstructs the last NBBO before the close of the prior session. Same
    method, slightly different instant.
"""
from __future__ import annotations

import datetime as _dt
import logging

from api.services import polygon_options
from api.services.implied_move import select_report_expiry, straddle_from_rows
from api.services.massive import to_polygon_symbol

_log = logging.getLogger(__name__)

SOURCE = "massive-backfill"

# How far back to look for the prior session's close. A long holiday weekend
# plus a stray market closure is comfortably inside 6 calendar days; beyond
# that we would rather return nothing than price a straddle off a stale spot.
_MAX_LOOKBACK_DAYS = 6

# Strikes to pull around spot when assembling the ATM pair. The live chain uses
# strikes_around_spot=4; matching it keeps the ATM SELECTION identical, since
# `straddle_from_rows` picks the nearest strike from whatever it is handed.
_STRIKES_AROUND_SPOT = 4

# NBBO is read at the last quote at or before this UTC instant on the prior
# session -- 21:00Z is 16:00 ET during EDT, i.e. the close. Quotes are ordered
# desc and the first is taken, so an early close simply yields the last quote
# that actually printed.
_QUOTE_CUTOFF_UTC = "T21:00:00Z"


def _prior_session_close(sym: str, report_date: str) -> tuple[str, float] | None:
    """(date, close) of the last session with a print strictly BEFORE the
    report date. That is the spot the night-before capture would have used."""
    try:
        target = _dt.date.fromisoformat(report_date)
    except (TypeError, ValueError):
        _log.warning("implied_backfill: unparseable report_date=%s", report_date)
        return None
    start = (target - _dt.timedelta(days=_MAX_LOOKBACK_DAYS)).isoformat()
    end = (target - _dt.timedelta(days=1)).isoformat()
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v2/aggs/ticker/{to_polygon_symbol(sym.upper())}/range/1/day/{start}/{end}",
            {"adjusted": "true", "sort": "desc", "limit": 10},
        )
    except Exception as exc:
        _log.warning("implied_backfill: spot fetch failed for %s: %s", sym, exc)
        return None
    for row in (data.get("results") or []):
        close = row.get("c")
        ts = row.get("t")
        if not isinstance(close, (int, float)) or isinstance(close, bool) or close <= 0:
            continue
        try:
            day = _dt.datetime.fromtimestamp(ts / 1000, _dt.timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            continue
        return day, float(close)
    return None


def _expiry_for(sym: str, report_date: str, as_of: str) -> str | None:
    """The expiry the night-before capture would have chosen: the first one on
    or after the report date, among contracts that existed `as_of`."""
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v3/reference/options/contracts",
            {"underlying_ticker": to_polygon_symbol(sym.upper()), "as_of": as_of,
             "expiration_date.gte": report_date, "sort": "expiration_date",
             "order": "asc", "limit": 1000},
        )
    except Exception as exc:
        _log.warning("implied_backfill: contract discovery failed for %s: %s", sym, exc)
        return None
    expirations = {c.get("expiration_date") for c in (data.get("results") or [])}
    # Reuses the LIVE selection rule rather than taking the first row back:
    # same tie-breaking, same "report beyond every listed expiry -> None".
    return select_report_expiry(sorted(e for e in expirations if e), report_date)


def _contracts_near_spot(sym: str, expiry: str, as_of: str, spot: float) -> list[dict]:
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v3/reference/options/contracts",
            {"underlying_ticker": to_polygon_symbol(sym.upper()), "as_of": as_of,
             "expiration_date": expiry, "sort": "strike_price",
             "order": "asc", "limit": 1000},
        )
    except Exception as exc:
        _log.warning("implied_backfill: strike ladder failed for %s: %s", sym, exc)
        return []
    rows = []
    for c in (data.get("results") or []):
        strike, kind, tick = c.get("strike_price"), c.get("contract_type"), c.get("ticker")
        if not isinstance(strike, (int, float)) or not tick or kind not in ("call", "put"):
            continue
        rows.append({"strike": float(strike), "kind": kind, "ticker": tick})
    if not rows:
        return []
    # Keep the N strikes nearest spot on each side -- the same neighbourhood
    # the live chain requests. Pulling every strike would be thousands of
    # per-contract NBBO calls for one quarter.
    strikes = sorted({r["strike"] for r in rows}, key=lambda s: abs(s - spot))
    keep = set(strikes[: _STRIKES_AROUND_SPOT * 2])
    return [r for r in rows if r["strike"] in keep]


def _nbbo_at(option_ticker: str, as_of: str) -> dict | None:
    """Last bid/ask at or before the prior session's close."""
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v3/quotes/{option_ticker}",
            {"timestamp.lte": f"{as_of}{_QUOTE_CUTOFF_UTC}", "order": "desc",
             "sort": "timestamp", "limit": 1},
        )
    except Exception as exc:
        _log.debug("implied_backfill: nbbo failed for %s: %s", option_ticker, exc)
        return None
    for q in (data.get("results") or []):
        bid, ask = q.get("bid_price"), q.get("ask_price")
        if bid is None or ask is None:
            continue
        # Shaped exactly like a `polygon_options.get_chain` row so
        # `straddle_from_rows` cannot tell the two paths apart.
        return {"bid": bid, "ask": ask}
    return None


def historical_expected_move(sym: str, report_date: str) -> dict | None:
    """Reconstruct the expected move as of the session before `report_date`.

    Returns the same shape as `implied_move.compute_expected_move` (plus
    `as_of`), or None when any leg is unavailable. Never raises.
    """
    sym = (sym or "").upper().strip()
    if not sym or not report_date:
        return None

    prior = _prior_session_close(sym, report_date)
    if not prior:
        _log.debug("implied_backfill %s %s: no prior session close", sym, report_date)
        return None
    as_of, spot = prior

    expiry = _expiry_for(sym, report_date, as_of)
    if not expiry:
        _log.debug("implied_backfill %s %s: no expiry on/after report", sym, report_date)
        return None

    contracts = _contracts_near_spot(sym, expiry, as_of, spot)
    if not contracts:
        _log.debug("implied_backfill %s %s: no strikes near spot", sym, report_date)
        return None

    calls, puts = [], []
    for c in contracts:
        quote = _nbbo_at(c["ticker"], as_of)
        if not quote:
            continue
        (calls if c["kind"] == "call" else puts).append({"strike": c["strike"], **quote})

    straddle = straddle_from_rows(calls, puts, spot)
    if straddle is None:
        _log.debug("implied_backfill %s %s: no usable ATM straddle", sym, report_date)
        return None

    return {
        **straddle,
        "expiry": expiry,
        "horizon": f"through {expiry}",
        "as_of": as_of,
        "asof": as_of,
        "source": SOURCE,
    }
