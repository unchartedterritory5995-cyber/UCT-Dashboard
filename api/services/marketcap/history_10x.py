import sqlite3,json,math,re,sys
from collections import Counter,defaultdict
B=sqlite3.connect(sys.argv[1]); S=sqlite3.connect('C:/mcapdata/builds/BASELINE-20261001.db')
out=defaultdict(Counter); ex={}
for cik,t in B.execute("select cik,primary_ticker from coverage").fetchall():
    base=dict(S.execute("select d,cap from base_daily where ticker=?",(t,)).fetchall())
    if not base: continue
    v1=B.execute("select d,cap from cap_daily where cik=?",(cik,)).fetchall()
    bad=[(d,c,base[d]) for d,c in v1 if d in base and c and base[d] and abs(math.log10(c/base[d]))>=1]
    if not bad: continue
    runs=B.execute("select class_key,start,end,shares,obs_accession,as_of,source_type from state_run where issuer_id=?",(f"cik:{cik}",)).fetchall()
    tagc={}
    for d,c,b in bad:
        q=c/b; ds=f"{d//10000}-{d//100%100:02d}-{d%100:02d}"
        rr=[r for r in runs if r[1]<=ds<=r[2]]
        tag=''
        if rr:
            k=(rr[0][4],rr[0][0])
            if k not in tagc:
                x=B.execute("select tag from observation where issuer_id=? and accession=? and class_key=? limit 1",(f"cik:{cik}",k[0],k[1])).fetchone()
                tagc[k]=x[0] if x else ''
            tag=tagc[k]
        m=re.search(r"/ADS([\d.e+-]+)@",tag)
        if m and abs(math.log(q)+math.log(float(m.group(1))))<0.15: cause='PRODUCTION_ORDINARY_SHARES_x_ADS_PRICE'
        elif len(rr)>1: cause='MULTI_CLASS_SUM_vs_PRODUCTION'
        elif q>1: cause='V1_HIGHER_OTHER'
        else: cause='V1_LOWER_OTHER'
        out[t][cause]+=1
        ex.setdefault((t,cause),(ds,round(q,4),[r[:6] for r in rr[:2]]))
tot=Counter(); secs=Counter()
for t,c in out.items():
    for k,v in c.items(): tot[k]+=v; secs[k]+=1
print(dict(tot), dict(secs), len(out))
json.dump({'by_cause_sessions':tot,'by_cause_securities':secs,'per_security':{t:dict(c) for t,c in out.items()},'examples':{f"{t}|{c}":v for (t,c),v in ex.items()}},open(sys.argv[2],'w'),indent=1,default=str)
for (t,cause),e in sorted(ex.items()):
    if 'OTHER' in cause or 'MULTI' in cause: print(t,cause,out[t][cause],e)
