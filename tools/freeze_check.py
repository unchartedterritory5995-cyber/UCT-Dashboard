"""The signable surface is FROZEN until Sitting 4 lands. This says whether it moved.

⛔⛔ WHY. Between Sitting 1 and Sitting 4 the manifest is being signed row by row and merged
row by row. Editing a packet moves its fingerprint, so a row signed in Sitting 1 stops
verifying in Sitting 2. Editing `sign_manifest.txt` or `merge_all.UNITS` moves the universe
or the order, so the replay that said CLEAN no longer describes what will run. Editing the
code branch moves the universe outright.

⭐ **A freeze is a set of paths and their SHAs at a moment, printed** — not an intention. This
records that set and recomputes it; any difference is exit 1, by name.

⛔ If a defect is found in a frozen file mid-freeze, the fix is a NEW ROW appended after the
current sitting's `--until`, never an edit to a row already signed.

Usage:
    python tools/freeze_check.py --record      # write the baseline (once, at freeze)
    python tools/freeze_check.py               # check; exit 1 on any DIFF
    python tools/freeze_check.py --self-check  # prove it can fail
"""
from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = pathlib.Path(__file__).resolve().parent
DOCS = HERE.parent
CODE = DOCS.parent / "s7-price-level"
BASELINE = HERE / "freeze_baseline.txt"
OK, DIFF_EXIT, UNREADABLE_EXIT = 0, 1, 2

#: ⛔ The tools whose content decides a fingerprint, the universe, the order or the replay.
#: `freeze_check.py` itself is deliberately NOT here: it is the instrument, and freezing the
#: instrument against its own baseline is the self-reference this programme keeps paying for.
FROZEN_TOOLS = (
    "tools/sign_manifest.txt",
    "tools/sign_gate.py",
    "tools/sign_all.py",
    "tools/merge_all.py",
    "tools/verify_manifest.py",
    "tools/pre_sitting.py",
)
GATES = "docs/terminal-research/12-decisions/gates"
CODE_BRANCH = "feat/s7-price-level"


def _hash(p: pathlib.Path) -> str:
    r = subprocess.run(["git", "hash-object", str(p)], cwd=str(DOCS), capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else ""


def frozen_paths():
    """Every path in the freeze set, DERIVED — the gates directory is listed, never typed."""
    out = list(FROZEN_TOOLS)
    gdir = DOCS / GATES
    out += sorted("%s/%s" % (GATES, f.name) for f in gdir.iterdir()
                  if f.is_file() and f.suffix == ".md")
    return out


def code_tip() -> str:
    r = subprocess.run(["git", "rev-parse", CODE_BRANCH], cwd=str(CODE),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip() if r.returncode == 0 else ""


def snapshot(docs_root=None, code_branch_tip=None) -> dict:
    root = docs_root or DOCS
    snap = {}
    for rel in frozen_paths():
        p = root / rel
        snap[rel] = _hash(p) if p.is_file() else "<MISSING>"
    snap["@code:" + CODE_BRANCH] = (code_branch_tip if code_branch_tip is not None
                                    else code_tip())
    return snap


def read_baseline(path=None) -> dict:
    p = path or BASELINE
    if not p.is_file():
        return {}
    out = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rel, _, sha = line.rpartition(" | ")
        if rel:
            out[rel.strip()] = sha.strip()
    return out


def compare(base: dict, now: dict):
    """(diffs, checked). A path in one and not the other is a DIFF, not a skip."""
    diffs = []
    for rel in sorted(set(base) | set(now)):
        b, n = base.get(rel), now.get(rel)
        if b is None:
            diffs.append((rel, "<NOT IN BASELINE>", n))
        elif n is None:
            diffs.append((rel, b, "<GONE>"))
        elif b != n:
            diffs.append((rel, b, n))
    return diffs, len(set(base) | set(now))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--baseline", default=None)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    base_path = pathlib.Path(a.baseline) if a.baseline else BASELINE
    now = snapshot()

    if a.record:
        lines = ["# THE SIGNING FREEZE — recorded once, at freeze. Do not hand-edit.",
                 "# Any DIFF against this set means a fingerprint, the universe, the order",
                 "# or the replay has moved, and the sitting must not start.", ""]
        lines += ["%s | %s" % (rel, sha) for rel, sha in sorted(now.items())]
        base_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        print("[freeze] recorded %d path(s) to %s" % (len(now), base_path.name))
        return OK

    base = read_baseline(base_path)
    if not base:
        print("⛔ no freeze baseline at %s — UNREADABLE, not 'nothing frozen'." % base_path)
        return UNREADABLE_EXIT

    diffs, checked = compare(base, now)
    print("[freeze] %d path(s) checked" % checked)      # ⛔ non-vacuity: say how many
    if not diffs:
        print("[freeze] OK — every frozen path matches its recorded SHA")
        return OK
    for rel, b, n in diffs:
        print("  ⛔ DIFF %-62s %s -> %s" % (rel, b[:9], n[:9]))
    print("[freeze] ⛔ %d path(s) MOVED. A row already signed may no longer verify; a new "
          "row after the current --until is the fix, never an edit." % len(diffs))
    return DIFF_EXIT


def _self_check() -> int:
    """⛔ Against a COPY of the docs tree. Never the real one."""
    import shutil
    import tempfile
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-54s -> %-9s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    real_now = snapshot()
    show("the freeze set is non-empty (non-vacuity)", len(real_now) > 20, True)
    show("it includes the code branch tip", "@code:" + CODE_BRANCH in real_now, True)
    show("a clean tree compares equal to itself", compare(real_now, real_now)[0], [])

    box = pathlib.Path(tempfile.mkdtemp(prefix="freeze-"))
    try:
        # one frozen file moves
        moved = dict(real_now)
        a_path = sorted(p for p in moved if p.startswith("tools/"))[0]
        moved[a_path] = "0" * 40
        d, _ = compare(real_now, moved)
        show("one frozen file moved -> DIFF, and it is NAMED",
             len(d) == 1 and d[0][0] == a_path, True)
        # the code branch moves
        moved2 = dict(real_now)
        moved2["@code:" + CODE_BRANCH] = "0" * 40
        d2, _ = compare(real_now, moved2)
        show("the CODE BRANCH moving is a DIFF too", len(d2) == 1, True)
        # a path missing from the baseline is a DIFF, not a skip
        short = {k: v for k, v in real_now.items() if k != a_path}
        d3, _ = compare(short, real_now)
        show("a path absent from the baseline is a DIFF, never skipped", len(d3) == 1, True)
        # end to end against a real copy, through main()
        copy = box / "baseline.txt"
        lines = ["%s | %s" % (r, s) for r, s in sorted(real_now.items())]
        lines[0] = lines[0].rsplit(" | ", 1)[0] + " | " + "0" * 40
        copy.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        rc = main(["--baseline", str(copy)])
        show("main() exits 1 on a corrupted baseline", rc, DIFF_EXIT)
    finally:
        shutil.rmtree(box, ignore_errors=True)

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
