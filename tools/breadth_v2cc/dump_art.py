"""Export one universe's EOD closes {date: {metric: c}} from an artifact (read-only)."""
import json, sqlite3, sys
art, uni, out = sys.argv[1], sys.argv[2], sys.argv[3]
c = sqlite3.connect("file:%s?mode=ro&immutable=1" % art, uri=True)
R = {}
for d, m, v in c.execute("SELECT date, metric, c FROM breadth_daily_ohlc WHERE universe=?", (uni,)):
    R.setdefault(d, {})[m] = v
json.dump(R, open(out, "x"))
print(out, len(R))
