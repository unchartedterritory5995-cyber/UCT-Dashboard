"""Put the owner's typed nuance on the kept pass-2 examples' lesson text (study_store.review 'fix' on
lesson_text, then re-approve so the item stays published). Idempotent: skips items that already carry the note."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
K, O = "setup.family3.kicker", "setup.family4.oops"
NOTES = {
    (K, "IMAX", "2026-02-26"): "Owner's note: fine from a textbook perspective, not the ideal picture; note it is an earnings day, which usually makes a gap an earnings gapper rather than a kicker.",
    (K, "VTRS", "2024-11-07"): "Owner's note: a good example, though on an earnings day it reads more like an earnings move than a kicker; sometimes the two are indistinguishable.",
    (K, "RCUS", "2026-06-22"): "Owner's note: a yes, but the ideal kicker comes after a visibly weaker close on the previous day, so the trap is obvious.",
    (K, "JBI", "2023-12-14"): "Owner's note: the picture-perfect kicker. No earnings, a flat base with the averages bunched, a weak red day, then the gap and a close near the high on huge volume, clearing the base.",
    (K, "ISRG", "2025-01-15"): "Owner's note: decent, kept as a lesser example. The previous day did not close weak enough, so this looks like a regular gap up more than a kicker gap up.",
    (K, "JBTM", "2025-12-10"): "Owner's note: looks great. A kicker is about short-term positioning, the sellers from the red day are trapped at the open.",
    (K, "ETON", "2024-01-08"): "Owner's note: the best of its batch because the stock was already giving a good setup before the candle; the kicker is the trigger out of a setup, not a candle in isolation.",
    (O, "ORIC", "2024-01-17"): "Owner's note: perfect.",
    (O, "IMNM", "2026-01-15"): "Owner's note: fine, though the ideal Oops comes after a red day; it does not have to.",
    (O, "MATX", "2026-05-05"): "Owner's note: an earnings reaction, so a lesser example; the geometry is fine.",
    (O, "LQDA", "2023-06-15"): "Owner's note: see how it steadily flags and drifts into a buyable spot in the days before the Oops. Location matters most: a flag, a wedge down, a double bottom, or the end of a downtrend.",
    (O, "TVTX", "2024-09-04"): "Owner's note: fine, but a little subtle and hidden; the clearer ones teach better.",
    (O, "VG", "2020-12-10"): "Owner's note: fine. A tight flag drifting onto the 21-day, then the undercut and reclaim.",
    (O, "LPG", "2023-01-19"): "Owner's note: a C+. The drift into the 50-day is orderly; the reversal day is modest.",
    (O, "VERX", "2024-11-05"): "Owner's note: good.",
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where skill_id in (?,?) and source_ref like '%setup_examples.json%'", (K, O)).fetchall()
by_key = {(r[1], r[2], r[3]): r for r in rows}
for key, note in NOTES.items():
    r = by_key.get(key)
    if not r:
        print("missing", key); continue
    iid, _, sym, asof, status, lesson = r
    if "Owner's note:" in (lesson or ""):
        print("skip (has note)", sym); continue
    ss.review(iid, "fix", BY, reason="owner's nuance from the 2026-10-24 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    out = ss.review(iid, "approve", BY, reason="re-approve after adding the owner's note")
    print("noted + approved", sym, asof, out["item"]["review_status"])
