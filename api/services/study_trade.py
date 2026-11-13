"""THE TRADE PLAN for a setup chart (the owner, 2026-11-08, on entry, stop, trim and trail: "Those answers are out there.
Either in the app, somewhere, or on the internet and available!"). They are in the app: every UCT setup detector
(api/services/pattern_engine/detectors/uct/) returns its own trigger and stop for the candle it fires on, the shared
`make_levels` floors the stop, and each detector's narrative names how to trail. This reads those, for the setup that
fired on a chart's last candle, so a lesson can review the trade with real numbers. The full table, with sources, is
docs/study/TRADE_PLANS.md.

THE TRIMS ARE THE HOUSE'S, not the detectors' (the account rulebook, docs/study/sizing_rule.md section 9, the owner
2026-11-09): sell a third at 3R (B19, the hard rule), a third at 5R (E51), trail the last third (E52, or the detector's
own trail where it names one); the stop on what is left moves up to breakeven at the first trim (B19: "breakeven stop
at 2-5R ideally"; the first trim is the taught default inside that window); a trim level the day opens past is taken at
the open (F63). The scanners' own 2R / 3R targets (`make_levels`, used app-wide) are not changed here: Study's plan
computes its own levels from the same entry and stop.

The owner's own words outrank a detector where he has ruled (2026-11-02, the Kicker): entry over the previous day's
high (the red day's high, on the Kicker day; his example JBI 2023-12-14, "11.05 over THE previous day high", the red
day's high was 11.04), which is the detector's trigger, and the stop "under the kicker candle low or entry with a 3.5%
stop", whichever is closer. Every value is read off the bars; nothing is invented for a setup the app does not cover.
"""
from __future__ import annotations

import logging
from typing import Optional

from api.services import study_hard
from api.services.pattern_engine.detectors.uct import uct_setups_common as U

log = logging.getLogger(__name__)

KICKER = "setup.family3.kicker"
BEAR_GAP = "setup.family3.bear_gap"
KICKER_MAX_STOP = 0.035     # the owner, 2026-11-02

# what each detector says, in words a member reads (the detector named beside each). The Bear gap has none: the app
# defines no trade for it (its finder marks the first crack off a top), and the obvious stop, the gap day's high, sat 25%
# over the close on VRNS 2025-10-29 (a gap that opened 37% down and closed at the day's low), so the lesson measures the
# fall and the line it must stay under instead of inventing a trade (the owner's rule 8: nothing invented).
PLANS = {
    KICKER: {
        "entry": "over the red day's high, on the Kicker day (or the day-1 30-minute opening-range break)",
        "stop": "under the Kicker's low, or 3.5% under the entry if that is closer",
        "trail": "under each higher low, or under the 10-day average",
        "source": "uct_kicker.py; the owner's Kicker rulings, 2026-11-02",
    },
    "setup.family4.oops": {
        "entry": "the prior close, reclaimed during the day",
        "stop": "the day's low",
        "trail": "under each higher low",
        "source": "uct_oops_reversal.py",
    },
    "setup.family4.slingshot": {
        "entry": "the close back over the 4-day average of the highs",
        "stop": "the trigger day's low (the day before's low is the wider choice)",
        "trail": "under the 10-day average, or under each higher low",
        "source": "uct_slingshot.py",
    },
    "setup.family1.launchpad": {
        "entry": "the close out of the tight cluster of averages",
        "stop": "under the 21-day and 50-day averages, a quarter of a day's range below the lower one",
        "trail": "under the rising 21-day average, or under each higher low",
        "source": "uct_launch_pad.py",
    },
    "setup.family3.hve": {
        "entry": "the high-volume close",
        "stop": "the edge bar's low (its high on a down close)",
        "trail": None,
        "trim": "the first return to the high-volume close, often weeks later, is the cleanest decision point",
        "source": "uct_hve.py",
    },
    "setup.family3.gap_support": {
        "entry": "the close, as the gap holds",
        "stop": "the gap top or the day's low, whichever is lower",
        "trail": "if it drifts sideways at the gap, a tighter stop just under the gap top",
        "trim": "the post-gap high is the first place to take some off",
        "source": "uct_gap_support.py",
    },
}


TRIM_R = (3.0, 5.0)          # the house trims: a third at 3R, a third at 5R (sizing_rule.md section 9, B19 and E51)
TRIM_FRACTION = "a third"
BREAKEVEN_AT = "t1"          # the stop on what is left moves to breakeven at the first trim (B19, inside his 2R-5R window)


def replay_checks(skill: str) -> list:
    """THE REPLAY STOPS AND ASKS (N033; the owner: pause in the replay "and ask about trimming, trailing, sell rules").
    Two questions the run-on holds on, answered from the house rules and the plan's own words and nothing else. At 3R,
    the first trim: sell a third and move the stop on the rest to breakeven (the account rulebook, B19). At 5R, the
    second trim, only when the detector names a trail: sell another third and trail the last third the way this
    setup's plan says (E51; the detector's trail). The wrong choices are plainly not the plan; no other setup's trail
    is offered (most share "under each higher low", so one would be as right as another). Not scored: the member
    answers, reads why, and the replay runs on."""
    words = PLANS.get(skill) or {}
    out = [{
        "at": "t1",
        "q": "3R just traded. What does the plan do here?",
        "choices": ["Sell a third, stop to breakeven: 3R is the first trim", "Sell it all: the trade is done",
                    "Buy more: it is working", "Nothing: 3R is not part of the plan"],
        "answer": 0,
        "why": "Our first trim is a third at 3R, and the stop on the rest moves up to breakeven. The other two thirds "
               "stay on: the next third comes off at 5R.",
    }]
    trail = words.get("trail")
    if trail:
        out.append({
            "at": "t2",
            "q": "5R reached. What does the plan do with what is left?",
            # "trails under each higher low"; the Gap Support's own words read as a tightening, so they say that
            "choices": [f"Sell another third; the last third trails {trail}" if trail.startswith("under")
                        else f"Sell another third; the last third tightens: {trail}",
                        "Sell it all here: 5R is the finish line", "Hold all of it on the breakeven stop",
                        "Move the stop up to 5R and hold"],
            "answer": 0,
            "why": f"Our second trim is a third at 5R. The last third trails: {trail}.",
        })
    return out


def plan(skill: str, raw_bars: list) -> Optional[dict]:
    """The trade on the chart's last candle when `skill` fires there: entry, stop, the trims at 3R and 5R (t1, t2), the
    direction, the words for each, and the trail. None when the setup does not fire on the last bar or a rule cannot run."""
    words = PLANS.get(skill)
    rules = study_hard.SETUP_RULES.get(skill)
    if not words or not rules:
        return None
    bars = study_hard._as_bars(raw_bars)
    n = len(bars)
    if n < 25:
        return None
    i = n - 1
    try:
        S = U.series(bars)
    except Exception as e:  # noqa: BLE001
        log.warning("study_trade: series failed: %s", e)
        return None
    cand = None
    for rule in rules:
        try:
            c = rule(bars, S, i)
        except Exception as e:  # noqa: BLE001
            log.warning("study_trade: %s rule raised: %s", skill, e)
            return None
        if c:
            cand = c
            break
    if not cand:
        return None
    b, p = bars[i], bars[i - 1]
    direction = "bullish"
    if skill == "setup.family3.hve":
        direction = cand.get("direction") or ("bullish" if b["c"] >= p["c"] else "bearish")
        entry = cand.get("trigger", b["c"])
        stop = cand.get("stop", b["l"] if direction == "bullish" else b["h"])
    else:
        entry = cand.get("trigger")
        stop = cand.get("stop")
        if entry is None or stop is None:       # a second rule (williams_oops, volume_edge) speaks in its own keys
            entry = p["c"] if skill == "setup.family4.oops" else b["c"]
            stop = b["l"]
    if skill == KICKER:
        # "11.05 over THE previous day high" (JBI, the red day's high 11.04): a cent over it when the day opened under it
        if cand.get("prior_high") is not None and entry == cand["prior_high"]:
            entry = round(entry + 0.01, 2)
        stop = max(stop, entry * (1 - KICKER_MAX_STOP))
    lv = U.make_levels(float(entry), float(stop), direction, entry_condition=words["entry"], stop_basis=words["stop"])
    risk = abs(lv["entry"] - lv["stop"])
    sign = 1.0 if direction == "bullish" else -1.0
    t1, t2 = (round(lv["entry"] + sign * m * risk, 2) for m in TRIM_R)
    return {
        "skill": skill, "direction": direction,
        "entry": lv["entry"], "stop": lv["stop"], "t1": t1, "t2": t2,
        "trim_r": list(TRIM_R), "trim_fraction": TRIM_FRACTION, "breakeven_at": BREAKEVEN_AT,
        "risk_pct": round(risk / lv["entry"] * 100, 2) if lv["entry"] else None,
        # the Kicker trades through its trigger during the day; every other long setup here enters on the close
        "enters_intraday": skill in (KICKER, "setup.family4.oops"),
        "entry_note": words["entry"], "stop_note": words["stop"], "trail": words.get("trail"), "trim_note": words.get("trim"),
        "fails_note": words.get("fails"),
        "source": words["source"],
        # the questions the replay stops on (N033): at the targets, from these same words
        "checks": replay_checks(skill),
    }
