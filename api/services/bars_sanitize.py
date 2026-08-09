"""Serve-time normalization of daily/weekly/monthly chart bars.

Fixes three provider data-quality classes on the D/W/M serve path, SOURCE-
AGNOSTIC (works the same whether the bars came from Massive's adjusted feed, the
unadjusted-yfinance deep-history graft, or FMP):

  1. TICKER REUSE — a recycled ticker carries the PRIOR security's history
     (SPCX = SpaceX, but the ticker was Tuttle's SPAC ETF before June 2026;
     DRAM = Roundhill Memory ETF, but was Dataram Corp until ~2017). The old
     security's bars sit before a data gap that resumes at the new listing date.
     We drop everything before that gap.

  2. PROVIDER SPLIT GAPS — Massive's `adjusted=true` feed silently MISSES some
     older splits (e.g. MNST's 2012 2:1), leaving a fake ~Nx cliff at the split
     date; the unadjusted-yfinance deep tail has the same problem. For each known
     split we detect whether the boundary is still un-adjusted (close ratio ≈ the
     split factor) and, if so, apply the missing factor to the pre-split bars so
     the whole series is consistently split-adjusted to the most-recent basis.

  3. LONE BAD BARS — a single erroneous print (e.g. NVDA 2024-06-10 high=195.95
     while open/close ≈ 120, which TradingView/TC2000 don't show). We clamp an
     extreme wick that neither the bar's own body NOR its neighbors corroborate.

Design constraints (honors the bars-pipeline invariants):
  • READ-ONLY transform of the SERVED bars — never touches the SQLite store, so
    newest-bar-wins / delta / weekly-key logic is unaffected.
  • Metadata (listing date + split list) is read from cache ONLY, never fetched
    synchronously on the request path (the 524-outage invariant: no unbounded
    external calls on the serve path). A cold miss serves the un-normalized bars
    for that step and schedules a bounded, deduped background warm; the next
    serve is clean.
  • The common case (a normal ticker with no reuse gap) is a couple of O(bars)
    passes with NO network and NO metadata lookup.

Kill switch: BARS_SANITIZE_ENABLED=0.
"""
from __future__ import annotations

import os
import threading
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from api.services.cache import cache

_log = logging.getLogger(__name__)

_ENABLED = os.environ.get("BARS_SANITIZE_ENABLED", "1") == "1"

# ── Metadata cache (listing date + splits) ──────────────────────────────────
_META_KEY = "barsan_meta_{}"
_META_TTL = 7 * 24 * 3600      # success: 7 days (corporate actions rarely change)
_META_FAIL_TTL = 3600         # transient failure: retry in ~1h, don't hammer

_warm_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="barsan-warm")
_warm_inflight: set[str] = set()
_warm_lock = threading.Lock()

# ── Tunables ────────────────────────────────────────────────────────────────
_GAP_MIN_DAYS = 21            # a gap this big + a listing-date match ⇒ reuse
_GAP_STANDALONE_DAYS = 150    # a gap this big ⇒ reuse even without listing metadata
_GAP_ALIGN_TOL_DAYS = 12      # gap must resume within this many days of the listing
_REUSE_PRICE_FACTOR = 4.0    # a gap WITH a ≥4× (or ≤¼×) price jump ⇒ reuse, no metadata
_SPLIT_TOL = 0.15            # |observed/expected − 1| ≤ this ⇒ boundary is unadjusted
_WICK = 1.40                 # a wick > body*this AND > neighbor*this is a lone spike

#: 🔴 THE DECLARED SPLIT DATE IS NOT THE SESSION THE PRICE STEPPED ON, AND DD
#: IS THE MEASUREMENT. FMP declares DuPont's 1-for-3 on **2026-06-24**; the step
#: in our store is on **2026-06-18** (`47.95 → 143.13`), four sessions earlier —
#: providers publish a record/payable date where the tape moved on the ex-date.
#: A date-EXACT boundary lookup therefore compared `20260623 c=140.01` against
#: `20260624 c=137.82`, read a ratio of 1.016 against an expected 0.3333, and
#: declined — so DD's split was healed NOWHERE, chart included. Measured: 0 rows
#: changed by this module for DD, `SMA200 = 50.19` against an independent
#: 133.89.
#:
#: ⛔ THE WINDOW ONLY SAYS WHERE TO LOOK — THE RATIO TEST IS STILL WHAT
#: AUTHORISES A CHANGE. Nothing is adjusted unless some boundary inside the
#: window shows a close step matching the DECLARED factor to `_SPLIT_TOL`, so a
#: ticker with no declared split is never scanned at all and a declared split
#: whose factor nothing matches is still left alone.
#:
#: ⚠️ AND THE BOUNDARY IT FINDS IS THE ONE THAT GETS APPLIED, NOT THE DECLARED
#: DATE. Applying DD's factor at 2026-06-24 would have multiplied the six
#: sessions 06-18…06-23 — already at the post-split scale — by three, turning
#: $143 into $429. Finding the true boundary is the correctness of the repair,
#: not a nicety.
_SPLIT_BOUNDARY_WINDOW = 7   # sessions either side of the DECLARED split date


def _pd(s) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except (ValueError, TypeError):
        return None


# ── Metadata fetch (background only) ────────────────────────────────────────
def _fetch_meta(ticker: str) -> dict:
    """Best-effort listing date + split list for `ticker`. Never raises."""
    ipo = None
    splits: list[tuple[str, float]] = []
    try:
        from api.services.earnings_estimates import _fmp_get
        prof = _fmp_get("/stable/profile", {"symbol": ticker})
        if isinstance(prof, list) and prof:
            ipo = (prof[0] or {}).get("ipoDate") or None
        raw = _fmp_get("/stable/splits", {"symbol": ticker, "limit": 40})
        if isinstance(raw, list):
            for s in raw:
                d = str(s.get("date") or "")[:10]
                num, den = s.get("numerator"), s.get("denominator")
                try:
                    r = float(num) / float(den)
                except (TypeError, ValueError, ZeroDivisionError):
                    continue
                if d and r > 0:
                    splits.append((d, r))
    except Exception as e:  # noqa: BLE001
        _log.warning("bars_sanitize meta fetch failed for %s: %s", ticker, e)
        raise
    return {"ipo": ipo, "splits": splits}


def _warm_meta(ticker: str) -> None:
    def _run():
        try:
            meta = _fetch_meta(ticker)
            cache.set(_META_KEY.format(ticker), meta, ttl=_META_TTL)
        except Exception:
            # Cache an empty sentinel briefly so we retry later without hammering.
            cache.set(_META_KEY.format(ticker), {"ipo": None, "splits": []},
                      ttl=_META_FAIL_TTL)
        finally:
            with _warm_lock:
                _warm_inflight.discard(ticker)

    with _warm_lock:
        if ticker in _warm_inflight:
            return
        _warm_inflight.add(ticker)
    try:
        _warm_pool.submit(_run)
    except Exception:
        with _warm_lock:
            _warm_inflight.discard(ticker)


def _meta_cached(ticker: str) -> dict | None:
    """Return cached metadata dict, or None (and schedule a warm) on a cold miss."""
    m = cache.get(_META_KEY.format(ticker))
    if m is not None:
        return m
    _warm_meta(ticker)
    return None


# ── Step 1: ticker-reuse listing cutoff ─────────────────────────────────────
def _apply_listing_cutoff(bars: list[dict], meta: dict | None) -> list[dict]:
    """Drop the OLD security's bars from a recycled ticker.

    A reused ticker has a large data gap whose resumption aligns with the new
    security's listing date. Normal continuously-traded tickers have no such gap,
    so this is a fast no-op for them (single O(bars) scan, no metadata needed
    unless a suspicious gap is present)."""
    if len(bars) < 2:
        return bars
    # Largest gap + the index of the bar that RESUMES trading after it.
    best_gap, resume_idx = 0, 0
    prev_d = _pd(bars[0]["t"])
    for i in range(1, len(bars)):
        d = _pd(bars[i]["t"])
        if prev_d and d:
            g = (d - prev_d).days
            if g > best_gap:
                best_gap, resume_idx = g, i
        prev_d = d
    if best_gap < _GAP_MIN_DAYS:
        return bars  # no reuse signature at all

    # METADATA-FREE reuse detection: a gap WITH a large price discontinuity is a
    # recycled ticker — the OLD security traded at a totally different scale than
    # the new listing (SPCX: ~$22 SPAC ETF → ~$150 SpaceX; DRAM: ~$1 Dataram →
    # ~$50 ETF). A legit multi-week HALT of the same company resumes near its
    # pre-halt price, so it won't trip this. This cuts on the FIRST serve, before
    # the ipoDate metadata warms — no ~1s pre-IPO flash. (A gap ≥ _GAP_MIN_DAYS
    # rules out a reverse split, which is same-day.)
    prev_c = bars[resume_idx - 1].get("c")
    cur_c = bars[resume_idx].get("c")
    if prev_c and cur_c and prev_c > 0:
        ratio = cur_c / prev_c
        if ratio >= _REUSE_PRICE_FACTOR or ratio <= 1.0 / _REUSE_PRICE_FACTOR:
            return bars[resume_idx:]

    ipo = _pd((meta or {}).get("ipo"))
    resume_d = _pd(bars[resume_idx]["t"])

    # Prefer the gap whose resume aligns with the listing date (precise + safe:
    # a legit multi-week halt of the SAME company keeps its old ipoDate, so it
    # won't align with the gap and won't be cut).
    if ipo and resume_d and abs((resume_d - ipo).days) <= _GAP_ALIGN_TOL_DAYS:
        return bars[resume_idx:]
    # No listing metadata (cold cache): only cut on an UNMISTAKABLE gap.
    if best_gap >= _GAP_STANDALONE_DAYS:
        return bars[resume_idx:]
    return bars


# ── Step 2: split-adjustment self-heal ──────────────────────────────────────
def unadjusted_splits(bars: list[dict],
                      splits: list[tuple[str, float]],
                      *, window: int = _SPLIT_BOUNDARY_WINDOW,
                      ) -> list[tuple[date, float]]:
    """`[(boundary_date, ratio)]` — the declared splits this SERIES has NOT had
    applied, each paired with the date of the FIRST bar at the post-split scale.

    ⭐ THIS IS THE ONE DETECTOR. `bars_sanitize` heals the SERVED copy and
    `bars_split_repair` heals the STORE, and both ask this function — so the
    chart and the alert/scan/screener lanes cannot come to different conclusions
    about whether a split was applied. A second implementation of this judgement
    is the *second authority over one value* defect that has cost this repo
    three separate outages; there is deliberately only one.

    For each declared split we look for a boundary in `± window` sessions of the
    declared date where `close[i-1] / close[i]` matches the declared factor to
    `_SPLIT_TOL`. A boundary that is continuous (ratio ≈ 1) means the provider
    already adjusted it; anything that matches nothing is ambiguous and is left
    alone. Only real, QUANTIFIED, split-sized discontinuities are reported, so
    genuine earnings/news gaps never appear here.

    ⛔ IDEMPOTENT BY CONSTRUCTION, WHICH IS WHY IT IS SAFE TO RUN OVER A LIVE
    STORE. The evidence it fires on is the discontinuity itself; once a series is
    adjusted the observed ratio at that boundary is ≈ 1 and no factor matches, so
    a second pass reports nothing and rewrites nothing.
    """
    if not splits or len(bars) < 2:
        return []
    bar_dates = [_pd(b["t"]) for b in bars]
    out: list[tuple[date, float]] = []
    for sd_str, ratio in splits:
        sd = _pd(sd_str)
        try:
            ratio = float(ratio)
        except (TypeError, ValueError):
            continue
        if not sd or not (ratio > 0):
            continue
        # The declared date's own boundary: the first bar on/after it.
        anchor = None
        for i, bd in enumerate(bar_dates):
            if bd is not None and bd >= sd:
                anchor = i
                break
        if anchor is None or anchor < 1:
            continue  # split outside the data range (after last / before first)
        lo, hi = max(1, anchor - window), min(len(bars) - 1, anchor + window)
        best: tuple[float, date, float] | None = None
        for i in range(lo, hi + 1):
            if bar_dates[i] is None or bar_dates[i - 1] is None:
                continue
            c_prev, c_cur = bars[i - 1].get("c"), bars[i].get("c")
            if not c_prev or not c_cur or c_prev <= 0 or c_cur <= 0:
                continue
            err = abs((c_prev / c_cur) / ratio - 1.0)
            if err <= _SPLIT_TOL and (best is None or err < best[0]):
                best = (err, bar_dates[i], ratio)
        if best is not None:
            out.append((best[1], best[2]))
    return out


def split_factor(bar_date: date, unadjusted: list[tuple[date, float]]) -> float:
    """The factor a bar dated `bar_date` must be divided by to reach the
    post-split basis. `1.0` means the bar is already on it."""
    f = 1.0
    for boundary, ratio in unadjusted:
        if bar_date < boundary:
            f *= ratio
    return f


def scale_bar(bar: dict, f: float) -> dict:
    """Rescale one bar IN PLACE by split factor `f` and return it.

    ⛔ THE ROUNDING LIVES HERE, ONCE. The served copy and the stored rows must
    land on the same digits or the chart and the screener disagree by a rounding
    step — which is the very split-brain this module exists to close.
    """
    if f == 1.0:
        return bar
    for k in ("o", "h", "l", "c"):
        v = bar.get(k)
        if v is not None:
            bar[k] = round(v / f, 4)
    v = bar.get("v")
    if v:
        bar["v"] = round(v * f)
    return bar


def _apply_split_adjust(bars: list[dict], splits: list[tuple[str, float]],
                        unadjusted: list[tuple[date, float]] | None = None,
                        ) -> list[dict]:
    """Make the series consistently split-adjusted to the most-recent basis."""
    if unadjusted is None:
        unadjusted = unadjusted_splits(bars, splits)
    if not unadjusted:
        return bars
    for b in bars:
        bd = _pd(b["t"])
        if bd is None:
            continue
        scale_bar(b, split_factor(bd, unadjusted))
    return bars


# ── Step 3: lone bad-bar wick clamp (daily only) ────────────────────────────
def _clamp_wicks(bars: list[dict]) -> list[dict]:
    """Clamp a single absurd wick the body AND both neighbors disagree with —
    a provider bad print (e.g. NVDA 2024-06-10 high=195.95 vs body ~121). Very
    rare (≈1 bar in NVDA's 23-year history), so the conservative threshold never
    touches a genuinely volatile bar (whose neighbors would also be elevated)."""
    n = len(bars)
    for i in range(n):
        b = bars[i]
        o, h, l, c = b.get("o"), b.get("h"), b.get("l"), b.get("c")
        if None in (o, h, l, c) or h <= 0 or l <= 0:
            continue
        body_hi, body_lo = max(o, c), min(o, c)
        ph = bars[i - 1]["h"] if i > 0 else h
        nh = bars[i + 1]["h"] if i < n - 1 else h
        pl = bars[i - 1]["l"] if i > 0 else l
        nl = bars[i + 1]["l"] if i < n - 1 else l
        # Upper wick: high far above the body AND above both neighbors' highs.
        if body_hi > 0 and h > body_hi * _WICK and h > max(ph, nh) * _WICK:
            b["h"] = round(max(body_hi, ph, nh), 4)
        # Lower wick: low far below the body AND below both neighbors' lows.
        if l > 0 and body_lo > 0 and l < body_lo / _WICK and l < min(pl, nl) / _WICK:
            b["l"] = round(min(body_lo, pl, nl), 4)
    return bars


# ── Store repair hand-off ───────────────────────────────────────────────────
_repair_inflight: set[tuple[str, str]] = set()


def _schedule_store_repair(ticker: str, tf: str) -> None:
    """Hand a detected un-back-adjusted split to the STORE repairer.

    Best-effort, deduped, and OFF the request path — it rides the same bounded
    2-worker pool the metadata warm already uses, so a chart serve never waits
    on a SQLite write. Never raises: a repair that fails leaves the store exactly
    as stale as it was, and the served copy is already correct.
    """
    key = (ticker.upper(), tf)
    with _warm_lock:
        if key in _repair_inflight:
            return
        _repair_inflight.add(key)

    def _run():
        try:
            from api.services import bars_split_repair
            bars_split_repair.repair_ticker(ticker, tf, apply=True)
        except Exception as e:  # noqa: BLE001
            _log.warning("split store repair failed for %s tf=%s: %s", ticker, tf, e)
        finally:
            with _warm_lock:
                _repair_inflight.discard(key)

    try:
        _warm_pool.submit(_run)
    except Exception:  # noqa: BLE001
        with _warm_lock:
            _repair_inflight.discard(key)


# ── Public entry point ──────────────────────────────────────────────────────
def sanitize_daily_bars(ticker: str, bars: list[dict], tf: str) -> list[dict]:
    """Normalize a D/W/M bars list (list of {t,o,h,l,c,v}, ascending by t).

    Best-effort + never raises: any failure returns the input bars unchanged so a
    bug here can never blank a chart. Intraday timeframes pass through untouched."""
    if not _ENABLED or not bars or tf not in ("D", "W", "M"):
        return bars
    try:
        meta = _meta_cached(ticker)                      # None on cold miss (+warm)
        bars = _apply_listing_cutoff(bars, meta)
        if meta and meta.get("splits"):
            unadjusted = unadjusted_splits(bars, meta["splits"])
            if unadjusted:
                bars = _apply_split_adjust(bars, meta["splits"], unadjusted)
                # ⭐ THE SERVED COPY IS NOW RIGHT AND THE STORE IS STILL WRONG,
                # AND THAT IS THE DEFECT THIS LINE CLOSES. Everything that does
                # NOT come through here — the alert evaluator, the nightly
                # screener build, the universe scan, and every SQL aggregate in
                # `bars_sqlite` — reads the rows directly. Detecting the gap and
                # healing only the response is what let DD's SMA200 read 50.19
                # on the alert lane while the chart drew 133.89.
                _schedule_store_repair(ticker, tf)
        if tf == "D":
            bars = _clamp_wicks(bars)
        return bars
    except Exception as e:  # noqa: BLE001
        _log.warning("sanitize_daily_bars failed for %s tf=%s: %s", ticker, tf, e)
        return bars
