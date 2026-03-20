"""api/services/uct20_nav.py

Tracks UCT20 as an actively managed equal-weight portfolio.

Each morning wire push records the current composition (holdings list) with
today's date. When theme_performance computes UCT20 returns, it calls
compute_portfolio_returns() which:

  1. Loads all stored compositions
  2. Fetches price bars for every symbol that has ever been in UCT20
  3. Builds a NAV time series: for each consecutive date pair, computes the
     equal-weight portfolio return using the PREVIOUS composition's holdings
  4. Derives 1D/1W/1M/3M/1Y/YTD from the NAV curve (trading-day counts)

Data stored in /data/uct20_compositions.json (Railway volume — persists
forever across redeploys). NAV grows more accurate over time as composition
history accumulates. Periods without enough history return None ("—").
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from api.services.massive import get_agg_bars

_COMPOSITIONS_FILE = "/data/uct20_compositions.json"
_MAX_HISTORY_DAYS = 420  # ~14 months, matches theme_performance bar window


# ── Composition storage ───────────────────────────────────────────────────────

def _load_compositions() -> list[dict]:
    try:
        if not os.path.exists(_COMPOSITIONS_FILE):
            return []
        with open(_COMPOSITIONS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_compositions(compositions: list[dict]) -> None:
    try:
        os.makedirs(os.path.dirname(_COMPOSITIONS_FILE), exist_ok=True)
        tmp = _COMPOSITIONS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(compositions, f, separators=(",", ":"))
        os.replace(tmp, _COMPOSITIONS_FILE)
    except Exception:
        pass


def record_composition(holdings: list[str]) -> None:
    """
    Record today's UCT20 holdings. Call this on every wire push.
    Deduplicates by date — one entry per calendar day (re-pushes overwrite).
    """
    if not holdings:
        return
    today = date.today().isoformat()
    compositions = _load_compositions()

    # Overwrite any existing entry for today (idempotent re-push)
    compositions = [c for c in compositions if c.get("date") != today]
    compositions.append({"date": today, "holdings": list(holdings)})

    # Trim to rolling window
    cutoff = (date.today() - timedelta(days=_MAX_HISTORY_DAYS)).isoformat()
    compositions = [c for c in compositions if c.get("date", "") >= cutoff]
    compositions.sort(key=lambda c: c["date"])

    _save_compositions(compositions)
    print(f"[uct20-nav] Composition recorded {today}: {len(holdings)} holdings")


def get_composition_count() -> int:
    """Return number of stored composition snapshots (for diagnostics)."""
    return len(_load_compositions())


# ── NAV computation ───────────────────────────────────────────────────────────

def compute_portfolio_returns() -> dict:
    """
    Compute UCT20 portfolio returns from composition history + Massive price bars.

    Uses equal-weight portfolio: on each date, return = avg(return of each
    stock that was held on the PREVIOUS date). NAV chains these daily returns.

    Returns dict with keys 1d/1w/1m/3m/1y/ytd (float % or None).
    None means not enough history yet for that period.
    """
    null_returns = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}
    compositions = _load_compositions()

    if len(compositions) < 2:
        return null_returns  # Need at least 2 snapshots to compute a return

    # All unique symbols ever held
    all_syms: set[str] = set()
    for c in compositions:
        all_syms.update(c.get("holdings", []))

    if not all_syms:
        return null_returns

    # Fetch price bars for every symbol
    today = date.today()
    from_date = (today - timedelta(days=_MAX_HISTORY_DAYS)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    bars_by_sym: dict[str, dict[str, float]] = {}  # sym -> {date_str -> close}
    for sym in all_syms:
        try:
            bars = get_agg_bars(sym, from_date, to_date)
            if bars:
                bars_by_sym[sym] = {
                    datetime.fromtimestamp(b["t"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d"): b["c"]
                    for b in bars
                }
        except Exception:
            pass

    if not bars_by_sym:
        return null_returns

    # Build NAV series — one entry per composition snapshot date
    nav = 100.0
    nav_series: list[tuple[str, float]] = [(compositions[0]["date"], nav)]

    for i in range(1, len(compositions)):
        prev_comp = compositions[i - 1]
        curr_comp = compositions[i]
        prev_date = prev_comp["date"]
        curr_date = curr_comp["date"]
        prev_holdings = prev_comp.get("holdings", [])

        # Equal-weight return using PREVIOUS holdings from prev_date → curr_date
        returns: list[float] = []
        for sym in prev_holdings:
            sym_bars = bars_by_sym.get(sym, {})
            p0 = sym_bars.get(prev_date)
            p1 = sym_bars.get(curr_date)
            if p0 and p1 and p0 > 0:
                returns.append((p1 - p0) / p0)

        if returns:
            nav = nav * (1 + sum(returns) / len(returns))

        nav_series.append((curr_date, nav))

    if not nav_series:
        return null_returns

    current_nav = nav_series[-1][1]
    current_date_str = nav_series[-1][0]
    current_year = date.fromisoformat(current_date_str).year

    def pct_from(n_back: int) -> Optional[float]:
        """Return % change going back n_back trading-day entries."""
        if len(nav_series) <= n_back:
            return None
        past_nav = nav_series[-1 - n_back][1]
        if past_nav == 0:
            return None
        return round((current_nav / past_nav - 1) * 100, 2)

    def ytd_pct() -> Optional[float]:
        # Find the first entry in the current calendar year
        for entry_date, entry_nav in nav_series:
            if date.fromisoformat(entry_date).year == current_year:
                if entry_nav == 0:
                    return None
                return round((current_nav / entry_nav - 1) * 100, 2)
        return None

    return {
        "1d":  pct_from(1),
        "1w":  pct_from(5),
        "1m":  pct_from(21),
        "3m":  pct_from(63),
        "1y":  pct_from(252),
        "ytd": ytd_pct(),
    }
