"""Harvest every registered follow-up id from the program doc tree.

⛔ AN ID CENSUS IS A COUNT, AND A COUNT IS THE WRONG INSTRUMENT WHEN THE
POPULATION IS MEANT TO CHANGE. This prints NAMES with their sites, never a
total on its own, so a follow-up that stops appearing is visible as a missing
name rather than as a number that moved.

⚠️ Prose is NOT stripped here, deliberately, and that is the inverse of this
repo's usual rule: a follow-up id lives in prose by construction. The cost is
that a mention inside a tombstone counts as a site — which is correct, because
a tombstone IS where a retired id should still be findable.

    python tools/harvest_followups.py [--json]
    python tools/harvest_followups.py --self-check
"""
from __future__ import annotations

import argparse
import collections
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


def harvest() -> dict[str, dict[str, list[str]]]:
    out: dict[str, dict[str, list[str]]] = collections.defaultdict(
        lambda: collections.defaultdict(list))
    files = sorted(DOCS.rglob("*.md"))
    if len(files) < 50:
        raise SystemExit(f"⛔ BROKEN: only {len(files)} docs under {DOCS}")
    for p in files:
        rel = p.relative_to(DOCS).as_posix()
        text = p.read_text(encoding="utf-8", errors="replace")
        for fam, pat in PATTERNS.items():
            for m in set(re.findall(pat, text)):
                out[fam][m].append(rel)
    return {k: dict(v) for k, v in out.items()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()

    h = harvest()

    if a.self_check:
        ok = True
        # CONTROL 1 — ids this programme certainly registered must be found.
        must = [("F", "F-S7-3"), ("F", "F-D2-1"), ("F", "F-S7-RC-4"),
                ("H", "H14"), ("OI", "OI-06"), ("DEC", "DEC-13")]
        for fam, i in must:
            if i not in h.get(fam, {}):
                print(f"  ⛔ known id NOT found: {i}"); ok = False
        # CONTROL 2 — an id that cannot exist must NOT be found.
        if "F-ZZZ-999" in h.get("F", {}):
            print("  ⛔ the matcher invented an id"); ok = False
        # CONTROL 3 — no pattern may contain a control byte.
        for fam, pat in PATTERNS.items():
            if "\x08" in pat:
                print(f"  ⛔ pattern {fam} carries a 0x08 byte"); ok = False
        print("SELF-CHECK:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    if a.json:
        print(json.dumps(h, indent=2, sort_keys=True))
        return 0

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
