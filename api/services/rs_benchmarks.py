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
* ``CUSTOM`` — a member's own ticker (Phase 3 unit 3-04, decision D4), passed as
  ``custom``: any symbol :data:`CUSTOM_SYMBOL_RE` accepts, ETFs included, never
  an index (``$SPX``). Empty or invalid ⇒ SPY with ``fallback`` set; a valid
  ticker is NEVER swapped for SPY. Not in :data:`AUTO_BENCHMARKS`, so neither
  the chart's menu nor the alert lane grows it by accident.

⭐ PURE WHERE IT CAN BE. The bar fetcher is injected (the router passes
`_fetch_bars_for_tf`; an optional `has_bars` presence probe rides the same
pattern), and the industry-map and cap-universe reads are wrapped in three tiny
functions a test can monkeypatch, so every branch below is exercised without a
database.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Callable, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

LITERAL_BENCHMARKS = ("SPY", "QQQ", "IWM", "RSP")
AUTO_BENCHMARKS = ("SECTOR", "INDUSTRY")
DEFAULT_BENCHMARK = "SPY"

# ⭐ CUSTOM IS RESOLVED HERE BUT LISTED NOWHERE (engineering map 3-04, D4). It
# is deliberately OUT of LITERAL_BENCHMARKS + AUTO_BENCHMARKS: the chart's menu
# (`registry_defs.RS_LINE_BENCHMARKS`), the alert lane's list
# (`alert_rs_series.RS_ALERT_BENCHMARKS`), the prewarm set
# (`bars_prewarm.RS_BENCHMARK_TICKERS`) and the screener's ETF set
# (`rs_history.default_etf_tickers`) are all DERIVED from those two tuples, and
# an alert on an arbitrary symbol would bypass the benchmark cache the alert
# lane depends on. The chart offers CUSTOM by naming it explicitly (unit 3-05).
CUSTOM_BENCHMARK = "CUSTOM"

#: The one statement of what a custom benchmark may be (D4): a listed ticker,
#: ETFs included; no index symbols (``$SPX``, ``^GSPC``). Matched AFTER strip and
#: upper-case on an ASCII string, which accepts exactly what the router's
#: `_SYM_RE` (``^[A-Za-z][A-Za-z.\-]{0,9}$`` on the stripped value) accepts.
CUSTOM_SYMBOL_RE = re.compile(r"^[A-Z][A-Z.\-]{0,9}$")

#: The fallback reason when CUSTOM carries no usable ticker.
CUSTOM_NO_SYMBOL = "no custom symbol"
#: A ticker is warmed at most once per this many seconds per process.
CUSTOM_WARM_TTL_S = 600.0

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


def _cap_universe() -> set:
    """The chartable universe (`groups.cap_universe_set`, hyphen + uppercase),
    empty when it cannot be read — one seam for tests, best effort like the map."""
    try:
        from api.services.groups import cap_universe_set
        return set(cap_universe_set() or ())
    except Exception:                                   # noqa: BLE001
        logger.exception("rs_benchmarks: cap universe read failed")
        return set()


HasBars = Callable[[str, str], bool]


def order_industry_members(members: Sequence[str], tf: str, fetch_bars: FetchBars,
                           has_bars: Optional[HasBars] = None) -> List[str]:
    """The group in the order the composite should take members from: names
    WITH bars in the store first, then names in the cap universe, then the
    alphabet as the tie-break.

    ⭐ ONLY WHEN THE CAP BITES. A group within :data:`MAX_INDUSTRY_MEMBERS` is
    fetched whole whatever the order, so it is returned sorted and unprobed —
    the probe is one small read per name, and most groups never pay it. A
    larger group used to be sliced alphabetically (review finding B7):
    "Biotechnology"'s composite was the alphabet-first micro-caps that happened
    to have bars, and its largest names were excluded by construction.

    ``has_bars`` is the injected presence probe (same pattern as ``fetch_bars``);
    without one, ``fetch_bars(sym, tf, 1)`` is the probe.
    """
    names = sorted({str(m).upper() for m in members if m})
    if len(names) <= MAX_INDUSTRY_MEMBERS:
        return names
    probe = has_bars or (lambda sym, tf_: bool(fetch_bars(sym, tf_, 1)))
    cap = _cap_universe()

    def key(sym: str):
        try:
            present = bool(probe(sym, tf))
        except Exception:                               # noqa: BLE001 — a failed probe is "unknown", not fatal
            present = False
        return (not present, sym.replace(".", "-") not in cap, sym)

    return sorted(names, key=key)


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


Warm = Callable[[str], None]

#: ticker → monotonic time of its last warm request (per process).
_custom_warmed: Dict[str, float] = {}
_custom_warm_lock = threading.Lock()
#: Past this many remembered tickers, expired entries are dropped on insert.
_CUSTOM_WARM_MEMO_PRUNE_AT = 512
#: The clock, one seam for tests.
_now: Callable[[], float] = time.monotonic


def normalize_custom_symbol(value: Optional[str]) -> Optional[str]:
    """The upper-cased ticker when ``value`` is an acceptable custom benchmark,
    else ``None``. Strip, refuse any non-ASCII text (``"ı".upper()`` is ``"I"``,
    which the router's ASCII class would never have accepted), upper-case, then
    :data:`CUSTOM_SYMBOL_RE`. ``fullmatch`` so a trailing newline cannot slip
    past ``$``."""
    s = str(value or "").strip()
    if not s or not s.isascii():
        return None
    s = s.upper()
    return s if CUSTOM_SYMBOL_RE.fullmatch(s) else None


def custom_no_bars_note(ticker: str) -> str:
    """The Benchmark row's second line for a custom ticker the pod holds no
    bars for yet (D4). Stated here so the provider does not re-type it."""
    return f"No {ticker} bars yet; they usually load within a minute"


def _warm_custom_once(ticker: str, warm: Optional[Warm]) -> bool:
    """Call ``warm(ticker)`` unless this process asked for the same ticker in
    the last :data:`CUSTOM_WARM_TTL_S` seconds. Thread-safe: the memo is
    claimed under the lock BEFORE the call, so two requests racing on a cold
    ticker warm it once. ``warm`` must be fire-and-forget (it runs on the
    request thread); an exception from it is logged and swallowed. Returns
    whether ``warm`` was called."""
    if warm is None:
        return False
    now = _now()
    with _custom_warm_lock:
        last = _custom_warmed.get(ticker)
        if last is not None and now - last < CUSTOM_WARM_TTL_S:
            return False
        _custom_warmed[ticker] = now
        if len(_custom_warmed) > _CUSTOM_WARM_MEMO_PRUNE_AT:
            for k in [k for k, t in _custom_warmed.items() if now - t >= CUSTOM_WARM_TTL_S]:
                del _custom_warmed[k]
    try:
        warm(ticker)
    except Exception:                                   # noqa: BLE001 — a warm is best effort
        logger.exception("rs_benchmarks: custom benchmark warm failed for %s", ticker)
    return True


def _resolve_custom(sym_u: str, custom: Optional[str], tf: str, count: int,
                    fetch_bars: FetchBars, warm: Optional[Warm]) -> dict:
    """The CUSTOM branch of :func:`resolve_benchmark` (unit 3-04, D4)."""
    req = CUSTOM_BENCHMARK
    ticker = normalize_custom_symbol(custom)
    if ticker is None:
        return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                "fallback": CUSTOM_NO_SYMBOL, "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count),
                "note": None}
    bars = fetch_bars(ticker, tf, count)
    note = None
    # The chart's own symbol resolves as itself so the provider's same-symbol
    # state applies; its bars are the chart's, so there is nothing to warm.
    if not bars and ticker != sym_u:
        # ⛔ NEVER A SILENT SWAP TO SPY FOR A VALID TICKER. Empty bars make the
        # provider report `no-benchmark-bars`; the warm fills bars.db behind it.
        _warm_custom_once(ticker, warm)
        note = custom_no_bars_note(ticker)
    return {"requested": req, "resolved": ticker, "label": ticker,
            "fallback": None, "bars": list(bars or []), "note": note}


def resolve_benchmark(sym: str, requested: Optional[str], tf: str, count: int,
                      fetch_bars: FetchBars, has_bars: Optional[HasBars] = None, *,
                      custom: Optional[str] = None, warm: Optional[Warm] = None) -> dict:
    """Resolve the enum to bars.

    Returns ``{"requested", "resolved", "label", "fallback", "bars"}``.
    ``resolved`` is a ticker for literal and sector benchmarks and the string
    ``"INDUSTRY:<name>"`` for a composite. ``fallback`` is ``None`` when the
    request resolved as asked, else a short reason the legend prints.
    ``has_bars`` is the optional presence probe `order_industry_members` uses
    on a group larger than the fetch cap.

    ``CUSTOM`` (D4) resolves ``custom``, the member's ticker: valid ⇒
    ``resolved`` and ``label`` are the ticker; empty or invalid ⇒ SPY with
    ``fallback: "no custom symbol"``; the chart's own symbol ⇒ itself (the
    provider's same-symbol state); no bars ⇒ the ticker with ``bars: []``,
    ``note`` set to :func:`custom_no_bars_note`, and ``warm(ticker)`` called at
    most once per ticker per :data:`CUSTOM_WARM_TTL_S` in this process. A CUSTOM
    result also carries ``note`` (``None`` unless bars are missing). ``custom``
    and ``warm`` are ignored for every other benchmark.
    """
    req = str(requested or DEFAULT_BENCHMARK).upper()
    sym_u = str(sym or "").upper()

    if req == CUSTOM_BENCHMARK:
        return _resolve_custom(sym_u, custom, tf, count, fetch_bars, warm)

    # ⛔ AN UNKNOWN VALUE IS AN ERROR, NOT SPY. The definition's enum vocabulary
    # (`registry_defs.RS_LINE_BENCHMARKS`, derived from the two tuples above)
    # refuses it upstream in `resolve_inputs`, so this is unreachable from the
    # route; a direct caller that reaches it gets a ValueError rather than an RS
    # line against SPY under a chip that names something else (review B10).
    if req not in LITERAL_BENCHMARKS and req not in AUTO_BENCHMARKS:
        raise ValueError(
            f"unknown benchmark {req!r}; the vocabulary is "
            f"{LITERAL_BENCHMARKS + AUTO_BENCHMARKS}")

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

    # req == "INDUSTRY" — the last value in the vocabulary checked above.
    groups = _groups_for(sym_u) or {}
    industry = groups.get("industry")
    if (industry or "") == ETF_INDUSTRY:
        return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                "fallback": "symbol is an ETF", "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}
    members = (order_industry_members(_members_of(industry), tf, fetch_bars, has_bars)
               if industry else [])
    # Fetch first, then count: a member without bars in the store contributes
    # nothing, so the floor is on CONTRIBUTING names and the label says how
    # many actually carried the composite (review finding). The fetch cap
    # keeps a 200-name group from costing 200 full reads per chart open, and
    # `order_industry_members` puts the names that HAVE bars (and are in the
    # cap universe) ahead of the slice so the cap never excludes them.
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
