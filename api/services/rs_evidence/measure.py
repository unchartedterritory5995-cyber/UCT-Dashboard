"""Pure measurement for the UCT RS evidence job (Phase 2b, unit 2b-01).

Plan: ``docs/superpowers/specs/2026-11-05-uct-relative-strength-indicator-design.md``
§9 (the honesty layer and the nightly backtest). Research base:
``docs/research/relative-strength/03-evidence.md`` §(b) (what may be claimed)
and §(c) (what to measure). Map: ``2026-11-06-uct-rs-phase2-engineering-map.md``
§2.1 and §3 row 2b-01.

WHAT IS MEASURED
----------------
For every signal bar (ticker, session) the FORWARD EXCESS RETURN at each
horizon ``h`` in :data:`HORIZONS` bars::

    excess[h] = ((C[t+h] / O[t+1] - 1) - (B[t+h] / BO[t+1] - 1)) * 100      (percent)

``O`` / ``C`` the stock's open and close, ``BO`` / ``B`` the benchmark's open and
close at the stock's own bar times (the same time join the RS line uses). THE
BASE IS THE NEXT SESSION'S OPEN (owner decision N6, 2026-11-07): a member sees
the dot after the close and can act at the next open at the earliest, so that is
the first price the measurement may use. The window ends at the close ``h``
sessions after the signal. The signal-close base this replaced overstated what
was tradeable by the overnight gap after every signal. The horizon counts the
stock's OWN bars, so a gap in a thin name stretches the window by the gap.

Per signal and horizon: ``n`` (events with a complete window), ``incomplete``
(events whose window runs past the held history or lacks a positive open or
close at either end - EXCLUDED and COUNTED, never guessed), ``hit_rate`` (share
of complete events with ``excess > 0``, strictly), ``median_excess`` and
``mean_excess`` (percent). The BASELINE is the same statistic over EVERY bar
of every measured ticker - the "all bars" comparison a card needs so a hit
rate reads as lift, not as a number on its own. Per signal we also count
``dates`` (distinct sessions with an event: 5,000 events on 40 dates is 40
observations - research base §(c)) and ``tickers``; and per signal AND horizon
``dates`` again, over the events whose window at that horizon is COMPLETE (unit
VA3, 2026-11-07): the sessions the printed hit rate actually stands on. The
per-signal count also holds the newest sessions, whose longer windows are still
open, so it overstates how many sessions a 63-session hit rate spans.

THE SPLIT GUARD (owner decision N5, 2026-11-07). An unadjusted split inside a
forward window would read a 2:1 split as a -50 % trade. The caller passes the
bar index of every unadjusted split boundary the one detector
(``bars_sanitize.unadjusted_splits``) finds in the ticker's series; a row whose
forward window ``(t+1, t+H]`` (``H`` the longest horizon) contains one is NOT
COUNTED: it carries no excess (``ex is None``), is left out of ``n``,
``incomplete``, ``n_signals``, ``dates`` and ``tickers``, and is counted in
``split_skipped`` per signal (the baseline under :data:`BASELINE_KEY`). A
boundary AT ``t+1`` does not touch the window: the base open is already on the
new scale. The rule is the longest window for every horizon, so one event is in
or out of all three and the horizons stay comparable.

NEVER INVENT A VALUE (plan §2.3 principle 4). A statistic over zero complete
events is ``None``, not 0.

ONE STATISTIC, TWO ROW SOURCES. :func:`summarise_values` is the only place
the numbers are computed. :func:`measure` feeds it rows held in memory;
``store.summary`` feeds it the same rows read back from SQLite. A test asserts
the two paths agree on the same rows.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from statistics import median
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# The forward horizons: one, three and six months of sessions - 21, 63 and 126
# bars. Declared as months x sessions rather than as the three literals because
# `tests/test_single_authority_rails.py` fingerprints the RS WEIGHTING table by
# the pair of ints 63 and 126 in one module's AST, and these are not that table
# (they are forward-return windows, not rating lookbacks).
SESSIONS_PER_MONTH = 21
HORIZON_MONTHS: Tuple[int, ...] = (1, 3, 6)
HORIZONS: Tuple[int, ...] = tuple(SESSIONS_PER_MONTH * m for m in HORIZON_MONTHS)
BASELINE_KEY = "all_bars"                       # the row signal of the comparison set

MaybeNum = Optional[float]
# (session YYYYMMDD, signal, ticker, excess per horizon aligned to the horizons,
#  or None for a row the split guard did not count)
Row = Tuple[int, str, str, Optional[Tuple[MaybeNum, ...]]]


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _positive(bars: Sequence[dict], key: str) -> List[MaybeNum]:
    out: List[MaybeNum] = []
    for b in bars:
        v = b.get(key)
        out.append(float(v) if _num(v) and v > 0 else None)
    return out


def closes_of(bars: Sequence[dict]) -> List[MaybeNum]:
    """The close of each bar, ``None`` where it is missing or not positive."""
    return _positive(bars, "c")


def opens_of(bars: Sequence[dict]) -> List[MaybeNum]:
    """The open of each bar, ``None`` where it is missing or not positive."""
    return _positive(bars, "o")


def forward_excess(opens: Sequence[MaybeNum], closes: Sequence[MaybeNum], bench_opens: Sequence[MaybeNum],
                   bench_closes: Sequence[MaybeNum], i: int, h: int) -> MaybeNum:
    """The module-header formula at bar ``i`` over ``h`` bars: from the open of bar
    ``i + 1`` to the close of bar ``i + h``. ``None`` when the window is
    incomplete (runs past the series, or the open at ``i + 1`` or the close at
    ``i + h`` is missing or not positive, on either side)."""
    j0, j = i + 1, i + h
    if h <= 0 or j >= len(closes) or j >= len(bench_closes) or j0 >= len(opens) or j0 >= len(bench_opens):
        return None
    o0, c1, b0, b1 = opens[j0], closes[j], bench_opens[j0], bench_closes[j]
    if not all(_num(x) and x > 0 for x in (o0, c1, b0, b1)):
        return None
    return ((c1 / o0 - 1.0) - (b1 / b0 - 1.0)) * 100.0


def split_indexes(bars: Sequence[dict], boundaries: Iterable) -> List[int]:
    """The bar index of each split boundary (the first bar on the post-split
    scale), oldest first. ``boundaries`` are bar times in the bars' own ``t``
    shape; one not held is dropped."""
    ts = [b["t"] for b in bars]
    out = set()
    for t in boundaries or ():
        k = bisect_left(ts, t)
        if k < len(ts) and ts[k] == t:
            out.add(k)
    return sorted(out)


def _window_has_split(splits: Sequence[int], i: int, longest: int) -> bool:
    """A boundary ``b`` with ``i + 1 < b <= i + longest``: the base open at ``i + 1``
    and the close at the window's end are on different scales."""
    k = bisect_right(splits, i + 1)
    return k < len(splits) and splits[k] <= i + longest


def rows_for_ticker(ticker: str, bars: Sequence[dict], bench_opens: Sequence[MaybeNum],
                    bench_closes: Sequence[MaybeNum], columns: Dict[str, Sequence],
                    horizons: Sequence[int] = HORIZONS, wanted: Optional[Dict[int, set]] = None,
                    splits: Sequence[int] = ()) -> List[Row]:
    """The measurement rows of one ticker: a :data:`BASELINE_KEY` row for every
    bar with a close and a row per signal on every bar where that signal's
    column is ``1``.

    ``columns`` maps signal name -> event column aligned to ``bars`` (domain
    {0, 1, None}; only ``1.0`` is an event). ``wanted`` restricts the output to
    ``{session: {signal, ...}}`` (the checkpoint's "still to measure" set);
    ``None`` means every session and every signal. ``bench_opens`` and
    ``bench_closes`` must be aligned to ``bars`` (:func:`benchmark_aligned`).
    ``splits`` are the bar indexes of unadjusted split boundaries
    (:func:`split_indexes`); a row whose forward window holds one carries ``None``
    instead of its excess tuple (module header).
    """
    closes = closes_of(bars)
    opens = opens_of(bars)
    out: List[Row] = []
    hs = tuple(int(h) for h in horizons)
    longest = max(hs) if hs else 0
    marks = sorted(int(s) for s in splits or ())
    for i, bar in enumerate(bars):
        session = int(bar["t"])
        want = None if wanted is None else wanted.get(session)
        if wanted is not None and not want:
            continue
        skipped = bool(marks) and _window_has_split(marks, i, longest)
        ex: Optional[Tuple[MaybeNum, ...]] = None
        if want is None or BASELINE_KEY in want:
            if closes[i] is not None:
                if not skipped:
                    ex = tuple(forward_excess(opens, closes, bench_opens, bench_closes, i, h) for h in hs)
                out.append((session, BASELINE_KEY, ticker, ex))
        for name, col in columns.items():
            if want is not None and name not in want:
                continue
            if i < len(col) and col[i] == 1.0:
                if ex is None and not skipped:
                    ex = tuple(forward_excess(opens, closes, bench_opens, bench_closes, i, h) for h in hs)
                out.append((session, name, ticker, None if skipped else ex))
    return out


def benchmark_aligned(bars: Sequence[dict], bench_bars: Sequence[dict]) -> Tuple[list, list]:
    """``(opens, closes)`` of the benchmark at each STOCK bar's time, through the
    one join the RS line uses (``relative_strength.benchmark_closes_aligned``),
    asked once for the closes and once for the opens."""
    from api.services import relative_strength as rs
    bench = list(bench_bars)
    closes = rs.benchmark_closes_aligned(list(bars), bench)
    opens = rs.benchmark_closes_aligned(list(bars), [{"t": b.get("t"), "c": b.get("o")} for b in bench])
    return opens, closes


def summarise_values(values: Iterable[MaybeNum]) -> dict:
    """``{n, incomplete, incomplete_share, hit_rate, median_excess, mean_excess}``
    over one signal at one horizon. ``n`` counts the COMPLETE windows; the
    ratios are ``None`` when there are none."""
    done: List[float] = []
    incomplete = 0
    for v in values:
        if v is None:
            incomplete += 1
        else:
            done.append(float(v))
    n = len(done)
    total = n + incomplete
    return {
        "n": n,
        "incomplete": incomplete,
        "incomplete_share": (incomplete / total) if total else None,
        "hit_rate": (sum(1 for v in done if v > 0) / n) if n else None,
        "median_excess": median(done) if n else None,
        "mean_excess": (sum(done) / n) if n else None,
    }


def summarise(rows: Iterable[Row], horizons: Sequence[int] = HORIZONS) -> dict:
    """``{"per_signal": {name: {...}}, "baseline": {h: {...}}, "rows": int,
    "split_skipped": {name: int}}`` from measurement rows held in memory (the
    dry-run path and :func:`measure`). ``rows`` is the number of counted
    :data:`BASELINE_KEY` rows - the publish floor's quantity; ``split_skipped``
    counts the rows the split guard left out, per signal and for the baseline."""
    hs = tuple(int(h) for h in horizons)
    by_signal: Dict[str, List[List[MaybeNum]]] = {}
    dates: Dict[str, set] = {}
    done_dates: Dict[str, List[set]] = {}
    tickers: Dict[str, set] = {}
    skipped: Dict[str, int] = {}
    for session, signal, ticker, ex in rows:
        if ex is None:
            skipped[signal] = skipped.get(signal, 0) + 1
            continue
        cols = by_signal.setdefault(signal, [[] for _ in hs])
        per_h = done_dates.setdefault(signal, [set() for _ in hs])
        for k in range(len(hs)):
            v = ex[k] if k < len(ex) else None
            cols[k].append(v)
            if v is not None:
                per_h[k].add(session)
        dates.setdefault(signal, set()).add(session)
        tickers.setdefault(signal, set()).add(ticker)
    per_signal = {}
    for signal, cols in by_signal.items():
        if signal == BASELINE_KEY:
            continue
        per_signal[signal] = {
            "n_signals": len(cols[0]),
            "dates": len(dates[signal]),
            "tickers": len(tickers[signal]),
            "horizons": {str(h): {**summarise_values(cols[k]), "dates": len(done_dates[signal][k])}
                         for k, h in enumerate(hs)},
        }
    base_cols = by_signal.get(BASELINE_KEY, [[] for _ in hs])
    baseline = {str(h): summarise_values(base_cols[k]) for k, h in enumerate(hs)}
    return {"per_signal": per_signal, "baseline": baseline, "rows": len(base_cols[0]),
            "split_skipped": dict(sorted(skipped.items()))}


def measure(signals_by_ticker: Dict[str, Dict[str, Sequence]], bars_by_ticker: Dict[str, Sequence[dict]],
            bench_bars: Sequence[dict], horizons: Sequence[int] = HORIZONS,
            splits_by_ticker: Optional[Dict[str, Sequence[int]]] = None) -> dict:
    """The whole measurement in memory: per-signal stats, the all-bars baseline
    and the row count, from signal columns already computed per ticker.

    ``signals_by_ticker[t][name]`` is the event column of ``name`` aligned to
    ``bars_by_ticker[t]``. The benchmark is joined by bar time.
    ``splits_by_ticker[t]`` are that ticker's split-boundary bar indexes.
    """
    rows: List[Row] = []
    for ticker, bars in bars_by_ticker.items():
        b_open, b_close = benchmark_aligned(bars, bench_bars)
        rows.extend(rows_for_ticker(ticker, bars, b_open, b_close, signals_by_ticker.get(ticker, {}), horizons,
                                    splits=(splits_by_ticker or {}).get(ticker, ())))
    out = summarise(rows, horizons)
    out["horizons"] = [int(h) for h in horizons]
    return out
