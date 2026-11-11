"""THE TRADE PLAN for a setup chart (the owner, 2026-11-08, on entry, stop, trim and trail: "Those answers are out there.
Either in the app, somewhere, or on the internet and available!"). They are in the app: every UCT setup detector
(api/services/pattern_engine/detectors/uct/) returns its own trigger and stop for the candle it fires on, the shared
`make_levels` turns them into targets at 2R and 3R, and each detector's narrative names how to trail. This reads those,
for the setup that fired on a chart's last candle, so a lesson can review the trade with real numbers. The full table,
with sources, is docs/study/TRADE_PLANS.md.

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
        "stop": "the edge bar's low",
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


def replay_checks(skill: str) -> list:
    """THE REPLAY STOPS AND ASKS (N033; the owner: pause in the replay "and ask about trimming, trailing, sell rules").
    Two questions the run-on holds on, answered from the plan's own words and nothing else (docs/study/TRADE_PLANS.md:
    "Trim is where to take some off: the detectors put the targets at 2R and 3R. They do not say how much to sell at
    each, so the course names the levels and does not invent a fraction"). At the first target: what the plan does
    there. At the second, only when the detector names a trail: what happens to the stop on what is left. The wrong
    choices are plainly not the plan; no other setup's trail is offered (most share "under each higher low", so one
    would be as right as another). Not scored: the member answers, reads why, and the replay runs on."""
    words = PLANS.get(skill) or {}
    out = [{
        "at": "t1",
        "q": "2R just traded. What does the plan do here?",
        "choices": ["Take some off: 2R is the first target", "Sell it all: the trade is done",
                    "Buy more: it is working", "Nothing: 2R is not part of the plan"],
        "answer": 0,
        "why": "The plan's targets are 2R and 3R, the places to take some off. It names the levels, not how much to sell; "
               "what is left rides on the stop.",
    }]
    trail = words.get("trail")
    if trail:
        out.append({
            "at": "t2",
            "q": "3R reached. What happens to the stop on what is left?",
            # "It trails under each higher low"; the Gap Support's own words read as a tightening, so they say that
            "choices": [f"It trails {trail}" if trail.startswith("under") else f"It tightens: {trail}",
                        "It stays where it started", "It comes off: the rest needs no stop", "It moves up to 3R"],
            "answer": 0,
            "why": f"This setup's plan for the stop on what is left: {trail}.",
        })
    return out


def plan(skill: str, raw_bars: list) -> Optional[dict]:
    """The trade on the chart's last candle when `skill` fires there: entry, stop, the 2R and 3R targets, the direction,
    the words for each, and the trail. None when the setup does not fire on the last bar or a rule cannot run."""
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
    return {
        "skill": skill, "direction": direction,
        "entry": lv["entry"], "stop": lv["stop"], "t1": lv["target_primary"], "t2": lv["target_secondary"],
        "risk_pct": round(risk / lv["entry"] * 100, 2) if lv["entry"] else None,
        # the Kicker trades through its trigger during the day; every other long setup here enters on the close
        "enters_intraday": skill in (KICKER, "setup.family4.oops"),
        "entry_note": words["entry"], "stop_note": words["stop"], "trail": words.get("trail"), "trim_note": words.get("trim"),
        "fails_note": words.get("fails"),
        "source": words["source"],
        # the questions the replay stops on (N033): at the targets, from these same words
        "checks": replay_checks(skill),
    }
