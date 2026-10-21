"""The pre-round-3 goldens for tests/test_shape_draw_rounds.py: what the shape drawings of origin/master (BEFORE
round 3 touched api/services/pattern_engine/shape_draw.py) draw on a fixed set of synthetic series.

⛔ EVIDENCE BEFORE CHANGE. This runs origin/master's shape_draw.py (read with `git show`, never the working
tree) and its output `tests/fixtures/shape_draw_golden.json` is committed. The rail re-draws the same series
with the current module -- the double bottom and ascending base as they are, the saucer at round 2 and the IPO
base at round 1 -- and compares the JSON text, so round 3 cannot move the released double bottom, or the rounds
the lab already judged, by one key or one digit. Re-running this after a change would bless whatever the code
does now: only re-run it against a commit that predates the change, for a deliberate, reviewed reason.

    python -m tests.fixtures._gen_shape_draw_golden [<git-rev>]      (default origin/master)

The series are DERIVED from tests/test_shape_draw_rounds.py's own generator (imported, never retyped).
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "shape_draw_golden.json"
ROOT = Path(__file__).resolve().parents[2]


def load_module_at(rev: str):
    src = subprocess.run(["git", "-C", str(ROOT), "show", "%s:api/services/pattern_engine/shape_draw.py" % rev],
                         check=True, capture_output=True).stdout
    if not src.strip():
        raise SystemExit("git show returned nothing for %s" % rev)
    fd, path = tempfile.mkstemp(suffix="_shape_draw_old.py")
    with os.fdopen(fd, "wb") as fh:
        fh.write(src)
    spec = importlib.util.spec_from_file_location("shape_draw_old", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    os.unlink(path)
    return mod


def main(rev: str = "origin/master") -> None:
    sys.path.insert(0, str(ROOT))
    from tests import test_shape_draw_rounds as T
    old = load_module_at(rev)
    out = {"rev": subprocess.run(["git", "-C", str(ROOT), "rev-parse", rev], check=True, capture_output=True,
                                 text=True).stdout.strip()}
    for fam, fn_name, kw in T.GOLDEN_FAMILIES:
        fn = getattr(old, fn_name)
        out[fam] = [T.draw_json(fn, b, i, **kw(b)) for b, i in T.family(fam)]
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, indent=0, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, OUT)
    print({k: (sum(1 for x in v if x != "null") if isinstance(v, list) else v) for k, v in out.items()})


if __name__ == "__main__":
    main(*sys.argv[1:])
