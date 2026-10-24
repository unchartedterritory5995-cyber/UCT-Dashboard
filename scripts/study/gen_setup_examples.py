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
                  "Launchpad: after a bear market or a correction the moving averages converge into a tight bundle and the "
                  "stock is coiled to break either way. The convergence is the tell. It does not need the full 9 > 20 > 50 > 200 "
                  "stack (owner ruling 2026-10-23).", "uct_launch_pad"),
    "Kicker Candle": ("setup.family3.kicker",
                      "Kicker: a red candle the day before, then a decent-size gap up that follows through with a strong green "
                      "candle, closing above the prior day's high and near its own high. The shorts from the red day are trapped "
                      "(owner ruling 2026-10-23).", "uct_kicker"),
    "High Volume Edge": ("setup.family3.hve",
                         "High Volume Edge: an up day on the highest volume of the lookback. That day's close is the level the "
                         "biggest participants committed at, and price must defend it. Long only; a strong close is not required "
                         "(owner ruling 2026-10-23).", "uct_hve"),
    "Oops Reversal": ("setup.family4.oops",
                      "Oops Reversal (scanner version): opens below the prior close, trades under the prior day's low, then "
                      "reverses and closes above the prior close. A Williams Oops opens below the prior LOW and rallies back above "
                      "it. A Super Oops is any Oops that closes above the prior day's HIGH, engulfing the whole day (owner ruling "
                      "2026-10-23).", "uct_oops_reversal"),
    "Slingshot": ("setup.family4.slingshot",
                  "Slingshot: a good rally up or an earnings gapper, THEN a consolidation, THEN the first close back above the "
                  "4-day average of the highs. The gap day or rally day itself is never the trigger (owner ruling 2026-10-24).",
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
    if setup == "High Volume Edge":
        return f"Here the stock closed up {f.get('day_pct')}% on the heaviest volume of the lookback."
    if setup == "Oops Reversal":
        v = {"super": "a Super Oops: it also closed above the prior day's high",
             "williams+scanner": "also a Williams Oops: it opened below the prior day's low",
             "scanner": "a scanner Oops"}.get(f.get("variant"), "an Oops")
        return f"Here it opened {f.get('open_vs_prior_low_pct')}% from the prior low and closed up {f.get('day_pct')}%: {v}."
    if setup == "Slingshot":
        g, r = f.get("earnings_like_gap"), f.get("rally")
        drive = (f"an earnings-style gap of {g['gap_pct']}% {g['bars_ago']} sessions earlier" if g
                 else f"a {r['rally_pct']}% rally that peaked {r['bars_ago']} sessions earlier" if r else "the drive before it")
        return f"Here the drive was {drive}; the trigger day gapped only {f.get('trigger_gap_pct')}%."
    if setup == "Gap Support":
        return (f"Here the gap was {f.get('gap_pct')}% {f.get('bars_since_gap')} sessions earlier and price tested "
                f"{', '.join(f.get('levels_touched') or [])} and held.")
    if setup == "Go Signal":
        return f"Here the open swept {', '.join(f.get('swept') or [])} and the close finished at {f.get('dcr_pct')}% of the range."
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
        if facts.get("setup_score") is not None:
            # the Kicker pass-2 lesson names the three averages; the grounding check reads them here
            facts["ma_periods"] = [8, 21, 50]
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
