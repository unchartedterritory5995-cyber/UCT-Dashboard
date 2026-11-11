"""Unit U2 of the RS Phase 2a review (2026-11-07): the RS kernel's cost.

Finding #10 — `relative_strength.rolling_extreme_event` rescanned the whole
252-bar window on every bar (O(n x lookback)); it is now one pass over a
monotonic deque. Finding #5 — the screener's `rs_columns.collect_one` joined
the full 5,000-bar SPY list three times per ticker (phase 1's RS line, its
benchmark closes, Mansfield's RS line again) plus RSP once; it now trims each
benchmark to the window's bar times once, draws the RS line once, and asks
the two last-bar-only reads (green-on-red count, benchmark agreement) of the
bars they actually read.

⛔ THE ANSWER MUST NOT MOVE. Both changes are pure cost cuts, so the oracle
for each is the PREVIOUS implementation, copied verbatim below, run against
the new one on seeded random series with gaps (None, NaN, inf, bools,
strings, missing benchmark bars), ties (closes on a coarse price grid),
short windows (shorter than the lookback, shorter than every column) and
duplicate / out-of-window benchmark bars. A parity test passes before and
after the change by construction; the COST tests at the bottom are the ones
that fail on the old code (seen red against cb97c86931).
"""
from __future__ import annotations

import datetime as dt
import math
import random

import pytest

from api.services import relative_strength as rs
from api.services.screener import rs_columns


# ── The oracle: rolling_extreme_event as it stood at cb97c86931 ─────────────

def _old_rolling_extreme_event(series, lookback, *, high, tolerance_pct=0.0):
    n = len(series)
    out = [None] * n
    if lookback <= 0:
        return out
    tol = max(0.0, float(tolerance_pct)) / 100.0
    for t in range(lookback, n):
        v = series[t]
        if not rs._is_num(v):
            continue
        window = series[t - lookback:t]
        if any(not rs._is_num(w) for w in window):
            continue
        if high:
            ext = max(window)
            hit = v >= ext * (1.0 - tol)
        else:
            ext = min(window)
            hit = v <= ext * (1.0 + tol)
        out[t] = 1.0 if hit else 0.0
    return out


# ── The oracle: collect_one as it stood at cb97c86931 ───────────────────────
# Run with `rs.rolling_extreme_event` swapped for the old kernel (fixture
# below), so the whole old pipeline — not the new kernel inside the old
# collector — is what the new one is compared against.

def _old_collect_one(bars, spy_bars, rsp_bars=None, *, session=None, stats=None):
    R = rs_columns
    values = R._blank()
    win = R._clip(R._as_bars(bars), session)
    n = len(win)
    if n == 0:
        R._count(stats, R.OUTCOME_SHORT)
        return values
    spy = R._as_bars(spy_bars, like=win)
    if not spy:
        R._count(stats, R.OUTCOME_NO_BENCH)
        return values

    p1 = rs.compute_phase1_columns(win, spy)
    rs_spy = p1["rsLine"]
    if rs_spy[-1] is None:
        R._count(stats, R.OUTCOME_NO_BENCH)
        return values

    mans = rs.compute_mansfield_columns(win, spy, R.MANSFIELD_LENGTH)
    nh_age = rs.bars_ago_column(p1["rsNH"])
    cross_age = rs.bars_ago_column(p1["crossUp"])
    gor_20 = rs.rolling_count(p1["gor"], R.GREEN_ON_RED_WINDOW)

    agree = None
    rsp = R._as_bars(rsp_bars, like=win)
    if rsp:
        rs_rsp = rs.rs_line(win, rsp)
        agree = rs.benchmark_agree(rs_spy, rs_rsp, rs_rsp, R.AGREE_WINDOW)[-1]

    values["rs_new_high"] = R._flag(p1["rsNH"][-1])
    values["rs_nh_before_price"] = R._flag(p1["rsNHbeforePx"][-1])
    values["rs_nh_red_day"] = R._flag(p1["rsNHred"][-1])
    values["rs_nh_bars_ago"] = R._int(nh_age[-1])
    values["green_on_red_20"] = R._int(gor_20[-1])
    values["rs_line_above_ma"] = R._flag(p1["rsAbove"][-1])
    values["rs_cross_up_bars_ago"] = R._int(cross_age[-1])
    values["mansfield"] = R._real(mans["mansfield"][-1], R.MANSFIELD_DP)
    values["mansfield_cross_bars_ago"] = R._int(mans["mansfieldCrossBarsAgo"][-1])
    values["rs_benchmark_agree"] = R._flag(agree)

    for col, need in R.MIN_BARS.items():
        if n < need:
            values[col] = None
    R._count(stats, R.OUTCOME_SHORT if n < R.MIN_BARS_FULL else R.OUTCOME_RATED)
    return values


def _same(a, b) -> bool:
    """Equal value AND type, element by element (1.0 vs 1 matters on the wire;
    NaN never appears in an output column, but compare it safely anyway)."""
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if type(x) is not type(y):
            return False
        if isinstance(x, float) and math.isnan(x) and math.isnan(y):
            continue
        if x != y:
            return False
    return True


# ── Random series ───────────────────────────────────────────────────────────

_ODD = (None, float("nan"), float("inf"), -float("inf"), True, False, "x")


def _random_series(r: random.Random, n: int, gap_rate=None):
    """A walk on a coarse grid (ties are common), with ints, holes and junk."""
    out, p = [], 50.0
    grid = r.choice((0.5, 1.0, 0.01))
    if gap_rate is None:
        gap_rate = r.choice((0.0, 0.0, 0.01, 0.05, 0.2))
    for _ in range(n):
        p = max(grid, p + r.choice((-1, 0, 0, 1)) * grid * r.randint(1, 3))
        roll = r.random()
        if roll < gap_rate:
            out.append(r.choice(_ODD))
        elif roll < gap_rate + 0.1:
            out.append(int(round(p)))
        else:
            out.append(round(p, 2))
    return out


@pytest.mark.parametrize("seed", range(60))
def test_rolling_extreme_event_matches_the_old_scan_exactly(seed):
    r = random.Random(seed)
    n = r.choice((0, 1, 2, 5, 30, 120, 300))
    series = _random_series(r, n)
    for lookback in (0, -3, 1, 2, 3, 7, 20, n, n + 1, 252):
        for high in (True, False):
            for tol in (0.0, 2.0, 0.5, -1.0, 10.0):
                old = _old_rolling_extreme_event(series, lookback, high=high, tolerance_pct=tol)
                new = rs.rolling_extreme_event(series, lookback, high=high, tolerance_pct=tol)
                assert _same(old, new), (seed, lookback, high, tol)


def test_rolling_extreme_event_ties_and_gaps_hand_cases():
    for series, lb in (
        ([3.0, 3, 3.0, 3, 3.0], 2),                 # int/float ties
        ([5.0, None, 5.0, 5.0, 5.0, 4.0], 2),        # hole, then a whole window
        ([1.0, float("nan"), 2.0, 3.0, 1.0], 1),
        ([2 ** 53 + 1, float(2 ** 53), 2 ** 53], 1),  # exact int/float comparison
        ([True, 1.0, 1.0, 1.0], 2),                  # a bool is a hole, not a 1
        ((4.0, 3.0, 4.0, 2.0, 4.0), 3),              # a tuple, not a list
    ):
        for high in (True, False):
            for tol in (0.0, 2.0):
                assert _same(_old_rolling_extreme_event(series, lb, high=high, tolerance_pct=tol),
                             rs.rolling_extreme_event(series, lb, high=high, tolerance_pct=tol))


def test_rolling_extreme_event_still_refuses_a_fractional_lookback():
    with pytest.raises(TypeError):
        _old_rolling_extreme_event([1.0, 2.0, 3.0], 1.5, high=True)
    with pytest.raises(TypeError):
        rs.rolling_extreme_event([1.0, 2.0, 3.0], 1.5, high=True)


# ── collect_one, old against new ────────────────────────────────────────────

def _days(n: int, start=dt.date(2020, 1, 1)):
    d, out = start, []
    while len(out) < n:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            out.append(d)
    return out


def _fmt(r: random.Random, d: dt.date):
    """Bar time as the store hands it out (``YYYY-MM-DD``)."""
    return d.strftime("%Y-%m-%d")


def _case(r: random.Random):
    """(ticker bars, spy bars, rsp bars, session) for one random ticker."""
    deep = _days(700)
    n = r.choice((0, 1, 5, 19, 20, 21, 22, 60, 199, 200, 201, 251, 252,
                  253, 253, 254, 254, 300, 300, 400, 400, 400, 400))
    start = r.randint(0, len(deep) - max(n, 1) - 40)
    days = deep[start:start + n]
    closes = _random_series(r, n, r.choice((0.0, 0.0, 0.0, 0.0, 0.002, 0.01, 0.05)))
    bars = []
    for d, c in zip(days, closes):
        if c is None and r.random() < 0.3:
            bars.append({"t": _fmt(r, d)})                   # no `c` at all
        else:
            bars.append({"t": _fmt(r, d), "c": c})
    if bars and r.random() < 0.1:                             # a Saturday bar: a time SPY lacks
        k = r.randrange(len(bars))
        bars[k] = dict(bars[k], t=(days[k] + dt.timedelta(days=(5 - days[k].weekday()) % 7 or 7)).strftime("%Y-%m-%d"))

    def bench(drop_rate):
        out, p = [], 300.0
        for d in deep:
            p = max(1.0, p * (1 + r.gauss(0, 0.012)))
            if r.random() < drop_rate:
                continue                                      # a missing benchmark bar
            c = round(p, 2)
            if r.random() < 0.003:
                c = r.choice((None, 0, 0.0, float("nan"), True))
            out.append({"t": _fmt(r, d), "c": c})
        if out and r.random() < 0.3:                          # a duplicate time: the last one wins
            k = r.randrange(len(out))
            out.insert(k + 1, dict(out[k], c=round(r.uniform(100, 400), 2)))
        return out

    spy = r.choice((bench(0.0), bench(0.0), bench(0.0), bench(0.0), bench(0.0), bench(0.01),
                    bench(0.03), []))
    rsp = r.choice((bench(0.0), bench(0.05), [], None))
    session = None
    if days and r.random() < 0.3:
        session = days[max(0, n - 1 - r.randint(0, 30))].strftime("%Y%m%d")
    return bars, spy, rsp, session


def _run(fn, bars, spy, rsp, session):
    stats: dict = {}
    try:
        return ("ok", fn(bars, spy, rsp, session=session, stats=stats), stats)
    except Exception as e:  # noqa: BLE001 - a raise is part of the contract being compared
        return ("raise", type(e).__name__, stats)


@pytest.fixture
def old_kernel(monkeypatch):
    """Swap in the old extreme scan for the oracle run, then restore it."""
    def use(flag: bool):
        if flag:
            monkeypatch.setattr(rs, "rolling_extreme_event", _old_rolling_extreme_event)
        else:
            monkeypatch.undo()
    return use


def _assert_same_outcome(old, new, label):
    assert old[0] == new[0], (label, old, new)
    assert old[2] == new[2], (label, "stats", old[2], new[2])
    if old[0] == "raise":
        assert old[1] == new[1], label
        return
    assert set(old[1]) == set(new[1]) == set(rs_columns.COLUMNS), label
    for k in rs_columns.COLUMNS:
        a, b = old[1][k], new[1][k]
        assert type(a) is type(b) and a == b, (label, k, a, b)


@pytest.mark.parametrize("seed", range(80))
def test_collect_one_matches_the_old_collector_exactly(seed, old_kernel):
    r = random.Random(1000 + seed)
    bars, spy, rsp, session = _case(r)
    old_kernel(True)
    old = _run(_old_collect_one, bars, spy, rsp, session)
    old_kernel(False)
    new = _run(rs_columns.collect_one, bars, spy, rsp, session)
    _assert_same_outcome(old, new, seed)


def test_collect_one_matches_on_float_close_lists_and_steady_leaders(old_kernel):
    """The compat shape (bare close lists, `_as_bars`) and clean rated rows,
    where every one of the ten columns is a number."""
    r = random.Random(7)
    days = _days(450)
    spy = [{"t": d.isoformat(), "c": round(400 * (1.0003 ** i), 2)} for i, d in enumerate(days)]
    rsp = [{"t": d.isoformat(), "c": round(150 * (1.0002 ** i) + r.uniform(-0.3, 0.3), 2)}
           for i, d in enumerate(days)]
    cases = []
    for k in range(6):
        drift = r.uniform(-0.002, 0.003)
        win = [{"t": d.isoformat(), "c": round(50 * ((1 + drift) ** i) * (1 + r.gauss(0, 0.01)), 2)}
               for i, d in enumerate(days[-400:])]
        cases.append((win, spy, rsp))
    closes = [b["c"] for b in cases[0][0]]
    cases.append((closes, [b["c"] for b in spy], [b["c"] for b in rsp]))
    cases.append((cases[1][0], [b["c"] for b in spy], None))
    rated = 0
    for i, (b, s, p) in enumerate(cases):
        old_kernel(True)
        old = _run(_old_collect_one, b, s, p, None)
        old_kernel(False)
        new = _run(rs_columns.collect_one, b, s, p, None)
        _assert_same_outcome(old, new, i)
        rated += new[2].get(rs_columns.OUTCOME_RATED, 0)
    assert rated >= 6, "the fixture must include fully rated rows, or parity proves little"


def test_compute_mansfield_columns_with_the_rs_line_handed_in_is_the_same_answer():
    r = random.Random(3)
    days = _days(320)
    bench = [{"t": d.isoformat(), "c": round(100 + r.uniform(-2, 2), 2)} for d in days if r.random() > 0.03]
    # Holes come from the benchmark side (a missing bar): a `None` STOCK close
    # makes the shared RS join raise, old and new alike, which the collector
    # parity cases above already cover.
    bars = [{"t": d.isoformat(), "c": round(40 + r.uniform(0, 20), 2)} for d in days]
    line = rs.rs_line(bars, bench)
    plain = rs.compute_mansfield_columns(bars, bench, 50)
    handed = rs.compute_mansfield_columns(bars, bench, 50, rs_values=line)
    for k in rs.PHASE2A_COLUMNS:
        assert _same(plain[k], handed[k]), k
    # A line that is not aligned to the bars is ignored, never trusted.
    misaligned = rs.compute_mansfield_columns(bars, bench, 50, rs_values=line[:-1])
    for k in rs.PHASE2A_COLUMNS:
        assert _same(plain[k], misaligned[k]), k


# ── The cost rails: these are red on the old code ───────────────────────────

def test_rolling_extreme_event_is_linear_not_a_window_rescan(monkeypatch):
    """#10: the old scan called `_is_num` ~n x lookback times (147k per ticker
    in the review's profile); one pass calls it a bounded number of times per
    bar. 652 bars x 252 lookback, the alert lane's window."""
    calls = {"n": 0}
    real = rs._is_num

    def counting(v):
        calls["n"] += 1
        return real(v)

    monkeypatch.setattr(rs, "_is_num", counting)
    series = [100.0 + math.sin(i / 7.0) * 10 + i * 0.01 for i in range(652)]
    rs.rolling_extreme_event(series, 252, high=True)
    assert calls["n"] <= 3 * len(series), calls["n"]


def test_collect_one_joins_each_benchmark_once_and_only_over_the_window(monkeypatch):
    """#5: one RS-line join per benchmark (SPY once, RSP once — not SPY twice),
    and every join is handed the window's benchmark bars, not all 5,000."""
    days = _days(5000, start=dt.date(2006, 1, 1))
    spy = [{"t": d.isoformat(), "c": 400.0 + (i % 9)} for i, d in enumerate(days)]
    rsp = [{"t": d.isoformat(), "c": 150.0 + (i % 5)} for i, d in enumerate(days)]
    win = [{"t": d.isoformat(), "c": 50.0 + (i % 13) * 0.5} for i, d in enumerate(days[-400:])]

    seen = {"rs_line": [], "aligned": []}
    real_line, real_aligned = rs.rs_line, rs.benchmark_closes_aligned

    def line(bars, bench):
        seen["rs_line"].append(len(bench))
        return real_line(bars, bench)

    def aligned(bars, bench):
        seen["aligned"].append(len(bench))
        return real_aligned(bars, bench)

    monkeypatch.setattr(rs, "rs_line", line)
    monkeypatch.setattr(rs, "benchmark_closes_aligned", aligned)
    out = rs_columns.collect_one(win, spy, rsp)
    assert out["mansfield"] is not None and out["rs_benchmark_agree"] is not None
    assert len(seen["rs_line"]) == 2, seen
    assert max(seen["rs_line"] + seen["aligned"]) <= len(win), seen
