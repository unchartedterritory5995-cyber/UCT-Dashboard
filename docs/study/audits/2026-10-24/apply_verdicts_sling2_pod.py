"""Apply the owner's 2026-10-25 Slingshot pass-2 verdicts on the pod via study_store.review
(approvals with grades + the owner's notes, rejects). 16 drafts, graded one at a time in question
form with the 4-EMA of highs on the chart. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
S = "setup.family4.slingshot"
V = {
    (S, "VRT", "2023-08-21"): ("approve", "great", "owner: perfect", "Owner's note: perfect. The earnings gap is the drive, the seven-session drift is the pullback, and the trigger is the first close back over the 4-period EMA of the highs."),
    (S, "APP", "2024-09-11"): ("approve", "good", "owner: good", "Owner's note: good. A deeper, looser pullback than the best ones; the trigger day itself is the strength day."),
    (S, "TXN", "2026-04-30"): ("approve", "good", "owner: eh, it's good", "Owner's note: good. An earnings gapper, a tight three-session pullback, then the close back over the average of highs."),
    (S, "DUOL", "2023-05-18"): ("reject", None, "owner: cut; weak follow-through (+11% at best, flat by day 20)", None),
    (S, "PAAS", "2025-12-09"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (S, "TCOM", "2022-12-27"): ("reject", None, "owner: bad example; choppy base, small trigger day with a gap, the forward low undercut the trigger low", None),
    (S, "NFLX", "2023-05-26"): ("approve", "great", "owner: great", "Owner's note: great. A sharp rally, a five-session pullback that never got loose, then the close back over the average of highs."),
    (S, "COIN", "2023-11-15"): ("reject", None, "owner: good but not wanted; the Slingshot is mostly (not exclusively) the way to enter a PEG, and this drive was a rally, not an earnings gap", None),
    (S, "HAE", "2026-06-04"): ("approve", "good", "owner: yes, likes this one", "Owner's note: a good one. A recovery off a long downtrend, still under the 200-day at the trigger: the Slingshot does not need the 200 overhead."),
    (S, "SLB", "2022-10-13"): ("approve", "good", "owner: good", "Owner's note: good. A tight three-session pullback after a 27% run, no gap on the trigger day."),
    (S, "NVDA", "2024-03-01"): ("approve", "great", "owner: very good", "Owner's note: very good. The earnings gap is the drive, a tight four-session pullback, then the clean close back over the average of highs: the way into a power earnings gap after the first pause."),
    (S, "SOFI", "2024-11-05"): ("approve", "great", "owner: great", "Owner's note: great. The earnings gap three weeks earlier, a 34% run, a three-session pullback, then the close back over the average of highs."),
    (S, "DECK", "2024-11-21"): ("approve", "good", "owner: good", "Owner's note: good. The earnings gap four weeks earlier, a five-session pullback, no gap on the trigger day."),
    (S, "PLTR", "2024-10-03"): ("approve", "great", "owner: beautiful", "Owner's note: beautiful. A seven-session pullback after a 27% run, then the close back over the average of highs with no gap."),
    (S, "BLDR", "2021-11-16"): ("approve", "okay", "owner: okay", "Owner's note: okay. A shallow pullback and a small trigger day."),
    (S, "SMCI", "2023-05-16"): ("approve", "great", "owner: A+, perfect example", "Owner's note: A+, the perfect example. The earnings day nine sessions earlier is the drive, a six-session pullback, then the close back over the average of highs; it ran 70% in twenty sessions."),
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
        ss.review(iid, "fix", BY, reason="owner's nuance, Slingshot pass-2 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
print("done")
