"""api/services/breadth_live.py — breadth, computed intraday.

`breadth_collector.py` runs once at 4:15 PM ET and writes the authoritative
daily row. This module answers the same questions *during* the session.

WHY IT IS CHEAP
    The collector spends ~54s downloading a year of daily bars per ticker to
    derive moving averages, 52-week levels and stage classification. Those
    change once a day. So the work splits in two:

      reference levels   from bars.db, ONE windowed query   ~3s, once per day
      live comparison    one full-market snapshot           ~0.6s, per refresh

    A refresh is a snapshot plus arithmetic over pre-computed arrays.

THE PART THAT MUST BE EXACT
    A live number that doesn't reconcile with the EOD row is a different metric
    wearing the same name. Every definition below is mirrored from the
    collector verbatim, including its rounding, its `>=` vs `>`, and its
    "which names count as valid" rule. Where a definition is a rolling window
    that INCLUDES today, the level stores the prior n-1 bars and today's price
    is compared against it — algebraically identical, see `_is_new_high`.

    `reconcile()` is the proof: replay a past session using only prior-day
    levels and that day's actual closes, then diff against what the collector
    stored. Nothing goes on screen until it passes.

THE PRICE BASIS — why the live LEVEL can't match, and what to do about it
    The collector downloads with yfinance `auto_adjust=True`, so its history is
    DIVIDEND-adjusted; bars.db (Massive/Polygon) is split-adjusted only.
    Measured on 2026-07-09 over 31 names: a payer's close 200 sessions back is
    ~3% lower on the collector's side (median ratio 0.9702), a non-payer's is
    identical (1.0000). So every long moving average sits lower over there and
    more names read as "above" it — a 3.8-point gap on `pct_above_200sma`,
    shrinking to 1.1 at the 5-day window exactly as accumulated dividends predict.

    That bias only moves on ex-dividend dates, so it is near-constant across a
    session and cancels in the day-over-day CHANGE. Measured: median error on
    `pct_above_*` falls from 2.00 points on the level to 0.20 on the delta. So
    the published number is ANCHORED —

        anchored(now) = stored(prior close) + [ live(now) − live(prior close) ]

    — which reads as a continuation of the row the user saw yesterday rather
    than a second opinion about it. Where there is no bias the anchor is a
    no-op, so this is safe in both regimes. `basis_shift` reports
    `live(prior) − stored(prior)` per metric on every response, so the
    divergence is a published number instead of a hidden one.

    2026-08-06 — the bias is now CORRECTED AT SOURCE, not just anchored over.
    The anchor fixes an aggregate level; it cannot fix WHICH names sit on the
    wrong side of a threshold, so the long-lookback counts stayed biased in a
    single direction. Measured across 10 reconciled sessions, raw delta and the
    sign of that delta:

        new_52w_highs  -9.9  0+/10-      stage2_count   -57.6  0+/10-
        new_ath       -10.2  0+/10-      stage4_count   +38.1  10+/0-
        new_52w_lows   +5.4  10+/0-      near_52w_high  -52.5  0+/10-
        up_25pct_quarter -17.8 0+/10-

    Seventy comparisons, zero exceptions — not noise. `breadth_dividends.py`
    rebuilds the frame on the collector's dividend-adjusted basis before levels
    are built (validated against yfinance itself: 14 tickers, <=0.019% mean
    deviation, non-payers exactly 1.0000). Gated by `BREADTH_DIVIDEND_BASIS`,
    which ships OFF; `reconcile(..., dividend_basis=)` measures both arms.

STORAGE
    This module NEVER writes `breadth_snapshots`. The collector remains its
    only writer and the daily series stays authoritative.
"""

from __future__ import annotations

import math
import os
import threading
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import numpy as np

_ET = ZoneInfo("America/New_York")

# How much daily history to load. Needs to cover the longest lookback any
# metric uses: SMA200 shifted back 21 bars (221 bars) and the 252-bar 52-week
# window, plus enough runway for the McClellan EMAs (span 39) to settle.
_FRAME_SESSIONS = 380
_LOAD_CALENDAR_DAYS = 600      # ~380 sessions with room for holidays

# Windows whose SMA some metric needs. 150 is stage-only; the rest are the
# pct_above_* family plus the 10SMA that gates the volume-high metric.
_SMA_WINDOWS = (5, 10, 40, 50, 100, 150, 200)

# `bars` argument to count_period_return, keyed by the metric pair it feeds.
_PERIOD_RETURNS = (
    # (up_key,             down_key,               bars, threshold)
    ("up_4pct_today",      "down_4pct_today",         1, 0.04),
    ("up_20pct_5d",        "down_20pct_5d",           5, 0.20),
    ("up_25pct_quarter",   "down_25pct_quarter",     65, 0.25),
    ("up_25pct_month",     "down_25pct_month",       21, 0.25),
    ("up_50pct_month",     "down_50pct_month",       21, 0.50),
    ("magna_up",           "magna_down",             34, 0.13),
)
_BACK_BARS = sorted({b for _, _, b, _ in _PERIOD_RETURNS})

_EMA20_ALPHA = 2.0 / (20 + 1)
_MCC_ALPHA_19 = 2.0 / (19 + 1)
_MCC_ALPHA_39 = 2.0 / (39 + 1)

# Metrics the daily row carries that CANNOT be derived intraday. Surfaced with
# their own date, never as a live value. Naming them here rather than letting
# them silently drop is deliberate: a missing field reads as "we didn't compute
# it", which is exactly the truth.
NOT_LIVE = (
    "cboe_putcall",      # EOD print
    "cnn_fear_greed",    # daily
    "aaii_bulls", "aaii_bears", "aaii_neutral", "aaii_spread", "aaii_survey_date",
    "naaim", "naaim_date",
    "uct_exposure",      # pushed by the morning wire
    "atr_ext_7",         # needs intraday high/low for ATR
    "vix", "vxn", "avg_10d_vix", "avg_10d_vxn", "vxmt", "vix_term_structure",
    "sp500_close", "rsp_close", "rsp_spy_ratio", "iwm_qqq_ratio",
    "spy_dist_days", "qqq_dist_days", "manual_ftd",
)

# Index rows the Monitor's MA-stack columns read. SPY/QQQ are quoted in the
# full-market snapshot, so these ARE live — they just need their own history
# because the equity universe excludes ETFs.
_INDEX_SYMS = ("SPY", "QQQ")
_INDEX_MA = (10, 20, 50, 200)

# Metrics whose live value is real but built on a PARTIAL session — they only
# grow as the day fills in. Correct at any instant, not comparable to an EOD
# print until the close.
PARTIAL_SESSION = ("hvc_52w", "up_vol_ratio")

# Fields that are exact live readings, so anchoring them would add error rather
# than remove it: SPY/QQQ's own price and MA flags, and the count of names that
# printed — a fact about coverage, and the diagnostic that explains a large
# basis shift. Never smooth it.
#
# NOTE the index flags are matched on their `spy_`/`qqq_` prefix, NOT on a bare
# "_above_", which would also swallow the whole `pct_above_*sma` family — the
# metrics that need anchoring most.
def _is_index_field(key: str) -> bool:
    return key.startswith(("spy_", "qqq_"))


# How many completed sessions each metric's LEVEL reaches back through. The
# dividend-adjustment bias accumulates over that window, so this is what decides
# whether anchoring removes a real offset or merely injects yesterday's noise:
# a metric built from ONE day-over-day change carries almost no bias (dividends
# touch a name only on its ex-date), and subtracting a shift that is pure noise
# makes it worse.
#
# Measured over four fully-covered sessions replayed against the stored rows,
# mean |error| as a % of the stored value, raw -> anchored:
#
#   pct_above_200sma  2.73 -> 0.43     |  pct_above_5sma   0.15 -> 0.30
#   stage4_count      9.34 -> 1.58     |  up_4pct_today    0.93 -> 2.18
#   up_50pct_month   10.86 -> 2.27     |  down_4pct_today  0.73 -> 3.36
#   near_52w_high     7.39 -> 1.99     |  adv_decline      0.97 -> 2.02
#   up_25pct_quarter  3.84 -> 1.06     |  up_vol_ratio     1.71 -> 6.21
#
# Every metric at >= 21 sessions improved; every metric below it got worse.
# The threshold follows the mechanism, and the data agreed — it was not fitted.
_ANCHOR_MIN_LOOKBACK = 21

_METRIC_LOOKBACK = {
    "pct_above_5sma": 5, "pct_above_10sma": 10, "pct_above_20ema": 20,
    "pct_above_40sma": 40, "pct_above_50sma": 50,
    "pct_above_100sma": 100, "pct_above_200sma": 200,
    "up_4pct_today": 1, "down_4pct_today": 1,
    "up_20pct_5d": 5, "down_20pct_5d": 5,
    "up_25pct_month": 21, "down_25pct_month": 21,
    "up_50pct_month": 21, "down_50pct_month": 21,
    "magna_up": 34, "magna_down": 34,
    "up_25pct_quarter": 65, "down_25pct_quarter": 65,
    "new_20d_highs": 20, "new_20d_lows": 20,
    "new_52w_highs": 252, "new_52w_lows": 252, "new_ath": 252,
    "near_52w_high": 252,
    "stage2_count": 200, "stage4_count": 200,
    "hvc_52w": 0,            # a VOLUME extreme; volume carries no dividend adj.
    "adv_decline": 1, "up_vol_ratio": 1, "mcclellan_osc": 1,
}


def _anchorable(key: str) -> bool:
    if key.startswith("_") or key == "universe_count" or _is_index_field(key):
        return False
    # The anchor exists to subtract the dividend-basis offset. Once that offset
    # is corrected at source there is nothing left to subtract, and anchoring
    # removes yesterday's NOISE instead of a real bias — measured across 10
    # reconciled sessions, mean failures per session:
    #
    #                       raw      anchored
    #   basis off           8.1        1.9      <- anchor is load-bearing
    #   basis on            1.3        6.8      <- anchor now INJECTS error
    #
    # e.g. stage2_count raw 8.9 vs anchored 50.9. This is the same trap the
    # project already recorded once: RE-DERIVE A THRESHOLD AFTER CHANGING WHAT
    # IT GATES. `_ANCHOR_MIN_LOOKBACK` was fitted under the uncorrected basis.
    if dividend_basis_enabled():
        return False
    return _METRIC_LOOKBACK.get(key, 0) >= _ANCHOR_MIN_LOOKBACK


# A percentage is coverage-invariant: measure 70% of the universe or all of it
# and the answer is the same. A COUNT is not — it scales with how many names you
# saw. So a count may only be anchored when both sides counted effectively the
# same population; otherwise the "basis shift" is really a headcount difference
# and subtracting it invents a number.
#
# TWO-SIDED: seeing 1.4% MORE names than the collector breaks a count anchor
# exactly as seeing 1.4% fewer does, and a one-sided floor waved 2026-07-28
# through.
#
# The BOUND follows from what the anchor trades. Anchoring a count injects an
# error of roughly the coverage drift, and removes a price-basis bias of ~6-8%
# on the long-window counts. So it is worth doing while drift stays well under
# that bias, and stops being worth doing as they converge. Measured, mean
# |error| over the anchored metrics, raw -> anchored:
#
#   coverage 0.9812   5.44% -> 4.23%   helps
#   coverage 1.0140   6.26% -> 4.73%   helps
#   coverage 0.7182   the percentages invert sign; clearly past the line
#
# 3% sits comfortably above the 0.7-2% drift normal operation produces and
# comfortably below the bias being removed.
#
# (An earlier 0.5% came from reading 2026-07-31 as "anchoring made it worse".
# That reading was taken BEFORE the >=21-session lookback rule stopped
# anchoring short-window metrics, which is what had actually gone wrong there.)
MAX_COVERAGE_DRIFT = 0.03

# A percentage survives a small headcount difference where a count cannot — but
# NOT an arbitrary one. On 2026-07-27 bars.db held 72% of the universe and even
# `pct_above_200sma` went the wrong way when anchored (+2.4 vs −1.7 raw),
# because the names bars.db carries are the actively-viewed ones: bigger, more
# liquid, likelier to be above their averages. A missing quarter of the market
# is not a random sample. So percentages get a looser bound, not no bound.
MAX_RATIO_COVERAGE_DRIFT = 0.05

# Below this the live read itself is measuring a different market. Published as
# `degraded` rather than silently served.
MIN_LIVE_COVERAGE = 0.95


def _coverage_ok(coverage: Optional[float]) -> bool:
    return coverage is not None and abs(coverage - 1.0) <= MAX_COVERAGE_DRIFT


def _ratio_coverage_ok(coverage: Optional[float]) -> bool:
    return coverage is not None and abs(coverage - 1.0) <= MAX_RATIO_COVERAGE_DRIFT


def _is_ratio_metric(key: str) -> bool:
    return key.startswith("pct_above_")


# Each metric's published precision, so an anchored value is shaped like the
# stored one instead of trailing float noise.
def _round_like(key: str, value: float):
    if key.startswith("pct_above_") or key == "mcclellan_osc":
        return round(value, 1)
    if key == "up_vol_ratio":
        return round(value, 2)
    return int(round(value))

# How accurate each metric actually IS against the authoritative row, graded
# from replaying real sessions rather than from hope. Two jobs:
#
#   1. the reconciliation gate asserts against the metric's measured envelope,
#      so it stays a REGRESSION detector instead of an accuracy claim that a
#      single loose global tolerance would let anything through;
#   2. `accuracy` ships in the payload, so a surface can render a number that
#      reconciles to a point differently from one that reconciles to ~8%.
#
# `exact`/`tight` are the numbers to read closely. `approximate` are small
# counts sitting on a hard threshold against a 252-day extreme, where the
# per-name dividend offset moves individual names across the line and no
# aggregate anchor can recover them. They are still directionally right; they
# are not a number to trade a single name off.
ACCURACY_TIERS: dict[str, dict] = {
    "exact":       {"abs": 0, "rel": 0.002},
    "tight":       {"abs": 3, "rel": 0.03},
    "point":       {"abs": 1.0},                 # percentage POINTS
    "close":       {"abs": 3, "rel": 0.05},
    "approximate": {"abs": 3, "rel": 0.10},
}

# Measured over four fully-covered sessions (mean |error| as % of stored, after
# the anchor where one applies); the tier is set from the WORST session seen.
_ACCURACY: dict[str, str] = {
    # 0.33-0.72% mean, <=1.0 point worst
    "pct_above_5sma": "point", "pct_above_10sma": "point",
    "pct_above_20ema": "point", "pct_above_40sma": "point",
    "pct_above_50sma": "point", "pct_above_100sma": "point",
    "pct_above_200sma": "point",
    # identical to the stored value on every session replayed
    "spy_close": "exact", "qqq_close": "exact",
    # 0.6-1.7% mean
    "adv_decline": "tight", "up_4pct_today": "tight", "down_4pct_today": "tight",
    "up_20pct_5d": "tight", "down_20pct_5d": "tight",
    "up_25pct_month": "tight", "down_25pct_month": "tight",
    "magna_up": "tight", "magna_down": "tight",
    "new_20d_highs": "tight", "new_20d_lows": "tight",
    "universe_count": "tight",
    # 1.6-3.4% — threshold counts on long-window levels
    "stage2_count": "close", "stage4_count": "close",
    "up_25pct_quarter": "close", "down_50pct_month": "close",
    # RE-GRADED 2026-08-06 from 10 sessions on the dividend-corrected basis.
    # Graded off each metric's WORST observed session, not its mean: a 10-session
    # mean would have promoted eight of these, and a grade a metric fails on a
    # bad day is a false promise. near_52w_high 0.9% mean / 2.9% worst;
    # new_52w_highs 1.3/2.6; down_25pct_quarter 1.9/2.8; up_50pct_month 0.0/0.0.
    "near_52w_high": "tight", "down_25pct_quarter": "tight",
    "up_50pct_month": "tight", "new_52w_highs": "tight",
    "new_ath": "close",                       # 1.5% mean but 4.3% worst
    # Still wide on their worst session even though the mean improved sharply:
    # new_52w_lows 2.9% mean / 30.0% worst (a 1-name move on a base of ~3),
    # mcclellan_osc 1.8/10.6 (an oscillator crossing zero has no stable scale).
    "new_52w_lows": "approximate", "hvc_52w": "approximate",
    # ratios with their own natural scale
    "up_vol_ratio": "close", "mcclellan_osc": "approximate",
}


def accuracy_of(key: str) -> str:
    if _is_index_field(key):
        return "exact"          # SPY/QQQ price and flags, straight from bars.db
    return _ACCURACY.get(key, "approximate")


def _tolerance_for(key: str) -> dict:
    if _is_index_field(key) and key.endswith("sma"):
        return {"abs": 0}       # a boolean has no near-miss
    return ACCURACY_TIERS[accuracy_of(key)]


# ── Session clock ─────────────────────────────────────────────────────────────

def _now_et() -> datetime:
    return datetime.now(_ET)


def _ts_int(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _iso(ts: int) -> str:
    return f"{ts // 10000:04d}-{ts // 100 % 100:02d}-{ts % 100:02d}"


# ── Loading the frame ─────────────────────────────────────────────────────────

def _bars_conn():
    from api.services import bars_sqlite
    return bars_sqlite._conn()


def last_completed_session(conn=None, now: Optional[datetime] = None) -> Optional[int]:
    """Newest daily bar STRICTLY BEFORE today, as a YYYYMMDD int.

    Read off SPY, which trades every session, so weekends and holidays are
    handled by the data rather than by a calendar we'd have to maintain.

    Strictly-before is the load-bearing part: bars.db carries a DEVELOPING
    daily bar during the session. Including it would make "yesterday's close"
    today's live price — every SMA shifted, every change ~0%, and the whole
    read quietly wrong in a way that still looks plausible.
    """
    c = conn or _bars_conn()
    today = _ts_int((now or _now_et()).date())
    row = c.execute(
        "SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ?",
        (today,),
    ).fetchone()
    return int(row[0]) if row and row[0] else None


def _session_dates(conn, end_ts: int, start_ts: int, limit: int = _FRAME_SESSIONS) -> list[int]:
    rows = conn.execute(
        "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts BETWEEN ? AND ? "
        "ORDER BY ts DESC LIMIT ?",
        (start_ts, end_ts, limit),
    ).fetchall()
    return sorted(int(r[0]) for r in rows)


def _load_index_series(conn, end_ts: int, start_ts: int) -> dict[str, list[float]]:
    """SPY/QQQ closes through `end_ts`, oldest first.

    The equity universe excludes ETFs, so these need their own read. The
    collector `.dropna()`s each index series before its rolling means, which is
    what a per-ticker query gives us naturally.
    """
    out: dict[str, list[float]] = {}
    for sym in _INDEX_SYMS:
        rows = conn.execute(
            "SELECT ts, c FROM ohlcv WHERE tf='D' AND ticker=? AND ts BETWEEN ? AND ? "
            "ORDER BY ts",
            (sym, start_ts, end_ts),
        ).fetchall()
        out[sym] = [float(r[1]) for r in rows if r[1] is not None]
    return out


def _load_frame(conn, tickers: list[str], dates: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """(closes, volumes) as float64 [n_tickers × n_dates], NaN where no bar.

    NaN-for-missing mirrors the collector's union-index DataFrame, so the
    "which names are valid for this metric" rule lands the same way.
    """
    pos = {ts: i for i, ts in enumerate(dates)}
    tix = {t: i for i, t in enumerate(tickers)}
    n, m = len(tickers), len(dates)
    closes = np.full((n, m), np.nan, dtype=np.float64)
    volumes = np.full((n, m), np.nan, dtype=np.float64)

    lo, hi = dates[0], dates[-1]
    CHUNK = 800     # stays well under SQLITE_MAX_VARIABLE_NUMBER on any build
    for i in range(0, len(tickers), CHUNK):
        chunk = tickers[i:i + CHUNK]
        qm = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT ticker, ts, c, v FROM ohlcv "
            f"WHERE tf='D' AND ts BETWEEN ? AND ? AND ticker IN ({qm})",
            [lo, hi, *chunk],
        ).fetchall()
        for tk, ts, cl, vol in rows:
            r = tix.get(tk)
            j = pos.get(int(ts))
            if r is None or j is None:
                continue
            if cl is not None:
                closes[r, j] = cl
            if vol is not None:
                volumes[r, j] = vol
    return closes, volumes


# ── Level construction (pure, given a frame) ──────────────────────────────────

def _rolling_tail(arr: np.ndarray, width: int, reducer) -> tuple[np.ndarray, np.ndarray]:
    """(value, complete) over the LAST `width` columns.

    `complete` marks rows where every one of those columns is present — the
    equivalent of pandas' `min_periods=window`, which is what makes a
    short-history name drop out of a metric instead of skewing it.
    """
    if width <= 0 or width > arr.shape[1]:
        n = arr.shape[0]
        return np.full(n, np.nan), np.zeros(n, dtype=bool)
    tail = arr[:, -width:]
    present = ~np.isnan(tail)
    complete = present.all(axis=1)
    with np.errstate(invalid="ignore"):
        val = reducer(tail, axis=1)
    return val, complete


def _nan_reduce(fn):
    """np.nanmax/nanmin without the all-NaN-slice RuntimeWarning."""
    fill = -np.inf if fn is np.max else np.inf

    def inner(a, axis=1):
        allnan = np.isnan(a).all(axis=axis)
        out = fn(np.where(np.isnan(a), fill, a), axis=axis)
        return np.where(allnan, np.nan, out)
    return inner


_tail_max = _nan_reduce(np.max)
_tail_min = _nan_reduce(np.min)


def _ewm_last(arr: np.ndarray, alpha: float) -> np.ndarray:
    """Final value of pandas' `ewm(adjust=False, ignore_na=False)` per row.

    Seeded on each row's first observation. A NaN still decays the weight on
    history (`old_wt *= 1-α` on every step, observation or not) and the update
    re-normalises — that is what `ignore_na=False` means, and skipping it would
    quietly diverge from the collector for any name with a gap.
    """
    n, m = arr.shape
    out = np.full(n, np.nan)
    old_wt = np.ones(n)
    for j in range(m):
        col = arr[:, j]
        ok = ~np.isnan(col)
        seed = ok & np.isnan(out)
        out[seed] = col[seed]
        old_wt[seed] = 1.0
        step = ~np.isnan(out) & ~seed
        old_wt[step] *= (1.0 - alpha)
        upd = step & ok
        out[upd] = (old_wt[upd] * out[upd] + alpha * col[upd]) / (old_wt[upd] + alpha)
        old_wt[upd] += alpha
    return out


def _net_advance_series(closes: np.ndarray) -> np.ndarray:
    """Daily (advancers − decliners) across the frame, mirroring the collector.

    `closes.pct_change()` leaves the first row NaN, so its net advance is 0.
    """
    prev = closes[:, :-1]
    curr = closes[:, 1:]
    with np.errstate(invalid="ignore", divide="ignore"):
        chg = np.where((prev != 0) & ~np.isnan(prev) & ~np.isnan(curr),
                       curr - prev, np.nan)
    adv = (chg > 0).sum(axis=0).astype(float)
    dec = (chg < 0).sum(axis=0).astype(float)
    return np.concatenate([[0.0], adv - dec])


def build_levels(tickers: list[str], closes: np.ndarray, volumes: np.ndarray,
                 as_of_ts: int) -> dict:
    """Everything a live refresh needs, derived once from completed sessions."""
    n_dates = closes.shape[1]
    # Window sizes the collector derives from its frame length. It downloads
    # one calendar year (~251 rows) so its 52-week window is 251 and its
    # "all-time" high is 250; ours is the canonical 252 for both. At most a
    # one-bar difference in a 252-bar extreme.
    n52 = min(252, n_dates + 1)
    n20 = min(20, n_dates + 1)
    nath = min(252, n_dates)

    lv: dict = {
        "as_of_ts": as_of_ts,
        "tickers": list(tickers),
        "n_dates": n_dates,
        "n52": n52, "n20": n20, "nath": nath,
        "built_at": _now_et().isoformat(timespec="seconds"),
    }

    lv["prev_close"] = closes[:, -1].copy()

    # SMA: today's SMA(w) is (sum of the prior w−1 closes + today) / w.
    sma_sum, sma_ok = {}, {}
    for w in _SMA_WINDOWS:
        tail = closes[:, -(w - 1):] if w > 1 else closes[:, :0]
        present = ~np.isnan(tail)
        sma_ok[w] = present.all(axis=1) if tail.shape[1] else np.ones(len(tickers), bool)
        sma_sum[w] = np.nansum(tail, axis=1)
    lv["sma_prev_sum"], lv["sma_ok"] = sma_sum, sma_ok

    # EMA20: curr > EMA20_today  ⟺  curr > EMA20_yesterday (the α cancels), so
    # the prior EMA is the whole level.
    lv["ema20_prev"] = _ewm_last(closes, _EMA20_ALPHA)

    lv["back"] = {b: (closes[:, -b].copy() if b <= n_dates
                      else np.full(len(tickers), np.nan))
                  for b in _BACK_BARS}

    lv["max52"], lv["max52_ok"] = _rolling_tail(closes, n52 - 1, _tail_max)
    lv["min52"], lv["min52_ok"] = _rolling_tail(closes, n52 - 1, _tail_min)
    lv["max20"], lv["max20_ok"] = _rolling_tail(closes, n20 - 1, _tail_max)
    lv["min20"], lv["min20_ok"] = _rolling_tail(closes, n20 - 1, _tail_min)
    lv["maxath"], lv["maxath_ok"] = _rolling_tail(closes, nath - 1, _tail_max)

    # SMA200 as it stood 21 completed sessions ago — the collector's
    # `rolling(200).mean().iloc[-22]` on a frame whose last row is today.
    if n_dates >= 220:
        win = closes[:, -220:-20]
        ok = (~np.isnan(win)).all(axis=1)
        lv["sma200_back21"] = np.where(ok, np.nansum(win, axis=1) / 200.0, np.nan)
    else:
        lv["sma200_back21"] = np.full(len(tickers), np.nan)

    # 52-week volume high compares today against the PRIOR n−1 sessions.
    vmax, _ = _rolling_tail(volumes, n52 - 1, _tail_max)
    lv["vol_max52"] = vmax

    net_adv = _net_advance_series(closes)
    e19 = e39 = None
    for v in net_adv:
        e19 = v if e19 is None else _MCC_ALPHA_19 * v + (1 - _MCC_ALPHA_19) * e19
        e39 = v if e39 is None else _MCC_ALPHA_39 * v + (1 - _MCC_ALPHA_39) * e39
    lv["mcc_ema19"], lv["mcc_ema39"] = e19, e39

    return lv


def build_index_levels(series: dict[str, list[float]]) -> dict:
    """Prior-close SMA sums for SPY/QQQ, so their MA-stack row goes live too."""
    out: dict = {}
    for sym, closes in series.items():
        if not closes:
            continue
        entry: dict = {"prev_close": closes[-1]}
        for w in _INDEX_MA:
            entry[f"sum{w}"] = sum(closes[-(w - 1):]) if len(closes) >= w - 1 else None
        out[sym] = entry
    return out


def compute_index_metrics(index_levels: dict, prices: dict[str, float]) -> dict:
    """`spy_close`/`qqq_close` + the four above-MA flags, mirroring the collector."""
    m: dict = {}
    for sym in _INDEX_SYMS:
        key = sym.lower()
        px = prices.get(sym)
        lv = index_levels.get(sym)
        if px is None or px <= 0 or not lv:
            continue
        m[f"{key}_close"] = round(float(px), 2)
        for w in _INDEX_MA:
            s = lv.get(f"sum{w}")
            if s is None:
                continue
            m[f"{key}_above_{w}sma"] = 1 if px > (s + px) / w else 0
    return m


# ── Metric computation (pure, given levels + prices) ──────────────────────────

def _pct(above: np.ndarray, valid: np.ndarray) -> Optional[float]:
    total = int(valid.sum())
    if total == 0:
        return None
    return round(float((above & valid).sum() / total * 100), 1)


# Metrics whose cell opens a drill list. Mirrors the `drillKey` set the Monitor
# declares, MINUS anything in NOT_LIVE: a carried number's names belong to the
# session it came from, not to today.
DRILLABLE = frozenset({
    "universe_count",
    "up_4pct_today", "down_4pct_today",
    "up_20pct_5d", "down_20pct_5d",
    "up_25pct_quarter", "down_25pct_quarter",
    "up_25pct_month", "down_25pct_month",
    "up_50pct_month", "down_50pct_month",
    "magna_up", "magna_down",
    "stage2_count", "stage4_count",
    "new_52w_highs", "new_52w_lows",
    "new_20d_highs", "new_20d_lows",
    "new_ath", "hvc_52w",
})


def compute_metrics(levels: dict, prices: dict[str, float],
                    volumes: Optional[dict[str, float]] = None,
                    members: Optional[dict] = None) -> dict:
    """Breadth for one instant: `prices` is today's price per ticker.

    Every definition mirrors `breadth_collector`. Where the collector's rolling
    window includes today, the algebraically identical comparison against the
    prior window is used — see the new-high block below for the reduction.
    """
    tickers = levels["tickers"]
    n = len(tickers)
    px = np.full(n, np.nan)
    for i, t in enumerate(tickers):
        v = prices.get(t)
        if v is not None and v > 0:
            px[i] = v
    have = ~np.isnan(px)

    vol = np.full(n, np.nan)
    if volumes:
        for i, t in enumerate(tickers):
            v = volumes.get(t)
            if v is not None and v > 0:
                vol[i] = v

    # A drill list MUST come off the same mask as its count. Deriving it a
    # second way lets the two drift the moment a definition moves, and the
    # drift is silent: the cell says 47 and the modal lists 45.
    _tk = np.asarray(tickers)

    def _keep(key: str, mask) -> None:
        if members is not None and key in DRILLABLE:
            members[key] = _tk[mask].tolist()

    m: dict = {}
    m["universe_count"] = int(have.sum())
    _keep("universe_count", have)

    # ── pct above moving averages ────────────────────────────────────────────
    for w, key in ((5, "pct_above_5sma"), (10, "pct_above_10sma"),
                   (40, "pct_above_40sma"), (50, "pct_above_50sma"),
                   (100, "pct_above_100sma"), (200, "pct_above_200sma")):
        sma = (levels["sma_prev_sum"][w] + px) / w
        valid = have & levels["sma_ok"][w] & ~np.isnan(sma)
        with np.errstate(invalid="ignore"):
            m[key] = _pct(px > sma, valid)

    ema_prev = levels["ema20_prev"]
    with np.errstate(invalid="ignore"):
        m["pct_above_20ema"] = _pct(px > ema_prev, have & ~np.isnan(ema_prev))

    # `universe_count` is names that PRINTED today; the moving-average family is
    # computed only over names that also have enough history for the window. On
    # a healthy bars.db those are the same population, but a thin or
    # mid-backfill database makes them diverge badly — 2,720 priced against ~100
    # measured — and a consumer reading only `universe_count` would believe the
    # sample was 27x what it was. Publish what was actually measured.
    m["_measured"] = int((have & levels["sma_ok"][200]).sum())

    # ── period returns ───────────────────────────────────────────────────────
    n_frame = levels["n_dates"] + 1     # the collector's frame includes today
    for up_key, dn_key, bars, thresh in _PERIOD_RETURNS:
        if n_frame < bars + 5:
            m[up_key] = m[dn_key] = None
            continue
        past = levels["back"].get(bars)
        if past is None:
            m[up_key] = m[dn_key] = None
            continue
        with np.errstate(invalid="ignore", divide="ignore"):
            safe = np.where(past == 0, np.nan, past)
            ret = (px - past) / safe
        valid = ~np.isnan(ret)
        with np.errstate(invalid="ignore"):
            up_mask = valid & (ret >= thresh)
            dn_mask = valid & (ret <= -thresh)
        m[up_key] = int(up_mask.sum())
        m[dn_key] = int(dn_mask.sum())
        _keep(up_key, up_mask)
        _keep(dn_key, dn_mask)

    # ── new highs / lows ─────────────────────────────────────────────────────
    # rolling(n).max() INCLUDES today, so "curr >= rolling_max * 0.999" reduces
    # exactly to "curr >= prior_max * 0.999": when today IS the max the test is
    # trivially true, and it is also true against the smaller prior max.
    # Each returns the FULL-LENGTH mask, not a count over the compressed
    # `px[valid]` slice — a compressed boolean cannot index the ticker array, so
    # the list and the count would have to be built differently, which is the
    # drift this whole design exists to prevent.
    def _hi(key: str, level_key: str, ok_key: str) -> int:
        lvl, ok = levels[level_key], levels[ok_key]
        valid = have & ok & ~np.isnan(lvl)
        with np.errstate(invalid="ignore"):
            mask = valid & (px >= lvl * 0.999)
        _keep(key, mask)
        return int(mask.sum())

    def _lo(key: str, level_key: str, ok_key: str) -> int:
        lvl, ok = levels[level_key], levels[ok_key]
        valid = have & ok & ~np.isnan(lvl)
        with np.errstate(invalid="ignore"):
            mask = valid & (px <= lvl * 1.001)
        _keep(key, mask)
        return int(mask.sum())

    m["new_52w_highs"] = _hi("new_52w_highs", "max52", "max52_ok")
    m["new_52w_lows"] = _lo("new_52w_lows", "min52", "min52_ok")
    m["new_20d_highs"] = _hi("new_20d_highs", "max20", "max20_ok")
    m["new_20d_lows"] = _lo("new_20d_lows", "min20", "min20_ok")
    m["new_ath"] = _hi("new_ath", "maxath", "maxath_ok")

    # near_52w_high: distance from the 52-week high, which includes today.
    hi52, ok52 = levels["max52"], levels["max52_ok"]
    with np.errstate(invalid="ignore"):
        high = np.maximum(hi52, px)
        valid = have & ok52 & ~np.isnan(high) & (high > 0)
        dist = np.where(valid, (high - px) / np.where(high == 0, np.nan, high), np.nan)
    m["near_52w_high"] = (int((dist[valid] <= 0.05).sum())
                          if levels["n52"] >= 20 else None)

    # ── 52-week volume high + above 10SMA (partial intraday volume) ──────────
    if volumes:
        vmax = levels["vol_max52"]
        sma10 = (levels["sma_prev_sum"][10] + px) / 10
        valid = (have & ~np.isnan(vol) & ~np.isnan(vmax) & (vmax > 0)
                 & levels["sma_ok"][10] & ~np.isnan(sma10))
        with np.errstate(invalid="ignore"):
            hvc_mask = (vol >= vmax) & (px > sma10) & valid
        m["hvc_52w"] = int(hvc_mask.sum())
        _keep("hvc_52w", hvc_mask)
    else:
        m["hvc_52w"] = None

    # ── stage 2 / stage 4 ────────────────────────────────────────────────────
    if levels["n_dates"] + 1 >= 220:
        s50 = (levels["sma_prev_sum"][50] + px) / 50
        s150 = (levels["sma_prev_sum"][150] + px) / 150
        s200 = (levels["sma_prev_sum"][200] + px) / 200
        s200p = levels["sma200_back21"]
        valid = (have & levels["sma_ok"][50] & levels["sma_ok"][150]
                 & levels["sma_ok"][200] & ~np.isnan(s200p))
        with np.errstate(invalid="ignore"):
            s2_mask = ((px > s50) & (s50 > s150) & (s150 > s200)
                       & (s200 >= s200p) & valid)
            s4_mask = ((px < s50) & (s50 < s150) & (s150 < s200)
                       & (s200 <= s200p) & valid)
        m["stage2_count"] = int(s2_mask.sum())
        m["stage4_count"] = int(s4_mask.sum())
        _keep("stage2_count", s2_mask)
        _keep("stage4_count", s4_mask)
    else:
        m["stage2_count"] = m["stage4_count"] = None

    # ── advance/decline, volume, McClellan ───────────────────────────────────
    # ONE deliberate deviation from the collector: a prior close of exactly 0.
    # Its `pct_change()` yields +inf there and counts the name as an advancer;
    # its own `count_period_return` guards the same case with `replace(0, nan)`.
    # A zero prior close is bad data, not a gain, so it is excluded here — the
    # collector's more careful function agrees. Pinned by
    # `test_a_zero_prior_close_is_excluded_rather_than_counted_as_infinite_gain`.
    # Real feeds don't print zero closes; if one ever does it shows up in
    # `zero_prev_close` rather than silently inflating advancers.
    prev = levels["prev_close"]
    with np.errstate(invalid="ignore", divide="ignore"):
        base = np.where((prev == 0) | np.isnan(prev), np.nan, prev)
        chg = (px - base) / base
    m["_zero_prev_close"] = int((have & (prev == 0)).sum())
    chg_valid = ~np.isnan(chg)
    adv = int((chg[chg_valid] > 0).sum())
    dec = int((chg[chg_valid] < 0).sum())
    m["adv_decline"] = adv - dec

    if volumes:
        vv = chg_valid & ~np.isnan(vol)
        up_vol = float(vol[vv & (chg > 0)].sum())
        dn_vol = float(vol[vv & (chg < 0)].sum())
        m["up_vol_ratio"] = round(up_vol / dn_vol, 2) if dn_vol else None
    else:
        m["up_vol_ratio"] = None

    e19, e39 = levels.get("mcc_ema19"), levels.get("mcc_ema39")
    if e19 is None or e39 is None:
        m["mcclellan_osc"] = None
    else:
        net = float(adv - dec)
        t19 = _MCC_ALPHA_19 * net + (1 - _MCC_ALPHA_19) * e19
        t39 = _MCC_ALPHA_39 * net + (1 - _MCC_ALPHA_39) * e39
        m["mcclellan_osc"] = round(t19 - t39, 1)

    return m


# ── Universe + cached levels ──────────────────────────────────────────────────

_levels_lock = threading.Lock()
_levels_cache: dict = {}       # {"key": (as_of_ts, universe_date), "levels": {...}}
# Building levels reads ~1M bars and takes seconds. The web pod is ONE process
# with ONE bounded threadpool, so a post-deploy herd must NOT each build their
# own: the first caller builds while the rest WAIT here and then find the cache
# populated. Same shape as the /api/live-prices herd-collapse valve.
_levels_build_lock = threading.Lock()


def universe(snapshot_date: Optional[str] = None) -> tuple[list[str], Optional[str]]:
    """(tickers, snapshot_date) — the SAME names the EOD row measured.

    Taken from the newest stored snapshot's `universe_list` rather than from
    cap_universe.json, so a live read and the row it will be compared against
    cover exactly one population. A different universe is a different metric.
    """
    from api.services import breadth_monitor as bm
    d = snapshot_date
    if d is None:
        hist = bm.get_history(1)
        if not hist:
            return [], None
        d = hist[0].get("date")
    items = bm.get_drill_list(d, "universe_list") or []
    tickers = sorted({str(i.get("t")).upper() for i in items
                      if isinstance(i, dict) and i.get("t")})
    return tickers, d


def dividend_basis_enabled() -> bool:
    """Ships DARK — an explicit "1" turns it on.

    Inverted relative to `BREADTH_LIVE_ENABLED` on purpose: this one rewrites
    the numbers the page already shows, so the deploy must be a no-op and the
    change must be a deliberate flip, made only after the A/B below is run
    against production data.
    """
    return os.environ.get("BREADTH_DIVIDEND_BASIS", "0") == "1"


def _apply_dividend_basis(tickers: list[str], dates: list[int],
                          closes: np.ndarray, measured_ts: int,
                          override: Optional[bool] = None) -> np.ndarray:
    """Put the history frame on the collector's DIVIDEND-adjusted basis.

    The 4:15 collector reads yfinance `auto_adjust=True`; `bars.db` is
    split-only, which is right for charts and wrong for comparing today's price
    to a 252-day-old level. Measured across 10 reconciled sessions, that basis
    gap was not noise — every long-lookback metric missed in the SAME direction
    10 times out of 10 (highs/stage2/near-high under, lows/stage4 over).

    Fails OPEN: any problem returns the unadjusted frame, which is exactly
    today's shipped behaviour. A dividend store that is missing, stale or
    half-swept must degrade to the old numbers, never to rescaled ones.

    `override` forces the arm regardless of the flag, so `reconcile` can measure
    BOTH bases against the same stored rows in a single deploy. Without that,
    proving this out would mean a redeploy between the two arms and comparing
    numbers gathered from different processes.
    """
    use = dividend_basis_enabled() if override is None else override
    if not use:
        return closes
    try:
        from api.services import breadth_dividends as bdiv
        adj = bdiv.adjust(tickers, dates, closes, as_of=measured_ts)
        if adj.shape != closes.shape:
            return closes
        return adj
    except Exception as e:                       # noqa: BLE001 - never break the read
        print(f"[breadth_live] dividend basis skipped: {type(e).__name__}: {e}")
        return closes


def reference_levels(as_of_ts: Optional[int] = None, force: bool = False) -> Optional[dict]:
    """Levels as of the last completed session, cached until a new one lands."""
    conn = _bars_conn()
    if as_of_ts is None:
        as_of_ts = last_completed_session(conn)
    if not as_of_ts:
        return None

    tickers, uni_date = universe()
    if not tickers:
        return None
    # The measured session, not the frame's end. It joins the cache key because
    # a holiday or weekend holds `as_of_ts` still while the day moves, and the
    # dividend anchor follows the day (see `_apply_dividend_basis`).
    measured_ts = _ts_int(_now_et().date())
    key = (as_of_ts, uni_date, len(tickers), measured_ts)

    with _levels_lock:
        if not force and _levels_cache.get("key") == key:
            return _levels_cache["levels"]

    with _levels_build_lock:
        # Re-check: while we queued, the first caller may have finished.
        with _levels_lock:
            if not force and _levels_cache.get("key") == key:
                return _levels_cache["levels"]

        start = _ts_int(date.fromisoformat(_iso(as_of_ts))
                        - timedelta(days=_LOAD_CALENDAR_DAYS))
        dates = _session_dates(conn, as_of_ts, start)
        if len(dates) < 221:
            return None
        closes, volumes = _load_frame(conn, tickers, dates)
        closes = _apply_dividend_basis(tickers, dates, closes, measured_ts)
        levels = build_levels(tickers, closes, volumes, as_of_ts)
        levels["universe_date"] = uni_date
        levels["index"] = build_index_levels(_load_index_series(conn, as_of_ts, start))
        del closes, volumes

        with _levels_lock:
            _levels_cache["key"] = key
            _levels_cache["levels"] = levels
        return levels


def _metrics_at_close(conn, tickers: list[str], target_ts: int,
                      dividend_basis: Optional[bool] = None) -> Optional[dict]:
    """Run the live method against a COMPLETED session's closes.

    Same code path, known inputs — this is what makes the basis shift
    measurable instead of assumed.
    """
    row = conn.execute(
        "SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ?",
        (target_ts,),
    ).fetchone()
    prior = int(row[0]) if row and row[0] else None
    if not prior:
        return None
    start = _ts_int(date.fromisoformat(_iso(prior)) - timedelta(days=_LOAD_CALENDAR_DAYS))
    dates = _session_dates(conn, prior, start)
    if len(dates) < 221:
        return None
    closes, volumes = _load_frame(conn, tickers, dates)
    closes = _apply_dividend_basis(tickers, dates, closes, target_ts, dividend_basis)
    levels = build_levels(tickers, closes, volumes, prior)
    index_levels = build_index_levels(_load_index_series(conn, prior, start))
    del closes, volumes

    day_c, day_v = _load_frame(conn, tickers, [target_ts])
    prices = {t: float(day_c[i, 0]) for i, t in enumerate(tickers)
              if not math.isnan(day_c[i, 0]) and day_c[i, 0] > 0}
    vols = {t: float(day_v[i, 0]) for i, t in enumerate(tickers)
            if not math.isnan(day_v[i, 0]) and day_v[i, 0] > 0}
    if not prices:
        return None
    idx_c, _ = _load_frame(conn, list(_INDEX_SYMS), [target_ts])
    idx_px = {s: float(idx_c[i, 0]) for i, s in enumerate(_INDEX_SYMS)
              if not math.isnan(idx_c[i, 0]) and idx_c[i, 0] > 0}
    out = compute_metrics(levels, prices, vols)
    out.update(compute_index_metrics(index_levels, idx_px))
    return out


_anchor_lock = threading.Lock()
_anchor_build_lock = threading.Lock()      # same herd guard as the levels build
_anchor_cache: dict = {}


def anchor_basis(as_of_ts: int, tickers: list[str],
                 force: bool = False) -> Optional[dict]:
    """`live − stored` at the last completed close, per metric.

    Cached per session day: it costs a second level build, which is fine once a
    day and unthinkable per refresh.
    """
    key = (as_of_ts, len(tickers))
    with _anchor_lock:
        if not force and _anchor_cache.get("key") == key:
            return _anchor_cache["value"]

    from api.services import breadth_monitor as bm
    iso = _iso(as_of_ts)
    with _anchor_build_lock:
        with _anchor_lock:
            if not force and _anchor_cache.get("key") == key:
                return _anchor_cache["value"]
        stored = next((r for r in bm.get_history(30) if r.get("date") == iso), None)
        if stored is None:
            return None
        live_prev = _metrics_at_close(_bars_conn(), tickers, as_of_ts)
        if live_prev is None:
            return None

    seen, expected = live_prev.get("universe_count"), stored.get("universe_count")
    coverage = (seen / expected) if seen and expected else None
    counts_ok = _coverage_ok(coverage)

    ratios_ok = _ratio_coverage_ok(coverage)
    shift, withheld = {}, []
    for k, lv in live_prev.items():
        sv = stored.get(k)
        if lv is None or sv is None or not _anchorable(k):
            continue
        allowed = ratios_ok if _is_ratio_metric(k) else counts_ok
        if not allowed:
            # bars.db saw a different population than the collector did, so this
            # gap is a headcount difference, not a price-basis offset.
            withheld.append(k)
            continue
        shift[k] = round(float(lv) - float(sv), 3)

    value = {"date": iso, "stored": stored, "live_prev": live_prev, "shift": shift,
             "coverage": round(coverage, 4) if coverage is not None else None,
             "counts_anchored": counts_ok, "ratios_anchored": ratios_ok,
             "withheld": sorted(withheld)}
    with _anchor_lock:
        _anchor_cache["key"] = key
        _anchor_cache["value"] = value
    return value


def apply_anchor(metrics: dict, basis: Optional[dict]) -> dict:
    """`stored(prior) + [live(now) − live(prior)]`, i.e. `live(now) − shift`."""
    if not basis:
        return dict(metrics)
    shift = basis.get("shift") or {}
    out = {}
    for k, v in metrics.items():
        if v is None or k not in shift:
            out[k] = v
            continue
        out[k] = _round_like(k, float(v) - shift[k])
    return out


# ── The live read ─────────────────────────────────────────────────────────────

_live_lock = threading.Lock()
_live_cache: dict = {}
_LIVE_TTL_SECONDS = 55


def _market_open() -> bool:
    try:
        from api.services.bars_liveness import is_market_open
        return bool(is_market_open())
    except Exception:
        n = _now_et()
        return n.weekday() < 5 and 930 <= n.hour * 100 + n.minute < 1600


def _session_started(now: Optional[datetime] = None) -> bool:
    """Has today's session begun — regardless of whether it is still open?

    NOT the same question as `_market_open`. Keying the live read on "open"
    left a hole: at 16:00 the provisional row disappeared and the collector's
    authoritative row does not land until ~16:30, so the day's number went
    missing for half an hour. The estimate should be REPLACED by the real row,
    never vanish ahead of it.

    Before the open is a different case and is deliberately excluded: most of
    the universe has no pre-market trade, so the snapshot falls back to
    yesterday's close for those names and breadth reads exactly unchanged —
    true, and useless.
    """
    n = now or _now_et()
    return n.weekday() < 5 and (n.hour * 100 + n.minute) >= 930


# A weekday past 09:30 is not necessarily a TRADING day — holidays pass that
# test with a snapshot in which almost nothing has traded. Rather than carry a
# market calendar, ask the tape: on a real session the large majority of the
# universe has volume within minutes of the open.
MIN_TRADED_SHARE = 0.20


def warm() -> dict:
    """Build the day's levels + anchor off the request path.

    Cold, this costs two full-frame reads — seconds of blocking SQLite and
    numpy holding one of the pod's bounded threadpool workers. Doing it on a
    background thread after boot means no user ever pays it, and the herd guard
    above means a burst of first requests waits rather than each rebuilding.
    """
    if not enabled():
        return {"ok": False, "reason": "breadth live disabled"}
    levels = reference_levels()
    if not levels:
        return {"ok": False, "reason": "reference levels unavailable"}
    basis = anchor_basis(levels["as_of_ts"], levels["tickers"])
    return {
        "ok": True,
        "levels_as_of": _iso(levels["as_of_ts"]),
        "universe": len(levels["tickers"]),
        "anchored": bool(basis),
        "coverage": (basis or {}).get("coverage"),
    }


def enabled() -> bool:
    """Kill switch, default ON.

    This is a new live data path in front of ~200 users, and its natural guards
    (`degraded`, `superseded`) only cover the failure modes we anticipated.
    Setting `BREADTH_LIVE_ENABLED=0` withholds every live value across all four
    surfaces without a code change — the same escape hatch STREAM_BARS_ENABLED
    and CATALYST_ENGINE_ENABLED give their features.
    """
    return os.environ.get("BREADTH_LIVE_ENABLED", "1") != "0"


def compute_live(force: bool = False) -> dict:
    """Breadth right now: one snapshot compared against cached levels."""
    if not enabled():
        return {"ok": False, "reason": "breadth live disabled (BREADTH_LIVE_ENABLED=0)"}
    import time as _time
    now = _time.time()
    with _live_lock:
        hit = _live_cache.get("payload")
        if hit and not force and now - _live_cache.get("at", 0) < _LIVE_TTL_SECONDS:
            return hit

    levels = reference_levels()
    if not levels:
        return {"ok": False, "reason": "reference levels unavailable"}

    from api.services.massive import _get_client
    try:
        snap = _get_client().get_full_market_snapshot()
    except Exception as e:
        return {"ok": False, "reason": f"snapshot failed: {e}"}
    if not snap:
        return {"ok": False, "reason": "empty market snapshot"}

    prices = {t: d["last_price"] for t, d in snap.items() if d.get("last_price")}
    vols = {t: d["today_vol"] for t, d in snap.items() if d.get("today_vol")}

    # Share of the BREADTH universe that has actually traded today — the
    # holiday tell, and a cheap read on how far into the session we are.
    universe = set(levels["tickers"])
    traded = sum(1 for t in universe if vols.get(t))
    traded_share = traded / len(universe) if universe else 0.0
    session_live = _session_started() and traded_share >= MIN_TRADED_SHARE

    metrics = compute_metrics(levels, prices, vols)
    metrics.update(compute_index_metrics(levels.get("index") or {}, prices))

    basis = None
    try:
        basis = anchor_basis(levels["as_of_ts"], levels["tickers"])
    except Exception as e:      # an anchor is an improvement, never a dependency
        print(f"[breadth_live] anchor unavailable: {e}")

    et = _now_et()
    payload = {
        "ok": True,
        "provisional": True,
        "as_of": et.isoformat(timespec="seconds"),
        "levels_as_of": _iso(levels["as_of_ts"]),
        "session_date": _iso(_ts_int(et.date())) if session_live else _iso(levels["as_of_ts"]),
        "market_open": _market_open(),
        "session_live": session_live,
        "traded_share": round(traded_share, 4),
        "universe_size": len(levels["tickers"]),
        "universe_date": levels.get("universe_date"),
        "snapshot_size": len(snap),
        # Names that actually carried a full 200-day window into the read —
        # the honest sample size, which `universe_size` is not when bars.db is
        # thin or mid-backfill.
        "measured": metrics.get("_measured"),
        "metrics": apply_anchor(metrics, basis),
        "raw_metrics": metrics,
        "anchored": bool(basis),
        "anchored_to": (basis or {}).get("date"),
        "basis_shift": (basis or {}).get("shift") or {},
        "bars_coverage": (basis or {}).get("coverage"),
        "counts_anchored": (basis or {}).get("counts_anchored"),
        "anchor_withheld": (basis or {}).get("withheld") or [],
        # A live read built on materially less than the universe the daily row
        # measures is a different market, not a fresher view of the same one.
        "degraded": not _ratio_coverage_ok((basis or {}).get("coverage"))
                    if basis else None,
        "accuracy": {k: accuracy_of(k) for k in metrics if not k.startswith("_")},
        "partial_session": list(PARTIAL_SESSION),
        "not_live": list(NOT_LIVE),
    }

    with _live_lock:
        _live_cache["payload"] = payload
        _live_cache["at"] = now
    return payload


# ── The gate ──────────────────────────────────────────────────────────────────

def reconcile(target_iso: str, dividend_basis: Optional[bool] = None) -> dict:
    """Replay the live path for a past session and diff it against the stored row.

    Levels come from sessions strictly before `target_iso` and that day's actual
    closes stand in for the live snapshot — the identical role, a known value.
    So this reports what a 3:59 PM live read would have shown against the
    4:15 PM authoritative row.

    Both forms are graded: `raw` (the direct computation) and `anchored` (what
    the endpoint actually publishes, keyed off the PRIOR session's stored row).
    `passed` follows the anchored one, because that is the number on screen.
    """
    from api.services import breadth_monitor as bm

    target_ts = _ts_int(date.fromisoformat(target_iso))
    conn = _bars_conn()
    row = conn.execute(
        "SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ?",
        (target_ts,),
    ).fetchone()
    prior_ts = int(row[0]) if row and row[0] else None
    if not prior_ts:
        return {"ok": False, "reason": f"no session before {target_iso} in bars.db"}

    tickers, _ = universe(target_iso)
    if not tickers:
        return {"ok": False, "reason": f"no universe_list stored for {target_iso}"}

    stored = next((r for r in bm.get_history(400) if r.get("date") == target_iso), None)
    if stored is None:
        return {"ok": False, "reason": f"no stored breadth row for {target_iso}"}

    live = _metrics_at_close(conn, tickers, target_ts, dividend_basis)
    if live is None:
        return {"ok": False, "reason": f"bars.db cannot support a live replay of {target_iso}"}

    # The anchor uses the PRIOR session — exactly what the endpoint has at 3:59.
    basis = anchor_basis(prior_ts, tickers, force=True)
    anchored = apply_anchor(live, basis)

    def _grade(value, sv, key):
        if value is None or sv is None:
            return None
        delta = float(value) - float(sv)
        rel = abs(delta) / abs(float(sv)) if sv else (0.0 if not delta else float("inf"))
        tol = _tolerance_for(key)
        ok = abs(delta) <= tol.get("abs", 0) or ("rel" in tol and rel <= tol["rel"])
        return {"value": value, "delta": round(delta, 3),
                "rel_pct": round(rel * 100, 2), "pass": ok}

    fields, failures, raw_failures = [], 0, 0
    for key in sorted(live):
        if key.startswith("_"):        # diagnostics, not a published metric
            continue
        sv = stored.get(key)
        raw = _grade(live[key], sv, key)
        anc = _grade(anchored.get(key), sv, key)
        if raw is None or anc is None:
            fields.append({"metric": key, "stored": sv, "raw": live.get(key),
                           "status": "skipped"})
            continue
        if not anc["pass"]:
            failures += 1
        if not raw["pass"]:
            raw_failures += 1
        fields.append({
            "metric": key, "stored": sv, "tolerance": _tolerance_for(key),
            "accuracy": accuracy_of(key),
            "raw": raw, "anchored": anc,
            "basis_shift": (basis or {}).get("shift", {}).get(key),
            "status": "pass" if anc["pass"] else "FAIL",
        })

    return {
        "ok": True,
        "date": target_iso,
        "levels_as_of": _iso(prior_ts),
        "anchored_to": (basis or {}).get("date"),
        "universe_size": len(tickers),
        "live_universe_count": live.get("universe_count"),
        "stored_universe_count": stored.get("universe_count"),
        "bars_coverage": (basis or {}).get("coverage"),
        "counts_anchored": (basis or {}).get("counts_anchored"),
        "anchor_withheld": (basis or {}).get("withheld") or [],
        "passed": failures == 0,
        "failures": failures,
        "raw_failures": raw_failures,
        "fields": fields,
    }
