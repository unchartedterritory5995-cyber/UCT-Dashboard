"""Harvest every registered follow-up id from the program doc tree.

⛔ AN ID CENSUS IS A COUNT, AND A COUNT IS THE WRONG INSTRUMENT WHEN THE
POPULATION IS MEANT TO CHANGE. This prints NAMES with their sites, never a
total on its own, so a follow-up that stops appearing is visible as a missing
name rather than as a number that moved.

⚠️ Prose is NOT stripped here, deliberately, and that is the inverse of this
repo's usual rule: a follow-up id lives in prose by construction. The cost is
that a mention inside a tombstone counts as a site — which is correct, because
a tombstone IS where a retired id should still be findable.

    python tools/harvest_followups.py [--json] [--scope terminal-next|all]
    python tools/harvest_followups.py --self-check

⛔⛔ TWO PROGRAMMES SHARE ONE `F-<TAG>-<N>` NAMESPACE UNDER THIS SAME DOC TREE.
Found 2026-09-20 (COMPLETION_AUDIT.md §0): a re-run of this tool returned 128
distinct `F-*` ids where the 32-system TERMINAL-NEXT roster (the one this file
and COMPLETION_AUDIT.md track) had registered 34. The other 94 belong to a
second, unrelated remediation programme living under the SAME `docs/terminal-
research/` tree — its own gate packets (`packet-a`…`packet-v`), its own build
records (bare `d-cp*`, `e-cp*` up to 38, `k-cp*` up to 20, `t-cp*`, `t2-cp*` —
note the bare, undecorated `d-cp*` is THAT programme's "D" codename, distinct
from THIS programme's numbered `d2-cp*`/`d3-cp*`/`d4-cp*`/`d5-cp*` build
records), and its own session log (`reports/SESSION_REPORT_*.md`, 2026-09-14
onward — confirmed by content: "F-MERGE-1 CLOSED", `weekly_exec.py`, CI-queue
language that names no TERMINAL-NEXT system). Neither programme's ids collide
in VALUE, only in NAMESPACE — the two registers simply were never told about
each other.

**`--scope terminal-next` (the default) excludes the other programme's known
paths** via `_OTHER_PROGRAMME_PATTERNS` below, so a bare invocation answers
"how many F-* ids does THIS roster carry" — the question COMPLETION_AUDIT.md
actually wants answered. `--scope all` disables the exclusion for a genuine
whole-tree sweep (e.g. auditing the other programme itself, or re-deriving
this exclusion list when new other-programme files appear).
"""
from __future__ import annotations

import argparse
import collections
import fnmatch
import json
import pathlib
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "terminal-research"

#: Relative-path glob patterns (matched with fnmatch against the POSIX path
#: under DOCS) that belong to the OTHER, unrelated remediation programme, not
#: to the 32-system TERMINAL-NEXT roster. See the module docstring for the
#: evidence each pattern is based on. A file matching NONE of these is treated
#: as TERMINAL-NEXT's by default — this list names exclusions, not inclusions,
#: so a genuinely new TERMINAL-NEXT file is never silently dropped by it.
_OTHER_PROGRAMME_PATTERNS = (
    "12-decisions/gates/packet-*.md",
    "12-decisions/gates/e-cp*-build-record.md",
    "12-decisions/gates/k-cp*-build-record.md",
    "12-decisions/gates/t-cp*-build-record.md",
    "12-decisions/gates/t2-cp*-build-record.md",
    "12-decisions/gates/d-cp*-build-record.md",  # bare "d" only — d2/d3/d4/d5 are ours
    # ⭐ The other programme also owns several UN-NUMBERED top-level paths,
    # distinct from TERMINAL-NEXT's own 00-program-control … 13-executive-
    # synthesis tree: its own merge-queue tracker, signing log, delegation
    # prompts, per-checkpoint resolution files, and session-by-session reports.
    # `verification/` is NOT excluded — checked directly (only one dated
    # subdirectory, 2026-09-14, holding genuine TERMINAL-NEXT artifacts already
    # cited by COMPLETION_AUDIT.md/OWNER_INPUTS_REQUESTED.md as their own
    # evidence) — it is entirely ours, not mixed.
    "POST_MERGE_QUEUE.md",
    "SIGNING_SESSION.md",
    # ⛔ `GOVERNING_PRINCIPLES.md` was checked here and REMOVED: it is
    # `00-program-control/GOVERNING_PRINCIPLES.md`, TERMINAL-NEXT's own charter
    # compression ("GOVERNING PRINCIPLES — Terminal-Next research program"),
    # not the other programme's. F-MERGE-1 registered there is a genuine
    # TERMINAL-NEXT id that coincidentally shares a naming prefix with the
    # other programme's unrelated F-MERGE-2/F-MERGE-3 (registered in
    # resolutions/, excluded below) — two programmes independently picked the
    # same word, not the same id.
    "findings/*.md",
    "prompts/*.md",
    "reports/*.md",
    "resolutions/*.md",
)


def _is_other_programme(rel: str) -> bool:
    return any(fnmatch.fnmatch(rel, pat) for pat in _OTHER_PROGRAMME_PATTERNS)

_RXW = chr(92) + "w"
_RXB = chr(92) + "b"
_RXD = chr(92) + "d"

#: Every id family this programme has ever used. Built by concatenation — a
#: literal word-boundary escape has twice become a 0x08 byte through a heredoc
#: in this repo, and a pattern ending in a control character matches NOTHING.
PATTERNS = {
    # ⚰️ This was "F-[A-Z0-9]+-[A-Z0-9]+", which matched only TWO segments and
    # silently truncated every three-segment id: F-S7-RC-4 harvested as F-S7-RC,
    # so four real follow-ups became four phantom ones with the same name. The
    # self-check caught it because it names ids it KNOWS exist.
    "F":   "F-[A-Z0-9]+(?:-[A-Z0-9]+)+" + _RXB,     # F-S7-3, F-D2-1, F-S7-RC-4
    "H":   "H" + _RXD + "+" + _RXB,                  # H4, H14, H15
    "OI":  "OI-" + _RXD + "+[a-z()]*",               # OI-03, OI-06, OI-03(a)
    "DEC": "DEC-" + _RXD + "+",                      # DEC-13, DEC-14
    "RG":  "RG-[A-Z0-9-]+" + _RXB,
    "TD":  "TD-" + _RXD + "+",                       # tech-debt-register rows
    "G":   "G" + _RXD + "+" + _RXB,                  # G1, G5 (D1 gaps)
    "R":   "R-" + _RXD + "+",                        # R-05, R-27 rules
}


def harvest(scope: str = "terminal-next") -> dict[str, dict[str, list[str]]]:
    out: dict[str, dict[str, list[str]]] = collections.defaultdict(
        lambda: collections.defaultdict(list))
    files = sorted(DOCS.rglob("*.md"))
    if len(files) < 50:
        raise SystemExit(f"⛔ BROKEN: only {len(files)} docs under {DOCS}")
    excluded = 0
    for p in files:
        rel = p.relative_to(DOCS).as_posix()
        if scope == "terminal-next" and _is_other_programme(rel):
            excluded += 1
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        for fam, pat in PATTERNS.items():
            for m in set(re.findall(pat, text)):
                out[fam][m].append(rel)
    if scope == "terminal-next" and excluded == 0:
        # ⛔ NON-VACUITY: if the exclusion patterns ever stop matching anything
        # (files renamed/moved), `--scope terminal-next` silently degrades into
        # `--scope all` and the namespace collision this exists to prevent comes
        # back with no warning. Fail loudly instead of reporting a clean count.
        raise SystemExit(
            "⛔ BROKEN: --scope terminal-next excluded 0 files — "
            "_OTHER_PROGRAMME_PATTERNS matches nothing; re-derive it")
    return {k: dict(v) for k, v in out.items()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--scope", choices=("terminal-next", "all"), default="terminal-next",
                    help="terminal-next (default) excludes the other programme's known "
                         "paths; all disables the exclusion for a whole-tree sweep")
    a = ap.parse_args()

    if a.self_check:
        ok = True
        h_scoped = harvest(scope="terminal-next")
        h_all = harvest(scope="all")
        # CONTROL 1 — ids this programme certainly registered must be found,
        # in BOTH scopes.
        must = [("F", "F-S7-3"), ("F", "F-D2-1"), ("F", "F-S7-RC-4"),
                ("H", "H14"), ("OI", "OI-06"), ("DEC", "DEC-13")]
        for fam, i in must:
            if i not in h_scoped.get(fam, {}):
                print(f"  ⛔ known TERMINAL-NEXT id NOT found under terminal-next scope: {i}"); ok = False
            if i not in h_all.get(fam, {}):
                print(f"  ⛔ known TERMINAL-NEXT id NOT found under all scope: {i}"); ok = False
        # CONTROL 2 — an id that cannot exist must NOT be found.
        if "F-ZZZ-999" in h_scoped.get("F", {}):
            print("  ⛔ the matcher invented an id"); ok = False
        # CONTROL 3 — no pattern may contain a control byte.
        for fam, pat in PATTERNS.items():
            if "\x08" in pat:
                print(f"  ⛔ pattern {fam} carries a 0x08 byte"); ok = False
        # CONTROL 4 — the other programme's own id must be excluded under the
        # default scope, and it must actually be findable under --scope all
        # (proving the exclusion, not an absent id, is what hid it).
        # ⛔ F-CI-2 is NOT usable as this control: it is legitimately MENTIONED
        # in COMPLETION_AUDIT.md's own prose (describing this very collision),
        # and the tool deliberately does not strip prose (module docstring).
        # F-CI-11 is registered ONLY inside the other programme's own build
        # records/session reports — never mentioned by any TERMINAL-NEXT file.
        if "F-CI-11" in h_scoped.get("F", {}):
            print("  ⛔ other-programme id F-CI-11 LEAKED into terminal-next scope"); ok = False
        if "F-CI-11" not in h_all.get("F", {}):
            print("  ⛔ CONTROL FAILED: F-CI-11 absent even under --scope all — "
                  "the exclusion test proves nothing"); ok = False
        print("SELF-CHECK:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    h = harvest(scope=a.scope)

    if a.json:
        print(json.dumps(h, indent=2, sort_keys=True))
        return 0

    print(f"[harvest] scope={a.scope}"
          + ("" if a.scope == "all" else
             " (other-programme paths excluded; pass --scope all to include them)"))
    for fam in sorted(h):
        ids = h[fam]
        print(f"\n=== {fam}  ({len(ids)} distinct ids) ===")
        for i in sorted(ids):
            sites = ids[i]
            print(f"  {i:<16} {len(sites):>2} site(s)   {sites[0]}"
                  + ("" if len(sites) == 1 else f"  (+{len(sites)-1})"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
