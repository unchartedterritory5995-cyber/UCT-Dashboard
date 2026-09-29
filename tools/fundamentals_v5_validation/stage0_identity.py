"""POST-GRIND STAGE 0 (runner, pinned V5 code): lock down the identity of the completed V5 artifact.
READ-ONLY: every store is opened mode=ro; the only file written is validation/stage0.json."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import hashlib, json, os, sqlite3, subprocess, time

ROOT = "/data/fundamentals_pit_v5"; RUN = ROOT + "/run"; VAL = ROOT + "/validation"; CTL = "/data/_runner"
V5DB, SRC = RUN + "/v5.db", "/data/fundamentals_pit.db"
RUN_ID = "v5-20260925T124921Z"


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def st(p):
    if not os.path.exists(p):
        return None
    s = os.stat(p)
    return {"bytes": s.st_size, "mtime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(s.st_mtime)),
            "mtime_ns": s.st_mtime_ns}


def ro(p):
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=30)


def logical(conn, version):
    """The same logical digest used for the V4 baseline (cik, metric, t_eff, v, period_end, method)."""
    h, n = hashlib.sha256(), 0
    for r in conn.execute("SELECT cik, metric, t_eff, v, period_end, method FROM series_point "
                          "WHERE derivation_version=? ORDER BY cik, metric, t_eff", (version,)):
        h.update(repr(r).encode()); n += 1
    return n, h.hexdigest()


def full_digest(conn, version):
    """Every stored column of every point, sources included."""
    h = hashlib.sha256()
    for r in conn.execute("SELECT cik, metric, derivation_version, t_eff, v, period_end, method, sources FROM series_point "
                          "WHERE derivation_version=? ORDER BY cik, metric, t_eff", (version,)):
        h.update(repr(r).encode())
    return h.hexdigest()


out = {"stage": 0, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
if any(b"fundamentals_pit.v5_rebuild" in open(f"/proc/{p}/cmdline", "rb").read()
       for p in os.listdir("/proc") if p.isdigit() and os.path.exists(f"/proc/{p}/cmdline")):
    sys.exit("REFUSED: a v5_rebuild process is alive")
files = {}
for p in [V5DB, V5DB + "-wal", V5DB + "-shm", SRC, SRC + "-wal"] + [f"{RUN}/{f}" for f in sorted(os.listdir(RUN)) if not f.startswith("v5.db")] \
        + [f"{CTL}/{f}" for f in sorted(os.listdir(CTL))] + [f"{VAL}/{f}" for f in sorted(os.listdir(VAL))]:
    s = st(p)
    if s is not None:
        s["sha256"] = sha(p) if not p.endswith("-shm") else None
        files[p] = s
out["files"] = files
out["v5_db_sha256_pre_validation"] = files[V5DB]["sha256"]
out["v5_db_bytes"] = files[V5DB]["bytes"]
out["wal_bytes_at_start"] = (files.get(V5DB + "-wal") or {}).get("bytes")
out["run_json"] = json.load(open(RUN + "/run.json"))
out["acquisition"] = {k: v for k, v in json.load(open(RUN + "/acquisition.json")).items() if k != "unresolved"}
out["acquisition"]["unresolved_n"] = len(json.load(open(RUN + "/acquisition.json"))["unresolved"])
d = json.load(open(RUN + "/derive.json"))
out["derive"] = {k: v for k, v in d.items() if k != "failed"} | {"failed_n": len(d["failed"])}
out["runner_status"] = json.load(open(CTL + "/status.json"))
out["runner_events_tail"] = open(CTL + "/events.jsonl").read().splitlines()[-8:]
dc = st(CTL + "/DERIVATION_COMPLETE")
out["writes_since_derivation_complete"] = {
    "v5_db_mtime_after_marker": files[V5DB]["mtime_ns"] > dc["mtime_ns"],
    "wal_nonempty": bool(out["wal_bytes_at_start"]),
    "marker_mtime": dc["mtime"], "v5_db_mtime": files[V5DB]["mtime"]}

# the runner's own identity check (pinned code subprocess, read-only)
p = subprocess.run([sys.executable, "/app/api/services/fundamentals_v5_runner.py", "--identity"], cwd=CODE,
                   env=dict(os.environ, PYTHONPATH=CODE), capture_output=True, text=True, timeout=3600)
try:
    out["identity"] = json.loads(p.stdout.strip().splitlines()[-1])
except Exception:
    out["identity"] = {"ok": False, "rc": p.returncode, "stderr": p.stderr[-1500:]}

v5 = ro(V5DB)
q = lambda s, a=(): v5.execute(s, a).fetchall()
out["v5_census"] = {
    "integrity_check": q("PRAGMA integrity_check")[0][0],
    "user_version": q("PRAGMA user_version")[0][0],
    "journal_mode": q("PRAGMA journal_mode")[0][0],
    "points_by_version": dict(q("SELECT derivation_version, count(*) FROM series_point GROUP BY 1")),
    "builds_by_version_status": [list(r) for r in q("SELECT derivation_version, status, count(*) FROM series_build GROUP BY 1, 2")],
    "companies_with_points": q("SELECT count(DISTINCT cik) FROM series_point WHERE derivation_version=5")[0][0],
    "companies_built": q("SELECT count(*) FROM series_build WHERE derivation_version=5")[0][0],
    "security_rows": q("SELECT count(*) FROM security")[0][0],
    "metrics": dict(q("SELECT metric, count(*) FROM series_point WHERE derivation_version=5 GROUP BY 1")),
    "gaps_by_metric": dict(q("SELECT metric, count(*) FROM series_point WHERE derivation_version=5 AND method='gap' GROUP BY 1")),
    "gaps": q("SELECT count(*) FROM series_point WHERE derivation_version=5 AND method='gap'")[0][0],
    "methods": dict(q("SELECT method, count(*) FROM series_point WHERE derivation_version=5 GROUP BY 1")),
    "t_eff_range": list(q("SELECT min(t_eff), max(t_eff) FROM series_point WHERE derivation_version=5")[0]),
    "max_built_at": q("SELECT max(built_at) FROM series_build WHERE derivation_version=5")[0][0],
    "signal_check": q("SELECT count(*) FROM signal_check")[0][0],
    "signal_check_sources": dict(q("SELECT source, count(*) FROM signal_check GROUP BY 1")),
    "filing_signal": q("SELECT count(*) FROM filing_signal")[0][0],
    "filing_signal_sources": dict(q("SELECT source, count(*) FROM filing_signal GROUP BY 1")) if "source" in
        [c[1] for c in q("PRAGMA table_info(filing_signal)")] else None,
    "tables": {t: q(f"SELECT count(*) FROM {t}")[0][0] for (t,) in q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1")},
}
n5, d5 = logical(v5, 5)
out["v5_logical"] = {"points": n5, "digest": d5, "full_digest_with_sources": full_digest(v5, 5)}
out["v5_store_v4_points"] = q("SELECT count(*) FROM series_point WHERE derivation_version=4")[0][0]
v5.close()

# the V4 copy on this volume (the run's source store) -- must equal the production V4 baseline
src = ro(SRC)
n4, d4 = logical(src, 4)
base = json.load(open(VAL + "/v4_baseline.json"))
out["v4_copy"] = {"points": n4, "digest": d4, "has_v5_points": src.execute(
    "SELECT count(*) FROM series_point WHERE derivation_version=5").fetchone()[0],
    "builds": src.execute("SELECT count(*), max(built_at) FROM series_build WHERE derivation_version=4").fetchone(),
    "equals_prod_baseline": n4 == base["v4"]["points"] and d4 == base["v4"]["digest"]}
src.close()
out["v5_db_sha256_after_stage0"] = sha(V5DB)
out["mutated_by_stage0"] = out["v5_db_sha256_after_stage0"] != out["v5_db_sha256_pre_validation"]
rj = out["run_json"]
out["gates"] = {
    "run_id": rj["run_id"] == RUN_ID and out["runner_status"].get("run_id") == RUN_ID,
    "identity_ok": out["identity"].get("ok") is True,
    "only_v5_points_in_v5_store": set(out["v5_census"]["points_by_version"]) == {5},
    "v5_points_equal_derive_json": n5 == out["derive"]["points"],
    "gaps_equal_derive_json": out["v5_census"]["gaps"] == out["derive"]["gaps"],
    "acquisition_complete": out["acquisition"]["complete"] == out["acquisition"]["total"] == 236913 and out["acquisition"]["unresolved_n"] == 0,
    "derive_ok": out["derive"]["failed_n"] == 0 and out["derive"]["derived"] == out["derive"]["companies"],
    "all_builds_ok": all(r[1] == "ok" for r in out["v5_census"]["builds_by_version_status"]),
    "integrity": out["v5_census"]["integrity_check"] == "ok",
    "no_write_since_derivation_complete": not out["writes_since_derivation_complete"]["v5_db_mtime_after_marker"]
        and not out["writes_since_derivation_complete"]["wal_nonempty"],
    "v4_copy_equals_prod_baseline": out["v4_copy"]["equals_prod_baseline"] and out["v4_copy"]["has_v5_points"] == 0,
    "not_mutated_by_stage0": not out["mutated_by_stage0"],
}
out["PASS"] = all(out["gates"].values())
out["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
json.dump(out, open(VAL + "/stage0.json", "w"), indent=1, default=str)
print(json.dumps({"PASS": out["PASS"], "gates": out["gates"], "sha": out["v5_db_sha256_pre_validation"]}, indent=1))
