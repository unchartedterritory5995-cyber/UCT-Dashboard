"""THE BARS RAILS THE MASTER DEPLOY GATE RUNS: one declared list, derived from named patterns.

WHY (2026-11-17). Bars are the CRITICAL path (CLAUDE.md "Bars Freshness & Reliability Architecture ...
do not regress"), and `tests/test_bar_contract.py` sat red on master for a day with nobody told: its
heal rails read the wall clock behind a pinned seam and went red on a DATE, not a commit, and no
gate ran the file. The `bars-rails` job of `.github/workflows/master-deploy-gate.yml` now runs, as
its own parallel job, every file this tool prints.

THE LIST IS DERIVED, NEVER HAND-KEPT ALONE:
  * every file matching `PATTERNS` (`tests/test_bars_*.py`, `tests/test_bar_*.py`), so a new bars
    rail is gated the day it lands;
  * plus the bars rails named outside those patterns (`NAMED`);
  * minus `EXCLUDED`, each BY NAME with the reason it is not gated (red on a clean runner, and why);
    an exclusion is a visible debt, never a silent gap.
`REQUIRED` names the files the gate may never lose. `tests/test_bars_deploy_gate.py` (itself matched
by the pattern) rails all of it: the job, its place in the verdict, and `problems()` empty.

Usage:
    python tools/bars_gate_rails.py            # the gated files, space-separated (exit 1 on a problem)
    python tools/bars_gate_rails.py --check    # the problems, one per line (exit 1 if any)
Pure stdlib: it reads file names only and never imports `api.*`.
"""
from __future__ import annotations

import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]

PATTERNS = ("tests/test_bars_*.py", "tests/test_bar_*.py")
NAMED = ("tests/test_index_developing_bar.py", "tests/test_intraday_tail_currentness.py",
         # 2026-11-20 (#2261): the D2 address book re-derives `bars_sqlite.py`'s own DDL and delta queries, and three
         # bar-store changes (05ff3d9bd9, #1102, #1098) left it red for 11 days with no lane running it
         "tests/test_canonical_address_book.py")
REQUIRED = ("tests/test_bar_contract.py", "tests/test_bars_server_include_today.py",
            "tests/test_index_developing_bar.py", "tests/test_intraday_tail_currentness.py")
#: path -> why it is not gated. Each one is red on a clean runner (`tools/remote_tests.py`), named here so
#: the gap is read in review rather than discovered later; fix the file, then delete its line.
#: ⚰️ tests/test_bars_ordinal_census.py stood here (2026-11-17 -> 11-20): the census recorded the LINE NUMBER of every
#: bars-reader call site and the count of modules walked, so an unrelated edit made it stale. Since schema 2 it records
#: only which modules call the bars family and how they read it (`bars_ordinal_census.stable`), and it is gated.
EXCLUDED: dict[str, str] = {}


def _rel(p: pathlib.Path, root: pathlib.Path) -> str:
    return p.relative_to(root).as_posix()


def matched(root: pathlib.Path = REPO) -> set[str]:
    """Every file the patterns match, plus the named ones that exist."""
    out = {_rel(p, root) for pat in PATTERNS for p in root.glob(pat) if p.is_file()}
    out |= {n for n in NAMED if (root / n).is_file()}
    return out


def gated(root: pathlib.Path = REPO, excluded: dict[str, str] | None = None) -> list[str]:
    ex = EXCLUDED if excluded is None else excluded
    return sorted(matched(root) - set(ex))


def problems(root: pathlib.Path = REPO, excluded: dict[str, str] | None = None) -> list[str]:
    ex = EXCLUDED if excluded is None else excluded
    out: list[str] = []
    files = gated(root, ex)
    if not files:
        out.append("the gated list is empty: pytest with no paths would run the whole tests/ tree")
    for n in NAMED:
        if not (root / n).is_file():
            out.append(f"NAMED file is missing: {n}")
    for r in REQUIRED:
        if r in ex:
            out.append(f"a REQUIRED file is excluded: {r}")
        elif r not in files:
            out.append(f"a REQUIRED file is not gated: {r}")
    every = matched(root)
    for path, why in ex.items():
        if path not in every:
            out.append(f"stale exclusion (no such bars rail): {path}")
        if not (isinstance(why, str) and why.strip()):
            out.append(f"an exclusion without a reason: {path}")
    return out


def main(argv: list[str]) -> int:
    found = problems()
    if "--check" in argv:
        for p in found:
            print(p)
        return 1 if found else 0
    if found:
        for p in found:
            print(f"bars_gate_rails: {p}", file=sys.stderr)
        return 1
    print(" ".join(gated()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
