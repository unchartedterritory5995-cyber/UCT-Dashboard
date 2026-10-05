"""Exchange Breadth V1 — real-run restart / idempotency / crash-safety proof (isolated proof store).

Usage (runner, plain python3): live_crash_restart_test.py CODE_DIR LAUNCH WORKDIR REFERENCE_PROOF_DB OUT.json

For every crash boundary: hard-kill the live leg (os._exit at the boundary) while it appends the FIRST
session into a fresh proof store, assert nothing partial is visible, restart without the hook, assert the
session's rows hash equals the uninterrupted reference store's. Then: rerun with no new input → 0
appended + identical logical hash; run with --max-sessions 1 → exactly one more session; no duplicates.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys

CODE, LAUNCH, WORK, REF, OUT = sys.argv[1:6]
E = os.path.join(CODE, "tools", "breadth_exch", "exch_live_leg.py")
ARGS = ["--mode", "proof", "--pin-vintage", "p202610022300"]
POINTS = ["after_evidence", "after_membership", "during_rows", "before_derived", "after_rows_before_marker"]
TABLES = ("breadth_daily_ohlc", "exch_session", "membership", "venue_evidence", "derived_series", "trend_state")


def run(store, extra=(), crash=None):
    args = ["--code-commit", os.path.basename(CODE).replace("code_live_", "")] + (["--crash-at", crash] if crash else [])
    p = subprocess.run([sys.executable, LAUNCH, E, "--store", store, *ARGS, *args, *extra], cwd=os.path.dirname(LAUNCH),
                       capture_output=True, text=True)
    st = json.load(open(os.path.join(store, "STATUS.json"))) if not crash else None
    return p.returncode, st


def snap(store):
    c = sqlite3.connect(f"file:{os.path.join(store, 'exch_live_PROOF.db')}?immutable=1", uri=True)
    out = {"completed": [r[0] for r in c.execute("SELECT date FROM live_session ORDER BY seq")],
           "rows_sha": dict(c.execute("SELECT date, rows_sha256 FROM live_session")),
           "counts": {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES},
           "dups": sum(c.execute(f"SELECT COUNT(*) - COUNT(DISTINCT date || '|' || {k}) FROM {t}").fetchone()[0]
                       for t, k in (("membership", "ticker"), ("derived_series", "series"), ("trend_state", "exchange")))}
    c.close()
    return out


ref = sqlite3.connect(f"file:{REF}?immutable=1", uri=True)
REF_SHA = dict(ref.execute("SELECT date, rows_sha256 FROM live_session"))
rep = {"crash": {}, "reference_rows_sha": REF_SHA}
for pt in POINTS:
    store = os.path.join(WORK, "crash_" + pt)
    shutil.rmtree(store, ignore_errors=True)
    rc, _ = run(store, ["--max-sessions", "1"], crash=pt)
    after_crash = snap(store)
    rc2, st = run(store, ["--max-sessions", "1"])
    after = snap(store)
    d = after["completed"][0] if after["completed"] else None
    rep["crash"][pt] = {"crash_rc": rc, "visible_after_crash": after_crash["completed"],
                        "rows_after_crash": after_crash["counts"], "restart_appended": st["appended"],
                        "recovered_equals_uninterrupted": d is not None and after["rows_sha"][d] == REF_SHA.get(d),
                        "dups": after["dups"],
                        "pass": rc == 97 and after_crash["completed"] == [] and all(v == 0 for v in after_crash["counts"].values())
                        and st["appended"] == [d] and after["rows_sha"][d] == REF_SHA.get(d) and after["dups"] == 0}
# restart with no new input, then exactly one new session
store = os.path.join(WORK, "crash_" + POINTS[-1])
h0 = json.load(open(os.path.join(store, "STATUS.json")))["logical_sha256"]
_, st1 = run(store, ["--through", st["completed"][-1]])
s1 = snap(store)
_, st2 = run(store, ["--max-sessions", "1"])
s2 = snap(store)
rep["restart_no_new_input"] = {"appended": st1["appended"], "logical_sha_unchanged": st1["logical_sha256"] == h0}
rep["one_new_session"] = {"appended": st2["appended"], "completed": s2["completed"], "dups": s2["dups"],
                          "rows_sha_equals_uninterrupted": all(s2["rows_sha"][d] == REF_SHA.get(d) for d in s2["completed"])}
rep["pass"] = (all(v["pass"] for v in rep["crash"].values()) and st1["appended"] == [] and rep["restart_no_new_input"][
    "logical_sha_unchanged"] and len(st2["appended"]) == 1 and s2["dups"] == 0 and rep["one_new_session"][
    "rows_sha_equals_uninterrupted"])
json.dump(rep, open(OUT, "w"), indent=1, sort_keys=True, default=str)
print(json.dumps(rep, indent=1, default=str)[:3000])
