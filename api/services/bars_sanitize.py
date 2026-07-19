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
def _apply_split_adjust(bars: list[dict], splits: list[tuple[str, float]]) -> list[dict]:
    """Make the series consistently split-adjusted to the most-recent basis.

    For each known split we look at the close just before vs just after the split
    date. If they're continuous (ratio ≈ 1) the provider already adjusted it. If
    they jump by ≈ the split factor, the provider MISSED it → we apply the factor
    to every earlier bar. Only real, quantified split-sized discontinuities are
    touched, so genuine earnings/news gaps are left alone."""
    if not splits or len(bars) < 2:
        return bars
    bar_dates = [_pd(b["t"]) for b in bars]

    unadjusted: list[tuple[date, float]] = []
    for sd_str, ratio in splits:
        sd = _pd(sd_str)
        if not sd:
            continue
        # last bar strictly before the split, first bar on/after it
        prev_i = None
        cur_i = None
        for i, bd in enumerate(bar_dates):
            if bd is None:
                continue
            if bd < sd:
                prev_i = i
            elif cur_i is None:
                cur_i = i
                break
        if prev_i is None or cur_i is None:
            continue  # split outside the data range (before first / after last)
        c_prev = bars[prev_i].get("c")
        c_cur = bars[cur_i].get("c")
        if not c_prev or not c_cur or c_cur <= 0:
            continue
        observed = c_prev / c_cur
        if abs(observed / ratio - 1.0) <= _SPLIT_TOL:
            unadjusted.append((sd, ratio))          # provider missed this split
        # ratio ≈ 1 (already adjusted) or anything else (ambiguous) → leave it

    if not unadjusted:
        return bars

    for b, bd in zip(bars, bar_dates):
        if bd is None:
            continue
        f = 1.0
        for sd, ratio in unadjusted:
            if bd < sd:
                f *= ratio
        if f != 1.0:
            b["o"] = round(b["o"] / f, 4)
            b["h"] = round(b["h"] / f, 4)
            b["l"] = round(b["l"] / f, 4)
            b["c"] = round(b["c"] / f, 4)
            v = b.get("v")
            if v:
                b["v"] = round(v * f)
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
            bars = _apply_split_adjust(bars, meta["splits"])
        if tf == "D":
            bars = _clamp_wicks(bars)
        return bars
    except Exception as e:  # noqa: BLE001
        _log.warning("sanitize_daily_bars failed for %s tf=%s: %s", ticker, tf, e)
        return bars
