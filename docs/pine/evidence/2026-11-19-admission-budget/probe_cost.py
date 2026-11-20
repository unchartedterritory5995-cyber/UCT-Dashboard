"""Detector cost per script (cold first call, then warm), and whether the converse request already runs it."""
import sys, time, os
sys.path.insert(0, os.getcwd())
sys.path.insert(0, os.path.dirname(__file__))
from scripts import SCRIPTS

t0 = time.perf_counter()
from api.services import pine_capabilities as pc
print(f"import pine_capabilities: {time.perf_counter()-t0:.3f}s")
from api.services import pine_authoring as pa, runtime_definitions as rt

for name, src in SCRIPTS:
    t = time.perf_counter(); caps = pc.capabilities_of(src); c1 = time.perf_counter() - t
    t = time.perf_counter(); pc.capabilities_of(src + "\n//x"); c2 = time.perf_counter() - t
    ok, missing = rt.missing_capabilities(caps, set(rt.admitted_capabilities()["admitted"])), None
    print(f"{name:7s} {len(src):5d} B  first {c1*1000:7.1f} ms  warm {c2*1000:6.1f} ms  missing={ok}  caps={sorted(caps)}")

print("historyOnly (registry):", rt.admitted_capabilities()["historyOnly"])
print("pine_authoring.history_only (reference):", pa.history_only())
for name, src in SCRIPTS:
    t = time.perf_counter(); w = pa.waits_for_the_bar(src); d = time.perf_counter() - t
    print(f"converse waits_for_the_bar({name}) = {w}  ({d*1000:.1f} ms, runs capabilities_of: {bool(set(pa.history_only()) & set(pa.HISTORY_ONLY_READS))})")
