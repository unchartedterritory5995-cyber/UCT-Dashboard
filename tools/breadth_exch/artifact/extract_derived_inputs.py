"""Exchange Breadth V1 — extract the derived-series inputs from the FROZEN historical artifact.

Usage: python3 extract_derived_inputs.py FROZEN.db FROZEN_SHA OUT.json

Opens the frozen artifact immutable, verifies its hash, and writes per exchange (from its canonical
start, every done session in order) [date, advancing, declining, unchanged] — the closes the derived
series read. Refuses on any calendar hole or missing advancing/declining value.
"""
import hashlib
import json
import sqlite3
import sys

FROZEN, WANT, OUT = sys.argv[1:4]
STARTS = {"nyse": "2009-06-11", "nasdaq": "2008-01-02"}


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


if sha(FROZEN) != WANT:
    raise SystemExit("REFUSED: frozen artifact hash")
c = sqlite3.connect(f"file:{FROZEN}?immutable=1", uri=True)
cal = [r[0] for r in c.execute("SELECT date FROM pass_checkpoint WHERE status='done' ORDER BY date")]
meta = dict(c.execute("SELECT key, value FROM exch_meta"))
doc = {"source_artifact": FROZEN, "source_sha256": WANT, "starts": STARTS,
       "ledger_sha256": meta["ledger_sha256"], "series": {}}
for u, start in STARTS.items():
    if meta[f"{u}_start"] != start:
        raise SystemExit(f"REFUSED: artifact {u}_start {meta[f'{u}_start']} != {start}")
    v = {}
    for d, m, x in c.execute("SELECT date, metric, c FROM breadth_daily_ohlc WHERE universe=? AND "
                             "metric IN ('advancing','declining','unchanged')", (u,)):
        v.setdefault(d, {})[m] = x
    rows = []
    for d in cal:
        if d < start:
            continue
        r = v.get(d)
        if not r or r.get("advancing") is None or r.get("declining") is None:
            raise SystemExit(f"REFUSED: {u} {d} has no advancing/declining")
        rows.append([d, r["advancing"], r["declining"], r.get("unchanged")])
    if set(v) - {r[0] for r in rows}:
        raise SystemExit(f"REFUSED: {u} has rows outside the calendar/start")
    doc["series"][u] = rows
blob = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()
open(OUT, "wb").write(blob)
print(OUT, hashlib.sha256(blob).hexdigest(), {u: [len(r), r[0][0], r[-1][0]] for u, r in doc["series"].items()})
