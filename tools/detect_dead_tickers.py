"""Detect delisted/acquired/halted tickers in cap_universe.json.

Signal: a $300M+ name that still trades has a DAILY bar within the last
few sessions. If the newest daily bar is >21 calendar days old (or the
series is empty), the company has stopped trading (delisted / acquired /
long halt) — e.g. GMS (Home Depot), JBT (Marel), PRFT (EQT). 21 days is
deliberately generous: a real $300M+ stock trades every session, so this
won't false-positive a merely-illiquid name.

Read-only: produces a removal list. Pruning is a separate explicit step.
"""
import json, os, time, urllib.request
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
STALE_DAYS = 21
NOW = datetime.now(timezone.utc)

def last_daily(t):
    u = f"{BASE}/api/bars/{t}?tf=D&bars=8000"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(u, headers={"User-Agent": UA}), timeout=90
        ) as r:
            b = json.loads(r.read().decode()).get("bars") or []
        if not b:
            return ("EMPTY", None)
        lt = b[-1].get("t")
        # daily t is "YYYY-MM-DD"
        d = datetime.strptime(str(lt)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return ("OK", (NOW - d).days)
    except Exception as e:
        return ("ERR", str(e)[:60])

def main():
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    uni = [t for t in json.load(open("api/data/cap_universe.json")) if t]
    print(f"scanning {len(uni)} tickers (daily liveness, >{STALE_DAYS}d = dead)")
    dead, alive, errs = [], 0, []
    done = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(last_daily, t): t for t in uni}
        for fu in as_completed(futs):
            t = futs[fu]
            status, info = fu.result()
            if status == "EMPTY":
                dead.append((t, "empty"))
            elif status == "ERR":
                errs.append((t, info))
            elif info is not None and info > STALE_DAYS:
                dead.append((t, f"{info}d_stale"))
            else:
                alive += 1
            done += 1
            if done % 500 == 0:
                print(f"  {done}/{len(uni)}  dead={len(dead)} err={len(errs)}")
    dead.sort()
    out = {
        "scanned": len(uni), "alive": alive,
        "dead_count": len(dead), "err_count": len(errs),
        "dead": [d[0] for d in dead],
        "dead_detail": dead,
        "errs": errs[:40],
    }
    rp = os.path.join(os.environ.get("TEMP", "/tmp"), "dead_tickers.json")
    json.dump(out, open(rp, "w"), indent=2)
    print(f"=== alive={alive}  DEAD={len(dead)}  err={len(errs)} ===")
    print("DEAD (removal candidates):")
    print("  " + ", ".join(f"{t}({why})" for t, why in dead))
    if errs:
        print(f"errors ({len(errs)}, NOT removed — transient): "
              + ", ".join(t for t, _ in errs[:30]))
    print(f"[full list written to {rp}]")

if __name__ == "__main__":
    main()
