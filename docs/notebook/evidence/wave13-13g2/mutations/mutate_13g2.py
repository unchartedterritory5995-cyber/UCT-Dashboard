"""Wave 13 lane 13G-2 -- mutation proof harness. Lane-unique filename per CLAUDE.md
(the session scratchpad is shared between concurrent lanes).

Each mutation: capture the committed blob, apply a one-line textual break to the
REAL source file, run the rail that should catch it, record pass/fail, restore the
captured bytes, and verify the restore against the git HEAD blob (never git checkout --).
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

REPO = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13g2")


def resolve_cmd(cmd):
    """Resolve argv[0] through shutil.which so a Windows .cmd/.exe shim (npx) is
    found -- subprocess.run cannot resolve those bare, per CLAUDE.md's measured
    'railway' lesson (never shell=True; resolve and exec the real path)."""
    resolved = shutil.which(cmd[0])
    if resolved is None:
        raise FileNotFoundError(f"could not resolve {cmd[0]!r} on PATH")
    return [resolved, *cmd[1:]]


def git_head_blob(relpath: str) -> bytes:
    out = subprocess.run(["git", "cat-file", "blob", f"HEAD:{relpath}"],
                          cwd=REPO, capture_output=True, check=True)
    return out.stdout


def run(cmd, timeout=300):
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


MUTATIONS = [
    {
        "id": "M1-batch-query",
        "desc": "thesis_chips.batch_chips issues ONE query per symbol instead of one batch query",
        "path": "api/services/journal_two/thesis_chips.py",
        "find": '    marks = ",".join("?" * len(cleaned))\n    rows = conn.execute(\n        "SELECT l.symbol AS symbol, l.note_id AS note_id, l.role AS role, l.price AS price,"\n        " n.title AS title, n.properties_json AS properties_json, n.updated_at AS updated_at"\n        f" FROM j2_note_levels l JOIN j2_notes n ON n.id = l.note_id AND n.user_id = l.user_id"\n        f" WHERE l.user_id = ? AND l.symbol IN ({marks}) AND n.deleted_at IS NULL",\n        [user_id, *cleaned],\n    ).fetchall()',
        "replace": '    rows = []\n    for _sym in cleaned:\n        rows.extend(conn.execute(\n            "SELECT l.symbol AS symbol, l.note_id AS note_id, l.role AS role, l.price AS price,"\n            " n.title AS title, n.properties_json AS properties_json, n.updated_at AS updated_at"\n            " FROM j2_note_levels l JOIN j2_notes n ON n.id = l.note_id AND n.user_id = l.user_id"\n            " WHERE l.user_id = ? AND l.symbol = ? AND n.deleted_at IS NULL",\n            [user_id, _sym],\n        ).fetchall())',
        "cmd": ["python", "-m", "pytest", "tests/test_notebook_thesis_chips.py", "-q"],
    },
    {
        "id": "M2-index-not-recomputed",
        "desc": "the chip's stop is hardcoded instead of read from the j2_note_levels row",
        "path": "api/services/journal_two/thesis_chips.py",
        "find": '            "stop": rec["stop"],',
        "replace": '            "stop": 90.0,  # MUTATION: ignores the index, hardcodes a plausible-looking value',
        "cmd": ["python", "-m", "pytest", "tests/test_notebook_thesis_chips.py", "-q"],
    },
    {
        "id": "M3-flag-gate",
        "desc": "the router-level flag gate is removed -- the route answers even while the flag is off",
        "path": "api/routers/notebook_thesis_chips.py",
        "find": "    dependencies=[Depends(_require_enabled)],\n",
        "replace": "    dependencies=[],\n",
        "cmd": ["python", "-m", "pytest", "tests/test_notebook_thesis_chips.py", "-q"],
    },
]

FRONTEND_MUTATIONS = [
    {
        "id": "M4-frontend-one-request",
        "desc": "the hook keys SWR per-symbol instead of on the whole deduped set -- N rows, N requests",
        "path": "app/src/pages/journal-2-0/hooks/useThesisChips.js",
        "find": "  const key = (thesisChipsEnabled() && unique.length) ? [THESIS_CHIPS_URL, unique] : null",
        "replace": "  const key = (thesisChipsEnabled() && unique.length) ? [THESIS_CHIPS_URL, unique[0]] : null  // MUTATION: drops every symbol past the first",
        "cmd": ["npx", "vitest", "run", "src/pages/journal-2-0/hooks/useThesisChips.test.js", "--maxWorkers=1"],
        "cwd": "app",
    },
]


def apply_and_run(m, cwd=None):
    full_path = REPO / m["path"]
    committed = git_head_blob(m["path"])
    on_disk = full_path.read_bytes()
    assert on_disk == committed, f"{m['path']} has uncommitted changes -- aborting mutation run"
    text = on_disk.decode("utf-8")
    assert m["find"] in text, f"MUTATION {m['id']}: find-text not present in {m['path']}"
    mutated = text.replace(m["find"], m["replace"], 1)
    full_path.write_bytes(mutated.encode("utf-8"))
    try:
        run_cwd = REPO / cwd if cwd else REPO
        resolved = resolve_cmd(m["cmd"])
        # encoding=utf-8 + errors=replace: the Windows locale codec (cp1252) chokes on
        # vitest's own unicode output (checkmarks etc.) -- CLAUDE.md's measured lesson.
        r = subprocess.run(resolved, cwd=run_cwd, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=300)
        killed = r.returncode != 0
        result = {
            "id": m["id"], "desc": m["desc"], "path": m["path"], "killed": killed,
            "returncode": r.returncode,
            "stdout_tail": r.stdout[-4000:], "stderr_tail": r.stderr[-2000:],
        }
    finally:
        full_path.write_bytes(committed)
        restored = full_path.read_bytes()
        ok = restored == committed
        if not ok:
            print(f"!!! RESTORE FAILED for {m['path']} !!!", file=sys.stderr)
            sys.exit(2)
    return result


def main():
    results = []
    out_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
    for m in MUTATIONS + FRONTEND_MUTATIONS:
        print(f"=== {m['id']} ===", file=sys.stderr)
        results.append(apply_and_run(m, cwd=m.get("cwd")))
        if out_path:
            out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
