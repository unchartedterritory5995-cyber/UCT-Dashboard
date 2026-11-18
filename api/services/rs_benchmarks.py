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
* ``SECTOR_PICK`` (2026-11-12, owner: "benchmark to sector, theme etc") — a
  sector the member picks, passed as ``sector``: one of the eleven SPDR ETFs in
  :data:`SECTOR_PICKS`. Anything else ⇒ SPY with ``fallback`` set.
* ``THEME`` — the stock's own UCT theme (`theme_db`), as an equal-weight
  composite of the theme's member stocks, built exactly like ``INDUSTRY``'s
  (:func:`equal_weight_composite`, the same member cap, ordering and presence
  rule). In several themes, the one where its tier is strongest
  (:data:`TIER_RANK`: core, then relevant, then peripheral); a tie goes to the
  theme with the most members, then the name. No theme, or too few members
  with bars ⇒ the ``SECTOR`` resolution with ``fallback`` saying why.
* ``THEME_PICK`` — a theme the member picks, passed as ``theme``: the theme's
  stable ID (never its display name, so a rename keeps a saved chart).
  Blank, malformed or unknown ⇒ the ``SECTOR`` resolution with ``fallback``.

⭐ A COMPOSITE NEVER CONTAINS THE CHARTED STOCK (2026-11-12). An industry or
theme index that holds the stock itself measures the stock partly against
itself, more so in a thin group; the member is dropped before the fetch, for
INDUSTRY, THEME and THEME_PICK alike.

The three new names live in :data:`CHOICE_BENCHMARKS` with CUSTOM, OUT of
:data:`LITERAL_BENCHMARKS` + :data:`AUTO_BENCHMARKS`, for the reason CUSTOM is:
every set derived from those two tuples (the v3 menu, the prewarm set, the
screener's ETF set, Compass's RS tool) stays exactly as it was. Only the v4 menu
(`registry_defs.RS_LINE_BENCHMARKS_V4`) names them, and the alert lane adds
``THEME`` by name (`alert_rs_series.RS_ALERT_BENCHMARKS`).

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

#: ⭐ THE PICKABLE SECTORS (2026-11-12), in the menu's order, with the plain
#: name a member reads. The same eleven ETFs as :data:`SECTOR_ETF` (a rail
#: holds the two sets equal), so every pick is already in the prewarm set.
SECTOR_PICKS: Dict[str, str] = {
    "XLK": "Technology",
    "XLV": "Health Care",
    "XLF": "Financials",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLE": "Energy",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLU": "Utilities",
    "XLRE": "Real Estate",
    "XLC": "Communication Services",
}
DEFAULT_SECTOR_PICK = "XLK"

SECTOR_PICK_BENCHMARK = "SECTOR_PICK"
THEME_BENCHMARK = "THEME"
THEME_PICK_BENCHMARK = "THEME_PICK"
#: The v4 menu's benchmarks beyond the v3 vocabulary, each carrying a second
#: value (or, for THEME, a theme lookup): resolved here, listed only by the v4
#: menu. See the module docstring for why they are not AUTO / LITERAL names.
CHOICE_BENCHMARKS = (SECTOR_PICK_BENCHMARK, THEME_BENCHMARK, THEME_PICK_BENCHMARK, CUSTOM_BENCHMARK)

#: A theme's stable ID (`themes.id`, e.g. ``semiconductor_equipment``): what a
#: saved chart stores for "Pick a theme". The server row and the JS input carry
#: this source as their `pattern`.
THEME_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$")
#: A membership tier's strength: lower is stronger. An unknown tier ranks last.
TIER_RANK: Dict[str, int] = {"core": 0, "relevant": 1, "peripheral": 2}

#: The fallback reasons the new benchmarks print (the provider turns each into
#: a sentence, `rs_provider._RS_FALLBACK_SENTENCE`).
NO_SECTOR_PICK = "no sector picked"
NO_THEME = "no theme"
NO_THEME_PICK = "no theme picked"
THEME_NOT_FOUND = "theme not found"
THEME_TOO_SMALL = "theme too small"

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


def _bar_symbol(sym: str) -> str:
    """A ticker in the bar store's spelling: upper case, class shares hyphenated
    (the theme taxonomy writes ``BRK.B``; bars.db and the cap universe hold
    ``BRK-B``)."""
    return str(sym or "").strip().upper().replace(".", "-")


def _themes_for(sym: str) -> List[dict]:
    """``[{"id", "name", "tier", "members"}]``: every UCT theme ``sym`` belongs
    to (owner and engine memberships merged, `theme_db`), with each theme's
    member count. One seam for tests; best effort like the map."""
    try:
        from api.services import theme_db
        rows = theme_db.get_themes_for_ticker(sym) or []
        out = []
        for r in rows:
            tid = r.get("theme_id")
            if not tid:
                continue
            out.append({"id": tid, "name": r.get("theme_name") or tid,
                        "tier": str(r.get("tier") or "relevant").lower(),
                        "members": len(theme_db.get_theme_holdings(tid) or [])})
        return out
    except Exception:                                   # noqa: BLE001 — the taxonomy is best effort
        logger.exception("rs_benchmarks: theme read failed for %s", sym)
        return []


def _theme_info(theme_id: str) -> Optional[dict]:
    """``{"id", "name"}`` for a theme ID, ``None`` when no such theme exists."""
    try:
        from api.services import theme_db
        row = theme_db.get_theme(theme_id)
        return {"id": row["id"], "name": row.get("name") or row["id"]} if row else None
    except Exception:                                   # noqa: BLE001
        logger.exception("rs_benchmarks: theme lookup failed for %r", theme_id)
        return None


def _theme_members(theme_id: str) -> List[str]:
    """Every member ticker of a theme, every tier, in the bar store's spelling."""
    try:
        from api.services import theme_db
        return [_bar_symbol(h.get("sym")) for h in (theme_db.get_theme_holdings(theme_id) or [])
                if h.get("sym")]
    except Exception:                                   # noqa: BLE001
        logger.exception("rs_benchmarks: theme members read failed for %r", theme_id)
        return []


def theme_choices() -> List[dict]:
    """``[{"id", "name"}]`` for the "Pick a theme" list, in the taxonomy's
    display order (`theme_db.get_theme_names`: names only, no membership merge,
    so the list costs one small read). ``[]`` when the tables cannot be read."""
    try:
        from api.services import theme_db
        return [{"id": t["id"], "name": t["name"]} for t in (theme_db.get_theme_names() or [])
                if t.get("id") and THEME_ID_RE.fullmatch(str(t["id"]))]
    except Exception:                                   # noqa: BLE001
        logger.exception("rs_benchmarks: theme list read failed")
        return []


def pick_strongest_theme(themes: Sequence[dict]) -> Optional[dict]:
    """The theme a stock's ``THEME`` benchmark uses: the strongest tier
    (:data:`TIER_RANK`, an unknown tier last), then the most members, then the
    name (case-blind), then the ID, so the answer never depends on row order."""
    if not themes:
        return None
    return min(themes, key=lambda t: (TIER_RANK.get(str(t.get("tier") or "").lower(), len(TIER_RANK)),
                                      -int(t.get("members") or 0),
                                      str(t.get("name") or "").lower(), str(t.get("id") or "")))


def normalize_sector_pick(value: Optional[str]) -> Optional[str]:
    """The ETF when ``value`` is one of :data:`SECTOR_PICKS`, else ``None``."""
    s = str(value or "").strip().upper()
    return s if s in SECTOR_PICKS else None


def normalize_theme_id(value: Optional[str]) -> Optional[str]:
    """The theme ID when ``value`` reads as one (:data:`THEME_ID_RE`), else
    ``None``. Whether the theme EXISTS is the resolver's question."""
    s = str(value or "").strip()
    return s if s and s.isascii() and THEME_ID_RE.fullmatch(s) else None


def benchmark_picks(requested: Optional[str], inputs: Optional[dict]) -> Dict[str, str]:
    """``{"customBenchmark", "sectorBenchmark", "themeBenchmark"}`` as the compute
    reads them: each normalised and BLANK unless the benchmark is the one that
    reads it, so a value left in a hidden box is not a second cache entry for
    the same answer. ``customBenchmark`` keeps the rule
    `rs_provider._rs_phase3_params` has always applied to it."""
    req = str(requested or "").upper()
    inp = inputs or {}
    return {
        "customBenchmark": (normalize_custom_symbol(inp.get("customBenchmark")) or ""
                            if req == CUSTOM_BENCHMARK else ""),
        "sectorBenchmark": (normalize_sector_pick(inp.get("sectorBenchmark")) or ""
                            if req == SECTOR_PICK_BENCHMARK else ""),
        "themeBenchmark": (normalize_theme_id(inp.get("themeBenchmark")) or ""
                           if req == THEME_PICK_BENCHMARK else ""),
    }


def benchmark_name(bench: dict) -> Optional[str]:
    """The benchmark's plain name for a pane label: the ticker (``XLK``), the
    industry (``Semiconductors``) or the theme (``AI / GPU Chips``), never the
    synthetic ``INDUSTRY:`` / ``THEME:`` key."""
    if not isinstance(bench, dict):
        return None
    if bench.get("name"):
        return str(bench["name"])
    resolved = str(bench.get("resolved") or "")
    if resolved.startswith("INDUSTRY:"):
        return resolved[len("INDUSTRY:"):] or None
    return resolved or None


# ⭐ THE COMPOSITE MEMO (2026-11-12). An industry or theme composite costs one
# bar read per member (up to :data:`MAX_INDUSTRY_MEMBERS`) and a chain-link pass;
# a chart with three RS indicators, its regime read and the alert lane's cycle
# would each pay that again. Results are kept per process for
# :data:`COMPOSITE_MEMO_TTL_S` (D / W / M; :data:`COMPOSITE_MEMO_TTL_INTRADAY_S`
# intraday, where the forming bar moves), keyed on the CALLER'S READER as well as
# the group, so two readers (the chart's store read, the alert lane's, a test's
# fixture) never share an answer. A caller that passes no ``memo`` reader gets
# no memo at all. Bounded, expired entries swept on every write.
COMPOSITE_MEMO_TTL_S = 300.0
COMPOSITE_MEMO_TTL_INTRADAY_S = 60.0
_COMPOSITE_MEMO_MAX = 96
_composite_memo: Dict[tuple, tuple] = {}
_composite_memo_lock = threading.Lock()


def composite_memo_reset() -> None:
    """Forget every memoised composite (tests; a bars repair that must be seen now)."""
    with _composite_memo_lock:
        _composite_memo.clear()


def _memo_ttl(tf: str) -> float:
    return COMPOSITE_MEMO_TTL_S if str(tf).upper() in ("D", "1D", "W", "1W", "M", "1M") \
        else COMPOSITE_MEMO_TTL_INTRADAY_S


def _composite(members: Sequence[str], exclude: str, tf: str, count: int, fetch_bars: "FetchBars",
               has_bars: Optional["HasBars"], memo: object, group: tuple):
    """``(composite_bars, contributing_count)`` for a group, the charted stock
    (``exclude``) left out. ``composite_bars`` is ``None`` when fewer than
    :data:`MIN_INDUSTRY_MEMBERS` members had bars or the presence rule left no
    bar. Memoised under ``memo`` (see above)."""
    ex = _bar_symbol(exclude)
    names = [m for m in (members or []) if m and _bar_symbol(m) != ex]
    key = None
    if memo is not None:
        key = (memo, group, str(tf), int(count), ex if len(names) != len(members or []) else "")
        now = _now()
        with _composite_memo_lock:
            hit = _composite_memo.get(key)
            if hit is not None and 0 <= now - hit[0] < _memo_ttl(tf):
                return hit[1]
    ordered = order_industry_members(names, tf, fetch_bars, has_bars)
    # Fetch first, then count: a member without bars in the store contributes
    # nothing, so the floor is on CONTRIBUTING names (review finding).
    series = {m: fetch_bars(m, tf, count) for m in ordered[:MAX_INDUSTRY_MEMBERS]}
    contributing = {m: s for m, s in series.items() if s}
    out = (None, len(contributing))
    if len(contributing) >= MIN_INDUSTRY_MEMBERS:
        bars = equal_weight_composite(contributing)
        if bars:
            out = (bars, len(contributing))
    if key is not None:
        now = _now()
        with _composite_memo_lock:
            for k in [k for k, (at, _v) in _composite_memo.items() if not (0 <= now - at < _memo_ttl(k[2]))]:
                _composite_memo.pop(k, None)
            while len(_composite_memo) >= _COMPOSITE_MEMO_MAX:
                _composite_memo.pop(next(iter(_composite_memo)))
            _composite_memo[key] = (now, out)
    return out


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


def _resolve_sector(req: str, sym_u: str, tf: str, count: int, fetch_bars: FetchBars) -> dict:
    """The SECTOR branch (also every theme benchmark's fallback): the symbol's
    sector ETF, SPY for an ETF or an unmapped sector."""
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


def _theme_fallback(req: str, reason: str, sym_u: str, tf: str, count: int, fetch_bars: FetchBars) -> dict:
    """A theme benchmark that cannot be built falls to the stock's sector (and
    from there to SPY, as SECTOR does), with the THEME reason first: the member
    asked for a theme, and the note must say why they are not seeing one."""
    out = _resolve_sector(req, sym_u, tf, count, fetch_bars)
    out["fallback"] = reason if not out.get("fallback") else f"{reason}; {out['fallback']}"
    return out


def _resolve_theme(req: str, theme: Optional[dict], sym_u: str, tf: str, count: int,
                   fetch_bars: FetchBars, has_bars: Optional[HasBars], memo: object) -> dict:
    """An equal-weight composite of ``theme``'s members, the stock left out;
    too few members with bars ⇒ the sector, with :data:`THEME_TOO_SMALL`."""
    composite, n = _composite(_theme_members(theme["id"]), sym_u, tf, count, fetch_bars, has_bars,
                              memo, ("THEME", theme["id"]))
    if composite:
        return {"requested": req, "resolved": f"THEME:{theme['id']}",
                "label": f"{theme['name']} (equal-weight, {n} names)",
                "fallback": None, "bars": composite, "name": theme["name"]}
    return _theme_fallback(req, THEME_TOO_SMALL, sym_u, tf, count, fetch_bars)


def resolve_benchmark(sym: str, requested: Optional[str], tf: str, count: int,
                      fetch_bars: FetchBars, has_bars: Optional[HasBars] = None, *,
                      custom: Optional[str] = None, warm: Optional[Warm] = None,
                      sector: Optional[str] = None, theme: Optional[str] = None,
                      memo: object = None) -> dict:
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

    2026-11-12: ``SECTOR_PICK`` reads ``sector`` (an ETF of
    :data:`SECTOR_PICKS`), ``THEME_PICK`` reads ``theme`` (a theme ID); both
    are ignored for every other benchmark. A ``THEME`` / ``THEME_PICK`` result
    also carries ``name``, the theme's display name (:func:`benchmark_name`).
    ``memo`` is the caller's bar reader, under which industry and theme
    composites are memoised (:func:`_composite`); ``None`` memoises nothing.
    """
    req = str(requested or DEFAULT_BENCHMARK).upper()
    sym_u = str(sym or "").upper()

    if req == CUSTOM_BENCHMARK:
        return _resolve_custom(sym_u, custom, tf, count, fetch_bars, warm)

    if req == SECTOR_PICK_BENCHMARK:
        etf = normalize_sector_pick(sector)
        if etf is None:
            return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                    "fallback": NO_SECTOR_PICK, "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}
        return {"requested": req, "resolved": etf, "label": f"{SECTOR_PICKS[etf]} ({etf})",
                "fallback": None, "bars": fetch_bars(etf, tf, count)}

    if req == THEME_BENCHMARK:
        best = pick_strongest_theme(_themes_for(sym_u))
        if best is None:
            return _theme_fallback(req, NO_THEME, sym_u, tf, count, fetch_bars)
        return _resolve_theme(req, best, sym_u, tf, count, fetch_bars, has_bars, memo)

    if req == THEME_PICK_BENCHMARK:
        tid = normalize_theme_id(theme)
        if tid is None:
            return _theme_fallback(req, NO_THEME_PICK, sym_u, tf, count, fetch_bars)
        info = _theme_info(tid)
        if info is None:
            return _theme_fallback(req, THEME_NOT_FOUND, sym_u, tf, count, fetch_bars)
        return _resolve_theme(req, info, sym_u, tf, count, fetch_bars, has_bars, memo)

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
        return _resolve_sector(req, sym_u, tf, count, fetch_bars)

    # req == "INDUSTRY" — the last value in the vocabulary checked above.
    groups = _groups_for(sym_u) or {}
    industry = groups.get("industry")
    if (industry or "") == ETF_INDUSTRY:
        return {"requested": req, "resolved": DEFAULT_BENCHMARK, "label": LABELS[DEFAULT_BENCHMARK],
                "fallback": "symbol is an ETF", "bars": fetch_bars(DEFAULT_BENCHMARK, tf, count)}
    # The fetch cap keeps a 200-name group from costing 200 full reads per chart
    # open, and `order_industry_members` puts the names that HAVE bars (and are
    # in the cap universe) ahead of the slice so the cap never excludes them.
    # The label says how many actually carried the composite (review finding).
    # 2026-11-12: the charted stock is left out (`_composite`), as for a theme.
    if industry:
        composite, n = _composite(_members_of(industry), sym_u, tf, count, fetch_bars, has_bars,
                                  memo, ("INDUSTRY", industry))
        if composite:
            return {"requested": req, "resolved": f"INDUSTRY:{industry}",
                    "label": f"{industry} (equal-weight, {n} names)",
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
