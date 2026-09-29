import json, os, gzip, hashlib, io, csv, time
from api.services import breadth_wick_recon as wr
from api.services import build_intraday_cache as bic
D = "2016-08-24"; key = wr._S3_KEY.format(y=D[:4], m=D[5:7], d=D)
cl = wr._s3_client()
h = cl.head_object(Bucket="flatfiles", Key=key)
meta = {k: (str(v) if k == "LastModified" else v) for k, v in h.items() if k != "ResponseMetadata"}
body = cl.get_object(Bucket="flatfiles", Key=key)["Body"].read()
raw = gzip.decompress(body)
rd = csv.reader(io.StringIO(raw.decode()))
hdr = next(rd); n = 0; tick = set(); tmin = tmax = None
ti = hdr.index("ticker"); wi = hdr.index("window_start")
for r in rd:
    n += 1; tick.add(r[ti]); w = int(r[wi]); tmin = w if tmin is None else min(tmin, w); tmax = w if tmax is None else max(tmax, w)
t0 = time.time()
per = ((bic.download_and_resample(cl, key, [1], None) or {}).get(1)) or {}
out = {"key": "flatfiles/" + key, "head": meta, "bytes_downloaded": len(body),
       "sha256_gz": hashlib.sha256(body).hexdigest(), "md5_gz": hashlib.md5(body).hexdigest(),
       "sha256_csv": hashlib.sha256(raw).hexdigest(), "header": hdr, "csv_rows": n, "distinct_tickers": len(tick),
       "window_start_min_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(tmin / 1e9)),
       "window_start_max_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(tmax / 1e9)),
       "pinned_parser_tickers": len(per), "pinned_parser_bars": sum(len(v) for v in per.values()),
       "pinned_parser_seconds": round(time.time() - t0, 1),
       "aapl_bars": len(per.get("AAPL", [])), "spy_bars": len(per.get("SPY", []))}
for nb in ("2016-08-23", "2016-08-25"):
    k2 = wr._S3_KEY.format(y=nb[:4], m=nb[5:7], d=nb)
    out["neighbor_" + nb] = {k: str(v) for k, v in cl.head_object(Bucket="flatfiles", Key=k2).items() if k in ("ContentLength", "ETag", "LastModified")}
print(json.dumps(out, indent=1))
