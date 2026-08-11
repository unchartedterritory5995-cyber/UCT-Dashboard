"""Phase 3 — historical intraday WICKS for breadth candles (core compute + gate).

Today's historical breadth candles are body-only (`close_recon`): one value per
day, so `high=max(o,c)`, `low=min(o,c)`. A real wick is the intraday HIGH/LOW of
the whole-market breadth VALUE — and the only honest way to get it is to recompute
breadth at several moments THROUGH the day and take that series' extremes.

⛔ NOT the shortcut that shipped garbage once: taking every stock's DAILY high/low
and assuming the whole market peaked at one instant → ~50-point-wide nonsense wicks.
A breadth wick is a property of the cross-section AT A MOMENT, never an aggregate of
per-stock extremes.

✅ This module replays the EXACT live method (`breadth_live.compute_metrics`) at each
intraday bucket, then aggregates per-metric OHLC — the same thing the live
accumulator does, run over historical bars. Data-pull (Massive S3 minute flat files
via `build_intraday_cache.download_and_resample`), the worker sweep, and the R2
bridge are the surrounding plumbing (clone the Phase-1 shape); this file is the
core + the validation gate that keeps a bad reconstruction off the charts.

Spec: docs/superpowers/specs/2026-08-11-breadth-historical-wicks-phase3-design.md
"""
from __future__ import annotations

import math
from typing import Optional

# The pct_above_* / ratio-share family: bounded [0,100], and a real intraday swing
# is modest. This is THE anti-garbage guard — the failed shortcut produced 40-50+
# point "swings"; genuine whole-market breadth rarely moves >~20 points intraday
# even on a washout, so 30 rejects the nonsense without clipping real volatile days.
_PCT_METRICS = frozenset({
    "pct_above_5sma", "pct_above_10sma", "pct_above_20ema", "pct_above_40sma",
    "pct_above_50sma", "pct_above_100sma", "pct_above_200sma",
    "hi_ratio", "lo_ratio", "near_52w_high",
})
MAX_PCT_INTRADAY_DELTA = 30.0   # env-tunable at the sweep layer


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def sane_wick(metric: str, o: float, h: float, l: float, c: float) -> tuple[bool, str]:
    """Gate one reconstructed candle before it is trusted. Returns (ok, reason).

    Universal: all finite, and h ≥ max(o,c) ≥ min(o,c) ≥ l (a wick can only EXTEND
    a body, never invert it). For the pct family additionally: within [0,100] and an
    intraday range ≤ MAX_PCT_INTRADAY_DELTA — the signature check that keeps the old
    per-stock-extremes bug off the charts. Count/oscillator metrics (which can be
    negative or range widely by nature) get only the ordering/finite check."""
    for name, v in (("o", o), ("h", h), ("l", l), ("c", c)):
        if _finite(v) is None:
            return False, f"{name} not finite"
    body_hi, body_lo = max(o, c), min(o, c)
    if not (h >= body_hi - 1e-6 and l <= body_lo + 1e-6 and h >= l - 1e-6):
        return False, "wick inverts body (h<body_hi or l>body_lo or h<l)"
    if metric in _PCT_METRICS:
        if l < -1e-6 or h > 100.0 + 1e-6:
            return False, "pct metric outside [0,100]"
        if (h - l) > MAX_PCT_INTRADAY_DELTA:
            return False, f"pct intraday range {h - l:.1f} > {MAX_PCT_INTRADAY_DELTA} (garbage-wick signature)"
    return True, "ok"


def aggregate_day(levels: dict, prices_by_bucket: list[dict], close_val_by_metric: dict,
                  vols_by_bucket: Optional[list[dict]] = None,
                  max_pct_delta: float = MAX_PCT_INTRADAY_DELTA) -> dict:
    """Reconstruct one past day's per-metric OHLC from intraday buckets.

    `levels`            — build_levels() for the day (MAs fixed from prior closes).
    `prices_by_bucket`  — [{ticker: price}] oldest→newest, one dict per intraday
                          timestamp (e.g. ~13 thirty-minute RTH buckets).
    `close_val_by_metric` — the AUTHORITATIVE EOD close per metric (the existing
                          close_recon/collector value); the body still ties out to
                          the number of record, and the intraday sweep only supplies
                          the wick + open.
    Returns {metric: {"o","h","l","c","source","flagged"?}} — 'intraday_recon' for a
    candle that passed sane_wick, else it FALLS BACK to a body (o=c, h/l=body) tagged
    flagged so the sweep can log it and leave close_recon in place. Never raises."""
    from api.services.breadth_live import compute_metrics
    if not prices_by_bucket:
        return {}
    globals_max = max_pct_delta
    agg: dict = {}   # metric -> [o, h, l]  (close comes from close_val_by_metric)
    for bi, prices in enumerate(prices_by_bucket):
        vols = vols_by_bucket[bi] if vols_by_bucket and bi < len(vols_by_bucket) else None
        try:
            m = compute_metrics(levels, prices, vols)
        except Exception:
            continue
        for k, v in m.items():
            if k.startswith("_"):
                continue
            fv = _finite(v)
            if fv is None:
                continue
            a = agg.get(k)
            if a is None:
                agg[k] = [fv, fv, fv]        # o, h, l
            else:
                if fv > a[1]:
                    a[1] = fv
                if fv < a[2]:
                    a[2] = fv

    out: dict = {}
    for k, (o, h, l) in agg.items():
        c = _finite(close_val_by_metric.get(k))
        if c is None:
            continue
        # the authoritative close can sit outside the sampled intraday range (last
        # bucket ≠ official EOD); widen the wick to include it so ordering holds.
        h = max(h, o, c)
        l = min(l, o, c)
        ok, reason = sane_wick(k, o, h, l, c)
        if ok and (k not in _PCT_METRICS or (h - l) <= globals_max):
            out[k] = {"o": round(o, 4), "h": round(h, 4), "l": round(l, 4),
                      "c": round(c, 4), "source": "intraday_recon"}
        else:
            # reject the wick, keep an honest body — sweep leaves close_recon as-is
            out[k] = {"o": round(c, 4), "h": round(c, 4), "l": round(c, 4),
                      "c": round(c, 4), "source": "close_recon", "flagged": reason}
    return out
