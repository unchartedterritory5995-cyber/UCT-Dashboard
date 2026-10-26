"""The owner's "you decide" (2026-10-25) on the two okay pass-1 Slingshots that "can look prettier": retire
XOM 2022-01-25 (a rally drive with no earnings gap behind it, faded back to the trigger inside twenty
sessions; it is a Slingshot by the rule, not by the gallery bar he set, "the ones I labeled perfect or
beautiful"); keep PANW 2024-02-02 as okay with the earnings-risk note (graded B- after that bar was set).
Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, sym, asof, review_status, lesson_text from study_items where skill_id = ? "
                   "and source_ref like '%setup_examples.json%' and retired_at is null and sym in ('XOM','PANW')",
                   ("setup.family4.slingshot",)).fetchall()
for iid, sym, asof, status, lesson in rows:
    if sym == "XOM" and asof == "2022-01-25":
        if status == "rejected":
            print("skip, already rejected", sym, asof); continue
        ss.review(iid, "reject", BY, reason="owner 'you decide' 2026-10-25: a valid Slingshot by the rule but not by the gallery bar "
                  "(perfect or beautiful); no earnings drive, faded back to the trigger inside twenty sessions")
        print("retired", sym, asof)
    if sym == "PANW" and asof == "2024-02-02" and "earnings report" not in (lesson or ""):
        ss.review(iid, "fix", BY, reason="owner's nuance (B-): the earnings-risk lesson", field="lesson_text",
                  after=(lesson or "").rstrip() + " Owner's note: a B-. The trigger worked for two weeks; then the February earnings "
                  "report gapped it down 28% inside the forward strip. A Slingshot entered before earnings is a bet on the report.")
        print("noted", sym, asof)
print("done")
