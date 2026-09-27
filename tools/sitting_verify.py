"""After a sitting: derive what actually happened, from master and the deploy source.

⛔⛔ A SITTING'S RESULT IS READ FROM MASTER, NEVER FROM THE SUMMARY. The owner pastes a
terminal tail; this reads the artifacts. `merge_all` can print a merged unit and the push can
still have been refused, and a deploy can be SUCCESS for somebody else's commit.

⛔ MERGED-STATE IS PATCH IDENTITY (`git cherry`), never `--is-ancestor`: cherry-pick rewrites
the commit, so the original sha is never an ancestor of master.

⛔ Two states are BLOCKERS and they are different facts:
     SIGNED but NOT MERGED  — the sitting stopped, or a push was refused
     MERGED but UNSIGNED    — something reached master without a signature

Usage:
    python tools/sitting_verify.py --until e-cp9-build-record
    python tools/sitting_verify.py --until <row> --json
    python tools/sitting_verify.py --self-check
"""
from __future__ import annotations

import argparse
import importlib.util
import json
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
OK, BLOCKED, UNREADABLE = 0, 1, 2
GATES = DOCS / "docs/terminal-research/12-decisions/gates"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, str(HERE / (name + ".py")))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "").strip()


def merged_state(repo, commits, stem=None, ma=None, resolutions=None):
    """MERGED / NOT-MERGED / UNREADABLE for a unit's commit list, by patch id.

    ⛔⛔ F-RESOLVED-1 — A RESOLUTION-APPLIED COMMIT NEVER PATCH-MATCHES ITS ORIGINAL AGAIN.
    Resolving a conflict (K CP11) means the landed commit's diff differs from the source
    commit's own diff by construction, so `git cherry` reports NOT-MERGED forever after,
    even though the row's intended change is correctly on master. Measured 2026-09-18:
    `e-cp28-build-record` read NOT-MERGED — a permanent false BLOCKER — the moment
    after its recorded resolution actually landed for the first time. `ma._resolution_landed`
    (merge_all.py, the SAME check that fixed this for the merge engine itself) is
    consulted as a fallback so this reader and the engine never disagree about what
    "merged" means for a resolved row.
    """
    if not commits:
        return "NO-COMMITS"
    for c in commits:
        rc, out = _git(repo, "cherry", "origin/master", c)
        if rc != 0:
            return "UNREADABLE"
        mine = [l for l in out.splitlines() if l[2:].startswith(c[:9])]
        if mine and mine[-1].startswith("+"):
            if stem is not None and ma is not None and resolutions:
                landed = ma._resolution_landed(stem, c, repo, resolutions)
                if landed:
                    continue
                if landed is None:
                    return "UNREADABLE"
            return "NOT-MERGED"
    return "MERGED"


def rows_through(units, until):
    """(head, tail) split at `until`, or (None, None) if the row is not in the list."""
    names = [u[0] for u in units]
    if until not in names:
        return None, None
    i = names.index(until)
    return units[:i + 1], units[i + 1:]


def verify(until, units=None, repo=None, gates=None, verbose=True):
    ma = _load("merge_all")
    sg = _load("sign_gate")
    units = units if units is not None else ma.UNITS
    repo = repo or ma.DEFAULT_CODE_REPO
    gates = gates or GATES

    head, tail = rows_through(units, until)
    if head is None:
        if verbose:
            print("⛔ --until %r names no row. The last five are: %s"
                  % (until, ", ".join(u[0] for u in units[-5:])))
        return UNREADABLE, []

    _git(repo, "fetch", "origin", "master")
    blockers, lines = [], []
    # ⛔ F-RESOLVED-1 — loaded once, passed to every merged_state() call, so a
    # resolution-landed row is never misread as a permanent BLOCKER.
    resolutions, res_corrupt = ma.read_resolutions()
    if res_corrupt and verbose:
        print("⛔ REFUSED-CORRUPT-RESOLUTION: %s"
              % "; ".join("%s (%s)" % c for c in res_corrupt))

    def reader(stem):
        p = gates / (stem + ".md")
        if not p.is_file():
            return "NO-PACKET"
        return sg.read_approval(p.read_text(encoding="utf-8"))[0]

    for stem, commits, _mv in head:
        st, mg = reader(stem), merged_state(repo, commits, stem, ma, resolutions)
        good = (st == "SIGNED") and mg in ("MERGED", "NO-COMMITS")
        lines.append((stem, st, mg, "ok" if good else "BLOCKER"))
        if not good:
            blockers.append("%s: reader=%s merged=%s" % (stem, st, mg))

    for stem, commits, _mv in tail:
        st, mg = reader(stem), merged_state(repo, commits, stem, ma, resolutions)
        good = (st == "UNSIGNED") and mg in ("NOT-MERGED", "NO-COMMITS")
        lines.append((stem, st, mg, "ok(after)" if good else "BLOCKER"))
        if not good:
            blockers.append("%s (after --until): reader=%s merged=%s" % (stem, st, mg))

    if verbose:
        print()
        print("%-44s %-10s %-12s %s" % ("ROW", "READER", "MASTER", ""))
        print("-" * 86)
        for stem, st, mg, verdict in lines:
            print("%-44s %-10s %-12s %s" % (stem[:44], st, mg, verdict))
        print("-" * 86)
        signed = sum(1 for _s, st, _m, _v in lines if st == "SIGNED")
        merged = sum(1 for _s, _st, mg, _v in lines if mg == "MERGED")
        # ⛔ NON-VACUITY: the counts are printed so "0 blockers" over 0 rows is visible.
        print("rows checked %d   signed %d   merged %d   through --until %s"
              % (len(lines), signed, merged, until))
        if blockers:
            print("⛔ %d BLOCKER(S):" % len(blockers))
            for b in blockers:
                print("   %s" % b)
        else:
            print("✅ CLEAN — every row through --until is SIGNED and on master; "
                  "every row after it is UNSIGNED and absent.")
    return (BLOCKED if blockers else OK), blockers


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-54s -> %-9s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    ma = _load("merge_all")
    names = [u[0] for u in ma.UNITS]
    show("the real UNITS list is non-empty (non-vacuity)", len(names) > 40, True)
    h, t = rows_through(ma.UNITS, "e-cp9-build-record")
    show("--until splits the list", (h is not None and len(h) + len(t) == len(ma.UNITS)), True)
    show("...and --until names row 15", len(h), 15)
    h2, _ = rows_through(ma.UNITS, "no-such-row")
    show("an unknown --until is UNREADABLE, not an empty pass", h2, None)

    # ⛔ FIXTURES, not the live tree: the live tree is entirely UNSIGNED and NOT-MERGED, so
    # it can only ever demonstrate one of the four states this tool distinguishes.
    import tempfile, shutil
    box = pathlib.Path(tempfile.mkdtemp(prefix="sv-"))
    try:
        g = box / "gates"; g.mkdir()
        signed = ("APPROVED BY:      Patrick\nAPPROVED ON:      2026-09-17\n"
                  "APPROVED AT SHA:  abc123def\nSCOPE APPROVED:   CP1 ONLY\n")
        unsigned = "APPROVED BY:\nAPPROVED ON:\nAPPROVED AT SHA:\nSCOPE APPROVED:\n"
        (g / "row-a.md").write_text("# a\n\n```\n" + signed + "```\n", encoding="utf-8")
        (g / "row-b.md").write_text("# b\n\n```\n" + unsigned + "```\n", encoding="utf-8")
        sg = _load("sign_gate")
        sa = sg.read_approval((g / "row-a.md").read_text(encoding="utf-8"))[0]
        sb = sg.read_approval((g / "row-b.md").read_text(encoding="utf-8"))[0]
        show("the fixture's signed packet reads SIGNED", sa, "SIGNED")
        show("the fixture's empty packet reads UNSIGNED", sb, "UNSIGNED")
        # a signed row with no commits, and an unsigned row after it -> CLEAN
        u = [("row-a", [], False), ("row-b", [], False)]
        rc, _b = verify("row-a", units=u, gates=g, verbose=False)
        show("signed-through + unsigned-after -> CLEAN", rc, OK)
        # the row through --until is NOT signed -> BLOCKER
        u2 = [("row-b", [], False), ("row-a", [], False)]
        rc2, b2 = verify("row-b", units=u2, gates=g, verbose=False)
        show("a row through --until that is UNSIGNED -> BLOCKER", rc2, BLOCKED)
        show("...and a row after --until that IS signed is named too", len(b2), 2)
    finally:
        shutil.rmtree(box, ignore_errors=True)

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--until", default=None)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    if not a.until:
        print("⛔ --until <row> is required. It is the sitting boundary being verified.")
        return UNREADABLE
    rc, _ = verify(a.until)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
