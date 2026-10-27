"""Gap Support pass 1 (read-only on the pod): the firm's detector uct_gap_support.evaluate is the gate (a true up-gap
of >= 4% on 2x volume within 60 sessions that held, an unfilled pullback of >= 1 ATR, a touch of a gap level with
the close above it and above the gap top), then the universal rules the owner set on 2026-10-24 (liquid and
sizable names only, a clean window, MUST WORK on the forward strip) and a gallery score that prefers what reads
best on a chart: a first test, the gap TOP tested (not only the open), a strong close off the level, volume on
the gap day well over 2x, confluence with a rising average, the test 10-40 sessions after the gap. Owner ruling
on the Gap Support definition is PENDING: this pass shows the detector's own definition on varied real charts so
he can rule on it one chart at a time. Prints a ranked candidate list with facts.

  railway ssh ... /opt/venv/bin/python  (via scratchpad run_pod_py.ps1)
"""
import json, os, sys, time
from datetime import date
REPO = os.getcwd(); sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_gap_support  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa
# the shared helpers, inlined so the script runs on the pod's deployed master (find_slingshot_examples.py is not there yet)
BARS, WINDOW, FORWARD, MIN_GAP = 1500, 120, 20, 40
KNOWN = set(ALL_CANDIDATES)
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
def works(bars,i):
    b=bars[i]; fwd=bars[i+1:i+21]
    if len(fwd)<20: return False,{}
    min_low=min(x["l"] for x in fwd); max_high=max(x["h"] for x in fwd)
    f={"fwd_min_low_vs_trigger_low_pct":round(pct(min_low,b["l"]),1),"fwd_max_gain_pct":round(pct(max_high,b["c"]),1),
       "fwd_5d_pct":round(pct(bars[i+5]["c"],b["c"]),1),"fwd_10d_pct":round(pct(bars[i+10]["c"],b["c"]),1),"fwd_20d_pct":round(pct(bars[i+20]["c"],b["c"]),1)}
    return (min_low>=b["l"]*1.02 and f["fwd_max_gain_pct"]>=8.0 and f["fwd_5d_pct"]>=3.0 and f["fwd_10d_pct"]>0 and f["fwd_20d_pct"]>0), f


def facts(bars, S, i, det):
    b = bars[i]; j = i - 1
    rng = b["h"] - b["l"]; atr = S["atr"][j] or rng or 1e-9
    g = det["gap_idx"]; gb = bars[g]
    post_high = max(x["h"] for x in bars[g:i])
    f = {"gap_pct": det["gap_pct"], "bars_since_gap": det["bars_since_gap"], "true_gap": det["true_gap"],
         "gap_vol_2x": det["gap_vol_2x"], "gap_rvol": round(S["v"][g] / S["v50"][g - 1], 2) if S["v50"][g - 1] else None,
         "gap_day_pct": round(pct(gb["c"], bars[g - 1]["c"]), 2), "gap_day_dcr": round(dcr(gb), 2),
         "levels_touched": det["levels_touched"], "first_test": det["first_test"], "confluence": det["confluence"],
         "post_gap_run_pct": round(pct(post_high, gb["c"]), 1), "pullback_from_high_pct": round(pct(b["l"], post_high), 1),
         "test_depth_atr": round((post_high - b["l"]) / atr, 2),
         "day_pct": round(pct(b["c"], bars[j]["c"]), 2), "dcr": round(dcr(b), 2), "range_atr": round(rng / atr, 2),
         "rvol": det["rvol50"], "gap_top": round(det["gap_top"], 2), "close_vs_gap_top_pct": round(pct(b["c"], det["gap_top"]), 1),
         "above_200": bool(S["s200"][j]) and b["c"] > S["s200"][j],
         "s50_slope10_pct": round(pct(S["s50"][j], S["s50"][j - 10]), 1) if (S["s50"][j] and S["s50"][j - 10]) else None,
         "labels": det["label_variants"], "ma_periods": [9, 20, 50, 200]}
    # the geometry the detector already judged, scored for how well it TEACHES
    sc = 0
    sc += 2 if f["true_gap"] else 0
    sc += 2 if (f["gap_rvol"] or 0) >= 3.0 else (1 if f["gap_vol_2x"] else 0)
    sc += 2 if f["gap_pct"] >= 8 else (1 if f["gap_pct"] >= 5 else 0)
    sc += 2 if f["gap_day_dcr"] >= 0.7 else (1 if f["gap_day_dcr"] >= 0.5 else 0)
    sc += 2 if "top" in f["levels_touched"] else (1 if "mid" in f["levels_touched"] or "glow" in f["levels_touched"] else 0)
    sc += 2 if f["first_test"] else 0
    sc += 1 if f["confluence"] else 0
    sc += 2 if 10 <= f["bars_since_gap"] <= 40 else (1 if f["bars_since_gap"] >= 5 else 0)
    sc += 2 if f["dcr"] >= 0.7 else (1 if f["dcr"] >= 0.55 else 0)
    sc += 1 if f["range_atr"] <= 2.5 else 0
    sc += 1 if (f["rvol"] or 0) >= 1.0 else 0
    sc += 1 if f["above_200"] else 0
    sc += 1 if (f["s50_slope10_pct"] or 0) > 0 else 0
    sc += 1 if 5 <= f["post_gap_run_pct"] <= 40 else 0
    cand = (f["true_gap"] and f["gap_vol_2x"] and f["dcr"] >= 0.5 and f["range_atr"] <= 3.0 and "gopen" != (f["levels_touched"] or ["x"])[0]
            and f["bars_since_gap"] >= 5)
    f["setup_score"] = sc
    return cand and sc >= 13, sc, f


def main():
    t0 = time.time(); today = int(date.today().strftime("%Y%m%d"))
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = list(dict.fromkeys(list(KNOWN) + uni))
    hits = []; scanned = 0; fired = 0
    for sym in syms:
        try: rows = bars_sqlite.get_bars_before(sym, "D", BARS, today)
        except Exception: continue
        if len(rows) < 400: continue
        bars = rows_to_bars(rows)
        if bars[-1]["t"] < today - 100: continue
        scanned += 1; S = U.series(bars); last_i = -10_000
        for i in range(260, len(bars) - FORWARD - 1):
            if i - last_i < MIN_GAP: continue
            try: det = uct_gap_support.evaluate(bars, S, i)
            except Exception: det = None
            if not det: continue
            fired += 1
            ok, sc, f = facts(bars, S, i, det)
            if not ok: continue
            lq, dv = liquid(bars, i)
            if not lq or not clean_window(bars, i): continue
            w_ok, wf = works(bars, i)
            if not w_ok: continue
            # the gap must STAY unfilled on the forward strip: no close back under the gap top in 20 sessions
            if min(x["c"] for x in bars[i + 1:i + 21]) < det["gap_top"]: continue
            f.update(wf); f["avg_dollar_volume_m"] = round(dv / 1e6, 1); f["known_name"] = sym in KNOWN
            q = sc + (1.0 if sym in KNOWN else 0) + min(dv / 1e6, 200) / 400.0 + min(f["fwd_5d_pct"], 10) / 20.0 + min(f["fwd_20d_pct"], 30) / 30.0
            hits.append({"sym": sym, "asof": key_to_iso(bars[i]["t"]), "year": int(str(bars[i]["t"])[:4]), "close": bars[i]["c"],
                         "gap_asof": key_to_iso(bars[det["gap_idx"]]["t"]), "facts": f, "q": round(q, 2)}); last_i = i
    rows = sorted(hits, key=lambda r: (-r["q"], r["asof"])); picked, per_sym = [], {}
    for r in rows:
        if per_sym.get(r["sym"], 0) >= 1: continue
        picked.append(r); per_sym[r["sym"]] = 1
        if len(picked) >= 120: break
    print(json.dumps({"generated": date.today().isoformat(), "scanned": scanned, "detector_fires": fired, "passing": len(rows),
                      "seconds": round(time.time() - t0), "picks": picked}, indent=1))


if __name__ == "__main__": main()
