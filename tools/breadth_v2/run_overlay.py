"""Run one Breadth V2 tool with the ACCEPTED pinned modules overlaid (api.services.breadth_v2_overlay).

argv: SCRIPT [args...]   env BV2_EMA_RULE=0 runs the accepted frozen EMA (reproduction proofs only).
A fresh interpreter per vintage — the pinned grouped-history module caches sessions per process.
"""
import os
import runpy
import sys

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.normpath(os.path.join(here, "..", ".."))
sys.path.insert(0, root)
from api.services import breadth_v2_overlay as ov  # noqa: E402

ov.activate(ema_rule=os.environ.get("BV2_EMA_RULE", "1") != "0")
script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))
runpy.run_path(script, run_name="__main__")
