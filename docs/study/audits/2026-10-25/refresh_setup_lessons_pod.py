"""Refresh the DEFINITION sentence at the head of every setup-example lesson on the pod so the live
lessons teach the owner's rulings of 2026-10-23..25. The definitions are copied VERBATIM from
scripts/study/gen_setup_examples.py SETUPS (the one source for new items; the pod runs the deployed
master, which may not carry that edit yet, so the text is inlined here rather than imported). The
measured fact line ("Here ...") and any "Owner's note:" the review added are kept verbatim. Items whose
lesson has no fact line are left alone. Idempotent: a lesson that already starts with the new definition
is skipped. Pod-side via study_store.review(..., "fix", field="lesson_text") so the change is in the
audit trail."""
import os, sys, sqlite3
sys.path.insert(0, os.getcwd())
from api.services import study_store as ss  # noqa

BY = "owner"
DEFS = {
    "setup.family1.launchpad": ("Launchpad",
        "Launchpad: after a real correction the 8, 21 and 50-day averages chunk up into a tight bundle at or near the "
        "200-day while price lives UNDER and through the bundle for weeks in a long flat base, dangling and retesting "
        "it; the launch is the FIRST bar that closes above every average, the bundle and the 200-day alike, as they "
        "stack into 8 > 21 > 50. It is the convergence and the dangle, not a breakout: a stock riding on top of its "
        "averages that breaks out is a base breakout (owner rulings 2026-10-23/24)."),
    "setup.family3.kicker": ("Kicker Candle",
        "Kicker: the stock is already set up, in an uptrend or a clean base; the day before closes red and WEAK near "
        "its low, an almost-failed breakdown with a real body (about 1-5% of price); then the next day gaps up and "
        "follows through with a strong green candle that closes above the red day's high and near its own high, "
        "usually on a volume surge. The sellers from the red day are trapped. It is short-term positioning and "
        "rarely an earnings day: an earnings-day gap is an earnings gapper, a baby red candle before a gap is just a "
        "breakout, and a gap against a downtrend is a different setup (owner rulings 2026-10-23/24)."),
    "setup.family3.hve": ("High Volume Edge",
        "High Volume Edge: an up day on a volume that DWARFS everything before it, ten times normal and above the prior "
        "record, often on a lesser-known name, the start of a new story; an earnings day counts when the volume is "
        "truly massive. That day's close is a LEVEL to mark on the chart, the price the biggest participants committed "
        "at; price may trade under it later. It is not an HVC (any high-volume close) and not a PEG (an earnings gap "
        "on big but ordinary volume); OPEX and month-end sessions do not count (owner rulings 2026-10-23/25)."),
    "setup.family4.oops": ("Oops Reversal",
        "Oops Reversal (scanner version): opens below the prior close, trades under the prior day's low, then reverses "
        "and closes above the prior close. A Williams Oops opens below the prior LOW and rallies back above it. A Super "
        "Oops closes above the prior day's HIGH, engulfing the whole day. LOCATION is the main thing: it comes at the "
        "end of an orderly drift lower, a flag, a wedge, a double bottom or the end of a downtrend, into a buyable spot, "
        "with orderly days before it (no news gap, no outsized red bar) and a technical, not news-sized, Oops day; the "
        "Oops-day low must never break afterwards (owner rulings 2026-10-23/24)."),
    "setup.family4.slingshot": ("Slingshot",
        "Slingshot: a drive first, usually an earnings gapper (it is mostly the way into a power earnings gap after its "
        "first pause), sometimes a strong rally; THEN a tight orderly pullback of three to seven sessions, about 5-12% "
        "deep, with the closes under the 4-day average of the highs; THEN the trigger, the first close back above that "
        "average, a decisive day that closes near its high and needs no gap. The gap day or rally day itself is never the "
        "trigger, and the 200-day is not required (owner rulings 2026-10-24/25)."),
}
db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select id, skill_id, sym, asof, review_status, lesson_text from study_items "
                   "where source_ref like '%setup_examples.json%' and retired_at is null "
                   "and review_status in ('draft','approved')").fetchall()
done = skipped = 0
for iid, skill, sym, asof, status, lesson in rows:
    if skill not in DEFS:
        continue
    setup, definition = DEFS[skill]
    text = lesson or ""
    if text.startswith(definition):
        skipped += 1; continue
    k = text.find(" Here ")
    if k < 0:
        k = text.find("Here ")
        if k < 0:
            print("no fact line, left alone:", sym, asof); skipped += 1; continue
    tail = text[k:].lstrip()
    new = (definition + " " + tail).strip()
    ss.review(iid, "fix", BY, reason="definition refreshed to the owner's rulings of 2026-10-23..25 (setup differentiation pass)",
              field="lesson_text", after=new)
    done += 1
    print("refreshed", setup, sym, asof, status)
print("done", done, "skipped", skipped)
