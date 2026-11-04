"""Wave 13 lane 13J mutation proof -- break each load-bearing guard of the active setups board
and find more like this, one at a time, and show a rail goes RED.

    python tools/notebook_w13j_mutation_proof.py docs/notebook/evidence/wave13-13j/mutation-<sha>.txt

Guards: the drawn-levels-only filter (the board can only hold a chart/canvas-drawn entry), the
plan-review and already-consumed (13A-frozen) exclusions, the invalidated boundary (price AT the
stop), the closeness-first sort bucket order, both routers' flag gates, the paid gate on find
more like this, the nightly-only door (the request path must never reach the universe), the
RULES distance constants, and the herd-safety invariants on the board's own grid (the mount cap,
no background warm).

Each mutation is applied to the CAPTURED bytes of one file and the named rail files are run
WHOLE (never `-k` / `vitest -t`, which can match nothing and exit 0). A mutation is KILLED only
when the run reports at least one failed test. Every restore writes back the captured bytes --
never `git checkout` -- and is verified against the committed blob (`git cat-file blob
HEAD:<path>`, line endings normalised). An unmutated control runs green before and after. Exit 0
only when every mutation is killed and every restore verified.
"""
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
APP = REPO / "app"
OUT = pathlib.Path(sys.argv[1])

SB = "api/services/journal_two/setups_board.py"
SM = "api/services/journal_two/similar_matches.py"
RT = "api/routers/notebook_setups_board.py"
J2 = "app/src/pages/journal-2-0"
JSX_BOARD = f"{J2}/components/notebook/SetupsBoard.jsx"
JSX_CARD = f"{J2}/components/notebook/BoardCard.jsx"

PY_BOARD = "tests/test_notebook_setups_board.py"
PY_SIMILAR = "tests/test_notebook_similar_matches.py"
VT_BOARD = f"{J2}/components/notebook/SetupsBoard.test.jsx"

# (name, path, old, new, rails)
MUTATIONS = [
    ("D1 drawn-only: a text-labelled entry counts as drawn", SB,
     '            if entry_role.state != plan_extract.STATE_OK or entry_role.shape not in DRAWN_SHAPES:\n',
     '            if entry_role.state != plan_extract.STATE_OK:\n', [PY_BOARD]),
    ("D2 review: a plan-review note is never excluded", SB,
     '    return isinstance(tags, list) and REVIEW_TAG in tags\n',
     '    return False and isinstance(tags, list) and REVIEW_TAG in tags\n', [PY_BOARD]),
    ("D3 consumed: a plan 13A already froze against a trade stays on the board", SB,
     '            if (note["id"], sym) in consumed:\n                continue\n',
     '            if False:\n                continue\n', [PY_BOARD]),
    ("B1 boundary: price AT the stop reads waiting, not invalidated (<= turned <)", SB,
     '        broken = price <= stop\n', '        broken = price < stop\n', [PY_BOARD]),
    ("S1 sort: the invalidated bucket collapsed into the live one", SB,
     '_BUCKET = {"waiting": 0, "watching": 0, "triggered": 0, "invalidated": 1, "no_price": 2}\n',
     '_BUCKET = {"waiting": 0, "watching": 0, "triggered": 0, "invalidated": 0, "no_price": 2}\n',
     [PY_BOARD]),
    ("G1 gate: the board router's flag dependency ignored", RT,
     'dependencies=[Depends(_gate(setups_board.enabled))])',
     'dependencies=[Depends(_gate(lambda: True))])', [PY_BOARD]),
    ("G2 gate: the find-similar router's flag dependency ignored", RT,
     'dependencies=[Depends(_gate(similar_matches.enabled))])',
     'dependencies=[Depends(_gate(lambda: True))])', [PY_SIMILAR]),
    ("P1 paid gate: find more like this answers a free plan", RT,
     '    if not is_paid_user(user):\n        raise HTTPException(status_code=402, detail="Find more like this requires a paid plan")\n',
     '    if False:\n        raise HTTPException(status_code=402, detail="Find more like this requires a paid plan")\n',
     [PY_SIMILAR]),
    ("U1 nightly-only: the request path reaches the universe", SM,
     '    ensure_schema(conn)\n    chart_blocks.ensure_schema(conn)\n    block = chart_blocks.get_block(user_id, note_id, embed_key, conn)\n',
     '    ensure_schema(conn)\n    load_universe()\n    chart_blocks.ensure_schema(conn)\n'
     '    block = chart_blocks.get_block(user_id, note_id, embed_key, conn)\n', [PY_SIMILAR]),
    ("C1 constants: the rs_rank scale widened (a weaker RS still reads close)", SM,
     '    "rs_rank":            (2.0, 25.0),    # rank points (1-99)\n',
     '    "rs_rank":            (2.0, 99.0),    # rank points (1-99)\n', [PY_SIMILAR]),
    ("H1 herd safety: the mount cap raised past the grid's own limit", JSX_BOARD,
     'export const MOUNT_LIMIT = 3\n', 'export const MOUNT_LIMIT = 40\n', [VT_BOARD]),
    ("H2 herd safety: a card's chart warms itself in the background", JSX_CARD,
     'backgroundWarm={false}\n            deepWarm={false}\n',
     'backgroundWarm={true}\n            deepWarm={false}\n', [VT_BOARD]),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def blob(rel):
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{rel}"],
                          capture_output=True, check=True).stdout


def norm(b):
    return b.replace(b"\r\n", b"\n")


def clear_pyc(rel):
    p = REPO / rel
    d = p.parent / "__pycache__"
    if d.is_dir():
        for f in d.glob(p.stem + "*.pyc"):
            f.unlink()


NPX = shutil.which("npx") or shutil.which("npx.cmd")


def run(rails):
    """Run rail FILES whole; return (rc, failed_count, summary lines)."""
    vt = [r for r in rails if r.startswith("app/")]
    py = [r for r in rails if not r.startswith("app/")]
    failed, lines, rc = 0, [], 0
    if vt:
        r = subprocess.run([NPX, "vitest", "run", *[v[len("app/"):] for v in vt], "--maxWorkers=1"],
                           cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1200)
        txt = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
        tot = [ln.strip() for ln in txt.splitlines() if re.match(r"\s*(Test Files|Tests)\s", ln)]
        m = re.search(r"Tests\s+(\d+) failed", txt)
        failed += int(m.group(1)) if m else 0
        if not tot:
            lines.append("vitest: NO TOTALS LINE (a run without one is not a run)")
            rc = rc or 99
        lines += [f"vitest: {t}" for t in tot]
        lines += [f"  {ln.strip()}" for ln in txt.splitlines() if " FAIL " in ln or ln.strip().startswith("×")][:6]
        rc = rc or r.returncode
    if py:
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        r = subprocess.run([sys.executable, "-m", "pytest", *py, "-q", "-p", "no:cacheprovider", "-W", "ignore"],
                           cwd=REPO, capture_output=True, text=True, env=env, timeout=1800)
        tot = [ln for ln in r.stdout.splitlines() if re.search(r"\d+ (passed|failed)", ln)]
        m = re.search(r"(\d+) failed", r.stdout)
        failed += int(m.group(1)) if m else 0
        if not tot:
            lines.append("pytest: NO TOTALS LINE")
            rc = rc or 99
        lines += [f"pytest: {t}" for t in tot[-1:]]
        lines += [f"  {ln}" for ln in r.stdout.splitlines() if ln.startswith("FAILED")][:6]
        rc = rc or r.returncode
    return rc, failed, lines


def main() -> int:
    head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    out = [f"lane 13J mutation proof at HEAD {head}"]
    all_rails = sorted({r for m in MUTATIONS for r in m[4]})
    ok = True
    rc, failed, lines = run(all_rails)
    out.append(f"CONTROL before (unmutated) rc={rc} failed={failed}")
    out += lines
    ok = ok and rc == 0 and failed == 0

    for name, rel, old, new, rails in MUTATIONS:
        path = REPO / rel
        original = path.read_bytes()
        committed = blob(rel)
        if norm(original) != norm(committed):
            out.append(f"{name}: SKIPPED -- {rel} differs from HEAD before mutating (commit first)")
            ok = False
            continue
        text = original.decode("utf-8")
        n = text.replace("\r\n", "\n").count(old)
        if n != 1:
            out.append(f"{name}: SKIPPED -- the target text occurs {n} times in {rel}")
            ok = False
            continue
        mutated = text.replace("\r\n", "\n").replace(old, new)
        if "\r\n" in text:
            mutated = mutated.replace("\n", "\r\n")
        try:
            path.write_bytes(mutated.encode("utf-8"))
            clear_pyc(rel)
            rc, failed, lines = run(rails)
        finally:
            path.write_bytes(original)
            clear_pyc(rel)
        restored = path.read_bytes()
        verified = restored == original and norm(restored) == norm(committed)
        verdict = "KILLED" if failed > 0 else "SURVIVED"
        ok = ok and verdict == "KILLED" and verified
        out.append(f"{name}: {verdict} (rc={rc}, failed tests={failed}); restored sha {sha(restored)[:16]} == captured: "
                   f"{restored == original}; == committed blob (LF-normalised): {norm(restored) == norm(committed)}")
        out += [f"    {ln}" for ln in lines]

    rc, failed, lines = run(all_rails)
    out.append(f"CONTROL after restore rc={rc} failed={failed}")
    out += lines
    ok = ok and rc == 0 and failed == 0
    dirty = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--", "api", "app/src"],
                           capture_output=True, text=True).stdout.strip()
    out.append(f"git status over api/ and app/src after the run: {dirty or 'clean'}")
    ok = ok and not dirty
    out.append("VERDICT: " + ("PASS - every mutation killed, every restore verified against the committed blob" if ok else "FAIL"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    print("\n".join(out))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
