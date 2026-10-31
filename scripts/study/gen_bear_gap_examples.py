"""Builds the Bear Gap off the Highs drafts for the owner's review: docs/study/bank/spot.bear_gaps.json.

The owner, cutting NFLX 2022-02-07 from Gap Support on 2026-10-27: "Don't want to do downtrend gaps but will
do bear gaps off the highs". This generator reads docs/study/setups/bear_gap_examples.json (written from the
read-only pod scan scripts/study/find_bear_gap_examples.py) and makes one `spot` item per pick, the gap day
itself as the last visible bar, 120 sessions of context and a 20-session forward strip resolved from the pod's
daily store at import (the same `bars` spec as spot.setups). The definition is marked OWNER RULING PENDING:
nothing here states what the lesson teaches; the measured fact line states what the chart shows. Drafts only.

    python -X utf8 scripts/study/gen_bear_gap_examples.py
"""
import os, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)
from scripts.study._common import load_json, make_item, write_segment  # noqa: E402

SOURCE = "docs/study/setups/bear_gap_examples.json"
SKILL = "setup.family3.bear_gap"
SETUP = "Bear Gap off the Highs"
WINDOW, FORWARD = 120, 20

DEFINITION = ("Bear Gap off the Highs (owner ruling pending; owner 2026-10-27: \"Don't want to do downtrend gaps but will "
              "do bear gaps off the highs\"): the FIRST true gap down since a recent top, marked on the gap day itself. "
              "It is not Gap Support (a gap UP that is later tested) and not a gap inside a downtrend (cut). What this "
              "lesson teaches is the owner's to rule on the charts.")

AFTER = {"gap_held": "the stock never traded back into the gap",
         "gap_entered": "the stock traded back into the gap but never closed above the gap-fill level",
         "gap_filled": "the stock closed back above the gap-fill level (the gap filled)"}


def fact_line(f: dict) -> str:
    if f.get("prior_above_50") and f.get("prior_above_200"):
        trend = "above its 50 and 200-day"
    elif f.get("prior_above_200"):
        trend = "under its 50-day but above its 200-day"
    elif f.get("prior_above_50"):
        trend = "above its 50-day but under its 200-day"
    else:
        trend = "under its 50 and 200-day"
    line = (f"Here the stock set its top {f.get('sessions_since_top')} sessions earlier and closed "
            f"{f.get('prior_close_vs_250d_high_pct')}% from it the day before, {trend}; it gapped {f.get('gap_pct')}% at the "
            f"open on {f.get('rvol')}x volume and closed down {f.get('day_pct')}% at {f.get('dcr_pct')}% of its range")
    line += ", under the 50-day" if f.get("close_below_50") else ""
    line += " on its earnings report." if f.get("earnings_day") else "."
    if f.get("after_kind") in AFTER:
        line += f" Over the next 20 sessions {AFTER[f['after_kind']]}"
        if f.get("fwd_20d_pct") is not None:
            line += f"; twenty sessions on it was {f['fwd_20d_pct']}% from the gap-day close"
        line += "."
    return line


def build_item(ex: dict) -> dict:
    f = dict(ex.get("facts") or {})
    if f.get("dcr") is not None:
        f["dcr_pct"] = int(round(float(f["dcr"]) * 100))
    f["setup"] = SETUP
    ref = f"{SOURCE}#{SETUP}#{ex['sym']}#{ex['asof']}"
    reveal = {"detector": "find_bear_gap_examples", "setup": SETUP, "fires": True, "quote": DEFINITION,
              "facts": f, "source": ref, "window_bars": WINDOW,
              "example": {"sym": ex["sym"], "asof": ex["asof"], "found_by": "find_bear_gap_examples.py (read-only pod scan)"}}
    return make_item(
        type="spot", skill_id=SKILL,
        q="Is the last bar a bear gap off the highs: the first true gap down from a top?",
        answer="yes", choices=["Yes", "No"],
        prompt_extra={"chart": {"window_bars": WINDOW, "tf": "D"}},
        reveal=reveal, lesson_text=(DEFINITION + " " + fact_line(f)).strip(), lesson_origin="session",
        source_kind="setups", source_ref=ref, difficulty=3,
        sym=ex["sym"], asof=ex["asof"], adjustment_basis="split-adjusted",
        bars={"sym": ex["sym"], "tf": "D", "asof": ex["asof"], "window": WINDOW, "forward": FORWARD})


def main() -> int:
    data = load_json(os.path.join(REPO, SOURCE))
    items = [build_item(ex) for ex in data["examples"]]
    path = write_segment("spot.bear_gaps", items)
    kinds = {}
    for ex in data["examples"]:
        k = (ex.get("facts") or {}).get("after_kind"); kinds[k] = kinds.get(k, 0) + 1
    print(f"spot.bear_gaps: {len(items)} items -> {path}; after kinds {kinds}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
