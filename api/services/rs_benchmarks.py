"""Benchmark resolution for UCT Relative Strength (plan §8.2).

The chart's `benchmark` input is an enum the server resolves:

* ``SPY`` / ``QQQ`` / ``IWM`` / ``RSP`` — literal tickers (RSP is the equal-weight
  S&P 500; plan §1.5 and 03 §5 are why it sits on the Simple menu).
* ``SECTOR`` — the symbol's sector ETF, from the universe-wide ticker → sector
  map (`api/services/industry_map.py`, Finviz sector names) through
  :data:`SECTOR_ETF`. Unmapped ⇒ SPY with ``fallback`` set, and the legend says
  so (plan §6.10).
* ``INDUSTRY`` — an equal-weight composite of the symbol's industry group
  (`industry_map.tickers_in_industry`): 100 at its first bar, then CHAIN-LINKED
  bar to bar from the members present at both ends of each step, with a member
  that joins or returns indexed to the composite's own level on that bar (so a
  membership change is never a step in the line). Too few members ⇒ the sector
  ETF, then SPY.

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

#: The universe map's industry label for every ETF (its Finviz source's convention).
ETF_INDUSTRY = "Exchange Traded Fund"

#: An industry composite needs at least this many CONTRIBUTING members to mean anything.
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

    ⭐ CHAIN-LINKED, SO A MEMBERSHIP CHANGE IS NEVER A STEP. The composite is 100
    at its first emitted bar, where every present member is indexed to 100. From
    one emitted bar to the next it moves by the aggregate change of the members
    present at BOTH bars (``Σ indexed[t] / Σ indexed[prev]`` — equal weight at
    entry, buy-and-hold after, exactly the mean-of-indexed-values the composite
    always was while nobody joined or left). A member present at ``t`` but not at
    the previous emitted bar — a shorter history, or a bar it missed — contributes
    nothing to that step and is (re)indexed so its value at ``t`` EQUALS the
    composite: ``scale_m = composite[t] / c_m[t]``, i.e. ``c_m[t] / c_m[first_m] ×
    composite[first_m]`` from then on. A member missing at ``t`` contributes
    nothing to that step either. The earlier shape (each member 100 at its OWN
    first bar, mean over whoever is present) stepped 3–5 % on the bar an IPO
    joined a group and stepped-and-reversed on any one-bar gap, which fired
    red-day and RS-new-high events across the whole group (review finding B8).

    A time is emitted only when at least :data:`MIN_PRESENT_SHARE` of the
    members have a bar there; otherwise the composite has a gap, and the RS line
    joined to it will be ``None`` on that bar (never a guessed value). When no
    member spans two consecutive emitted bars (a whole-group turnover, which the
    presence rule makes near-impossible) the level is carried unchanged: there
    is no information about the change, and a flat bar is not an invented one.
    """
    closes_at: Dict[str, Dict[object, float]] = {}
    times: set = set()
    for m, bars in series_by_member.items():
        d: Dict[object, float] = {}
        for b in sorted(bars, key=lambda x: x.get("t")):
            c = b.get("c")
            if isinstance(c, (int, float)) and not isinstance(c, bool) and c > 0:
                d[b.get("t")] = float(c)
                times.add(b.get("t"))
        if d:
            closes_at[m] = d
    n = len(closes_at)
    if n == 0:
        return []
    scale: Dict[str, float] = {}          # member → multiplier onto the composite's scale
    prev_present: set = set()             # members with a bar at the last EMITTED time
    prev_t: object = None
    level: Optional[float] = None
    out: List[dict] = []
    for t in sorted(times):
        present = [m for m in closes_at if t in closes_at[m]]
        if len(present) / n < MIN_PRESENT_SHARE:
            continue
        linked = [m for m in present if m in prev_present]
        if level is None:
            level = 100.0
        elif linked:
            now = sum(closes_at[m][t] * scale[m] for m in linked)
            before = sum(closes_at[m][prev_t] * scale[m] for m in linked)
            level = level * now / before
        # else: nobody spans the step — the level carries (docstring).
        for m in present:
            if m not in prev_present:
                scale[m] = level / closes_at[m][t]
        out.append({"t": t, "c": level})
        prev_present = set(present)
        prev_t = t
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
        groups = _groups_for(sym_u) or {}
        sector = groups.get("sector")
        # ⭐ AN ETF HAS NO SECTOR OF ITS OWN. The universe map files every ETF under
        # sector "Financial" / industry "Exchange Traded Fund" (its source's
        # convention), so SPY's "sector ETF" would resolve to XLF — a comparison
        # that means nothing. For an ETF the market is the benchmark, and the
        # legend says why (plan §6.10; Phase 2 map §4.1.6).
        if (groups.get("industry") or "") == ETF_INDUSTRY:
            return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                    "fallback": "symbol is an ETF", "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}
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
        if (industry or "") == ETF_INDUSTRY:
            return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                    "fallback": "symbol is an ETF", "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}
        members = sorted({m.upper() for m in _members_of(industry)}) if industry else []
        # Fetch first, then count: a member without bars in the store contributes
        # nothing, so the floor is on CONTRIBUTING names and the label says how
        # many actually carried the composite (review finding). The fetch cap
        # keeps a 200-name group from costing 200 reads per chart open.
        series = {m: fetch_bars(m, tf, count) for m in members[:MAX_INDUSTRY_MEMBERS]}
        contributing = {m: s for m, s in series.items() if s}
        if len(contributing) >= MIN_INDUSTRY_MEMBERS:
            composite = equal_weight_composite(contributing)
            if composite:
                return {"requested": req, "resolved": f"INDUSTRY:{industry}",
                        "label": f"{industry} (equal-weight, {len(contributing)} names)",
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
