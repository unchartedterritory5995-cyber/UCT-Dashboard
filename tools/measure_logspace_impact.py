"""What would log-space trendline fitting actually do to the eight convergence detectors?

⛔⛔ WHY THIS IS COMMITTED. `tests/test_convergence_detectors_use_raw_price.py`
records a measured table and four blockers, and tells the next reader to
re-derive the decision if any blocker is fixed. That instruction is worthless if
the harness behind the table lived only in a session scratchpad — the same
"a rail demanding a measurement nobody can reproduce is an instruction to guess"
this repo already learned once.

⭐ BOTH ARMS IN ONE PASS, ON IDENTICAL BARS. The detectors do
`from ...trendlines import fit_trendline`, binding the name at import, so the
forced-log-space arm is installed by rebinding the attribute ON EACH DETECTOR
MODULE. Running the two arms over the same bars in the same process makes this
a PAIRED comparison: any difference is the scale change and nothing else — not
a different sample, not a different day's data.

⚠️ THE RESULT IS THE OPPOSITE OF THE OBVIOUS ONE. Log space ADDS detections
rather than removing them: a channel holding a constant PERCENTAGE width widens
in points, so arithmetic fitting was refusing genuine channels. Read the rail's
docstring for the four consumers that make the one-keyword fix a trap.

Usage:
    python tools/measure_logspace_impact.py --sample 800 \
        --out docs/logspace_impact.json
"""
from __future__ import annotations

import argparse
import collections
import functools
import importlib
import json
import os
import pathlib
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Sandboxes every /data pin and arms the shared-root tripwire. MUST come before
# any product import — the paths are captured at module import.
import conftest                                                     # noqa: E402

# The two DBs this reads are pointed back at the LIVE files and both are opened
# READ-ONLY: an empty sandbox would make this report a confident zero, and
# `bars_sqlite._conn` normally opens bars.db read-write to set PRAGMAs.
LIVE_SCREENER = os.environ.get("UCT_LIVE_SCREENER_DB", os.path.join("C:", os.sep, "data", "screener.db"))
LIVE_BARS = os.environ.get("UCT_LIVE_BARS_DB", os.path.join("C:", os.sep, "data", "bars.db"))
os.environ["SCREENER_DB_PATH"] = LIVE_SCREENER

import sqlite3                                                      # noqa: E402
from api.services import bars_sqlite                                # noqa: E402

_RO_BARS = sqlite3.connect(
    "file:%s?mode=ro" % LIVE_BARS.replace(os.sep, "/"), uri=True,
    check_same_thread=False)
bars_sqlite._conn = lambda: _RO_BARS

from tools.probe import Probe                                       # noqa: E402
from tools.run_lift_ledger import load_universe                     # noqa: E402
from api.services.pattern_engine.primitives import trendlines as TL  # noqa: E402
from api.services.pattern_engine.primitives.context import build_context  # noqa: E402
from api.services.pattern_engine import detect_one                  # noqa: E402
from api.services.voice_tool_impls import (                         # noqa: E402
    _ensure_pattern_detectors_loaded)

#: ⛔ READ FROM THE RAIL THAT OWNS THE LIST, never retyped here. A second copy
#: would drift from the file whose argument rests on it.
sys.path.insert(0, str(ROOT / "tests"))
from test_convergence_detectors_use_raw_price import (              # noqa: E402
    _CONVERGENCE)

_MODULES = ["api.services.pattern_engine.detectors.classical." + n
            for n in _CONVERGENCE]


def force_log_space(on: bool) -> int:
    """Rebind `fit_trendline` on every convergence detector module."""
    forced = (functools.partial(TL.fit_trendline, log_space=True)
              if on else TL.fit_trendline)
    n = 0
    for name in _MODULES:
        try:
            mod = importlib.import_module(name)
        except ImportError:
            continue
        if hasattr(mod, "fit_trendline"):
            mod.fit_trendline = forced
            n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=800)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    _ensure_pattern_detectors_loaded()
    patched = force_log_space(False)
    print("[setup] %d of %d detector modules expose `fit_trendline`"
          % (patched, len(_CONVERGENCE)))
    if patched != len(_CONVERGENCE):
        raise SystemExit(
            "a convergence detector does not import fit_trendline by name — "
            "the paired arm would silently not apply to it, and the table "
            "would understate the change")

    bars_by = load_universe(args.sample)
    print("[universe] %d tickers" % len(bars_by))

    seen = {False: collections.Counter(), True: collections.Counter()}
    hits = {False: collections.Counter(), True: collections.Counter()}

    with Probe("log-space impact", expect_min=200) as p:
        for ticker, bars in bars_by.items():
            with p.item(ticker):
                ctx = build_context(bars, ticker)
                fired = False
                for arm in (False, True):
                    force_log_space(arm)
                    for pid in _CONVERGENCE:
                        try:
                            dets = detect_one(bars, ctx, pid)
                        except Exception:      # noqa: BLE001
                            continue
                        if dets:
                            seen[arm][pid] += 1
                            hits[arm][pid] += len(dets)
                            fired = True
                p.ok() if fired else p.skip("no convergence pattern in either arm")

    n = len(bars_by)
    print("\n%-24s%8s%8s%10s%10s" % ("pattern", "raw %", "log %", "raw hits", "log hits"))
    patterns = {}
    for pid in _CONVERGENCE:
        r, l = 100.0 * seen[False][pid] / n, 100.0 * seen[True][pid] / n
        patterns[pid] = {"raw_pct": round(r, 2), "log_pct": round(l, 2),
                         "raw_hits": hits[False][pid], "log_hits": hits[True][pid]}
        print("%-24s%7.1f%%%7.1f%%%10d%10d"
              % (pid, r, l, hits[False][pid], hits[True][pid]))

    tot_r, tot_l = sum(hits[False].values()), sum(hits[True].values())
    print("\nTOTAL detections %d -> %d" % (tot_r, tot_l))

    if args.out:
        blob = {"measured_at": time.strftime("%Y-%m-%d"), "sample_tickers": n,
                "seed": 7, "total_raw": tot_r, "total_log": tot_l,
                "patterns": patterns}
        path = args.out if os.path.isabs(args.out) else os.path.join(str(ROOT), args.out)
        payload = json.dumps(blob, indent=2) + "\n"
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        os.replace(tmp, path)
        print("wrote %s" % path)

    refused = len(conftest.SHARED_ROOT_VIOLATIONS)
    print("[tripwire] writes refused into the shared root: %d" % refused)
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
