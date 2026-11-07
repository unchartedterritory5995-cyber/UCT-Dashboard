"""BANK V2: Study questions from Chart IQ's readings of the deep history (scan_chartiq.py's events file).

Two new chart-question families, each answer read by Chart IQ itself from the bars up to the chart's last bar:

- cycle.price_action (skill read.cycle): "Where is this stock in the cycle of price action on the last bar?" The six
  stages of api/services/chart_iq/engine/v44_read.CYCLE, the chart drawn with the 10 and 20-day EMA the stages are
  measured against. The lesson states the stage's rule as the engine applies it, Chart IQ's own reading of this bar, and
  the engine's own line for what comes next (v44_read.NEXT).
- chart.events (skill read.events): "Which event did the last bar print?" Seventeen of Chart IQ's named bar events
  (UnR, Pocket pivot, 20EMA tap, Inside bar break, MA remount, Range breakout, Hammer at support, Outside reversal, HVC,
  Gap up, and the bearish marks). Chart IQ's Kicker and Oops reversal are left out on purpose: the owner ruled his own
  definitions of both (2026-10-23/24), and they live in the setup bank.

Every example is a held one (the 20-session confirmation in scan_chartiq.py), from the top 1,000 stocks by dollar volume
that session, at most two per stock per question (never two in one era), one per date, spread over six eras and the
sectors. Each event is re-read on the member's own window (the 300 bars up to the day) and kept only when Chart IQ names
it there too; no distractor is an event that also fired on that bar. All drafts: the owner approves each on the review
screen.

  python -X utf8 scripts/study/bank_v2/gen_chartiq.py --events <events.jsonl.gz> --bars-db <bars.db>
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pathlib
import sqlite3
import sys
from collections import Counter, defaultdict

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from api.services.chart_iq.engine import v44_read as R  # noqa: E402
from scripts.study._common import make_item, write_segment  # noqa: E402

WINDOW, FORWARD = 120, 20
ERAS = ["1995-99", "2000-04", "2005-09", "2010-14", "2015-19", "2020-26"]
CYCLE_ORDER = list(R.CYCLE)   # Reversal extension, Wedge pop, EMA crossback, Base n' break, Exhaustion extension, Wedge drop

# The rules as cycle_events applies them (v44_read.py), in words. Numbers are the engine's constants.
CYCLE_DEF = {
    "Reversal extension": "a stock stretched at least 2.5 ATR under a falling 20-day EMA that still closes in the top half "
                          "of its day: the selling is overdone. It is confirmed when a close clears its high before its "
                          "low breaks.",
    "Wedge pop": "after a pullback that spent at least 8 of the last 15 closes under the 20-day EMA and tightened (the "
                 "ranges contracting, or a shakeout low), the stock closes over the 10 and 20-day EMA and over the last 5 "
                 "highs, in the top 40% of its range, on above-average volume.",
    "EMA crossback": "the first pullback after the pop into a rising 20-day EMA (the low within 2% of it) that closes back "
                     "at or over it, in the top half of its range, after at least 3 days with the lows over the 10-day EMA.",
    "Base n' break": "in an uptrend over the EMAs (the 10-day over the 20-day), a close over the high of the last 10 days "
                     "out of a base no wider than 15%.",
    "Exhaustion extension": "a close 3.5 ATR or more above a rising 20-day EMA: stretched far from its mean.",
    "Wedge drop": "after at least 8 of the last 10 closes over the 20-day EMA, a close under both the 10 and 20-day EMA and "
                  "under the last 3 lows, in the bottom 40% of its range.",
}
CYCLE_RULE_NUMBERS = {"atr_under": 2.5, "pop_under": 8, "pop_of": 15, "pop_highs": 5, "pop_top": 40, "crossback_within": 2,
                      "crossback_prior": 3, "base_days": 10, "base_width": 15, "exhaustion_atr": 3.5, "drop_over": 8,
                      "drop_of": 10, "drop_lows": 3, "drop_bottom": 40, "ema_fast": 10, "ema_slow": 20}

# The rules as candle_events applies them (v44_read.py), in words.
EVENT_DEF = {
    "UnR": "the day's low undercuts the lowest low of the last 15 sessions (a swing low) by up to 5%, "
           "then the close comes back over it, in the top half of the day's range, with the stock holding its 50-day "
           "area. When that low was the lowest in 40 sessions it is a failed breakdown.",
    "Pocket pivot": "an up day on more volume than any down day of the last 10 sessions (and at least 1.2 times average), "
                    "lifting off the 9 or 20-day EMA, over the 50-day, closing in the top half of its range.",
    "HVC": "a high-volume close: at least 3 times average volume and the biggest volume in 3 months, closing in the top "
           "40% of the range, on a gap over the prior high, a first breakout of the 20-day high, or a catalyst-size move.",
    "Heavy volume, closed weak": "at least 2 times average volume, but the close sits in the bottom 35% of the range: "
                                 "sellers into strength.",
    "Gap up": "the open clears the prior day's high and sits at least 2% over the prior close.",
    "Gap down": "the open sits under the prior day's low and at least 2% under the prior close.",
    "ER breakdown": "a gap down of 8% or more on at least 3 times average volume (likely earnings): no swing trade area.",
    "Breakdown on news": "a close 15% or more down on at least 3 times average volume, under the 50-day: no swing trade "
                         "area.",
    "Outside reversal": "the day takes out the prior day's low, then closes over the prior day's high, on at least 1.2 "
                        "times average volume, with the low at the 20-day EMA or the 50-day.",
    "Hammer at support": "a lower wick at least twice the body and more than half the day's range, the close in the top 40%, "
                         "with the low within 2% of the 20-day EMA or the 50-day.",
    "Reversal off highs": "a new 20-day high rejected: the upper wick is more than half the range and the close sits in the "
                          "bottom 40%.",
    "MA remount": "the first close back over the 9 and 20-day EMA after 4 of the last 6 closes sat under the 20, over a "
                  "rising 50-day (and the 200-day).",
    "20EMA tap": "the low taps a rising 20-day EMA (from 1% under it to 1.5% over it) and the close holds over it, above "
                 "the 50-day.",
    "Range breakout": "a close over the high of the last 10 days out of a range no wider than 15%, in the top 30% of the "
                      "day's range, over the 50-day.",
    "Inside bar break": "an inside day (its range inside the day before, narrower than 0.8 ATR), then a close over that "
                        "mother bar's high, in the top 40% of the range, over the 50-day, with the lows at the 9 and 20-day "
                        "EMA area.",
    "Double inside bar break": "two inside days in a row, then a close over the high of the bar they sit inside, in the "
                               "top 40% of the range, over the 50-day, with the lows at the 9 and 20-day EMA area.",
    "Bearish engulfing": "after an up day that closed under the 20-day EMA, an open over its close and a close under its "
                         "open, on at least 1.5 times average volume, rejected at the 20-day EMA.",
}
EVENT_RULE_NUMBERS = {"unr_lookback": 15, "unr_depth": 5, "unr_spring": 40, "pp_window": 10, "pp_vol": 1.2, "hvc_vol": 3,
                      "hvc_top": 40, "weak_vol": 2, "weak_bottom": 35, "gap": 2, "er_gap": 8, "er_vol": 3, "news_drop": 15,
                      "or_vol": 1.2, "hammer_body": 2, "hammer_near": 2, "hammer_top": 40, "rev_window": 20,
                      "rev_bottom": 40, "remount": "4 of 6", "tap_under": 1, "tap_over": 1.5, "rb_days": 10, "rb_width": 15,
                      "rb_top": 30, "ib_atr": 0.8, "ib_top": 40, "be_vol": 1.5}
# confusable neighbours for the distractors (never an event that fired on the bar)
CONFUSE = {
    "UnR": ["Hammer at support", "20EMA tap", "Outside reversal", "MA remount"],
    "Pocket pivot": ["MA remount", "Range breakout", "20EMA tap", "HVC"],
    "HVC": ["Gap up", "Pocket pivot", "Range breakout", "Heavy volume, closed weak"],
    "Heavy volume, closed weak": ["Reversal off highs", "HVC", "Bearish engulfing", "Gap up"],
    "Gap up": ["HVC", "Range breakout", "Pocket pivot", "Heavy volume, closed weak"],
    "Gap down": ["ER breakdown", "Breakdown on news", "Bearish engulfing", "Heavy volume, closed weak"],
    "ER breakdown": ["Gap down", "Breakdown on news", "Heavy volume, closed weak", "Bearish engulfing"],
    "Breakdown on news": ["ER breakdown", "Gap down", "Heavy volume, closed weak", "Reversal off highs"],
    "Outside reversal": ["UnR", "Hammer at support", "Bearish engulfing", "MA remount"],
    "Hammer at support": ["UnR", "20EMA tap", "Outside reversal", "Reversal off highs"],
    "Reversal off highs": ["Heavy volume, closed weak", "Bearish engulfing", "Hammer at support", "Range breakout"],
    "MA remount": ["Pocket pivot", "20EMA tap", "UnR", "Range breakout"],
    "20EMA tap": ["Hammer at support", "MA remount", "UnR", "Pocket pivot"],
    "Range breakout": ["Inside bar break", "Pocket pivot", "HVC", "Gap up"],
    "Inside bar break": ["Double inside bar break", "Range breakout", "Pocket pivot", "Outside reversal"],
    "Double inside bar break": ["Inside bar break", "Range breakout", "Pocket pivot", "20EMA tap"],
    "Bearish engulfing": ["Reversal off highs", "Heavy volume, closed weak", "Outside reversal", "Gap down"],
}
LABEL = {"UnR": "UnR (Undercut and Rally)"}
HIGHLIGHT = {"Inside bar break": 3, "Double inside bar break": 4}
CYCLE_OVERLAYS = [
    {"enabled": True, "type": "EMA", "period": 10, "color": "#4ade80", "lineWidth": 1, "lineStyle": "solid", "offset": 0,
     "plotStyle": "line", "onTop": False},
    {"enabled": True, "type": "EMA", "period": 20, "color": "#f472b6", "lineWidth": 1, "lineStyle": "solid", "offset": 0,
     "plotStyle": "line", "onTop": False},
    {"enabled": True, "type": "SMA", "period": 50, "color": "#60a5fa", "lineWidth": 1, "lineStyle": "solid", "offset": 0,
     "plotStyle": "line", "onTop": False},
]


def era_of(t) -> str:
    y = int(str(t)[:4])
    for e in ERAS:
        a, b = int(e[:4]), int(e[:2] + e[-2:])
        if a <= y <= b:
            return e
    return "other"


def iso(t) -> str:
    s = str(t)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def h(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12], 16)


def sectors() -> dict:
    out = {}
    prof = REPO / "docs" / "study" / "bank_v2" / "yahoo_profiles.json"
    if prof.exists():
        for s, p in json.loads(prof.read_text(encoding="utf-8")).items():
            out[s] = "ETF" if (p.get("quote_type") or "").upper() == "ETF" else p.get("sector")
    return out


def pick(pool: list, target: int, sec: dict) -> list:
    """Round-robin over the six eras; in each, among the next dozen candidates, the least-used sector first."""
    by_era = defaultdict(list)
    for r in sorted(pool, key=lambda r: h(r["sym"], r["t"], r["name"])):
        by_era[era_of(r["t"])].append(r)
    chosen, per_sym, sym_era, dates, used = [], Counter(), set(), set(), Counter()
    while len(chosen) < target and any(by_era.values()):
        for e in ERAS:
            q = by_era.get(e) or []
            window = []
            while q and len(window) < 12:
                r = q.pop(0)
                if per_sym[r["sym"]] >= 2 or (r["sym"], e) in sym_era or r["t"] in dates:
                    continue
                window.append(r)
            if not window:
                continue
            r = min(window, key=lambda x: used[sec.get(x["sym"]) or "?"])
            window.remove(r)
            q[:0] = window                       # the rest go back to the front, in order
            chosen.append(r); per_sym[r["sym"]] += 1; sym_era.add((r["sym"], e)); dates.add(r["t"])
            used[sec.get(r["sym"]) or "?"] += 1
            if len(chosen) >= target:
                break
    return chosen


def bars_to(con, sym, t, n=300):
    rows = con.execute("SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? "
                       "ORDER BY ts DESC LIMIT ?) ORDER BY ts", (sym, int(t), n)).fetchall()
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5] or 0)}
            for r in rows if r[1] and r[4]]


def fired_on_last(b) -> set:
    return {nm.split(" ·")[0] for k, nm, _t, _a in R.candle_events(b, R.ctx(b), look=1) if k == len(b) - 1}


def order_choices(answer: str, others: list, key) -> list:
    ch = [answer] + others[:3]
    rot = h(*key) % len(ch)
    return ch[rot:] + ch[:rot]


def next_line(stage: str) -> str:
    s = R.NEXT[stage]
    return s[0].upper() + s[1:] + ("" if s.endswith(".") else ".")


def cycle_items(rows, sec, target):
    out = []
    for st in CYCLE_ORDER:
        pool = [r for r in rows if r["kind"] == "cycle" and r["name"] == st]
        for r in pick(pool, target, sec):
            i = CYCLE_ORDER.index(st)
            others = [CYCLE_ORDER[(i - 1) % 6], CYCLE_ORDER[(i + 1) % 6], CYCLE_ORDER[(i + 3) % 6]]
            asof = iso(r["t"])
            ref = f"chart_iq.v44_read.cycle_events#{st}#{r['sym']}#{asof}"
            facts = {"stage": st, "chartiq_reading": r["why"], "rule_text": CYCLE_DEF[st], "rule_numbers": CYCLE_RULE_NUMBERS,
                     "next": R.NEXT[st], "held_20": r["held"], "era": era_of(r["t"]), "sector": sec.get(r["sym"]),
                     "liq_rank": r.get("liq_rank"), "liq_universe": r.get("liq_universe"), "context": r.get("ctx") or {},
                     "culmination": r.get("out") or {}, "cycle_order": CYCLE_ORDER}
            lesson = (f"{st}: {CYCLE_DEF[st]} Chart IQ read the last bar: {r['why']}. {next_line(st)} The cycle runs "
                      "Reversal extension, Wedge pop, EMA crossback, Base n' break, Exhaustion extension, Wedge drop, then "
                      "around again.")
            out.append(make_item(
                type="recall", skill_id="read.cycle", module="F2", difficulty=3,
                q="Where is this stock in the cycle of price action on the last bar?",
                answer=st, choices=order_choices(st, others, (r["sym"], r["t"], st)),
                prompt_extra={"chart": {"window_bars": WINDOW, "tf": "D", "highlight_last_bars": 1, "overlays": CYCLE_OVERLAYS},
                              "subject": st},
                reveal={"system": "Chart IQ, the cycle of price action", "detector": "chart_iq.v44_read.cycle_events",
                        "label": st, "facts": facts, "source": ref, "window_bars": WINDOW, "forward_bars": FORWARD,
                        "example": {"sym": r["sym"], "asof": asof, "found_by": "scripts/study/bank_v2/scan_chartiq.py"}},
                lesson_text=lesson, lesson_origin="session", source_kind="chart_iq", source_ref=ref,
                sym=r["sym"], asof=asof, adjustment_basis="split-adjusted",
                bars={"sym": r["sym"], "tf": "D", "asof": asof, "window": WINDOW, "forward": FORWARD}))
    return out


def event_items(rows, sec, target, con):
    out, dropped = [], Counter()
    for ev in EVENT_DEF:
        pool = [r for r in rows if r["kind"] == "event" and r["base"] == ev]
        for r in pick(pool, target * 2, sec):
            if sum(1 for x in out if x["prompt_json"]["subject"] == ev) >= target:
                break
            b = bars_to(con, r["sym"], r["t"])
            fired = fired_on_last(b) if len(b) >= 220 else set()
            if ev not in fired:
                dropped[ev] += 1
                continue
            others = [x for x in CONFUSE[ev] + [e for e in EVENT_DEF if e not in CONFUSE[ev]] if x != ev and x not in fired]
            asof = iso(r["t"])
            ref = f"chart_iq.v44_read.candle_events#{ev}#{r['sym']}#{asof}"
            facts = {"event": ev, "chartiq_reading": r["why"], "rule_text": EVENT_DEF[ev], "rule_numbers": EVENT_RULE_NUMBERS,
                     "fired_on_bar": sorted(fired), "held_20": r["held"], "bearish": r["bear"], "era": era_of(r["t"]),
                     "sector": sec.get(r["sym"]), "liq_rank": r.get("liq_rank"), "liq_universe": r.get("liq_universe"),
                     "context": r.get("ctx") or {}, "culmination": r.get("out") or {}}
            also = sorted((fired - {ev}) & set(EVENT_DEF))     # never Chart IQ's Kicker or Oops: the owner ruled his own
            lesson = (f"{LABEL.get(ev, ev)}: {EVENT_DEF[ev]} Chart IQ read the last bar: {r['why']}."
                      + (f" The same bar also printed: {', '.join(also)}." if also else ""))
            out.append(make_item(
                type="recall", skill_id="read.events", module="F2", difficulty=2,
                q="Which event did the last bar print?",
                answer=ev, choices=order_choices(ev, others, (r["sym"], r["t"], ev)),
                prompt_extra={"chart": {"window_bars": WINDOW, "tf": "D", "highlight_last_bars": HIGHLIGHT.get(ev, 1)},
                              "subject": ev},
                reveal={"system": "Chart IQ, the named bar events", "detector": "chart_iq.v44_read.candle_events",
                        "label": ev, "facts": facts, "source": ref, "window_bars": WINDOW, "forward_bars": FORWARD,
                        "example": {"sym": r["sym"], "asof": asof, "found_by": "scripts/study/bank_v2/scan_chartiq.py"}},
                lesson_text=lesson, lesson_origin="session", source_kind="chart_iq", source_ref=ref,
                sym=r["sym"], asof=asof, adjustment_basis="split-adjusted",
                bars={"sym": r["sym"], "tf": "D", "asof": asof, "window": WINDOW, "forward": FORWARD}))
    return out, dropped


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", required=True)
    ap.add_argument("--bars-db", required=True)
    ap.add_argument("--cycle-per-stage", type=int, default=150)
    ap.add_argument("--per-event", type=int, default=60)
    ap.add_argument("--top", type=int, default=1000)
    a = ap.parse_args(argv)
    sec = sectors()
    rows = [json.loads(l) for l in gzip.open(a.events, "rt", encoding="utf-8")]
    rows = [r for r in rows if r.get("held") and (r.get("liq_rank") or 10 ** 9) <= a.top and sec.get(r["sym"]) != "ETF"]
    con = sqlite3.connect(f"file:{a.bars_db}?mode=ro", uri=True)
    cyc = cycle_items(rows, sec, a.cycle_per_stage)
    evs, dropped = event_items(rows, sec, a.per_event, con)
    p1 = write_segment("cycle.price_action", cyc)
    p2 = write_segment("chart.events", evs)
    print(f"cycle.price_action: {len(cyc)} items -> {p1}")
    print("   by stage:", dict(Counter(i["prompt_json"]["subject"] for i in cyc)))
    print(f"chart.events: {len(evs)} items -> {p2}")
    print("   by event:", dict(Counter(i["prompt_json"]["subject"] for i in evs)))
    print("   not re-read on the member's window (dropped):", dict(dropped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
