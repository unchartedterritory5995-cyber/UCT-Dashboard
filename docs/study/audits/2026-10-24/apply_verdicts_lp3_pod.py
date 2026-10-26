"""Apply the owner's 2026-10-24 Launchpad pass-3 verdicts on the pod via study_store.review (15 drafts reviewed
one at a time: IBKR/EXE great, LYFT/HON/CELH good, RYTM okay; TAN/MARA/TTC/ADM/SONO/MNST/JD/FITB/Z cut), with the
owner's notes on the kept lessons. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
L = "setup.family1.launchpad"
V = {
    (L, "TAN", "2022-07-27"): ("reject", None, "owner: more of a VCP or flat-base breakout, not a launchpad", None),
    (L, "MARA", "2023-06-06"): ("reject", None, "owner: pass, more of a breakout than a launchpad", None),
    (L, "RYTM", "2026-06-17"): ("approve", "okay", "owner: keep, okay", "Owner's note: okay."),
    (L, "TTC", "2023-12-13"): ("reject", None, "owner: no, just an ugly chart", None),
    (L, "ADM", "2025-06-13"): ("reject", None, "owner: wants them to look like MSTR; this rallied up into the bundle instead of living under it", None),
    (L, "IBKR", "2022-08-04"): ("approve", "great", "owner: great", "Owner's note: great. Months of flat base with price living under and through the chunked 8/21/50, then the first real pop above the bundle."),
    (L, "LYFT", "2023-11-28"): ("approve", "good", "owner: good", "Owner's note: good. Price sat under the converged averages for weeks, then got above them as they stacked."),
    (L, "SONO", "2025-08-12"): ("reject", None, "owner: more of a breakout; not bad but we can find better", None),
    (L, "MNST", "2022-06-14"): ("reject", None, "owner: nah, pass", None),
    (L, "EXE", "2025-11-03"): ("approve", "great", "owner: great", "Owner's note: great. Two months weaving through the chunked averages with the 200-day right there, then the pop above everything."),
    (L, "JD", "2024-09-19"): ("reject", None, "owner: more of a sudden breakout", None),
    (L, "FITB", "2026-06-02"): ("reject", None, "owner: structurally fine but a lame regional bank he would not trade (universe rule)", None),
    (L, "HON", "2026-01-08"): ("approve", "good", "owner: good with it; some of these overlap with Base Breakout and that is fine", "Owner's note: good. Some launchpads also qualify as base breakouts; that overlap is fine, the launchpad is about the converged averages under price."),
    (L, "Z", "2025-07-01"): ("reject", None, "owner: pass, does not like the look", None),
    (L, "CELH", "2023-05-01"): ("approve", "good", "owner: good", "Owner's note: good."),
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
        ss.review(iid, "fix", BY, reason="owner's nuance, launchpad pass-3 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
