"""Reference types of the non-USD dividend payers in canonical uct + provider FX availability (read-only)."""
import json, os, sys, urllib.request
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_v20260923b"
from api.services import breadth_pit_frame as bpf
ref = bpf.reference_map()
print("COMMON_TYPES", bpf.COMMON_TYPES)
for t in ("BMO", "TD", "RY", "ENB", "CNQ", "CP", "SU", "BCE", "DB", "AZN", "CCJ", "SHOP", "TSM", "BHP", "SAN", "BBVA", "NVO", "UL"):
    r = bpf.resolve(ref.get(t), "2026-09-11")
    print(t, (r or {}).get("type"), (r or {}).get("primary_exchange"), (r or {}).get("currency_name"))
K = os.environ["MASSIVE_API_KEY"]
for pair in ("C:CADUSD", "C:EURUSD", "C:GBPUSD", "C:JPYUSD", "C:USDCAD"):
    u = "https://api.massive.com/v2/aggs/ticker/%s/range/1/day/2008-01-01/2008-01-10?adjusted=true&apiKey=%s" % (pair, K)
    try:
        j = json.load(urllib.request.urlopen(u, timeout=60)); print(pair, j.get("resultsCount"), (j.get("results") or [{}])[0])
    except Exception as e:
        print(pair, "ERR", e)
