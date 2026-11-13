"""Build the Study course units (docs/study/courses/<track>/<unit>.json) into the bank and the skill map.

  python -m scripts.study.gen_courses --check [FILE ...]   # validate only; prints every problem, exit 1 on any
  python -m scripts.study.gen_courses                      # validate, then write the bank + the skill map

Writes:
  * docs/study/bank/course.<track>.json: every question the cold checker PASSED (verify.<key>.status == "pass"),
    as draft items (the owner approves on the StudyReview screen; nothing goes live unreviewed);
  * docs/study/skill_map.json: each unit laid onto its Foundations track (replacing a unit with the same id, keeping
    every other unit). A unit with no approved items stays locked on the member's map (GET /api/study/map counts).

The contract is docs/study/courses/README.md.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

from scripts.study._common import BANK_DIR, REPO
from scripts.study import courses_lib as cl

SKILL_MAP = REPO / "docs" / "study" / "skill_map.json"


def check(paths: list[pathlib.Path]) -> int:
    bad = 0
    for p in paths:
        doc = cl.load_unit(p)
        probs = cl.unit_problems(doc, path=p)
        v = doc.get("verify") or {}
        status = {s: sum(1 for x in v.values() if (x or {}).get("status") == s) for s in cl.VERIFY_STATUSES}
        head = f"{p.relative_to(REPO)}: {len(doc.get('questions') or [])} questions, verify {status}"
        if probs:
            bad += 1
            print(f"FAIL {head}")
            for x in probs:
                print(f"   - {x}")
        else:
            print(f"ok   {head}")
    return 1 if bad else 0


def _unit_entry(doc: dict, n_items: int) -> dict:
    return {"id": doc["unit"], "title": doc["title"], "skills": [s["id"] for s in doc["skills"]], "lessons": [],
            "modules": [doc["track"]], "supply": "authored", "est_questions": n_items,
            "course_file": f"docs/study/courses/{doc['track']}/{doc['unit']}.json"}


def build(paths: list[pathlib.Path]) -> None:
    by_track: dict[str, list[dict]] = {}
    units: dict[str, list[dict]] = {}
    for p in paths:
        doc = cl.load_unit(p)
        items = cl.strip_private(cl.build_items(doc, only_passed=True))
        by_track.setdefault(doc["track"], []).extend(items)
        if items:
            units.setdefault(doc["track"], []).append(_unit_entry(doc, len(items)))
    for track, items in sorted(by_track.items()):
        out = BANK_DIR / f"course.{track.lower()}.json"
        items.sort(key=lambda it: it["source_ref"])
        out.write_text(json.dumps(items, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8",
                       newline="\n")
        print(f"wrote {out.relative_to(REPO)}: {len(items)} items")
    m = json.loads(SKILL_MAP.read_text(encoding="utf-8"))
    curricula = m["curricula"] if isinstance(m["curricula"], list) else list(m["curricula"].values())
    # a unit lands on the track with its id in whichever curriculum holds it (Foundations F*/V, the Method's SET)
    for tr in (t for c in curricula for t in c.get("tracks") or []):
        new = {u["id"]: u for u in units.get(tr["id"], [])}
        if not new:
            continue
        # a planned entry's lesson door (the Method's `uct-method:` lesson keys) survives the unit being authored
        for old_u in tr.get("units") or []:
            if old_u.get("id") in new and old_u.get("lessons") and not new[old_u["id"]].get("lessons"):
                new[old_u["id"]]["lessons"] = list(old_u["lessons"])
        kept = [u for u in tr.get("units") or [] if u.get("id") not in new]
        tr["units"] = sorted(kept + list(new.values()), key=lambda u: [int(x) if x.isdigit() else x
                                                                     for x in u["id"].replace("b.", ".").split(".")])
        print(f"skill map: {tr['id']} now has {len(tr['units'])} units")
    SKILL_MAP.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="validate only")
    ap.add_argument("files", nargs="*", help="unit files (default: every file under docs/study/courses)")
    a = ap.parse_args(argv)
    paths = [pathlib.Path(f).resolve() for f in a.files] if a.files else cl.unit_files()
    rc = check(paths)
    if a.check or rc:
        return rc
    build(cl.unit_files())
    return 0


if __name__ == "__main__":
    sys.exit(main())
