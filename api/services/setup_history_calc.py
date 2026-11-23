"""SETH, the pure half: a fixed library of chart setups, and how each one acted in every market phase.
No I/O, no clock, no store: bars and MKTH's episodes in, dicts out. `api/services/setup_history.py`
reads the stored bars and holds the answer.

THE LIBRARY (`LIBRARY`): seven setups, each a canonical screen tree the Screener's own evaluator
(`ast_interpret.interpret`) answers on every bar, with a plain name and a one-line definition. A
setup is a screen; nothing here is a second evaluator.

THE ENGINE IS THE SCREEN BACKTESTER'S (`api/services/screener/backtest.py`), called, never copied:
its rules for which bars a screen answers (`_scan_symbol`: the warm-up its tree declares, a hole in
a field it reads (`_unanswerable_bars`), dates in strictly increasing order, a true/false answer);
`_move_buckets`; `_forward_return`, the return from the NEXT session's open to the open `horizon`
sessions after that fill; `_stats`, the summary with its minimum-signal withholding
(`DEFAULT_MIN_SIGNALS`, 30: below it the count is shown and every rate is withheld);
`_same_day_excess`, the same-day control (each signal against every answered bar of the same day in
the same ATR-scaled same-day-move bucket); `_SURVIVORSHIP`, the survivorship sentence.
`scan_stock` is `_scan_symbol` for SEVEN screens over ONE stock's bars: it checks the dates and
measures the same-day buckets once instead of seven times (each is a whole pass over the bars) and
then tallies each screen exactly as `_scan_symbol` does, with its own pieces;
`tests/test_setup_history_calc.py` holds the two equal on every bar. The two differences from a
screen backtest, both stated in the answer:

  * ONE SIGNAL PER RUN. A setup true on several sessions in a row counts once, on the first
    session of the run (the session before it was answered and false). A run whose first session
    the history cannot see (the session before is warm-up or a hole) is not counted.
  * GROUPED BY THE MARKET PHASE on the signal day, from MKTH's own S&P 500 declines (10% or more on
    closing prices, `market_history_calc`): IN A CORRECTION (after a peak close, up to and including
    the low close), THE FIRST 3 MONTHS AFTER A LOW (after the low, before the same calendar day 3
    months later), LATER IN AN UPTREND (more than 3 months after the last low and not in a
    correction), and ALL DAYS. A day after the index history the server holds, or before its first
    low, has no phase and counts in all days only. ⛔ THE PHASE IS ASSIGNED WITH HINDSIGHT: a decline
    is known to be a correction, and its low the low, only after the fact. The signal itself uses
    only bars up to its own day; the label does not, and the answer says so.

THE BASELINE, cheaply and exactly. The backtester's baseline population for a setup is every bar
that setup answered. Those populations differ between setups only at the edges (each tree's own
warm-up, a hole in a field one tree reads and another does not), so the build tallies every bar in
the window once (`_Tally` "all") and, for each setup, the few bars it did not answer (`_Tally`
"left out"); a setup's baseline and same-day cells are the difference, the same numbers the
backtester would have summed bar by bar.

TWO TREES ARE WRITTEN FOR SPEED, AND MEAN EXACTLY WHAT THEIR WORDS SAY. The evaluator's window
functions read every bar of the window for every bar, so a 252-session high costs 252 reads a bar:
the 52-week closing high is the highest of the four quarters' (63-session) highs, `max` of one
memoised `highest(close, 63)` and its three offsets (the same number, a quarter of the reads); the
"20 closes in a row below the 50-day" is a 20-session count of closes below it (`sum`), not the
highest of the 20 gaps (which the evaluator's left-edge check reads twice). The tests hold both
equal to the plain form on every answered bar.

MEMORY (the build holds ONE stock's bars at a time; see `setup_history.py`): per signal, one return
per horizon (8 bytes each), its same-day cell (8) and its phase (1); per (date, bucket) and horizon
a count and a sum. Never a series.
"""
from __future__ import annotations

from array import array
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Tuple

from api.services.ast_interpret import interpret, max_lookback
from api.services.screener import backtest as bt
from api.services.session_calendar import add_months

# ── the canonical tree, built by hand (the persisted shape: type, name, value, args) ──────────


def _num(v: float) -> dict:
    return {"type": "num", "value": v}


def _ser(name: str) -> dict:
    return {"type": "series", "name": name}


def _op(name: str, *args: dict) -> dict:
    return {"type": "op", "name": name, "args": list(args)}


def _call(name: str, *args: dict) -> dict:
    return {"type": "call", "name": name, "args": list(args)}


def _ago(bars: int, child: dict) -> dict:
    """`child[bars]`: the value `bars` sessions before (a backward offset; a forward one is unsayable)."""
    return {"type": "offset", "value": bars, "args": [child]}


def _and(*parts: dict) -> dict:
    tree = parts[0]
    for p in parts[1:]:
        tree = _op("&&", tree, p)
    return tree


_C, _O, _H, _L, _V = _ser("close"), _ser("open"), _ser("high"), _ser("low"), _ser("volume")
_SMA50 = _call("sma", _C, _num(50))
_EMA21 = _call("ema", _C, _num(21))


def high_of_year(src: dict) -> dict:
    """`highest(src, 252)` written as the highest of four quarters' highs: `max` of `highest(src, 63)`
    and that column 63, 126 and 189 sessions back. The same number on every bar it answers (max is
    exact) for a quarter of the window reads; the same declared warm-up (63 + 189 = 252)."""
    q = _call("highest", src, _num(63))
    tree = q
    for k in (1, 2, 3):
        tree = _call("max", tree, _ago(63 * k, q))
    return tree


_HIGH52 = high_of_year(_C)
#: one node object each, read twice (the evaluator's left-edge check visits a node object once)
_HIGH5, _LOW5 = _call("highest", _H, _num(5)), _call("lowest", _L, _num(5))
#: a down day (a close below the session before's), read by both of the pocket pivot's down-day clauses
_DOWN = _op("<", _C, _ago(1, _C))


@dataclass(frozen=True)
class Setup:
    id: str
    name: str
    words: str
    tree: dict
    warmup: int = field(init=False)
    fields: Tuple[str, ...] = field(init=False)

    def __post_init__(self) -> None:
        # the tree's own declarations, asked of the evaluator (never typed here)
        object.__setattr__(self, "warmup", max_lookback(self.tree))
        object.__setattr__(self, "fields", bt._bar_fields(self.tree))


#: THE LIBRARY, fixed. Order is the panel's order. Weeks are rolling five-session weeks.
LIBRARY: Tuple[Setup, ...] = (
    Setup("breakout", "Breakout to a new 52-week high",
          "Closes above every close of the 252 sessions before it, on volume at least 1.5 times its 50-day "
          "average volume (the 50 sessions before).",
          _and(_op(">", _C, _ago(1, _HIGH52)),
               _op(">=", _V, _op("*", _num(1.5), _ago(1, _call("sma", _V, _num(50))))))),
    Setup("pullback_21ema", "Pullback to the 21-day EMA in an uptrend",
          "Closes above its 50-day average with the 50-day above the 200-day, and the day's low within 1% of "
          "the 21-day exponential average.",
          _and(_op(">", _C, _SMA50), _op(">", _SMA50, _call("sma", _C, _num(200))),
               _op("<=", _call("abs", _op("-", _L, _EMA21)), _op("*", _num(0.01), _EMA21)))),
    Setup("gap_up", "Gap up of 4% or more on volume",
          "Opens at least 4% above the previous close, on volume at least 2 times its 50-day average volume "
          "(the 50 sessions before).",
          _and(_op(">=", _O, _op("*", _num(1.04), _ago(1, _C))),
               _op(">=", _V, _op("*", _num(2), _ago(1, _call("sma", _V, _num(50))))))),
    Setup("reclaim_50", "Reclaim of the 50-day average",
          "Closes above its 50-day average after 20 or more closes in a row below it.",
          _and(_op(">", _C, _SMA50),
               _op(">=", _ago(1, _call("sum", _op("<", _C, _SMA50), _num(20))), _num(20)))),
    Setup("inside_week", "Inside week near a high",
          "The last 5 sessions' high is no higher and their low no lower than the 5 sessions before, closing "
          "within 5% of its 52-week closing high.",
          _and(_op("<=", _HIGH5, _ago(5, _HIGH5)), _op(">=", _LOW5, _ago(5, _LOW5)),
               _op(">=", _C, _op("*", _num(0.95), _HIGH52)))),
    Setup("tight_3wk", "Three weeks tight",
          "The close and the closes 5 and 10 sessions before all within 1.5% of each other, closing above its "
          "50-day average.",
          _and(_op("<=", _call("max", _C, _call("max", _ago(5, _C), _ago(10, _C))),
                   _op("*", _num(1.015), _call("min", _C, _call("min", _ago(5, _C), _ago(10, _C))))),
               _op(">", _C, _SMA50))),
    Setup("pocket_pivot", "Pocket pivot",
          "An up close on volume above the largest down-day volume of the 10 sessions before, closing above its "
          "10-day moving average. With no down day among those 10 there is nothing to beat, so it does not count.",
          # VFP's reading (`volume_footprint_calc.pocket_pivots`), the published definition: no down day among the
          # 10 sessions before is not a pocket pivot (the second clause), and the close is above the 10-day simple
          # average of the 10 closes through that day (integrator, 2026-11-23: was the 50-day, so SETH and VFP
          # named different days)
          _and(_op(">", _C, _ago(1, _C)),
               _op(">", _ago(1, _call("highest", _DOWN, _num(10))), _num(0)),
               _op(">", _V, _ago(1, _call("highest", _op("*", _DOWN, _V), _num(10)))),
               _op(">", _C, _call("sma", _C, _num(10))))),
)

BY_ID: Dict[str, Setup] = {s.id: s for s in LIBRARY}

#: setups considered and left out, and why (the answer carries this, word for word)
DROPPED: Tuple[Dict[str, str], ...] = (
    {"name": "Inside week and three weeks tight on calendar weeks",
     "why": ("The evaluator's weekly read answers them without looking ahead, but it cost 0.4 to 3.9 seconds per "
             "stock, too slow for a build over the whole universe; the rolling five-session weeks above are used.")},
    {"name": "Relative strength line at a new high",
     "why": ("It needs the S&P 500's bars held beside every stock's, and the build holds one stock's bars at a time.")},
    {"name": "Base patterns (cup with handle, flat base, VCP)",
     "why": ("The pattern engine's detections are kept for today only, with no history, so a past bar cannot be "
             "screened for them (the backtester refuses a screen that reads them).")},
)

#: forward horizons, in sessions after the fill
HORIZONS: Tuple[int, ...] = (5, 20, 60)
#: the minimum-signal floor is the backtester's own
MIN_SIGNALS = bt.DEFAULT_MIN_SIGNALS
#: the backtester's same-day buckets (`MOVE_BUCKETS` has 7 cuts, so 8 buckets: 0..7)
N_BUCKETS = len(bt.MOVE_BUCKETS) + 1

# ── the market phase ───────────────────────────────────────────────────────────────────────────

PHASE_CORRECTION = "correction"
PHASE_AFTER_LOW = "after_low"
PHASE_UPTREND = "uptrend"
PHASE_ALL = "all"
#: the three phases, in the panel's order; `all` is every signal (a day with no phase included)
PHASES: Tuple[str, ...] = (PHASE_CORRECTION, PHASE_AFTER_LOW, PHASE_UPTREND)
GROUPS: Tuple[str, ...] = PHASES + (PHASE_ALL,)
PHASE_WORDS: Dict[str, str] = {
    PHASE_CORRECTION: "In a correction (peak to low)",
    PHASE_AFTER_LOW: "First 3 months after a low",
    PHASE_UPTREND: "Later in an uptrend",
    PHASE_ALL: "All days",
}
#: months after a low that count as "the first months after a low" (calendar months, MKTH's rally clock)
AFTER_LOW_MONTHS = 3
_NO_PHASE = len(PHASES)          # the code of a day with no phase


class PhaseMap:
    """The phase of a day, from MKTH's S&P 500 episodes (`describe_episodes` rows: peak, trough, ...).

    `first`/`last` are the index history's first and last closes: a day after `last` has no phase
    (the index history has not reached it), nor does a day before the first low the history holds.
    Precedence: in a correction, then after a low, then the uptrend."""

    def __init__(self, episodes: Iterable[Mapping[str, Any]], first: Optional[str], last: Optional[str]):
        self.first, self.last = first, last
        self.declines: List[Tuple[str, str]] = []      # (peak, trough): in a correction when peak < d <= trough
        self.after: List[Tuple[str, str]] = []         # (trough, end): after a low when trough < d < end
        troughs = []
        for ep in episodes or ():
            try:
                p, t = ep["peak"]["date"], ep["trough"]["date"]
                end = add_months(date.fromisoformat(t), AFTER_LOW_MONTHS).isoformat()
            except (KeyError, TypeError, ValueError):
                continue
            self.declines.append((p, t))
            self.after.append((t, end))
            troughs.append(t)
        self.first_trough = min(troughs) if troughs else None
        self._memo: Dict[str, int] = {}

    def code(self, d: str) -> int:
        got = self._memo.get(d)
        if got is not None:
            return got
        got = self._code(d)
        self._memo[d] = got
        return got

    def _code(self, d: str) -> int:
        if self.last is None or d > self.last or (self.first is not None and d < self.first):
            return _NO_PHASE
        for p, t in self.declines:
            if p < d <= t:
                return 0
        for t, end in self.after:
            if t < d < end:
                return 1
        if self.first_trough is not None and d > self.first_trough:
            return 2
        return _NO_PHASE

    def phase(self, d: str) -> Optional[str]:
        c = self.code(d)
        return PHASES[c] if c < len(PHASES) else None


# ── one stock: the backtester's scan of each setup ─────────────────────────────────────────────

def first_of_run(scan: Any) -> List[int]:
    """The signal bars that START a run: true on the bar, answered and false on the bar before."""
    signals = set(scan.signal_rows)
    answered = set(scan.answered_rows)
    return [i for i in scan.signal_rows if (i - 1) in answered and (i - 1) not in signals]


def _dates_refusal(bars: Sequence[Mapping[str, Any]]) -> Optional[bt.BacktestRefusal]:
    """`_scan_symbol`'s two date refusals, asked once for the stock: every bar a `YYYY-MM-DD` day,
    strictly increasing (forward returns are read by position, so position must mean time)."""
    prev = None
    for i, bar in enumerate(bars):
        d = bt.bar_date(bar)
        if d is None:
            return bt.BacktestRefusal("non_daily_bars", f"- bar {i} carries t={bar.get('t')!r}")
        if prev is not None and d <= prev:
            return bt.BacktestRefusal("unordered_bars", f"- bar {i} is {d}, and bar {i - 1} is {prev}")
        prev = d
    return None


def _tally(col: Sequence[Any], blocked: set, win: Sequence[int], warmup: int, days: Sequence[str],
           buckets: List[Optional[int]]) -> Any:
    """One screen's tally over the window, `_scan_symbol`'s loop on a column already answered: a bar
    inside the warm-up is warm-up, a hole (`None`, or a bar `_unanswerable_bars` blocked) is not
    computable, anything else must be 0 or 1. The same `_SymbolScan`, with the same closed identity."""
    scan = bt._SymbolScan()
    scan.buckets = buckets
    dates = []
    for i in win:
        scan.in_window += 1
        if i < warmup:
            scan.warmup += 1
            continue
        v = col[i]
        if v is None or i in blocked:
            scan.not_computable += 1
            continue
        if v not in (0.0, 1.0):
            raise bt.BacktestRefusal("not_a_condition", f"- it evaluated to {v!r} at {days[i]}.")
        scan.answered += 1
        scan.answered_rows.append(i)
        dates.append(days[i])
        if v == 1.0:
            scan.signal_rows.append(i)
    scan.dates = tuple(dates)
    bt._assert_closes("symbol bar", scan.in_window,
                      {"warmup": scan.warmup, "not_computable": scan.not_computable, "answered": scan.answered})
    return scan


def scan_stock(bars: Sequence[Mapping[str, Any]], frm: str, to: str,
               setups: Sequence[Setup] = LIBRARY) -> List[Tuple[Setup, Any]]:
    """`[(setup, scan | BacktestRefusal)]`: what `_scan_symbol(setup.tree, bars, ...)` answers for every
    setup over one stock's bars, with the dates checked and the same-day buckets measured once for all
    of them. Every setup's column is the evaluator's own (`interpret`)."""
    bars = bars if isinstance(bars, list) else list(bars)
    refused = _dates_refusal(bars)
    if refused is not None:
        return [(s, refused) for s in setups]
    days = [b["t"] for b in bars]
    win = [i for i, d in enumerate(days) if frm <= d <= to]
    buckets = bt._move_buckets(bars)
    out = []
    for s in setups:
        try:
            col = interpret(s.tree, bars)
            blocked = bt._unanswerable_bars(bars, s.fields, s.warmup)
            out.append((s, _tally(col, blocked, win, s.warmup, days, buckets)))
        except bt.BacktestRefusal as r:
            out.append((s, r))
    return out


def forward_returns(bars: Sequence[Mapping[str, Any]], horizons: Sequence[int] = HORIZONS) -> List[List[Optional[float]]]:
    """Per horizon, per bar: the backtester's `_forward_return` (next open to the open `h` sessions later)."""
    n = len(bars)
    return [[bt._forward_return(bars, i, h) for i in range(n)] for h in horizons]


# ── the universe study ─────────────────────────────────────────────────────────────────────────

_NAN = float("nan")


class _Tally:
    """Per horizon: per phase code a running (n, sum, wins, sum of clipped returns), and per (day,
    bucket) a count and a sum of clipped returns (the backtester's same-day cells)."""

    __slots__ = ("base", "cell_n", "cell_s")

    def __init__(self, n_h: int):
        self.base = [[[0, 0.0, 0, 0.0] for _ in range(len(PHASES) + 1)] for _ in range(n_h)]
        self.cell_n = [array("q") for _ in range(n_h)]
        self.cell_s = [array("d") for _ in range(n_h)]

    def grow(self, size: int) -> None:
        for h in range(len(self.cell_n)):
            short = size - len(self.cell_n[h])
            if short > 0:
                self.cell_n[h].extend([0] * short)
                self.cell_s[h].extend([0.0] * short)

    def add(self, h: int, phase: int, r: float, w: float, cell: int) -> None:
        b = self.base[h][phase]
        b[0] += 1
        b[1] += r
        if r > 0:
            b[2] += 1
        b[3] += w
        if cell >= 0:
            self.cell_n[h][cell] += 1
            self.cell_s[h][cell] += w


class _Signals:
    """One setup's first-of-run signals, compact: a return per horizon (NaN when the horizon has no
    forward return), the same-day cell (-1 when the day's move was not measurable), the phase code."""

    __slots__ = ("ret", "cell", "phase")

    def __init__(self, n_h: int):
        self.ret = [array("d") for _ in range(n_h)]
        self.cell = array("q")
        self.phase = array("b")

    def __len__(self) -> int:
        return len(self.cell)


class _CellView:
    """The `cells` mapping `_same_day_excess` reads, over the tallies: `[n, sum]` for a (day, bucket)
    with at least one answered bar, else None. Read-only and computed per lookup (never a dict of the
    whole grid)."""

    def __init__(self, study: "Study", s: int, h: int):
        self._idx, self._all, self._out, self._h = study._date_idx, study._all, study._out[s], h

    def get(self, key, default=None):
        if key is None:
            return default
        d, b = key
        i = self._idx.get(d)
        if i is None:
            return default
        k = i * N_BUCKETS + b
        n = self._all.cell_n[self._h][k] - self._out.cell_n[self._h][k]
        if n <= 0:
            return default
        return [n, self._all.cell_s[self._h][k] - self._out.cell_s[self._h][k]]


class _Observations:
    """The `strat_obs` `_same_day_excess` iterates (twice): `((day, bucket) | None, return)` for every
    signal of one group with a return at one horizon, produced on the fly from the compact arrays."""

    def __init__(self, sig: _Signals, h: int, phase: Optional[int], dates: List[str]):
        self._sig, self._h, self._phase, self._dates = sig, h, phase, dates

    def __iter__(self) -> Iterator[Tuple[Optional[Tuple[str, int]], float]]:
        ret, cell, ph, dates = self._sig.ret[self._h], self._sig.cell, self._sig.phase, self._dates
        want = self._phase
        for j in range(len(cell)):
            r = ret[j]
            if r != r or (want is not None and ph[j] != want):
                continue
            c = cell[j]
            yield ((dates[c // N_BUCKETS], c % N_BUCKETS) if c >= 0 else None), r


class Study:
    """The universe study, one stock at a time (`add`), then `result`. Holds counts, sums and one
    small record per signal; never a stock's bars."""

    def __init__(self, phases: PhaseMap, frm: str, to: str, setups: Sequence[Setup] = LIBRARY,
                 horizons: Sequence[int] = HORIZONS, max_signals: Optional[int] = None):
        self.phases, self.frm, self.to = phases, frm, to
        self.setups, self.horizons = tuple(setups), tuple(horizons)
        self.max_signals = max_signals
        n_h = len(self.horizons)
        self._date_idx: Dict[str, int] = {}
        self._dates: List[str] = []
        self._all = _Tally(n_h)
        self._out = [_Tally(n_h) for _ in self.setups]
        self._sig = [_Signals(n_h) for _ in self.setups]
        self._capped = [False] * len(self.setups)
        self._cover = [{"bars_in_window": 0, "bars_warmup": 0, "bars_not_computable": 0, "bars_answered": 0,
                        "symbols_refused": 0, "runs_unseen_start": 0} for _ in self.setups]
        self.symbols_scanned = 0
        self.first_day: Optional[str] = None
        self.last_day: Optional[str] = None

    # ── one stock ──────────────────────────────────────────────────────────────────────────────

    def _index_of(self, d: str) -> int:
        i = self._date_idx.get(d)
        if i is None:
            i = self._date_idx[d] = len(self._dates)
            self._dates.append(d)
        return i

    def add(self, bars: Sequence[Mapping[str, Any]]) -> None:
        """Scan one stock's bars (ascending, daily, `t` as YYYY-MM-DD) with every setup and tally."""
        n = len(bars)
        if n == 0:
            return
        frm, to = self.frm, self.to
        days = [b["t"] for b in bars]
        win = [i for i, d in enumerate(days) if frm <= d <= to]
        if not win:
            return
        scans = scan_stock(bars, frm, to, self.setups)
        buckets = next((sc.buckets for _s, sc in scans if not isinstance(sc, bt.BacktestRefusal)), None)
        if buckets is None:                   # every setup refused this stock's bars: nothing to tally
            for j, (_s, _sc) in enumerate(scans):
                self._cover[j]["symbols_refused"] += 1
            return
        self.symbols_scanned += 1
        lo, hi = days[win[0]], days[win[-1]]
        self.first_day = lo if self.first_day is None or lo < self.first_day else self.first_day
        self.last_day = hi if self.last_day is None or hi > self.last_day else self.last_day
        phase = [self.phases.code(d) for d in days]
        cellk = [-1] * n
        for i in win:
            b = buckets[i]
            if b is not None:
                cellk[i] = self._index_of(days[i]) * N_BUCKETS + b
        size = len(self._dates) * N_BUCKETS
        self._all.grow(size)
        for t in self._out:
            t.grow(size)
        fwd = forward_returns(bars, self.horizons)
        clip = bt.winsorise
        # every bar in the window with a forward return: the population every setup's baseline starts from
        for h, col in enumerate(fwd):
            for i in win:
                r = col[i]
                if r is not None:
                    self._all.add(h, phase[i], r, clip(r), cellk[i])
        for j, (s, scan) in enumerate(scans):
            cov = self._cover[j]
            if isinstance(scan, bt.BacktestRefusal):
                cov["symbols_refused"] += 1
                # a refused stock answers nothing: every one of its window bars leaves this setup's population
                answered: set = set()
            else:
                cov["bars_in_window"] += scan.in_window
                cov["bars_warmup"] += scan.warmup
                cov["bars_not_computable"] += scan.not_computable
                cov["bars_answered"] += scan.answered
                answered = set(scan.answered_rows)
            out = self._out[j]
            left = [i for i in win if i not in answered]
            for h, col in enumerate(fwd):
                for i in left:
                    r = col[i]
                    if r is not None:
                        out.add(h, phase[i], r, clip(r), cellk[i])
            if isinstance(scan, bt.BacktestRefusal):
                continue
            starts = first_of_run(scan)
            # a run the history cannot see begin (the session before is warm-up or a hole): never counted
            cov["runs_unseen_start"] += sum(1 for i in scan.signal_rows if (i - 1) not in answered)
            sig = self._sig[j]
            if self.max_signals is not None and len(sig) + len(starts) > self.max_signals:
                self._capped[j] = True
            if self._capped[j]:
                continue
            for i in starts:
                for h, col in enumerate(fwd):
                    r = col[i]
                    sig.ret[h].append(_NAN if r is None else r)
                sig.cell.append(cellk[i])
                sig.phase.append(phase[i])

    # ── the answer ─────────────────────────────────────────────────────────────────────────────

    def signal_count(self) -> int:
        return sum(len(s) for s in self._sig)

    def _baseline(self, j: int, h: int, codes: Sequence[int], withheld: bool) -> Dict[str, Any]:
        # Each cell is one record [count, sum, wins, clipped sum]: the whole universe's cell less this setup's
        # own signals in it, summed over the phase codes asked for. Named fields of one record, never a window.
        n = s = w = cs = 0
        for c in codes:
            a_n, a_s, a_w, a_cs = self._all.base[h][c]
            o_n, o_s, o_w, o_cs = self._out[j].base[h][c]
            n += a_n - o_n
            s += a_s - o_s
            w += a_w - o_w
            cs += a_cs - o_cs
        if withheld or n <= 0:
            return {"n": max(n, 0), "win_rate": None, "avg_pct": None, "avg_pct_winsorised": None}
        return {"n": n, "win_rate": w / n * 100, "avg_pct": s / n, "avg_pct_winsorised": cs / n}

    def group(self, j: int, group: str, min_signals: int = MIN_SIGNALS) -> Dict[str, Any]:
        sig = self._sig[j]
        want = None if group == PHASE_ALL else PHASES.index(group)
        codes = range(len(PHASES) + 1) if want is None else (want,)
        signals = sum(1 for p in sig.phase if want is None or p == want)
        horizons = {}
        for h, hz in enumerate(self.horizons):
            col = sig.ret[h]
            rets = array("d", (col[k] for k in range(len(col))
                               if col[k] == col[k] and (want is None or sig.phase[k] == want)))
            below = len(rets) < min_signals
            stats = bt._stats(rets, withheld=below)
            horizons[str(hz)] = {
                "n": len(rets),
                "below_floor": below,
                "strategy": stats.to_dict(),
                "baseline": self._baseline(j, h, codes, below),
                "same_day": bt._same_day_excess(_Observations(sig, h, want, self._dates), _CellView(self, j, h),
                                                withheld=below),
            }
            del rets
        return {"phase": group, "words": PHASE_WORDS[group], "signals": signals, "horizons": horizons}

    def result(self, min_signals: int = MIN_SIGNALS) -> List[Dict[str, Any]]:
        out = []
        for j, s in enumerate(self.setups):
            row = {"id": s.id, "name": s.name, "words": s.words, "tree": s.tree, "warmup_bars": s.warmup,
                   "bar_fields": list(s.fields), "coverage": dict(self._cover[j])}
            if self._capped[j]:
                row.update({"state": "capped", "groups": [],
                            "detail": (f"This setup fired more than {self.max_signals:,} times, more than the build "
                                       "holds, so its numbers are withheld rather than cut.")})
            else:
                row.update({"state": "ok", "signals": len(self._sig[j]),
                            "groups": [self.group(j, g, min_signals) for g in GROUPS]})
            out.append(row)
        return out


# ── one stock's own signals (part 2) ───────────────────────────────────────────────────────────

def stock_signals(bars: Sequence[Mapping[str, Any]], phases: PhaseMap, frm: str, to: str,
                  setups: Sequence[Setup] = LIBRARY, horizons: Sequence[int] = HORIZONS) -> Dict[str, Any]:
    """Every first-of-run signal of each setup on one stock, NEWEST FIRST: `{date, setup, phase,
    returns: {h: pct | None}}`, plus per setup how its bars were answered."""
    scans = scan_stock(bars, frm, to, setups)
    fwd = forward_returns(bars, horizons)
    rows, per_setup = [], []
    for s, scan in scans:
        if isinstance(scan, bt.BacktestRefusal):
            per_setup.append({"id": s.id, "state": "refused", "detail": str(scan)})
            continue
        starts = first_of_run(scan)
        per_setup.append({"id": s.id, "state": "ok", "signals": len(starts), "bars_answered": scan.answered,
                          "bars_warmup": scan.warmup, "bars_not_computable": scan.not_computable})
        for i in starts:
            d = bars[i]["t"]
            rows.append({"date": d, "setup": s.id, "phase": phases.phase(d),
                         "returns": {str(hz): (None if fwd[h][i] is None else round(fwd[h][i], 2))
                                     for h, hz in enumerate(horizons)}})
    order = {s.id: k for k, s in enumerate(setups)}
    rows.sort(key=lambda r: (r["date"], -order[r["setup"]]), reverse=True)
    return {"signals": rows, "setups": per_setup}
