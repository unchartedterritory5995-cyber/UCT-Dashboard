"""Exchange Breadth V1 — DARK PRODUCTIONISATION DRILL in an ISOLATED NAMESPACE (runner only).

argv: DRILL_DIR CODE_COMMIT   (run with PYTHONPATH=<code dir>, under the SERVICE interpreter and PID 1's
environment — exactly what the runner thread inherits in production: /opt/venv/bin/python needs PID 1's
LD_LIBRARY_PATH for numpy)

Nothing here writes outside DRILL_DIR. Production stores are read only through immutable SQLite opens or
plain reads; the producer's two databases are COPIED (the producer module opens its own DBs read-write), its
vintages are reached through a read-only symlink and never pruned; the real archive is cloned with hardlinks
(0444 files, never written) so acks land only in the clone; the object store is a directory.

  1  setup        copies + a 5-session store (the accepted candidate minus 2026-10-02, identity from the parent)
  2  v1           publish the 5-session store → reader installs → reads (beginning/middle/boundary/latest/
                  unsupported/derived)
  3  runner       ONE real cycle: archive+ack (re-proving every surviving owner against the producer copy) →
                  compute 2026-10-02 with the IN-REPO pinned engine (run_overlay.py) → independent validation →
                  publish v2
  4  equivalence  the drill's 2026-10-02 == the accepted candidate's, table by table; identity successor hash
  5  follow       reader adopts v2; rollback → v1 (exact artifacts) → reader follows; runner holds; re-forward
  6  singleton    a second cycle while the lock is held → SKIPPED_DUPLICATE (real fcntl)
  7  guard        the producer prune guard's verify() on every READY production vintage (read-only), and a
                  destructive prune drill on a synthetic producer root inside DRILL_DIR
  8  integrity    every protected artifact + the accepted candidate + producer DBs: hashes before == after
"""
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

DRILL, COMMIT = sys.argv[1], sys.argv[2]
X = "/data/_audit/exch_v1"
REAL_STORE = X + "/live_v1/candidate"
REAL_ARCH = X + "/live_v1/vintage_archive"
REAL_PROD = "/data/breadth_v2_producer"
PROTECTED = {
    "historical": X + "/final/breadth_exch_v1_FINAL_v20260924f_VALIDATED_FROZEN_2026-10-05.db",
    "derived": X + "/final/breadth_exch_v1_DERIVED_ad-mco-mcs_FROM_e65b2af0_VALIDATED_FROZEN_2026-10-05.db",
    "ledger": X + "/venue_ledger_72eef1c2.json",
    "v2c2": "/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f_VALIDATED_FROZEN_2026-09-29.db",
    "original": X + "/artifact/breadth_exch_v1_v1.db",
    "identity_parent": X + "/identity_v1_20261005/state/exch_identity_state_v1.json",
    "candidate": REAL_STORE + "/exch_live_candidate_v1.db",
    "candidate_identity_successor": REAL_STORE + "/identity/state_2026-10-02_896f5f00dc4f.json",
    "producer_state_db": REAL_PROD + "/state.db",
    "producer_v2_live_db": REAL_PROD + "/v2_live.db",
}
R = {"drill": DRILL, "code_commit": COMMIT, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
     "checks": {}}


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def snap_protected():
    out = {}
    for k, p in PROTECTED.items():
        st = os.stat(p)
        out[k] = [sha(p), oct(st.st_mode & 0o777), st.st_mtime]
    out["producer_vintages"] = sorted(os.listdir(REAL_PROD + "/vintages"))
    return out


def check(name, ok, detail=None):
    R["checks"][name] = bool(ok)
    if detail is not None:
        R.setdefault("detail", {})[name] = detail
    print(("PASS " if ok else "FAIL ") + name, flush=True)


def dump():
    R["pass"] = all(R["checks"].values())
    tmp = os.path.join(DRILL, "DRILL_REPORT.json.tmp")
    json.dump(R, open(tmp, "w"), indent=1, sort_keys=True, default=str)
    os.replace(tmp, os.path.join(DRILL, "DRILL_REPORT.json"))


R["before"] = snap_protected()

# ── 1. isolated namespace ────────────────────────────────────────────────────────────────────────
os.makedirs(DRILL, exist_ok=False)
P = os.path.join(DRILL, "producer")
os.makedirs(P)
for db in ("state.db", "v2_live.db"):
    src = sqlite3.connect("file:%s/%s?immutable=1" % (REAL_PROD, db), uri=True)
    dst = sqlite3.connect(os.path.join(P, db))
    src.backup(dst)
    dst.close()
    src.close()
os.symlink(REAL_PROD + "/vintages", os.path.join(P, "vintages"))
subprocess.run(["cp", "-al", REAL_ARCH, os.path.join(DRILL, "archive")], check=True)
for f in os.listdir(os.path.join(DRILL, "archive")):          # a clone never inherits acks it did not prove
    if f.endswith(".ARCHIVED.json"):
        os.remove(os.path.join(DRILL, "archive", f))
S = os.path.join(DRILL, "store")
os.makedirs(S)
shutil.copy2(REAL_STORE + "/exch_live_candidate_v1.db", S)
shutil.copytree(REAL_STORE + "/evidence", S + "/evidence")
c = sqlite3.connect(S + "/exch_live_candidate_v1.db")
for t in ("breadth_daily_ohlc", "exch_session", "membership", "venue_evidence", "derived_series", "trend_state",
          "live_session"):
    c.execute("DELETE FROM %s WHERE date='2026-10-02'" % t)
c.commit()
c.close()

os.environ.update({
    "BV2_PRODUCER_ROOT": P, "BV2_EXCH_ARCHIVE_DIR": os.path.join(DRILL, "archive"),
    "BREADTH_EXCH_OBJECT_DIR": os.path.join(DRILL, "objects"), "BREADTH_EXCH_DIR": os.path.join(DRILL, "replica"),
    "BREADTH_EXCH_RUNNER_ROOT": os.path.join(DRILL, "runner"), "BREADTH_EXCH_STORE_DIR": S,
    "BREADTH_EXCH_PARENTS_ROOT": X, "BREADTH_AUTHORITY_EXCH": "v1", "BREADTH_EXCH_CODE_COMMIT": COMMIT,
    "BREADTH_EXCH_ARCHIVER_ENABLED": "1", "BREADTH_EXCH_COMPUTE_ENABLED": "1", "BREADTH_EXCH_PUBLISH_ENABLED": "1",
    "BREADTH_LIBRARY_UNIVERSES": "us,nyse,nasdaq"})
from api.services import breadth_exchange_authority as ea      # noqa: E402  (after the env)
from api.services import breadth_exchange_publish as ep        # noqa: E402
from api.services import breadth_exchange_runner as exr        # noqa: E402
from api.services import breadth_v2_producer as prod           # noqa: E402
from api.services import breadth_vintage_archive as va         # noqa: E402
check("namespace isolated", prod.ROOT == P and prod.EXCH_ARCHIVE_DIR.startswith(DRILL)
      and exr.STORE_DIR == S and isinstance(ea.object_store(), ea.DirStore))
store = ea.object_store()
H, D = PROTECTED["historical"], PROTECTED["derived"]


def reads(tag):
    ny, na = ea.universe_history("advancing", "nyse"), ea.universe_history("advancing", "nasdaq")
    mco = ea.derived("NYSE:MCO")
    return {"tag": tag, "token": ea.token(), "nyse_first": min(ny), "nasdaq_first": min(na), "latest": max(ny),
            "nyse_sessions": len(ny), "boundary": {d: ny.get(d, {}).get("c") for d in ("2026-09-24", "2026-09-25")},
            "middle_2015_06_15": na.get("2015-06-15", {}).get("c"), "unsupported_nyse_2009_06_10": ny.get("2009-06-10"),
            "nyse_mco_first": min(mco), "nyse_mco_latest": [max(mco), mco[max(mco)]],
            "nyse_mcs_latest": ea.derived("NYSE:MCS")[max(mco)], "nyse_ad_latest": ea.derived("NYSE:AD")[max(mco)]}


# ── 2. v1: the 5-session authority ───────────────────────────────────────────────────────────────
R["captured_before_cutover"] = ep.current(store)
check("no authority before the drill's first publish", R["captured_before_cutover"] is None)
r1 = ep.publish(store, S + "/exch_live_candidate_v1.db", H, D, COMMIT)
R["publish_v1"] = r1
s1 = ea.sync_once(store)
R["sync_v1"] = s1
R["reads_v1"] = reads("v1")
check("v1 installed: 5 sessions through 2026-10-01", s1.get("result") == "installed" and R["reads_v1"]["latest"] == "2026-10-01")
check("canonical starts NYSE 2009-06-11 / NASDAQ 2008-01-02 and nothing before",
      R["reads_v1"]["nyse_first"] == "2009-06-11" and R["reads_v1"]["nasdaq_first"] == "2008-01-02"
      and R["reads_v1"]["unsupported_nyse_2009_06_10"] is None)
check("MCO first publish 2009-12-01 (NYSE)", R["reads_v1"]["nyse_mco_first"] == "2009-12-01")

# ── 3. ONE real runner cycle (archive → compute 10-02 with run_overlay → validate → publish) ───────
t0 = time.time()
cyc = exr.cycle()
R["runner_cycle"] = cyc
R["runner_cycle_seconds"] = round(time.time() - t0, 1)
check("runner: archive acked every archived vintage",
      all(va.cheap_state(prod.EXCH_ARCHIVE_DIR, t) == "acked"
          for t in ("p202609302026", "p202610012031", "p202610022300", "p202610052031")))
check("runner: computed 2026-10-02 and published v2",
      (cyc.get("steps", {}).get("publish") or {}).get("published") == 2 and cyc.get("latest_in_store") == "2026-10-02")
check("runner: validation passed", cyc.get("validation_passed") is True)

# ── 4. equivalence with the accepted candidate (the production launcher == the accepted engine) ────
a = sqlite3.connect("file:%s/exch_live_candidate_v1.db?immutable=1" % REAL_STORE, uri=True)
b = sqlite3.connect("file:%s/exch_live_candidate_v1.db?mode=ro" % S, uri=True)
eq = {}
for t in ("breadth_daily_ohlc", "exch_session", "membership", "venue_evidence", "derived_series", "trend_state"):
    n = len(a.execute("PRAGMA table_info(%s)" % t).fetchall())
    q = "SELECT * FROM %s ORDER BY %s" % (t, ",".join(str(i + 1) for i in range(n)))
    eq[t] = a.execute(q).fetchall() == b.execute(q).fetchall()
cols = ("date, seq, vintage, compute_vintage, vintage_exception, input_manifest_sha256, reference_sha256, "
        "us_v2_pub_id, venue_source, rows, rows_sha256, membership_sha256, derived_sha256, identity_state_sha256")
eq["live_session (all but provenance/completed_at)"] = a.execute("SELECT %s FROM live_session ORDER BY seq" % cols) \
    .fetchall() == b.execute("SELECT %s FROM live_session ORDER BY seq" % cols).fetchall()
pa = json.loads(a.execute("SELECT provenance FROM live_session WHERE date='2026-10-02'").fetchone()[0])
pb = json.loads(b.execute("SELECT provenance FROM live_session WHERE date='2026-10-02'").fetchone()[0])
eq["provenance (vintage, preflight, evidence, us_parity)"] = all(pa.get(k) == pb.get(k) for k in
                                                                 ("preflight", "evidence", "us_parity")) and \
    pa["vintage"]["tag"] == pb["vintage"]["tag"]
R["equivalence"] = eq
R["drill_run_provenance"] = {k: pb.get(k) for k in ("run_code_commit", "engine_launcher")}
succ = [f for f in os.listdir(S + "/identity") if f.startswith("state_2026-10-02") and f.endswith(".json")
        and "MANIFEST" not in f] if os.path.isdir(S + "/identity") else []
R["identity_successor"] = succ
check("2026-10-02 recomputed by the scheduled path == accepted candidate (every table)", all(eq.values()), eq)
check("identity successor reproduced (896f5f00dc4f)", succ == ["state_2026-10-02_896f5f00dc4f.json"]
      and sha(S + "/identity/" + succ[0]) == R["before"]["candidate_identity_successor"][0])
check("drill store logical == accepted candidate logical (content; lineage identical)",
      ea._lc().logical_sha256_conn(a) == ea._lc().logical_sha256_conn(b))
a.close()
b.close()

# ── 5. reader follows; rollback; hold; re-forward ─────────────────────────────────────────────────
R["sync_v2"] = ea.sync_once(store)
R["reads_v2"] = reads("v2")
check("reader followed v2 (latest 2026-10-02, token changed)",
      R["reads_v2"]["latest"] == "2026-10-02" and R["reads_v2"]["token"] != R["reads_v1"]["token"])
check("accepted 10-02 derived values (NYSE AD 154810, MCO -13.45, MCS -961.93)",
      R["reads_v2"]["nyse_ad_latest"] == 154810.0 and round(R["reads_v2"]["nyse_mco_latest"][1], 2) == -13.45
      and round(R["reads_v2"]["nyse_mcs_latest"], 2) == -961.93)
check("history before the boundary identical across v1 and v2",
      R["reads_v1"]["boundary"]["2026-09-24"] == R["reads_v2"]["boundary"]["2026-09-24"]
      and R["reads_v1"]["middle_2015_06_15"] == R["reads_v2"]["middle_2015_06_15"])
t0 = time.time()
R["rollback"] = ep.rollback(store, 1)
R["sync_rollback"] = ea.sync_once(store)
R["rollback_seconds"] = round(time.time() - t0, 2)
R["reads_rollback"] = reads("rollback")
check("rollback → v1's exact artifacts, reader back at 2026-10-01",
      R["reads_rollback"]["latest"] == "2026-10-01" and R["rollback"]["rollback_of"] == 1)
R["runner_after_rollback"] = exr.cycle()
check("runner holds while a rollback is in force",
      R["runner_after_rollback"].get("state") == "ROLLBACK_IN_FORCE"
      and (R["runner_after_rollback"]["steps"].get("publish") or {}).get("reason") == "ROLLBACK_IN_FORCE")
R["re_forward"] = ep.publish(store, S + "/exch_live_candidate_v1.db", H, D, COMMIT, re_forward=True)
R["sync_forward"] = ea.sync_once(store)
check("re-forward (operator) → reader at 2026-10-02 again", ea.status()["latest_session"] == "2026-10-02")
R["runner_current"] = exr.cycle()
check("runner CURRENT after re-forward", R["runner_current"].get("state") in ("CURRENT", "CURRENT_WITH_PRUNE_BLOCKED"),
      R["runner_current"].get("state"))

# ── 6. singleton (real fcntl) ─────────────────────────────────────────────────────────────────────
held = exr._lock()
R["duplicate"] = exr.cycle()
held.close()
check("second invocation while locked → SKIPPED_DUPLICATE", R["duplicate"].get("state") == "SKIPPED_DUPLICATE")

# ── 7. producer prune guard: real vintages (read-only verify) + a destructive drill on a fixture ────
pc = sqlite3.connect("file:%s/v2_live.db?immutable=1" % REAL_PROD, uri=True)
owned = {}
for d, prov in pc.execute("SELECT date, provenance FROM v2_session"):
    p = json.loads(prov)
    owned.setdefault(p["vintage_tag"], []).append({"date": d, "input_manifest_sha256": p["input_manifest_sha256"],
                                                   "reference_sha256": p["reference_sha256"]})
pc.close()
gv = {}
for t in sorted(os.listdir(REAL_PROD + "/vintages")):
    t0 = time.time()
    try:
        va.verify(prod.EXCH_ARCHIVE_DIR, t, REAL_PROD + "/vintages/" + t, owned_provenance=owned.get(t, []))
        gv[t] = {"verified": True, "owned_sessions": [o["date"] for o in owned.get(t, [])],
                 "seconds": round(time.time() - t0, 1)}
    except va.AckRefused as e:
        gv[t] = {"verified": False, "reason": e.reason}
R["guard_verify_real_vintages"] = gv
check("every surviving producer vintage is archived AND re-verified byte-for-byte (incl. owner provenance)",
      gv and all(v["verified"] for v in gv.values()), gv)
F = os.path.join(DRILL, "prune_fixture")
fx_root, fx_arch = os.path.join(F, "producer"), os.path.join(F, "archive")
prod.ROOT, prod.EXCH_ARCHIVE_DIR = fx_root, fx_arch
tags = ["p2026100%d0000" % i for i in range(1, 6)]
for i, t in enumerate(tags):
    vd = os.path.join(fx_root, "vintages", t)
    for sub in ("inputs_", "grouped_"):
        os.makedirs(os.path.join(vd, sub + t))
    open(os.path.join(vd, "inputs_" + t, "INPUT_MANIFEST.json"), "w").write(t)
    open(os.path.join(vd, "inputs_" + t, "pit_reference.json"), "w").write("r")
    open(os.path.join(vd, "grouped_" + t, "x_0.json"), "w").write("[%d]" % i)
    with prod._state() as cc:
        cc.execute("INSERT INTO vintage VALUES(?,?,?,?,?,?,?,?)", (t, "", "", "", "", t, "ready", "{}"))
first = prod._prune_vintages()
exr_lc = ea._lc()
exr_lc.archive_vintages(os.path.join(fx_root, "vintages"), [tags[0]], fx_arch, code_commit=COMMIT)
second = prod._prune_vintages()
R["prune_fixture"] = {"before_archive": first, "after_archiving_one": second,
                      "remaining": sorted(os.listdir(os.path.join(fx_root, "vintages"))),
                      "guard_status": prod.archive_guard_status()}
check("fixture: nothing pruned without an ack; exactly the acked one pruned after",
      first["pruned"] == [] and set(first["blocked"]) == set(tags[:2]) and second["pruned"] == [tags[0]]
      and second["blocked"] == {tags[1]: "ACK_MISSING"})
prod.ROOT, prod.EXCH_ARCHIVE_DIR = P, os.path.join(DRILL, "archive")

# ── 8. integrity: nothing outside the drill changed ───────────────────────────────────────────────
R["after"] = snap_protected()
check("protected artifacts, candidate, producer DBs and producer vintages unchanged (bytes, modes, mtimes)",
      R["after"] == R["before"], {k: (R["before"][k], R["after"][k]) for k in R["after"] if R["after"][k] != R["before"][k]})
R["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
dump()
print("DRILL", "PASS" if R["pass"] else "FAIL", flush=True)
