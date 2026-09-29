"""Semantic digest of a V2c2 artifact: every row EXCEPT the updated_at/at wall-clock columns."""
import hashlib, json, sqlite3
def H(o): return hashlib.sha256(json.dumps(o, sort_keys=True, default=repr).encode()).hexdigest()
def digest(path):
    c = sqlite3.connect("file:%s?mode=ro&immutable=1" % path, uri=True)
    out = {"ohlc": {}, "session": {}, "session_v2c2": {}, "checkpoint": {}}
    cur = {}
    for u, d, m, o, h, l, cc, s in c.execute(
            "SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc ORDER BY universe,date,metric"):
        cur.setdefault(u + "|" + d, []).append((m, repr(o), repr(h), repr(l), repr(cc), s))
    out["ohlc"] = {k: H(v) for k, v in cur.items()}
    for r in c.execute("SELECT * FROM pass_session ORDER BY date"): out["session"][r[0]] = H(list(r))
    for r in c.execute("SELECT * FROM pass_session_v2c2 ORDER BY date"): out["session_v2c2"][r[0]] = H(list(r))
    for r in c.execute("SELECT date,status,universes,rows,detail FROM pass_checkpoint ORDER BY date"):
        out["checkpoint"][r[0]] = H(list(r))
    out["meta"] = dict(c.execute("SELECT key,value FROM pass_meta"))
    out["n_rows"] = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
    c.close()
    return out
