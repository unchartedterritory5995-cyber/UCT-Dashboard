"""Apply the owner's pass-4 Kicker verdicts (2026-10-24) on the pod via study_store.review. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
K = "setup.family3.kicker"
V = {
    (K, "SMH", "2026-03-31"): ("approve", "okay", "owner: okay-ish, C-; technically a gap versus an intermediate downtrend rather than a kicker", "Owner's note: a C-. Technically this is a gap against an intermediate downtrend more than a kicker; the kicker wants a stock already set up in an uptrend or base."),
    (K, "AMD", "2023-12-07"): ("approve", "great", "owner: the ultimate elite example, perfect", "Owner's note: the ultimate elite example. A fresh uptrend, a two-week base, a real red bar closing at its low at the base lows, then the gap and a 10% day. The sellers from the red day are trapped at the open."),
    (K, "RBRK", "2026-09-14"): ("approve", "great", "owner: another great one, from a few weeks ago (owner reference)", "Owner's note: a great one. A two-week slide ends in a red bar at the lows, then the gap and a 16% day; the low never broke and it ran 28%."),
    (K, "VOD", "2022-01-24"): ("approve", "okay", "owner: okay-ish, B-", "Owner's note: a B-. Okay-ish."),
    (K, "LHX", "2022-02-24"): ("approve", "good", "owner: yeah that's good", "Owner's note: good. Weeks of flat base, a red bar closing at its low at the base lows, then the gap out of it."),
    (K, "TH", "2026-08-27"): ("reject", None, "owner: not worth having, not bad but not great (a 9% red bar before the gap is too dramatic)", None),
    (K, "BMRN", "2023-01-04"): ("approve", "great", "owner: great example, love it", "Owner's note: great example. A three-week pullback onto the 21-day, a red bar closing at its low at the pullback lows, then the gap."),
    (K, "ENS", "2025-10-13"): ("approve", "okay", "owner: okay-ish, not great but not bad", "Owner's note: okay-ish, not great but not bad."),
    (K, "ACI", "2025-03-05"): ("reject", None, "owner: did not advance enough to call it a kicker", None),
    (K, "HDB", "2024-06-05"): ("reject", None, "owner: too messy and sloppy", None),
    (K, "LB", "2020-01-03"): ("reject", None, "owner: not bad but we can find better ones", None),
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items where skill_id=? and source_ref like '%setup_examples.json%'", (K,)).fetchall()
by_key = {(r[1], r[2], r[3]): r for r in rows}
print("items", len(by_key), "missing", [k for k in V if k not in by_key])
for key, (action, grade, why, note) in V.items():
    r = by_key.get(key)
    if not r:
        continue
    iid, _, sym, asof, status, lesson = r
    if action == "reject":
        if status == "rejected":
            print("skip rejected", sym); continue
        ss.review(iid, "reject", BY, reason=why); print("reject", sym, asof); continue
    if note and "Owner's note:" not in (lesson or ""):
        ss.review(iid, "fix", BY, reason="owner's nuance, pass-4 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
