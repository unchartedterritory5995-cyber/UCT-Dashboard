"""Write the bc:base MEMBER golden from code whose drawing round IS the member round.

    python tools/base_draw_member_golden.py --code-root <a checkout of the pre-round-2 commit> --sha <that commit>

Imports api.services.auto_structures from --code-root (put first on sys.path) and the seeded synthetic
member sweep from THIS checkout's tests/base_draw_member_sweep.py, and writes
tests/fixtures/base_draw_member_golden.json: one digest per session / scan of exactly what that code serves a
member from the base drawing (member_rows, then with_metrics member=True, metrics flag on).
tests/test_base_draw_member_parity.py recomputes them with the code under test and requires every digest to
match. Never point --code-root at the code under test.
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
    spec = importlib.util.spec_from_file_location("base_draw_member_sweep",
                                                  os.path.join(REPO, "tests", "base_draw_member_sweep.py"))
    sweep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sweep)
    sys.path.insert(0, root)
    from api.services import auto_structures
    from api.services.pattern_engine import base_draw
    if not os.path.normcase(os.path.abspath(auto_structures.__file__)).startswith(os.path.normcase(root)):
        print("refusing: auto_structures imported from", auto_structures.__file__)
        return 2
    if base_draw.BASE_DRAW_ROUND != auto_structures.MEMBER_BASE_ROUND or hasattr(auto_structures, "_base_member_row"):
        print("refusing: --code-root is already ahead of the member round")
        return 2
    digests, counts = sweep.run(auto_structures)
    out = {"code_sha": args.sha, "member_round": auto_structures.MEMBER_BASE_ROUND, "series": sweep.SW.SERIES,
           "first": sweep.FIRST, "step": sweep.STEP, "counts": counts, "digests": digests}
    path = os.path.join(REPO, "tests", "fixtures", "base_draw_member_golden.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
