"""UCT Agent program — does this branch only touch paths its session owns?

  python tools/agent_ownership_check.py --as agent-md                 # this branch's own commits vs origin/agent/int
  python tools/agent_ownership_check.py --as agent-sc --base origin/agent/int
  python tools/agent_ownership_check.py --as agent-qa --files a.py b.js   # explicit list (tests, CI)

The ownership table is the fenced ```ownership block in docs/agent/program/OWNERSHIP.md:
one `<glob>  <owner>` per line, LAST MATCH WINS (as in CODEOWNERS), `**` crosses directories.
A changed file is:
  ok        owned by --as
  FOREIGN   owned by another session          -> exit 1 (ask that owner / agent-lead)
  EXTERNAL  outside the Agent program's paths -> exit 1 unless --allow-external (lead approval)
Stdlib only; never writes anything.
"""
from __future__ import annotations

import argparse
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OWNERSHIP = REPO / "docs" / "agent" / "program" / "OWNERSHIP.md"
EXTERNAL = "external"


def load_table(path: Path = OWNERSHIP) -> list[tuple[str, str]]:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"```ownership\n(.*?)```", text, re.S)
    if not m:
        raise SystemExit(f"no ```ownership block in {path}")
    rows = []
    for line in m.group(1).splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        glob, owner = line.split()
        rows.append((glob, owner))
    return rows


def _match(glob: str, path: str) -> bool:
    # `**/` may match zero directories; fnmatch's `*` already crosses `/`
    return fnmatch.fnmatchcase(path, glob) or ("**/" in glob and fnmatch.fnmatchcase(path, glob.replace("**/", "")))


def owner_of(path: str, table: list[tuple[str, str]]) -> str:
    path = path.replace("\\", "/")
    found = EXTERNAL
    for glob, owner in table:
        if _match(glob, path):
            found = owner
    return found


def changed_files(base: str, cwd: Path = REPO) -> list[str]:
    """The files THIS branch's own commits touch: every non-merge commit reachable from HEAD but not from
    `base`. Not `git diff base...HEAD` — with a criss-cross history (the author merged `base` in while the
    integrator merged the branch's earlier head) that picks one of several merge bases and reports files
    that arrived BY MERGE from `base` as the author's own (agent-qa F-9). Merge commits are skipped: they
    carry other people's work in; a conflict resolution inside one is reviewed in the PR diff."""
    out = subprocess.run(["git", "log", "--no-merges", "--format=", "--name-only", f"{base}..HEAD"],
                         cwd=cwd, capture_output=True, text=True, check=True)
    return sorted({f for f in out.stdout.splitlines() if f.strip()})


def check(files: list[str], me: str, table: list[tuple[str, str]], allow_external: bool = False) -> tuple[int, list[str]]:
    lines, bad = [], 0
    for f in files:
        o = owner_of(f, table)
        if o == me:
            lines.append(f"  ok        {f}")
        elif o == EXTERNAL:
            lines.append(f"  EXTERNAL  {f}   (outside the Agent program — needs agent-lead approval)")
            bad += 0 if allow_external else 1
        else:
            lines.append(f"  FOREIGN   {f}   (owned by {o})")
            bad += 1
    return bad, lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--as", dest="me", required=True, help="your session name, e.g. agent-md")
    ap.add_argument("--base", default="origin/agent/int")
    ap.add_argument("--files", nargs="*")
    ap.add_argument("--allow-external", action="store_true")
    a = ap.parse_args(argv)
    table = load_table()
    owners = {o for _, o in table}
    if a.me not in owners:
        print(f"unknown session {a.me!r}; known: {', '.join(sorted(owners))}")
        return 2
    files = a.files if a.files is not None else changed_files(a.base)
    bad, lines = check(files, a.me, table, a.allow_external)
    print(f"ownership check as {a.me}: {len(files)} file(s), {bad} problem(s)")
    print("\n".join(lines))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
