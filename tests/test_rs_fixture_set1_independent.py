"""Fixture set 1, the INDEPENDENT half (unit VA3, 2026-11-07): the RS line, the
RS new high, Mansfield RS and the IBD-style RS Rating recomputed FROM THE SPEC,
not from our code, and compared against production on a deterministic
synthetic universe.

Spec: docs/superpowers/specs/2026-11-05-uct-relative-strength-indicator-design.md
§7 (the exact definitions) items 1, 5, 13 and 17; §12.1 fixture set 1 (public-
method parity). Nothing here imports or copies a production helper: the
reference maths below is numpy / pandas written from the §7 sentences, quoted
above each function. Production is only CALLED, at the two public entry points
the screener, the chart and the evidence job read
(`relative_strength.compute_phase1_columns`, `compute_mansfield_columns`) and
the rating job's pure ranking (`rs_history.compute_ratings`).

Where §7 leaves a choice open, the reference states the choice it made:

* Percentile (§7.17 says "percentile across the cap universe"): the mid-rank
  percentile, ``pandas.Series.rank(method="average", pct=True)``, i.e. rank /
  count with tied values sharing the mean of their positions. The universe
  carries one exact tie on purpose so a different tie rule would show.
* ETF interpolation (§7.17 "ETFs receive a rating by interpolation against the
  stock distribution"): ``numpy.interp`` of the ETF's score on the sorted
  (stock score, stock percentile) pairs, clamped at both ends.
* Mansfield's SMA (§7.13 with §7 item 2's gap rule): over the VALID ratio
  values in order, a gap bar stays NaN and does not reset the average.

The universe: 60 stocks and 3 ETFs, 320 sessions, seeded; one stock with 15
sessions missing (a gap in its own bars), one stock with 150 bars (short
history: two of the four rating terms), one with 50 bars (under the required
63-day term: no rating), two stocks with identical closes (a tie), and a
benchmark missing one session (every stock's ratio is NaN there).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from api.services import relative_strength as rs
from api.services.screener import rs_history

SEED = 20261107
N_SESSIONS = 320
N_STOCKS = 60
ETFS = ("XLK", "XLF", "XLE")
GAP_NAME, SHORT_NAME, TOO_SHORT_NAME = "S003", "S004", "S005"
TIE_A, TIE_B = "S010", "S011"
RATIO_TOL = 1e-9
#: Early enough that a full 252-bar window AFTER it exists (bars 283..319), so the
#: RS new-high comparison is not vacuous; every window holding it must be NaN.
BENCH_GAP_INDEX = 30


# ── the universe ─────────────────────────────────────────────────────────────

def _sessions(n: int) -> list:
    return [int(d.strftime("%Y%m%d")) for d in pd.bdate_range("2025-01-02", periods=n)]


def _walk(rng, n: int, start: float, drift: float, vol: float) -> np.ndarray:
    return start * np.exp(np.cumsum(rng.normal(drift, vol, n)))


def _universe():
    rng = np.random.default_rng(SEED)
    ts = _sessions(N_SESSIONS)
    bench_close = _walk(rng, N_SESSIONS, 500.0, 0.0003, 0.010)
    missing_bench = ts[BENCH_GAP_INDEX]
    bench = [{"t": t, "c": float(c)} for t, c in zip(ts, bench_close) if t != missing_bench]
    stocks = {}
    for k in range(N_STOCKS):
        name = f"S{k:03d}"
        closes = _walk(rng, N_SESSIONS, float(rng.uniform(10, 300)), float(rng.normal(0.0005, 0.001)),
                       float(rng.uniform(0.01, 0.04)))
        stocks[name] = [{"t": t, "c": float(c)} for t, c in zip(ts, closes)]
    stocks[TIE_B] = [dict(b) for b in stocks[TIE_A]]
    gap = set(ts[120:135])
    stocks[GAP_NAME] = [b for b in stocks[GAP_NAME] if b["t"] not in gap]
    stocks[SHORT_NAME] = stocks[SHORT_NAME][-150:]
    stocks[TOO_SHORT_NAME] = stocks[TOO_SHORT_NAME][-50:]
    etfs = {}
    for name in ETFS:
        closes = _walk(rng, N_SESSIONS, 100.0, 0.0004, 0.012)
        etfs[name] = [{"t": t, "c": float(c)} for t, c in zip(ts, closes)]
    return ts, bench, stocks, etfs


UNIVERSE = _universe()


def _arr(column) -> np.ndarray:
    return np.array([np.nan if v is None else float(v) for v in column], dtype=float)


def _assert_series_equal(name, ours, ref, tol=RATIO_TOL):
    ours, ref = _arr(ours), np.asarray(ref, dtype=float)
    assert ours.shape == ref.shape, (name, ours.shape, ref.shape)
    nan_ours, nan_ref = np.isnan(ours), np.isnan(ref)
    bad_nan = np.flatnonzero(nan_ours != nan_ref)
    assert bad_nan.size == 0, f"{name}: NaN pattern differs at bars {bad_nan[:10].tolist()}"
    ok = ~nan_ref
    diff = np.abs(ours[ok] - ref[ok])
    worst = float(diff.max()) if diff.size else 0.0
    assert worst <= tol * max(1.0, float(np.abs(ref[ok]).max()) if diff.size else 1.0), (name, worst)


# ── the reference maths, from §7 ─────────────────────────────────────────────

def ref_rs_line(bars, bench) -> np.ndarray:
    """§7.1: "rs = C / B", "C[t], B[t] joined by bar time"; "Missing close -> NaN
    everywhere derived"."""
    stock = pd.Series({b["t"]: b["c"] for b in bars}, dtype=float)
    b = pd.Series({x["t"]: x["c"] for x in bench}, dtype=float).reindex(stock.index)
    return (stock / b).to_numpy()


def ref_rs_new_high(rs_line: np.ndarray, lookback: int) -> np.ndarray:
    """§7.5: "rs[t] >= max(rs[t-N ... t-1]), all N present, ties count, NaN before
    N bars or when the window has a gap" (and NaN where rs[t] itself is missing)."""
    out = np.full(rs_line.shape, np.nan)
    for t in range(lookback, len(rs_line)):
        window = rs_line[t - lookback:t]
        if np.isnan(rs_line[t]) or np.isnan(window).any():
            continue
        out[t] = 1.0 if rs_line[t] >= window.max() else 0.0
    return out


def ref_mansfield(rs_line: np.ndarray, n: int) -> np.ndarray:
    """§7.13: "RP = rs x 100; MRS = ((RP / SMA(RP, n)) - 1) x 100", the SMA over the
    valid bars in order (§7.2's gap rule)."""
    rp = pd.Series(rs_line * 100.0)
    valid = rp.dropna()
    sma = valid.rolling(n).mean().reindex(rp.index)
    return ((rp / sma - 1.0) * 100.0).to_numpy()


WEIGHTS = ((63, 0.40), (126, 0.20), (189, 0.20), (252, 0.20))


def ref_ibd_score(closes) -> float | None:
    """§7.17: "0.40*C/C-63 + 0.20*C/C-126 + 0.20*C/C-189 + 0.20*C/C-252, missing terms
    dropped and renormalised, 63-day term required"."""
    c = np.asarray(closes, dtype=float)
    terms = [(c[-1] / c[-1 - k], w) for k, w in WEIGHTS if len(c) > k]
    if not terms or len(c) <= 63:
        return None
    return sum(r * w for r, w in terms) / sum(w for _r, w in terms)


def ref_ratings(closes_by_ticker: dict, etfs) -> dict:
    """§7.17: "percentile across the cap universe excluding ETFs -> max(1,
    ceil(pct x 99)); ETFs receive a rating by interpolation against the stock
    distribution" (choices stated in the module header)."""
    scores = {t: ref_ibd_score(c) for t, c in closes_by_ticker.items()}
    stock_scores = pd.Series({t: s for t, s in scores.items() if s is not None and t not in etfs}, dtype=float)
    pct = stock_scores.rank(method="average", pct=True)
    order = np.argsort(stock_scores.to_numpy(), kind="mergesort")
    xs, ps = stock_scores.to_numpy()[order], pct.to_numpy()[order]
    out = {}
    for t, s in scores.items():
        if s is None:
            out[t] = None
            continue
        p = float(pct[t]) if t in pct.index else float(np.interp(s, xs, ps))
        out[t] = min(99, max(1, math.ceil(p * 99)))
    return out, scores


# ── the comparisons ──────────────────────────────────────────────────────────

def test_the_universe_is_the_one_the_module_header_describes():
    ts, bench, stocks, etfs = UNIVERSE
    assert len(stocks) == N_STOCKS >= 50 and len(ts) == N_SESSIONS >= 300 and len(etfs) == 3
    assert len(stocks[GAP_NAME]) == N_SESSIONS - 15 and len(stocks[SHORT_NAME]) == 150
    assert len(stocks[TOO_SHORT_NAME]) == 50 and len(bench) == N_SESSIONS - 1
    assert [b["c"] for b in stocks[TIE_A]] == [b["c"] for b in stocks[TIE_B]]


@pytest.mark.parametrize("lookback", [252, 63])
@pytest.mark.parametrize("name", sorted(UNIVERSE[2]))
def test_the_rs_line_and_the_rs_new_high_match_the_spec(name, lookback):
    _ts, bench, stocks, _etfs = UNIVERSE
    bars = stocks[name]
    cols = rs.compute_phase1_columns(bars, bench, {"lookback": lookback})
    line = ref_rs_line(bars, bench)
    _assert_series_equal(f"{name} rsLine", cols["rsLine"], line)
    _assert_series_equal(f"{name} rsNH({lookback})", cols["rsNH"], ref_rs_new_high(line, lookback), tol=0.0)


@pytest.mark.parametrize("lookback", [252, 63])
def test_the_new_high_comparison_is_not_vacuous(lookback):
    """A reference that is NaN everywhere would agree with anything."""
    _ts, bench, stocks, _etfs = UNIVERSE
    judged = events = 0
    for bars in stocks.values():
        r = ref_rs_new_high(ref_rs_line(bars, bench), lookback)
        judged += int(np.sum(~np.isnan(r)))
        events += int(np.nansum(r))
    assert judged > 1000 and events > 20, (judged, events)


@pytest.mark.parametrize("length", [200, 52])
@pytest.mark.parametrize("name", sorted(UNIVERSE[2]))
def test_mansfield_rs_matches_the_spec(name, length):
    _ts, bench, stocks, _etfs = UNIVERSE
    bars = stocks[name]
    got = rs.compute_mansfield_columns(bars, bench, length)["mansfield"]
    _assert_series_equal(f"{name} mansfield({length})", got, ref_mansfield(ref_rs_line(bars, bench), length))


def test_the_gap_bar_is_nan_and_mansfield_does_not_reset_across_it():
    ts, bench, stocks, _etfs = UNIVERSE
    bars = stocks["S020"]
    i = [b["t"] for b in bars].index(ts[BENCH_GAP_INDEX])      # the session the benchmark lacks
    got = _arr(rs.compute_mansfield_columns(bars, bench, 20)["mansfield"])
    assert np.isnan(got[i]) and not np.isnan(got[i - 1]) and not np.isnan(got[i + 1])


def test_the_ibd_style_rating_matches_the_spec_exactly():
    _ts, _bench, stocks, etfs = UNIVERSE
    closes = {t: [b["c"] for b in bars] for t, bars in {**stocks, **etfs}.items()}
    want, scores = ref_ratings(closes, set(ETFS))
    got = rs_history.compute_ratings(closes, ETFS)
    disagree = {t: (got[t]["ibd"], want[t]) for t in closes if got[t]["ibd"] != want[t]}
    assert not disagree, f"rating disagreements (ours, reference): {disagree}"
    for t, s in scores.items():
        if s is None:
            assert got[t]["score"] is None, t
        else:
            assert got[t]["score"] == pytest.approx(s, abs=5e-7 + RATIO_TOL), t   # production rounds to 6 dp
    # the named cases behave as the spec says
    assert want[TOO_SHORT_NAME] is None and got[TOO_SHORT_NAME]["ibd"] is None, "no 63-day term, no rating"
    assert scores[SHORT_NAME] == pytest.approx(
        (0.40 * closes[SHORT_NAME][-1] / closes[SHORT_NAME][-64] + 0.20 * closes[SHORT_NAME][-1] / closes[SHORT_NAME][-127])
        / 0.60, abs=1e-12), "two of four terms, renormalised"
    assert got[TIE_A]["ibd"] == got[TIE_B]["ibd"] == want[TIE_A], "a tie shares one rating"
    assert all(got[t]["ibd"] is not None for t in ETFS), "ETFs are rated by interpolation"
    ranked = [want[t] for t in stocks if want[t] is not None]
    assert max(ranked) == 99 and min(ranked) >= 1


def test_an_etf_never_moves_a_stocks_rating():
    _ts, _bench, stocks, etfs = UNIVERSE
    closes = {t: [b["c"] for b in bars] for t, bars in stocks.items()}
    alone = rs_history.compute_ratings(closes, ETFS)
    closes.update({t: [b["c"] for b in bars] for t, bars in etfs.items()})
    together = rs_history.compute_ratings(closes, ETFS)
    assert all(alone[t]["ibd"] == together[t]["ibd"] for t in stocks)
