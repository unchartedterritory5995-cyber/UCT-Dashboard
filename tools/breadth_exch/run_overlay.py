"""Run one Exchange Breadth V1 tool under the ACCEPTED exchange engine — the production launcher.

argv: SCRIPT [args...]

The engine is EXACTLY the 14 module files in `tools/breadth_exch/pinned` (the accepted V2c2 pins plus the
declared `unchanged` patch to breadth_live.py / breadth_metrics.py), digests in
`breadth_exch_live_pins.json`. They are put FIRST on `api.services.__path__` — the same mechanism as
`tools/breadth_v2/run_overlay.py` for the US V2 producer — after every digest is verified; any drift refuses
before a single breadth module is imported. The session worker's own preflight then re-verifies the loaded
modules against the same pin set.

Replaces, for scheduled runs, the audit-era `tools/breadth_v2cc/launch.py` (which overlaid a code directory
under /data/_audit and re-exec'd with PID 1's environment). Arguments still travel by argv.
A fresh interpreter per invocation — the pinned grouped-history module caches sessions per process.
"""
import hashlib
import json
import os
import runpy
import sys

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.normpath(os.path.join(here, "..", ".."))
PINNED = os.path.join(here, "pinned")
pins = json.load(open(os.path.join(PINNED, "breadth_exch_live_pins.json")))
bad = {}
for m, want in pins["modules_md5_lf"].items():
    got = hashlib.md5(open(os.path.join(PINNED, m), "rb").read().replace(b"\r\n", b"\n")).hexdigest()
    if got != want:
        bad[m] = (got, want)
if bad:
    raise SystemExit("EXCHANGE ENGINE PIN MISMATCH: %s" % bad)
early = sorted(k for k in sys.modules if k.startswith("api.services.breadth_"))
if early:
    raise SystemExit("breadth modules imported before the overlay: %s" % early)
sys.path.insert(0, root)
import api.services  # noqa: E402

api.services.__path__.insert(0, PINNED)
try:
    os.nice(15)                    # the US V2 producer and the web share this box; the exchange yields
except (AttributeError, OSError):
    pass
script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))
runpy.run_path(script, run_name="__main__")
