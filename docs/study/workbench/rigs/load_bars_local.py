"""Load the pod's bars dump (pod_bars_out.txt) into every sandbox bars.db, then the import route can resolve chart items.
Sandbox only: refuses any path outside the Temp sandbox prefixes."""
import base64, zlib, json, sqlite3, glob, os, sys

L = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
txt = open(os.path.join(L, "pod_bars_out.txt"), encoding="ascii", errors="ignore").read()
a, b = txt.index("BEGIN_BARS") + len("BEGIN_BARS"), txt.index("END_BARS")
blob = "".join(txt[a:b].split())
bars = json.loads(zlib.decompress(base64.b64decode(blob)).decode())
json.dump(bars, open(os.path.join(L, "pod_bars.json"), "w"))
print("syms", len(bars), "bars", sum(len(v) for v in bars.values()))

DDL = """CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL,
         o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))"""
targets = [d for d in glob.glob(r"C:\Users\pgosz\AppData\Local\Temp\uct_tests_datadir_*")
           if os.path.exists(os.path.join(d, "study.db")) and os.path.getsize(os.path.join(d, "study.db")) > 100000]
for d in targets:
    assert "uct_tests_datadir_" in d
    p = os.path.join(d, "bars.db")
    c = sqlite3.connect(p)
    c.execute(DDL)
    c.execute("CREATE INDEX IF NOT EXISTS idx_ohlcv_lookup ON ohlcv(ticker, tf, ts DESC)")
    rows = [(s.upper(), "D", t, o, h, l, cl, v) for s, lst in bars.items() for t, o, h, l, cl, v in lst]
    c.executemany("INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", rows)
    c.commit()
    print(p, c.execute("select count(*) from ohlcv").fetchone()[0])
    c.close()
