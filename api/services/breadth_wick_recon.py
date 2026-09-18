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
#
# ⛔⛔ DERIVED FROM THE REGISTRY, NEVER HAND-MAINTAINED AGAIN. This was a literal set
# and it had drifted: `near_52w_high` is `UNIT_COUNT` / `DOMAIN_NONNEG` in
# `breadth_metrics` — a COUNT of securities — but sat in here, so `sane_wick` applied
# the two percentage-only rules to it. The `h > 100` rule then rejected every session
# where more than 100 names were within 5% of their 52-week high, which is most of
# them: 137 of 17,298 rows survived (0.79%), US kept ZERO, the stored maximum was
# exactly 100.0, and the survivors were a biased sample of market BOTTOMS. Its own
# sibling `new_52w_highs` — same family, same unit, not in this set — reaches 874.
#
# ⭐ `DOMAIN_PCT` is the precise question, NOT `UNIT_PERCENT`. The rules below assert a
# 0-100 share, which is exactly what `pct_0_100` means. `aaii_spread` is a percent that
# is DOMAIN_SIGNED (it crosses zero), so a [0,100] clamp would be wrong for it — and
# selecting on unit rather than domain would have silently swept it back in.
def _pct_metrics() -> frozenset:
    from api.services import breadth_metrics as _bm
    return frozenset(k for k, m in _bm.METRICS.items()
                     if m["domain"] == _bm.DOMAIN_PCT)


_PCT_METRICS = _pct_metrics()
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


def _add_composites(m: dict) -> None:
    """Derive NETHL / PH / PL AT THIS TIMESTAMP, in place.

    ⛔⛔ THE ORDER IS THE WHOLE POINT. A composite's High is the maximum of the
    COMPOSITE's own path, never an arithmetic combination of its components' candles:

        max_t (NH(t) - NL(t))   ≠   max_t NH(t) - min_t NL(t)

    unless both extrema happen to fall on the same minute. The right-hand side is what
    you get by deriving a composite from finished NH/NL candles, and it is wrong by
    construction on every session where the two peaks are minutes apart. So the metric
    is computed HERE, inside the per-bucket loop, and then aggregated like any other
    series — `aggregate_day` cannot tell the difference, which is the point.

    ⚠️ `compute_metrics` does not emit these three (measured: all three return None),
    which is exactly why UCT stores no `net_new_high_low` rows at all and PH/PL carry no
    intraday coverage. This closes that gap without touching the metric engine's own
    contract.
    """
    nh, nl = m.get("new_52w_highs"), m.get("new_52w_lows")
    uni = m.get("universe_count")
    if isinstance(nh, (int, float)) and isinstance(nl, (int, float)):
        m["net_new_high_low"] = float(nh) - float(nl)
    # ⚠️ ZERO DENOMINATOR IS A NON-VALUE, NOT A ZERO. An empty universe means the
    # ratio is unknown; publishing 0.0 would read as "no stock is at a 52-week high",
    # which is a claim we did not measure. `_finite` drops None, so the minute simply
    # does not contribute to that metric's path.
    if isinstance(uni, (int, float)) and uni and uni > 0:
        if isinstance(nh, (int, float)):
            m["hi_ratio"] = round(float(nh) / float(uni) * 100.0, 4)
        if isinstance(nl, (int, float)):
            m["lo_ratio"] = round(float(nl) / float(uni) * 100.0, 4)


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
        _add_composites(m)
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


def _comparable_names(levels: dict) -> set:
    """Names whose levels can actually be COMPARED against a price, and which therefore
    require a basis.

    ⛔⛔ NOT simply `levels["tickers"]`, and the difference is large. `_load_frame`
    returns a row for every requested ticker, all-NaN for the ones `bars.db` has no
    history for — and in 2015 that is roughly 45% of the US union (measured: union 4,707
    against 2,571 names with a settled close). Treating the whole frame as
    basis-requiring would fail those closed and delete them from `universe_count`,
    halving the denominator to buy nothing: a name with no level cannot be compared
    against one, so it can only ever be COUNTED, and a count does not read the price.

    ⭐ So the rule is exactly "has something to be inconsistent with". A name with any
    usable level must have a basis or be dropped; a name with none passes through, is
    counted, and cannot reach a single level-dependent metric because every one of them
    masks on the level's own `_ok` flag.
    """
    import numpy as np
    tk = levels.get("tickers") or []
    if not tk:
        return set()
    n = len(tk)
    need = np.zeros(n, dtype=bool)
    for key in ("max52_ok", "min52_ok", "max20_ok", "min20_ok", "maxath_ok"):
        v = levels.get(key)
        if v is not None and len(v) == n:
            need |= np.asarray(v, dtype=bool)
    sma_ok = levels.get("sma_ok") or {}
    for v in sma_ok.values():
        if v is not None and len(v) == n:
            need |= np.asarray(v, dtype=bool)
    for key in ("prev_close", "ema20_prev"):
        v = levels.get(key)
        if v is not None and len(v) == n:
            a = np.asarray(v, dtype=float)
            need |= np.isfinite(a) & (a > 0.0)
    return {tk[i] for i in range(n) if need[i]}


def session_eod_closes(conn, day_ts: int, tickers=None) -> dict:
    """{ticker: official adjusted close} for session `day_ts`, from `bars.db`.

    ⭐ THE AUTHORITATIVE EOD CROSS-SECTION, and deliberately the SAME series
    `build_levels` consumes — so the Close it produces is measured on exactly the basis
    its own levels are on, with no second adjustment vintage to reconcile. It carries
    the closing auction, which the 15:59 minute bar does not: `breadth_session`'s own
    note is that "the closing auction reaches the candle through the AUTHORITATIVE EOD
    close — which is where C comes from — not the intraday path".

    ⚠️ Never raises. A caller with no usable connection gets `{}` and decides.
    """
    want = set(tickers) if tickers is not None else None
    out: dict = {}
    try:
        for t, c in conn.execute(
                "SELECT ticker, c FROM ohlcv WHERE tf='D' AND ts=?", (day_ts,)):
            if c is None or (want is not None and t not in want):
                continue
            try:
                v = float(c)
            except (TypeError, ValueError):
                continue
            if v > 0.0:
                out[t] = v
    except Exception:                                  # noqa: BLE001 - never raises
        return {}
    return out


def session_basis(conn, day_ts: int, tickers=None) -> dict:
    """{ticker: factor} lifting AS-TRADED session prices onto the LEVELS basis.

    ⭐⭐ ONE CANONICAL BASIS, AND THE LEVELS OWN IT. `get_grouped_daily_ohlcv` states the
    rule this follows: *adjusted=True is the ONLY correct basis for a moving average or
    a 52-week extreme measured ACROSS a window; a raw frame puts a pre-split and a
    post-split price in the same average.* So the window is right and the intraday path
    is what must move — the alternative (un-adjusting the levels) would rebuild the very
    frame the validation already proved correct, to reach the same inequality.

    factor = adjusted_close(D) / raw_close(D), BOTH READ FROM THE PROVIDER, both official
    closes of THE SAME SESSION.

    ⛔⛔ THE RATIO MUST BE PROVIDER-INTERNAL, and the first cut got this wrong by taking
    the numerator from `bars.db`. That mixes two sources into one ratio, so ANY
    disagreement between them is silently reinterpreted as a corporate action. Measured
    on 2020-03-16: `BCPC` had provider raw 21.26 and provider adjusted 21.26 — the
    provider asserting NO action — while `bars.db` held 83.67, and the mixed ratio
    invented a 3.9356x "split" that scaled a correct price into nonsense. `TPC` was the
    same shape at 0.2719x. Both were manufactured by the formula, not present in the data.

    ⭐ Taking both sides from the provider makes the ratio carry EXACTLY one thing: the
    cumulative corporate action between D and today. When the provider's own adjusted and
    raw agree it is telling us there is no action, and the factor is 1.0 by construction
    rather than by luck — which is why a source disagreement can no longer masquerade as
    a split. Verified against the control: `AAPL` on 2020-03-16 reads raw 242.21,
    adjusted 60.5525, factor 0.25 — its 4:1 split, exactly.

    ⚠️ NOT LOOK-AHEAD. The ratio carries the corporate-action factor and nothing else —
    no future price, no future market state. It is applied per ticker to every price of
    that ticker, so no within-name comparison moves relative to that name's own levels;
    only the two sides are put on one scale.
    ⛔ Names whose factor cannot be established are simply absent, and `session_ohlc`
    fails closed on the ones whose levels could otherwise be compared.
    """
    from api.services import breadth_live as bl
    from api.services import massive
    want = set(tickers) if tickers is not None else None
    iso = bl._iso(day_ts)
    try:
        raw = massive.get_grouped_daily_closes(iso, adjusted=False) or {}
        adj = massive.get_grouped_daily_closes(iso, adjusted=True) or {}
    except Exception:                                  # noqa: BLE001
        return {}
    if not raw or not adj:
        return {}
    out = {}
    for t, r in raw.items():
        # provider form carries a dot (BRK.B); the frame and the flat file use a dash.
        key = t.replace(".", "-")
        if want is not None and key not in want:
            continue
        a = adj.get(t)
        try:
            r, a = float(r), float(a)
        except (TypeError, ValueError):
            continue
        if r > 0.0 and a > 0.0:
            out[key] = a / r
    return out


#: How far `bars.db`'s adjusted close may sit from the provider's for the SAME session
#: before that name's levels are treated as untrustworthy. Deliberately loose: genuine
#: agreement is exact (AAPL 60.5525 vs 60.5525), and the corruption this catches is
#: orders of magnitude, not percent. A missed 2:1 split — 2.0x — is still caught.
LEVEL_COHERENCE_TOL = 0.10


def drop_incoherent_levels(basis: dict, levels_close: dict, day_ts: int,
                           tol: float = LEVEL_COHERENCE_TOL) -> dict:
    """Remove factors for names whose LEVELS disagree with the provider for session D.

    ⛔⛔ A THIRD DEFECT, PRE-EXISTING, AND THE OLD CODE WAS HIDING IT. The basis factor
    puts a price on the provider's adjusted footing; the levels come from `bars.db`. That
    is only one basis while the two sources AGREE, and for a small tail they do not —
    `bars.db` holds badly over-adjusted history for a set of mostly ADR / foreign-listed
    names. Measured on 2011-01-03: CBSH at **0.0001** (traded ~40), BBD 0.0001, DB 1.5171
    (traded ~52); on 2020-03-16: DHR 18.58 (traded ~127), BHP 5.69 (traded ~31.55). Of
    the flagged names, **0 of 64** and **0 of 18** had `bars.db` within 2% of the provider.
    Against a level of 0.0001 every price is a new 52-week high and above every average,
    so these names contributed a spurious bullish vote in EVERY historical session.

    ⚰️ WHY IT WAS INVISIBLE. The first formula divided by the provider's raw close and
    MULTIPLIED BY `bars.db`, so it scaled each price down to meet the corrupt level
    (CBSH would have taken a 2.5e-6 factor). The residual then looked perfect because the
    measurement was fitting the price to the bad level rather than testing it. Making the
    ratio provider-internal removed that camouflage and the tail became visible.

    ⭐ FAIL CLOSED, NOT REPAIRED. This does not fix `bars.db` — that is a separate defect
    with a separate owner. It refuses to publish a comparison whose two sides are provably
    on different footings, which is the same rule `session_ohlc` already applies to a name
    with no factor at all: no basis, no row.
    """
    if not basis or not levels_close:
        return basis
    from api.services import breadth_live as bl
    from api.services import massive
    try:
        adj = massive.get_grouped_daily_closes(bl._iso(day_ts), adjusted=True) or {}
    except Exception:                                  # noqa: BLE001
        return basis                                   # cannot check -> do not prune
    if not adj:
        return basis
    lo, hi = 1.0 - tol, 1.0 + tol
    out = {}
    for t, f in basis.items():
        lv = levels_close.get(t)
        if lv is None:                 # no level for this name -> nothing to disagree
            out[t] = f
            continue
        pa = adj.get(t) or adj.get(t.replace("-", "."))
        try:
            pa = float(pa)
        except (TypeError, ValueError):
            out[t] = f                 # provider silent -> not evidence of incoherence
            continue
        if pa > 0.0 and lo <= (lv / pa) <= hi:
            out[t] = f
    return out


def session_ohlc(D: str, per_ticker: dict, levels: dict,
                 bucket_min: int = 1, members: Optional[set] = None,
                 basis: Optional[dict] = None,
                 eod_prices: Optional[dict] = None) -> Optional[dict]:
    """ONE universe's OHLC from an ALREADY-DOWNLOADED session. The whole math path.

    ⭐⭐ EXTRACTED SO THE EXPENSIVE FILE IS READ ONCE. `recon_day` below is now a thin
    wrapper that downloads and calls this; the combined pass downloads ONE whole-market
    minute file per session and calls this once per universe. That is the only reason
    the extraction exists — there is still exactly ONE implementation of the session
    domain, the carry-forward, the composites and the aggregation, and both callers run
    it. A second copy for the grind is precisely what this avoids.

    `per_ticker` is the resampled minute source; `levels` is a `build_levels` output.

    ⭐ `members` RESTRICTS THE POPULATION WITHOUT RESTRICTING THE LEVELS, which is what
    lets ONE levels build serve four universes. The invariant is the metric engine's
    own, stated in `recompute_from_frame`: *"a 50-day average of a member is the same
    number whoever else is in the frame"* — `build_levels` is per-ticker, so a name's
    MAs and 52-week extremes do not depend on the cohort. `compute_metrics` then
    restricts every metric through its `have = ~isnan(px)` mask, so handing it only the
    members' prices computes exactly that universe.

    ⚠️ WITHOUT IT the prior-close seed would carry EVERY name in `levels` into the
    price map and the universe would silently become the union. `members` is therefore
    applied to the seed AND the carry-forward, not just one of them.

    Returns the per-metric OHLC dict, or None when the session cannot be established.
    """
    from api.services import breadth_session as bsess
    from api.services.breadth_live import compute_metrics

    all_buckets = sorted({b["t"] for bars in per_ticker.values() for b in bars})
    bounds = bsess.rth_bounds(per_ticker)
    if bounds is None:
        return None                      # cannot establish a session — refuse the date
    buckets = bsess.rth_buckets(per_ticker, all_buckets)
    if not buckets:
        return None
    by_tb = {tk: {b["t"]: b["c"] for b in bars} for tk, bars in per_ticker.items()}
    # Seed the carry-forward with each name's PRIOR close so breadth is always computed
    # over the FULL universe. Without it the opening bucket sees only the handful that
    # printed first — a biased fake-low open that becomes a garbage lower wick.
    last_px: dict = {}
    _lv_tk = levels.get("tickers") or []
    _lv_set = _comparable_names(levels)
    _pc = levels.get("prev_close")
    if _pc is not None:
        for _i, _tk in enumerate(_lv_tk):
            try:
                _v = float(_pc[_i])
            except Exception:
                continue
            if _v == _v and _v > 0.0 and (members is None or _tk in members):
                last_px[_tk] = _v
    prices_by_bucket = []
    feed = [tk for tk in per_ticker if members is None or tk in members]
    # ⛔⛔ THE BASIS LIFT. `by_tb` is AS-TRADED (the minute flat file is a raw SIP
    # aggregate); `levels` is SPLIT-ADJUSTED TO THE CURRENT BASIS (`bars.db` is filled
    # from `get_agg_bars`, which requests `adjusted=true`). Comparing one against the
    # other asked "is this as-traded price above an adjusted 50-day average", which is
    # a question about a corporate action, not about breadth. Measured on 2015-08-24:
    # `new_52w_highs` read 184 against a consistent-basis 2, and `pct_above_50sma`
    # 18.7 against 7.5. The error decayed to exactly 0.000 by 2026 because no split
    # has happened yet — which is what identified it.
    #
    # ⭐ MULTIPLYING IS NOT LOOK-AHEAD. `basis` is `adjusted_close(D) / raw_close(D)`,
    # both official closes of THE SAME SESSION, so it carries the cumulative corporate
    # -action factor and no future market information. It is applied per ticker to
    # every one of that ticker's prices, so it cannot move a within-name comparison
    # relative to that name's own levels — it only puts the two on one scale.
    # ⚠️ `basis is None` means the caller asked for NO lift and gets the historical
    # behaviour unchanged. It must never mean "lift by an empty map", which would drop
    # every name in the frame and hand back an empty universe.
    lift = basis is not None
    scale = basis or {}
    for T in buckets:
        for tk in feed:
            px = by_tb[tk].get(T)
            if px is None:
                continue
            if lift:
                f = scale.get(tk)
                if f is None:
                    # ⚠️ FAIL CLOSED, but only where it can matter: a name the levels
                    # frame carries MUST have a basis or its comparisons are
                    # meaningless, so it is dropped. A name absent from the frame has
                    # no level to be inconsistent with and only ever counted toward
                    # `universe_count`, so it passes through at its traded price.
                    if tk in _lv_set:
                        last_px.pop(tk, None)
                        continue
                    f = 1.0
                px = px * f
            last_px[tk] = px
        prices_by_bucket.append(dict(last_px))
    if not prices_by_bucket:
        return None
    # ⭐⭐ THE AUTHORITATIVE CLOSE, not the last minute of the session. `aggregate_day`
    # has always documented `close_val_by_metric` as "the AUTHORITATIVE EOD close per
    # metric"; handing it `prices_by_bucket[-1]` quietly made the body the 15:59
    # cross-section instead, which excludes the closing auction and puts the stored
    # Close on a different footing from every live/close_recon row it will sit beside.
    # `eod_prices` is the official adjusted close for D — the same basis as `levels`.
    #
    # ⛔⛔ AND IT MUST BE THE SAME POPULATION AS THE PATH. The body and the wick of one
    # candle are one measurement; computing C over a wider cohort than O/H/L makes the
    # close a different statistic wearing the same name. This bites the moment anything
    # excludes a name from the path — the fail-closed basis rule does exactly that — and
    # it showed up as a clean signature: `new_52w_lows`, `stage4_count` and `declining`
    # disagreeing with an independent oracle while the rest matched, because the excluded
    # names are precisely the ones a corrupt level parks at a 52-week low.
    close_px = eod_prices if eod_prices else prices_by_bucket[-1]
    if eod_prices:
        close_px = {t: v for t, v in close_px.items()
                    if (members is None or t in members)
                    and (not lift or t in scale or t not in _lv_set)}
    close_m = compute_metrics(levels, close_px) or {}
    _add_composites(close_m)
    close_val = {k: v for k, v in close_m.items() if not k.startswith("_")}
    out = aggregate_day(levels, prices_by_bucket, close_val)
    if out:
        ok, detail = bsess.validate_against_calendar(D, bounds[1])
        out["_session"] = {"open_min": bounds[0], "close_min": bounds[1],
                           "early_close": bsess.is_early_close(bounds[1]),
                           "buckets": len(buckets), "all_hours_buckets": len(all_buckets),
                           "bucket_min": bucket_min,
                           "calendar_ok": ok, "calendar": detail,
                           # ⚠️ INFERENCE IS LABELLED AS INFERENCE. Outside the repo
                           # calendar's era the close is DERIVED and nothing confirmed
                           # it; saying so is the difference between a record and a
                           # claim.
                           "close_basis": ("calendar-confirmed" if "agrees" in detail
                                           else "derived/unverified-by-repo-calendar")}
    return out


def recon_day(D: str, universe: list, client=None, bucket_min: int = 1) -> Optional[dict]:
    """Reconstruct one past day's per-metric OHLC from S3 minute flat files.
    D = 'YYYY-MM-DD'. Thin wrapper: download, then `session_ohlc`. HEAVY."""
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
    # ⛔ THE SAME BASIS LIFT THE COMBINED PASS USES. This is the OTHER caller of the one
    # math path, so leaving it un-lifted would keep writing the F1 defect into the live
    # store every wick sweep while the isolated artifact was correct.
    basis = session_basis(conn, day_ts, universe)
    if not basis:
        return None                      # no basis, no comparison worth storing
    eod_px = session_eod_closes(conn, day_ts, universe)
    basis = drop_incoherent_levels(basis, eod_px, day_ts)
    return session_ohlc(D, res[bucket_min], levels, bucket_min, basis=basis,
                        eod_prices=eod_px)


# ── Prototype validation: recon wicks vs the REAL live-accumulator wicks ─────
_VALIDATE_METRICS = ("pct_above_10sma", "pct_above_20ema", "pct_above_50sma",
                     "pct_above_100sma", "pct_above_200sma",
                     "new_20d_highs", "new_20d_lows")


def validate_recent(days: int = 3, bucket_min: int = 1) -> dict:
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


def probe_day(D: str, bucket_min: int = 1) -> dict:
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
        # Test BOTH the STOCKS key (what Phase 3 needs) and the OPTIONS key (which
        # the flow-worker reads fine on-pod). options-ok + stocks-403 => stocks
        # SUBSCRIPTION scope issue; both-403 => broader access/network problem.
        opt_key = f"us_options_opra/trades_v1/{D[:4]}/{D[5:7]}/{D}.csv.gz"
        for lbl, k in (("stocks", key), ("options", opt_key)):
            try:
                h = client.head_object(Bucket="flatfiles", Key=k)
                out[f"s3_head_{lbl}"] = f"OK bytes={h.get('ContentLength')}"
            except Exception as e:
                out[f"s3_head_{lbl}"] = f"{type(e).__name__}: {str(e)[:120]}"
    except Exception as e:
        out["s3_client_error"] = f"{type(e).__name__}: {str(e)[:200]}"
    return out


def _has_intraday_recon(D: str) -> bool:
    """True if the store already holds an intraday_recon row for D (resume/skip)."""
    from api.services import breadth_daily_ohlc as store
    try:
        with store._conn() as c:
            r = c.execute("SELECT 1 FROM breadth_daily_ohlc WHERE date=? AND "
                          "metric='pct_above_50sma' AND source='intraday_recon' LIMIT 1",
                          (D,)).fetchone()
        return r is not None
    except Exception:
        return False


def _malloc_trim():
    """Return freed heap pages to the OS. numpy/gc free the objects but glibc keeps the
    arena, so RSS climbs across a long sweep until the pod OOM-recycles. No-op off glibc."""
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def preflight(floors: dict, bucket_min: int = 1) -> dict:
    """⛔ REFUSE BEFORE THE EXPENSIVE WORK, not eight hours into it.

    `floors` = {universe: first_iso}. Probes, for each universe's FIRST required
    session, that the whole-market minute flat file actually exists — the one thing
    the methodology report flagged as unverified before 2008 and the one failure that
    is worthless to discover late.

    ⚠️ A HEAD on one key per universe. This is deliberately cheap: the question is
    "does this era exist at all", not "is every session present", and a per-session
    audit costs the same as the job it is meant to precede.
    """
    from api.services import breadth_history_recon as _recon
    out = {"ok": True, "bucket_min": bucket_min, "universes": {}}
    tickers, udate = _recon._resolve_universe()
    out["universe"] = {"count": len(tickers or []), "date": udate,
                       "source": "production _resolve_universe()"}
    if not tickers:
        out["ok"] = False
        out["reason"] = ("the production universe resolver returned nothing — refusing "
                         "rather than sweeping an empty population")
        return out
    client = _s3_client()
    if client is None:
        out["ok"] = False
        out["reason"] = "no S3 client (flat-file credentials absent on this pod)"
        return out
    for uni, first_iso in (floors or {}).items():
        row = {"first_session": first_iso}
        try:
            key = _S3_KEY.format(y=first_iso[:4], m=first_iso[5:7], d=first_iso)
            client.head_object(Bucket="flatfiles", Key=key)
            row["minute_source"] = "present"
        except Exception as e:                       # noqa: BLE001
            row["minute_source"] = f"ABSENT ({type(e).__name__})"
            row["ok"] = False
            out["ok"] = False
        row.setdefault("ok", True)
        out["universes"][uni] = row
    if not out["ok"]:
        out["reason"] = ("a requested universe has no minute source at its floor — STOP "
                         "for that universe rather than synthesising earlier history")
    return out


def sweep_wicks(from_date: str, to_date: str, universe: Optional[list] = None,
                upload_every: int = 10, skip_done: bool = True) -> dict:
    """WORKER sweep: reconstruct real intraday wicks for [from_date, to_date] and write
    them (source='intraday_recon') to the store, newest→oldest, shipping via the R2
    bridge every `upload_every` days. Only rows aggregate_day accepted as real wicks are
    written; a rejected (garbage) wick stays a body (close_recon untouched). Resumable:
    a day already carrying intraday_recon is skipped. HEAVY — worker/bg only."""
    from datetime import date as _d, timedelta as _td
    from api.services import breadth_daily_ohlc as store
    from api.services import breadth_ohlc_sync as sync
    if universe is None:
        # WORKER has no collector snapshot → resolve the SAME universe the web/live
        # rows used (Phase-1 helper fetches web's /universe endpoint when local empty).
        from api.services import breadth_history_recon as _recon
        universe, _ = _recon._resolve_universe()
    if not universe:
        return {"ok": False, "reason": "no universe"}
    import gc as _gc
    import time as _t
    client = _s3_client()
    lo, hi = _d.fromisoformat(from_date), _d.fromisoformat(to_date)
    d = hi
    ok = skipped = failed = written = 0
    samples = []
    while d >= lo:
        if d.weekday() < 5:                       # skip weekends (no flat file)
            D = d.isoformat()
            if skip_done and _has_intraday_recon(D):
                skipped += 1
            else:
                try:
                    agg = recon_day(D, universe, client)
                except Exception:
                    agg = None
                rows = [(D, m, r["o"], r["h"], r["l"], r["c"])
                        for m, r in (agg or {}).items()
                        if r.get("source") == "intraday_recon"] if agg else []
                if rows:
                    written += store.write_bulk(rows, source="intraday_recon")
                    ok += 1
                    p = (agg or {}).get("pct_above_50sma")
                    if p and len(samples) < 8:
                        samples.append({"date": D, "pct_above_50sma_hl": [p["h"], p["l"]]})
                    if upload_every and ok % upload_every == 0:
                        sync.upload(force=True)
                else:
                    failed += 1
                # Free the day's (large) minute-frame + yield, so the worker's memory
                # doesn't accumulate and its /health stays responsive (avoids the
                # Railway recycle we saw on the first run). gc frees the Python objects
                # but glibc keeps the arena → RSS still climbs ~20-30MB/day across a long
                # sweep until OOM; malloc_trim RETURNS the freed pages to the OS.
                del agg, rows
                _gc.collect()
                _malloc_trim()
                _t.sleep(1.0)
        d -= _td(days=1)
    sync.upload(force=True)
    return {"ok": True, "from": from_date, "to": to_date, "days_written": ok,
            "days_skipped": skipped, "days_failed": failed, "rows": written,
            "samples": samples}


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
