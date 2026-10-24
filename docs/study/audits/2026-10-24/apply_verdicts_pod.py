"""Apply the owner's one-at-a-time verdicts of 2026-10-24 (Kicker pass 2 + Oops pass 2) on the pod
via study_store.review. Ids are resolved on the pod from (skill, sym, asof) so nothing is retyped.
Rejects the cuts, approves the keeps (JBTM flips back from my provisional reject), grades every
kept example, and appends the failed-setup note to WFRD and SEI."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
K, O = "setup.family3.kicker", "setup.family4.oops"
# (skill, sym, asof): (action, grade or None, reason)
V = {
    # Kicker
    (K, "IMAX", "2026-02-26"): ("approve", "okay", "owner: fine, not super ideal but good enough from a textbook perspective"),
    (K, "VTRS", "2024-11-07"): ("approve", "good", "owner: good example, though reads more as an earnings move than a kicker"),
    (K, "GRMN", "2024-05-01"): ("reject", None, "owner: plainly just an earnings gapper, not a kicker"),
    (K, "TSN", "2022-02-07"): ("reject", None, "owner: good chart but an earnings gapper, not a kicker; candidate for the earnings-gapper setup"),
    (K, "RCUS", "2026-06-22"): ("approve", "good", "owner: yes, but generally wants a weaker close on the previous day"),
    (K, "JBI", "2023-12-14"): ("approve", "great", "owner: the picture perfect example"),
    (K, "ISRG", "2025-01-15"): ("approve", "okay", "owner: decent, wants a weaker prior close; keep as a lesser example"),
    (K, "JBTM", "2025-12-10"): ("approve", "great", "owner: yes, looks great (flips my provisional reject)"),
    (K, "ETON", "2024-01-08"): ("approve", "great", "owner: the best of the first batch, already giving a good setup"),
    (K, "VYX", "2023-08-03"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    (K, "LNC", "2025-07-31"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    (K, "CRL", "2024-02-14"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    (K, "FIVE", "2026-03-19"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    (K, "SNPS", "2023-05-18"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    (K, "PGR", "2023-10-13"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    (K, "BJ", "2021-11-18"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    (K, "GIS", "2022-06-29"): ("reject", None, "earnings day; owner rule: kicker examples should rarely be earnings days"),
    # Oops
    (O, "ORIC", "2024-01-17"): ("approve", "great", "owner: perfect"),
    (O, "IMNM", "2026-01-15"): ("approve", "okay", "owner: prefers a red day prior, though it does not have to be"),
    (O, "ELVN", "2026-06-12"): ("reject", None, "owner: the previous day was a big gapper; a delayed-reaction setup, not an Oops"),
    (O, "HRMY", "2026-07-21"): ("reject", None, "owner: weird look"),
    (O, "MATX", "2026-05-05"): ("approve", "okay", "owner: earnings so meh, but fine"),
    (O, "SIBN", "2025-02-18"): ("reject", None, "owner: not a stock he would trade; wants good spots on good stocks"),
    (O, "ULTA", "2025-09-02"): ("reject", None, "owner: a random big red day prior takes it off the radar; not orderly"),
    (O, "FIP", "2026-03-02"): ("reject", None, "owner: too dramatic a candle prior and current, news-driven rather than technical"),
    (O, "LQDA", "2023-06-15"): ("approve", "good", "owner: steadily flags and drifts into a buyable spot before the Oops; location matters"),
    (O, "FLEX", "2023-02-10"): ("reject", None, "owner: big red candle prior, not orderly, off the list"),
    (O, "TVTX", "2024-09-04"): ("approve", "okay", "owner: fine, but a little subtle and hidden"),
    (O, "PRKS", "2022-02-24"): ("reject", None, "owner: fails a few days later into a downtrend; examples must work"),
    (O, "VG", "2020-12-10"): ("approve", "good", "owner: fine"),
    (O, "WFRD", "2022-06-07"): ("approve", "good", "owner: a good example with a horrible result; kept as a failed-setup lesson"),
    (O, "GTLB", "2023-09-07"): ("reject", None, "owner: candle prior not good"),
    (O, "LPG", "2023-01-19"): ("approve", "okay", "owner: C+"),
    (O, "SEI", "2025-07-29"): ("approve", "good", "owner: liked the example, it just did not follow through; kept as a failed-setup lesson"),
    (O, "VERX", "2024-11-05"): ("approve", "good", "owner: good"),
}
FAILED_NOTE = (" Owner's note: this one is a failed-setup lesson. The location and the candle were right, and the trade "
               "still failed in the weeks after. A good setup is a good bet, not a guarantee; the stop does the rest.")

db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where skill_id in (?,?) and source_ref like '%setup_examples.json%'", (K, O)).fetchall()
by_key = {(r[1], r[2], r[3]): r for r in rows}
missing = [k for k in V if k not in by_key]
print("items found", len(by_key), "missing", missing)
for key, (action, grade, why) in V.items():
    if key not in by_key:
        continue
    iid, _, sym, asof, status, lesson = by_key[key]
    if action == "reject":
        if status == "rejected":
            print("skip already rejected", sym); continue
        r = ss.review(iid, "reject", BY, reason=why); print("reject", sym, asof, "->", r["item"]["review_status"])
        continue
    if sym in ("WFRD", "SEI") and "failed-setup lesson" not in (lesson or ""):
        ss.review(iid, "fix", BY, reason="owner: keep as a failed-setup lesson", field="lesson_text", after=(lesson or "").rstrip() + FAILED_NOTE)
        print("fix lesson", sym)
    r = ss.review(iid, "approve", BY, reason=why); print("approve", sym, asof, "->", r["item"]["review_status"])
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade); print("grade", sym, grade)
