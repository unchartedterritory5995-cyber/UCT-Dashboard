"""In-process serve cost per request (single thread, no HTTP): the GIL-bound CPU a process spends per member ask.
Replays a uniform sample of each mode's recorded stream in recorded order through the real serve core."""
import os, sys, runpy, time, json, random, collections, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ["REPLAY_NO_SERVE"] = "1"
sys.argv = ["launch_bars_api.py", "18191", os.path.join(HERE, "..", "..")]
runpy.run_path(os.path.join(HERE, "launch_bars_api.py"), run_name="sandbox")
import logging; logging.disable(logging.WARNING)
from api.routers.bars import serve_bars_http, serve_bars_history
N = int(os.environ.get("COST_N", "1200"))
out = {}
for mode in sys.argv[1:] if len(sys.argv) > 1 and sys.argv[1] in ("old","full","edge") else ("old", "full", "edge"):
    rows = [r for r in json.load(open(os.path.join(HERE, "dry_%s.json" % mode)))["rows"] if r[0] >= 20]
    rnd = random.Random(1)
    sample = sorted(rnd.sample(range(len(rows)), min(N, len(rows))))
    per = collections.defaultdict(list)
    t_all = time.perf_counter()
    cpu_all = time.process_time()
    for i in sample:
        t, cls, _, _, _, path = rows[i]
        u = urllib.parse.urlparse(path); q = dict(urllib.parse.parse_qsl(u.query))
        sym = u.path.rsplit("/", 1)[1]
        t0 = time.perf_counter()
        if u.path.startswith("/api/bars-history/"):
            r = serve_bars_history(sym, q.get("tf", "D"), int(q.get("bars", 60000)), "", "")
        else:
            r = serve_bars_http(sym, q.get("tf", "D"), int(q.get("bars", 200)), since=q.get("since", ""), to="", warm=int(q.get("warm", 0)))
        per[cls].append((time.perf_counter() - t0) * 1000)
    wall = time.perf_counter() - t_all
    res = {c: {"n": len(v), "mean_ms": round(sum(v) / len(v), 2), "p95_ms": round(sorted(v)[int(len(v) * .95)], 1)} for c, v in per.items()}
    mean = sum(sum(v) for v in per.values()) / sum(len(v) for v in per.values())
    out[mode] = {"mean_ms": round(mean, 2), "classes": res, "wall_s": round(wall, 1), "cpu_s": round(time.process_time() - cpu_all, 1),
                 "proc_rps_ceiling": round(1000 / mean, 1)}
    print(mode, json.dumps(out[mode]), flush=True)
json.dump(out, open(os.path.join(HERE, "cost_model.json"), "w"), indent=1)
