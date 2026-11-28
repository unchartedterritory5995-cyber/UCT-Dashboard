"""The capacity replay on a GitHub runner: see tests/test_capacity_replay_ci.py (the wrapper) for what it measures and
what one runner cannot show. `enabled()` is the gate: CAPACITY_REPLAY=1 (an allowlisted remote_tests variable) on Linux.
"""
import json
import os
import subprocess
import sys
import time

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(TOOLS, "..", ".."))
OUT = os.path.join(REPO, "remote-out", "capacity")


def enabled() -> bool:
    return os.environ.get("CAPACITY_REPLAY") == "1" and os.name != "nt"


def _mem_gb():
    with open("/proc/meminfo") as f:
        for ln in f:
            if ln.startswith("MemTotal:"):
                return int(ln.split()[1]) / 1024 / 1024
    return 0.0


def _run(args, timeout):
    print("$", " ".join(args), flush=True)
    r = subprocess.run(args, cwd=TOOLS, capture_output=True, text=True, timeout=timeout)
    print(r.stdout[-4000:], r.stderr[-2000:], flush=True)
    return r


def run(tmp_path) -> dict:
    os.makedirs(OUT, exist_ok=True)
    cpus, mem = os.cpu_count() or 2, _mem_gb()
    store_dir = os.environ.get("RUNNER_TEMP") or str(tmp_path)
    store_dir = os.path.join(store_dir, "synth_store")
    t0 = time.time()
    r = _run([sys.executable, "synth_store.py", store_dir], timeout=900)
    if r.returncode != 0:
        raise RuntimeError("synth_store failed")
    store = os.path.join(store_dir, "bars.db")
    os.environ["REPLAY_STORE"] = store
    if _run([sys.executable, "build_universe.py", store], timeout=600).returncode != 0:
        raise RuntimeError("build_universe failed")
    # leave about half the cores to the load generator; at most what memory carries (~1.5 GB a process)
    top = max(1, min(cpus // 2, int(mem // 1.5) - 1, 8))
    procs = sorted({1, 2, min(4, top), top})
    results = []
    for p in procs:
        members = "%d,%d,%d" % (40 * p, 70 * p, 100 * p)     # ~3 asks/s a member: through the knee
        outp = os.path.join(OUT, "topo_p%d.json" % p)
        r = _run([sys.executable, "run_topology.py", "--src", REPO, "--procs", str(p), "--mode", "edge",
                  "--members", members, "--duration", "30", "--ramp", "10", "--shared-socket",
                  "--shards", str(max(2, min(6, cpus - top))), "--floor-gb", "1.5", "--out", outp], timeout=900)
        try:
            results += json.load(open(outp))
        except Exception as e:  # noqa: BLE001
            results.append({"procs": p, "error": "no result: %s" % e})
        if time.time() - t0 > 30 * 60:                        # the lane's job times out at 45 min
            results.append({"note": "stopped early: the time budget"})
            break
    keep = ("case", "procs", "members", "roles", "offered_rps", "ok_rps", "p50", "p95", "p99", "sheds_503",
            "timeouts", "errors", "handed_to_leader_pct", "peak_private_mb_per_proc", "min_free_commit_gb",
            "shared_socket", "cpus", "error", "note")
    summary = {"runner": {"cpus": cpus, "mem_gb": round(mem, 1), "store": "synthetic (synth_store.py defaults)"},
               "cases": [{k: x.get(k) for k in keep if k in x} for x in results]}
    # the ceiling per process count: the best OK rate of a case with p99 <= 500 ms and no timeout (a case past the knee
    # collapses: requests queue, time out at 8 s, and OK req/s FALLS, so the knee is the last clean case)
    knee = {}
    for c in summary["cases"]:
        if c.get("ok_rps") and (c.get("p99") or 1e9) <= 500 and not c.get("timeouts"):
            knee[c["procs"]] = max(knee.get(c["procs"], 0), c["ok_rps"])
    summary["clean_ceiling_rps_by_procs"] = knee
    json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1), flush=True)
    return summary
