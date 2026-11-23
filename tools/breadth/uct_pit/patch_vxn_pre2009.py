"""Fill `vxn` / `avg_10d_vxn` before 2009-09-14 in the UCT PIT series (breadth_uct_pit_v1.json).

Cboe's VXN_History.csv (market_wide.py's source) starts 2009-09-14, so the rebuilt 2008-2009 rows
had no VXN. Yahoo ^VXN reaches 2001 and matches Cboe on 99.7% of the sessions both carry
(measured 2026-11-23, 4,325 sessions), so it fills the earlier sessions; Cboe stays the source
from its first session. Same rule as market_wide.py (avg = the 10 newest closes through D).
Only absent keys are filled.

    python tools/breadth/uct_pit/patch_vxn_pre2009.py IN.json OUT.json
"""
import io
import json
import sys

import pandas as pd
import requests
import yfinance as yf

CBOE = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv"


def main(src, dst):
    doc = json.load(open(src))
    rows = doc["rows"]
    c = pd.read_csv(io.StringIO(requests.get(CBOE, timeout=30, headers={"User-Agent": "Mozilla/5.0"}).text))
    cboe = {str(pd.to_datetime(a).date()): float(b) for a, b in zip(c.iloc[:, 0], c["CLOSE"])}
    y = yf.download("^VXN", start="2007-01-01", end="2009-09-15", auto_adjust=False, progress=False)["Close"]
    if isinstance(y, pd.DataFrame):
        y = y.iloc[:, 0]
    first = min(cboe)
    ser = {str(d.date()): float(v) for d, v in y.items() if pd.notna(v) and str(d.date()) < first}
    ser.update(cboe)
    keys = sorted(ser)
    n = 0
    for d, m in rows.items():
        if d not in ser:
            continue
        if m.get("vxn") is None:
            m["vxn"] = round(ser[d], 2)
            n += 1
        if m.get("avg_10d_vxn") is None:
            past = [ser[x] for x in keys if x <= d][-10:]
            if len(past) >= 10:
                m["avg_10d_vxn"] = round(sum(past) / 10, 2)
    doc["vxn_note"] = ("vxn / avg_10d_vxn before 2009-09-14 (Cboe's VXN_History.csv starts there): "
                       "Yahoo ^VXN, which matches Cboe on 99.7% of their shared sessions")
    json.dump(doc, open(dst, "w"), separators=(",", ":"))
    print(f"filled vxn on {n} sessions")


if __name__ == "__main__":
    main(*sys.argv[1:3])
