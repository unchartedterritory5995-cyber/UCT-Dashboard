"""Launchpad pass 2 (read-only on the pod): the OWNER'S definition, without the uct_launch_pad gate.
The firm's detector does not fire on MSTR 2023-10-23 (the owner called it 'a good launchpad') and fires on
TEAM 2023-12-08 only on the Oops day, so the gate is too tight for the playbook version (owner ruling
2026-10-23: MA convergence after a correction; the full stack is NOT required).

Launchpad = a correction of >= 12% (120-day high to the 60-day low), then the 8/21/50-day within 4% of each
other and price within 15% of the 200-day, a base of 15+ sessions (30-day close range <= 22%), the last bar a
strong up day (>= 2%, close >= 70% of range, volume >= 1.3x), preferably clearing the 20-day high; liquid
universe; must-work on the forward strip. Seeds MSTR 2023-10-23 / TEAM 2023-12-08 score 10 and 9 on this.
Prints JSON {scanned, passing, picks: [...]}.
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


def launchpad_facts(bars, S, i):
    b, p = bars[i], bars[i - 1]
    cc, hh = S["c"], S["h"]; j = i - 1
    rng = b["h"] - b["l"]; atr = S["atr"][j] or rng or 1e-9; v50 = S["v50"][j]
    s50, s200, e8, e21 = S["s50"][j], S["s200"][j], S["e8"][j], S["e21"][j]
    if not (s50 and s200 and e8 and e21):
        return False, 0, {}
    hi120 = max(hh[i - 120:i - 60]); lo60 = min(cc[i - 60:i])
    f = {"correction_pct": round(pct(lo60, hi120), 1), "ma_spread_pct": round((max(e8, e21, s50) - min(e8, e21, s50)) / p["c"] * 100, 2),
         "s200_dist_pct": round(abs(pct(p["c"], s200)), 1), "above_200": p["c"] > s200, "above_50": p["c"] > s50}
    f["base30_range_pct"] = round((max(cc[i - 30:i]) - min(cc[i - 30:i])) / p["c"] * 100, 1)
    f["base15_range_pct"] = round((max(cc[i - 15:i]) - min(cc[i - 15:i])) / p["c"] * 100, 1)
    f["day_pct"] = round(pct(b["c"], p["c"]), 2); f["close_pos"] = round(dcr(b), 2)
    f["breakout20"] = b["c"] > max(hh[i - 20:i]); f["rvol"] = round(b["v"] / v50, 2) if v50 else None
    f["range_atr"] = round(rng / atr, 2); f["gap_pct"] = round(pct(b["o"], p["c"]), 2)
    s50_prev = S["s50"][j - 20]; f["sma50_flat_or_rising"] = bool(s50_prev) and s50 >= s50_prev * 0.99
    # the averages have been converged for a while (coiled), not just crossing today
    spreads = []
    for k in range(j - 10, j + 1):
        v = [S["e8"][k], S["e21"][k], S["s50"][k]]
        spreads.append((max(v) - min(v)) / cc[k] * 100 if all(v) else 99)
    f["ma_spread_10d_max_pct"] = round(max(spreads), 2)
    cand = (f["correction_pct"] <= -12.0 and f["ma_spread_pct"] <= 4.0 and f["s200_dist_pct"] <= 15.0 and f["base30_range_pct"] <= 22.0
            and f["day_pct"] >= 2.0 and f["close_pos"] >= 0.7 and (f["rvol"] or 0) >= 1.3 and f["range_atr"] <= 4.0 and f["gap_pct"] <= 6.0
            and f["ma_spread_10d_max_pct"] <= 7.0)
    sc = 0
    sc += 2 if f["ma_spread_pct"] <= 2.5 else 1
    sc += 2 if f["s200_dist_pct"] <= 6 else 1
    sc += 2 if f["base15_range_pct"] <= 10 else (1 if f["base15_range_pct"] <= 15 else 0)
    sc += 1 if f["above_200"] else 0
    sc += 1 if f["above_50"] else 0
    sc += 1 if f["sma50_flat_or_rising"] else 0
    sc += 1 if f["correction_pct"] <= -20 else 0
    sc += 1 if f["breakout20"] else 0
    sc += 1 if (f["rvol"] or 0) >= 2.0 else 0
    sc += 1 if f["close_pos"] >= 0.85 else 0
    f["setup_score"] = sc
    return cand and sc >= 8, sc, f


def main():
    t0 = time.time()
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = list(dict.fromkeys(ALL_CANDIDATES + uni))
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
            ok, sc, f = launchpad_facts(bars, S, i)
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
