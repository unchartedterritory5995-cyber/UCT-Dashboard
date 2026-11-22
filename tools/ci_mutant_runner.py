"""Run a mutants manifest in CI: every mutant must turn its rail RED, and every file must come back byte-equal.

    python tools/ci_mutant_runner.py --manifest ci/mutants/<name>.json --out mutants-result.json

Manifest (`uct.ci-mutants/v1`, PROPOSED 2026-11-15 with .github/workflows/pine-heavy.yml):

    {"schema": "uct.ci-mutants/v1",
     "mutants": [
       {"id": "M1",
        "mutant": "what the edit breaks, in words",
        "file": "app/src/components/chart/engine/x.js",      # repo-relative, must exist
        "from": "exact text, present EXACTLY ONCE in the file",
        "to":   "the replacement",
        "rail": "cd app && npx vitest run src/components/chart/engine/x.test.js",   # run from the repo root
        "expectRed": "optional substring that must appear in the failing output"}]}

Each mutant goes through `tools/mutation_check.py` (the repo's byte-exact harness: snapshot, mutate,
require red, restore the saved bytes, require green again, verify the hash; never `git checkout`).
The result file uses the record shape of `docs/pine/evidence/*/runs/mutants.json`
(id, mutant, file, rail, rc, killed, restoredByteEqual, seconds).

Exit: 0 every mutant killed and restored · 1 a mutant survived, or a restore/green-again check failed ·
2 the manifest is malformed (an unknown schema, a missing field, a `from` that is absent or not unique).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA = "uct.ci-mutants/v1"
FIELDS = ("id", "mutant", "file", "from", "to", "rail")
HARNESS = ROOT / "tools" / "mutation_check.py"


def validate(doc: dict, root: pathlib.Path = ROOT) -> list[str]:
    """Every problem with the manifest, as a line. Empty = runnable."""
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        return [f"schema must be {SCHEMA!r}"]
    mutants = doc.get("mutants")
    if not isinstance(mutants, list) or not mutants:
        return ["`mutants` must be a non-empty list"]
    problems, ids = [], set()
    for i, m in enumerate(mutants):
        where = f"mutants[{i}]"
        missing = [f for f in FIELDS if not isinstance(m.get(f), str) or (f != "to" and not m.get(f))]
        if missing:
            problems.append(f"{where}: missing or empty {missing}")
            continue
        if m["id"] in ids:
            problems.append(f"{where}: duplicate id {m['id']!r}")
        ids.add(m["id"])
        path = (root / m["file"]).resolve()
        if root.resolve() not in path.parents or not path.is_file():
            problems.append(f"{m['id']}: file {m['file']!r} is not a file inside the repo")
            continue
        with open(path, encoding="utf-8", newline="") as fh:     # the bytes the harness will edit: no newline translation
            n = fh.read().count(m["from"])
        if n != 1:
            problems.append(f"{m['id']}: `from` occurs {n} times in {m['file']} (must be exactly once)")
        if m["from"] == m["to"]:
            problems.append(f"{m['id']}: `from` equals `to`, so nothing is mutated")
    return problems


def run_one(m: dict, root: pathlib.Path = ROOT) -> dict:
    cmd = [sys.executable, str(HARNESS), "--file", m["file"], "--replace", m["from"], "--with", m["to"], "--test", m["rail"]]
    if m.get("expectRed"):
        cmd += ["--expect-red", m["expectRed"]]
    t0 = time.time()
    p = subprocess.run(cmd, cwd=root, capture_output=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    lines = out.splitlines()
    print(f"--- {m['id']}: {m['mutant']}\n{out}", flush=True)
    return {
        "id": m["id"], "mutant": m["mutant"], "file": m["file"], "rail": m["rail"],
        "rc": p.returncode,
        # read the harness's own step lines (its [2] line echoes the mutant text, which may say anything)
        "killed": any(l.startswith("[3] rail failed as required") for l in lines) and not any(l.startswith("[3] [X]") for l in lines),
        "greenAfterRestore": any(l.startswith("[5] rail green again after restore") for l in lines),
        "restoredByteEqual": any(l.startswith("[6] byte-identical restore verified") for l in lines),
        "seconds": round(time.time() - t0, 1),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--repo", default=None,
                    help="the checkout the manifest's files and rails live in (default: this tool's own repo). "
                         "pine-heavy runs this tool from a sparse tools checkout, so it names the workspace.")
    a = ap.parse_args(argv)
    root = pathlib.Path(a.repo).resolve() if a.repo else ROOT
    if not root.is_dir():
        print(f"[mutants] --repo {a.repo} is not a directory")
        return 2
    try:
        doc = json.loads(pathlib.Path(a.manifest).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        print(f"[mutants] cannot read {a.manifest}: {err}")
        return 2
    problems = validate(doc, root)
    if problems:
        for p in problems:
            print(f"::error::{p}")
        return 2
    results = [run_one(m, root) for m in doc["mutants"]]
    ok = all(r["rc"] == 0 and r["killed"] and r["greenAfterRestore"] and r["restoredByteEqual"] for r in results)
    pathlib.Path(a.out).write_text(json.dumps({"schema": SCHEMA, "manifest": a.manifest, "mutants": results}, indent=1) + "\n", encoding="utf-8")
    for r in results:
        print(f"[mutants] {r['id']}: {'KILLED' if r['killed'] else 'SURVIVED'} rc={r['rc']} restored={r['restoredByteEqual']} {r['seconds']}s")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
