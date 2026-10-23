"""Write the cup tier's byte-for-byte golden from code that has NO cup tier.

    python tools/cup_tier_golden.py --code-root <a checkout of the pre-tier commit> --sha <that commit>

Imports api.services.auto_structures from --code-root (put first on sys.path) and the seeded synthetic sweep
from THIS checkout's tests/cup_tier_sweep.py, runs structures_for over every scan, and writes
tests/fixtures/cup_tier_golden.json: one digest per scan of every structures row exactly as that code produced
it. tests/test_cup_tier_golden.py recomputes them with the code under test, the tier stamp removed, and
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
if REPO not in sys.path:
    sys.path.insert(0, REPO)
import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (--code-root still wins: it goes to sys.path[0] later, and conftest imports no api.*)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code-root", required=True)
    ap.add_argument("--sha", required=True)
    args = ap.parse_args()
    root = os.path.abspath(args.code_root)
    if os.path.normcase(root) == os.path.normcase(REPO):
        print("refusing: --code-root is this checkout (the code under test)")
        return 2
    spec = importlib.util.spec_from_file_location("cup_tier_sweep", os.path.join(REPO, "tests", "cup_tier_sweep.py"))
    sweep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sweep)
    sys.path.insert(0, root)
    from api.services import auto_structures
    if not os.path.normcase(os.path.abspath(auto_structures.__file__)).startswith(os.path.normcase(root)):
        print("refusing: auto_structures imported from", auto_structures.__file__)
        return 2
    if hasattr(auto_structures, "cup_tier_stamp") or hasattr(auto_structures, "MEMBER_CUP_TIER_ROUND"):
        print("refusing: --code-root already has the cup tier")
        return 2
    digests, counts = sweep.run(auto_structures, strip=False)
    out = {"code_sha": args.sha, "series": sweep.SW.SERIES, "cuts": list(sweep.SW.CUTS),
           "counts": counts, "digests": digests}
    path = os.path.join(REPO, "tests", "fixtures", "cup_tier_golden.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
