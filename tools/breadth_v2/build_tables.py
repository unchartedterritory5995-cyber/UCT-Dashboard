"""Build a vintage's guard + dividend-basis tables ONCE (the accepted `cp.Inputs` builders).
argv: INPUTS_DIR GROUPED_DIR     (run through run_overlay.py)"""
import json
import os
import sys

os.environ["BREADTH_GROUPED_DIR"] = sys.argv[2]
from api.services import breadth_corrected_pass as cp  # noqa: E402

inp = cp.Inputs(sys.argv[1])
print(json.dumps({"guard_input_key": inp.guard_key, "dividend_input_key": inp.dividend_key,
                  "dividend_counts": inp.dividend_counts, "guard_version": inp.guard.version,
                  "dividend_basis_version": inp.divbasis.version}))
