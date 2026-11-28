"""Run the capacity matrix: N local bars-api processes (sandboxed launcher) x member mode x member count.
Every case starts fresh server processes (cold memory caches, warm OS page cache) and tears them down.
Aborts a case if free RAM drops under FLOOR_GB. Writes matrix.json + prints a table.
Usage: python run_matrix.py [case ...]   (case = mode:members:procs[:edge], default = the built-in list)
"""
import json, os, subprocess, sys, time, urllib.request, collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..")
FLOOR_GB = 4.5
RAMP, DUR = 20, 60
DEFAULT = ["old:500:1", "old:500:4", "full:500:1", "full:500:4", "full:500:6",
           "edge:500:1", "edge:500:2", "edge:1000:2", "edge:1000:4", "edge:500:1:edge", "full:1000:6"]


def free_gb():
    out = subprocess.run(["powershell", "-NoProfile", "-c",
                          "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory"],
                         capture_output=True, text=True).stdout.strip()
    return int(out) / 1024 / 1024


def proc_mem(pids):
    if not pids:
        return {}
    q = " OR ".join("ProcessId=%d" % p for p in pids)        # WQL: OR, not PowerShell's -or
    out = subprocess.run(["powershell", "-NoProfile", "-c",
                          "Get-CimInstance Win32_Process -Filter \"%s\" | %% { \"$($_.ProcessId) $($_.PrivatePageCount)\" }" % q],
                         capture_output=True, text=True).stdout.split()
    return {int(out[i]): int(out[i + 1]) / 1e6 for i in range(0, len(out) - 1, 2)}


def port_busy(port):
    import socket
    with socket.socket() as so:
        return so.connect_ex(("127.0.0.1", port)) == 0


def health(port, tries=90):
    for _ in range(tries):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=2).read()
            return True
        except Exception:
            time.sleep(1)
    return False


def summarize(rows, ramp):
    m = [r for r in rows if r[0] >= ramp]
    span = max(1e-9, max(r[0] for r in m) - ramp) if m else 1
    by = collections.defaultdict(list)
    for r in m:
        by[r[1].replace("-tail", "")].append(r)
    def pct(v, p):
        v = sorted(v)
        return round(v[min(len(v) - 1, int(len(v) * p))], 1) if v else None
    out = {"offered_rps": round(len(m) / span, 1), "ok_rps": round(sum(1 for r in m if r[2] == 200) / span, 1),
           "mb_per_s": round(sum(r[4] for r in m) / span / 1e6, 2), "classes": {}}
    allok = [r[3] for r in m if r[2] == 200]
    out["p50"], out["p95"], out["p99"] = pct(allok, .5), pct(allok, .95), pct(allok, .99)
    out["timeouts"] = sum(1 for r in m if r[2] == 0)
    out["errors"] = sum(1 for r in m if r[2] == -1)
    out["sheds_503"] = sum(1 for r in m if r[2] == 503)
    out["n"] = len(m)
    for c, v in sorted(by.items()):
        ok = [r[3] for r in v if r[2] == 200]
        out["classes"][c] = {"n": len(v), "rps": round(len(v) / span, 1), "p50": pct(ok, .5), "p95": pct(ok, .95),
                             "p99": pct(ok, .99), "bad": sum(1 for r in v if r[2] != 200),
                             "mem_hit": round(sum(1 for r in v if r[2] == 200 and "mem" in (r[5] or "")) / max(1, len(v)), 2)}
    return out


def run_case(spec):
    parts = spec.split(":")
    mode, members, procs = parts[0], int(parts[1]), int(parts[2])
    via_edge = len(parts) > 3 and parts[3] == "edge"
    ports = [18100 + i for i in range(procs)]
    srv, edge = [], None
    logs = []
    for p in ports + ([18180] if via_edge else []):
        if port_busy(p):
            return {"spec": spec, "error": "port %d already has a listener (not ours to reuse)" % p}
    try:
        for p in ports:
            lf = open(os.path.join(HERE, "logs", "srv_%s_%d.log" % (spec.replace(":", "_"), p)), "w")
            logs.append(lf)
            srv.append(subprocess.Popen([sys.executable, os.path.join(HERE, "launch_bars_api.py"), str(p), SRC],
                                        cwd=HERE, stdout=lf, stderr=subprocess.STDOUT))
        for p, sp in zip(ports, srv):
            if not health(p) or sp.poll() is not None:
                return {"spec": spec, "error": "server %d did not come up (or exited)" % p}
        targets = ["http://127.0.0.1:%d" % p for p in ports]
        if via_edge:
            assert procs == 1 and ports[0] == 18100
            elf = open(os.path.join(HERE, "logs", "edge_%s.log" % spec.replace(":", "_")), "w")
            logs.append(elf)
            edge = subprocess.Popen(["node", os.path.join(HERE, "edge", "run_edge.mjs"), "18180"],
                                    cwd=os.path.join(HERE, "edge"), stdout=elf, stderr=subprocess.STDOUT)
            time.sleep(6)
            if edge.poll() is not None or not health(18180, 10):
                return {"spec": spec, "error": "edge did not come up"}
            targets = ["http://127.0.0.1:18180"]
        shards = 4 if members <= 500 else 6
        outs = [os.path.join(HERE, "logs", "run_%s_s%d.json" % (spec.replace(":", "_"), s)) for s in range(shards)]
        cl = [subprocess.Popen([sys.executable, os.path.join(HERE, "replay_members.py"), "--targets", ",".join(targets),
                                "--members", str(members), "--duration", str(DUR), "--ramp", str(RAMP), "--mode", mode,
                                "--shard", str(s), "--shards", str(shards), "--out", outs[s]], cwd=HERE)
              for s in range(shards)]
        t0 = time.time()
        min_free, peak_mem = 99.0, {}
        aborted = False
        while any(c.poll() is None for c in cl):
            time.sleep(5)
            f = free_gb()
            min_free = min(min_free, f)
            mem = proc_mem([s.pid for s in srv])
            for k, v in mem.items():
                peak_mem[k] = max(peak_mem.get(k, 0), v)
            if f < FLOOR_GB:
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
        res = summarize(rows, RAMP) if rows else {}
        res.update({"spec": spec, "mode": mode, "members": members, "procs": procs, "via_edge": via_edge,
                    "min_free_gb": round(min_free, 1), "aborted_low_ram": aborted,
                    "peak_private_mb_per_proc": sorted(round(v) for v in peak_mem.values()),
                    "wall_s": round(time.time() - t0)})
        return res
    finally:
        if edge:
            edge.kill()
        for s in srv:
            s.kill()
        for lf in logs:
            lf.close()
        time.sleep(3)


def main():
    os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
    specs = sys.argv[1:] or DEFAULT
    print("free RAM at start: %.1f GB" % free_gb(), flush=True)
    results = []
    path = os.path.join(HERE, "matrix_%s.json" % time.strftime("%Y%m%dT%H%M%S"))
    for spec in specs:
        r = run_case(spec)
        results.append(r)
        json.dump(results, open(path, "w"), indent=1)
        c = r.get("classes", {})
        pr = c.get("press", {})
        print("%-18s offered %7s rps ok %7s | all p50 %6s p99 %7s | press p50 %6s p99 %7s | to %5s 503 %5s err %4s | free>=%s GB mem %s"
              % (spec, r.get("offered_rps"), r.get("ok_rps"), r.get("p50"), r.get("p99"), pr.get("p50"), pr.get("p99"),
                 r.get("timeouts"), r.get("sheds_503"), r.get("errors"), r.get("min_free_gb"),
                 r.get("peak_private_mb_per_proc")), flush=True)
    print("wrote", path)


if __name__ == "__main__":
    main()
