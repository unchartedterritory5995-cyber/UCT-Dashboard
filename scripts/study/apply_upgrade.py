"""Merge an overbuild upgrade into a course unit file, then run the mechanical validator on the result.

    python -m scripts.study.apply_upgrade UNIT_FILE UPGRADE_JSON [UPGRADE_JSON ...] [--check CHECK_JSON ...]
                                          [--batch NAME] [--out PATH | --write]

UNIT_FILE     docs/study/courses/<track>/<unit>.json (never modified unless --write)
UPGRADE_JSON  {"questions": {"<key>": {simple, why, lesson_line, deeper, tier, risk, depends_on, choices, wrong, ...}}}
              from a Writer. Only the fields present are applied; `wrong` is merged, not replaced.
CHECK_JSON    {"questions": {"<key>": {"status": "pass|fix|cut", "notes": "...", "fix": {fields}}}} from a cold checker.
              pass = the checker's pass; fix = apply `fix`, then pass; cut = cut. Without a check the upgraded question
              is marked pass by the writer ("awaiting cold re-read"), which is enough to validate and preview.

Writes to --out (default: <UNIT_FILE stem>.upgraded.json next to the scratch folder you name) or in place with --write.
Prints every validator problem; exit code 1 when there is any. docs/study/OVERBUILD_PLAN.md is the design.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

from scripts.study import courses_lib as cl

#: the fields a Writer or a checker's `fix` may set. Never `key`, `skill`, `rung`, `format`.
FIELDS = ("simple", "why", "lesson_line", "deeper", "tier", "risk", "depends_on", "choices", "wrong", "q", "story",
          "facts", "answer", "sentence", "bank", "prefix", "suffix", "order")


def _set_fields(q: dict, up: dict) -> list[str]:
    changed = []
    for f in FIELDS:
        if f in up and up[f] is not None:
            if f == "wrong":
                q["wrong"] = {**(q.get("wrong") or {}), **up["wrong"]}
            else:
                q[f] = up[f]
            changed.append(f)
    if q.get("choices") and q.get("wrong"):
        q["wrong"] = {k: v for k, v in q["wrong"].items() if k in q["choices"]}
    return changed


def apply(doc: dict, upgrades: dict, batch: str, checks: dict | None = None) -> list[str]:
    """Mutate `doc`; return notes about anything that could not be applied."""
    notes: list[str] = []
    by_key = {q["key"]: q for q in doc["questions"]}
    verify = doc.setdefault("verify", {})
    for key, up in upgrades.items():
        q = by_key.get(key)
        if q is None:
            notes.append(f"{key}: not in the lesson, skipped")
            continue
        _set_fields(q, up)
        q["batch"] = batch
        verify[key] = {"status": "pass", "by": "writer", "fixed": False, "notes": f"upgraded {batch}; awaiting cold re-read"}
    for key, ck in (checks or {}).items():
        q = by_key.get(key)
        if q is None:
            notes.append(f"{key}: checked but not in the lesson, skipped")
            continue
        status = ck.get("status")
        text = str(ck.get("notes") or "")[:600]
        if status == "cut":
            verify[key] = {"status": "cut", "by": "checker", "fixed": False, "notes": text}
        elif status == "fix":
            if isinstance(ck.get("fix"), dict) and ck["fix"]:
                _set_fields(q, ck["fix"])
            verify[key] = {"status": "pass", "by": "checker", "fixed": True, "notes": text}
        elif status == "pass":
            verify[key] = {"status": "pass", "by": "checker", "fixed": False, "notes": text}
        else:
            notes.append(f"{key}: unknown check status {status!r}")
    return notes


def _load(path: str) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("unit")
    ap.add_argument("upgrades", nargs="+")
    ap.add_argument("--check", nargs="*", default=[])
    ap.add_argument("--batch", default="overbuild")
    ap.add_argument("--out")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    doc = _load(a.unit)
    ups: dict = {}
    for u in a.upgrades:
        ups.update(_load(u).get("questions") or {})
    cks: dict = {}
    for c in a.check:
        cks.update(_load(c).get("questions") or {})
    notes = apply(doc, ups, a.batch, cks)
    problems = cl.unit_problems(doc)
    for n in notes:
        print("note:", n)
    for p in problems:
        print("problem:", p)
    dest = pathlib.Path(a.unit) if a.write else pathlib.Path(a.out) if a.out else None
    if dest is not None:
        dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="")
        print(f"wrote {dest}")
    print(f"{doc['unit']}: {len(ups)} upgraded, {len(cks)} checked, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
