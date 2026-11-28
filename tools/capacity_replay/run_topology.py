"""The 500-member replay against #2962's REAL leader/follower topology: N bars-api processes on one DATA_DIR
(`BARS_API_WORKERS=N`: one elects LEADER, the rest FOLLOWERS that hand leader-only work to it over the loopback
port), sandboxed (`sandbox/sitecustomize.py`: read-only immutable store, loopback-only sockets, no vendor).

On Linux production the N processes share one socket (uvicorn `workers=N`, the kernel spreads connections). On
Windows that shared `listen` drops workers (WinError 10022), so here each process listens on its own port and the
replay clients round-robin across them: the same processes, roles, hand-offs and caps, a different balancer.
`--shared-socket` runs the real `uvicorn workers=N` instead (`launch_workers.py`).

Every case starts fresh processes and a fresh DATA_DIR. Aborts when free memory drops under --floor-gb (Windows:
free COMMIT memory; Linux: /proc/meminfo MemAvailable). Per-process memory: Windows private bytes, Linux VmRSS.
The store is REPLAY_STORE (the dev box's copy, or `synth_store.py`'s synthetic one on a runner).
Usage: python run_topology.py --procs 4 --mode edge --members 100,200,300 [--duration 60 --ramp 20] [--shared-socket]
"""
import argparse, json, os, shutil, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from run_matrix import summarize, port_busy  # noqa: E402
from run_matrix import proc_mem as _proc_mem_windows  # noqa: E402

LINUX = os.name != "nt"


def proc_mem(pids):
    """{pid: MB} private (Windows) / resident (Linux) memory."""
    if not LINUX:
        return _proc_mem_windows(pids)
    out = {}
    for p in pids:
        try:
            with open("/proc/%d/status" % p) as f:
                for ln in f:
                    if ln.startswith("VmRSS:"):
                        out[p] = int(ln.split()[1]) / 1024.0
        except OSError:
            pass
    return out


def children(pid):
    """Direct child pids (Linux): uvicorn's worker processes under its supervisor."""
    try:
        with open("/proc/%d/task/%d/children" % (pid, pid)) as f:
            return [int(x) for x in f.read().split()]
    except OSError:
        return []

_STRIP = ("MASSIVE", "POLYGON", "R2_", "AWS_", "S3_", "FMP", "FINNHUB", "OPENAI", "ANTHROPIC", "PUSH_SECRET",
          "DATABASE_URL", "DATA_SYNC")


def free_commit_gb():
    if LINUX:
        with open("/proc/meminfo") as f:
            for ln in f:
                if ln.startswith("MemAvailable:"):
                    return int(ln.split()[1]) / 1024 / 1024
        return 99.0
    out = subprocess.run(["powershell", "-NoProfile", "-c",
                          "(Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory"],
                         capture_output=True, text=True).stdout.strip()
    return int(out) / 1024 / 1024


def health(port, tries=120, proc=None):
    for _ in range(tries):
        if proc is not None and proc.poll() is not None:
            return None
        try:
            return json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=2).read())
        except Exception:
            time.sleep(1)
    return None


def start_shared(src, procs, base, data, logdir, tag):
    """The REAL production shape (Linux): ONE uvicorn supervisor, `workers=N` on one socket (`BARS_API_WORKERS=N`
    through `bars_api_main.main()`), the kernel spreading connections. Roles are read from /api/health samples."""
    shutil.rmtree(data, ignore_errors=True)
    os.makedirs(os.path.join(data, "tmp"), exist_ok=True)
    open(os.path.join(data, "bars.db"), "ab").close()
    env = _env(src, procs, base, data)
    env["PORT"] = str(base)
    lf = open(os.path.join(logdir, "srv_%s_shared.log" % tag), "w")
    sup = subprocess.Popen([sys.executable, "-m", "api.bars_api_main"], cwd=src, env=env, stdout=lf,
                           stderr=subprocess.STDOUT)
    if health(base, proc=sup) is None:
        raise RuntimeError("the shared-socket supervisor did not come up")
    seen, t_end = {}, time.time() + 90
    while len(seen) < procs and time.time() < t_end:       # every worker answered at least once
        try:
            h = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/health" % base, timeout=2).read())
            seen[h.get("pid")] = h.get("role")
        except Exception:
            time.sleep(0.2)
    return [sup], [lf], sorted(seen.values())


def _env(src, procs, base, data):
    env = {k: v for k, v in os.environ.items() if not any(t in k.upper() for t in _STRIP)}
    env.update({"REPLAY_SANDBOX": "1", "PYTHONPATH": os.path.join(HERE, "sandbox") + os.pathsep + src,
                "DATA_DIR": data, "BARS_API_ENABLED": "1", "BARS_API_WORKERS": str(procs),
                "BARS_API_LEADER_PORT": str(base + 900), "HTTP_PROXY": "http://127.0.0.1:9",
                "HTTPS_PROXY": "http://127.0.0.1:9", "NO_PROXY": "127.0.0.1,localhost", "BARS_OFFGRID_SWEEP": "0",
                "TMPDIR": os.path.join(data, "tmp"), "PYTHONDONTWRITEBYTECODE": "1"})
    return env


def start(src, procs, base, data, logdir, tag):
    shutil.rmtree(data, ignore_errors=True)
    os.makedirs(os.path.join(data, "tmp"), exist_ok=True)
    open(os.path.join(data, "bars.db"), "ab").close()       # placeholder; the sandbox opens the real store read-only
    env = {k: v for k, v in os.environ.items() if not any(t in k.upper() for t in _STRIP)}
    env.update({"REPLAY_SANDBOX": "1", "PYTHONPATH": os.path.join(HERE, "sandbox") + os.pathsep + src,
                "DATA_DIR": data, "BARS_API_ENABLED": "1", "BARS_API_WORKERS": str(procs),
                "BARS_API_LEADER_PORT": str(base + 900), "HTTP_PROXY": "http://127.0.0.1:9",
                "HTTPS_PROXY": "http://127.0.0.1:9", "NO_PROXY": "127.0.0.1,localhost", "BARS_OFFGRID_SWEEP": "0",
                "TMPDIR": os.path.join(data, "tmp"), "PYTHONDONTWRITEBYTECODE": "1"})
    code = ("import uvicorn; from api import bars_api_main as b; "
            "uvicorn.run(b._build_worker_app, factory=True, host='127.0.0.1', port=%d, log_level='warning', "
            "timeout_graceful_shutdown=2)")
    srv, logs = [], []
    for i in range(procs):
        lf = open(os.path.join(logdir, "srv_%s_%d.log" % (tag, i)), "w")
        logs.append(lf)
        srv.append(subprocess.Popen([sys.executable, "-c", code % (base + i)], cwd=src, env=env, stdout=lf,
                                    stderr=subprocess.STDOUT))
        if i == 0:
            time.sleep(4)                                    # the first one takes the leader lock
    roles = []
    for i in range(procs):
        h = health(base + i, proc=srv[i])
        if h is None or srv[i].poll() is not None:
            raise RuntimeError("process %d did not come up" % i)
        roles.append(h.get("role"))
    return srv, logs, roles


def run_case(a, members, logdir):
    tag = "%s_%dp_%dm" % (a.mode, a.procs, members)
    base = 18400
    for p in [base + i for i in range(a.procs)] + [base + 900]:
        if port_busy(p):
            return {"case": tag, "error": "port %d busy" % p}
    data = os.path.join(HERE, "data_topo")
    if a.shared_socket:
        srv, logs, roles = start_shared(os.path.abspath(a.src), a.procs, base, data, logdir, tag)
        targets = "http://127.0.0.1:%d" % base
        mem_pids = lambda: [srv[0].pid] + children(srv[0].pid)  # noqa: E731  (the supervisor IS the solo server)
    else:
        srv, logs, roles = start(os.path.abspath(a.src), a.procs, base, data, logdir, tag)
        targets = ",".join("http://127.0.0.1:%d" % (base + i) for i in range(a.procs))
        mem_pids = lambda: [s.pid for s in srv]  # noqa: E731
    try:
        shards = a.shards or (4 if members <= 300 else 6)
        outs = [os.path.join(logdir, "run_%s_s%d.json" % (tag, s)) for s in range(shards)]
        cl = [subprocess.Popen([sys.executable, os.path.join(HERE, "replay_members.py"), "--targets", targets,
                                "--members", str(members), "--duration", str(a.duration), "--ramp", str(a.ramp),
                                "--mode", a.mode, "--shard", str(s), "--shards", str(shards), "--out", outs[s]],
                               cwd=HERE) for s in range(shards)]
        t0, min_free, peak, aborted = time.time(), 99.0, {}, False
        while any(c.poll() is None for c in cl):
            time.sleep(5)
            f = free_commit_gb()
            min_free = min(min_free, f)
            for k, v in proc_mem(mem_pids()).items():
                peak[k] = max(peak.get(k, 0), v)
            if f < a.floor_gb:
                aborted = True
                for c in cl:
                    c.kill()
                break
        rows = []
        for o in outs:
            try:
                rows += json.load(open(o))["rows"]
            except Exception:
                pass
        res = summarize(rows, a.ramp) if rows else {}
        m = [r for r in rows if r[0] >= a.ramp]
        res["handed_to_leader_pct"] = round(100.0 * sum(1 for r in m if str(r[5] or "").startswith("leader:"))
                                            / max(1, len(m)), 2)
        for lf in logs:
            lf.flush()
        res.update({"case": tag, "mode": a.mode, "members": members, "procs": a.procs, "roles": roles,
                    "shared_socket": bool(a.shared_socket), "cpus": os.cpu_count(),
                    "min_free_commit_gb": round(min_free, 1), "aborted_low_mem": aborted,
                    "peak_private_mb_per_proc": sorted(round(v) for v in peak.values()),
                    "wall_s": round(time.time() - t0)})
        return res
    finally:
        for s in srv:
            if a.shared_socket and LINUX:
                for c in children(s.pid):
                    try:
                        os.kill(c, 9)
                    except OSError:
                        pass
            s.kill()
        for lf in logs:
            lf.close()
        time.sleep(3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(HERE, "..", ".."))
    ap.add_argument("--procs", type=int, default=4)
    ap.add_argument("--mode", default="edge")
    ap.add_argument("--members", default="100,200,300")
    ap.add_argument("--duration", type=int, default=60)
    ap.add_argument("--ramp", type=int, default=20)
    ap.add_argument("--floor-gb", type=float, default=9.0)
    ap.add_argument("--out", default=None)
    ap.add_argument("--shared-socket", action="store_true", help="uvicorn workers=N on one socket (Linux)")
    ap.add_argument("--shards", type=int, default=0, help="load-generator processes (default 4, 6 above 300)")
    a = ap.parse_args()
    logdir = os.path.join(HERE, "logs")
    os.makedirs(logdir, exist_ok=True)
    print("free commit at start: %.1f GB" % free_commit_gb(), flush=True)
    path = a.out or os.path.join(HERE, "topo_%s.json" % time.strftime("%Y%m%dT%H%M%S"))
    results = []
    for m in [int(x) for x in a.members.split(",")]:
        try:
            r = run_case(a, m, logdir)
        except Exception as e:  # noqa: BLE001
            r = {"case": "%s_%dp_%dm" % (a.mode, a.procs, m), "error": str(e)}
        results.append(r)
        json.dump(results, open(path, "w"), indent=1)
        pr = r.get("classes", {}).get("press", {})
        print("%-20s handoff%% %s roles %s offered %s ok %s rps | p50 %s p95 %s p99 %s | press p99 %s | to %s 503 %s err %s | "
              "free>=%s GB mem %s %s" % (r.get("case"), r.get("handed_to_leader_pct"), r.get("roles"), r.get("offered_rps"), r.get("ok_rps"),
                                         r.get("p50"), r.get("p95"), r.get("p99"), pr.get("p99"), r.get("timeouts"),
                                         r.get("sheds_503"), r.get("errors"), r.get("min_free_commit_gb"),
                                         r.get("peak_private_mb_per_proc"), r.get("error", "")), flush=True)
        if r.get("aborted_low_mem"):
            print("STOP: free commit memory under the floor", flush=True)
            break
    print("wrote", path)


if __name__ == "__main__":
    main()
