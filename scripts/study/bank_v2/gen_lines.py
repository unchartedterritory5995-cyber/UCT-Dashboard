"""BANK V2: "Which line is support under the last bar?" with three labelled lines on the chart (owner asked for drawings).

The chart draws three horizontal lines under the last close, each with a letter chip (app/src/pages/study/lineChoices.js):
the SUPPORT Chart IQ marks there (api/services/chart_iq/pipeline.analyze: a Recent hold, a Base breakout, a Breakout
retest, a Support line or zone, a Swing low, a Gap support / HVC level) and two DECOYS, levels where price never turned:
no swing low or swing high of the 120 bars shown (a bar whose low, or high, is the extreme of the 3 bars each side)
within 1.2% of them, at least 2% from every line Chart IQ draws and 3% from the support and each other. The member answers
Line A, B or C; the reveal turns the support gold. (Overhead resistance was the first idea for a wrong line, but Chart IQ
marks one on only about 1 support-test day in 6: those days sit near the highs.)

Charts are the support-test days of the Chart IQ history scan (20EMA tap, Hammer at support, UnR, MA remount, EMA
crossback), held over 20 sessions, under the institutional cut, spread like the other families, covered by the pod's bars
and checked against Yahoo. Segment chart.lines, skill read.levels (the Foundations F2b unit, with the tap questions). All
drafts.

  CHART_IQ_BARS_DB=<bars.db> python -X utf8 scripts/study/bank_v2/gen_lines.py --events <events.jsonl.gz> --bars-db <bars.db>
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import pathlib
import re
import sys
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from scripts.study._common import make_item, write_segment  # noqa: E402
from scripts.study.bank_v2 import gen_chartiq as G  # noqa: E402
from scripts.study.bank_v2 import second_source  # noqa: E402
from scripts.study.bank_v2.pod_coverage import PodCoverage  # noqa: E402

SUPPORT_DAYS = {"20EMA tap", "Hammer at support", "UnR", "MA remount", "EMA crossback"}
SUPPORT = ("Support", "Swing low", "Breakout retest", "Base breakout (support)", "Recent hold", "Gap support")
Q = "Which line is support under the last bar?"
SWING, TURN_GAP, LEVEL_GAP, SPREAD = 3, 0.012, 0.02, 0.03


def level_price(o):
    if o.get("kind") == "zone":
        return (float(o["top"]) + float(o["bot"])) / 2
    return float(o["price"]) if o.get("price") is not None else None


def levels(clean):
    out = []
    for o in clean:
        if o.get("kind") not in ("hline", "zone"):
            continue
        p = level_price(o)
        if p:
            out.append((str(o.get("ptype") or "").split(" ·")[0].strip(), p, o))
    return out


def describe(ptype: str) -> str:
    """Chart IQ's label for a support line, in a sentence."""
    m = re.match(r"Recent hold \((\d+)x\)", ptype)
    if m:
        return f"a recent hold, a level price held {m.group(1)} times"
    if ptype.startswith("Base breakout"):
        return "the top of the base the stock broke out of, now support"
    if ptype.startswith("Breakout retest"):
        return "a breakout retest: an old high, broken and then retested from above"
    if ptype.startswith("Gap support"):
        return "gap support at a high-volume close"
    if ptype == "Support zone":
        return "a support zone"
    if ptype == "Swing low":
        return "a swing low"
    return "support"


def swings(bars):
    lo = [float(b["l"]) for b in bars]
    hi = [float(b["h"]) for b in bars]
    out = []
    for k in range(SWING, len(bars) - SWING):
        if lo[k] == min(lo[k - SWING:k + SWING + 1]):
            out.append(lo[k])
        if hi[k] == max(hi[k - SWING:k + SWING + 1]):
            out.append(hi[k])
    return out


def pick_lines(res: dict):
    """(support, [decoy, decoy], close, crossed) from one Chart IQ reading, or None."""
    bars = res["bars"][-G.WINDOW:]
    if len(bars) < G.WINDOW:
        return None
    close = float(bars[-1]["c"])
    lv = levels(res.get("clean") or [])
    sup = [x for x in lv if x[0].startswith(SUPPORT) and close * 0.85 <= x[1] < close * 0.995]
    if not sup:
        return None
    s = max(sup, key=lambda x: x[1])                              # the nearest support under the close
    lo = min(float(b["l"]) for b in bars)
    turns, others = swings(bars), [x[1] for x in lv]
    span_lo, span_hi = max(lo * 1.01, close * 0.80), close * 0.985
    cands = [span_lo + (span_hi - span_lo) * k / 200 for k in range(201)]
    ok = [p for p in cands if abs(p / s[1] - 1) >= SPREAD and all(abs(p / o - 1) >= LEVEL_GAP for o in others)
          and all(abs(t / p - 1) > TURN_GAP for t in turns)]
    if len(ok) < 2:
        return None
    # two decoys as far from the support, and from each other, as the clean prices allow
    d1 = max(ok, key=lambda p: min(abs(p / s[1] - 1), 0.2))
    rest = [p for p in ok if abs(p / d1 - 1) >= SPREAD]
    if not rest:
        return None
    d2 = max(rest, key=lambda p: min(abs(p / s[1] - 1), abs(p / d1 - 1)))
    decoys = sorted([round(d1, 2), round(d2, 2)], reverse=True)
    crossed = {d: any(float(b["l"]) < d < float(b["h"]) for b in bars) for d in decoys}
    return s, decoys, close, crossed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", required=True)
    ap.add_argument("--bars-db", required=True)
    ap.add_argument("--target", type=int, default=300)
    a = ap.parse_args(argv)
    if not os.environ.get("CHART_IQ_BARS_DB"):
        raise SystemExit("set CHART_IQ_BARS_DB to the bars database")
    from api.services.chart_iq import pipeline as P
    sec = G.sectors()
    G.YAHOO.update(second_source.load_cache(G.YAHOO_CACHE))
    G.POD.update(cov=PodCoverage(a.bars_db), keep=set())
    rows = [json.loads(x) for x in gzip.open(a.events, "rt", encoding="utf-8")]
    rows = [dict(r, name="line") for r in rows if r["base"] in SUPPORT_DAYS and r.get("held") and G.liquid(r)
            and sec.get(r["sym"]) != "ETF"]
    out, dropped, seen = [], Counter(), 0
    for r in G.pick(rows, a.target * 4, sec):
        if len(out) >= a.target:
            break
        seen += 1
        asof = G.iso(r["t"])
        if not G.pod_ok(r["sym"], r["t"]):
            dropped["pod"] += 1; continue
        res = P.analyze(r["sym"], asof)
        if res.get("error") or res.get("asof") != asof:
            dropped["chart_iq"] += 1; continue
        got = pick_lines(res)
        if not got:
            dropped["no clean support and two decoys"] += 1; continue
        if not G.yahoo_ok(r["sym"], r["t"], a.bars_db):
            dropped["yahoo"] += 1; continue
        (sp, s_px, s_obj), decoys, close, crossed = got
        trio = [("support", round(s_px, 2)), ("decoy1", decoys[0]), ("decoy2", decoys[1])]
        perm = [(0, 1, 2), (1, 0, 2), (1, 2, 0)][G.h(r["sym"], r["t"]) % 3]   # the support is A, B or C in turn
        labelled = {trio[j][0]: (ch, trio[j][1]) for ch, j in zip("ABC", perm)}
        first = res["bars"][-G.WINDOW]["t"]
        lines = sorted(({"label": labelled[k][0], "price": labelled[k][1], "from": first} for k in labelled),
                       key=lambda x: x["label"])
        key = f"Line {labelled['support'][0]}"
        why = s_obj.get("why")
        (la, pa), (lb, pb) = labelled["decoy1"], labelled["decoy2"]
        both = all(crossed.values())
        never = not any(crossed.values())
        tail = ("price crossed both without turning at either in these 120 bars." if both else
                "price never traded at either in these 120 bars." if never else
                "price never made a swing high or low at either in these 120 bars.")
        facts = {"support_type": sp, "support": labelled["support"][1], "support_why": why, "decoys": decoys,
                 "decoy_crossed": {str(k): v for k, v in crossed.items()}, "last_close": round(close, 2), "lines": lines,
                 "swing_bars": SWING, "turn_gap_pct": TURN_GAP * 100, "era": G.era_of(r["t"]), "sector": sec.get(r["sym"]),
                 "liq_rank": r.get("liq_rank"), "liq_universe": r.get("liq_universe"), "support_day_event": r["base"],
                 "context": r.get("ctx") or {}, "culmination": r.get("out") or {}}
        lesson = (f"Line {labelled['support'][0]}, at {labelled['support'][1]}, is support: Chart IQ marks it as "
                  f"{describe(sp)}" + (f" ({why})" if why else "") + f", under the last close of {round(close, 2)}. "
                  f"Lines {la} and {lb}, at {pa} and {pb}, are not levels: {tail}")
        ref = f"chart_iq.pipeline.analyze#lines#{r['sym']}#{asof}"
        out.append(make_item(
            type="recall", skill_id="read.levels", module="F2b", difficulty=3, q=Q,
            answer=key, choices=["Line A", "Line B", "Line C"],
            prompt_extra={"chart": {"window_bars": G.WINDOW, "tf": "D", "lines": lines}, "subject": "support-line"},
            reveal={"system": "Chart IQ, the levels on the chart", "detector": "chart_iq.pipeline.analyze", "label": key,
                    "facts": facts, "source": ref, "window_bars": G.WINDOW, "forward_bars": G.FORWARD,
                    "example": {"sym": r["sym"], "asof": asof, "found_by": "scripts/study/bank_v2/gen_lines.py"}},
            lesson_text=lesson, lesson_origin="session", source_kind="chart_iq", source_ref=ref,
            sym=r["sym"], asof=asof, adjustment_basis="split-adjusted",
            bars={"sym": r["sym"], "tf": "D", "asof": asof, "window": G.WINDOW, "forward": G.FORWARD}))
        if len(out) % 25 == 0:
            print(f"  {len(out)} items from {seen} charts", flush=True)
    second_source.save_cache(G.YAHOO, G.YAHOO_CACHE)
    path = write_segment("chart.lines", out)
    print(f"chart.lines: {len(out)} items from {seen} charts -> {path}")
    print("   answer letters:", dict(Counter(i["answer_json"]["answer"] for i in out)), "| dropped:", dict(dropped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
