"""Benchmark resolution for UCT Relative Strength (plan §8.2).

The chart's `benchmark` input is an enum the server resolves:

* ``SPY`` / ``QQQ`` / ``IWM`` / ``RSP`` — literal tickers (RSP is the equal-weight
  S&P 500; plan §1.5 and 03 §5 are why it sits on the Simple menu).
* ``SECTOR`` — the symbol's sector ETF, from the universe-wide ticker → sector
  map (`api/services/industry_map.py`, Finviz sector names) through
  :data:`SECTOR_ETF`. Unmapped ⇒ SPY with ``fallback`` set, and the legend says
  so (plan §6.10).
* ``INDUSTRY`` — an equal-weight composite of the symbol's industry group
  (`industry_map.tickers_in_industry`), indexed to 100 at each member's first
  bar in the window and averaged over the members present at each time. Too
  few members ⇒ the sector ETF, then SPY.

⭐ PURE WHERE IT CAN BE. The bar fetcher is injected (the router passes
`_fetch_bars_for_tf`), and the industry-map reads are wrapped in two tiny
functions a test can monkeypatch, so every branch below is exercised without a
database.
"""

from __future__ import annotations

import logging
from typing import Callable, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

LITERAL_BENCHMARKS = ("SPY", "QQQ", "IWM", "RSP")
AUTO_BENCHMARKS = ("SECTOR", "INDUSTRY")
DEFAULT_BENCHMARK = "SPY"

#: Finviz sector name (what `industry_map` stores) → SPDR sector ETF.
SECTOR_ETF: Dict[str, str] = {
    "Technology": "XLK",
    "Financial": "XLF",
    "Energy": "XLE",
    "Healthcare": "XLV",
    "Industrials": "XLI",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Utilities": "XLU",
    "Basic Materials": "XLB",
    "Real Estate": "XLRE",
    "Communication Services": "XLC",
}

LABELS: Dict[str, str] = {
    "SPY": "S&P 500 (SPY)",
    "QQQ": "Nasdaq 100 (QQQ)",
    "IWM": "Russell 2000 (IWM)",
    "RSP": "Equal-weight S&P 500 (RSP)",
}

#: An industry composite needs at least this many members to mean anything.
MIN_INDUSTRY_MEMBERS = 3
#: And is capped so a 200-name group does not cost 200 bar reads per chart open.
MAX_INDUSTRY_MEMBERS = 60
#: A composite bar is emitted only when at least this share of members have a bar at that time.
MIN_PRESENT_SHARE = 0.5

FetchBars = Callable[[str, str, int], List[dict]]


def _groups_for(sym: str) -> dict:
    """``{"sector": str|None, "industry": str|None}`` — one seam for tests."""
    try:
        from api.services import industry_map
        return industry_map.get_groups([sym]).get(sym.upper(), {}) or {}
    except Exception:                                   # noqa: BLE001 — the map is best effort
        logger.exception("rs_benchmarks: industry map read failed for %s", sym)
        return {}


def _members_of(industry: str) -> List[str]:
    try:
        from api.services import industry_map
        return list(industry_map.tickers_in_industry(industry) or [])
    except Exception:                                   # noqa: BLE001
        logger.exception("rs_benchmarks: industry members read failed for %r", industry)
        return []


def equal_weight_composite(series_by_member: Dict[str, Sequence[dict]]) -> List[dict]:
    """Equal-weight index of several close series, as bars ``{"t", "c"}``.

    Each member is indexed to 100 at ITS first bar inside the window, so a member
    with a shorter history joins at 100 when it appears rather than dragging the
    average. A time is emitted only when at least :data:`MIN_PRESENT_SHARE` of the
    members have a bar there; otherwise the composite has a gap, and the RS line
    joined to it will be ``None`` on that bar (never a guessed value).
    """
    firsts: Dict[str, float] = {}
    closes_at: Dict[str, Dict[object, float]] = {}
    times: set = set()
    for m, bars in series_by_member.items():
        d: Dict[object, float] = {}
        for b in sorted(bars, key=lambda x: x.get("t")):
            c = b.get("c")
            if isinstance(c, (int, float)) and not isinstance(c, bool) and c > 0:
                if m not in firsts:
                    firsts[m] = float(c)
                d[b.get("t")] = float(c)
                times.add(b.get("t"))
        if d:
            closes_at[m] = d
    n = len(closes_at)
    if n == 0:
        return []
    out: List[dict] = []
    for t in sorted(times):
        vals = [closes_at[m][t] / firsts[m] * 100.0 for m in closes_at if t in closes_at[m]]
        if len(vals) / n < MIN_PRESENT_SHARE:
            continue
        out.append({"t": t, "c": sum(vals) / len(vals)})
    return out


def resolve_benchmark(sym: str, requested: Optional[str], tf: str, count: int,
                      fetch_bars: FetchBars) -> dict:
    """Resolve the enum to bars.

    Returns ``{"requested", "resolved", "label", "fallback", "bars"}``.
    ``resolved`` is a ticker for literal and sector benchmarks and the string
    ``"INDUSTRY:<name>"`` for a composite. ``fallback`` is ``None`` when the
    request resolved as asked, else a short reason the legend prints.
    """
    req = str(requested or DEFAULT_BENCHMARK).upper()
    sym_u = str(sym or "").upper()

    if req in LITERAL_BENCHMARKS:
        return {"requested": req, "resolved": req, "label": LABELS.get(req, req),
                "fallback": None, "bars": fetch_bars(req, tf, count)}

    if req == "SECTOR":
        sector = (_groups_for(sym_u) or {}).get("sector")
        etf = SECTOR_ETF.get(sector or "")
        if not etf:
            return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                    "fallback": "no sector" if not sector else f"sector not mapped: {sector}",
                    "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}
        return {"requested": req, "resolved": etf, "label": f"{sector} ({etf})",
                "fallback": None, "bars": fetch_bars(etf, tf, count)}

    if req == "INDUSTRY":
        groups = _groups_for(sym_u) or {}
        industry = groups.get("industry")
        members = sorted({m.upper() for m in _members_of(industry)}) if industry else []
        members = members[:MAX_INDUSTRY_MEMBERS]
        if len(members) >= MIN_INDUSTRY_MEMBERS:
            series = {m: fetch_bars(m, tf, count) for m in members}
            composite = equal_weight_composite({m: s for m, s in series.items() if s})
            if composite:
                return {"requested": req, "resolved": f"INDUSTRY:{industry}",
                        "label": f"{industry} (equal-weight, {len(series)} names)",
                        "fallback": None, "bars": composite}
        # Not enough of a group: fall to the sector, then the market, and say so.
        sector = groups.get("sector")
        etf = SECTOR_ETF.get(sector or "")
        if etf:
            return {"requested": req, "resolved": etf, "label": f"{sector} ({etf})",
                    "fallback": "industry group too small" if industry else "no industry",
                    "bars": fetch_bars(etf, tf, count)}
        return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                "fallback": "no industry or sector", "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}

    # Unknown value: the definition's enum vocabulary refuses it upstream
    # (`registry_defs.resolve_inputs`); this is the belt to that brace.
    return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
            "fallback": f"unknown benchmark {req}", "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}
