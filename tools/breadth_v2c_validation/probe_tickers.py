"""Probe: ticker spelling in each input for dual-class names, and who is in the NYSE
path but not in the close on one session."""
import gzip, io, json, sys
sys.path.insert(0, "/app")
import pandas as pd
from api.services import breadth_wick_recon as wr
from common import GROUPED, REFERENCE, grouped, write

D = sys.argv[1] if len(sys.argv) > 1 else "2024-06-14"
cl = wr._s3_client()
key = "us_stocks_sip/minute_aggs_v1/%s/%s/%s.csv.gz" % (D[:4], D[5:7], D)
body = cl.get_object(Bucket="flatfiles", Key=key)["Body"].read()
df = pd.read_csv(io.BytesIO(body), compression="gzip", keep_default_na=False, dtype={"ticker": str})
tk = set(df["ticker"].astype(str).unique())
raw_g = json.load(open("%s/%s_1.json" % (GROUPED, D)))
ref = json.load(open(REFERENCE))
refmap = ref.get("map", ref) if isinstance(ref, dict) else ref
out = {
    "date": D, "minute_columns": list(df.columns), "minute_tickers": len(tk),
    "minute_with_dot": sorted(t for t in tk if "." in t)[:40],
    "minute_with_dash": sorted(t for t in tk if "-" in t)[:40],
    "minute_brk": sorted(t for t in tk if t.startswith("BRK") or t.startswith("BF")),
    "grouped_raw_keys_with_dot": sorted(k for k in raw_g if "." in k)[:40],
    "grouped_raw_brk": sorted(k for k in raw_g if k.startswith("BRK") or k.startswith("BF")),
    "reference_type": type(ref).__name__,
    "reference_top_keys": list(ref)[:5] if isinstance(ref, dict) else None,
    "reference_brk": {k: refmap[k] for k in list(refmap) if k.startswith("BRK")} if isinstance(refmap, dict) else None,
}
print(json.dumps(out, indent=1, default=str)[:6000])
print(write("probe_tickers_%s.json" % D, out))
