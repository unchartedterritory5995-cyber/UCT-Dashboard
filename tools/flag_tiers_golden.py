"""Write the bull_flag "flagging" tier's byte-for-byte golden from code that has NO tier.

    python tools/flag_tiers_golden.py --code-root <worktree at the pre-tier commit> --sha <that commit>

Imports the pattern engine from --code-root (put first on sys.path) and the seeded synthetic sweep
from THIS checkout's tests/flag_tiers_sweep.py, and writes tests/fixtures/flag_tiers_golden.json:
one digest per (series, cut) of the bull_flag detections exactly as that code produced them.
tests/test_flag_tiers.py recomputes them with the code under test, the tier's own `flagging` stamp
removed, and requires every digest to match. Never point --code-root at the code under test.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
if REPO not in sys.path:
    sys.path.insert(0, REPO)
import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (--code-root still wins: it goes to sys.path[0] later, and conftest imports no api.*)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code-root", required=True)
    ap.add_argument("--sha", required=True)
    args = ap.parse_args()
    root = os.path.abspath(args.code_root)
    if root == REPO:
        print("refusing: --code-root is this checkout (the code under test)")
        return 2
    spec = importlib.util.spec_from_file_location("flag_tiers_sweep",
                                                  os.path.join(REPO, "tests", "flag_tiers_sweep.py"))
    sweep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sweep)
    sys.path.insert(0, root)
    from api.services.pattern_engine.detectors.classical import bull_flag  # noqa: F401
    from api.services.pattern_engine import detect_all, display
    from api.services.pattern_engine.primitives.context import build_context
    if not os.path.abspath(display.__file__).startswith(root):
        print("refusing: the engine imported from", display.__file__)
        return 2
    if hasattr(display, "FLAGGING_TIER"):
        print("refusing: --code-root already has the flagging tier")
        return 2
    digests, counts = sweep.run(detect_all, build_context, drop_flagging=False)
    out = {"code_sha": args.sha, "series": sweep.SERIES, "cuts": list(sweep.CUTS),
           "counts": counts, "digests": digests}
    path = os.path.join(REPO, "tests", "fixtures", "flag_tiers_golden.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
