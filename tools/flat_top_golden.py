"""Write the "flat top" drawing's byte-for-byte golden from code that has NO flat-top drawing.

    python tools/flat_top_golden.py --code-root <a checkout of the pre-drawing commit> --sha <that commit>

Imports the pattern engine from --code-root (put first on sys.path) and the seeded synthetic sweep
from THIS checkout's tests/flat_top_sweep.py, runs every registered detector over it, and writes
tests/fixtures/flat_top_golden.json: one digest per (series, cut) of ALL detections exactly as that
code produced them. tests/test_flat_top_golden.py recomputes them with the code under test, the
drawing's own stamp (draw_flat_top + draw_round on a uct_flat_top_breakout row) removed, and
requires every digest to match. Never point --code-root at the code under test.
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code-root", required=True)
    ap.add_argument("--sha", required=True)
    args = ap.parse_args()
    root = os.path.abspath(args.code_root)
    if os.path.normcase(root) == os.path.normcase(REPO):
        print("refusing: --code-root is this checkout (the code under test)")
        return 2
    spec = importlib.util.spec_from_file_location("flat_top_sweep",
                                                  os.path.join(REPO, "tests", "flat_top_sweep.py"))
    sweep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sweep)
    sys.path.insert(0, root)
    from api.services.pattern_engine import detect_all, display
    from api.services.pattern_engine.primitives.context import build_context
    if not os.path.normcase(os.path.abspath(display.__file__)).startswith(os.path.normcase(root)):
        print("refusing: the engine imported from", display.__file__)
        return 2
    if hasattr(display, "FLAT_TOP_DRAW_ROUND") or hasattr(display, "flat_top_drawing"):
        print("refusing: --code-root already has the flat-top drawing")
        return 2
    n = sweep.load_detectors()
    digests, counts = sweep.run(detect_all, build_context, drop_flat_top=False)
    out = {"code_sha": args.sha, "series": sweep.SERIES, "cuts": list(sweep.CUTS),
           "detector_modules": n, "counts": counts, "digests": digests}
    path = os.path.join(REPO, "tests", "fixtures", "flat_top_golden.json")
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
