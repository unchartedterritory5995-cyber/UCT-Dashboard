"""Exchange Breadth V1 — freeze the accepted (repaired) historical artifact.

Usage: python3 freeze_historical.py REPAIRED REPAIR_MANIFEST REVALIDATION_JSON VALIDATION_REPORT FINAL_PATH

Follows the frozen-Breadth convention (`…/final/<name>_VALIDATED_FROZEN_<date>.db`, mode 0444):
copies REPAIRED byte-for-byte to FINAL_PATH (never moves or rewrites it), verifies the hash, sets
0444, and writes `<FINAL_PATH>.FROZEN.json` (0444) with the full provenance. Refuses if the
revalidation did not pass, the repaired hash differs from its manifest, or FINAL_PATH exists.
"""
import hashlib
import json
import os
import shutil
import sqlite3
import stat
import sys
import time

REPAIRED, RMAN, REVAL, VREPORT, FINAL = sys.argv[1:6]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


rman = json.load(open(RMAN))
reval = json.load(open(REVAL))
if not reval.get("pass"):
    raise SystemExit("REFUSED: revalidation did not pass")
if sha(REPAIRED) != rman["repaired_sha256"] or reval.get("artifact_sha256") != rman["repaired_sha256"]:
    raise SystemExit("REFUSED: repaired artifact hash does not match its manifest / revalidation")
if os.path.exists(FINAL):
    raise SystemExit(f"REFUSED: {FINAL} exists")
os.makedirs(os.path.dirname(FINAL), exist_ok=True)
shutil.copyfile(REPAIRED, FINAL)
fsha = sha(FINAL)
if fsha != rman["repaired_sha256"]:
    os.remove(FINAL)
    raise SystemExit("REFUSED: frozen copy is not byte-identical")
os.chmod(FINAL, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)

c = sqlite3.connect(f"file:{FINAL}?immutable=1", uri=True)
meta = dict(c.execute("SELECT key, value FROM exch_meta"))
counts = {u: {"rows": n, "sessions": s, "first": a, "last": b}
          for u, n, s, a, b in c.execute("SELECT universe, COUNT(*), COUNT(DISTINCT date), MIN(date), MAX(date) "
                                         "FROM breadth_daily_ohlc GROUP BY universe")}
tables = {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
          for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")}
ck = c.execute("SELECT status, COUNT(*), MIN(date), MAX(date) FROM pass_checkpoint GROUP BY status").fetchall()
c.close()
man = {"canonical_name": os.path.basename(FINAL), "path": FINAL, "sha256": fsha, "bytes": os.path.getsize(FINAL),
       "mode": oct(os.stat(FINAL).st_mode & 0o777), "frozen_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "lineage": {"original_candidate": rman["source_artifact"], "original_sha256": rman["source_sha256"],
                   "repaired_candidate": rman["repaired_artifact"], "repaired_sha256": rman["repaired_sha256"],
                   "repair": rman["operation"], "repair_code_commit": rman["repair_code_commit"],
                   "rows_inserted": rman["rows_inserted"],
                   "statement": "accepted repair descendant of 1ba6b1a8…92430e: +4 exch_session rows, nothing else"},
       "canonical_starts": {"NASDAQ": meta.get("nasdaq_start"), "NYSE": meta.get("nyse_start")},
       "owner_decisions_2026_10_05": {
           "NYSE_CANONICAL_START": "2009-06-11 ACCEPTED — fail-closed: 2008-11..2009-06-10 securities vanish from the "
                                   "dated venue lists (many NYSE American/Arca); non-Nasdaq is never assumed NYSE",
           "NASDAQ_CANONICAL_START": "2008-01-02",
           "identity_model": "ticker|delisted_utc ACCEPTED FOR THIS FROZEN HISTORY ONLY; NOT accepted for the live "
                             "leg (a later reference can add delisted_utc and re-key an identity)"},
       "methodology": meta.get("methodology"), "grind_code_commit": "eff3eca45",
       "grind_code_dir": "/data/_audit/exch_v1/code_grind_eff3eca45b2f",
       "venue_ledger": {"path": meta.get("ledger_path"), "content_sha256": meta.get("ledger_sha256"),
                        "population_sha256": meta.get("population_sha256")},
       "inputs": {"dir": meta.get("inputs"), "grouped_dir": meta.get("grouped_dir"),
                  "INPUT_MANIFEST.json": "0c5caacda02ee4634197aefd8c261f648e6ffe26496379f05ed7f753a1d7d07a",
                  "pit_reference.json": "cf20e5f0019849aa7161170761d426da95e93df8f84f3a069527f13e10959d7c",
                  "grouped_vintage_manifest.json": "2b8c0eafe714c52d17384bdc29af14b8cc9f3d4314181a6f632b2ee28d390773"},
       "validation": {"report": VREPORT, "report_sha256": sha(VREPORT), "revalidation": REVAL,
                      "revalidation_sha256": sha(REVAL)},
       "universes": counts, "tables": tables, "checkpoints": ck,
       "read_with": "sqlite3 file:<path>?immutable=1"}
mp = FINAL + ".FROZEN.json"
json.dump(man, open(mp, "w"), indent=1, sort_keys=True)
os.chmod(mp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
print(json.dumps(man, indent=1, sort_keys=True))
