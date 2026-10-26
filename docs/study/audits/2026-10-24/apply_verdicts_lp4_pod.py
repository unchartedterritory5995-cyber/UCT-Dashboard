"""Apply the owner's 2026-10-24 Launchpad pass-4 verdicts on the pod via study_store.review (16 MSTR-anchored
drafts reviewed one at a time: LI great; ODFL/ASND/PWR/TOL/ALLE good; VEEV/KMX/MGM/SCCO/AME okay;
MGNI/WSM/ADSK/TTEK/SW cut), with the owner's notes on the kept lessons. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
L = "setup.family1.launchpad"
V = {
    (L, "ODFL", "2023-06-27"): ("approve", "good", "owner: good", "Owner's note: good. Three months under the chunked averages, then the first pop that clears all of them."),
    (L, "ASND", "2023-11-29"): ("approve", "good", "owner: good", "Owner's note: good. Six months of price weaving under and through the converged averages before the launch."),
    (L, "VEEV", "2024-08-21"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (L, "MGNI", "2024-11-11"): ("reject", None, "owner: no, more of a breakout", None),
    (L, "WSM", "2026-01-02"): ("reject", None, "owner: wants price above ALL the averages at the trigger; this cleared the 8/21/50 but was still under the 200-day", None),
    (L, "ADSK", "2023-05-31"): ("reject", None, "owner: wants it above the MAs; the trigger closed inside the chunk", None),
    (L, "KMX", "2024-11-21"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (L, "PWR", "2022-03-08"): ("approve", "good", "owner: good", "Owner's note: good. A month under the chunk with the 200-day on top of it, then the pop clears everything."),
    (L, "TOL", "2026-06-09"): ("approve", "good", "owner: good", "Owner's note: good."),
    (L, "MGM", "2023-07-10"): ("approve", "okay", "owner: eh, C-", "Owner's note: a C-."),
    (L, "TTEK", "2023-06-01"): ("reject", None, "owner: cut", None),
    (L, "ALLE", "2023-12-08"): ("approve", "good", "owner: good", "Owner's note: good. Price sat on the converged averages for a month, then the pop cleared the bundle and the 200-day together."),
    (L, "SCCO", "2023-07-13"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (L, "AME", "2022-10-28"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (L, "LI", "2025-02-06"): ("approve", "great", "owner: great", "Owner's note: great. Three months flat with price weaving through the chunked averages and the 200-day running through them, then the launch clears every one of them."),
    (L, "SW", "2026-06-11"): ("reject", None, "owner: cut", None),
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where skill_id = ? and source_ref like '%setup_examples.json%'", (L,)).fetchall()
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
        ss.review(iid, "fix", BY, reason="owner's nuance, launchpad pass-4 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
