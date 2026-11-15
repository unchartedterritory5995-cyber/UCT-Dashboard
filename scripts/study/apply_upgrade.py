"""Merge an overbuild upgrade into a course unit file, then run the mechanical validator on the result.

    python -m scripts.study.apply_upgrade UNIT_FILE UPGRADE_JSON [UPGRADE_JSON ...] [--check CHECK_JSON ...]
                                          [--batch NAME] [--out PATH | --write]

UNIT_FILE     docs/study/courses/<track>/<unit>.json (never modified unless --write)
UPGRADE_JSON  {"questions": {"<key>": {simple, why, lesson_line, deeper, tier, risk, depends_on, choices, wrong, ...}},
               "cut": ["<key>", ...], "new_questions": [{full question}], "new_facts": [{id, source, quote, claim}],
               "new_sources": [{id, tier, publisher, title, url, accessed}]}
              from a Writer or a Resolver. Only the fields present are applied; `wrong` is merged, not replaced; later
              files override earlier ones. New facts and sources are added when their id is not already in the lesson;
              a new question is added when its key is not already there (a house fact quotes the owner's rulebook).
CHECK_JSON    {"questions": {"<key>": {"status": "pass|fix|cut", "notes": "...", "fix": {fields}}}} from a cold checker.
              A fix's "chart": null removes the question's chart (a chart the bars contradict).
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
          "facts", "answer", "sentence", "bank", "prefix", "suffix", "order", "calc", "chart", "visual")


#: owner 2026-11-12 ("make it a multiple choice"; standing rule 4 in docs/study/REVIEW_LEARNINGS.md): a typed-number
#: question may become a multiple-choice one. 2026-11-14 (the visuals plan): a multiple-choice question may become a
#: scenario, the same four choices with a story on screen, which is how a chart question says what the chart shows (a
#: story reaches the member only on a scenario). Any other `format` in an upgrade is ignored.
FORMAT_CHANGES = {("numeric", "mcq"), ("mcq", "scenario")}


def _set_fields(q: dict, up: dict) -> list[str]:
    changed = []
    if up.get("format") and up["format"] != q.get("format") and (q.get("format"), up["format"]) in FORMAT_CHANGES:
        q["format"] = up["format"]
        changed.append("format")
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


def apply(doc: dict, upgrades: dict, batch: str, checks: dict | None = None, extra: dict | None = None) -> list[str]:
    """Mutate `doc`; return notes about anything that could not be applied. `extra` holds cut / new_* lists."""
    notes: list[str] = []
    extra = extra or {}
    for src in extra.get("new_sources") or []:
        if src.get("id") not in {x.get("id") for x in doc.get("sources") or []}:
            doc.setdefault("sources", []).append(src)
    for fact in extra.get("new_facts") or []:
        if fact.get("id") not in {x.get("id") for x in doc.get("facts") or []}:
            doc.setdefault("facts", []).append(fact)
    have = {q["key"] for q in doc["questions"]}
    for nq in extra.get("new_questions") or []:
        if nq.get("key") in have:
            notes.append(f"{nq.get('key')}: new question skipped, the key already exists")
        else:
            nq = dict(nq)
            nq["batch"] = batch
            doc["questions"].append(nq)
            have.add(nq["key"])
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
                fx = dict(ck["fix"])
                # a checker sometimes ships the fact its fix cites inside the fix itself: add it to the lesson
                embedded = ([fx.pop("new_fact")] if isinstance(fx.get("new_fact"), dict) else []) + list(fx.pop("new_facts", None) or []) + list(fx.pop("add_facts", None) or [])
                fx.pop("new_fact", None)
                have = {x.get("id") for x in doc.get("facts") or []}
                for fact in embedded:
                    if isinstance(fact, dict) and fact.get("id") and fact["id"] not in have:
                        doc.setdefault("facts", []).append(fact)
                        have.add(fact["id"])
                fx.pop("house", None)          # a checker never marks a question as resting on the house rules
                # a checker may DROP a chart the bars contradict: `"chart": null` in its fix removes it (2026-11-14: two
                # checkers had to edit the writer's file instead, because a null field is otherwise ignored)
                if "chart" in fx and fx["chart"] is None:
                    fx.pop("chart")
                    q.pop("chart", None)
                # and a picture card that misreads the question: `"visual": null` removes it (2026-11-15)
                if "visual" in fx and fx["visual"] is None:
                    fx.pop("visual")
                    q.pop("visual", None)
                _set_fields(q, fx)
            verify[key] = {"status": "pass", "by": "checker", "fixed": True, "notes": text}
        elif status == "pass":
            verify[key] = {"status": "pass", "by": "checker", "fixed": False, "notes": text}
        else:
            notes.append(f"{key}: unknown check status {status!r}")
    # cuts are applied LAST: a question that is cut stays cut even when an earlier layer upgraded or passed it
    for key in extra.get("cut") or []:
        if key in by_key:
            verify[key] = {"status": "cut", "by": "writer", "fixed": False, "notes": f"cut in {batch}: see the resolver's notes"}
        else:
            notes.append(f"{key}: cut but not in the lesson, skipped")
    return notes


def _load(path: str) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8-sig"))


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
    extra: dict = {"cut": [], "new_questions": [], "new_facts": [], "new_sources": []}
    for u in a.upgrades:
        blob = _load(u)
        for k, v in (blob.get("questions") or {}).items():
            ups[k] = {**ups.get(k, {}), **v}      # later files override earlier ones, field by field
        for name in extra:
            extra[name].extend(blob.get(name) or [])
    cks: dict = {}
    for c in a.check:
        cks.update(_load(c).get("questions") or {})
    notes = apply(doc, ups, a.batch, cks, extra)
    problems = cl.unit_problems(doc)
    for n in notes:
        print("note:", n)
    for p in problems:
        print("problem:", p)
    dest = pathlib.Path(a.unit) if a.write else pathlib.Path(a.out) if a.out else None
    if dest is not None:
        dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="")
        print(f"wrote {dest}")
    print(f"{doc['unit']}: {len(ups)} upgraded, {len(extra['new_questions'])} new, {len(extra['cut'])} cut, {len(cks)} checked, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
