"""Apply the owner's 2026-10-25 verdict on the owner-chosen WVE 2024-10-16 HVE (great) on the pod. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa
BY = "owner"; H = "setup.family3.hve"
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, review_status, lesson_text from study_items where skill_id=? and sym='WVE' and asof='2024-10-16' "
                   "and source_ref like '%setup_examples.json%'", (H,)).fetchall()
print("items", len(rows))
for iid, status, lesson in rows:
    note = "Owner's note: great. The second surge, not the first: this is the day that dwarfs everything before it, and that close becomes the level."
    if "Owner's note:" not in (lesson or ""):
        ss.review(iid, "fix", BY, reason="owner's nuance, HVE pass-3 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason="owner: keep (great), the second surge he preferred over 2024-09-24")
    ss.review(iid, "grade", BY, reason="owner: great", after="great")
    print("approve WVE 2024-10-16 great")
