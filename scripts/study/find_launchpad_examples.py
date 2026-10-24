"""Launchpad pass 3 (read-only on the pod): the owner's picture from the 2026-10-24 review, scored directly.

THE PICTURE (owner): after a real correction the 8/21/50-day chunk up into a bundle near the 200-day; price hangs
UNDER or ON the bundle, then DANGLES just above it and retests it a few times; then it gets above the launchpad as
the averages stack into 9>20>50 alignment. The trigger need not be a 20-day breakout (WDAY). Template: MSTR
2023-10-23. Not: a stock already riding on top of its averages in an uptrend (GOOGL), a wide sloppy base (INTC).

Scores: correction depth, bundle tightness (now and over the prior 10 sessions), sessions spent under/at the
bundle in the prior 30, touches of the bundle in the prior 15 (closes within 1 ATR of the 21/50), the dangle
(closes just above the bundle, within 0..4%, in the prior 8), base tightness, trigger day strong (>= 2%, close
>= 70%, volume >= 1.3x), 9>20>50 order on the trigger day, must-work (low never broken, +8%, up at +10/+20).
Liquid universe; skips the syms already reviewed.
"""
import json, os, sys, time
from datetime import date

REPO = os.getcwd()
sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa

BARS = 1500
WINDOW, FORWARD = 120, 20
MIN_GAP = 40
KNOWN = set(ALL_CANDIDATES)
SEEN = {"MSTR", "TEAM", "ARKK", "PEP", "ADBE", "GE", "WDAY", "NOW", "BIDU", "INTC", "BABA", "DDOG", "GOOGL", "CAT", "F",
        "PANW", "LMT", "AMAT", "BA", "WMT", "SMCI", "XLF", "CIEN", "UNH", "NET"}


def key_to_iso(k):
    s = str(int(k)); return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def rows_to_bars(rows):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])} for r in rows]


def pct(a, b):
    return (a / b - 1) * 100 if b else 0.0


def _days(k):
    import datetime as _d
    s = str(int(k)); return _d.date(int(s[:4]), int(s[4:6]), int(s[6:8])).toordinal()


def dcr(b):
    r = b["h"] - b["l"]; return (b["c"] - b["l"]) / r if r > 0 else 0.5


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
        body = max(b["o"], b["c"]) - min(b["o"], b["c"]); rng = b["h"] - b["l"]
        if rng > 0 and body > 0 and rng > 12 * body and rng / b["c"] > 0.25:
            return False
    return True


def liquid(bars, i, window=WINDOW):
    w = bars[i - window + 1:i + 1]
    dv = sum(x["c"] * x["v"] for x in w) / len(w)
    return bars[i]["c"] >= 10.0 and dv >= 20_000_000, dv


def works(bars, i):
    b = bars[i]; fwd = bars[i + 1:i + 21]
    if len(fwd) < 20:
        return False, {}
    min_low = min(x["l"] for x in fwd); max_high = max(x["h"] for x in fwd)
    f = {"fwd_min_low_vs_trigger_low_pct": round(pct(min_low, b["l"]), 1), "fwd_max_gain_pct": round(pct(max_high, b["c"]), 1),
         "fwd_5d_pct": round(pct(bars[i + 5]["c"], b["c"]), 1), "fwd_10d_pct": round(pct(bars[i + 10]["c"], b["c"]), 1),
         "fwd_20d_pct": round(pct(bars[i + 20]["c"], b["c"]), 1)}
    ok = min_low >= b["l"] * 0.99 and f["fwd_max_gain_pct"] >= 8.0 and f["fwd_10d_pct"] > 0 and f["fwd_20d_pct"] > 0
    return ok, f


def facts(bars, S, i):
    b, p = bars[i], bars[i - 1]
    cc, hh = S["c"], S["h"]; j = i - 1
    rng = b["h"] - b["l"]; atr = S["atr"][j] or rng or 1e-9; v50 = S["v50"][j]
    s50, s200, e8, e21 = S["s50"][j], S["s200"][j], S["e8"][j], S["e21"][j]
    if not (s50 and s200 and e8 and e21):
        return False, 0, {}
    hi120 = max(hh[i - 120:i - 60]); lo60 = min(cc[i - 60:i])
    f = {"correction_pct": round(pct(lo60, hi120), 1), "ma_spread_pct": round((max(e8, e21, s50) - min(e8, e21, s50)) / p["c"] * 100, 2),
         "s200_dist_pct": round(abs(pct(p["c"], s200)), 1), "above_200": p["c"] > s200}
    f["base30_range_pct"] = round((max(cc[i - 30:i]) - min(cc[i - 30:i])) / p["c"] * 100, 1)
    f["base15_range_pct"] = round((max(cc[i - 15:i]) - min(cc[i - 15:i])) / p["c"] * 100, 1)
    f["day_pct"] = round(pct(b["c"], p["c"]), 2); f["close_pos"] = round(dcr(b), 2)
    f["breakout20"] = b["c"] > max(hh[i - 20:i]); f["rvol"] = round(b["v"] / v50, 2) if v50 else None
    f["range_atr"] = round(rng / atr, 2); f["gap_pct"] = round(pct(b["o"], p["c"]), 2)
    # bundle geometry over time
    spreads, under, touches, dangle = [], 0, 0, 0
    for k in range(i - 30, i):
        v = [S["e8"][k], S["e21"][k], S["s50"][k]]
        if not all(v):
            continue
        top, bot = max(v), min(v); mid = (top + bot) / 2
        spread = (top - bot) / cc[k] * 100
        if k >= i - 10:
            spreads.append(spread)
        if cc[k] <= top:
            under += 1
        if k >= i - 15 and min(abs(cc[k] - S["e21"][k]), abs(cc[k] - S["s50"][k])) <= S["atr"][k]:
            touches += 1
        if k >= i - 8 and 0 <= pct(cc[k], top) <= 4.0:
            dangle += 1
    f["ma_spread_10d_max_pct"] = round(max(spreads), 2) if spreads else 99
    f["sessions_under_or_on_bundle_30"] = under; f["bundle_touches_15"] = touches; f["dangle_days_8"] = dangle
    e9, e20 = S["e9"][i], S["e20"][i]
    f["stack_9_20_50"] = bool(e9 and e20 and S["s50"][i]) and e9 > e20 > S["s50"][i]
    s50_prev = S["s50"][j - 20]; f["sma50_flat_or_rising"] = bool(s50_prev) and s50 >= s50_prev * 0.99
    cand = (f["correction_pct"] <= -15.0 and f["ma_spread_pct"] <= 4.0 and f["ma_spread_10d_max_pct"] <= 6.0 and f["s200_dist_pct"] <= 15.0
            and f["base30_range_pct"] <= 20.0 and f["day_pct"] >= 2.0 and f["close_pos"] >= 0.7 and (f["rvol"] or 0) >= 1.3
            and f["range_atr"] <= 4.0 and f["gap_pct"] <= 6.0 and under >= 6 and touches >= 3)
    sc = 0
    sc += 2 if f["ma_spread_pct"] <= 2.5 else 1
    sc += 2 if f["s200_dist_pct"] <= 6 else 1
    sc += 2 if f["base15_range_pct"] <= 10 else (1 if f["base15_range_pct"] <= 15 else 0)
    sc += 2 if f["correction_pct"] <= -25 else (1 if f["correction_pct"] <= -20 else 0)
    sc += 2 if under >= 12 else (1 if under >= 8 else 0)
    sc += 2 if touches >= 6 else 1
    sc += 2 if dangle >= 3 else (1 if dangle >= 1 else 0)
    sc += 1 if f["stack_9_20_50"] else 0
    sc += 1 if f["sma50_flat_or_rising"] else 0
    sc += 1 if (f["rvol"] or 0) >= 2.0 else 0
    sc += 1 if f["close_pos"] >= 0.85 else 0
    f["setup_score"] = sc
    return cand and sc >= 11, sc, f


def main():
    t0 = time.time()
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = [s for s in dict.fromkeys(ALL_CANDIDATES + uni) if s not in SEEN]
    today = int(date.today().strftime("%Y%m%d"))
    hits = []; scanned = 0
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
        last_i = -10_000
        for i in range(260, len(bars) - FORWARD - 1):
            if i - last_i < MIN_GAP:
                continue
            ok, sc, f = facts(bars, S, i)
            if not ok:
                continue
            lq, dv = liquid(bars, i)
            if not lq or not clean_window(bars, i):
                continue
            w_ok, wf = works(bars, i)
            if not w_ok:
                continue
            f.update(wf); f["avg_dollar_volume_m"] = round(dv / 1e6, 1); f["known_name"] = sym in KNOWN
            q = sc + (1.5 if sym in KNOWN else 0) + min(dv / 1e6, 200) / 400.0 + min(f["fwd_5d_pct"], 10) / 20.0
            hits.append({"sym": sym, "asof": key_to_iso(bars[i]["t"]), "year": int(str(bars[i]["t"])[:4]), "close": bars[i]["c"], "facts": f, "q": round(q, 2)})
            last_i = i
    import datetime as _dt
    def dnum(a): return _dt.date.fromisoformat(a).toordinal()
    rows = sorted(hits, key=lambda r: (-r["q"], r["asof"]))
    picked, per_sym, per_year = [], {}, {}
    for r in rows:
        if per_sym.get(r["sym"], 0) >= 1 or per_year.get(r["year"], 0) >= 8:
            continue
        if any(abs(dnum(r["asof"]) - dnum(p["asof"])) < 7 for p in picked):
            continue
        picked.append(r); per_sym[r["sym"]] = 1; per_year[r["year"]] = per_year.get(r["year"], 0) + 1
        if len(picked) >= 30:
            break
    print(json.dumps({"generated": date.today().isoformat(), "scanned": scanned, "passing": len(rows), "seconds": round(time.time() - t0),
                      "picks": picked}, indent=1))


if __name__ == "__main__":
    main()
