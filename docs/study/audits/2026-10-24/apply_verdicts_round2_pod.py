"""Apply the owner's 2026-10-24 round-2 verdicts on the pod via study_store.review: Kicker pass 4 and
Launchpad pass 2 (approvals with grades + owner's notes, rejects). Also retires the 10 pass-1 Launchpad
drafts that pre-date the rules (never shown; superseded). Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
K, L = "setup.family3.kicker", "setup.family1.launchpad"
V = {
    # Kicker pass 4
    (K, "SMH", "2026-03-31"): ("approve", "okay", "owner: okay-ish, C-; a gap versus an intermediate downtrend rather than a kicker", "Owner's note: a C-. Technically a gap against an intermediate downtrend more than a kicker; the kicker wants a stock already set up in an uptrend or base."),
    (K, "AMD", "2023-12-07"): ("approve", "great", "owner: the ultimate elite example, perfect", "Owner's note: the ultimate elite example. A fresh uptrend, a two-week base, a real red bar closing at its low at the base lows, then the gap and a 10% day. The sellers from the red day are trapped at the open."),
    (K, "RBRK", "2026-09-14"): ("approve", "great", "owner: another great one, from a few weeks ago (owner reference)", "Owner's note: a great one. A two-week slide ends in a red bar at the lows, then the gap and a 16% day; the low never broke and it ran 28%."),
    (K, "VOD", "2022-01-24"): ("approve", "okay", "owner: okay-ish, B-", "Owner's note: a B-. Okay-ish."),
    (K, "LHX", "2022-02-24"): ("approve", "good", "owner: yeah that's good", "Owner's note: good. Weeks of flat base, a red bar closing at its low at the base lows, then the gap out of it."),
    (K, "TH", "2026-08-27"): ("reject", None, "owner: not worth having; a 9% red bar before the gap is too dramatic", None),
    (K, "BMRN", "2023-01-04"): ("approve", "great", "owner: great example, love it", "Owner's note: great example. A three-week pullback onto the 21-day, a red bar closing at its low at the pullback lows, then the gap."),
    (K, "ENS", "2025-10-13"): ("approve", "okay", "owner: okay-ish, not great but not bad", "Owner's note: okay-ish, not great but not bad."),
    (K, "ACI", "2025-03-05"): ("reject", None, "owner: did not advance enough to call it a kicker", None),
    (K, "HDB", "2024-06-05"): ("reject", None, "owner: too messy and sloppy", None),
    (K, "LB", "2020-01-03"): ("reject", None, "owner: not bad but we can find better ones", None),
    # Launchpad pass 2
    (L, "MSTR", "2023-10-23"): ("approve", "great", "owner: great example; the averages chunk up, price hangs underneath then gets above as they stack 9>20>50", "Owner's note: great example on a stock that can move. Look at the averages chunked up together; price hangs underneath the bundle, then gets above the launchpad as the averages stack into 9 > 20 > 50 trend alignment."),
    (L, "TEAM", "2023-12-08"): ("approve", "great", "owner: beautiful; also an Oops on the trigger day", "Owner's note: beautiful. The averages had converged and the trigger day was also an Oops; great confluence."),
    (L, "ARKK", "2024-11-06"): ("reject", None, "owner: we can find better ones", None),
    (L, "PEP", "2026-01-30"): ("approve", "good", "owner: good", "Owner's note: good."),
    (L, "ADBE", "2023-05-25"): ("approve", "good", "owner: good, but prefers when they dangle and retest the launchpad a bit", "Owner's note: good, though the best ones dangle around the launchpad and retest it a bit before they go."),
    (L, "GE", "2023-01-04"): ("approve", "good", "owner: good, likes the dangle above a bit", "Owner's note: good. The dangle just above the bundle before the move is the part to study."),
    (L, "WDAY", "2023-01-20"): ("approve", "great", "owner: perfect", "Owner's note: perfect. Note the trigger bar is still inside the base; the launchpad is the convergence and the dangle, not a breakout bar."),
    (L, "NOW", "2023-05-17"): ("approve", "good", "owner: good", "Owner's note: good."),
    (L, "BIDU", "2025-08-29"): ("approve", "great", "owner: great, traded this one live in the channel that day", "Owner's note: great. This one was traded live in the channel that day."),
    (L, "INTC", "2025-08-14"): ("reject", None, "owner: pass on this one", None),
    (L, "BABA", "2025-01-24"): ("approve", "good", "owner: good", "Owner's note: good."),
    (L, "DDOG", "2025-10-01"): ("approve", "okay", "owner: eh, it's okay", "Owner's note: okay."),
    (L, "GOOGL", "2024-12-10"): ("reject", None, "owner: wants them to look more like MSTR than this", None),
    (L, "CAT", "2024-09-19"): ("reject", None, "owner: pass; wants the dangle above the launchpad for a bit", None),
    (L, "F", "2024-02-01"): ("approve", "okay", "owner: good enough, B-", "Owner's note: good enough, a B-."),
}
PRE_RULES_LAUNCHPAD_REASON = ("pass-1 Launchpad draft from the first varied scan (no must-work, no owner definition); superseded by "
                              "the 2026-10-24 Launchpad review and retired without being shown. Revive on request.")
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where skill_id in (?,?) and source_ref like '%setup_examples.json%'", (K, L)).fetchall()
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
        ss.review(iid, "fix", BY, reason="owner's nuance, round-2 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
# the pass-1 Launchpad drafts (never reviewed)
for key, r in by_key.items():
    if key[0] == L and key not in V and r[4] == "draft":
        ss.review(r[0], "reject", BY, reason=PRE_RULES_LAUNCHPAD_REASON); print("retire pre-rules launchpad", key[1], key[2])
