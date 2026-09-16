"""Derive the reader HOT PATH by MEASURING which files execute during a real
/api/breadth-monitor request — not by walking imports.

⛔ THE IMPORT CLOSURE IS THE WRONG SET AND IT IS WRONG IN THE EXPENSIVE DIRECTION.
Walking imports from api.routers.breadth_monitor reaches 169 files, because the router
imports the engine which imports auth which imports half the app. Using that as the
sampler's poolability criterion would split the pool on a change to buzz_extract.py —
and with 31 commits landing on master in a single day, the pool would never reach the
n=59 that p95 needs. The set has to be the files that can actually move the number.

⛔ AND "EXECUTES DURING THE REQUEST" IS ITSELF ONLY SOUND IF THE REQUEST IS A REAL ONE.
This drives the same TestClient path the parity harness uses, on the same copied
databases, with the deep span — so module-level code that only runs on the deep read
(the reconstructed fetch) is included, and boot-only code is not.

    python hotpath.py <repo> <work-db-dir> <out.txt>
"""
from __future__ import annotations

import json
import os
import shutil
import sys

REPO, WORK, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, REPO)
import conftest  # noqa: E402

SB = os.path.join(os.environ.get("TEMP", "."), "uct-hotpath")
os.makedirs(SB, exist_ok=True)
_, pins, _ = conftest.shared_data_root_census()
for e, l in pins.items():
    os.environ[e] = l.replace("/data", SB)

RUN = os.path.join(SB, "dbs")
os.makedirs(RUN, exist_ok=True)
for f in ("breadth_monitor.db", "breadth_daily_ohlc.db", "breadth_sentiment_history.db"):
    dst = os.path.join(RUN, f)
    if not os.path.exists(dst):
        shutil.copy2(os.path.join(WORK, f), dst)
os.environ["BREADTH_MONITOR_DB"] = os.path.join(RUN, "breadth_monitor.db")
os.environ["BREADTH_OHLC_DB"] = os.path.join(RUN, "breadth_daily_ohlc.db")
os.environ["BREADTH_SENTIMENT_DB"] = os.path.join(RUN, "breadth_sentiment_history.db")
os.environ["DATA_DIR"] = SB
os.environ["BREADTH_DEEP_HISTORY"] = "1"

from fastapi.testclient import TestClient            # noqa: E402
import api.main as main                              # noqa: E402
from api.routers import breadth_monitor as rm        # noqa: E402
from api.services import breadth_self_heal           # noqa: E402
from api.services.cache import cache                 # noqa: E402

breadth_self_heal.maybe_auto_heal = lambda *a, **k: None
main.app.dependency_overrides[rm.require_paid] = lambda: {"id": "hp", "plan": "pro"}
client = TestClient(main.app)

# warm the import machinery so we trace the REQUEST, not first-import side effects
hit: set[str] = set()
# ⛔ DERIVE THE ROOT FROM AN IMPORTED MODULE, NOT FROM THE ARGUMENT. REPO arrives
# from Git Bash as "/c/Users/..." while co_filename is "C:\Users\...", so
# os.path.abspath(REPO) never matched and the trace recorded ZERO files twice
# before the non-vacuity assert caught it.
import api as _api  # noqa: E402
repo_abs = os.path.dirname(os.path.dirname(os.path.abspath(_api.__file__)))
COLLECT = [False]

# ⛔ sys.settrace IS PER-THREAD, and a plain `def` FastAPI route runs in the anyio
# THREADPOOL — so tracing only the calling thread captured ZERO files on the first
# attempt. threading.settrace installs the hook for every thread created AFTERWARDS,
# so it must be armed BEFORE the first request creates the pool. The warm request is
# then made with COLLECT off, so pool threads exist and are traced but nothing is
# recorded until the deep read.
import threading  # noqa: E402


def tracer(frame, event, arg):
    if event != "call" or not COLLECT[0]:
        return None
    fn = frame.f_code.co_filename
    if fn.startswith(repo_abs):
        rel = os.path.relpath(fn, repo_abs).replace("\\", "/")
        if rel.startswith("api/"):
            hit.add(rel)
    return None


# ⛔ threading.settrace() covers only threads created AFTER the call, and the anyio
# worker threads here already existed — that attempt also recorded ZERO files.
# settrace_all_threads (3.12+) reaches the live ones too.
cache.delete_prefix("breadth_history_")
client.get("/api/breadth-monitor?days=90")          # make sure the pool exists
if hasattr(threading, "settrace_all_threads"):
    threading.settrace_all_threads(tracer)
else:                                                # pragma: no cover
    threading.settrace(tracer)
sys.settrace(tracer)
COLLECT[0] = True
cache.delete_prefix("breadth_history_")
try:
    r = client.get("/api/breadth-monitor?days=8000", headers={"Accept-Encoding": "gzip"})
finally:
    COLLECT[0] = False
    sys.settrace(None)
    if hasattr(threading, "untrace_all_threads"):
        threading.untrace_all_threads()
    else:
        threading.settrace(None)

assert r.status_code == 200, r.status_code
body = r.content
# ⛔ NON-VACUITY: a traced run that executed nothing would produce an empty set and a
# "nothing changed" answer forever after.
assert len(hit) > 3, f"vacuous trace: {len(hit)} files"
assert len(body) > 100_000, f"vacuous response: {len(body)} bytes"

files = sorted(hit)
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(files) + "\n")
print(json.dumps({"executed_files": len(files), "body_bytes": len(body)}))
for f in files:
    print("   ", f)
