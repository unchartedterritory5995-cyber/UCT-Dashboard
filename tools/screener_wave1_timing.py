"""Measure the deep-read cost before shipping Wave 1 (spec §5.4).

Times get_bars at 400 vs 5000 bars over a 200-ticker sample and projects the
delta across the universe. Run on the pod (railway ssh, /opt/venv/bin/python)
for the real number — network-attached /data is the slow case that matters.
"""
import json
import random
import sys
import time

sys.path.insert(0, ".")
from api.services import bars_sqlite  # noqa: E402

universe = [t for t in json.load(open("api/data/cap_universe.json"))
            if isinstance(t, str)]
sample = random.Random(20260821).sample(universe, 200)

for depth in (400, 5000):
    t0 = time.perf_counter()
    n = sum(1 for t in sample if bars_sqlite.get_bars(t, "D", depth))
    dt = time.perf_counter() - t0
    print(f"depth={depth}: {dt:.2f}s for {n}/200 tickers "
          f"-> universe projection {dt / 200 * len(universe):.0f}s")
