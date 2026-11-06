"""Restore the owner's pass-2 grades (2026-10-24, Kicker pass 2 + Oops pass 2) on the pod.

The 2026-11-05 dry run of reapprove_refreshed_setups_pod.py showed these fifteen lessons carrying
his note but no example_grade. apply_verdicts_pod.py graded them on 2026-10-24 (~15:45), and a
full bank re-import later that afternoon ran through the OLD upsert_items, which wrote every
content field, reveal_json included, on every row it sent, so the grades went with it; the notes
came after that import (owner_notes_pod.py) and survived, as did every grade given from pass 3 on.
PR #819 fixed upsert_items (a same-version re-import carries example_grade; a higher pod version is
kept untouched), so this cannot recur. The grades below are the owner's, recorded verbatim in
docs/study/audits/2026-10-24/owner_verdicts.jsonl (the latest row per chart).

study_store.review(..., "grade") merges example_grade into reveal_json and touches neither the
review status nor the version. A lesson that already carries the same grade is skipped; one that
carries a DIFFERENT grade is printed and left alone. The script also lists every other unretired
setups lesson without a grade, with its status, so nothing else is missing silently (levels drafts
and unruled drafts have none by design). Dry run unless APPLY is True. Idempotent.

Run on the pod with the scratchpad runner (the script is piped to the pod's python):
  powershell -File run_pod_py.ps1 -Script restore_pass2_grades_DRY.py     (APPLY = False)
  powershell -File run_pod_py.ps1 -Script restore_pass2_grades_APPLY.py   (APPLY = True)
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa: E402

APPLY = False
BY = "owner"
K, O = "setup.family3.kicker", "setup.family4.oops"
GRADES = {
    (K, "IMAX", "2026-02-26"): "okay",
    (K, "ISRG", "2025-01-15"): "okay",
    (K, "JBI", "2023-12-14"): "great",
    (K, "RCUS", "2026-06-22"): "good",
    (K, "VTRS", "2024-11-07"): "good",
    (O, "IMNM", "2026-01-15"): "okay",
    (O, "LPG", "2023-01-19"): "okay",
    (O, "LQDA", "2023-06-15"): "good",
    (O, "MATX", "2026-05-05"): "okay",
    (O, "ORIC", "2024-01-17"): "great",
    (O, "SEI", "2025-07-29"): "good",
    (O, "TVTX", "2024-09-04"): "okay",
    (O, "VERX", "2024-11-05"): "good",
    (O, "VG", "2020-12-10"): "good",
    (O, "WFRD", "2022-06-07"): "good",
}
REASON = ("grade restored 2026-11-05 from owner_verdicts.jsonl: the owner's 2026-10-24 pass-2 grade was erased by a "
          "bank re-import that day (the old upsert_items wrote reveal_json on every row it sent)")

db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = con.execute(
    "SELECT id, skill_id, sym, asof, review_status, version, reveal_json FROM study_items "
    "WHERE source_ref LIKE '%setup_examples.json%' AND retired_at IS NULL ORDER BY skill_id, sym, asof").fetchall()
con.close()
by_key = {(r["skill_id"], r["sym"], r["asof"]): r for r in rows}


def grade_of(r):
    try:
        return (json.loads(r["reveal_json"] or "{}") or {}).get("example_grade")
    except ValueError:
        return None


plan, left = [], []
for key, g in GRADES.items():
    r = by_key.get(key)
    if r is None:
        left.append((key, "not on the pod"))
        continue
    cur = grade_of(r)
    if cur == g:
        left.append((key, f"already {g}"))
    elif cur:
        left.append((key, f"pod says {cur}, the log says {g}: left alone"))
    else:
        plan.append((r, g))
print("to grade:", len(plan), "| left:", len(left))
for r, g in plan:
    print(f"  plan  {r['skill_id']:28} {r['sym']:5} {r['asof']} v{r['version']} {r['review_status']:9} -> {g}")
for key, why in left:
    print(f"  LEFT  {key[0]:28} {key[1]:5} {key[2]}: {why}")
others = [r for r in rows if r["review_status"] != "rejected" and not grade_of(r)
          and (r["skill_id"], r["sym"], r["asof"]) not in GRADES]
print("other unretired lessons without a grade:", len(others))
for r in others:
    print(f"  none  {r['skill_id']:28} {r['sym']:5} {r['asof']} v{r['version']} {r['review_status']}")
if not APPLY:
    print("DRY RUN: nothing written. The APPLY copy writes the", len(plan), "planned grades.")
    sys.exit(0)
n = 0
for r, g in plan:
    out = ss.review(r["id"], "grade", BY, reason=REASON, after=g)
    n += 1
    got = (out["item"].get("reveal_json") or {}).get("example_grade") if isinstance(out["item"].get("reveal_json"), dict) else "?"
    print("graded", r["skill_id"], r["sym"], r["asof"], "->", got, "| status", out["item"].get("review_status"))
print("done: graded", n)
