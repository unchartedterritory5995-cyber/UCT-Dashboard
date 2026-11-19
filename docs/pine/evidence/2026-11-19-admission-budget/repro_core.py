"""REPRODUCTION: a member asks the assistant for 4 scripts inside 60 s; after each answer the builder window
asks POST /runtime-admission the way `runtimeKill.js::requestRuntimeAdmission` does (5 attempts, 1.5 s apart),
then `watchRuntimeAdmission`'s backoff (3, 6, 12, ... s) to measure when a verdict WOULD have landed.

Real server code, real budgets (no constant is changed): the real router (`api/routers/user_definitions.py`)
mounted on a bare FastAPI app with the paid dependency overridden, a temp user_definitions.db, real clock.

For every pending answer it records WHICH gate held it, in `capabilities_for`'s own order, from the module
state read just before the call plus the worker's own counters diffed across the call (exact for the worker).

usage: python harness.py --worker off|on --scenario quiet|cold|listload|gil|quarantine [--gap 12] [--repairs 0]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.getcwd())
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument("--worker", choices=["off", "on"], default="off")
ap.add_argument("--scenario", default="quiet")
ap.add_argument("--gap", type=float, default=12.0)
ap.add_argument("--repairs", type=int, default=0)
ap.add_argument("--load-rate", type=float, default=4.0, help="listload: cold list serves per second")
ap.add_argument("--load-bytes", type=int, default=100_000)
ap.add_argument("--gil-threads", type=int, default=6)
ap.add_argument("--json", default="")
args = ap.parse_args()

os.environ["PINE_RUNTIME_CAPABILITY_ADMISSION"] = "on"
os.environ["PINE_CAPABILITY_DETECTOR_WORKER"] = args.worker

from fastapi import FastAPI                                     # noqa: E402
from fastapi.testclient import TestClient                       # noqa: E402
from api.middleware.auth_middleware import get_current_user_with_plan  # noqa: E402
from api.routers import user_definitions as router_mod          # noqa: E402
from api.services import runtime_definitions as rt              # noqa: E402
from api.services import pine_capability_worker as cw           # noqa: E402
from api.services import pine_authoring as pa                   # noqa: E402
from api.services import user_definitions as svc                # noqa: E402
from scripts import SCRIPTS, variant                            # noqa: E402

TMP = tempfile.mkdtemp(prefix="admission-repro-")
svc._DB_PATH = os.path.join(TMP, "user_definitions.db")
svc._init_db()
rt._reset_capability_cache()

USER = "u-smoke-admin"
app = FastAPI()
app.include_router(router_mod.router)
app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": USER, "role": "admin", "plan": "premium"}
client = TestClient(app)

T0 = time.monotonic()
def now_s() -> float:
    return time.monotonic() - T0

# ── the worker: cold (a fresh process, nothing started: a pod just promoted) or warm ──────────────
W = cw._reset_for_tests()
boot = {"ready_at": None}
if args.worker == "on":
    if args.scenario == "cold":
        # web boot schedules prestart 30 s after boot (api/main.py); a request before that starts it itself.
        threading.Timer(30.0, cw.prestart).start()
        def watch_ready():
            W.ready.wait(120)
            boot["ready_at"] = now_s()
        threading.Thread(target=watch_ready, daemon=True).start()
    else:
        cw.prestart()
        t = time.monotonic()
        W.ready.wait(60)
        print(f"[warm] worker READY after {time.monotonic()-t:.2f}s; warmed before the sequence")
        T0 = time.monotonic()

stop = threading.Event()

# ── background load ───────────────────────────────────────────────────────────────────────────────
if args.scenario == "listload":
    # other members' list/history serves meeting sources with no persisted set (the PERSISTED path:
    # a DetectorBudget per request, `_DETECTOR_IDLE_UNTIL` cool-down 2x the run)
    base = ("//@version=5\nindicator('big')\n" + "x = ta.sma(close, 10) + ta.ema(close, 20)\n" * 4000)
    def lister():
        i = 0
        while not stop.is_set():
            i += 1
            src = base[: args.load_bytes] + f"\n// row {i}\nplot(close)\n"
            rt.capabilities_for(src, budget=rt.DetectorBudget(member="other"))
            stop.wait(1.0 / args.load_rate)
    threading.Thread(target=lister, daemon=True).start()
elif args.scenario == "bigverdict":
    # ANOTHER member editing a large script in the member pane: the pane asks the verdict door once per
    # source that has been still for 250 ms, so each pause is a fresh verdict run on a new big source
    base = ("//@version=5\nindicator('big')\n" + "x = ta.sma(close, 10) + ta.ema(close, 20)\n" * 4000)
    def editor():
        i = 0
        while not stop.is_set():
            i += 1
            rt.runtime_admission(base[: args.load_bytes] + f"\n// edit {i}\nplot(close)\n", member="other-member")
            stop.wait(1.0 / args.load_rate)
    threading.Thread(target=editor, daemon=True).start()
elif args.scenario == "gil":
    # boot-time CPU-bound Python threads (prewarm-shaped): they compete for the GIL with the request thread
    def spin():
        x = 0
        while not stop.is_set():
            for _ in range(20000):
                x += 1
    for _ in range(args.gil_threads):
        threading.Thread(target=spin, daemon=True).start()
elif args.scenario == "quarantine":
    # two of this member's earlier sources timed out / raised in the detector in the last 10 min
    t = time.monotonic()
    W.strike_member(USER, t - 300)
    W.strike_member(USER, t - 200)


def diagnose_before(src: str) -> dict:
    key = rt.source_hash(src)
    m = time.monotonic()
    return {
        "lru": rt._lru_get(key) is not None,
        "member_spent": round(rt._verdict_member_spent(USER, m), 4),
        "verdict_cool_s": round(max(0.0, rt._VERDICT_IDLE_UNTIL[0] - m), 4),
        "detector_cool_s": round(max(0.0, rt._DETECTOR_IDLE_UNTIL[0] - m), 4),
        "gate_free": rt._DETECTOR_GATE._value > 0,
        "worker_stats": dict(W.stats),
        "worker_ready": W.ready.is_set(),
    }


def classify(before: dict, after_stats: dict) -> str:
    if before["member_spent"] >= rt.VERDICT_MEMBER_SECONDS:
        return f"G1 member verdict budget ({before['member_spent']:.2f}s >= {rt.VERDICT_MEMBER_SECONDS}s / 60s)"
    if before["verdict_cool_s"] > 0:
        return f"G2 verdict duty cool-down 1/6 ({before['verdict_cool_s']*1000:.0f} ms left, process-wide)"
    if before["detector_cool_s"] > 0:
        return f"G3 persisted-work cool-down 1/3 ({before['detector_cool_s']*1000:.0f} ms left, process-wide)"
    if not before["gate_free"]:
        return "G4 detector gate held (one run per process)"
    d = {k: after_stats.get(k, 0) - before["worker_stats"].get(k, 0) for k in after_stats}
    for k, label in (("busy", "W1 worker busy (another call holds it)"),
                     ("quarantined", "W2 worker quarantine (source or MEMBER)"),
                     ("unavailable", "W3 worker not READY (cold start / restart budget)"),
                     ("timeout", "W4 worker timeout"), ("crashed", "W5 worker crashed"),
                     ("error", "W6 worker error")):
        if d.get(k):
            return label
    return "G? (state changed between snapshot and call)"


def ask(src: str) -> tuple:
    b = diagnose_before(src)
    t = time.perf_counter()
    r = client.post("/api/user-definitions/runtime-admission", json={"source": src})
    dt = time.perf_counter() - t
    body = r.json() if r.status_code == 200 else {"status": r.status_code}
    pending = r.status_code == 200 and "pending" in (body.get("missing") or [])
    gate = classify(b, dict(W.stats)) if pending else ("lru" if b["lru"] else "ran")
    return pending, body, gate, dt


results = []
sources = []
for i, (name, src) in enumerate(SCRIPTS):
    for rnd in range(args.repairs + 1):
        sources.append((f"{name}" + (f"/r{rnd}" if rnd else ""), src if rnd == 0 else variant(src, rnd)))

landing = 0.0
for name, src in sources:
    while now_s() < landing:
        time.sleep(0.01)
    # the converse request that WROTE it already ran the detector in-process (pine_authoring.waits_for_the_bar)
    t = time.perf_counter(); waits = pa.waits_for_the_bar(src); conv_ms = (time.perf_counter() - t) * 1000
    row = {"script": name, "landed_s": round(now_s(), 2), "converse_detector_ms": round(conv_ms, 2),
           "attempts": [], "window_final": None, "verdict_at_s": None}
    # the window: requestRuntimeAdmission, 5 attempts 1.5 s apart
    start = now_s()
    for k in range(5):
        pending, body, gate, dt = ask(src)
        row["attempts"].append({"t": round(now_s() - start, 2), "pending": pending, "gate": gate,
                                "ms": round(dt * 1000, 1), "admitted": body.get("admitted")})
        if not pending:
            row["window_final"] = "admitted" if body.get("admitted") else f"refused {body.get('missing')}"
            row["verdict_at_s"] = round(now_s() - start, 2)
            break
        if k < 4:
            time.sleep(1.5)
    if row["window_final"] is None:
        row["window_final"] = "STILL BEING CHECKED (window gave up)"
        # the member pane's watchRuntimeAdmission keeps asking: 3, 6, 12, 24 s (capped at the 60 s recheck)
        wait = 3.0
        while now_s() - start < 90:
            time.sleep(wait); wait = min(60.0, wait * 2)
            pending, body, gate, dt = ask(src)
            row["attempts"].append({"t": round(now_s() - start, 2), "pending": pending, "gate": gate,
                                    "ms": round(dt * 1000, 1), "after_giveup": True})
            if not pending:
                row["verdict_at_s"] = round(now_s() - start, 2)
                break
    results.append(row)
    landing = start + args.gap

stop.set()
out = {"worker": args.worker, "scenario": args.scenario, "gap": args.gap, "repairs": args.repairs,
       "worker_ready_at_s": boot["ready_at"], "worker_stats": W.stats, "results": results}
for r in results:
    pend = [a for a in r["attempts"] if a["pending"]]
    gates = sorted({a["gate"] for a in pend})
    print(f"{r['script']:10s} landed {r['landed_s']:6.2f}s  window: {r['window_final']:38s} "
          f"verdict@{r['verdict_at_s']}s  pendings={len(pend)} {gates}")
if boot["ready_at"] is not None:
    print(f"worker READY at {boot['ready_at']:.2f}s after 'boot'")
print("worker stats:", W.stats)
if args.json:
    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
cw.shutdown()
