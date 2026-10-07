import yfinance as yf, json
out={}
for s in ["^GSPC","SPY"]:
    df = yf.download(s, start="2025-06-01", end="2026-10-03", interval="1wk", auto_adjust=False, progress=False, threads=False)
    if df.columns.nlevels>1: df.columns=df.columns.get_level_values(0)
    out[s]=[{"ts":int(i.timestamp()),"d":i.strftime("%Y-%m-%d"),"wd":i.weekday(),"c":float(r["Close"])} for i,r in df.iterrows()]
    print(s, out[s][-3:])
json.dump(out,open("weekly_yf.json","w"))
