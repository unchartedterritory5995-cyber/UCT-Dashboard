"""Run the rollback procedure's "check it" list inside one extracted step tree (lane R1).

    python verify_list.py <label>

Runs, in that tree, each in its own subprocess, and writes both logs to sandbox/<label>/:
  * pytest tests/test_notebook_schema_guard.py (the schema tables' parity + the server refusal)
  * vitest --maxWorkers=2 over the procedure's list, keeping only the files present in THAT tree
    (82c56dd63's three rails are absent once wave 5 is reverted: it is not re-applied), and
    naming the ones left out.
The totals line is what counts: a log without one is a failed invocation, not a pass.
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
EVID = HERE.parent
sys.path.insert(0, str(EVID))
import rehearse  # noqa: E402

VITEST_LIST = [
    "src/pages/journal-2-0/lib/notebookSchema.rail.test.js",
    "src/hub/writePathsTransitive.test.js",
    "src/hub/writePaths.test.js",
    "src/pages/journal-2-0/lib/importer",
    "src/pages/journal-2-0/lib/offline/writtenSchemaDrain.test.js",
    "src/pages/journal-2-0/lib/offline/writtenSchemaCapture.test.js",
    "src/pages/journal-2-0/components/notebook/NoteEditorPage.writtenSchema.test.jsx",
]


def main() -> int:
    label = sys.argv[1]
    label, tree, what = rehearse.find(label)
    dest = rehearse.TREES / label
    out = EVID / "sandbox" / label
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with open(out / "verify-pytest.log", "w", encoding="utf-8") as fh:
        fh.write(f"# {what}; tree {tree}\n# python -m pytest tests/test_notebook_schema_guard.py -q\n")
        fh.flush()
        rc_py = subprocess.call([sys.executable, "-m", "pytest", "tests/test_notebook_schema_guard.py", "-q",
                                 "-p", "no:cacheprovider"], cwd=str(dest), stdout=fh, stderr=subprocess.STDOUT)
        fh.write(f"\n# rc {rc_py} in {time.time() - t0:.0f} s\n")
    present = [p for p in VITEST_LIST if (dest / "app" / p).exists()]
    absent = [p for p in VITEST_LIST if p not in present]
    vitest = rehearse.TREES / "node_modules" / "vitest" / "vitest.mjs"
    t0 = time.time()
    with open(out / "verify-vitest.log", "w", encoding="utf-8") as fh:
        fh.write(f"# {what}; tree {tree}\n# vitest run --maxWorkers=2 {' '.join(present)}\n"
                 f"# absent in this tree: {absent or 'none'}\n")
        fh.flush()
        rc_vi = subprocess.call(["node", str(vitest), "run", "--maxWorkers=2", *present], cwd=str(dest / "app"),
                                stdout=fh, stderr=subprocess.STDOUT)
        fh.write(f"\n# rc {rc_vi} in {time.time() - t0:.0f} s\n")
    for name in ("verify-pytest.log", "verify-vitest.log"):
        lines = (out / name).read_text(encoding="utf-8", errors="replace").splitlines()
        tot = [l for l in lines if (" passed" in l or " failed" in l) and ("Tests" in l or "=" in l or "in " in l)]
        print(f"{label} {name}: {tot[-2:] if tot else 'NO TOTALS LINE'}")
    print(f"{label}: pytest rc {rc_py}, vitest rc {rc_vi}; vitest files absent here: {absent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
