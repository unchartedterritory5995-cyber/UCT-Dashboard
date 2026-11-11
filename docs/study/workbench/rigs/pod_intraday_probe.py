# READ-ONLY pod probe: which intraday timeframes exist for the bank's recent Kicker days (the firm's own bars.db).
import sqlite3, datetime, sys
NL = chr(10)
con = sqlite3.connect("file:/data/bars.db?mode=ro", uri=True)
NEED = [("RBRK", "2026-09-14"), ("TH", "2026-08-27"), ("RCUS", "2026-06-22"), ("GS", "2026-05-20"), ("SMH", "2026-03-31"), ("FIVE", "2026-03-19"), ("IMAX", "2026-02-26"), ("TSM", "2026-01-02"), ("JBTM", "2025-12-10"), ("JBI", "2023-12-14")]
tfs = [r[0] for r in con.execute("SELECT DISTINCT tf FROM ohlcv").fetchall()]
sys.stdout.write("tfs " + ",".join(map(str, tfs)) + NL)
for sym, day in NEED:
    d0 = datetime.date.fromisoformat(day)
    lo = int(datetime.datetime(d0.year, d0.month, d0.day, 0, 0, tzinfo=datetime.timezone.utc).timestamp()) - 6 * 3600
    hi = lo + 3 * 86400
    parts = []
    for tf in ("5", "15", "30", "60"):
        n = con.execute("SELECT COUNT(*), MIN(ts), MAX(ts) FROM ohlcv WHERE ticker=? AND tf=? AND ts>=? AND ts<=?", (sym, tf, lo, hi)).fetchone()
        parts.append("%s:%d" % (tf, n[0]))
    first = con.execute("SELECT MIN(ts) FROM ohlcv WHERE ticker=? AND tf='30'", (sym,)).fetchone()[0]
    sys.stdout.write("%s %s %s first30=%s" % (sym, day, " ".join(parts), first) + NL)
