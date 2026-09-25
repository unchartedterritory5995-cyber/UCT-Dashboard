"""Read-only: does the provider minute flat file exist for given sessions, and how did the frozen
V2c artifact treat them? argv: DATE[,DATE...]"""
import sqlite3, sys
from api.services import breadth_wick_recon as wr
c = wr._s3_client()
for d in sys.argv[1].split(","):
    y, m, _ = d.split("-")
    key = "us_stocks_sip/minute_aggs_v1/%s/%s/%s.csv.gz" % (y, m, d)
    try:
        h = c.head_object(Bucket="flatfiles", Key=key)
        print(d, "EXISTS", h.get("ContentLength"), flush=True)
    except Exception as e:  # noqa: BLE001
        print(d, "MISSING", type(e).__name__, str(e)[:160], flush=True)
f = sqlite3.connect("file:/data/_audit/breadth_replacement_v2_corrected_COMPLETE_FROZEN_2026-09-23.db?mode=ro&immutable=1", uri=True)
for d in sys.argv[1].split(","):
    print("frozen V2c", d, f.execute("select status, substr(detail,1,120) from pass_checkpoint where date=?", (d,)).fetchall(),
          "rows", f.execute("select count(*) from breadth_daily_ohlc where date=?", (d,)).fetchone()[0], flush=True)
print("DONE")
