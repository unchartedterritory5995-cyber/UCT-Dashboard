"""Apply the owner's 2026-10-25 verdicts on the 10 pass-1 Slingshot drafts (the first scan, before the
owner definition) on the pod via study_store.review. 3 kept (QCOM great, XOM okay, PANW okay), 7 cut.
Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
S = "setup.family4.slingshot"
V = {
    (S, "QCOM", "2021-11-15"): ("approve", "great", "owner: great", "Owner's note: great. The earnings gap seven sessions earlier is the drive, then the first close back over the 4-period EMA of the highs."),
    (S, "BBWI", "2024-01-02"): ("reject", None, "owner: pass; no earnings drive, trigger on a down-gap day, no follow-through", None),
    (S, "CBZ", "2021-12-22"): ("reject", None, "owner: pass; thin obscure name, no earnings drive, no follow-through", None),
    (S, "RTX", "2022-02-25"): ("reject", None, "owner: pass, wants them to look like the ones labeled perfect or beautiful", None),
    (S, "XOM", "2022-01-25"): ("approve", "okay", "owner: a slingshot by the rule, but they can look prettier", "Owner's note: a Slingshot by the rule, kept as an okay one; the prettier ones are the gallery."),
    (S, "PANW", "2024-02-02"): ("approve", "okay", "owner: B-", "Owner's note: a B-. The trigger worked for two weeks; the February earnings gap-down sits inside the forward strip."),
    (S, "TEAM", "2022-03-28"): ("reject", None, "owner: cut; a bear-market bounce under a falling 200-day that rolled over", None),
    (S, "HAS", "2023-02-02"): ("reject", None, "owner: cut; a bounce in a downtrend under the falling 200-day that failed into earnings", None),
    (S, "FIGS", "2023-01-03"): ("reject", None, "owner: cut; a $7 stock, too cheap for the gallery", None),
    (S, "INTA", "2023-03-06"): ("reject", None, "owner: eh; a thin name, treated as a cut", None),
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where skill_id = ? and source_ref like '%setup_examples.json%' and retired_at is null", (S,)).fetchall()
by_key = {(r[1], r[2], r[3]): r for r in rows}
print("items", len(by_key), "missing", [k for k in V if k not in by_key])
for key, (action, grade, why, note) in V.items():
    r = by_key.get(key)
    if not r:
        continue
    iid, _, sym, asof, status, lesson = r
    if action == "reject":
        if status == "rejected":
            print("skip rejected", sym, asof); continue
        ss.review(iid, "reject", BY, reason=why); print("reject", sym, asof); continue
    if note and "Owner's note:" not in (lesson or ""):
        ss.review(iid, "fix", BY, reason="owner's nuance, Slingshot pass-1 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
print("done")
