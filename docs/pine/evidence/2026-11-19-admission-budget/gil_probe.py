"""In-process verdict door under GIL contention: what does a ~1 ms detector run get CHARGED (wall time),
and what cool-down / member spend does that leave? Calls runtime_definitions.runtime_admission directly
(no TestClient portal), the 4 scripts x 3 repair variants back to back."""
import os, sys, tempfile, threading, time
sys.path.insert(0, os.getcwd()); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["PINE_RUNTIME_CAPABILITY_ADMISSION"] = "on"; os.environ["PINE_CAPABILITY_DETECTOR_WORKER"] = "off"
from api.services import runtime_definitions as rt, user_definitions as svc
from scripts import SCRIPTS, variant
svc._DB_PATH = os.path.join(tempfile.mkdtemp(), "ud.db"); svc._init_db()

def run(k):
    rt._reset_capability_cache()
    stop = threading.Event()
    def spin():
        while not stop.is_set():
            d = {}
            for i in range(5000):
                d[str(i)] = i * 2       # dict/str churn: prewarm-shaped pure Python
    ts = [threading.Thread(target=spin, daemon=True) for _ in range(k)]
    [t.start() for t in ts]
    time.sleep(0.5)
    charged, pend = [], 0
    for name, src in SCRIPTS:
        for r in range(3):
            s = src if r == 0 else variant(src, r)
            before = sum(c for _t, c in rt._VERDICT_SPENT.get("m", ()))
            out = rt.runtime_admission(s, member="m")
            if "pending" in out["missing"]:
                pend += 1
            after = sum(c for _t, c in rt._VERDICT_SPENT.get("m", ()))
            charged.append(after - before)
            time.sleep(1.5)
    stop.set()
    ch = [c for c in charged if c > 0]
    print(f"spinners={k:2d}  runs={len(ch)} pendings={pend}  charged ms: median {sorted(ch)[len(ch)//2]*1000:.1f} "
          f"max {max(ch)*1000:.1f}  member spent total {sum(ch):.3f}s (budget {rt.VERDICT_MEMBER_SECONDS}s)  "
          f"verdict cool-down after max run {max(ch)*5*1000:.0f} ms")

for k in (0, 4, 16, 48):
    run(k)
