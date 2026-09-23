"""INDEPENDENT ORACLE for the corrected V2 breadth methodology.

⭐ WHAT IS INDEPENDENT. Nothing on the computation path imports the pass's code:
  - the minute file is read with pandas, not `download_and_resample`
  - session bounds are recomputed from participation here
  - levels are built with pandas rolling/EWM, not `build_levels`
  - the corporate-action factor, the path replay, the close cross-section, the
    composites and the path-quality rule are re-implemented from the stated spec
⚠️ WHAT IS SHARED, AND SAID SO. Inputs only: the provider minute files, the provider
grouped daily files already on the volume, the provider reference map, the pinned UCT
list, and `breadth_pit_frame.resolve` + `breadth_universes.venues` for MEMBERSHIP (a
definition, verified separately by comparing universe sizes to `pass_session`).

MODES
  faithful  reproduce the implementation's ticker handling exactly (grouped/basis keys
            dot->dash, minute/member keys verbatim). Used for exact-match testing.
  spec      normalise every source to one spelling, so dual-class names (BRK.B) get
            levels, a factor and a close. Used to measure the dot/dash defect.
"""
from __future__ import annotations

import io
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, "/app")
from common import GROUPED, PINNED_UCT, calendar

FRAME = 380
SMA = (5, 10, 40, 50, 100, 150, 200)
PERIODS = (("up_4pct_today", "down_4pct_today", 1, 0.04),
           ("up_20pct_5d", "down_20pct_5d", 5, 0.20),
           ("up_25pct_quarter", "down_25pct_quarter", 65, 0.25),
           ("up_25pct_month", "down_25pct_month", 21, 0.25),
           ("up_50pct_month", "down_50pct_month", 21, 0.50),
           ("magna_up", "magna_down", 34, 0.13))
RULE = {"max_jump_frac": 0.45, "pop_jump_frac": 0.15, "top3_jump_frac": 1.00,
        "min_abs_jump": 5.0, "min_range": 5.0}
PCT = ("pct_above_5sma", "pct_above_10sma", "pct_above_20ema", "pct_above_40sma",
       "pct_above_50sma", "pct_above_100sma", "pct_above_200sma", "hi_ratio", "lo_ratio")

_GCACHE: dict = {}
_CAL = None


def _cal():
    global _CAL
    if _CAL is None:
        _CAL = calendar()
    return _CAL


def grouped_raw(iso: str, adjusted: bool) -> dict:
    """Provider file verbatim (provider spelling, e.g. BRK.B)."""
    k = (iso, adjusted)
    if k not in _GCACHE:
        try:
            with open(os.path.join(GROUPED, "%s_%d.json" % (iso, 1 if adjusted else 0))) as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        _GCACHE[k] = {kk: float(v) for kk, v in d.items()
                      if isinstance(v, (int, float)) and v > 0}
        if len(_GCACHE) > 900:
            for kk in list(_GCACHE)[:200]:
                _GCACHE.pop(kk, None)
    return _GCACHE[k]


def dashed(d: dict) -> dict:
    return {k.replace(".", "-"): v for k, v in d.items()}


# ── minute file ──────────────────────────────────────────────────────────────
def s3():
    from api.services import breadth_wick_recon as wr      # credentials only
    return wr._s3_client()


def load_minutes(D: str, client=None) -> pd.DataFrame:
    client = client or s3()
    key = "us_stocks_sip/minute_aggs_v1/%s/%s/%s.csv.gz" % (D[:4], D[5:7], D)
    body = client.get_object(Bucket="flatfiles", Key=key)["Body"].read()
    df = pd.read_csv(io.BytesIO(body), compression="gzip", keep_default_na=False,
                     dtype={"ticker": str}, usecols=["ticker", "close", "window_start"])
    et = pd.to_datetime(df["window_start"], unit="ns", utc=True).dt.tz_convert("America/New_York")
    df["m"] = (et.dt.hour * 60 + et.dt.minute).astype(np.int32)
    df["t"] = (df["window_start"] // 1_000_000_000).astype(np.int64)
    return df[["ticker", "t", "m", "close"]]


def session_geometry(df: pd.DataFrame) -> dict:
    part = df.groupby("m")["ticker"].nunique()
    inside = part[(part.index >= 570) & (part.index <= 960)]
    busiest = int(inside.max())
    floor = busiest * 0.15
    busy = sorted(int(m) for m, n in inside.items() if n >= floor)
    close_min = busy[-1]
    last_bar = close_min - 1
    mins_present = sorted(int(m) for m in part.index if 570 <= m <= last_bar)
    full = list(range(570, last_bar + 1))
    return {"busiest": busiest, "floor": floor, "close_min": close_min,
            "last_bar": last_bar, "buckets": len(mins_present),
            "missing_minutes": sorted(set(full) - set(mins_present)),
            "participation_edge": {int(m): int(part.get(m, 0))
                                   for m in list(range(565, 575)) + list(range(775, 786))
                                   + list(range(955, 966))},
            "minutes": mins_present}


# ── membership ───────────────────────────────────────────────────────────────
_REF = None
_UCT = None


def membership(D: str, traded: set) -> dict:
    global _REF, _UCT
    from api.services import breadth_pit_frame as bpf
    from api.services import breadth_universes as bu
    if _REF is None:
        _REF = bpf.reference_map()
        _UCT = json.load(open(PINNED_UCT))["tickers"]
    out = {"uct": [t for t in _UCT if t in traded]}
    for u in ("us", "nasdaq", "nyse"):
        out[u] = []
    for t in traded:
        rec = bpf.resolve(_REF.get(t), D)
        if rec is None or rec.get("type") not in bpf.COMMON_TYPES:
            continue
        ex = (rec.get("primary_exchange") or "").upper()
        if not ex:
            continue
        for u in ("us", "nasdaq", "nyse"):
            if ex in bu.venues(u):
                out[u].append(t)
    return out


# ── levels (pandas, independent of build_levels) ─────────────────────────────
def _ema_production_recursion(C: np.ndarray, a: float) -> np.ndarray:
    """Re-statement of the recursion `breadth_live._ewm_last` actually runs (old_wt += a
    after an observation). Written here from its source, NOT imported, so the oracle can
    prove that the stored pct_above_20ema follows THIS and not pandas adjust=False."""
    n, m = C.shape
    out = np.full(n, np.nan); w = np.ones(n)
    for j in range(m):
        col = C[:, j]; ok = ~np.isnan(col)
        seed = ok & np.isnan(out)
        out[seed] = col[seed]; w[seed] = 1.0
        step = ~np.isnan(out) & ~seed
        w[step] *= (1.0 - a)
        upd = step & ok
        out[upd] = (w[upd] * out[upd] + a * col[upd]) / (w[upd] + a)
        w[upd] += a
    return out


def levels(names: list, D: str, mode: str) -> dict:
    cal = _cal()
    i = cal.index(D) if D in cal else None
    import bisect
    hi = bisect.bisect_left(cal, D)
    dates = cal[max(0, hi - FRAME):hi]
    key = (lambda t: t) if mode == "spec" else (lambda t: t)
    cols = []
    for iso in dates:
        g = grouped_raw(iso, True)
        g = dashed(g)                                    # the grouped store is dash-keyed
        look = [(t.replace(".", "-") if mode.startswith("spec") else t) for t in names]
        cols.append([g.get(k, np.nan) for k in look])
    C = np.ascontiguousarray(np.array(cols, dtype=float).T)   # names x dates, row-contiguous
    df = pd.DataFrame(C)
    L = {"names": names, "dates": (dates[0], dates[-1], len(dates))}
    L["prev"] = C[:, -1]
    for w in SMA:
        tail = C[:, -(w - 1):]
        L["ok%d" % w] = ~np.isnan(tail).any(axis=1)
        L["sum%d" % w] = np.nansum(tail, axis=1)
    if mode.endswith("prodema"):
        L["ema"] = _ema_production_recursion(C, 2.0 / 21)
    else:
        L["ema"] = df.T.ewm(alpha=2.0 / 21, adjust=False, ignore_na=False).mean().iloc[-1].to_numpy()
    for b in sorted({p[2] for p in PERIODS}):
        L["back%d" % b] = C[:, -b]
    for nm, w in (("52", 251), ("20", 19)):
        tail = C[:, -w:]
        ok = ~np.isnan(tail).any(axis=1)
        L["max" + nm] = np.where(ok, np.nanmax(np.where(np.isnan(tail), -np.inf, tail), axis=1), np.nan)
        L["min" + nm] = np.where(ok, np.nanmin(np.where(np.isnan(tail), np.inf, tail), axis=1), np.nan)
        L["ok" + nm] = ok
    win = C[:, -220:-20]
    L["s200b21"] = np.where(~np.isnan(win).any(axis=1), win.sum(axis=1) / 200.0, np.nan)
    # comparable = "has something to be inconsistent with"
    comp = np.zeros(len(names), bool)
    for k in ("ok52", "ok20") + tuple("ok%d" % w for w in SMA):
        comp |= L[k]
    comp |= np.isfinite(L["prev"]) & (L["prev"] > 0)
    comp |= np.isfinite(L["ema"]) & (L["ema"] > 0)
    L["comparable"] = comp
    return L


def _r1(x):
    return None if x is None else round(float(x), 1)


def metrics_matrix(L: dict, P: np.ndarray) -> dict:
    """Every metric for every column of P (names x T). Returns {metric: list}."""
    have = np.isfinite(P) & (P > 0)
    P = np.where(have, P, np.nan)
    T = P.shape[1]
    out = {}
    uni = have.sum(axis=0)
    out["universe_count"] = uni.astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        for w in (5, 10, 40, 50, 100, 200):
            sma = (L["sum%d" % w][:, None] + P) / w
            valid = have & L["ok%d" % w][:, None] & np.isfinite(sma)
            above = (P > sma) & valid
            tot = valid.sum(axis=0)
            out["pct_above_%dsma" % w] = [(_r1(a / t * 100) if t else None)
                                          for a, t in zip(above.sum(axis=0), tot)]
        e = L["ema"][:, None]
        valid = have & np.isfinite(e)
        tot = valid.sum(axis=0)
        above = ((P > e) & valid).sum(axis=0)
        out["pct_above_20ema"] = [(_r1(a / t * 100) if t else None) for a, t in zip(above, tot)]
        for up, dn, b, th in PERIODS:
            past = L["back%d" % b][:, None]
            past = np.where(past == 0, np.nan, past)
            ret = (P - past) / past
            v = np.isfinite(ret)
            out[up] = ((ret >= th) & v).sum(axis=0).astype(float)
            out[dn] = ((ret <= -th) & v).sum(axis=0).astype(float)
        for nm, key_hi, key_lo in (("52w", "max52", "min52"), ("20d", "max20", "min20")):
            ok = L["ok52" if nm == "52w" else "ok20"][:, None]
            mx, mn = L[key_hi][:, None], L[key_lo][:, None]
            out["new_%s_highs" % nm] = ((P >= mx * 0.999) & have & ok & np.isfinite(mx)).sum(axis=0).astype(float)
            out["new_%s_lows" % nm] = ((P <= mn * 1.001) & have & ok & np.isfinite(mn)).sum(axis=0).astype(float)
        mx = L["max52"][:, None]
        high = np.fmax(mx, P)
        valid = have & L["ok52"][:, None] & np.isfinite(high) & (high > 0)
        dist = (high - P) / high
        out["near_52w_high"] = ((dist <= 0.05) & valid).sum(axis=0).astype(float)
        s50 = (L["sum50"][:, None] + P) / 50
        s150 = (L["sum150"][:, None] + P) / 150
        s200 = (L["sum200"][:, None] + P) / 200
        s2p = L["s200b21"][:, None]
        valid = have & L["ok50"][:, None] & L["ok150"][:, None] & L["ok200"][:, None] & np.isfinite(s2p)
        out["stage2_count"] = ((P > s50) & (s50 > s150) & (s150 > s200) & (s200 > s2p) & valid).sum(axis=0).astype(float)
        out["stage4_count"] = ((P < s50) & (s50 < s150) & (s150 < s200) & (s200 < s2p) & valid).sum(axis=0).astype(float)
        prev = L["prev"][:, None]
        base = np.where((prev == 0) | np.isnan(prev), np.nan, prev)
        chg = (P - base) / base
        v = np.isfinite(chg)
        adv = ((chg > 0) & v).sum(axis=0).astype(float)
        dec = ((chg < 0) & v).sum(axis=0).astype(float)
        out["advancing"], out["declining"], out["adv_decline"] = adv, dec, adv - dec
    nh, nl = out["new_52w_highs"], out["new_52w_lows"]
    out["net_new_high_low"] = nh - nl
    out["hi_ratio"] = [(round(float(h) / float(u) * 100.0, 4) if u > 0 else None) for h, u in zip(nh, uni)]
    out["lo_ratio"] = [(round(float(l) / float(u) * 100.0, 4) if u > 0 else None) for l, u in zip(nl, uni)]
    return {k: [None if (x is None or (isinstance(x, float) and math.isnan(x))) else float(x) for x in v]
            for k, v in out.items()}


def path_quality(series: list, pop_jump_frac: float) -> tuple:
    vals = [v for v in series if v is not None]
    jumps = sorted((abs(b - a) for a, b in zip(vals, vals[1:])), reverse=True) + [0.0, 0.0, 0.0]
    return jumps[0], jumps[0] + jumps[1] + jumps[2]


def jump_profile(series: list, mins: list) -> dict:
    """Where the largest bucket move sits, and how often the path reverses — the
    diagnostic that separates an opening gap / threshold flicker from corruption."""
    pts = [(m, v) for m, v in zip(mins, series) if v is not None]
    js = [(abs(b[1] - a[1]), a[0], b[0], a[1], b[1]) for a, b in zip(pts, pts[1:])]
    js.sort(reverse=True)
    d = [b[1] - a[1] for a, b in zip(pts, pts[1:]) if b[1] != a[1]]
    rev = sum(1 for x, y in zip(d, d[1:]) if (x > 0) != (y > 0))
    return {"top_jumps": [(round(j, 4), m0, m1, v0, v1) for j, m0, m1, v0, v1 in js[:3]],
            "first_move_is_max": bool(js and js[0][1] == pts[0][0]),
            "moves": len(d), "reversals": rev,
            "range": (min(v for _, v in pts), max(v for _, v in pts)) if pts else None}


def replay(D: str, universes=("uct", "us", "nasdaq", "nyse"), mode: str = "faithful",
           df: pd.DataFrame = None, last_bar_override: int = None,
           close_variant: str = "grouped", extra: dict = None,
           per_universe_geometry: bool = True) -> dict:
    """Recompute one session's candles for each universe. Returns {u: {metric: ohlc}}."""
    t0 = time.time()
    df = load_minutes(D) if df is None else df
    geo = session_geometry(df)
    last_bar = geo["last_bar"] if last_bar_override is None else last_bar_override
    mins = sorted(int(m) for m in df["m"].unique() if 570 <= m <= last_bar)
    col = {m: j for j, m in enumerate(mins)}
    rth = df[(df["m"] >= 570) & (df["m"] <= last_bar)]
    traded = set(df["ticker"].unique())
    mem = membership(D, traded)
    union = sorted({t for u in universes for t in mem[u]})
    L = levels(union, D, mode)
    idx = {t: i for i, t in enumerate(union)}
    adj_D, raw_D = grouped_raw(D, True), grouped_raw(D, False)
    if mode.startswith("spec"):
        fkey = lambda t: t
        adj_n, raw_n = adj_D, raw_D
        eod = {t: adj_D[t] for t in union if t in adj_D}
        factor = {t: adj_D[t] / raw_D[t] for t in union if t in adj_D and t in raw_D}
    else:                                   # the implementation: dash-keyed grouped side
        a, r = dashed(adj_D), dashed(raw_D)
        eod = {t: a[t] for t in union if t in a}               # dot names miss here
        factor = {t: a[t] / r[t] for t in union if t in a and t in r}
    res = {"_geometry": {k: v for k, v in geo.items() if k != "minutes"},
           "_last_bar_used": last_bar, "_union": len(union),
           "_frame": L["dates"], "_sizes": {u: len(mem[u]) for u in universes}}
    comp = L["comparable"]
    for u in universes:
        names = mem[u]
        if not names:
            continue
        rows = np.array([idx[t] for t in names])
        # ⭐ THE SESSION WINDOW IS DERIVED PER UNIVERSE, FROM ITS OWN MEMBERS' BARS —
        # the pass hands `session_ohlc` only the members, so `rth_bounds` and the bucket
        # set are computed over them, not over the whole file.
        dfu = df[df["ticker"].isin(set(names))]
        gu = session_geometry(dfu) if per_universe_geometry else geo
        lb = gu["last_bar"] if last_bar_override is None else last_bar_override
        mins_u = sorted(int(m) for m in dfu["m"].unique() if 570 <= m <= lb)
        colu = {m: j for j, m in enumerate(mins_u)}
        rel = {t: k for k, t in enumerate(names)}
        subu = dfu[(dfu["m"] >= 570) & (dfu["m"] <= lb)]
        R = np.full((len(names), len(mins_u)), np.nan)
        R[subu["ticker"].map(rel).to_numpy(), subu["m"].map(colu).to_numpy()] = subu["close"].to_numpy()
        seed = L["prev"][rows]
        f = np.array([factor.get(t, np.nan) for t in names])
        cmp_ = comp[rows]
        nofac = np.isnan(f)
        S = np.where(np.isfinite(seed) & (seed > 0), seed, np.nan)
        mult = np.where(nofac, 1.0, f)
        Q = np.where(np.isfinite(R), R * mult[:, None], np.nan)
        P = pd.DataFrame(np.concatenate([S[:, None], Q], axis=1)).ffill(axis=1).to_numpy()[:, 1:].copy()
        for k in np.where(nofac & cmp_)[0]:
            # a comparable name with no factor: carried at its seed until its first
            # regular-session print, dropped there, never re-admitted
            printed = np.where(np.isfinite(R[k]))[0]
            stop = printed[0] if len(printed) else R.shape[1]
            P[k, :] = np.nan
            P[k, :stop] = S[k]
        Lu = {kk: (vv[rows] if isinstance(vv, np.ndarray) and vv.shape[:1] == (len(union),) else vv)
              for kk, vv in L.items()}
        path = metrics_matrix(Lu, P)
        pop = np.isfinite(P).sum(axis=0)
        pjf = (np.abs(np.diff(pop)).max() / max(pop.max(), 1)) if len(pop) > 1 else 0.0
        # the close cross-section
        if close_variant == "grouped":
            cpx = np.array([eod.get(t, np.nan) if (not nofac[k] or not cmp_[k]) else np.nan
                            for k, t in enumerate(names)])
        elif close_variant == "last_minute":
            cpx = P[:, -1]
        else:                                    # a caller-supplied {ticker: price}
            cv = extra[close_variant]
            cpx = np.array([cv.get(t, np.nan) for t in names])
        close = metrics_matrix(Lu, cpx[:, None])
        out = {}
        for m, ser in path.items():
            vals = [v for v in ser if v is not None]
            c = close[m][0]
            if not vals or c is None:
                continue
            o, h, l = vals[0], max(vals), min(vals)
            h, l = max(h, o, c), min(l, o, c)
            mj, t3 = path_quality(ser, pjf)
            rng = h - l
            reason = None
            if pjf > RULE["pop_jump_frac"]:
                reason = "population discontinuity %.3f" % pjf
            elif rng > 0 and mj / rng > RULE["max_jump_frac"] and mj >= RULE["min_abs_jump"]:
                reason = "single bucket dominates %.1f/%.1f" % (mj, rng)
            elif rng > 0 and t3 / rng > RULE["top3_jump_frac"] and rng >= RULE["min_range"]:
                reason = "zig-zag top3 %.1f/%.1f" % (t3, rng)
            if reason:
                out[m] = {"o": round(c, 4), "h": round(c, 4), "l": round(c, 4), "c": round(c, 4),
                          "src": "body", "reason": reason,
                          "withheld_path": {"o": round(o, 4), "h": round(h, 4), "l": round(l, 4)},
                          "profile": jump_profile(ser, mins_u)}
            else:
                out[m] = {"o": round(o, 4), "h": round(h, 4), "l": round(l, 4), "c": round(c, 4),
                          "src": "path"}
        out["_geometry"] = {"close_min": gu["close_min"], "last_bar": lb, "buckets": len(mins_u),
                            "busiest": gu["busiest"], "missing_minutes": gu["missing_minutes"],
                            "participation_edge": gu["participation_edge"]}
        out["_pop"] = {"open": int(pop[0]), "max": int(pop.max()), "min": int(pop.min()),
                       "last": int(pop[-1]), "close": int(np.isfinite(cpx).sum()),
                       "pop_jump_frac": round(float(pjf), 4),
                       "members": len(names), "no_factor": int(nofac.sum()),
                       "no_factor_comparable": int((nofac & cmp_).sum()),
                       "dot_names": sum(1 for t in names if "." in t),
                       "comparable": int(cmp_.sum())}
        res[u] = out
    res["_seconds"] = round(time.time() - t0, 1)
    return res
