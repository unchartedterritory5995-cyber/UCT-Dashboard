"""Bear Gap off the Highs finder (read-only on the pod). The owner, cutting NFLX 2022-02-07 from Gap Support on
2026-10-27: "Don't want to do downtrend gaps but will do bear gaps off the highs" (owner_verdicts.jsonl #212/#216:
the first gap DOWN from a top, NFLX January 2022 on the day, wanted as its own lesson variant). This is the FIRST
DRAFT of that rule, read mechanically; the owner's rulings on the charts calibrate it. The example bar is the gap
day itself.

  OFF A TOP     the stock set its 250-session closing high within the prior 80 sessions (a recent top) and the day
                before the gap still closes within 30% of it (NFLX 2022-01-21, the owner's example, was 25% off its
                November top and under its averages when it gapped; a gap 40% down a downtrend is the cut). Whether
                the prior close was above the 50 and 200-day is recorded, not required.
  THE GAP       a TRUE gap down: the gap day's high is under the prior day's low; the open is at least 5% under the
                prior close; volume at least 2x the 50-day average; the day closes down at least 6% (where it closes
                in its range is scored, not required: NFLX 2022-01-21 bounced to 60% of its range).
  FIRST         no earlier gap down of 3%+ since the top: the first crack in it.
  AFTER (20 s)  recorded, not required: gap_held (never traded back into the gap), gap_entered (traded in, never
                closed above the gap-fill level = the prior day's low), gap_filled (a close back above it). The
                owner decides which of these the lesson wants; the finder ranks held > entered > filled.
Universal rules (owner 2026-10-24): liquid and sizable names only, a clean window. Earnings day flagged afterwards
from FMP when the pod has a key. Prints JSON {scanned, passing, picks:[...]} ranked.

  railway ssh ... /opt/venv/bin/python  (via scratchpad run_pod_py.ps1 -Script <this file>)
"""
import json, os, sys, time
from datetime import date
REPO = os.getcwd(); sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa
BARS, WINDOW, FORWARD, MIN_GAP = 1500, 120, 20, 60
HIGH_LOOKBACK, TOP_WITHIN = 250, 80
MAX_FROM_HIGH_PCT, MIN_GAP_PCT, MIN_DAY_PCT, MIN_RVOL = 30.0, 5.0, 6.0, 2.0
KNOWN = set(ALL_CANDIDATES)
#: the owner's named example (2026-10-27): always carried in the picks when it passes, beside the one-per-name cap
SEEDS = {("NFLX", "2022-01-21")}
def key_to_iso(k): s=str(int(k)); return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
def rows_to_bars(rows): return [{"t":int(r[0]),"o":float(r[1]),"h":float(r[2]),"l":float(r[3]),"c":float(r[4]),"v":float(r[5])} for r in rows]
def pct(a,b): return (a/b-1)*100 if b else 0.0
def _days(k):
    import datetime as _d; s=str(int(k)); return _d.date(int(s[:4]),int(s[4:6]),int(s[6:8])).toordinal()
def dcr(b): r=b["h"]-b["l"]; return (b["c"]-b["l"])/r if r>0 else 0.5
def clean_window(bars,i,window=WINDOW,forward=FORWARD):
    lo,hi=i-window+1,i+forward
    if lo<0 or hi>=len(bars) or bars[i]["t"]<20190101: return False
    if _days(bars[hi]["t"])-_days(bars[lo]["t"])>(window+forward)*1.9: return False
    for k in range(lo+1,hi+1):
        a,b=bars[k-1],bars[k]
        if a["c"]<=0 or abs(b["c"]/a["c"]-1)>0.60: return False
        body=max(b["o"],b["c"])-min(b["o"],b["c"]); rng=b["h"]-b["l"]
        if rng>0 and body>0 and rng>12*body and rng/b["c"]>0.25: return False
    return True
def liquid(bars,i,window=WINDOW):
    w=bars[i-window+1:i+1]; dv=sum(x["c"]*x["v"] for x in w)/len(w); return bars[i]["c"]>=10.0 and dv>=20_000_000, dv
def gap_down_pct(bars,k):
    p=bars[k-1]; b=bars[k]
    return pct(b["o"],p["c"]) if b["o"]<p["l"]*0.98 else 0.0


def facts(bars, S, i):
    b = bars[i]; j = i - 1; p = bars[j]
    rng = b["h"] - b["l"]; atr = S["atr"][j] or rng or 1e-9
    top_i = max(range(i - HIGH_LOOKBACK, i), key=lambda k: bars[k]["c"]); hi_close = bars[top_i]["c"]
    s50j, s200j, e21j = S["s50"][j], S["s200"][j], S["e21"][j]
    s50_slope = pct(S["s50"][j], S["s50"][j - 10]) if (S["s50"][j] and S["s50"][j - 10]) else None
    recent_top = (i - top_i) <= TOP_WITHIN
    at_highs = recent_top and pct(p["c"], hi_close) >= -MAX_FROM_HIGH_PCT
    first_gap = not any(gap_down_pct(bars, k) <= -3.0 for k in range(top_i + 1, i))
    fwd = bars[i + 1:i + 1 + FORWARD]
    gap_fill = p["l"]
    if fwd:
        max_h = max(x["h"] for x in fwd); max_c = max(x["c"] for x in fwd); min_l = min(x["l"] for x in fwd)
        after = "gap_filled" if max_c >= gap_fill else ("gap_entered" if max_h >= gap_fill else "gap_held")
    else:
        max_h = max_c = min_l = None; after = None
    f = {"gap_pct": round(pct(b["o"], p["c"]), 2), "true_gap": b["h"] < p["l"], "gap_fill_level": round(gap_fill, 2),
         "gap_day_high": round(b["h"], 2), "gap_day_low": round(b["l"], 2), "prior_close": round(p["c"], 2),
         "rvol": round(S["v"][i] / S["v50"][j], 2) if S["v50"][j] else None, "gap_vol_2x": bool(S["v50"][j]) and S["v"][i] >= MIN_RVOL * S["v50"][j],
         "day_pct": round(pct(b["c"], p["c"]), 2), "dcr": round(dcr(b), 2), "range_atr": round(rng / atr, 2),
         "prior_close_vs_250d_high_pct": round(pct(p["c"], hi_close), 1), "sessions_since_top": i - top_i,
         "top_asof": key_to_iso(bars[top_i]["t"]), "at_highs": at_highs,
         "prior_above_50": bool(s50j) and p["c"] > s50j, "prior_above_200": bool(s200j) and p["c"] > s200j,
         "s50_slope10_pct": round(s50_slope, 1) if s50_slope is not None else None,
         "close_below_21": bool(e21j) and b["c"] < e21j, "close_below_50": bool(s50j) and b["c"] < s50j,
         "close_below_200": bool(s200j) and b["c"] < s200j, "first_gap_since_top": first_gap,
         "after_kind": after,
         "fwd_max_high_vs_gap_fill_pct": round(pct(max_h, gap_fill), 1) if max_h else None,
         "fwd_max_close_vs_gap_fill_pct": round(pct(max_c, gap_fill), 1) if max_c else None,
         "fwd_min_low_vs_gap_close_pct": round(pct(min_l, b["c"]), 1) if min_l else None,
         "fwd_5d_pct": round(pct(bars[i + 5]["c"], b["c"]), 1) if i + 5 < len(bars) else None,
         "fwd_10d_pct": round(pct(bars[i + 10]["c"], b["c"]), 1) if i + 10 < len(bars) else None,
         "fwd_20d_pct": round(pct(bars[i + 20]["c"], b["c"]), 1) if i + 20 < len(bars) else None,
         "ma_periods": [9, 20, 50, 200]}
    sc = 0
    sc += 3 if f["gap_pct"] <= -10 else (2 if f["gap_pct"] <= -7 else 1)
    sc += 2 if (f["rvol"] or 0) >= 4.0 else (1 if (f["rvol"] or 0) >= 2.5 else 0)
    sc += 2 if f["prior_close_vs_250d_high_pct"] >= -3 else (1 if f["prior_close_vs_250d_high_pct"] >= -10 else 0)
    sc += 1 if (f["prior_above_50"] and f["prior_above_200"]) else 0
    sc += 2 if f["day_pct"] <= -15 else (1 if f["day_pct"] <= -10 else 0)
    sc += 1 if f["dcr"] <= 0.3 else 0
    sc += {"gap_held": 3, "gap_entered": 2, "gap_filled": 0}.get(after or "", 0)
    sc += 1 if f["close_below_50"] else 0
    sc += 1 if (f["s50_slope10_pct"] or 0) > 0 else 0
    sc += 1 if f["range_atr"] <= 4.0 else 0
    # where the gap day closes in its range is scored, not required: NFLX 2022-01-21 bounced to 60% of its range
    cand = (f["true_gap"] and f["gap_pct"] <= -MIN_GAP_PCT and f["gap_vol_2x"] and f["day_pct"] <= -MIN_DAY_PCT
            and at_highs and first_gap and after is not None)
    f["setup_score"] = sc
    return cand and sc >= 8, sc, f


def earnings_near(picks):
    key = os.environ.get("FMP_API_KEY", "")
    if not key: return {}
    import urllib.request, datetime as dt
    out = {}
    for p in picks:
        s, asof = p["sym"], p["asof"]
        try:
            rows = json.load(urllib.request.urlopen(f"https://financialmodelingprep.com/stable/earnings?symbol={s}&limit=80&apikey={key}", timeout=12))
            d0 = dt.date.fromisoformat(asof)
            out[f"{s}@{asof}"] = sorted(r["date"] for r in rows if r.get("date") and abs((dt.date.fromisoformat(r["date"]) - d0).days) <= 3)
        except Exception as e:
            out[f"{s}@{asof}"] = ["ERR " + type(e).__name__]
    return out


def main():
    t0 = time.time(); today = int(date.today().strftime("%Y%m%d"))
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = list(dict.fromkeys(list(KNOWN) + uni))
    hits = []; scanned = 0; raw = 0
    for sym in syms:
        try: rows = bars_sqlite.get_bars_before(sym, "D", BARS, today)
        except Exception: continue
        if len(rows) < 400: continue
        bars = rows_to_bars(rows)
        if bars[-1]["t"] < today - 100: continue
        scanned += 1; S = U.series(bars); last_i = -10_000
        for i in range(HIGH_LOOKBACK + 10, len(bars) - FORWARD - 1):
            if i - last_i < MIN_GAP: continue
            b, p = bars[i], bars[i - 1]
            if not (b["h"] < p["l"] and pct(b["o"], p["c"]) <= -MIN_GAP_PCT): continue
            raw += 1
            ok, sc, f = facts(bars, S, i)
            if not ok: continue
            lq, dv = liquid(bars, i)
            if not lq or not clean_window(bars, i): continue
            f["avg_dollar_volume_m"] = round(dv / 1e6, 1); f["known_name"] = sym in KNOWN
            q = sc + (1.0 if sym in KNOWN else 0) + min(dv / 1e6, 200) / 400.0 + min(abs(f["gap_pct"]), 30) / 30.0
            hits.append({"sym": sym, "asof": key_to_iso(b["t"]), "year": int(str(b["t"])[:4]), "close": b["c"], "facts": f, "q": round(q, 2)}); last_i = i
    rows = sorted(hits, key=lambda r: (-r["q"], r["asof"])); picked, per_sym = [], {}
    seeds = [r for r in rows if (r["sym"], r["asof"]) in SEEDS]
    for r in rows:
        if r in seeds: continue
        if per_sym.get(r["sym"], 0) >= 1: continue
        picked.append(r); per_sym[r["sym"]] = 1
        if len(picked) >= 120: break
    for r in seeds:
        r["facts"]["owner_seed"] = True; picked.append(r)
    near = earnings_near(picked)
    for r in picked:
        n = near.get(f'{r["sym"]}@{r["asof"]}')
        if n is not None:
            r["facts"]["earnings_dates_near"] = n; r["facts"]["earnings_day"] = bool(n) and not str(n[0]).startswith("ERR")
    kinds = {}
    for r in rows: kinds[r["facts"]["after_kind"]] = kinds.get(r["facts"]["after_kind"], 0) + 1
    print(json.dumps({"generated": date.today().isoformat(), "scanned": scanned, "raw_true_gaps_down": raw, "passing": len(rows),
                      "seeds_passing": [(r["sym"], r["asof"]) for r in seeds],
                      "after_kinds": kinds, "seconds": round(time.time() - t0), "picks": picked}, indent=1))


if __name__ == "__main__": main()
