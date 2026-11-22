# READ-ONLY pod dump: daily bars for the Study bank's chart items (the firm's own bars.db), gzip+base64 on stdout.
import sqlite3, json, zlib, base64, datetime, sys
NEED = __NEED__
NL = chr(10)
con = sqlite3.connect("file:/data/bars.db?mode=ro", uri=True)
out = {}
for sym, r in NEED.items():
    lo = datetime.date.fromisoformat(r["lo"]) - datetime.timedelta(days=int(r["w"] * 1.7) + 30)
    hi = datetime.date.fromisoformat(r["hi"]) + datetime.timedelta(days=int(r["f"] * 1.7) + 60)
    rows = con.execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts>=? AND ts<=? ORDER BY ts",
        (sym.upper(), int(lo.strftime("%Y%m%d")), int(hi.strftime("%Y%m%d")))).fetchall()
    out[sym] = [[int(t), float(o), float(h), float(l), float(c), int(v or 0)] for t, o, h, l, c, v in rows]
blob = base64.b64encode(zlib.compress(json.dumps(out, separators=(",", ":")).encode(), 9)).decode()
sys.stdout.write("BEGIN_BARS" + NL + blob + NL + "END_BARS" + NL)
empty = [s for s, v in out.items() if not v]
sys.stderr.write("syms %d bars %d empty %d %s" % (len(out), sum(len(v) for v in out.values()), len(empty), empty[:20]) + NL)
