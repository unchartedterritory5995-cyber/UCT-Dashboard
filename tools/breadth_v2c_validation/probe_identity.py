"""Probe: does the provider expose point-in-time security identity and a split ledger?"""
import json, os, time, urllib.request
K = os.environ.get("MASSIVE_API_KEY", "")
B = "https://api.massive.com"
def get(path):
    u = B + path + ("&" if "?" in path else "?") + "apiKey=" + K
    t = time.time()
    try:
        with urllib.request.urlopen(u, timeout=30) as r:
            return json.load(r), round(time.time() - t, 2)
    except Exception as e:
        return {"error": str(e)[:200]}, round(time.time() - t, 2)
for p in ["/v3/reference/tickers/ABAT?date=2010-06-01", "/v3/reference/tickers/ABAT",
          "/v3/reference/tickers/AD?date=2008-06-02", "/v3/reference/tickers/AD",
          "/v3/reference/tickers/META?date=2021-06-01", "/v3/reference/tickers/BRK.B",
          "/v3/reference/splits?ticker=AAPL&limit=10", "/v3/reference/splits?ticker=COHR&limit=10",
          "/v3/reference/splits?ticker=BCPC&limit=10", "/v3/reference/splits?ticker=TPC&limit=10",
          "/v3/reference/splits?ticker=WHLR&limit=10",
          "/vX/reference/tickers/META/events", "/vX/reference/tickers/ABAT/events",
          "/v3/reference/splits?execution_date.gte=2026-09-01&limit=50"]:
    j, s = get(p)
    print("==", p, s, "s"); print(json.dumps(j)[:900])
