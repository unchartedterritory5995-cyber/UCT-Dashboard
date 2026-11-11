"""Re-approve the setup-example lessons the owner had APPROVED before the 2026-10-25 definition
refresh (docs/study/audits/2026-10-25/refresh_setup_lessons_pod.py). That refresh went through
study_store.review(..., "fix"), which by design leaves an item in DRAFT for a second look; no second
look followed, so the lessons he approved and graded on 2026-10-24/25 (Launchpad, HVE, Kicker, Oops,
Slingshot) have been draft, and so not served to members, ever since. Found by the 2026-11-05 pod
readback after the PR #819 import (which keeps rows at a higher pod version and so changed nothing here).

Rule: an item is re-approved only when the pod's own audit trail (study_corrections) shows it was
APPROVED when the refresh fix landed (its last approve/reject before the refresh row is an approve)
and no verdict (approve/reject) followed the refresh. A later 'fix' that only added the owner's note
(PANW 2024-02-02, retire_xom_sling_pod.py) does not disqualify it: his verdict was keep. Items that
were draft at the time, or were approved or rejected since, are printed and left alone. The owner's
grade lives in reveal_json.example_grade and is untouched by any of this. Dry run unless APPLY is
True. Idempotent: an approved item is not a draft and is never selected again.

Run on the pod with the scratchpad runner (the script is piped to the pod's python):
  powershell -File run_pod_py.ps1 -Script reapprove_refreshed_setups_DRY.py     (APPLY = False)
  powershell -File run_pod_py.ps1 -Script reapprove_refreshed_setups_APPLY.py   (APPLY = True)
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa: E402

APPLY = False
BY = "owner"
REFRESH_REASON = "definition refreshed to the owner's rulings of 2026-10-23..25 (setup differentiation pass)"
REASON = ("re-approved 2026-11-05: the 2026-10-25 definition refresh (a review fix) left this owner-approved lesson "
          "in draft and no second look followed; the owner's verdict and grade of 2026-10-24/25 stand")

db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
items = con.execute(
    "SELECT id, skill_id, sym, asof, version, review_status, reveal_json FROM study_items "
    "WHERE source_ref LIKE '%setup_examples.json%' AND review_status='draft' AND version > 1 "
    "AND retired_at IS NULL ORDER BY skill_id, sym, asof").fetchall()
plan, left = [], []
for it in items:
    hist = con.execute("SELECT id, action, reason FROM study_corrections WHERE item_id=? ORDER BY id",
                       (it["id"],)).fetchall()
    refresh = [h for h in hist if h["action"] == "fix" and (h["reason"] or "") == REFRESH_REASON]
    if not refresh:
        left.append((it, "no refresh row in its audit trail"))
        continue
    r0 = refresh[0]
    before = [h for h in hist if h["id"] < r0["id"] and h["action"] in ("approve", "reject")]
    after = [h for h in hist if h["id"] > r0["id"] and h["action"] in ("approve", "reject", "fix")]
    if not before or before[-1]["action"] != "approve":
        left.append((it, "was not approved when the refresh landed"))
        continue
    verdicts_after = [h for h in after if h["action"] != "fix"]
    if verdicts_after:
        left.append((it, "a verdict followed the refresh: " + ", ".join(h["action"] for h in verdicts_after)))
        continue
    plan.append((it, [h for h in after if h["action"] == "fix"]))
con.close()


def grade(it):
    try:
        return (json.loads(it["reveal_json"] or "{}") or {}).get("example_grade") or "-"
    except ValueError:
        return "?"


by_skill = {}
for it, _ in plan:
    by_skill[it["skill_id"]] = by_skill.get(it["skill_id"], 0) + 1
print("drafts above version 1:", len(items), "| to re-approve:", len(plan), json.dumps(by_skill, sort_keys=True))
for it, notes in plan:
    extra = ("  (+ a fix after the refresh: " + "; ".join((h["reason"] or "")[:60] for h in notes) + ")") if notes else ""
    print(f"  plan  {it['skill_id']:28} {it['sym']:5} {it['asof']} v{it['version']} grade {grade(it)}{extra}")
for it, why in left:
    print(f"  LEFT  {it['skill_id']:28} {it['sym']:5} {it['asof']} v{it['version']} grade {grade(it)}: {why}")
if not APPLY:
    print("DRY RUN: nothing written. The APPLY copy re-approves the", len(plan), "planned items.")
    sys.exit(0)
n = 0
for it, _ in plan:
    r = ss.review(it["id"], "approve", BY, reason=REASON)
    n += 1
    print("approved", it["skill_id"], it["sym"], it["asof"], "->", r["item"]["review_status"])
print("done: re-approved", n)
