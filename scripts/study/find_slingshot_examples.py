"""Slingshot pass 2 (read-only on the pod): the firm's detector uct_slingshot.evaluate is the gate (first close back
over the 4-EMA of highs after three closes under it, a strength day or a 20%-in-5 run, above the 50), then the
owner's definition (2026-10-24) is scored on top: a DRIVE first (a good rally up or an earnings-style gap), THEN a
consolidation (orderly, no nasty red bar, modest depth), THEN the first close back above the 4-day average of the
highs; the gap day or rally day itself is never the trigger. Universal rules: liquid universe, clean window,
MUST WORK on the forward strip (trigger low never broken, >= 8% at the 20-day high, up at +10/+20).
Prints a broad ranked candidate list with facts so the shortlist can be re-ranked locally."""
import json, os, sys, time
from datetime import date
REPO = os.getcwd(); sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_slingshot  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa
BARS, WINDOW, FORWARD, MIN_GAP = 1500, 120, 20, 40
KNOWN = set(ALL_CANDIDATES)
SEEN = {"QCOM", "CBZ", "XOM", "RTX", "TEAM", "FIGS", "HAS", "INTA", "BBWI", "PANW"}   # pass-1 Slingshot drafts (unreviewed)
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
    # the gallery never came within 2.5% of the trigger low (VRT 2.6% was the closest great); TCOM (-0.6%) was cut
    return (min_low>=b["l"]*1.02 and f["fwd_max_gain_pct"]>=8.0 and f["fwd_5d_pct"]>=3.0 and f["fwd_10d_pct"]>0 and f["fwd_20d_pct"]>0), f
def facts(bars,S,i,det):
    b,p=bars[i],bars[i-1]; cc,hh=S["c"],S["h"]; j=i-1
    rng=b["h"]-b["l"]; atr=S["atr"][j] or rng or 1e-9; v50=S["v50"][j]
    s50,s200,e21=S["s50"][j],S["s200"][j],S["e21"][j]
    if not (s50 and e21) or i-40<0: return False,0,{}
    f={"day_pct":round(pct(b["c"],p["c"]),2),"close_pos":round(dcr(b),2),"gap_pct":round(pct(b["o"],p["c"]),2),
       "rvol":round(b["v"]/v50,2) if v50 else None,"range_atr":round(rng/atr,2),"above_200":bool(s200) and p["c"]>s200,
       "variant":det["variant"],"tight_pullback":det["tight_pullback"],"labels":det["label_variants"],
       "strength_day_bars_ago":det["strength_day_bars_ago"],"strength_day_gain_pct":det["strength_day_gain_pct"]}
    # the drive: the biggest gap (>= 5%) in the prior 25 sessions, and the best 10-session rally that peaked in the prior 25
    gaps=[(k,pct(bars[k]["o"],bars[k-1]["c"]),pct(bars[k]["c"],bars[k-1]["c"])) for k in range(i-25,i)]
    big=[g for g in gaps if g[1]>=5.0 and g[2]>=3.0]
    f["earnings_like_gap"]={"bars_ago":i-big[-1][0],"gap_pct":round(big[-1][1],1),"day_pct":round(big[-1][2],1)} if big else None
    peak_k=max(range(i-25,i),key=lambda k:hh[k]); peak=hh[peak_k]
    base_lo=min(cc[max(0,peak_k-15):peak_k+1]) if peak_k>0 else peak
    f["rally"]={"rally_pct":round(pct(peak,base_lo),1),"bars_ago":i-peak_k,"peak_high":round(peak,2)}
    f["drive_pct"]=max(f["rally"]["rally_pct"],(f["earnings_like_gap"] or {}).get("day_pct",0) or 0)
    # the consolidation between the drive peak and the trigger
    pb=bars[peak_k+1:i] if peak_k+1<i else []
    f["pullback_sessions"]=len(pb)
    f["pullback_depth_pct"]=round(pct(min([x["l"] for x in pb]) if pb else b["l"],peak),1)
    reds=[pct(x["c"],x["o"]) for x in pb if x["c"]<x["o"]]
    f["worst_red_body_pct"]=round(min(reds),2) if reds else 0.0
    f["pullback_range_atr"]=round((max(x["h"] for x in pb)-min(x["l"] for x in pb))/atr,2) if pb else 0.0
    f["pullback_rvol_max"]=round(max(x["v"] for x in pb)/v50,2) if (pb and v50) else 0.0
    f["trigger_vs_peak_pct"]=round(pct(b["c"],peak),1)
    f["s50_slope10_pct"]=round(pct(s50,S["s50"][j-10]),1) if S["s50"][j-10] else None
    f["ma_order_8_21_50"]=bool(S["e8"][j] and e21 and s50) and S["e8"][j]>e21>s50
    # owner definition: a real drive, a real consolidation, a trigger that is not the drive day
    cand=(f["drive_pct"]>=12.0 and 3<=f["pullback_sessions"]<=15 and -14.0<=f["pullback_depth_pct"]<=-1.5
          and f["worst_red_body_pct"]>=-6.0 and f["gap_pct"]<=3.0 and f["day_pct"]>=1.0 and f["close_pos"]>=0.55
          and (f["rvol"] or 0)>=0.9 and f["range_atr"]<=3.5 and f["pullback_rvol_max"]<=3.5)
    # GALLERY SCORE v3 (owner review of 2026-10-25, 26 charts graded one at a time; the
    # measured signature of the six he called perfect/beautiful/A+ against the cuts):
    #   drive    an earnings-gap drive is the gallery ("meant to be used to enter PEGs mostly");
    #            a rally drive can qualify but scores lower (COIN cut, SLB/PAAS good/okay)
    #   pullback 3-7 sessions, 5-12% deep, ORDERLY: the pullback's whole range <= 1.6 ATR, the
    #            worst red body <= 3.5% of price, no volume spike (APP's 2.6 ATR / -4.9% body = "looser")
    #   trigger  decisive but technical: +3% to +6% on the day, closing in the top fifth, volume
    #            1.0-1.6x, NO gap (TCOM's 2.7% and COIN's 2.0% gaps were cut; +11-13% days on 2.4-2.9x
    #            volume read as news days and graded down), within ~5% of the drive peak
    #   location the 200-day is NOT required (HAE triggered under it and the owner likes it), but the
    #            8 > 21 > 50 stack and a rising 50-day are the picture
    #   price    nothing under $10 (FIGS, a $7 stock, was cut on price alone)
    sc=0
    g=f["earnings_like_gap"]
    sc+=3 if (g and (g.get("day_pct") or 0)>=8) else (2 if g else (1 if f["drive_pct"]>=25 else 0))
    sc+=1 if f["drive_pct"]>=25 else 0
    sc+=2 if 3<=f["pullback_sessions"]<=7 else (1 if f["pullback_sessions"]<=10 else 0)
    sc+=2 if -12<=f["pullback_depth_pct"]<=-5 else (1 if -14<=f["pullback_depth_pct"]<=-3 else 0)
    sc+=2 if f["pullback_range_atr"]<=1.6 else (1 if f["pullback_range_atr"]<=2.0 else 0)
    sc+=2 if f["worst_red_body_pct"]>=-3.5 else (1 if f["worst_red_body_pct"]>=-5.0 else 0)
    sc+=1 if f["pullback_rvol_max"]<=2.0 else 0
    sc+=2 if 3.0<=f["day_pct"]<=6.5 else (1 if 2.0<=f["day_pct"]<=9.0 else 0)
    sc+=2 if f["close_pos"]>=0.85 else (1 if f["close_pos"]>=0.75 else 0)
    sc+=2 if abs(f["gap_pct"])<=1.2 else (1 if abs(f["gap_pct"])<=1.8 else 0)
    sc+=1 if 1.0<=(f["rvol"] or 0)<=1.8 else 0
    sc+=1 if -5.0<=f["trigger_vs_peak_pct"]<=4.5 else 0
    sc+=1 if f["ma_order_8_21_50"] else 0
    sc+=1 if (f["s50_slope10_pct"] or 0)>0 else 0
    pretty=(abs(f["gap_pct"])<=1.8 and f["pullback_range_atr"]<=2.0 and f["worst_red_body_pct"]>=-5.0
            and f["day_pct"]<=9.0 and (f["rvol"] or 0)<=2.0 and b["c"]>=10.0)
    f["setup_score"]=sc; f["pretty"]=pretty
    return cand and pretty and sc>=14, sc, f
def main():
    t0=time.time(); today=int(date.today().strftime("%Y%m%d"))
    uni=json.load(open(os.path.join(REPO,"api/data/cap_universe.json"),encoding="utf-8"))
    syms=[s for s in dict.fromkeys(ALL_CANDIDATES+uni) if s not in SEEN]
    hits=[]; scanned=0; fired=0
    for sym in syms:
        try: rows=bars_sqlite.get_bars_before(sym,"D",BARS,today)
        except Exception: continue
        if len(rows)<400: continue
        bars=rows_to_bars(rows)
        if bars[-1]["t"]<today-100: continue
        scanned+=1; S=U.series(bars); last_i=-10_000
        for i in range(260,len(bars)-FORWARD-1):
            if i-last_i<MIN_GAP: continue
            try: det=uct_slingshot.evaluate(bars,S,i)
            except Exception: det=None
            if not det: continue
            fired+=1
            ok,sc,f=facts(bars,S,i,det)
            if not ok: continue
            lq,dv=liquid(bars,i)
            if not lq or not clean_window(bars,i): continue
            w_ok,wf=works(bars,i)
            if not w_ok: continue
            f.update(wf); f["avg_dollar_volume_m"]=round(dv/1e6,1); f["known_name"]=sym in KNOWN
            q=sc+(1.0 if sym in KNOWN else 0)+min(dv/1e6,200)/400.0+min(f["fwd_5d_pct"],10)/20.0+min(f["fwd_20d_pct"],30)/30.0
            hits.append({"sym":sym,"asof":key_to_iso(bars[i]["t"]),"year":int(str(bars[i]["t"])[:4]),"close":bars[i]["c"],"facts":f,"q":round(q,2)}); last_i=i
    rows=sorted(hits,key=lambda r:(-r["q"],r["asof"])); picked,per_sym=[],{}
    for r in rows:
        if per_sym.get(r["sym"],0)>=1: continue
        picked.append(r); per_sym[r["sym"]]=1
        if len(picked)>=120: break
    print(json.dumps({"generated":date.today().isoformat(),"scanned":scanned,"detector_fires":fired,"passing":len(rows),"seconds":round(time.time()-t0),"picks":picked},indent=1))
if __name__=="__main__": main()
