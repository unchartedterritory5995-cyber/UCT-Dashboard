import yfinance as yf, json, pandas as pd
syms = ["NVDA","SPY","XLK","XLE","AMD","TSM","^GSPC"]
out = {}
for s in syms:
    df = yf.download(s, start="2023-09-01", end="2026-10-03", interval="1d", auto_adjust=False, progress=False, threads=False)
    if hasattr(df.columns,"nlevels") and df.columns.nlevels>1: df.columns = df.columns.get_level_values(0)
    print(s, len(df), df.index[:1].tolist(), df.index[-1:].tolist(), df.index.tz)
    out[s] = [{"d": i.strftime("%Y-%m-%d"), "c": round(float(r["Close"]),4), "ts": int(i.timestamp())} for i, r in df.iterrows()]
json.dump(out, open("daily.json","w"))
