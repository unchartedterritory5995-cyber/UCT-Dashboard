import os, json, datetime, urllib.request
KEY=os.environ.get("MASSIVE_API_KEY","")
BASE="https://api.massive.com"
def get(u):
    req=urllib.request.Request(u, headers={"User-Agent":"Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
    except Exception: return {}
def paginate(u,cap=400):
    out=[]
    for _ in range(cap):
        d=get(u); out.extend(d.get("results") or [])
        nx=d.get("next_url")
        if not nx: break
        u=nx+(f"&apiKey={KEY}" if "apiKey=" not in nx else "")
    return out
# 1) ETF symbol set (+ names)
etf_rows=paginate(f"{BASE}/v3/reference/tickers?type=ETF&active=true&market=stocks&limit=1000&apiKey={KEY}")
etfs={(r.get('ticker') or '').upper() for r in etf_rows}
print("ETF symbols:", len(etfs))
# 2) latest grouped-daily with volume (step back to a trading day)
d=datetime.date.today()
grouped=None
for _ in range(6):
    day=d.isoformat()
    data=get(f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{day}?adjusted=true&apiKey={KEY}")
    if data.get("results"):
        grouped=data["results"]; print("grouped day:", day, "rows:", len(grouped)); break
    d=d-datetime.timedelta(days=1)
# 3) rank ETFs by dollar volume (close * volume)
rows=[]
for r in (grouped or []):
    t=(r.get("T") or "").upper()
    if t in etfs:
        c=r.get("c"); v=r.get("v")
        if c and v: rows.append((t, c*v))
rows.sort(key=lambda x:x[1], reverse=True)
top=[t for t,_ in rows[:200]]
print("top 200 ETFs by $vol. first 20:", top[:20])
import os as _os; OUT=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),"..","api","data","prebuilt_etfs.json")
json.dump(top, open(OUT,"w"), separators=(",",":"))
print("wrote", len(top), "->", OUT)
