"""High Volume Edge pass 2 (read-only on the pod): the firm's detector uct_hve.evaluate is the gate (the highest
volume of the prior ~252 sessions on an up close above $3), long only per the owner's 2026-10-23 ruling (a strong
close is not required; the HVE close is the level the biggest participants committed at and price must DEFEND it).
Universal rules: liquid universe, clean window, must-work in HVE terms on the forward strip (no close below the
HVE bar's low, closes hold within 3% of the HVE close, >= 8% at the 20-day high, up at +10/+20). The scan keeps
earnings-day and non-earnings HVEs apart (an earnings flag is added afterwards from FMP) so the owner can rule.
Prints a broad ranked candidate list with facts so the shortlist can be re-ranked locally."""
import json, os, sys, time
from datetime import date
REPO = os.getcwd(); sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_hve  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa
BARS, WINDOW, FORWARD, MIN_GAP = 1500, 120, 20, 60
KNOWN = set(ALL_CANDIDATES)
SEEN = {"ROKU", "SOFI", "CRWD", "HPK", "ELF", "BBIO", "RIOT", "SMCI", "HIMS", "IREN"}   # pass-1 HVE drafts (unreviewed)
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
def works(bars,i,hvc):
    b=bars[i]; fwd=bars[i+1:i+21]
    if len(fwd)<20: return False,{}
    min_low=min(x["l"] for x in fwd); max_high=max(x["h"] for x in fwd); min_close=min(x["c"] for x in fwd)
    above=sum(1 for x in fwd if x["c"]>=hvc)
    # a retest: a forward low within 3% above/below the HVE close that is followed by a higher close within 5 sessions
    retest=None
    for k,x in enumerate(fwd):
        if abs(pct(x["l"],hvc))<=3.0 and k>=1:
            later=fwd[k+1:k+6]
            if later and max(y["c"] for y in later)>x["c"]*1.02:
                retest=k+1; break
    f={"fwd_min_low_vs_hve_low_pct":round(pct(min_low,b["l"]),1),"fwd_min_close_vs_hvc_pct":round(pct(min_close,hvc),1),
       "fwd_closes_above_hvc":above,"fwd_retest_session":retest,"fwd_max_gain_pct":round(pct(max_high,b["c"]),1),
       "fwd_5d_pct":round(pct(bars[i+5]["c"],b["c"]),1),"fwd_10d_pct":round(pct(bars[i+10]["c"],b["c"]),1),"fwd_20d_pct":round(pct(bars[i+20]["c"],b["c"]),1)}
    ok=(min_low>=b["l"]*0.99 and f["fwd_min_close_vs_hvc_pct"]>=-3.0 and f["fwd_max_gain_pct"]>=8.0 and f["fwd_10d_pct"]>0 and f["fwd_20d_pct"]>0)
    return ok,f
def facts(bars,S,i,det):
    b,p=bars[i],bars[i-1]; cc,hh=S["c"],S["h"]; j=i-1
    rng=b["h"]-b["l"]; atr=S["atr"][j] or rng or 1e-9; v50=S["v50"][j]
    s50,s200,e21=S["s50"][j],S["s200"][j],S["e21"][j]
    if not (s50 and e21) or i-60<0: return False,0,{}
    f={"day_pct":round(pct(b["c"],p["c"]),2),"close_pos":round(dcr(b),2),"gap_pct":round(pct(b["o"],p["c"]),2),
       "rvol":det["rvol50"],"edge_ratio":det["edge_ratio"],"lookback":det["lookback"],"range_atr":round(rng/atr,2),
       "above_200":bool(s200) and p["c"]>s200,"above_50":p["c"]>s50,"high_close":det["high_close"],
       "ever_in_data":det["ever_in_data"],"hvc":round(b["c"],2),"hve_low":round(b["l"],2),
       "base20_range_pct":round((max(cc[i-20:i])-min(cc[i-20:i]))/p["c"]*100,1),
       "pullback_from_20d_high_pct":round(pct(p["c"],max(hh[i-20:i])),1),
       "s50_slope10_pct":round(pct(s50,S["s50"][j-10]),1) if S["s50"][j-10] else None,
       "breakout20":b["c"]>max(hh[i-20:i]),"close_vs_prior_high_pct":round(pct(b["c"],p["h"]),2)}
    cand=(f["day_pct"]>=3.0 and f["day_pct"]<=25.0 and f["gap_pct"]<=12.0 and (f["rvol"] or 0)>=2.0 and f["range_atr"]<=6.0
          and f["above_200"] and f["base20_range_pct"]<=30.0)
    sc=0
    sc+=2 if (f["rvol"] or 0)>=4 else (1 if (f["rvol"] or 0)>=3 else 0)
    sc+=1 if (f["edge_ratio"] or 0)>=1.3 else 0
    sc+=2 if 4<=f["day_pct"]<=15 else 1
    sc+=1 if f["close_pos"]>=0.7 else 0
    sc+=1 if f["above_50"] else 0
    sc+=1 if (f["s50_slope10_pct"] or 0)>=0 else 0
    sc+=2 if f["base20_range_pct"]<=12 else (1 if f["base20_range_pct"]<=20 else 0)
    sc+=1 if f["breakout20"] else 0
    sc+=1 if f["gap_pct"]<=4 else 0
    sc+=1 if f["ever_in_data"] else 0
    f["setup_score"]=sc
    return cand and sc>=7, sc, f
def main():
    t0=time.time(); today=int(date.today().strftime("%Y%m%d"))
    uni=json.load(open(os.path.join(REPO,"api/data/cap_universe.json"),encoding="utf-8"))
    syms=[s for s in dict.fromkeys(ALL_CANDIDATES+uni) if s not in SEEN]
    hits=[]; scanned=0; fired=0
    for sym in syms:
        try: rows=bars_sqlite.get_bars_before(sym,"D",BARS,today)
        except Exception: continue
        if len(rows)<500: continue
        bars=rows_to_bars(rows)
        if bars[-1]["t"]<today-100: continue
        scanned+=1; S=U.series(bars); last_i=-10_000
        for i in range(300,len(bars)-FORWARD-1):
            if i-last_i<MIN_GAP: continue
            try: det=uct_hve.evaluate(bars,S,i)
            except Exception: det=None
            if not det or det["direction"]!="bullish": continue
            fired+=1
            ok,sc,f=facts(bars,S,i,det)
            if not ok: continue
            lq,dv=liquid(bars,i)
            if not lq or not clean_window(bars,i): continue
            w_ok,wf=works(bars,i,b_hvc:=bars[i]["c"])
            if not w_ok: continue
            f.update(wf); f["avg_dollar_volume_m"]=round(dv/1e6,1); f["known_name"]=sym in KNOWN
            sc2=sc+(2 if f["fwd_closes_above_hvc"]>=17 else (1 if f["fwd_closes_above_hvc"]>=14 else 0))+(1 if f["fwd_retest_session"] else 0)
            f["setup_score"]=sc2
            q=sc2+(1.0 if sym in KNOWN else 0)+min(dv/1e6,200)/400.0+min(f["fwd_5d_pct"],10)/20.0
            hits.append({"sym":sym,"asof":key_to_iso(bars[i]["t"]),"year":int(str(bars[i]["t"])[:4]),"close":bars[i]["c"],"facts":f,"q":round(q,2)}); last_i=i
    rows=sorted(hits,key=lambda r:(-r["q"],r["asof"])); picked,per_sym=[],{}
    for r in rows:
        if per_sym.get(r["sym"],0)>=1: continue
        picked.append(r); per_sym[r["sym"]]=1
        if len(picked)>=150: break
    print(json.dumps({"generated":date.today().isoformat(),"scanned":scanned,"detector_fires":fired,"passing":len(rows),"seconds":round(time.time()-t0),"picks":picked},indent=1))
if __name__=="__main__": main()
