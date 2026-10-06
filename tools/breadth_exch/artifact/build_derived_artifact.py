"""Exchange Breadth V1 — build the DERIVED historical artifact (NYSE/NASDAQ :AD :MCO :MCS).

Usage: python build_derived_artifact.py INPUTS.json OUT.db CODE_COMMIT

Pure: reads the inputs extracted from the frozen historical artifact, computes the six series with
the locked derivation (`derive_exchange_series.derive`), and writes a SQLite artifact whose bytes
depend only on its content (no timestamps, fixed page size, sorted inserts, DELETE journal). Values
that are not published (MCO/MCS inside the 120-session burn-in) are not stored.
"""
import hashlib
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(HERE))
import derive_exchange_series as dx                          # noqa: E402
from api.services.market_indicators import mcclellan as mc   # noqa: E402

INP, OUT, COMMIT = sys.argv[1:4]
if os.path.exists(OUT):
    raise SystemExit(f"REFUSED: {OUT} exists")
raw = open(INP, "rb").read()
doc = json.loads(raw)


def file_sha_lf(p):
    return hashlib.sha256(open(p, "rb").read().replace(b"\r\n", b"\n")).hexdigest()


series_rows, meta = [], {
    "artifact": "exchange-breadth-derived-v1",
    "source_artifact_sha256": doc["source_sha256"], "source_artifact": doc["source_artifact"],
    "inputs_sha256": hashlib.sha256(raw).hexdigest(), "ledger_sha256": doc["ledger_sha256"],
    "code_commit": COMMIT,
    "derive_exchange_series_sha256_lf": file_sha_lf(dx.__file__),
    "mcclellan_sha256_lf": file_sha_lf(mc.__file__),
    "methodology.AD": "adline-v1: level(t)=level(t-1)+(ADV-DEC); level 0 before the exchange's first session; "
                      "a hole holds the level; no vendor seed",
    "methodology.MCO": "ratio-adjusted McClellan: R=(ADV-DEC)/(ADV+DEC)*1000 (unchanged excluded); "
                       "trends 0.10/0.05, seed 0; MCO=fast-slow; holes advance neither trend; NOT published "
                       "inside the 120-valid-session burn-in (first publish = 121st valid session)",
    "methodology.MCS": "summation of MCO from a DECLARED epoch = the MCO first-publish session, base 0 on the "
                       "epoch (its own MCO not added); holes hold the level; no vendor anchor",
    "alpha_fast": repr(mc.ALPHA_19), "alpha_slow": repr(mc.ALPHA_39), "burn_in": str(dx.METHOD.burn_in),
    "seed_mode": mc.SEED_ZERO, "unchanged_in_denominator": str(dx.METHOD.unchanged_in_denominator),
    "authority": "NOT member-authoritative; historical only; live leg blocked (identity-key stability)"}
for u, X in (("nyse", "NYSE"), ("nasdaq", "NASDAQ")):
    rows = doc["series"][u]
    dates = [r[0] for r in rows]
    res = dx.derive(dates, [r[1] for r in rows], [r[2] for r in rows])
    meta[f"{X}.start"] = dates[0]
    meta[f"{X}.end"] = dates[-1]
    meta[f"{X}.sessions"] = str(len(dates))
    meta[f"{X}.mco_first_publish"] = res["epoch"]
    meta[f"{X}.mcs_epoch"] = res["epoch"]
    for k in ("AD", "MCO", "MCS"):
        vals = [(d, v) for d, v in zip(dates, res[k]) if v is not None]
        meta[f"{X}:{k}.rows"] = str(len(vals))
        meta[f"{X}:{k}.first"] = vals[0][0]
        meta[f"{X}:{k}.last"] = vals[-1][0]
        series_rows += [(f"{X}:{k}", d, float(v)) for d, v in vals]
series_rows.sort()
c = sqlite3.connect(OUT)
c.execute("PRAGMA page_size=4096")
c.execute("PRAGMA journal_mode=DELETE")
c.execute("CREATE TABLE derived_meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID")
c.execute("CREATE TABLE derived_series (series TEXT, date TEXT, value REAL, PRIMARY KEY (series, date)) WITHOUT ROWID")
c.executemany("INSERT INTO derived_meta VALUES(?,?)", sorted(meta.items()))
c.executemany("INSERT INTO derived_series VALUES(?,?,?)", series_rows)
c.commit()
c.close()
content = hashlib.sha256(json.dumps([sorted(meta.items()), series_rows]).encode()).hexdigest()
print(json.dumps({"out": OUT, "sha256": hashlib.sha256(open(OUT, "rb").read()).hexdigest(),
                  "content_sha256": content, "rows": len(series_rows),
                  **{k: v for k, v in meta.items() if k.endswith((".rows", ".first", ".last", "publish"))}}, indent=1))
