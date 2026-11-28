"""Build universe.json for the replay from a LOCAL bars.db (read-only, immutable): the daily tickers with >= 600 D
rows ranked by 20-day dollar volume, and per intraday/W/M tf the tickers holding a full first-paint window.
Never committed (derived from licensed vendor data). Usage: python build_universe.py [store]"""
import json, os, sqlite3, sys
store = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("REPLAY_STORE", "C:/data/bars.db")
c = sqlite3.connect("file:%s?mode=ro&immutable=1" % store.replace("\\", "/"), uri=True)
tick, cur = [], ""
while True:
    r = c.execute("SELECT ticker FROM ohlcv WHERE ticker > ? ORDER BY ticker LIMIT 1", (cur,)).fetchone()
    if not r:
        break
    cur = r[0]
    tick.append(cur)
def n(s, tf, lim):
    return c.execute("select count(*) from (select 1 from ohlcv where ticker=? and tf=? limit ?)", (s, tf, lim)).fetchone()[0]
D = []
for s in tick:
    if n(s, "D", 600) >= 600:
        rows = c.execute("select c,v from ohlcv where ticker=? and tf='D' order by ts desc limit 20", (s,)).fetchall()
        D.append((s, sum((a or 0) * (b or 0) for a, b in rows) / max(1, len(rows))))
D.sort(key=lambda x: -x[1])
need = {"1": 1200, "5": 1200, "15": 1200, "30": 1200, "60": 1200, "W": 600, "M": 200}
intra = {tf: [s for s, _ in D if n(s, tf, k) >= k] for tf, k in need.items()}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "universe.json")
json.dump({"D": D, "intraday": intra}, open(out, "w"))
print(len(D), {k: len(v) for k, v in intra.items()}, "->", out)
