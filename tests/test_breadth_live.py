"""The live breadth path must reproduce the collector EXACTLY.

`breadth_collector.py` (uct-intelligence) computes the authoritative daily row
with pandas over a full price frame. `api/services/breadth_live.py` computes the
same numbers from pre-derived levels plus one price per ticker. If those two
ever disagree, the live value is a different metric wearing the same name.

So this file holds a VERBATIM copy of the collector's metric functions and
asserts the live path reproduces them — same counts, same rounding, same
"which names are valid" rule — on frames built to exercise the awkward cases:
short histories, mid-series gaps, zero prices, ties at the threshold.

⚠️ The copies below are the contract. `test_reference_matches_collector_source`
re-reads the real collector when it's on this machine and fails if the two have
drifted, so a change over there can't silently invalidate this whole file.
"""
from __future__ import annotations

import ast
import inspect
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from api.services import breadth_live as bl

# The collector lives in a sibling repo and is NOT deployed with the dashboard,
# so the drift check below runs only where it is checked out.
COLLECTOR = Path(
    os.environ.get("UCT_INTELLIGENCE_PATH", r"C:\Users\Patrick\uct-intelligence")
) / "scripts" / "breadth_collector.py"


# ── Verbatim from uct-intelligence/scripts/breadth_collector.py ──────────────

def pct_above_sma(closes, window):
    ma = closes.rolling(window).mean()
    curr = closes.iloc[-1]
    ma_curr = ma.iloc[-1]
    valid = curr.notna() & ma_curr.notna()
    total = valid.sum()
    if total == 0:
        return None
    above = (curr[valid] > ma_curr[valid]).sum()
    return round(float(above / total * 100), 1)


def pct_above_ema(closes, window):
    ema = closes.ewm(span=window, adjust=False).mean()
    curr = closes.iloc[-1]
    ema_curr = ema.iloc[-1]
    valid = curr.notna() & ema_curr.notna()
    total = valid.sum()
    if total == 0:
        return None
    above = (curr[valid] > ema_curr[valid]).sum()
    return round(float(above / total * 100), 1)


def count_period_return(closes, bars, thresh, direction=1):
    if len(closes) < bars + 5:
        return None
    past = closes.iloc[-(bars + 1)]
    curr = closes.iloc[-1]
    past_safe = past.replace(0, float("nan"))
    ret = (curr - past) / past_safe
    valid = ret.notna()
    if direction == 1:
        return int((ret[valid] >= thresh).sum())
    else:
        return int((ret[valid] <= -thresh).sum())


def count_nd_highs(closes, n):
    n = min(n, len(closes))
    if n < 2:
        return None
    curr = closes.iloc[-1]
    rolling_high = closes.rolling(n, min_periods=n).max().iloc[-1]
    valid = curr.notna() & rolling_high.notna()
    return int((curr[valid] >= rolling_high[valid] * 0.999).sum())


def count_nd_lows(closes, n):
    n = min(n, len(closes))
    if n < 2:
        return None
    curr = closes.iloc[-1]
    rolling_low = closes.rolling(n, min_periods=n).min().iloc[-1]
    valid = curr.notna() & rolling_low.notna()
    return int((curr[valid] <= rolling_low[valid] * 1.001).sum())


def count_near_52w_high(closes, pct=0.05):
    n = min(252, len(closes))
    if n < 20:
        return None
    curr = closes.iloc[-1]
    high_52w = closes.rolling(n, min_periods=n).max().iloc[-1]
    valid = curr.notna() & high_52w.notna() & (high_52w > 0)
    dist = (high_52w[valid] - curr[valid]) / high_52w[valid]
    return int((dist <= pct).sum())


def count_52w_vol_highs(volumes, closes):
    n = min(252, len(volumes))
    if n < 20 or len(closes) < 10:
        return None
    today_vol = volumes.iloc[-1]
    prior_max = volumes.iloc[-n:-1].max()
    sma10 = closes.rolling(10, min_periods=10).mean().iloc[-1]
    curr_close = closes.iloc[-1]
    valid = (today_vol.notna() & prior_max.notna() & (prior_max > 0)
             & sma10.notna() & curr_close.notna())
    vol_hi = today_vol[valid] >= prior_max[valid]
    above_sma = curr_close[valid] > sma10[valid]
    return int((vol_hi & above_sma).sum())


def count_stage(closes, stage):
    if len(closes) < 220:
        return None
    c = closes.iloc[-1]
    sma50 = closes.rolling(50).mean().iloc[-1]
    sma150 = closes.rolling(150).mean().iloc[-1]
    sma200 = closes.rolling(200).mean().iloc[-1]
    sma200_prev = closes.rolling(200).mean().iloc[-22]
    valid = (c.notna() & sma50.notna() & sma150.notna()
             & sma200.notna() & sma200_prev.notna())
    if stage == 2:
        mask = ((c > sma50) & (sma50 > sma150) & (sma150 > sma200)
                & (sma200 >= sma200_prev))
    else:
        mask = ((c < sma50) & (sma50 < sma150) & (sma150 < sma200)
                & (sma200 <= sma200_prev))
    return int(mask[valid].sum())


def adv_decline_count(closes):
    chg = closes.pct_change().iloc[-1]
    valid = chg.notna()
    adv = int((chg[valid] > 0).sum())
    dec = int((chg[valid] < 0).sum())
    return adv - dec


def up_volume_ratio(closes, volumes):
    chg = closes.pct_change().iloc[-1]
    vol = volumes.iloc[-1]
    valid = chg.notna() & vol.notna()
    up_vol = float(vol[valid & (chg > 0)].sum())
    dn_vol = float(vol[valid & (chg < 0)].sum())
    if dn_vol == 0:
        return None
    return round(up_vol / dn_vol, 2)


def mcclellan_oscillator(closes):
    daily_chg = closes.pct_change()
    net_adv = (daily_chg > 0).sum(axis=1).astype(float) - (daily_chg < 0).sum(axis=1).astype(float)
    ema19 = net_adv.ewm(span=19, adjust=False).mean()
    ema39 = net_adv.ewm(span=39, adjust=False).mean()
    osc = ema19 - ema39
    val = osc.iloc[-1]
    return round(float(val), 1) if pd.notna(val) else None


# ── Frame builder ─────────────────────────────────────────────────────────────

def _frame(seed=1, n_tickers=60, n_dates=300, gap_rate=0.0, short_names=0,
           zero_names=0):
    """A closes/volumes frame shaped like the collector's: dates × tickers."""
    rng = np.random.default_rng(seed)
    tickers = [f"T{i:03d}" for i in range(n_tickers)]
    dates = pd.date_range("2025-01-02", periods=n_dates, freq="B")

    steps = rng.normal(0.0005, 0.02, size=(n_dates, n_tickers))
    closes = 50.0 * np.exp(np.cumsum(steps, axis=0))
    volumes = rng.lognormal(13.0, 0.8, size=(n_dates, n_tickers))

    # Names that listed part-way through: NaN before their start.
    for j in range(short_names):
        start = rng.integers(n_dates - 120, n_dates - 30)
        closes[:start, j] = np.nan
        volumes[:start, j] = np.nan

    # Halted / missing sessions scattered through the middle.
    if gap_rate:
        holes = rng.random((n_dates, n_tickers)) < gap_rate
        holes[-1, :] = False          # today always prints
        closes[holes] = np.nan
        volumes[holes] = np.nan

    # A zero close exercises the divide-by-zero guard in period returns.
    for j in range(short_names, short_names + zero_names):
        closes[-2, j] = 0.0

    cdf = pd.DataFrame(closes, index=dates, columns=tickers)
    vdf = pd.DataFrame(volumes, index=dates, columns=tickers)
    return cdf, vdf


def _split(cdf, vdf):
    """(levels, prices, vols) — the live path's view of the same frame."""
    prior_c = cdf.iloc[:-1]
    prior_v = vdf.iloc[:-1]
    tickers = list(cdf.columns)
    levels = bl.build_levels(
        tickers,
        prior_c.to_numpy(dtype=float).T.copy(),
        prior_v.to_numpy(dtype=float).T.copy(),
        as_of_ts=20260804,
    )
    last_c, last_v = cdf.iloc[-1], vdf.iloc[-1]
    prices = {t: float(last_c[t]) for t in tickers if pd.notna(last_c[t]) and last_c[t] > 0}
    vols = {t: float(last_v[t]) for t in tickers if pd.notna(last_v[t]) and last_v[t] > 0}
    return levels, prices, vols


def _reference(cdf, vdf):
    """Every metric, computed the collector's way, on the full frame."""
    return {
        "pct_above_5sma":   pct_above_sma(cdf, 5),
        "pct_above_10sma":  pct_above_sma(cdf, 10),
        "pct_above_20ema":  pct_above_ema(cdf, 20),
        "pct_above_40sma":  pct_above_sma(cdf, 40),
        "pct_above_50sma":  pct_above_sma(cdf, 50),
        "pct_above_100sma": pct_above_sma(cdf, 100),
        "pct_above_200sma": pct_above_sma(cdf, 200),
        "up_4pct_today":      count_period_return(cdf, 1, 0.04, 1),
        "down_4pct_today":    count_period_return(cdf, 1, 0.04, -1),
        "up_20pct_5d":        count_period_return(cdf, 5, 0.20, 1),
        "down_20pct_5d":      count_period_return(cdf, 5, 0.20, -1),
        "up_25pct_quarter":   count_period_return(cdf, 65, 0.25, 1),
        "down_25pct_quarter": count_period_return(cdf, 65, 0.25, -1),
        "up_25pct_month":     count_period_return(cdf, 21, 0.25, 1),
        "down_25pct_month":   count_period_return(cdf, 21, 0.25, -1),
        "up_50pct_month":     count_period_return(cdf, 21, 0.50, 1),
        "down_50pct_month":   count_period_return(cdf, 21, 0.50, -1),
        "magna_up":           count_period_return(cdf, 34, 0.13, 1),
        "magna_down":         count_period_return(cdf, 34, 0.13, -1),
        "new_52w_highs": count_nd_highs(cdf, 252),
        "new_52w_lows":  count_nd_lows(cdf, 252),
        "new_20d_highs": count_nd_highs(cdf, 20),
        "new_20d_lows":  count_nd_lows(cdf, 20),
        "new_ath":       count_nd_highs(cdf, min(252, len(cdf) - 1)),
        "near_52w_high": count_near_52w_high(cdf, pct=0.05),
        "hvc_52w":       count_52w_vol_highs(vdf, cdf),
        "stage2_count":  count_stage(cdf, 2),
        "stage4_count":  count_stage(cdf, 4),
        "adv_decline":   adv_decline_count(cdf),
        "up_vol_ratio":  up_volume_ratio(cdf, vdf),
        "mcclellan_osc": mcclellan_oscillator(cdf),
    }


# ── The proof ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_live_matches_collector_on_clean_frames(seed):
    cdf, vdf = _frame(seed=seed)
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    for key, expected in _reference(cdf, vdf).items():
        assert live[key] == expected, f"{key}: live={live[key]} collector={expected}"


@pytest.mark.parametrize("seed", [11, 12, 13])
def test_live_matches_collector_with_gaps_and_short_histories(seed):
    """Halted sessions and part-way listings are where a naive port drifts."""
    cdf, vdf = _frame(seed=seed, gap_rate=0.02, short_names=8)
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    for key, expected in _reference(cdf, vdf).items():
        assert live[key] == expected, f"{key}: live={live[key]} collector={expected}"


def test_a_zero_prior_close_is_excluded_rather_than_counted_as_infinite_gain():
    """The one place the live path deliberately does NOT mirror the collector.

    `pct_change()` on a prior close of 0 yields +inf, which the collector's
    `adv_decline_count` counts as an advancer. Its own `count_period_return`
    guards the same case with `replace(0, nan)`. A zero close is bad data, not
    a gain — so the live path excludes it, and this test pins both behaviours
    so the difference stays a decision instead of becoming a surprise.
    """
    cdf, vdf = _frame(seed=91, n_tickers=20, zero_names=3)
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)

    assert live["_zero_prev_close"] == 3
    assert adv_decline_count(cdf) - live["adv_decline"] == 3     # the inf names
    # Every other metric still matches exactly.
    ref = _reference(cdf, vdf)
    for key in ("pct_above_50sma", "new_52w_highs", "stage2_count", "up_4pct_today"):
        assert live[key] == ref[key]


def test_universe_count_is_names_that_printed_today():
    cdf, vdf = _frame(seed=7, n_tickers=50)
    cdf.iloc[-1, 0:4] = np.nan          # four names with no print today
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    assert live["universe_count"] == 46
    assert live["universe_count"] == int(cdf.iloc[-1].notna().sum())


def test_a_name_at_a_new_high_is_counted_and_one_a_hair_below_is_not():
    """The 0.999 fudge is the definition, not a rounding artefact."""
    cdf, vdf = _frame(seed=21, n_tickers=6)
    peak = float(cdf.iloc[:-1, 0].max())
    cdf.iloc[-1, 0] = peak * 0.9995      # inside the fudge → counts
    cdf.iloc[-1, 1] = peak * 0.98        # outside → does not
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    assert live["new_52w_highs"] == count_nd_highs(cdf, 252)
    assert live["new_52w_highs"] >= 1


# ── Exact boundaries ─────────────────────────────────────────────────────────
# A random walk never lands exactly on a threshold, so the frames above can't
# tell `>` from `>=` — mutating either direction left them green. These build
# the tie deliberately. Every one was added because a mutation survived.

def _flat(n_tickers=4, n_dates=300, price=100.0, volume=1000.0):
    tickers = [f"T{i:03d}" for i in range(n_tickers)]
    dates = pd.date_range("2025-01-02", periods=n_dates, freq="B")
    cdf = pd.DataFrame(price, index=dates, columns=tickers, dtype=float)
    vdf = pd.DataFrame(volume, index=dates, columns=tickers, dtype=float)
    return cdf, vdf


def test_a_price_sitting_exactly_on_its_moving_average_is_not_above_it():
    cdf, vdf = _flat()
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    ref = _reference(cdf, vdf)
    for key in ("pct_above_5sma", "pct_above_10sma", "pct_above_20ema",
                "pct_above_40sma", "pct_above_50sma", "pct_above_100sma",
                "pct_above_200sma"):
        assert live[key] == ref[key] == 0.0, key


def test_a_move_of_exactly_the_threshold_counts():
    """`>= thresh`, not `>`. 4.0/100.0 is the same double as the literal 0.04."""
    assert 4.0 / 100.0 == 0.04
    cdf, vdf = _flat(n_tickers=4)
    cdf.iloc[-1, 0] = 104.0      # exactly +4%
    cdf.iloc[-1, 1] = 103.9      # just short
    cdf.iloc[-1, 2] = 96.0       # exactly −4%
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    assert live["up_4pct_today"] == count_period_return(cdf, 1, 0.04, 1) == 1
    assert live["down_4pct_today"] == count_period_return(cdf, 1, 0.04, -1) == 1


def test_the_52_week_window_spans_the_full_252_bars():
    """A high sitting on the OLDEST bar of the window still suppresses a new high."""
    cdf, vdf = _flat(n_tickers=3, n_dates=300)
    oldest_in_window = len(cdf) - 1 - 251        # prior[-251]
    cdf.iloc[oldest_in_window, 0] = 200.0        # only inside a 251-bar window
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    assert live["new_52w_highs"] == count_nd_highs(cdf, 252) == 2   # T000 excluded


def test_todays_volume_equal_to_the_prior_52w_max_is_a_volume_high():
    cdf, vdf = _flat(n_tickers=5)
    cdf.iloc[:, :] = np.linspace(80, 120, len(cdf))[:, None]   # rising → above 10SMA
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    assert live["hvc_52w"] == count_52w_vol_highs(vdf, cdf) == 5


def test_a_flat_200ma_still_qualifies_as_stage_2():
    """`sma200 >= sma200_prev` — flat counts as trending, and the tie is exact.

    Built so the 200-bar window today and the one 21 sessions back hold the
    same total: the newest 21 bars (2730) are mirrored by the 21 bars that drop
    out of the window. Every value is an integer, so the sums are exact.
    """
    cdf, vdf = _flat(n_tickers=2, n_dates=300)
    ramp = list(range(120, 140)) + [140]                 # prior[-20:] + today
    for k, v in enumerate(ramp[:-1]):
        cdf.iloc[-21 + k, 0] = float(v)
    cdf.iloc[-1, 0] = float(ramp[-1])
    for k in range(21):                                  # positions -220..-200
        cdf.iloc[len(cdf) - 1 - 220 + k, 0] = 130.0

    levels, prices, vols = _split(cdf, vdf)
    sma200 = (levels["sma_prev_sum"][200][0] + 140.0) / 200
    assert sma200 == levels["sma200_back21"][0]          # the tie is genuinely exact

    live = bl.compute_metrics(levels, prices, vols)
    assert live["stage2_count"] == count_stage(cdf, 2) == 1


def test_an_index_sitting_on_its_moving_average_is_not_above_it():
    flat = [100.0] * 260
    idx = bl.build_index_levels({"SPY": flat[:-1]})
    out = bl.compute_index_metrics(idx, {"SPY": flat[-1]})
    for w in (10, 20, 50, 200):
        assert out[f"spy_above_{w}sma"] == 0


def test_no_prices_yields_empty_universe_not_a_crash():
    cdf, vdf = _frame(seed=41, n_tickers=10)
    levels, _, _ = _split(cdf, vdf)
    live = bl.compute_metrics(levels, {}, {})
    assert live["universe_count"] == 0
    assert live["pct_above_50sma"] is None
    assert live["new_52w_highs"] == 0
    assert live["adv_decline"] == 0


def test_short_frame_returns_none_for_metrics_that_need_history():
    """A metric without the bars to support it must read as absent, not zero."""
    cdf, vdf = _frame(seed=51, n_tickers=10, n_dates=60)
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    assert live["stage2_count"] is None
    assert live["stage4_count"] is None
    assert live["up_25pct_quarter"] is None       # needs 65 + 5 bars
    assert live["pct_above_50sma"] is not None


def test_index_ma_flags_match_the_collectors_rolling_means():
    closes = list(np.linspace(400, 520, 260))
    idx = bl.build_index_levels({"SPY": closes[:-1], "QQQ": closes[:-1]})
    out = bl.compute_index_metrics(idx, {"SPY": closes[-1], "QQQ": closes[-1]})
    s = pd.Series(closes)
    for w in (10, 20, 50, 200):
        expect = 1 if closes[-1] > float(s.rolling(w).mean().iloc[-1]) else 0
        assert out[f"spy_above_{w}sma"] == expect
    assert out["spy_close"] == round(closes[-1], 2)


# ── Anchoring ────────────────────────────────────────────────────────────────
# bars.db is split-adjusted; the collector's history is dividend-adjusted, so
# levels can't match but the day-over-day CHANGE can. The published number is
# `stored(prior) + [live(now) − live(prior)]`.

def test_long_lookback_metrics_are_anchorable():
    """Regression rail. An earlier `"_above_" in key` rule meant to catch
    `spy_above_50sma` also swallowed `pct_above_50sma` — silently disabling the
    correction on exactly the metrics that need it most."""
    for key in ("pct_above_40sma", "pct_above_50sma", "pct_above_100sma",
                "pct_above_200sma", "stage2_count", "stage4_count",
                "near_52w_high", "new_52w_highs", "new_ath",
                "up_25pct_quarter", "magna_up", "up_50pct_month"):
        assert bl._anchorable(key), key


def test_short_lookback_metrics_are_left_raw():
    """A metric built from one day-over-day change carries no accumulated
    dividend bias, so anchoring it subtracts noise. Measured raw -> anchored:
    up_4pct_today 0.93% -> 2.18%, adv_decline 0.97% -> 2.02%."""
    for key in ("up_4pct_today", "down_4pct_today", "adv_decline",
                "up_vol_ratio", "mcclellan_osc", "hvc_52w",
                "pct_above_5sma", "pct_above_10sma", "pct_above_20ema",
                "up_20pct_5d", "new_20d_highs", "new_20d_lows"):
        assert not bl._anchorable(key), key


def test_every_published_metric_has_a_declared_lookback():
    """An unlisted metric silently defaults to "never anchor". That is the safe
    direction, but it should be a decision — so adding one must fail here."""
    cdf, vdf = _frame(seed=77, n_tickers=8)
    levels, prices, vols = _split(cdf, vdf)
    emitted = bl.compute_metrics(levels, prices, vols)
    missing = [k for k in emitted
               if not k.startswith("_") and k != "universe_count"
               and k not in bl._METRIC_LOOKBACK]
    assert not missing, f"declare a lookback for: {missing}"


def test_index_readings_and_coverage_are_never_anchored():
    for key in ("spy_close", "qqq_close", "spy_above_50sma", "qqq_above_200sma",
                "universe_count", "_zero_prev_close"):
        assert not bl._anchorable(key), key


def test_coverage_guard_is_two_sided():
    """Seeing 1.4% MORE names than the collector breaks a count anchor exactly
    as seeing 1.4% fewer does — a one-sided floor waved 2026-07-28 through."""
    assert bl._coverage_ok(1.0)
    assert bl._coverage_ok(0.981) and bl._coverage_ok(1.014)   # measured: helps
    assert not bl._coverage_ok(0.95)
    assert not bl._coverage_ok(1.05)
    assert not bl._coverage_ok(0.7182)                          # measured: hurts
    assert not bl._coverage_ok(None)
    # Symmetric: a surplus is as disqualifying as a shortfall.
    assert bl._coverage_ok(1 - bl.MAX_COVERAGE_DRIFT) == bl._coverage_ok(1 + bl.MAX_COVERAGE_DRIFT)


@pytest.fixture
def basis(monkeypatch):
    """Build a basis through the REAL `anchor_basis`, with only its two data
    sources stubbed. Re-deriving the guard inside the test instead would mean
    testing the test — a mutation to `anchor_basis` survived until this existed.
    """
    from api.services import breadth_monitor as bm

    def make(stored, live_prev):
        stored = {"date": "2026-08-04", **stored}
        monkeypatch.setattr(bm, "get_history", lambda days=90: [stored])
        monkeypatch.setattr(bl, "_bars_conn", lambda: None)
        monkeypatch.setattr(bl, "_metrics_at_close",
                            lambda conn, tickers, ts: dict(live_prev))
        return bl.anchor_basis(20260804, ["A", "B"], force=True)

    return make


def test_anchoring_subtracts_the_measured_offset(basis):
    stored = {"universe_count": 1000, "pct_above_200sma": 65.9, "new_52w_highs": 154}
    prev = {"universe_count": 1000, "pct_above_200sma": 62.1, "new_52w_highs": 149}
    today = {"universe_count": 1000, "pct_above_200sma": 63.4, "new_52w_highs": 160}
    out = bl.apply_anchor(today, basis(stored, prev))
    # live moved +1.3 off a base the collector had 3.8 higher → 65.9 + 1.3
    assert out["pct_above_200sma"] == 67.2
    assert out["new_52w_highs"] == 165


def test_anchoring_is_a_no_op_when_there_is_no_offset(basis):
    """Where the two bases agree the correction must vanish, not add noise."""
    stored = {"universe_count": 900, "pct_above_50sma": 61.0, "stage2_count": 700}
    today = {"universe_count": 900, "pct_above_50sma": 58.4, "stage2_count": 688}
    out = bl.apply_anchor(today, basis(stored, dict(stored)))
    assert out["pct_above_50sma"] == 58.4
    assert out["stage2_count"] == 688


def test_counts_are_withheld_when_bars_saw_a_different_population(basis):
    """A gap that is really a headcount difference must not be subtracted.

    Percentages are coverage-invariant so they still anchor; counts scale with
    how many names you saw, so anchoring them would invent a number.
    """
    stored = {"universe_count": 3722, "pct_above_200sma": 65.9, "stage2_count": 1210}
    prev = {"universe_count": 3573, "pct_above_200sma": 62.1, "stage2_count": 1186}
    b = basis(stored, prev)          # 96% — past the count bound, inside the ratio one
    assert b["counts_anchored"] is False
    assert b["ratios_anchored"] is True
    assert "stage2_count" in b["withheld"]
    assert "pct_above_200sma" in b["shift"]

    today = {"universe_count": 3575, "pct_above_200sma": 63.0, "stage2_count": 1190}
    out = bl.apply_anchor(today, b)
    assert out["stage2_count"] == 1190            # untouched, honestly raw
    assert out["pct_above_200sma"] == 66.8        # 65.9 + 0.9


def test_a_badly_covered_day_anchors_nothing_at_all(basis):
    """At 72% coverage even a percentage goes the wrong way when anchored
    (2026-07-27: pct_above_200sma +2.4 anchored vs −1.7 raw). The names bars.db
    carries are the actively-viewed ones — bigger, more liquid, likelier above
    their averages — so a missing quarter of the market is not a random sample.
    """
    stored = {"universe_count": 3722, "pct_above_200sma": 62.8, "stage2_count": 1210}
    prev = {"universe_count": 2674, "pct_above_200sma": 61.1, "stage2_count": 900}
    b = basis(stored, prev)
    assert b["ratios_anchored"] is False and b["counts_anchored"] is False
    assert b["shift"] == {}
    today = {"universe_count": 2680, "pct_above_200sma": 61.5, "stage2_count": 905}
    assert bl.apply_anchor(today, b) == today


def test_full_coverage_lets_counts_anchor(basis):
    stored = {"universe_count": 3722, "stage2_count": 1210}
    prev = {"universe_count": 3710, "stage2_count": 1190}     # 99.7%
    b = basis(stored, prev)
    assert b["counts_anchored"] is True
    assert b["withheld"] == []
    assert bl.apply_anchor({"universe_count": 3710, "stage2_count": 1200},
                           b)["stage2_count"] == 1220


def test_a_missing_basis_leaves_the_numbers_untouched():
    today = {"pct_above_50sma": 58.4, "new_52w_highs": 12}
    assert bl.apply_anchor(today, None) == today


def test_anchored_values_keep_the_stored_precision():
    assert bl._round_like("pct_above_50sma", 63.6499) == 63.6
    assert bl._round_like("mcclellan_osc", -10.14) == -10.1
    assert bl._round_like("up_vol_ratio", 2.4551) == 2.46
    assert bl._round_like("new_52w_highs", 122.6) == 123
    assert isinstance(bl._round_like("stage2_count", 700.4), int)


def test_accuracy_grades_come_from_measurement_and_gate_accordingly():
    """Each metric is graded to the envelope it was MEASURED at, so the gate
    stays a regression detector rather than one loose bar everything clears."""
    assert bl.accuracy_of("pct_above_50sma") == "point"
    assert bl._tolerance_for("pct_above_50sma") == {"abs": 1.0}
    assert bl.accuracy_of("spy_close") == "exact"
    assert bl._tolerance_for("spy_above_50sma") == {"abs": 0}
    assert bl.accuracy_of("adv_decline") == "tight"
    assert bl.accuracy_of("stage2_count") == "close"
    assert bl.accuracy_of("new_52w_highs") == "approximate"
    # strictly widening: exact <= tight <= close <= approximate
    rels = [bl.ACCURACY_TIERS[t].get("rel", 0)
            for t in ("exact", "tight", "close", "approximate")]
    assert rels == sorted(rels) and rels[0] < rels[-1]


def test_an_ungraded_metric_defaults_to_the_loosest_grade():
    """The safe direction: a new metric is never silently claimed as precise."""
    assert bl.accuracy_of("something_new_we_added") == "approximate"


def test_every_published_metric_carries_an_accuracy_grade():
    cdf, vdf = _frame(seed=79, n_tickers=8)
    levels, prices, vols = _split(cdf, vdf)
    emitted = [k for k in bl.compute_metrics(levels, prices, vols)
               if not k.startswith("_")]
    ungraded = [k for k in emitted if k not in bl._ACCURACY]
    assert not ungraded, f"grade these against a real session first: {ungraded}"


MIRRORED = (
    "pct_above_sma", "pct_above_ema", "count_period_return", "count_nd_highs",
    "count_nd_lows", "count_near_52w_high", "count_52w_vol_highs", "count_stage",
    "adv_decline_count", "up_volume_ratio", "mcclellan_oscillator",
)


def _body(source: str, fn: str):
    """A function's body as an AST dump — signature annotations and formatting
    stripped, so only a real logic change registers."""
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.FunctionDef) and node.name == fn:
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body = body[1:]                       # drop the docstring
            args = [a.arg for a in node.args.args]
            return args, ast.dump(ast.Module(body=body, type_ignores=[]))
    return None, None


@pytest.mark.skipif(not COLLECTOR.exists(),
                    reason="breadth_collector.py not on this machine")
@pytest.mark.parametrize("fn", MIRRORED)
def test_reference_matches_collector_source(fn):
    """The copies above ARE the contract. If the collector changes and this
    fails, the live path needs re-deriving — not this assertion relaxing."""
    theirs_args, theirs = _body(COLLECTOR.read_text(encoding="utf-8"), fn)
    mine_args, mine = _body(inspect.getsource(__import__(__name__, fromlist=["x"])), fn)
    assert theirs is not None, f"{fn} no longer exists in breadth_collector.py"
    assert mine_args == theirs_args, f"{fn} signature drifted: {mine_args} vs {theirs_args}"
    assert mine == theirs, (
        f"{fn} has drifted from breadth_collector.py — re-derive the live path "
        f"in api/services/breadth_live.py before touching this test"
    )


def test_carried_fields_are_never_claimed_as_live():
    """Every field the collector supplies but we cannot derive must be named."""
    cdf, vdf = _frame(seed=61, n_tickers=12)
    levels, prices, vols = _split(cdf, vdf)
    live = bl.compute_metrics(levels, prices, vols)
    for key in bl.NOT_LIVE:
        assert key not in live, f"{key} is listed NOT_LIVE but compute_metrics emits it"
