"""Why does the pass sometimes derive a different close minute than the oracle?

Compares per-ET-minute participation from the PRODUCTION parser
(`build_intraday_cache.download_and_resample` + `breadth_session.participation`) with the
oracle's pandas parse, for the given sessions, around the open and the close.
"""
import json
import sys

from api.services import breadth_session as bs
from api.services import breadth_wick_recon as wr
from api.services import build_intraday_cache as bic

from common import write
import oracle as O

out = {}
cl = wr._s3_client()
for D in sys.argv[1].split(","):
    key = wr._S3_KEY.format(y=D[:4], m=D[5:7], d=D)
    per = bic.download_and_resample(cl, key, [1], None)[1]
    pp = bs.participation(per)
    df = O.load_minutes(D, cl)
    po = df.groupby("m")["ticker"].nunique().to_dict()
    bounds = bs.rth_bounds(per)
    inside = {m: n for m, n in pp.items() if 570 <= m <= 960}
    busiest_m = max(inside, key=inside.get)
    mins = list(range(568, 575)) + list(range(955, 963)) + list(range(777, 784)) + [busiest_m]
    out[D] = {"prod_bounds": bounds, "prod_busiest": (busiest_m, inside[busiest_m]),
              "prod_floor": inside[busiest_m] * 0.15,
              "oracle_busiest": max((n, m) for m, n in po.items() if 570 <= m <= 960),
              "minutes": {m: {"prod": pp.get(m, 0), "oracle": po.get(m, 0)} for m in sorted(set(mins))},
              "tickers_prod": len(per), "tickers_oracle": int(df["ticker"].nunique()),
              "rows_oracle": int(len(df)),
              "bars_prod": sum(len(v) for v in per.values())}
    # which tickers exist in one parse and not the other
    a, b = set(per), set(df["ticker"].unique())
    out[D]["only_prod"] = sorted(a - b)[:20]
    out[D]["only_oracle"] = sorted(b - a)[:20]
    print(D, json.dumps(out[D])[:1500], flush=True)
print(write("participation_diff.json", out))
