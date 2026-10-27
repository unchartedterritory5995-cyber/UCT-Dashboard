"""gen_contrasts -- `recall` items that teach the DIFFERENCE between setups that
look alike, written from the owner's own rulings (docs/study/corrections/
spot.fixtures.jsonl, the source_ruling records of 2026-10-23..25).

The spot drills ask "does setup X fire here?"; the owner's review showed that
what members actually get wrong is the neighbour: an earnings gapper graded as
a Kicker, a high-volume close graded as an HVE, a breakout graded as a
Launchpad, the gap day itself graded as the Slingshot trigger. Each item here
puts the owner's distinction in question form, with the lesson in his words.
No chart, no model text: every answer and distractor is a sentence the owner
ruled on, and the reveal cites the ruling it came from.

  python -I -X utf8 scripts/study/gen_contrasts.py   ->  docs/study/bank/recall.contrasts.json

The owner reviews every item on the review screen before it goes live.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study._common import make_item, quote_lesson, shuffled_choices, write_segment  # noqa: E402
from scripts.study.gen_recall import setup_skill  # noqa: E402

RULINGS = "docs/study/corrections/spot.fixtures.jsonl"

#: (setup whose skill the item files under, ruling numbers, question, correct answer,
#:  three distractors, the lesson in the owner's words)
CONTRASTS = [
    ("Kicker Candle", "13,21",
     "A stock gaps up on its earnings report on heavy volume and closes strong. By the firm's rulings, what is that day by default?",
     "An earnings gapper (a Power Earnings Gap), not a Kicker",
     ["A Kicker Candle", "A High Volume Edge", "A Slingshot trigger"],
     "An earnings-day gap is an earnings gapper by default. The kicker is about short-term positioning, the red-day "
     "sellers trapped, and should rarely be an earnings day. An HVE needs volume that dwarfs everything before it, and "
     "the Slingshot is the first pause AFTER the gap, never the gap day."),
    ("Kicker Candle", "4,15",
     "The day before closed red and weak near its low, with a real body. It looked like a failed breakdown out of a clean base. "
     "Today, not an earnings day, gapped up and closed strong above that red day's high. Which setup is this?",
     "A Kicker Candle: the red-day sellers are trapped",
     ["A Base Breakout", "An Oops Reversal", "A Slingshot"],
     "Sellers need to be trapped, so the red day before must look like an almost-failed breakdown, a real red bar closing "
     "at or near the lows of the base; then the gap reverses it with a strong green candle. The stock must already be set up."),
    ("Kicker Candle", "15",
     "The day before was a baby red candle, barely a body, inside a tight base. Today gapped up through the base highs. "
     "What did the owner call this?",
     "Just a breakout, not a kicker: a baby red candle traps nobody",
     ["A Kicker Candle, because it gapped above the prior high", "A Launchpad", "A Super Oops"],
     "Opening above the prior high does not separate kickers from breakouts; the prior day's body does. Kept kickers had "
     "a real red body of 1-5% of price; the breakouts had near-doji red days. A baby red candle traps nobody."),
    ("Kicker Candle", "17",
     "A stock recovering from a correction, still under a falling 200-day, gaps up strongly after a red day. Kicker?",
     "No: a gap against an intermediate downtrend is a different setup; the kicker fires out of an uptrend or a base",
     ["Yes, any red day then a gap up is a kicker", "Yes, if the volume is double", "Yes, if the gap is over 3%"],
     "The stock should already be in an uptrend or a base, not recovering from a correction into the 200-day. A gap "
     "against an intermediate downtrend is a different setup (the owner graded SMH 2026-03-31 a C- for exactly this)."),
    ("Oops Reversal", "6",
     "A stock opens below the prior day's close, trades under the prior day's low, then reverses and closes above the "
     "prior close. Which name does the firm's scanner give it?",
     "A scanner Oops Reversal",
     ["A Kicker Candle", "A Williams Oops", "A Go Signal"],
     "The scanner Oops is the main definition: open below the prior close, low below the prior low, close above the "
     "prior close. A Williams Oops is stricter at the open (it opens below the prior LOW and rallies back above it)."),
    ("Oops Reversal", "6",
     "An Oops day that closes above the prior day's HIGH, engulfing the whole prior day. What is it called?",
     "A Super Oops Reversal",
     ["A Williams Oops", "A scanner Oops", "A Kicker Candle"],
     "The close-above version is a Super Oops Reversal when it fully engulfs the previous day after any version of the "
     "Oops: it trades under the prior low AND closes above the prior high."),
    ("Oops Reversal", "14",
     "Where does the owner want an Oops Reversal to show up?",
     "At the end of an orderly drift lower, a flag, a wedge or a double bottom, into a buyable spot",
     ["Right after a big news gap, as a delayed reaction", "After a random outsized red day a few days earlier",
      "On the breakout day at a fresh high"],
     "Location matters big time. The Oops comes at the end of an orderly drift lower, a flag, a wedge down, a double "
     "bottom or the end of a downtrend, into a buyable spot. A reversal after a news gap is a delayed-reaction setup, "
     "and a random big red day takes the stock off the radar."),
    ("Oops Reversal", "16",
     "Which rule must an Oops example satisfy on the days after it?",
     "The low of the Oops day never breaks",
     ["It gaps up again the next day", "It closes above the 200-day within a week", "Its volume is a record"],
     "The Oops-day low must never be broken afterwards, and quick follow-through is preferred. SHOP 2026-09-28 is the "
     "reference: a Williams Oops whose low never broke, up 19% in two weeks."),
    ("Launchpad", "18,19",
     "For weeks price has lived UNDER a tight bundle of the 8, 21 and 50-day averages. The base is long and flat, near the "
     "200-day. Today is the first bar that closes above every average as they stack 8 > 21 > 50. Which setup?",
     "A Launchpad",
     ["A Base Breakout", "A Slingshot", "A Kicker Candle"],
     "Look at the averages chunked up together: price hangs underneath the bundle, then gets above the launchpad as the "
     "averages stack into 9 > 20 > 50 trend alignment. MSTR 2023-10-23 is the template."),
    ("Launchpad", "18,19",
     "A stock riding on TOP of its stacked averages in an uptrend pulls back and breaks out to new highs. "
     "Is that a Launchpad?",
     "No: that is a pullback breakout or base breakout; a Launchpad lives under the bundle first",
     ["Yes, any breakout with stacked averages", "Yes, if the 200-day is below price", "Yes, if volume doubles"],
     "The Launchpad is the convergence and the dangle, not a breakout bar. The cuts had price above the bundle on most "
     "of the prior forty sessions; the greats had price under and through it for weeks, then the first real pop above everything."),
    ("Launchpad", "20",
     "The launch bar clears the 8/21/50 bundle but closes under the 200-day. Launchpad?",
     "No: the launch bar must close above EVERY average, the bundle and the 200-day alike",
     ["Yes, clearing the bundle is the launch", "Yes, if it closes in the top half of its range", "Yes, on double volume"],
     "The launch bar must close above every moving average, the 8/21/50 AND the 200. Clearing the chunk while still "
     "under the 200 (WSM), or closing inside the chunk (ADSK), is not the launch."),
    ("High Volume Edge", "21",
     "A mega-cap closes up on the highest volume of the year, about three times normal. High Volume Edge?",
     "No: that is an HVC, a high-volume close; an HVE dwarfs everything before it, ten times normal and above the record",
     ["Yes, the highest volume of the year is the definition", "Yes, if it closed strong", "No, HVEs happen only on earnings days"],
     "Most of these are just HVC (high volume close) and PEGs. An HVE is a sudden major increase, a shit ton of volume, "
     "often on a lesser-known name, the start of a new story. Earnings days can count when the volume is truly massive."),
    ("High Volume Edge", "21",
     "Which session can never be marked as a High Volume Edge?",
     "An OPEX (third Friday) or month-end session",
     ["An earnings day", "A day on a lesser-known stock", "A day whose close is later traded below"],
     "Make sure we don't have end-of-month and OPEX days marked as HVE days: their volume is mechanical, not a new story."),
    ("High Volume Edge", "21",
     "Three weeks after an HVE the stock trades below the HVE close. What does the firm say?",
     "That is fine: the HVE close is a level to mark on the chart; it does not have to hold",
     ["The HVE failed and the level is erased", "It flips into a short setup", "It is re-labelled an HVC"],
     "They can go below the HVC, that's fine. It's meant to be a major level to mark out on your chart; the must-work "
     "rule does not apply to the HVE."),
    ("Slingshot", "7,8,23",
     "An earnings gapper runs, then pulls back four sessions. The closes sit under the 4-day average of the highs. "
     "Then it closes back above that average. Which setup?",
     "A Slingshot: the first pause after the gap, retaken",
     ["A Kicker Candle", "A Power Earnings Gap", "An Oops Reversal"],
     "A slingshot is a good rally up or an earnings gapper, THEN a consolidation, THEN the first close back above the "
     "4-day average of the highs. It is mostly the way to enter a PEG after its first pause."),
    ("Slingshot", "7,8",
     "The earnings gap-up day itself closes above the 4-day average of the highs. Is that the Slingshot trigger?",
     "No: the gap day or rally day is never the trigger; the trigger is the first close back over the average AFTER the pullback",
     ["Yes, any close above the 4-day average triggers it", "Yes, if the gap is over 5%", "Yes, if it closes near its high"],
     "The earnings gap does not count as the trigger. The order is a drive, then a consolidation, then the recapture of "
     "the 4-EMA of the highs."),
    ("Slingshot", "23",
     "Which trigger day is the gallery-quality Slingshot?",
     "A +3% to +6% day closing near its high with no gap, on ordinary volume",
     ["A +12% day on three times normal volume", "A day that gaps up 3% and closes mid-range", "A red day that holds the 50-day"],
     "The ones the owner called perfect and beautiful share a tight 3-7 session pullback and a decisive, technical "
     "trigger: no gap needed, a close near the high, volume near normal. A +11-13% day on big volume reads as a news day."),
    ("Slingshot", "15,23",
     "Kicker Candle versus Slingshot: what separates them?",
     "The Kicker reverses ONE weak red day on a gap; the Slingshot retakes the average after a MULTI-day pullback and needs no gap",
     ["Nothing; they are two names for one pattern", "The Kicker needs earnings; the Slingshot never has earnings behind it",
      "The Slingshot is intraday; the Kicker is daily"],
     "The Kicker traps the sellers of one red day with the next day's gap. The Slingshot is a drive, then three to seven "
     "sessions of closes under the 4-day average of the highs, then the first close back over it, a day that needs no gap."),
    ("Oops Reversal", "4,6",
     "Oops Reversal versus Kicker Candle: both trap sellers. How does each one OPEN?",
     "The Oops opens DOWN, below the prior close, and reverses up; the Kicker opens UP on a gap above the red day",
     ["Both open on a gap up", "Both open below the prior low", "The Oops opens flat; the Kicker opens down"],
     "The Oops traps the breakdown sellers at the open: it opens below the prior close (a Williams Oops below the prior "
     "low), then reverses. The Kicker traps the red day's sellers with a gap up that follows through."),
    ("Kicker Candle", "12",
     "Which stocks does the owner want every setup example drawn from?",
     "Liquid, sizable names he would trade, roughly $1B+ and $20M+ a day; obscure or sub-$10 tickers are out",
     ["Any ticker where the geometry is right", "Only the six mega-caps", "Only stocks under $20 so the chart moves"],
     "I want to see this in stocks I'd like to trade. Liquid and sizable. Obscure tickers are out even when the "
     "geometry is right, and a $7 stock was cut on price alone."),
]


def contrast_items() -> list[dict]:
    out = []
    for n, (setup, rulings, q, answer, distractors, lesson) in enumerate(CONTRASTS, 1):
        ref = f"{RULINGS}#ruling-{rulings}#contrast-{n:02d}"
        out.append(make_item(
            type="recall", skill_id=setup_skill(setup), q=q, answer=answer,
            choices=shuffled_choices(answer, distractors, ref),
            prompt_extra={"subject": f"contrast {n:02d}: {setup}", "note": "One answer is the owner's ruling."},
            reveal={"setup": setup, "quote": lesson, "source": ref, "rulings": rulings},
            source_kind="ruling", source_ref=ref, difficulty=3, lesson_text=quote_lesson(lesson)))
    return out


def main() -> int:
    items = contrast_items()
    path = write_segment("recall.contrasts", items)
    print(f"recall.contrasts: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
