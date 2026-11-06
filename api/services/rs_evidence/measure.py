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

    excess[h] = ((C[t+h] / C[t] - 1) - (B[t+h] / B[t] - 1)) * 100      (percent)

``C`` the stock close, ``B`` the benchmark close at the stock's own bar times
(the same time join the RS line uses). That is the compounded return of bars
``t+1 .. t+h`` - the window BEGINS at ``t+1`` and the signal bar's own close
is the base (research base §(c): "forward returns begin at t+1 and say
which"). A member who sees the dot after the close cannot buy at ``C[t]``; the
copy unit (2b-09) decides how to say that. The horizon counts the stock's OWN
bars, so a gap in a thin name stretches the window by the gap.

Per signal and horizon: ``n`` (events with a complete window), ``incomplete``
(events whose window runs past the held history or lacks a positive close at
either end - EXCLUDED and COUNTED, never guessed), ``hit_rate`` (share of
complete events with ``excess > 0``, strictly), ``median_excess`` and
``mean_excess`` (percent). The BASELINE is the same statistic over EVERY bar
of every measured ticker - the "all bars" comparison a card needs so a hit
rate reads as lift, not as a number on its own. Per signal we also count
``dates`` (distinct sessions with an event: 5,000 events on 40 dates is 40
observations - research base §(c)) and ``tickers``.

NEVER INVENT A VALUE (plan §2.3 principle 4). A statistic over zero complete
events is ``None``, not 0.

ONE STATISTIC, TWO ROW SOURCES. :func:`summarise_values` is the only place
the numbers are computed. :func:`measure` feeds it rows held in memory;
``store.summary`` feeds it the same rows read back from SQLite. A test asserts
the two paths agree on the same rows.
"""

from __future__ import annotations

import math
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
# (session YYYYMMDD, signal, ticker, excess per horizon aligned to the horizons)
Row = Tuple[int, str, str, Tuple[MaybeNum, ...]]


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def closes_of(bars: Sequence[dict]) -> List[MaybeNum]:
    """The close of each bar, ``None`` where it is missing or not positive."""
    out: List[MaybeNum] = []
    for b in bars:
        c = b.get("c")
        out.append(float(c) if _num(c) and c > 0 else None)
    return out


def forward_excess(closes: Sequence[MaybeNum], bench: Sequence[MaybeNum], i: int, h: int) -> MaybeNum:
    """The module-header formula at bar ``i`` over ``h`` bars; ``None`` when the
    window is incomplete (runs past the series, or a close is missing or not
    positive at either end, on either side)."""
    j = i + h
    if h <= 0 or j >= len(closes) or j >= len(bench):
        return None
    c0, c1, b0, b1 = closes[i], closes[j], bench[i], bench[j]
    if not all(_num(x) and x > 0 for x in (c0, c1, b0, b1)):
        return None
    return ((c1 / c0 - 1.0) - (b1 / b0 - 1.0)) * 100.0


def rows_for_ticker(ticker: str, bars: Sequence[dict], bench_closes: Sequence[MaybeNum],
                    columns: Dict[str, Sequence], horizons: Sequence[int] = HORIZONS,
                    wanted: Optional[Dict[int, set]] = None) -> List[Row]:
    """The measurement rows of one ticker: a :data:`BASELINE_KEY` row for every
    bar with a close and a row per signal on every bar where that signal's
    column is ``1``.

    ``columns`` maps signal name -> event column aligned to ``bars`` (domain
    {0, 1, None}; only ``1.0`` is an event). ``wanted`` restricts the output to
    ``{session: {signal, ...}}`` (the checkpoint's "still to measure" set);
    ``None`` means every session and every signal. ``bench_closes`` must be
    aligned to ``bars`` (``relative_strength.benchmark_closes_aligned``).
    """
    closes = closes_of(bars)
    out: List[Row] = []
    hs = tuple(int(h) for h in horizons)
    for i, bar in enumerate(bars):
        session = int(bar["t"])
        want = None if wanted is None else wanted.get(session)
        if wanted is not None and not want:
            continue
        ex: Optional[Tuple[MaybeNum, ...]] = None
        if want is None or BASELINE_KEY in want:
            if closes[i] is not None:
                ex = tuple(forward_excess(closes, bench_closes, i, h) for h in hs)
                out.append((session, BASELINE_KEY, ticker, ex))
        for name, col in columns.items():
            if want is not None and name not in want:
                continue
            if i < len(col) and col[i] == 1.0:
                if ex is None:
                    ex = tuple(forward_excess(closes, bench_closes, i, h) for h in hs)
                out.append((session, name, ticker, ex))
    return out


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
    """``{"per_signal": {name: {...}}, "baseline": {h: {...}}, "rows": int}``
    from measurement rows held in memory (the dry-run path and :func:`measure`).
    ``rows`` is the number of :data:`BASELINE_KEY` rows - the publish floor's
    quantity."""
    hs = tuple(int(h) for h in horizons)
    by_signal: Dict[str, List[List[MaybeNum]]] = {}
    dates: Dict[str, set] = {}
    tickers: Dict[str, set] = {}
    for session, signal, ticker, ex in rows:
        cols = by_signal.setdefault(signal, [[] for _ in hs])
        for k in range(len(hs)):
            cols[k].append(ex[k] if k < len(ex) else None)
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
            "horizons": {str(h): summarise_values(cols[k]) for k, h in enumerate(hs)},
        }
    base_cols = by_signal.get(BASELINE_KEY, [[] for _ in hs])
    baseline = {str(h): summarise_values(base_cols[k]) for k, h in enumerate(hs)}
    return {"per_signal": per_signal, "baseline": baseline, "rows": len(base_cols[0])}


def measure(signals_by_ticker: Dict[str, Dict[str, Sequence]], bars_by_ticker: Dict[str, Sequence[dict]],
            bench_bars: Sequence[dict], horizons: Sequence[int] = HORIZONS) -> dict:
    """The whole measurement in memory: per-signal stats, the all-bars baseline
    and the row count, from signal columns already computed per ticker.

    ``signals_by_ticker[t][name]`` is the event column of ``name`` aligned to
    ``bars_by_ticker[t]``. The benchmark is joined by bar time.
    """
    from api.services import relative_strength as rs
    rows: List[Row] = []
    for ticker, bars in bars_by_ticker.items():
        bench = rs.benchmark_closes_aligned(list(bars), list(bench_bars))
        rows.extend(rows_for_ticker(ticker, bars, bench, signals_by_ticker.get(ticker, {}), horizons))
    out = summarise(rows, horizons)
    out["horizons"] = [int(h) for h in horizons]
    return out
