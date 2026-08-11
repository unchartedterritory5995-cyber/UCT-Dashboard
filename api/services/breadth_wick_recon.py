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


# ── Orchestrator: reconstruct one past day's wicks from S3 intraday ──────────
_S3_KEY = "us_stocks_sip/minute_aggs_v1/{y}/{m}/{d}.csv.gz"
_VWSTATE: dict = {"status": "idle"}


def _s3_client():
    try:
        from api.services.build_intraday_cache import get_s3_client
        return get_s3_client()
    except Exception:
        import os as _os, boto3
        return boto3.client(
            "s3", region_name="us-east-1",
            aws_access_key_id=_os.environ.get("MASSIVE_S3_ACCESS_KEY") or _os.environ.get("MASSIVE_ACCESS_KEY"),
            aws_secret_access_key=_os.environ.get("MASSIVE_S3_SECRET") or _os.environ.get("MASSIVE_SECRET_KEY"),
            endpoint_url=_os.environ.get("MASSIVE_S3_ENDPOINT") or "https://files.massive.com")


def _levels_for_day(conn, tickers, day_ts):
    """build_levels as of the session BEFORE day_ts (MAs fixed from prior closes) —
    mirrors breadth_live._metrics_at_close's level build, reused per-bucket."""
    from datetime import date as _d, timedelta as _td
    from api.services import breadth_live as bl
    row = conn.execute("SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ?",
                       (day_ts,)).fetchone()
    prior = int(row[0]) if row and row[0] else None
    if not prior:
        return None
    start = bl._ts_int(_d.fromisoformat(bl._iso(prior)) - _td(days=bl._LOAD_CALENDAR_DAYS))
    dates = bl._session_dates(conn, prior, start)
    if len(dates) < 221:
        return None
    closes, vols = bl._load_frame(conn, tickers, dates)
    closes = bl._apply_dividend_basis(tickers, dates, closes, day_ts)
    return bl.build_levels(tickers, closes, vols, prior)


def recon_day(D: str, universe: list, client=None, bucket_min: int = 30) -> Optional[dict]:
    """Reconstruct one past day's per-metric OHLC wicks from S3 minute flat files.
    D = 'YYYY-MM-DD'. Returns aggregate_day() output, or None if levels/intraday
    unavailable. HEAVY (whole-market minute file) — call from a worker/bg thread."""
    from datetime import date as _d
    from api.services import breadth_live as bl
    from api.services import build_intraday_cache as bic
    conn = bl._bars_conn()
    day_ts = bl._ts_int(_d.fromisoformat(D))
    levels = _levels_for_day(conn, universe, day_ts)
    if levels is None:
        return None
    client = client or _s3_client()
    key = _S3_KEY.format(y=D[:4], m=D[5:7], d=D)
    res = bic.download_and_resample(client, key, [bucket_min], set(universe))
    if not res or not res.get(bucket_min):
        return None
    per_ticker = res[bucket_min]                     # {ticker: [{t,o,h,l,c,v}]}
    by_tb = {tk: {b["t"]: b["c"] for b in bars} for tk, bars in per_ticker.items()}
    buckets = sorted({b["t"] for bars in per_ticker.values() for b in bars})
    last_px: dict = {}
    prices_by_bucket = []
    for T in buckets:
        for tk in per_ticker:
            px = by_tb[tk].get(T)
            if px is not None:
                last_px[tk] = px                     # carry-forward last print
        prices_by_bucket.append(dict(last_px))
    if not prices_by_bucket:
        return None
    from api.services.breadth_live import compute_metrics
    close_m = compute_metrics(levels, prices_by_bucket[-1]) or {}
    close_val = {k: v for k, v in close_m.items() if not k.startswith("_")}
    return aggregate_day(levels, prices_by_bucket, close_val)


# ── Prototype validation: recon wicks vs the REAL live-accumulator wicks ─────
_VALIDATE_METRICS = ("pct_above_10sma", "pct_above_20ema", "pct_above_50sma",
                     "pct_above_100sma", "pct_above_200sma",
                     "new_20d_highs", "new_20d_lows")


def validate_recent(days: int = 3, bucket_min: int = 30) -> dict:
    """The Phase-3 gate: reconstruct the last `days` COMPLETED sessions' wicks from
    S3 intraday and compare to the store's REAL 'live' wicks (same days, sampled in
    real time). If the reconstructed high/low match the live high/low within ~1-2pt,
    the S3-flatfile method faithfully reproduces true intraday wicks → grind back."""
    from datetime import date as _d
    from api.services import breadth_live as bl
    from api.services import breadth_daily_ohlc as store
    universe, _ = bl.universe()
    if not universe:
        return {"ok": False, "reason": "no universe"}
    today = bl._iso(bl._ts_int(bl._now_et().date()))
    live_hist = store.history("pct_above_50sma")            # {date:{o,h,l,c}} trusted
    dates = sorted(d for d in live_hist if d < today)[-days:]
    client = _s3_client()
    per_date, all_dh, all_dl = [], [], []
    for D in dates:
        try:
            recon = recon_day(D, universe, client, bucket_min)
        except Exception as e:
            per_date.append({"date": D, "error": f"{type(e).__name__}: {e}"})
            continue
        if not recon:
            per_date.append({"date": D, "error": "no recon (levels/intraday unavailable)"})
            continue
        cmp = {}
        for m in _VALIDATE_METRICS:
            r = recon.get(m)
            liveohlc = store.history(m).get(D)
            if not r or not liveohlc:
                continue
            dh = round(r["h"] - liveohlc["h"], 3)
            dl = round(r["l"] - liveohlc["l"], 3)
            cmp[m] = {"recon_hl": [r["h"], r["l"]], "live_hl": [liveohlc["h"], liveohlc["l"]],
                      "dh": dh, "dl": dl, "recon_src": r.get("source")}
            if m in _PCT_METRICS:
                all_dh.append(abs(dh)); all_dl.append(abs(dl))
        per_date.append({"date": D, "buckets_ok": True, "metrics": cmp})
    mean_abs = None
    if all_dh:
        mean_abs = round((sum(all_dh) + sum(all_dl)) / (len(all_dh) + len(all_dl)), 3)
    return {
        "ok": True, "days": dates, "bucket_min": bucket_min,
        "pct_wick_mean_abs_delta": mean_abs,
        "verdict": (("METHOD VALIDATED (recon wicks match live within ~"
                     f"{mean_abs}pt)") if mean_abs is not None and mean_abs <= 2.0
                    else ("MISMATCH (recon wicks diverge from live)" if mean_abs is not None
                          else "INCONCLUSIVE (no comparable data)")),
        "per_date": per_date,
    }


def probe_day(D: str, bucket_min: int = 30) -> dict:
    """Granular diagnostic for one day: does the LEVELS build succeed, does the S3
    get_object succeed (capturing the real exception download_and_resample swallows),
    and how many tickers come back? Pinpoints levels-vs-S3 failure."""
    import os as _os
    from datetime import date as _d
    from api.services import breadth_live as bl
    from api.services import build_intraday_cache as bic
    out: dict = {"date": D}
    try:
        universe, _ = bl.universe()
        out["universe_size"] = len(universe)
    except Exception as e:
        out["universe_error"] = f"{type(e).__name__}: {e}"; return out
    try:
        conn = bl._bars_conn()
        lv = _levels_for_day(conn, universe, bl._ts_int(_d.fromisoformat(D)))
        out["levels"] = "ok" if lv is not None else "None (<221 sessions / load fail)"
        if lv is not None:
            out["levels_ndates"] = lv.get("n_dates")
    except Exception as e:
        out["levels_error"] = f"{type(e).__name__}: {e}"
    key = _S3_KEY.format(y=D[:4], m=D[5:7], d=D)
    out["s3_key"] = key
    out["s3_bucket_env"] = _os.environ.get("MASSIVE_S3_BUCKET")
    out["get_s3_client_ok"] = None
    try:
        from api.services.build_intraday_cache import get_s3_client as _gsc
        _gsc(); out["get_s3_client_ok"] = True   # does the EXISTING helper work here?
    except Exception as e:
        out["get_s3_client_ok"] = f"{type(e).__name__}: {str(e)[:120]}"
    try:
        client = _s3_client()
        out["s3_client"] = "built"
        try:  # head_object = metadata only, no download
            h = client.head_object(Bucket="flatfiles", Key=key)
            out["s3_head_bytes"] = h.get("ContentLength")
        except Exception as e:
            out["s3_head_error"] = f"{type(e).__name__}: {str(e)[:200]}"
    except Exception as e:
        out["s3_client_error"] = f"{type(e).__name__}: {str(e)[:200]}"
    return out


def run_validate_async(**kw) -> None:
    import threading, traceback
    def _run():
        _VWSTATE.clear(); _VWSTATE.update(status="running")
        try:
            res = validate_recent(**kw)
            _VWSTATE.clear(); _VWSTATE.update(status="done", **res)
        except Exception as e:
            _VWSTATE.clear(); _VWSTATE.update(status="error", reason=f"{type(e).__name__}: {e}",
                                              trace=traceback.format_exc()[-900:])
    threading.Thread(target=_run, name="wick-validate", daemon=True).start()
