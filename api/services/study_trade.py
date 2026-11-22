"""THE TRADE PLAN for a setup chart (the owner, 2026-11-08, on entry, stop, trim and trail: "Those answers are out there.
Either in the app, somewhere, or on the internet and available!"). They are in the app: every UCT setup detector
(api/services/pattern_engine/detectors/uct/) returns its own trigger and stop for the candle it fires on, the shared
`make_levels` floors the stop, and each detector's narrative names how to trail. This reads those, for the setup that
fired on a chart's last candle, so a lesson can review the trade with real numbers. The full table, with sources, is
docs/study/TRADE_PLANS.md.

THE SELLS ARE THE OWNER'S, not the detectors' (docs/study/setups/RULINGS_2026-11-12.json; the Flat Base card's
`management`, docs/study/setups/criteria/01-flat-base.json, carries the same words). D-013, 2026-11-12, supersedes the
account rulebook's B19 "a third at 3R" and E51 "a third at 5R" (docs/study/sizing_rule.md section 9): "sometimes it is
not R based. SOmetimes it is day based. Looking for 3-5-7 day push for our first sell", and in chat the same day, "I
very rarely sell on the day 1 of the buy day. I usually wait until day 3 at the earliest. SO 3-5-7 day or 5-10 R is
often best." So the first sell is a judgment, later sells are a judgment too, and what is left trails. No question may
key "sell a third at 3R", or any day-1 sell, as the right answer. 3R and 5R stay on the chart as MARKS ON THE RULER
(`t1`, `t2`, named from `trim_r`, a key the client reads, kept for that): 3R is where the stop may move up to breakeven
(fb.breakeven: "between 2R and 5R, or at the first sell"; the replays move it at 3R, inside that window), 5R is inside
the 5 to 10R zone where a first sell into strength is often best. A gap up past a level at the open is not an automatic
sell (GAP-TRIM, superseding F63): selling part into a big gap is an optional judgment, never a rule. The trail reads
the 9 and 20 EMA (D-021: "9 and 20 EMA everywhere, with the 50 and 200 SMA"; E52's "10-day" and "21-day" read as them,
and the Study charts draw them, studyChartLook). The scanners' own 2R / 3R targets (`make_levels`, used app-wide) are
not changed here: Study's plan computes its own levels from the same entry and stop.

The owner's own words outrank a detector where he has ruled (2026-11-02, the Kicker): entry over the previous day's
high (the red day's high, on the Kicker day; his example JBI 2023-12-14, "11.05 over THE previous day high", the red
day's high was 11.04), which is the detector's trigger, and the stop "under the kicker candle low or entry with a 3.5%
stop", whichever is closer. Every value is read off the bars; nothing is invented for a setup the app does not cover.

D-003 (2026-11-12): "It is always just the trigger for each trade never the close": every setup, long or short, enters as
price trades through its trigger during the day. The Kicker and the Oops Reversal do (`enters_intraday`). The Slingshot,
the Launchpad, the High Volume Edge and the Gap Support detectors return the CLOSE as their trigger and expose no level
a member could buy through during the day (the Slingshot's `e4h_level` is that day's 4-EMA of the highs, which takes in
the day's own high, so it is known only at the close; the Launchpad is a state with no crossing; the high-volume close
and the Gap Support's held test are both read at the close). Their entries stay on the close until the owner names the
level (an open item in TRADE_PLANS.md): nothing here invents one.
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
# fall and the line it must stay under instead of inventing a trade (the owner's rule 8: nothing invented). The trails
# name the 9 EMA and the 20 EMA (D-021): the detectors' narratives said "the 10-day" and "the rising 21-day average".
PLANS = {
    KICKER: {
        "entry": "over the red day's high, on the Kicker day (or the day-1 30-minute opening-range break)",
        "stop": "under the Kicker's low, or 3.5% under the entry if that is closer",
        "trail": "under each higher low, or under the 9 EMA",
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
        "trail": "under the 9 EMA, or under each higher low",
        "source": "uct_slingshot.py",
    },
    "setup.family1.launchpad": {
        "entry": "the close out of the tight cluster of averages",
        # the detector's stop is measured off its own 21-day EMA (min(EMA21, SMA50) less a quarter ATR, or the cluster's
        # floor on the v4 rule): the words name what the number is, so they stay until the owner rules the level (D-021)
        "stop": "under the 21-day and 50-day averages, a quarter of a day's range below the lower one",
        "trail": "under the rising 20 EMA, or under each higher low",
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


TRIM_R = (3.0, 5.0)          # the marks on the ruler, 3R and 5R (D-013: marks, never fixed sells; the key keeps its name)
BREAKEVEN_AT = "t1"          # the replays move the stop to breakeven at 3R: inside his "between 2R and 5R" (fb.breakeven)


def replay_checks(skill: str) -> list:
    """THE REPLAY STOPS AND ASKS (N033; the owner: pause in the replay "and ask about trimming, trailing, sell rules").
    Two questions the run-on holds on, answered from the owner's rulings (D-013, fb.breakeven) and the plan's own words
    and nothing else. At 3R: hold, because 3R is a mark on the ruler and never a sell by itself; the stop may move up to
    breakeven. The old rule, "sell a third: 3R is a fixed trim", is offered as a WRONG choice, and the why says what
    changed. At 5R, only when the detector names a trail: sell some into strength if it is day 3 or later, and trail the
    rest the way this setup's plan says. The other wrong choices are plainly not the plan; no other setup's trail is
    offered (most share "under each higher low", so one would be as right as another). Not scored: the member answers,
    reads why, and the replay runs on. The client knows the session each mark traded on (replayTicks.replayChecks) and
    adds the day to the why: `early` when it is day 1 or 2 (the buy day is day 1), `later` from day 3."""
    words = PLANS.get(skill) or {}
    out = [{
        "at": "t1",
        "q": "3R just traded. What does the plan do here?",
        "choices": ["Hold: 3R is a mark, and the stop can move up to breakeven", "Sell a third: 3R is a fixed trim",
                    "Sell it all: the trade is done", "Buy more: it is working"],
        "answer": 0,
        "why": "3R is a mark on the ruler, not a sell order. A fixed third at 3R is not our rule: the first sell is a "
               "judgment. We very rarely sell on day 1 and usually wait until day 3 at the earliest, then sell "
               "into a 3, 5 or 7 day push, or at about 5 to 10R. The stop can move up to breakeven anywhere from 2R to 5R.",
        "early": "That is too early to sell, so holding is the plan today.",
        "later": "From day 3 on a sell into a strong push can be a judgment, but 3R itself is never the reason.",
    }]
    trail = words.get("trail")
    if trail:
        # "trails under each higher low"; the Gap Support's own words read as a tightening, so they say that
        rest = f"trail the rest {trail}" if trail.startswith("under") else f"what is left tightens: {trail}"
        out.append({
            "at": "t2",
            "q": "5R reached. What does the plan do?",
            "choices": [f"Sell some into strength if it is day 3 or later, and {rest}",
                        "Sell it all here: 5R is the finish line", "Buy more: it is running",
                        "Move the stop up to 5R and hold"],
            "answer": 0,
            "why": "5R sits in the 5 to 10R zone where a first sell into strength is often best, by judgment, usually "
                   f"day 3 or later. What is left trails: {trail}.",
            "early": "That is too early to sell by our rule, so the plan holds today and sells into strength from day 3 on.",
            "later": "Selling some here is often best; holding is a judgment too.",
        })
    return out


def plan(skill: str, raw_bars: list) -> Optional[dict]:
    """The trade on the chart's last candle when `skill` fires there: entry, stop, the marks at 3R and 5R (t1, t2), the
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
        "trim_r": list(TRIM_R), "breakeven_at": BREAKEVEN_AT,
        "risk_pct": round(risk / lv["entry"] * 100, 2) if lv["entry"] else None,
        # the Kicker and the Oops trade through their trigger during the day; the other four still enter on the close,
        # because their detectors name no level to buy through (D-003, an open item for the owner: see the docstring)
        "enters_intraday": skill in (KICKER, "setup.family4.oops"),
        "entry_note": words["entry"], "stop_note": words["stop"], "trail": words.get("trail"), "trim_note": words.get("trim"),
        "fails_note": words.get("fails"),
        "source": words["source"],
        # the questions the replay stops on (N033): at the marks, from these same words
        "checks": replay_checks(skill),
    }
