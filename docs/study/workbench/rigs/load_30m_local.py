"""Load the saved 30-minute JBI bars into every populated sandbox bars.db (tf '30', unix-second ts). Sandbox only."""
import json, sqlite3, glob, os
L = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad\local_study"
j = json.load(open(os.path.join(L, "walkthrough", "data", "JBI_2023-12-14_30m.json")))
rows = [(j["sym"], "30", b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in j["bars"]]
targets = [d for d in glob.glob(r"C:\Users\pgosz\AppData\Local\Temp\uct_tests_datadir_*")
           if os.path.exists(os.path.join(d, "study.db")) and os.path.getsize(os.path.join(d, "study.db")) > 100000]
for d in targets:
    assert "uct_tests_datadir_" in d
    c = sqlite3.connect(os.path.join(d, "bars.db"))
    c.executemany("INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", rows)
    c.commit(); print(d, c.execute("select count(*) from ohlcv where tf='30'").fetchone()[0]); c.close()
