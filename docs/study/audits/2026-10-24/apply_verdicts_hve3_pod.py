"""Apply the owner's 2026-10-25 High Volume Edge pass-3 verdicts on the pod via study_store.review (18 drafts on the
owner's definition, reviewed one at a time: NAVN, MRNA, RUM, FSLY great; FUN, EVGO, VKTX, ERAS, CLPT good; VRDN, INOD,
LIFE, CRBU, NTLA, APLD okay; TVTX, DYN cut; WVE 2024-09-24 cut in favour of the owner-chosen 2024-10-16 surge),
with the owner's notes on the kept lessons. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
H = "setup.family3.hve"
V = {
    (H, "NAVN", "2026-03-26"): ("approve", "great", "owner: yes, this is perfect (the owner's reference)", "Owner's note: perfect. The template: a lesser-known fresh IPO, one day that dwarfs every day before it, and that close becomes the level to mark on the chart. Price can trade under it later; the level still matters."),
    (H, "MRNA", "2026-08-19"): ("approve", "great", "owner: great (the owner's reference)", "Owner's note: great. A well-known name, but the volume is not subtle, it is a shit ton: four times the prior-year record."),
    (H, "FUN", "2022-02-01"): ("approve", "good", "owner: good", "Owner's note: good."),
    (H, "VRDN", "2024-09-10"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (H, "INOD", "2024-05-08"): ("approve", "okay", "owner: okay (an earnings-day HVE)", "Owner's note: okay. Earnings days can count when the volume is truly massive."),
    (H, "TVTX", "2021-08-16"): ("reject", None, "owner: cut", None),
    (H, "EVGO", "2024-10-03"): ("approve", "good", "owner: good", "Owner's note: good."),
    (H, "RUM", "2024-01-23"): ("approve", "great", "owner: great", "Owner's note: great. A sudden, massive day after a long slide; the stock gave the move back later and the level still mattered."),
    (H, "LIFE", "2021-09-13"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (H, "VKTX", "2022-12-19"): ("approve", "good", "owner: good", "Owner's note: good."),
    (H, "DYN", "2024-01-03"): ("reject", None, "owner: cut", None),
    (H, "CRBU", "2023-07-06"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (H, "ERAS", "2026-01-07"): ("approve", "good", "owner: good", "Owner's note: good."),
    (H, "CLPT", "2025-09-24"): ("approve", "good", "owner: good", "Owner's note: good."),
    (H, "WVE", "2024-09-24"): ("reject", None, "owner: likes the second surge better (2024-10-16), which replaces this one", None),
    (H, "NTLA", "2021-06-28"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (H, "APLD", "2024-09-05"): ("approve", "okay", "owner: okay", "Owner's note: okay."),
    (H, "FSLY", "2026-02-12"): ("approve", "great", "owner: this is 100% A+ (an earnings-day HVE that counts)", "Owner's note: this is 100% A+. An earnings day, but the volume is five times the record after a long slide; that is an HVE, not just an earnings gap."),
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where skill_id = ? and source_ref like '%setup_examples.json%'", (H,)).fetchall()
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
        ss.review(iid, "fix", BY, reason="owner's nuance, HVE pass-3 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
