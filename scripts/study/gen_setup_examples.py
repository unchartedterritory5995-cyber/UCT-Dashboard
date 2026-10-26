"""gen_setup_examples -- `spot` items for the firm's setups from VARIED real
charts (owner ruling 2026-10-24: "You keep using the same charts as examples
for like a variety of different setups").

The fixture-based items (gen_fixtures.py) reuse the same six mega-caps over
2022. This generator reads docs/study/setups/setup_examples.json, written by
the read-only pod scan (scratchpad pod_find_setups.py: the firm's own
detectors over a wide candidate list and ~6 years of bars.db, then the owner's
setup-by-setup rulings of 2026-10-23/24 applied on top). Each item carries a
`bars` SPEC (sym / tf / asof / window / forward); the import route resolves the
bars on the pod through get_bars_before only (B3). The owner reviews every
chart on the review screen; nothing here goes live on its own.

  python -I -X utf8 scripts/study/gen_setup_examples.py
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study._common import REPO, load_json, make_item, write_segment  # noqa: E402

SOURCE = "docs/study/setups/setup_examples.json"
WINDOW, FORWARD = 120, 20

#: setup -> (skill_id, the owner's definition in his words, the detector's name)
SETUPS = {
    "Launchpad": ("setup.family1.launchpad",
                  "Launchpad: after a real correction the 8, 21 and 50-day averages chunk up into a tight bundle at or near the "
                  "200-day while price lives UNDER and through the bundle for weeks in a long flat base, dangling and retesting "
                  "it; the launch is the FIRST bar that closes above every average, the bundle and the 200-day alike, as they "
                  "stack into 8 > 21 > 50. It is the convergence and the dangle, not a breakout: a stock riding on top of its "
                  "averages that breaks out is a base breakout (owner rulings 2026-10-23/24).", "uct_launch_pad"),
    "Kicker Candle": ("setup.family3.kicker",
                      "Kicker: the stock is already set up, in an uptrend or a clean base; the day before closes red and WEAK near "
                      "its low, an almost-failed breakdown with a real body (about 1-5% of price); then the next day gaps up and "
                      "follows through with a strong green candle that closes above the red day's high and near its own high, "
                      "usually on a volume surge. The sellers from the red day are trapped. It is short-term positioning and "
                      "rarely an earnings day: an earnings-day gap is an earnings gapper, a baby red candle before a gap is just a "
                      "breakout, and a gap against a downtrend is a different setup (owner rulings 2026-10-23/24).", "uct_kicker"),
    "High Volume Edge": ("setup.family3.hve",
                         "High Volume Edge: an up day on a volume that DWARFS everything before it, ten times normal and above the prior "
                         "record, often on a lesser-known name, the start of a new story; an earnings day counts when the volume is "
                         "truly massive. That day's close is a LEVEL to mark on the chart, the price the biggest participants committed "
                         "at; price may trade under it later. It is not an HVC (any high-volume close) and not a PEG (an earnings gap "
                         "on big but ordinary volume); OPEX and month-end sessions do not count (owner rulings 2026-10-23/25).", "uct_hve"),
    "Oops Reversal": ("setup.family4.oops",
                      "Oops Reversal (scanner version): opens below the prior close, trades under the prior day's low, then reverses "
                      "and closes above the prior close. A Williams Oops opens below the prior LOW and rallies back above it. A Super "
                      "Oops closes above the prior day's HIGH, engulfing the whole day. LOCATION is the main thing: it comes at the "
                      "end of an orderly drift lower, a flag, a wedge, a double bottom or the end of a downtrend, into a buyable spot, "
                      "with orderly days before it (no news gap, no outsized red bar) and a technical, not news-sized, Oops day; the "
                      "Oops-day low must never break afterwards (owner rulings 2026-10-23/24).", "uct_oops_reversal"),
    "Slingshot": ("setup.family4.slingshot",
                  "Slingshot: a drive first, usually an earnings gapper (it is mostly the way into a power earnings gap after its "
                  "first pause), sometimes a strong rally; THEN a tight orderly pullback of three to seven sessions, about 5-12% "
                  "deep, with the closes under the 4-day average of the highs; THEN the trigger, the first close back above that "
                  "average, a decisive day that closes near its high and needs no gap. The gap day or rally day itself is never the "
                  "trigger, and the 200-day is not required (owner rulings 2026-10-24/25).",
                  "uct_slingshot"),
    "Gap Support": ("setup.family3.gap_support",
                    "Gap Support (detector definition, owner ruling pending): a stock gaps up at least 4% on twice its normal "
                    "volume and holds the gap; weeks later it pulls back into the gap area and buyers defend it, closing above "
                    "the gap top.", "uct_gap_support"),
    "Go Signal": ("setup.intraday.go_signal",
                  "Go Signal, daily footprint (detector definition, owner ruling pending): in a stock that has already shown it "
                  "can move, the session opens weak, sweeps a nearby support, and buyers turn it to a strong close. The real "
                  "trigger is intraday.", "uct_go_signal"),
}


def fact_line(setup: str, ex: dict) -> str:
    f = ex.get("facts") or {}
    if setup == "Kicker Candle":
        line = (f"Here the stock gapped up {f.get('gap_pct')}% after a red day and closed up {f.get('day_pct')}%, "
                f"above the prior day's high, at {f.get('close_pos_pct')}% of its range")
        line += " on its earnings report." if f.get("earnings_day") else "."
        if f.get("setup_score") is not None:
            # pass 2 (owner 2026-10-24: the best kicker fires out of a setup that is already there)
            line += (f" The setup was already there: the 8, 21 and 50-day averages sat within {f.get('ma_spread_pct')}% "
                     f"of each other, the prior 20 closes spanned {f.get('base20_range_pct')}%, and the kicker closed "
                     + ("above the 20-day high." if f.get("breakout20") else "inside the base."))
        return line
    if setup == "Launchpad" and f.get("correction_abs_pct") is not None:
        # pass 2 (owner definition, 2026-10-24): the correction, the convergence, the coil
        return (f"Here the stock had corrected {f.get('correction_abs_pct')}% from its high, the 8, 21 and 50-day averages "
                f"sat within {f.get('ma_spread_pct')}% of each other with price {f.get('s200_dist_pct')}% from the 200-day, "
                f"the prior 30 closes spanned {f.get('base30_range_pct')}%, and the last bar closed up {f.get('day_pct')}%"
                + (" above the 20-day high." if f.get("breakout20") else " inside the base.")
                + (" Earnings day." if f.get("earnings_day") else ""))
    if setup == "High Volume Edge":
        return f"Here the stock closed up {f.get('day_pct')}% on the heaviest volume of the lookback."
    if setup == "Oops Reversal":
        v = {"super": "a Super Oops: it also closed above the prior day's high",
             "williams+scanner": "also a Williams Oops: it opened below the prior day's low",
             "scanner": "a scanner Oops"}.get(f.get("variant"), "an Oops")
        line = f"Here it opened {f.get('open_vs_prior_low_pct')}% from the prior low and closed up {f.get('day_pct')}%: {v}."
        if f.get("setup_score") is not None:
            # pass 2 (owner 2026-10-24): the setup behind the day
            level = ("the 21 or 50-day average" if f.get("low_near_ma") else
                     "a prior swing low" if f.get("low_near_swing_low") else "no obvious level")
            line += (f" The setup was already there: the stock was above its 200-day, had pulled back {f.get('pullback_pct')}% "
                     f"from its 20-day high, the dip tested {level}, and the close "
                     + ("reclaimed the 21-day average" if f.get("reclaims_e21") else "stayed under the 21-day average")
                     + (" on its earnings report." if f.get("earnings_day") else "."))
        return line
    if setup == "Slingshot":
        g, r = f.get("earnings_like_gap"), f.get("rally")
        drive = (f"an earnings-style gap of {g['gap_pct']}% {g['bars_ago']} sessions earlier" if g
                 else f"a {r['rally_pct']}% rally that peaked {r['bars_ago']} sessions earlier" if r else "the drive before it")
        if f.get("pullback_sessions") is not None and f.get("close_pos_pct") is not None:
            # pass 2 (owner review 2026-10-25): the pullback and the trigger day, measured
            return (f"Here the drive was {drive}; the pullback ran {f.get('pullback_sessions')} sessions and "
                    f"{f.get('pullback_depth_abs_pct')}% deep under the 4-day average of the highs; the trigger day closed up "
                    f"{f.get('day_pct')}% at {f.get('close_pos_pct')}% of its range, gapping {f.get('trigger_gap_pct')}%.")
        return f"Here the drive was {drive}; the trigger day gapped only {f.get('trigger_gap_pct')}%."
    if setup == "Gap Support":
        words = {"top": "the gap top (the prior day's high)", "glow": "the gap day's low", "mid": "the middle of the gap",
                 "gopen": "the gap day's open"}
        levels = [words.get(x, x) for x in (f.get("levels_touched") or [])]
        line = (f"Here the gap was {f.get('gap_pct')}% {f.get('bars_since_gap')} sessions earlier; the test touched "
                f"{', '.join(levels) or 'a gap level'} and closed {f.get('close_vs_gap_top_pct')}% above the gap top")
        if f.get("first_test") is not None:
            line += ", the first test of the gap" if f.get("first_test") else ", not the first test of the gap"
        line += f"; the day closed at {f.get('dcr_pct')}% of its range." if f.get("dcr_pct") is not None else "."
        return line
    if setup == "Go Signal":
        words = {"prior_low": "the prior day's low", "5bar_low": "the five-day low", "ema9": "the 9-day average",
                 "ema20": "the 20-day average", "sma50": "the 50-day average"}
        swept = [words.get(x, x) for x in (f.get("swept") or [])]
        line = (f"Here the session opened {f.get('open_vs_prior_close_pct')}% against the prior close, swept "
                f"{', '.join(swept) or 'a nearby support'}, and closed at {f.get('dcr_pct')}% of the range")
        line += " and back above the prior close (red to green)." if f.get("red_to_green") else "."
        return line + " The daily bar is the footprint; the real trigger is intraday."
    return ""


def items_for(examples: list[dict]) -> list[dict]:
    out = []
    for ex in examples:
        setup = ex["setup"]
        if setup not in SETUPS:
            continue
        skill, definition, detector = SETUPS[setup]
        ref = f"{SOURCE}#{setup}#{ex['sym']}#{ex['asof']}"
        facts = dict(ex.get("facts") or {})
        # the lesson quotes these as whole percentages; the grounding check reads the facts
        for k in ("close_pos", "dcr"):
            if facts.get(k) is not None:
                facts[k + "_pct"] = int(round(float(facts[k]) * 100))
        if facts.get("pullback_depth_pct") is not None:
            facts["pullback_depth_abs_pct"] = round(abs(float(facts["pullback_depth_pct"])), 1)
        if facts.get("setup_score") is not None:
            # the Kicker pass-2 lesson names the three averages; the grounding check reads them here
            facts["ma_periods"] = [8, 20, 21, 30, 50, 200]
        ex = dict(ex, facts=facts)
        reveal = {"detector": detector, "setup": setup, "fires": True, "quote": definition,
                  "facts": facts, "source": ref, "window_bars": WINDOW,
                  "example": {"sym": ex["sym"], "asof": ex["asof"], "found_by": "pod_find_setups.py (read-only scan)"}}
        out.append(make_item(
            type="spot", skill_id=skill, q=f"Does the firm's {setup} setup fire on the last bar of this chart?",
            answer="yes", choices=["Yes", "No"],
            prompt_extra={"chart": {"window_bars": WINDOW, "tf": "D"}},
            reveal=reveal, lesson_text=(definition + " " + fact_line(setup, ex)).strip(), lesson_origin="session",
            source_kind="setups", source_ref=ref, difficulty=3,
            sym=ex["sym"], asof=ex["asof"], adjustment_basis="split-adjusted",
            bars={"sym": ex["sym"], "tf": "D", "asof": ex["asof"], "window": WINDOW, "forward": FORWARD}))
    return out


def main() -> int:
    data = load_json(REPO / SOURCE)
    items = items_for(data["examples"])
    path = write_segment("spot.setups", items)
    print(f"spot.setups: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
