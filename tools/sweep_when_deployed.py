"""Wait for the null-OHLC serve-time guard (commit 8010b403) to go live on
production, then run the full universe chart sweep (pass 2).

Guard-live signal: a known pass-1 NULL_OHLC ticker (ABBV/30) serves ZERO
null/garbage bars. Polls health uptime too for context. Once live (or after a
timeout), runs tools/full_chart_diagnostic.py so a single pass-2 verifies BOTH
the stale-set shrinkage (D/W/M + intraday fixes, already live) AND the guard.
"""
import json, os, subprocess, sys, time, urllib.request

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
POLL_SECONDS = 90
TIMEOUT_MINUTES = 90


def _get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _guard_live():
    """True when ABBV/30 (had 1 null bar in pass 1) serves no null/garbage bars."""
    try:
        b = _get("/api/bars/ABBV?tf=30&bars=5000").get("bars") or []
        bad = [x for x in b if x.get("o") is None or x.get("h") is None
               or x.get("l") is None or x.get("c") is None or (x.get("c") or 1) <= 0]
        return len(b) > 0 and len(bad) == 0
    except Exception:
        return False


def main():
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    t0 = time.time()
    deadline = t0 + TIMEOUT_MINUTES * 60
    live = False
    while time.time() < deadline:
        try:
            up = _get("/api/health").get("uptime_seconds")
        except Exception:
            up = "?"
        if _guard_live():
            live = True
            print(f"[ready] guard LIVE (uptime={up}s, waited {int(time.time()-t0)}s)", flush=True)
            break
        print(f"[wait] guard not live yet (uptime={up}s, waited {int(time.time()-t0)}s)", flush=True)
        time.sleep(POLL_SECONDS)

    if not live:
        print(f"[timeout] guard still not live after {TIMEOUT_MINUTES}m — running "
              f"pass 2 anyway (verifies stale shrinkage; NULL_OHLC will persist "
              f"until deploy lands)", flush=True)

    print("[run] launching full_chart_diagnostic.py (pass 2)...", flush=True)
    r = subprocess.run([sys.executable, "-u", "tools/full_chart_diagnostic.py"],
                       capture_output=True, text=True)
    open("tools/sweep_pass2.log", "w").write(r.stdout + "\n--- STDERR ---\n" + r.stderr)
    print(f"[done] guard_live={live} exit={r.returncode} "
          f"(full output in tools/sweep_pass2.log)", flush=True)
    # Echo the summary block (everything from the report header onward).
    tail = r.stdout
    idx = tail.find("=== UNIVERSE CHART DIAGNOSTIC")
    print(tail[idx:] if idx >= 0 else tail[-4000:], flush=True)


if __name__ == "__main__":
    main()
