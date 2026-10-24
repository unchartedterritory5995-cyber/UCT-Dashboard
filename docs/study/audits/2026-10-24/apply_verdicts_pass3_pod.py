"""Apply the owner's pass-3 verdicts (2026-10-24, one chart at a time) on the pod via study_store.review.
Ids resolved from (skill, sym, asof). Approves with grades, rejects the cuts, and writes the owner's typed
nuance onto the kept lessons. Idempotent."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
K, O = "setup.family3.kicker", "setup.family4.oops"
V = {
    # Kicker pass 3
    (K, "HOOD", "2024-05-17"): ("approve", "great", "owner: perfect", "Owner's note: perfect. A real red bar closing at its low out of a flat base, then the gap leaves the sellers trapped."),
    (K, "PSN", "2023-07-28"): ("approve", "great", "owner: this is perfect", "Owner's note: this is perfect. A tight base, a real red bar at its low, then the gap out of the base."),
    (K, "GS", "2026-05-20"): ("approve", "great", "owner: very good", "Owner's note: very good. The red day sold off into the 21-day like a dip that was about to fail, then the gap reversed it; that is the trap."),
    (K, "TSM", "2026-01-02"): ("reject", None, "owner: more of just a breakout; the previous day is strong-ish, not a kicker", None),
    (K, "CVS", "2021-12-09"): ("reject", None, "owner: more of just a breakout vs a kicker candle", None),
    (K, "GWW", "2024-10-11"): ("reject", None, "owner: just a breakout, not a kicker", None),
    (K, "MSTR", "2023-10-23"): ("reject", None, "owner: not a kicker, but a good Launchpad (moved to the Launchpad candidates)", None),
    (K, "UAL", "2025-08-12"): ("reject", None, "owner: sellers need to be trapped by an almost-failed breakdown, not a baby red candle", None),
    # Oops pass 3
    (O, "ADBE", "2023-08-14"): ("approve", "okay", "owner: good but not awesome follow-through", "Owner's note: good, though the follow-through was not awesome. The best examples never break the Oops-day low and move quickly."),
    (O, "ANET", "2026-09-03"): ("approve", "good", "owner: solid example, would want quicker follow-through", "Owner's note: solid. Ideally it follows through to the upside quicker, but a good visual."),
    (O, "CIEN", "2025-07-14"): ("approve", "great", "owner: perfect example", "Owner's note: perfect example."),
    (O, "TEAM", "2023-12-08"): ("approve", "great", "owner: preferred this Oops over 2023-11-28; also a Launchpad, great confluence", "Owner's note: great confluence. The averages had converged (a Launchpad) and the Oops fired right on them."),
    (O, "TEAM", "2023-11-28"): ("reject", None, "owner: prefers the Oops 6-7 days later (2023-12-08), which replaces this one", None),
    (O, "SHOP", "2025-06-23"): ("approve", "great", "owner: beautiful; gave another Oops 2-3 weeks later before accelerating", "Owner's note: beautiful. It gave another Oops two to three weeks later before it really accelerated."),
    (O, "SHOP", "2026-09-28"): ("approve", "great", "owner: a prime example (owner-provided reference)", "Owner's note: a prime example. The Oops-day low never broke and the stock ran 19% in two weeks."),
    (O, "FCX", "2022-02-24"): ("approve", "great", "owner: beautiful", "Owner's note: beautiful."),
    (O, "SE", "2024-04-16"): ("approve", "great", "owner: perfect", "Owner's note: perfect."),
    (O, "C", "2024-10-22"): ("reject", None, "owner: would not be on the radar with that nasty big red day a few days prior", None),
    (O, "GLW", "2026-01-12"): ("approve", "great", "owner: hell yeah", "Owner's note: hell yeah."),
    (O, "CCJ", "2023-05-31"): ("approve", "great", "owner: awesome example", "Owner's note: awesome example."),
    (O, "ELF", "2024-06-10"): ("approve", "great", "owner: perfect", "Owner's note: perfect."),
    (O, "LLY", "2022-10-13"): ("approve", "great", "owner: perfect", "Owner's note: perfect."),
    (O, "WSM", "2024-12-20"): ("approve", "good", "owner: good, a little sharp of a pullback into the spot", "Owner's note: good. The pullback into the spot was a little sharp, but still a great example."),
    (O, "GS", "2023-01-23"): ("approve", "okay", "owner: average compared to the other examples", "Owner's note: average compared to the other examples."),
    (O, "COF", "2023-06-27"): ("approve", "okay", "owner: decent example, B-, not a great advance after", "Owner's note: a B-. A decent example, not a great advance after."),
    (O, "UTHR", "2026-03-24"): ("reject", None, "owner: pass on this one", None),
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where skill_id in (?,?) and source_ref like '%setup_examples.json%'", (K, O)).fetchall()
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
        ss.review(iid, "fix", BY, reason="owner's nuance, pass-3 review", field="lesson_text", after=(lesson or "").rstrip() + " " + note)
    ss.review(iid, "approve", BY, reason=why)
    if grade:
        ss.review(iid, "grade", BY, reason=why, after=grade)
    print("approve", sym, asof, grade)
