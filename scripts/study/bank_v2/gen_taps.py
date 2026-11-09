"""BANK V2: "Tap the spot" questions on the chart (the tap drill), from Chart IQ's bases (scan_bases.py).

Owner 2026-11-07 asked for drawings. The tap drill (app/src/pages/study/drills/TapDrill.jsx, scored by
study_scoring.score_tap, playable today) is the drawing-style question Study already ships: the member taps a bar and a
price on the chart, the answer is graded against a region, and the reveal rings the region. Two questions per base the
stock just broke out of (segment chart.taps, skill read.levels, the Foundations track F2b, Levels, lines and drawings):

- "Tap the low of the base this stock just broke out of." The key: the base's lowest bar (within 2 bars) at its low
  (within 2%).
- "Tap the pivot of the base this stock just broke out of, its buy point." The key: the bar whose high made the pivot
  Chart IQ names (within 3 bars) at the pivot price (within 1.5%).

Bars are indexed exactly as the drill indexes them: the 120 bars of the item's window, the first bar 0. Every chart is
covered by the web pod's own bars (pod_coverage.py) and checked against Yahoo, picked like the other families
(gen_chartiq.pick). All drafts.

  python -X utf8 scripts/study/bank_v2/gen_taps.py --bases <bases.jsonl.gz> --bars-db <bars.db>
"""
from __future__ import annotations

import argparse
import gzip
import json
import pathlib
import sqlite3
import sys
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from scripts.study._common import make_item, write_segment  # noqa: E402
from scripts.study.bank_v2 import gen_chartiq as G  # noqa: E402
from scripts.study.bank_v2 import second_source  # noqa: E402
from scripts.study.bank_v2.pod_coverage import PodCoverage  # noqa: E402

KINDS = {
    "low": {"q": "Tap the low of the base this stock just broke out of.", "target": "the base low", "price_from": "l",
            "bar_tol": 2, "price_tol_pct": 2.0},
    "pivot": {"q": "Tap the pivot of the base this stock just broke out of, its buy point.", "target": "the pivot",
              "price_from": "h", "bar_tol": 3, "price_tol_pct": 1.5},
}


def window(con, sym, asof, n=G.WINDOW):
    key = int(asof.replace("-", ""))
    rows = con.execute("SELECT ts,h,l FROM (SELECT ts,h,l FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC "
                       "LIMIT ?) ORDER BY ts", (sym, key, n)).fetchall()
    return [(G.iso(t), float(h), float(l)) for t, h, l in rows]


def spot(kind, base, w):
    """(bar_index, price, date) of the base's low or pivot bar in the window, or None."""
    idx = [i for i, (d, _h, _l) in enumerate(w) if base["start"] <= d <= base["end"]]
    if len(idx) < 3:
        return None
    if kind == "low":
        i = min(idx, key=lambda j: (w[j][2], -j))
        return i, round(w[i][2], 4), w[i][0]
    piv = float(base["pivot"])
    i = min(idx, key=lambda j: (abs(w[j][1] - piv), -j))
    if abs(w[i][1] / piv - 1) > 0.01:
        return None                                   # no bar in the base made that pivot: skip, never guess
    return i, round(piv, 4), w[i][0]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bases", required=True)
    ap.add_argument("--bars-db", required=True)
    ap.add_argument("--per-kind", type=int, default=200)
    ap.add_argument("--top", type=int, default=1000)
    a = ap.parse_args(argv)
    sec = G.sectors()
    G.YAHOO.update(second_source.load_cache(G.YAHOO_CACHE))
    G.POD.update(cov=PodCoverage(a.bars_db), keep=set())
    con = sqlite3.connect(f"file:{a.bars_db}?mode=ro", uri=True)
    rows = [json.loads(x) for x in gzip.open(a.bases, "rt", encoding="utf-8")]
    rows = [r for r in rows if r.get("base") and G.liquid(r, a.top) and sec.get(r["sym"]) != "ETF"
            and r["base"]["type"] != "Faulty / wide and loose"]
    out, dropped = [], Counter()
    for kind, spec in KINDS.items():
        pool = [dict(r, name=f"tap-{kind}") for r in rows]
        for r in G.pick(pool, a.per_kind * 2, sec):
            if sum(1 for x in out if x["prompt_json"]["subject"] == kind) >= a.per_kind:
                break
            asof = G.iso(r["t"])
            w = window(con, r["sym"], asof)
            s = spot(kind, r["base"], w) if len(w) == G.WINDOW else None
            if not s or not G.pod_ok(r["sym"], r["t"]) or not G.yahoo_ok(r["sym"], r["t"], a.bars_db):
                dropped[kind] += 1
                continue
            i, price, day = s
            b = r["base"]
            key = {"bar_index": i, "bar_tol": spec["bar_tol"], "price": price, "price_tol_pct": spec["price_tol_pct"]}
            ref = f"chart_iq.v3_bases.find_base#tap-{kind}#{r['sym']}#{asof}"
            facts = {"base": b["type"], "chartiq_reading": b["note"], "base_start": b["start"], "base_end": b["end"],
                     "base_sessions": b["bars"], "depth_pct": b["depth_pct"], "pivot": b["pivot"], "base_low": b["low"],
                     "spot_date": day, "spot_price": price, "spot_bar_index": i, "bar_tol": spec["bar_tol"],
                     "price_tol_pct": spec["price_tol_pct"], "era": G.era_of(r["t"]), "sector": sec.get(r["sym"]),
                     "liq_rank": r.get("liq_rank"), "liq_universe": r.get("liq_universe"),
                     "context": r.get("ctx") or {}, "culmination": r.get("out") or {}}
            what = ("its low" if kind == "low" else "its pivot, the buy point")
            lesson = (f"The base: {b['type']}, {b['bars']} sessions from {b['start']} to {b['end']}, {b['depth_pct']}% deep "
                      f"(Chart IQ: {b['note']}). {what[0].upper() + what[1:]} was {price} on {day}"
                      + (", the level the breakout had to clear." if kind == "pivot" else
                         ", the level a stop sits under while the breakout holds.")
                      + f" A tap counts within {spec['bar_tol']} bars and {spec['price_tol_pct']}% of it.")
            out.append(make_item(
                type="tap", skill_id="read.levels", module="F2b", difficulty=3, q=spec["q"], answer=None,
                answer_json=key,
                prompt_extra={"target": spec["target"], "price_from": spec["price_from"], "subject": kind,
                              "chart": {"window_bars": G.WINDOW, "tf": "D"}},
                reveal={"system": "Chart IQ, the base under the breakout", "detector": "chart_iq.v3_bases.find_base",
                        "label": f"{b['type']}: {what}", "facts": facts, "source": ref, "answer": key,
                        "window_bars": G.WINDOW, "forward_bars": G.FORWARD,
                        "example": {"sym": r["sym"], "asof": asof, "found_by": "scripts/study/bank_v2/scan_bases.py"}},
                lesson_text=lesson, lesson_origin="session", source_kind="chart_iq", source_ref=ref,
                sym=r["sym"], asof=asof, adjustment_basis="split-adjusted",
                bars={"sym": r["sym"], "tf": "D", "asof": asof, "window": G.WINDOW, "forward": G.FORWARD}))
    second_source.save_cache(G.YAHOO, G.YAHOO_CACHE)
    path = write_segment("chart.taps", out)
    print(f"chart.taps: {len(out)} items -> {path}")
    print("   by kind:", dict(Counter(i["prompt_json"]["subject"] for i in out)), "| dropped:", dict(dropped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
