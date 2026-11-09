"""BANK V2: "Which base did this stock just break out of?" questions from Chart IQ's base names (scan_bases.py).

Segment chart.bases, skill read.bases (the Foundations track F4, Patterns and bases). Each item is a breakout day where
Chart IQ (v3_bases.find_base + classify, the engine's own step) names the base under the last bar and calls the day a
breakout, from the top 1,000 stocks by dollar volume that day, held over 20 sessions, the whole base inside the member's
120-bar chart. Spread like the other bank v2 families (gen_chartiq.pick: six eras, two per stock, one per date, sectors),
each chart covered by the web pod's own bars (pod_coverage.py) and checked against Yahoo (second_source.py). The lesson
states the base's rule as the engine applies it (the numbers are its constants), then Chart IQ's reading of this base.
All drafts: the owner approves each on the review screen.

  python -X utf8 scripts/study/bank_v2/gen_bases.py --bases <bases.jsonl.gz> --bars-db <bars.db>
"""
from __future__ import annotations

import argparse
import gzip
import json
import pathlib
import sys
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from scripts.study._common import make_item, write_segment  # noqa: E402
from scripts.study.bank_v2 import gen_chartiq as G  # noqa: E402
from scripts.study.bank_v2 import second_source  # noqa: E402
from scripts.study.bank_v2.pod_coverage import PodCoverage  # noqa: E402

# The rules as v3_bases.classify / is_vcp apply them, in words; the numbers are the engine's constants.
BASE_DEF = {
    "High tight flag": "a pole of 90% or more in the 40 sessions before the base, then a flag no more than 25% deep and "
                       "no longer than 30 sessions.",
    "PEG flag": "a flag no longer than 30 sessions and no more than 30% deep that sits on top of an earnings or news gap "
                "from the start of the base: the pause after a power earnings gap.",
    "Double bottom (undercut)": "two lows at least 10 sessions apart, the second at or under the first (never more than "
                                "4% above it), with a middle peak at least halfway up the base; the buy point is the "
                                "middle peak.",
    "Cup with handle": "a U-shaped cup at least 30 sessions long and 15% to 50% deep, its low in the middle of the base and "
                       "price recovering at least 60% of the way back, then a handle of 3 or more sessions, no deeper than "
                       "15%, in the upper half of the cup.",
    "Cup without handle": "a U-shaped cup at least 30 sessions long and 15% to 50% deep, its low in the middle of the base, "
                          "price recovering at least 60% of the way back, and no handle before the breakout.",
    "Bull flag": "a pole of 15% or more in the 25 sessions before, then a flag of 5 to 20 sessions no more than 20% deep.",
    "Flat base": "a sideways base no more than 22% deep (15% for a short one, under 20 sessions).",
    "VCP": "a volatility contraction pattern: two or three pullbacks inside the base, each at most 80% as deep as the one "
           "before, the last one 12% or less, the lows holding.",
    "Consolidation / range": "a sideways range that fits no cleaner shape, or a first range with no advance before it.",
    "Faulty / wide and loose": "a base deeper than 50%: wide and loose, not a buyable shape.",
}
CONFUSE = {
    "Cup with handle": ["Cup without handle", "Double bottom (undercut)", "Flat base"],
    "Cup without handle": ["Cup with handle", "Double bottom (undercut)", "Consolidation / range"],
    "Double bottom (undercut)": ["Cup without handle", "Cup with handle", "Consolidation / range"],
    "Flat base": ["VCP", "Consolidation / range", "Bull flag"],
    "VCP": ["Flat base", "Cup with handle", "Consolidation / range"],
    "Bull flag": ["High tight flag", "Flat base", "PEG flag"],
    "High tight flag": ["Bull flag", "PEG flag", "Flat base"],
    "PEG flag": ["Bull flag", "High tight flag", "Flat base"],
    "Consolidation / range": ["Flat base", "VCP", "Double bottom (undercut)"],
    "Faulty / wide and loose": ["Cup without handle", "Consolidation / range", "Double bottom (undercut)"],
}
RULE_NUMBERS = {"htf_pole": 90, "htf_pole_days": 40, "htf_depth": 25, "htf_len": 30, "peg_len": 30, "peg_depth": 30,
                "db_gap": 10, "db_over": 4, "cup_len": 30, "cup_depth": [15, 50], "cup_rec": 60, "handle_len": 3,
                "handle_depth": 15, "flag_pole": 15, "flag_days": 25, "flag_len": [5, 20], "flag_depth": 20, "flat_depth": 22,
                "flat_short": 15, "flat_short_len": 20, "vcp_ratio": 80, "vcp_last": 12, "faulty": 50, "vcp_count": [2, 3]}
Q = "Which base did this stock just break out of?"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bases", required=True)
    ap.add_argument("--bars-db", required=True)
    ap.add_argument("--per-type", type=int, default=100)
    ap.add_argument("--top", type=int, default=1000)
    a = ap.parse_args(argv)
    sec = G.sectors()
    G.YAHOO.update(second_source.load_cache(G.YAHOO_CACHE))
    G.POD.update(cov=PodCoverage(a.bars_db), keep=set())
    rows = [json.loads(x) for x in gzip.open(a.bases, "rt", encoding="utf-8")]
    rows = [dict(r, name=r["base"]["type"]) for r in rows
            if r.get("base") and G.liquid(r, a.top) and sec.get(r["sym"]) != "ETF"]
    out, dropped = [], Counter()
    for bt in BASE_DEF:
        pool = [r for r in rows if r["name"] == bt]
        for r in G.pick(pool, a.per_type * 2, sec):
            if sum(1 for x in out if x["prompt_json"]["subject"] == bt) >= a.per_type:
                break
            if not G.pod_ok(r["sym"], r["t"]) or not G.yahoo_ok(r["sym"], r["t"], a.bars_db):
                dropped[bt] += 1
                continue
            b, asof = r["base"], G.iso(r["t"])
            ref = f"chart_iq.v3_bases.classify#{bt}#{r['sym']}#{asof}"
            facts = {"base": bt, "chartiq_reading": b["note"], "pivot": b["pivot"], "base_low": b["low"],
                     "depth_pct": b["depth_pct"], "base_sessions": b["bars"], "base_start": b["start"], "base_end": b["end"],
                     "vcp_contractions_pct": b.get("vcp"), "breakout_event": r["event"], "rule_text": BASE_DEF[bt],
                     "rule_numbers": RULE_NUMBERS, "era": G.era_of(r["t"]), "sector": sec.get(r["sym"]),
                     "liq_rank": r.get("liq_rank"), "liq_universe": r.get("liq_universe"), "context": r.get("ctx") or {},
                     "culmination": r.get("out") or {}}
            lesson = (f"{bt}: {BASE_DEF[bt]} Chart IQ read this base: {b['note']}. It ran {b['bars']} sessions, from "
                      f"{b['start']} to {b['end']}, {b['depth_pct']}% deep, and the last bar broke out over its pivot at "
                      f"{b['pivot']}.")
            out.append(make_item(
                type="recall", skill_id="read.bases", module="F4", difficulty=3, q=Q,
                answer=bt, choices=G.order_choices(bt, CONFUSE[bt], (r["sym"], r["t"], bt)),
                prompt_extra={"chart": {"window_bars": G.WINDOW, "tf": "D", "highlight_last_bars": 1}, "subject": bt},
                reveal={"system": "Chart IQ, the base under the breakout", "detector": "chart_iq.v3_bases.classify",
                        "label": bt, "facts": facts, "source": ref, "window_bars": G.WINDOW, "forward_bars": G.FORWARD,
                        "example": {"sym": r["sym"], "asof": asof, "found_by": "scripts/study/bank_v2/scan_bases.py"}},
                lesson_text=lesson, lesson_origin="session", source_kind="chart_iq", source_ref=ref,
                sym=r["sym"], asof=asof, adjustment_basis="split-adjusted",
                bars={"sym": r["sym"], "tf": "D", "asof": asof, "window": G.WINDOW, "forward": G.FORWARD}))
    second_source.save_cache(G.YAHOO, G.YAHOO_CACHE)
    path = write_segment("chart.bases", out)
    print(f"chart.bases: {len(out)} items -> {path}")
    print("   by base:", dict(Counter(i["prompt_json"]["subject"] for i in out)))
    print("   dropped (pod coverage or Yahoo):", dict(dropped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
