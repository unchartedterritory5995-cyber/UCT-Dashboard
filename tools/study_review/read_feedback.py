"""Read the owner's review feedback and print it grouped by what has to change.

    python read_feedback.py [verdicts.jsonl]        (default: C:/Users/pgosz/StudyReview/verdicts/verdicts.jsonl)

The latest line per id wins. Groups: questions to change/remove (by lesson), rules that need work, decisions
changed or to talk over (these also go verbatim into docs/study/audits/2026-10-24/owner_verdicts.jsonl), lesson
notes, general notes; then the tally of reasons. Nothing is written; this only reads.
"""
import json
import os
import sys
from collections import Counter

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join("C:/Users/pgosz/StudyReview", "verdicts", "verdicts.jsonl")
recs = {}
bad = 0
try:
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("id"):
                    recs[r["id"]] = r
            except ValueError:
                bad += 1
except OSError:
    print("no verdicts file yet:", path)
    sys.exit(0)


def kind(r):
    if r.get("kind"):
        return r["kind"]
    i = r["id"]
    return "rule" if i.startswith("rule:") else "decision" if i.startswith("dec:") else "unit" if i.startswith("unit:") else "general" if i.startswith("gen:") else "q"


groups = {"q": [], "rule": [], "decision": [], "unit": [], "general": []}
agreed = Counter()
tally = Counter()
for r in recs.values():
    k = kind(r)
    if r.get("v") == "keep":
        agreed[k] += 1
        continue
    if r.get("v") and k in groups:
        groups[k].append(r)
        tally.update(r.get("tags") or [])


def show(r, label):
    tags = " [" + "; ".join(r.get("tags") or []) + "]" if r.get("tags") else ""
    note = " — " + r["note"] if r.get("note") else ""
    print(f"  {label} {r['id']}{tags}{note}\n      {r.get('q', '')}")


print(f"{len(recs)} records ({bad} damaged lines skipped). Agreed: " + ", ".join(f"{agreed[k]} {k}" for k in groups) + "\n")
for k, title, lab in (("q", "QUESTIONS (apply in the unit file, never the bank; then gen_courses, audit, tests)", None), ("rule", "RULES THAT NEED WORK (edit docs/study/setups/criteria/NN-slug.json)", "RULE"),
                      ("decision", "DECISIONS (record verbatim in owner_verdicts.jsonl, re-key the units on each decision's `conflicts` lines)", None),
                      ("unit", "LESSON NOTES", "LESSON"), ("general", "GENERAL NOTES", "NOTE")):
    if not groups[k]:
        continue
    print("== " + title + f" ({len(groups[k])}) ==")
    for r in sorted(groups[k], key=lambda x: (x.get("unit", ""), x.get("key", ""), x["id"])):
        show(r, lab or {"cut": "REMOVE", "fix": "CHANGE", "ask": "TALK"}.get(r.get("v"), r.get("v", "").upper()))
    print()
if tally:
    print("== WHAT KEEPS COMING UP ==")
    for t, n in tally.most_common():
        print(f"  {n:4d}  {t}")
