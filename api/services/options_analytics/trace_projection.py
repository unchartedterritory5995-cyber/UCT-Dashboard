"""FT-049 remainder: the TRACE forward projection, and the 1-minute refresh policy.

  projection  How net dealer gamma would look at nearby PRICES over the next few SESSIONS, from
              today's open interest: a price x session grid of net GEX, and per session the price
              where it crosses zero (the projected Zero Gamma). Over the SAME cached chain the
              gamma heatmap reads (`positioning.chain`).
  refresh     The panel's refresh interval while the regular session is open (60 s), so the
              heatmaps re-read on a timer instead of only on mount.

⛔ THE PROJECTION HOLDS OPEN INTEREST FIXED. It answers "if positions stayed as they are, where
   would dealer gamma sit at price P on day D?"; new trades change it, and the method says so.
⛔ IV IS RECOVERED, NOT GUESSED. The chain carries the vendor's delta and gamma but no IV. Under
   Black-Scholes with a zero rate and no dividends, d1 = N^-1(call delta) (put: N^-1(delta + 1))
   and sigma x sqrt(t) = n(d1) / (spot x gamma), so sigma = that / sqrt(t). The same recovery the
   charm heatmap uses (`pressure.charm_per_day`). A contract expiring today, with a delta at 0/1 or
   no gamma, has no recoverable sigma: it is left out and counted, never zero.
⛔ AN EXPIRED CONTRACT DROPS OUT. At a projected session on or after its expiration a contract
   contributes nothing (counted per column), which is the whole point of projecting forward.
⛔ NO HERD. The projection is cached per (symbol, window) for `positioning.RESULT_TTL_S` through
   `positioning._cached`, which builds ONCE per key however many panels ask at once (concurrent
   misses share one build). The client adds jitter to its interval, so a room of open panels does
   not land on the server in the same second.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import math
from statistics import NormalDist
from typing import Optional

from api.services.options_analytics import positioning as pos

_N = NormalDist()

PRICE_STEPS = 21              # rows: spot -BAND% .. +BAND%
BAND_PCT = 6.0
SESSIONS = 5                  # columns: the next trading sessions, today first when it trades
REFRESH_S = 60

METHOD = ("Projected net GEX at each price and session: for every contract in the window, "
          "Black-Scholes gamma at that price with the time left to expiry on that session, x open "
          "interest x 100 x price^2 x 1% (calls positive, puts negative), summed. Volatility per "
          "contract is recovered from the vendor's own delta and gamma (zero rate, no dividends). "
          "Open interest is held at today's: new trades change the picture. A contract that has "
          "expired by a session contributes nothing to it. The projected Zero Gamma per session is "
          "the price where net GEX crosses zero between two rows.")


def sigma_of(cp: str, delta: float, gamma: float, spot: float, days: int) -> Optional[float]:
    """Annualised sigma recovered from delta and gamma, or None when the model has no answer."""
    if days < 1 or not gamma or gamma <= 0 or spot <= 0:
        return None
    nd = delta if cp == "C" else delta + 1.0
    if not 0.0 < nd < 1.0:
        return None
    sst = _N.pdf(_N.inv_cdf(nd)) / (spot * gamma)
    if sst <= 0:
        return None
    return sst / math.sqrt(days / 365.0)


def bs_gamma(price: float, strike: float, sigma: float, years: float) -> float:
    if price <= 0 or strike <= 0 or sigma <= 0 or years <= 0:
        return 0.0
    sst = sigma * math.sqrt(years)
    d1 = (math.log(price / strike) + 0.5 * sigma * sigma * years) / sst
    return _N.pdf(d1) / (price * sst)


def _sessions(today: _dt.date, n: int) -> list:
    from api.services import session_calendar
    out, d = [], today
    try:
        while len(out) < n:
            if session_calendar.is_trading_day(d):
                out.append(d)
            d += _dt.timedelta(days=1)
    except Exception:  # noqa: BLE001 -- past the calendar horizon: weekdays only
        out, d = [], today
        while len(out) < n:
            if d.weekday() < 5:
                out.append(d)
            d += _dt.timedelta(days=1)
    return out


def _flip(prices: list, col: list) -> Optional[float]:
    """The price where a column of net GEX crosses zero, interpolated; the crossing nearest the
    middle row (spot) when there are several. None when the column never changes sign."""
    best = None
    mid = len(prices) // 2
    for i in range(1, len(col)):
        a, b = col[i - 1], col[i]
        if a is None or b is None or (a < 0) == (b < 0) or a == b:
            continue
        p = prices[i - 1] + (prices[i] - prices[i - 1]) * (-a / (b - a))
        if best is None or abs(i - mid) < best[0]:
            best = (abs(i - mid), round(p, 2))
    return best[1] if best else None


def projection_from(sym: str, dte: str, ch: dict, today: Optional[_dt.date] = None) -> dict:
    from api.gex_service import contract_gex
    spot = ch["spot"]
    today = today or _dt.datetime.now(pos._ET).date()
    days_cols = _sessions(today, SESSIONS)
    step = 2 * BAND_PCT / (PRICE_STEPS - 1)
    prices = [round(spot * (1 + (-BAND_PCT + i * step) / 100.0), 2) for i in range(PRICE_STEPS)]
    legs, missing, undefined = [], 0, 0
    for r in ch["rows"]:
        if r["oi"] is None or r["delta"] is None or r["gamma"] is None:
            missing += 1
            continue
        if r["oi"] <= 0:
            continue
        try:
            exp = _dt.date.fromisoformat(r["expiration"])
        except (TypeError, ValueError):
            missing += 1
            continue
        sig = sigma_of(r["cp"], float(r["delta"]), float(r["gamma"]), spot, (exp - today).days)
        if sig is None:
            undefined += 1
            continue
        legs.append((exp, float(r["strike"]), sig, float(r["oi"]), 1 if r["cp"] == "C" else -1))
    cols, expired_by = [], []
    for d in days_cols:
        live = [(k, s, oi, sg, (exp - d).days) for exp, k, s, oi, sg in legs if (exp - d).days >= 1]
        expired_by.append(len(legs) - len(live))
        col = []
        for p in prices:
            tot = 0.0
            for k, s, oi, sg, days in live:
                g = bs_gamma(p, k, s, days / 365.0)
                if g:
                    tot += sg * contract_gex(g, oi, p)
            col.append(round(tot) if live else None)
        cols.append(col)
    grid = [[cols[j][i] for j in range(len(days_cols))] for i in range(PRICE_STEPS)]
    flat = [v for row in grid for v in row if v is not None]
    return {**pos._base(sym, dte, ch, METHOD), "measure": "projected_gex",
            "sessions": [d.isoformat() for d in days_cols], "prices": prices, "cells": grid,
            "max_abs": max((abs(v) for v in flat), default=0),
            "zero_gamma_by_session": [_flip(prices, c) for c in cols],
            "contracts_used": len(legs), "contracts_missing_inputs": missing,
            "contracts_without_recoverable_iv": undefined,
            "contracts_expired_by_session": expired_by,
            "band_pct": BAND_PCT, "unit": "$ of gamma per 1% move",
            "note": ("Open interest is held at today's; the grid is what positioning would mean if "
                     "nothing traded. A blank column has no contract left by that session.")}


async def projection(sym: str, dte: str = "month") -> dict:
    async def build():
        ch = await pos.chain(sym, dte)
        return await asyncio.to_thread(projection_from, sym, dte, ch)
    return await pos._cached("projection", sym, dte, build)


def refresh_policy(now: Optional[_dt.datetime] = None) -> dict:
    """The panel's refresh interval while the regular session is open; outside it, none."""
    from api.services import session_calendar
    now = now or _dt.datetime.now(pos._ET)
    try:
        phase = session_calendar.session_at(now)
    except Exception:  # noqa: BLE001 -- the calendar is a dataset; say we could not tell
        phase = "unknown"
    open_ = phase == "rth"
    return {"interval_s": REFRESH_S if open_ else None, "market_open": open_, "session": phase,
            "server_cache_s": pos.RESULT_TTL_S, "client_jitter_s": 10,
            "note": ("The heatmaps refresh every minute while the market is open. Each answer is "
                     "cached for a minute on the server and built once however many panels ask."
                     if open_ else "The market is closed; the heatmaps do not refresh on a timer."),
            "computed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}
