"""Apply the owner's 2026-10-25 High Volume Edge pass-2 verdicts on the pod via study_store.review (16 detector-gated
drafts reviewed one at a time: COMP good; CPNG, NTRS okay; the rest cut as plain high-volume closes, Power Earnings
Gaps, an OPEX session (LRCX) or a mega-cap on a modest multiple). Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
H = "setup.family3.hve"
V = {
    (H, "RCL", "2025-06-27"): ("reject", None, "owner: nah, let's find some better ones (the volume is not massive; a Russell-rebalance Friday)", None),
    (H, "CPNG", "2025-09-08"): ("approve", "okay", "owner: yes, that's okay I guess", "Owner's note: okay."),
    (H, "NTRS", "2025-06-23"): ("approve", "okay", "owner: okay", "Owner's note: okay. A sudden jump to more than three times the prior-year volume record on a news day."),
    (H, "KNX", "2026-05-14"): ("reject", None, "owner: cut", None),
    (H, "LRCX", "2025-12-19"): ("reject", None, "owner: no end-of-month or OPEX days as HVE days (this was December quad-witching)", None),
    (H, "COMP", "2026-01-07"): ("approve", "good", "owner: this is much better, a sudden major increase", "Owner's note: much better. The tell is the SUDDEN, major increase in volume against everything before it, not merely a heavy day."),
    (H, "CVX", "2022-02-25"): ("reject", None, "owner: no (a mega-cap on a modest multiple)", None),
    (H, "CIEN", "2025-11-24"): ("reject", None, "owner: nah", None),
    (H, "AAPL", "2024-06-11"): ("reject", None, "owner: not part of the high volume edge", None),
    (H, "HOOD", "2023-12-06"): ("reject", None, "owner: closer, but no", None),
    (H, "ASML", "2024-01-24"): ("reject", None, "owner: again, just a PEG (Power Earnings Gap), not an HVE", None),
    (H, "ORCL", "2025-06-12"): ("reject", None, "owner: just a PEG, though the day leaves a valid high-volume close level", None),
    (H, "RL", "2024-02-08"): ("reject", None, "owner: just a PEG and an HVC, not a real HVE", None),
    (H, "DUOL", "2023-11-09"): ("reject", None, "owner: PEG", None),
    (H, "GM", "2025-10-21"): ("reject", None, "owner: PEG / HVC", None),
    (H, "AXON", "2024-08-07"): ("reject", None, "earnings-day gap on an established name: a PEG, filed with the owner informed", None),
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
        ss.review(iid, "fix", BY, reason="owner's nuance, HVE pass-2 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
