"""Kicker + Oops examples, pass 3 (read-only on the pod). Owner rules of 2026-10-24 baked in:

SHARED  universe = liquid and sizable (120-bar average dollar volume >= $20M, close >= $10);
        MUST WORK on the forward strip (no close below the trigger-day low in 20 sessions,
        +8% at the 20-day high, above the trigger close at +10 and +20);
        the trigger day and the prior day look technical, not news-sized.
KICKER  prior red day closes WEAK (DCR <= 0.35), gap 1.5..6% (bigger = a gapper), close >= 80% of
        range, +4..15%, volume >= 1.5x; a base with bunched averages; earnings days are checked
        afterwards (pod_earn_pass3.py) and dropped.
OOPS    location: an orderly multi-day drift (lower highs, >= 3 of the last 5 closes down, ranges
        shrinking), 4..15% off the 20-day high, the low on the 21/50-day or a prior swing low;
        the prior day orderly (gap under 2%, range under 2x ATR, drop under 4%); prefer a red prior
        day; the Oops day under 3x ATR; detector gate uct_oops_reversal.
Prints JSON {scanned, kicker: [...], oops: [...]} with ~40 candidates each for the earnings check.
"""
import json, os, sys, time
from datetime import date

REPO = os.getcwd()
sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_kicker, uct_oops_reversal  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa

BARS = 1500
WINDOW, FORWARD = 120, 20
MIN_GAP = 40
KNOWN = set(ALL_CANDIDATES)


def key_to_iso(k):
    s = str(int(k)); return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def rows_to_bars(rows):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
            for r in rows]


def pct(a, b):
    return (a / b - 1) * 100 if b else 0.0


def _days(k):
    import datetime as _d
    s = str(int(k)); return _d.date(int(s[:4]), int(s[4:6]), int(s[6:8])).toordinal()


def dcr(b):
    r = b["h"] - b["l"]
    return (b["c"] - b["l"]) / r if r > 0 else 0.5


def clean_window(bars, i, window=WINDOW, forward=FORWARD):
    lo, hi = i - window + 1, i + forward
    if lo < 0 or hi >= len(bars) or bars[i]["t"] < 20190101:
        return False
    if _days(bars[hi]["t"]) - _days(bars[lo]["t"]) > (window + forward) * 1.9:
        return False
    for k in range(lo + 1, hi + 1):
        a, b = bars[k - 1], bars[k]
        if a["c"] <= 0 or abs(b["c"] / a["c"] - 1) > 0.60:
            return False
        body = max(b["o"], b["c"]) - min(b["o"], b["c"])
        rng = b["h"] - b["l"]
        if rng > 0 and body > 0 and rng > 12 * body and rng / b["c"] > 0.25:
            return False
    return True


def liquid(bars, i, window=WINDOW):
    w = bars[i - window + 1:i + 1]
    dv = sum(x["c"] * x["v"] for x in w) / len(w)
    return bars[i]["c"] >= 10.0 and dv >= 20_000_000, dv


def works(bars, i):
    """The owner's must-work rule on the forward strip."""
    b = bars[i]
    fwd = bars[i + 1:i + 21]
    if len(fwd) < 20:
        return False, {}
    min_close = min(x["c"] for x in fwd)
    max_high = max(x["h"] for x in fwd)
    f = {"fwd_min_close_vs_trigger_low_pct": round(pct(min_close, b["l"]), 1),
         "fwd_max_gain_pct": round(pct(max_high, b["c"]), 1),
         "fwd_10d_pct": round(pct(bars[i + 10]["c"], b["c"]), 1), "fwd_20d_pct": round(pct(bars[i + 20]["c"], b["c"]), 1)}
    ok = min_close >= b["l"] and f["fwd_max_gain_pct"] >= 8.0 and f["fwd_10d_pct"] > 0 and f["fwd_20d_pct"] > 0
    return ok, f


def kicker_facts(bars, S, i):
    b, p = bars[i], bars[i - 1]
    cc, hh = S["c"], S["h"]
    rng = b["h"] - b["l"]
    j = i - 1
    atr = S["atr"][j] or rng or 1e-9
    v50 = S["v50"][j]
    f = {"prior_red": p["c"] < p["o"], "prior_dcr": round(dcr(p), 2), "prior_range_atr": round((p["h"] - p["l"]) / atr, 2),
         "gap_pct": round(pct(b["o"], p["c"]), 2), "day_pct": round(pct(b["c"], p["c"]), 2), "green": b["c"] > b["o"],
         "close_above_prior_high": b["c"] > p["h"], "close_pos": round(dcr(b), 2), "range_atr": round(rng / atr, 2),
         "rvol": round(b["v"] / v50, 2) if v50 else None}
    cand = (f["prior_red"] and f["prior_dcr"] <= 0.35 and f["prior_range_atr"] <= 2.5 and 1.5 <= f["gap_pct"] <= 6.0
            and f["green"] and f["close_above_prior_high"] and f["close_pos"] >= 0.8 and 4.0 <= f["day_pct"] <= 15.0
            and (f["rvol"] or 0) >= 1.5 and f["range_atr"] <= 4.0)
    s50, s200, e8, e21 = S["s50"][j], S["s200"][j], S["e8"][j], S["e21"][j]
    if not (s50 and s200 and e8 and e21):
        return False, 0, f
    s50_prev, s200_prev = S["s50"][j - 20], S["s200"][j - 20]
    f["above_200"] = p["c"] > s200; f["above_50"] = p["c"] > s50
    f["sma50_rising"] = bool(s50_prev) and s50 >= s50_prev * 0.995
    f["sma200_rising"] = bool(s200_prev) and s200 >= s200_prev * 0.995
    vals = [e8, e21, s50]
    f["ma_spread_pct"] = round((max(vals) - min(vals)) / p["c"] * 100, 2)
    base20 = cc[i - 20:i]
    f["base20_range_pct"] = round((max(base20) - min(base20)) / p["c"] * 100, 1)
    f["pullback_to_ma"] = min(abs(p["c"] - e21), abs(p["c"] - s50)) / atr <= 1.5
    f["breakout20"] = b["c"] > max(hh[i - 20:i])
    f["ext_vs_sma50_pct"] = round(pct(b["c"], s50), 1)
    f["downtrend"] = (p["c"] < s200) and not f["sma50_rising"]
    sc = 0
    sc += 2 if f["above_200"] else 0
    sc += 1 if f["above_50"] else 0
    sc += 1 if f["sma50_rising"] else 0
    sc += 1 if f["sma200_rising"] else 0
    sc += 2 if f["ma_spread_pct"] <= 5 else (1 if f["ma_spread_pct"] <= 8 else 0)
    sc += 2 if f["base20_range_pct"] <= 15 else (1 if f["base20_range_pct"] <= 25 else 0)
    sc += 1 if f["pullback_to_ma"] else 0
    sc += 2 if f["breakout20"] else 0
    sc += 1 if f["ext_vs_sma50_pct"] <= 15 else 0
    sc += 1 if f["prior_dcr"] <= 0.2 else 0
    sc += 1 if (f["rvol"] or 0) >= 2.5 else 0
    f["setup_score"] = sc
    ok = cand and not f["downtrend"] and f["ext_vs_sma50_pct"] <= 30 and sc >= 9
    return ok, sc, f


def oops_facts(bars, S, i):
    b, p, p2 = bars[i], bars[i - 1], bars[i - 2]
    cc, hh, ll = S["c"], S["h"], [x["l"] for x in bars]
    rng = b["h"] - b["l"]
    j = i - 1
    atr = S["atr"][j] or rng or 1e-9
    v50 = S["v50"][j]
    f = {"scanner": b["o"] < p["c"] and b["l"] < p["l"] and b["c"] > p["c"], "williams": b["o"] < p["l"], "super": b["c"] > p["h"],
         "open_vs_prior_low_pct": round(pct(b["o"], p["l"]), 2), "day_pct": round(pct(b["c"], p["c"]), 2),
         "close_pos": round(dcr(b), 2), "range_atr": round(rng / atr, 2), "rvol": round(b["v"] / v50, 2) if v50 else None,
         "prior_red": p["c"] < p["o"], "prior_gap_pct": round(pct(p["o"], p2["c"]), 2), "prior_range_atr": round((p["h"] - p["l"]) / atr, 2),
         "prior_drop_pct": round(pct(p["c"], p2["c"]), 2)}
    f["variant"] = "super" if f["super"] else ("williams+scanner" if f["williams"] else "scanner")
    cand = (f["scanner"] and f["day_pct"] >= 2.0 and f["close_pos"] >= 0.7 and f["range_atr"] <= 3.0
            and abs(f["prior_gap_pct"]) < 2.0 and f["prior_range_atr"] <= 2.0 and f["prior_drop_pct"] > -4.0)
    s50, s200, e8, e21 = S["s50"][j], S["s200"][j], S["e8"][j], S["e21"][j]
    if not (s50 and s200 and e8 and e21):
        return False, 0, f
    s50_prev, s200_prev = S["s50"][j - 20], S["s200"][j - 20]
    f["above_200"] = p["c"] > s200
    f["sma50_rising"] = bool(s50_prev) and s50 >= s50_prev * 0.995
    hi20 = max(hh[i - 20:i])
    f["pullback_pct"] = round(-pct(p["c"], hi20), 1)
    # location: an orderly drift the days before
    last5 = bars[i - 5:i]
    f["down_closes_last5"] = sum(1 for k in range(i - 5, i) if cc[k] < cc[k - 1])
    f["lower_highs_last5"] = sum(1 for k in range(i - 4, i) if hh[k] < hh[k - 1])
    r3 = sum(x["h"] - x["l"] for x in bars[i - 3:i]) / 3
    r10 = sum(x["h"] - x["l"] for x in bars[i - 13:i - 3]) / 10
    f["ranges_shrinking"] = r3 <= r10 * 1.05
    f["drift_days"] = 0
    k = i - 1
    while k > i - 15 and cc[k] <= max(cc[k - 3:k]) and hh[k] <= max(hh[k - 3:k]):
        f["drift_days"] += 1; k -= 1
    f["low_near_ma"] = min(abs(b["l"] - e21), abs(b["l"] - s50)) / atr <= 1.0
    swing_lows = [ll[k] for k in range(i - 60, i - 5) if ll[k] <= min(ll[k - 3:k + 4])]
    f["low_near_swing_low"] = any(abs(b["l"] - sl) / atr <= 1.0 for sl in swing_lows)
    f["reclaims_e21"] = bool(S["e21"][i]) and b["c"] > S["e21"][i]
    f["ext_vs_sma50_pct"] = round(pct(b["c"], s50), 1)
    f["downtrend"] = (p["c"] < s200) and not f["sma50_rising"]
    pb = f["pullback_pct"]
    sc = 0
    sc += 2 if f["above_200"] else 0
    sc += 1 if f["sma50_rising"] else 0
    sc += 2 if 4 <= pb <= 15 else (1 if 2.5 <= pb <= 22 else 0)
    sc += 2 if f["down_closes_last5"] >= 3 else 0
    sc += 1 if f["lower_highs_last5"] >= 3 else 0
    sc += 1 if f["ranges_shrinking"] else 0
    sc += 1 if f["drift_days"] >= 4 else 0
    sc += 2 if f["low_near_ma"] else 0
    sc += 1 if f["low_near_swing_low"] else 0
    sc += 1 if f["reclaims_e21"] else 0
    sc += 1 if f["prior_red"] else 0
    sc += 1 if f["close_pos"] >= 0.85 else 0
    sc += 1 if (f["rvol"] or 0) >= 1.5 else 0
    f["setup_score"] = sc
    ok = cand and not f["downtrend"] and -5 <= f["ext_vs_sma50_pct"] <= 20 and sc >= 11 and f["down_closes_last5"] >= 3
    return ok, sc, f


def main():
    t0 = time.time()
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = list(dict.fromkeys(ALL_CANDIDATES + uni))
    today = int(date.today().strftime("%Y%m%d"))
    out = {"kicker": [], "oops": []}
    scanned = 0
    for sym in syms:
        try:
            rows = bars_sqlite.get_bars_before(sym, "D", BARS, today)
        except Exception:
            continue
        if len(rows) < 400:
            continue
        bars = rows_to_bars(rows)
        if bars[-1]["t"] < today - 100:
            continue
        scanned += 1
        S = U.series(bars)
        for name, mod, fn in (("kicker", uct_kicker, kicker_facts), ("oops", uct_oops_reversal, oops_facts)):
            last_i = -10_000
            for i in range(260, len(bars) - FORWARD - 1):
                if i - last_i < MIN_GAP:
                    continue
                try:
                    c = mod.evaluate(bars, S, i)
                except Exception:
                    c = None
                if not c:
                    continue
                ok, sc, f = fn(bars, S, i)
                if not ok:
                    continue
                lq, dv = liquid(bars, i)
                if not lq or not clean_window(bars, i):
                    continue
                w_ok, wf = works(bars, i)
                if not w_ok:
                    continue
                f.update(wf); f["avg_dollar_volume_m"] = round(dv / 1e6, 1); f["known_name"] = sym in KNOWN
                q = sc + (1.5 if sym in KNOWN else 0) + min(dv / 1e6, 200) / 400.0
                out[name].append({"sym": sym, "asof": key_to_iso(bars[i]["t"]), "year": int(str(bars[i]["t"])[:4]),
                                  "close": bars[i]["c"], "facts": f, "q": round(q, 2)})
                last_i = i
    import datetime as _dt
    def dnum(a): return _dt.date.fromisoformat(a).toordinal()
    res = {"generated": date.today().isoformat(), "scanned": scanned, "seconds": round(time.time() - t0)}
    for name in ("kicker", "oops"):
        rows = sorted(out[name], key=lambda r: (-r["q"], r["asof"]))
        picked, per_sym, per_year, per_var = [], {}, {}, {}
        for r in rows:
            var = r["facts"].get("variant", "-")
            if per_sym.get(r["sym"], 0) >= 1 or per_year.get(r["year"], 0) >= 10 or per_var.get(var, 0) >= 16:
                continue
            if any(abs(dnum(r["asof"]) - dnum(p["asof"])) < 10 for p in picked):
                continue
            picked.append(r); per_sym[r["sym"]] = 1
            per_year[r["year"]] = per_year.get(r["year"], 0) + 1; per_var[var] = per_var.get(var, 0) + 1
            if len(picked) >= 40:
                break
        res[name] = picked; res[name + "_passing"] = len(rows)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
