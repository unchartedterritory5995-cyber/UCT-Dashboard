"""bench-loadgen (the Railway `capacity-bench` environment ONLY): the 500-member load generator on its OWN machine,
driving bench-bars over Railway's private network.

  python tools/capacity_replay/bench_drive.py --idle                 # the service's start command: prepare, then wait
  python tools/capacity_replay/bench_drive.py --members 840,1200 --shards 12 --label w12 --out /tmp/bench/w12.json

Prepares once: aiohttp, the same synthetic store bench-bars builds (same seed and sizes) and universe.json from it, so
the member model draws the tickers bench-bars holds. Per case it records the replay summary (run_matrix.summarize)
plus /api/health samples from bench-bars (pid -> role, threads, rss_mb). Refuses outside capacity-bench.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH = "/tmp/bench"
sys.path.insert(0, HERE)


def _guard():
    if os.environ.get("RAILWAY_ENVIRONMENT_NAME", "") != "capacity-bench":
        sys.exit("bench_drive refuses to run outside the capacity-bench environment")


def prepare():
    try:
        import aiohttp  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "aiohttp==3.13.3"], check=True)
    store = os.path.join(BENCH, "store", "bars.db")
    if not os.path.exists(store):
        subprocess.run([sys.executable, os.path.join(HERE, "synth_store.py"), os.path.dirname(store),
                        "--daily", "2200", "--intraday", "500"], check=True, cwd=REPO)
    if not os.path.exists(os.path.join(HERE, "universe.json")):
        subprocess.run([sys.executable, os.path.join(HERE, "build_universe.py"), store], check=True, cwd=HERE)


def target():
    return os.environ.get("BENCH_TARGET", "http://bench-bars.railway.internal:8080")


def health_samples(n=60):
    seen = {}
    for _ in range(n):
        try:
            h = json.loads(urllib.request.urlopen(target() + "/api/health", timeout=3).read())
            seen[h.get("pid")] = {"role": h.get("role"), "threads": h.get("threads"), "rss_mb": h.get("rss_mb"),
                                  "workers": h.get("workers"), "swap_refused": h.get("swap_refused")}
        except Exception as e:  # noqa: BLE001
            seen.setdefault("errors", []).append(type(e).__name__)
        time.sleep(0.05)
    return seen


def run_case(members, shards, duration, ramp, mode):
    from run_matrix import summarize
    outs = [os.path.join(BENCH, "run_%d_s%d.json" % (members, s)) for s in range(shards)]
    cl = [subprocess.Popen([sys.executable, os.path.join(HERE, "replay_members.py"), "--targets", target(),
                            "--members", str(members), "--duration", str(duration), "--ramp", str(ramp),
                            "--mode", mode, "--shard", str(s), "--shards", str(shards), "--out", outs[s]], cwd=HERE)
          for s in range(shards)]
    mid = None
    t0 = time.time()
    while any(c.poll() is None for c in cl):
        time.sleep(2)
        if mid is None and time.time() - t0 > ramp + duration / 2:
            mid = health_samples(40)                   # roles / threads / rss UNDER load
    rows = []
    for o in outs:
        try:
            rows += json.load(open(o))["rows"]
        except Exception:  # noqa: BLE001
            pass
    res = summarize(rows, ramp) if rows else {}
    m = [r for r in rows if r[0] >= ramp]
    res["handed_to_leader_pct"] = round(100.0 * sum(1 for r in m if str(r[5] or "").startswith("leader:"))
                                        / max(1, len(m)), 3)
    res.update({"members": members, "mode": mode, "shards": shards, "health_under_load": mid})
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idle", action="store_true")
    ap.add_argument("--members", default="")
    ap.add_argument("--shards", type=int, default=12)
    ap.add_argument("--duration", type=int, default=45)
    ap.add_argument("--ramp", type=int, default=15)
    ap.add_argument("--mode", default="edge")
    ap.add_argument("--label", default="")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    _guard()
    os.makedirs(BENCH, exist_ok=True)
    prepare()
    if a.idle:
        print("[bench-loadgen] ready", flush=True)
        while True:
            time.sleep(3600)
    results = {"label": a.label, "health_idle": health_samples(60), "cases": []}
    for m in [int(x) for x in a.members.split(",") if x]:
        r = run_case(m, a.shards, a.duration, a.ramp, a.mode)
        results["cases"].append(r)
        print(json.dumps({k: r.get(k) for k in ("members", "offered_rps", "ok_rps", "p50", "p95", "p99", "timeouts",
                                                "sheds_503", "errors", "handed_to_leader_pct")}), flush=True)
    if a.out:
        with open(a.out, "w") as f:
            json.dump(results, f, indent=1)
    print("RESULT " + json.dumps(results), flush=True)


if __name__ == "__main__":
    main()
