"""Apply the owner's Gap Support rulings of 2026-10-26/27 (42 items: one chart at a time, then batches of ten
from the local contact sheet) on the pod via study_store.review. Ids resolved on the pod from (skill, sym, asof).
Approves the keeps with grades, rejects the cuts, leaves NVDA 2026-09-09 (bad bars) and the two pending lines
untouched. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
G = "setup.family3.gap_support"
V = {
    ("AAPL", "2022-08-29"): ("approve", "okay", "owner: Keep — okay"),
    ("AAPL", "2022-10-11"): ("reject", None, "owner: Cut"),
    ("AAPL", "2024-05-07"): ("reject", None, "owner: Just a PEG"),
    ("AAPL", "2024-05-08"): ("approve", "good", "owner: Keep — good"),
    ("AFRM", "2024-09-10"): ("approve", "great", "owner: Keep — great"),
    ("AMZN", "2022-10-11"): ("reject", None, "owner: Cut"),
    ("AMZN", "2022-11-17"): ("approve", "okay", "owner: Keep — okay"),
    ("AMZN", "2022-11-18"): ("approve", "okay", "owner: Gap support yes but not a great setup"),
    ("ARGX", "2024-11-19"): ("approve", "okay", "owner: It’s correct but think there are better examples"),
    ("AXP", "2023-03-10"): ("reject", None, "owner: Cut"),
    ("BABA", "2023-04-20"): ("reject", None, "owner: Failed example / nah not even a good failed example"),
    ("CAVA", "2026-03-27"): ("approve", "okay", "owner: Keep — okay"),
    ("CLS", "2025-08-20"): ("approve", "okay", "owner: Keep — okay"),
    ("DOCS", "2023-01-06"): ("approve", "great", "owner: Keep — great"),
    ("EDU", "2023-01-30"): ("approve", "good", "owner: Keep — good"),
    ("FMS", "2024-03-14"): ("reject", None, "owner: Failed example / nah not even a good failed example"),
    ("FTAI", "2026-05-19"): ("approve", "okay", "owner: Keep — okay"),
    ("GOOGL", "2023-02-07"): ("approve", "okay", "owner: Keep — okay"),
    ("KKR", "2024-08-05"): ("approve", "good", "owner: Yeah this is good because it’s a little subtle"),
    ("KYMR", "2026-01-20"): ("approve", "okay", "owner: Keep — okay"),
    ("LYFT", "2021-11-15"): ("reject", None, "owner: Cut"),
    ("META", "2023-02-24"): ("approve", "great", "owner: Such a great setup on this PEG there"),
    ("MSFT", "2022-10-11"): ("reject", None, "owner: Cut"),
    ("MSFT", "2023-02-17"): ("approve", "good", "owner: Keep — good"),
    ("MSFT", "2023-05-24"): ("reject", None, "owner: Cut"),
    ("MSFT", "2023-10-30"): ("approve", "okay", "owner: Keep — okay"),
    ("MSFT", "2025-08-04"): ("approve", "okay", "owner: A lot of the are more PEGs but also gap support"),
    ("MU", "2024-01-02"): ("approve", "great", "owner: Keep — great"),
    ("NFLX", "2022-02-07"): ("reject", None, "owner: Don’t want to do downtrend gaps but will do bear gaps off the highs"),
    ("NVDA", "2022-10-11"): ("reject", None, "owner: Cut"),
    ("NVDA", "2023-03-02"): ("approve", "great", "owner: Keep — great"),
    ("NVDA", "2023-06-01"): ("reject", None, "owner: Never really tested gap support"),
    ("NVDA", "2026-09-09"): ("skip", None, "owner: Don’t have enough price data in that pic"),
    ("QBTS", "2026-04-29"): ("approve", "okay", "owner: Eh B-"),
    ("SBUX", "2022-04-05"): ("reject", None, "owner: Cut"),
    ("TER", "2025-11-21"): ("approve", "good", "owner: Keep — good"),
    ("TTD", "2022-01-04"): ("reject", None, "owner: Failed example / nah not even a good failed example"),
    ("TTD", "2023-03-13"): ("reject", None, "owner: Pass on that one"),
    ("TWLO", "2025-11-21"): ("approve", "good", "owner: That’s good but I want the gap up low to hold or be slightly breached instead of the gap fill spot btw"),
    ("UAL", "2024-02-06"): ("approve", "okay", "owner: Keep — okay"),
    ("UBER", "2022-10-11"): ("approve", "okay", "owner: Prefer holding open gap vs filling gap btw"),
    ("VECO", "2026-05-19"): ("approve", "okay", "owner: Keep — okay"),
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status from study_items where skill_id = ?", (G,)).fetchall()
by_key = {(r[2], str(r[3])[:10]): r for r in rows}
print("pod gap items", len(by_key), "missing", [k for k in V if k not in by_key])
for key, (action, grade, why) in V.items():
    r = by_key.get(key)
    if not r or action == "skip":
        continue
    iid, _, sym, asof, status = r
    if action == "reject":
        if status == "rejected":
            print("skip rejected", sym, asof); continue
        ss.review(iid, "reject", BY, reason=why); print("reject", sym, asof); continue
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
