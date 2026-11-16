"""One symbol's values on each formation date, from its own daily bars as of that date.

POINT IN TIME, BY CONSTRUCTION. Every value for formation bar ``i`` is a function of
bars ``0 .. i`` only: plain windows that end at ``i`` (sums, maxima, the Steady count),
the RS line's EMA and the true-range average (both recursions that run forward, so the
value at ``i`` never depends on a later bar), and the listing start as of ``i`` (the
newest listing break at or before it). The only values that read past ``i`` are the
OUTCOMES: the forward return and the excursions, from the open of bar ``i + 1``.

A window's sessions are the benchmark's: a position formed on session ``k`` is entered
at the open of session ``k + 1`` and left at the close of session ``k + h``, and the
symbol must hold a bar on both. A symbol with a gap inside the window has no return
for it (counted, never guessed), so every return in one date's cross-section covers
the same days.

Definitions are the screener's own where it has one (``technicals``: the 21-session
average daily range, the 1-month change, the 200-day test, the 252-session high on
intraday highs; ``rs_columns`` / ``relative_strength``: the RS line, its 21 EMA, the
two below-high measures, Steady), so the gate tested is the gate a member would see.
"""
from __future__ import annotations

from array import array
from bisect import bisect_right
from collections import Counter
from typing import Dict, List, Optional, Sequence

from api.services import listing_break
from api.services import relative_strength as rs
from api.services.indicator_compute import compute_atr_raw
# By name: the package also exports a FUNCTION called `measure`, which shadows the module.
from api.services.rs_evidence.measure import _num as _is_number
from api.services.rs_evidence.measure import split_indexes as _split_indexes
from api.services.screener import rs_columns, technicals

from . import spec

NAN = float("nan")

def _none_if_nan(v):
    return None if v != v else v


class Calendar:
    """The benchmark's sessions: ``ts`` oldest first and ``index`` from date to position."""

    def __init__(self, bench_bars: Sequence[dict]):
        self.bars = technicals.usable_bars(list(bench_bars))
        self.ts: List[int] = [b["t"] for b in self.bars]
        self.index: Dict[int, int] = {t: k for k, t in enumerate(self.ts)}


class DateBook:
    """Everything one formation date holds across the universe. A value that could not
    be computed is NaN in the arrays (read back as ``None`` by :meth:`members`)."""

    __slots__ = ("tickers", "steady", "change", "adr", "forward", "candidates")

    def __init__(self):
        self.tickers: List[str] = []
        self.steady = array("d")
        self.change = array("d")
        self.adr = array("d")
        self.forward = {h: array("d") for h in spec.HORIZONS}
        #: ``{ticker: {...}}`` for the members that pass the gate's bar tests.
        self.candidates: Dict[str, dict] = {}

    def add(self, ticker, steady, change, adr, forward: dict) -> None:
        self.tickers.append(ticker)
        self.steady.append(NAN if steady is None else steady)
        self.change.append(NAN if change is None else change)
        self.adr.append(NAN if adr is None else adr)
        for h in spec.HORIZONS:
            v = forward.get(h)
            self.forward[h].append(NAN if v is None else v)

    def members(self):
        """``(ticker, steady, change, adr, {h: return})`` per liquid member."""
        for n, t in enumerate(self.tickers):
            yield (t, _none_if_nan(self.steady[n]), _none_if_nan(self.change[n]),
                   _none_if_nan(self.adr[n]),
                   {h: _none_if_nan(self.forward[h][n]) for h in spec.HORIZONS})


def listing_breaks(ts: Sequence[int], closes: Sequence[float]) -> List[int]:
    """The index of every bar that starts a new listing (``listing_break.is_break``),
    oldest first: the rule the rating job and the screener build cut a series by."""
    out = []
    for i in range(1, len(ts)):
        if ts[i] - ts[i - 1] >= listing_break.GAP_DAYS and listing_break.is_break(
                (listing_break._date(ts[i]) - listing_break._date(ts[i - 1])).days,
                closes[i - 1], closes[i]):
            out.append(i)
    return out


def split_marks(bars: Sequence[dict], declared) -> List[int]:
    """The bar index of each unadjusted split boundary the ONE detector
    (``bars_sanitize.unadjusted_splits``) finds from the declared list; ``[]`` when
    nothing is declared or the list is unknown (the caller counts the unknown ones)."""
    if not declared:
        return []
    from api.services.bars_sanitize import unadjusted_splits       # noqa: PLC0415 - only when asked
    series = [{"t": f"{b['t'] // 10000:04d}-{b['t'] // 100 % 100:02d}-{b['t'] % 100:02d}",
               "c": b.get("c")} for b in bars]
    times = [int(d.strftime("%Y%m%d")) for d, _ratio in unadjusted_splits(series, list(declared))]
    return _split_indexes(bars, times)


def _window_has_split(marks: Sequence[int], first: int, last: int) -> bool:
    """A boundary ``b`` with ``first < b <= last``: the entry open at ``first`` and the
    exit close at ``last`` are on different scales (``rs_evidence.measure``'s rule; a boundary AT
    the entry bar is already on the new scale)."""
    k = bisect_right(marks, first)
    return k < len(marks) and marks[k] <= last


def forward_return(opens, closes, ts, marks, cal: Calendar, i: int, k: int, h: int,
                   limit: int):
    """``(return in percent, None)`` from the open of bar ``i + 1`` to the close of bar
    ``i + h``, or ``(None, reason)``. ``k`` is the formation session's position in the
    benchmark calendar; ``limit`` the last date this window may read."""
    j = i + h
    if j >= len(closes) or k + h >= len(cal.ts) or ts[j] > limit or cal.ts[k + h] > limit:
        return None, "open"                  # the window is not over inside what may be read
    if ts[i + 1] != cal.ts[k + 1] or ts[j] != cal.ts[k + h]:
        return None, "gap"                   # the symbol missed a session of the window
    o, c = opens[i + 1], closes[j]
    if not (_is_number(o) and o > 0 and _is_number(c) and c > 0):
        return None, "price"
    if _window_has_split(marks, i + 1, j):
        return None, "split"
    return (c / o - 1.0) * 100.0, None


def benchmark_book(cal: Calendar, formation: Dict[int, int]) -> Dict[int, dict]:
    """``{date: {"forward": {h: return}, "above_average": bool | None}}`` for the
    benchmark itself: its own return over each window, and whether its close stood
    above its 200-day average on the formation date."""
    opens = [b["o"] for b in cal.bars]
    closes = [b["c"] for b in cal.bars]
    out = {}
    for f, limit in formation.items():
        k = cal.index.get(f)
        if k is None:
            continue
        fwd = {h: forward_return(opens, closes, cal.ts, (), cal, k, k, h, limit)[0]
               for h in spec.HORIZONS}
        n = spec.REGIME_AVERAGE_SESSIONS
        above = (closes[k] > sum(closes[k - n + 1:k + 1]) / n) if k + 1 >= n else None
        out[f] = {"forward": fwd, "above_average": above}
    return out


def add_symbol(ticker: str, raw_bars: Sequence[dict], cal: Calendar, formation: Dict[int, int],
               books: Dict[int, DateBook], counts: Counter, *, declared=None,
               development_end: Optional[int] = None) -> None:
    """Put one symbol into the book of every formation date it is liquid on.

    ``formation`` maps each formation date to the last date a window from it may read
    (the embargo: a development window never reads a holdout bar). ``declared`` is the
    symbol's declared split list (``None``: unknown). ``development_end`` is the last
    development session: the split detector judges development windows on the bars up
    to it alone, so a development result does not depend on whether the holdout was
    read."""
    bars = technicals.usable_bars(list(raw_bars))
    n = len(bars)
    if n < spec.MIN_LISTING_BARS:
        counts["symbols_short_history"] += 1
        return
    ts = [b["t"] for b in bars]
    at = {t: i for i, t in enumerate(ts)}
    closes = [b["c"] for b in bars]
    vols = [b.get("v") or 0 for b in bars]
    breaks = listing_breaks(ts, closes)

    # ── the floor, on each formation date the symbol has a bar for ──────────
    liquid = []
    for f in formation:
        i = at.get(f)
        if i is None or f not in cal.index:
            continue
        b = bisect_right(breaks, i)
        start = breaks[b - 1] if b else 0          # the listing bar i belongs to starts here
        if i - start + 1 < spec.MIN_LISTING_BARS:
            counts["dates_short_listing"] += 1
            continue
        c = closes[i]
        m = spec.DOLLAR_VOLUME_SESSIONS
        if not (c >= spec.UNIVERSE_MIN_PRICE
                and c * (sum(vols[i - m + 1:i + 1]) / m) >= spec.UNIVERSE_MIN_DOLLAR_VOLUME):
            continue
        liquid.append((i, f, start))
    if not liquid:
        return
    counts["symbols_liquid_on_a_date"] += 1

    opens = [b["o"] for b in bars]
    highs = [b["h"] for b in bars]
    lows = [b["l"] for b in bars]
    line = rs.rs_line(bars, cal.bars)
    # The two recursions, run forward inside each listing a formation date falls in.
    ema: List[Optional[float]] = [None] * n
    atr: List[Optional[float]] = [None] * n
    edges = [0, *breaks, n]
    for lo, hi in zip(edges, edges[1:]):
        if any(lo <= i < hi for i, _f, _s in liquid):
            ema[lo:hi] = rs.rs_moving_average(line[lo:hi], spec.RS_LINE_EMA_SESSIONS)
            atr[lo:hi] = compute_atr_raw(bars[lo:hi], spec.ATR_SESSIONS)
    if declared is None:
        counts["symbols_split_list_unknown"] += 1
    marks_all = split_marks(bars, declared)
    if development_end is None or ts[-1] <= development_end:
        marks_dev = marks_all
    else:
        marks_dev = split_marks(bars[:bisect_right(ts, development_end)], declared)

    year, rising = spec.HIGH_SESSIONS, spec.TREND_RISING_SESSIONS
    avg, adr_n = spec.TREND_AVERAGE_SESSIONS, spec.ADR_SESSIONS
    for i, f, start in liquid:
        k, limit = cal.index[f], formation[f]
        marks = marks_dev if (development_end is not None and f <= development_end) else marks_all
        c = closes[i]
        steady = rs.steady_last(closes[max(start, i - rs.STEADY_FAR):i + 1])
        steady = None if steady is None else round(steady, rs_columns.STEADY_DP)
        change = technicals._pct(c, closes[i - spec.GROUP_CHANGE_SESSIONS])
        window = [b for b in bars[i - adr_n + 1:i + 1] if b["c"]]
        adr = round(sum((b["h"] - b["l"]) / b["c"] for b in window) / len(window) * 100, 2) if window else None
        forward, entry = {}, opens[i + 1] if i + 1 < n else None
        for h in spec.HORIZONS:
            ret, why = forward_return(opens, closes, ts, marks, cal, i, k, h, limit)
            forward[h] = ret
            if why:
                counts[f"window_{why}_{h}"] += 1
        books[f].add(ticker, steady, change, adr, forward)

        # ── the gate's bar tests (the rating test is the cross-section's) ───
        if adr is None or adr < spec.GATE_MIN_ADR_PCT:
            continue
        s_now = sum(closes[i - avg + 1:i + 1]) / avg
        s_then = sum(closes[i - rising - avg + 1:i - rising + 1]) / avg
        vs_avg = technicals._pct(c, s_now)
        if vs_avg is None or not vs_avg > 0 or not s_now > s_then:
            continue
        below = technicals._pct(c, max(highs[i - year + 1:i + 1]))
        if below is None or below < spec.GATE_MAX_BELOW_HIGH_PCT:
            continue
        if line[i] is None or ema[i] is None or not line[i] >= ema[i]:
            continue
        px = rs.close_below_high_pct_last(closes[i - year + 1:i + 1], year)
        rl = rs.close_below_high_pct_last(line[i - year + 1:i + 1], year)
        s50 = sum(closes[i - spec.EXTENDED_AVERAGE_SESSIONS + 1:i + 1]) / spec.EXTENDED_AVERAGE_SESSIONS
        excursion = {}
        for h in spec.EXCURSION_HORIZONS:
            if forward.get(h) is None:
                continue
            hi_, lo_ = max(highs[i + 1:i + h + 1]), min(lows[i + 1:i + h + 1])
            excursion[h] = ((hi_ / entry - 1.0) * 100.0 / adr, (lo_ / entry - 1.0) * 100.0 / adr)
        books[f].candidates[ticker] = {
            "px_below_high_pct": None if px is None else round(px, rs_columns.PX_BELOW_HIGH_DP) + 0.0,
            "rs_line_below_high_pct": None if rl is None else round(rl, rs_columns.PX_BELOW_HIGH_DP) + 0.0,
            "extended": ((c - s50) / atr[i] >= spec.EXTENDED_ATR_MULTIPLE) if atr[i] else None,
            "excursion": excursion,
        }

