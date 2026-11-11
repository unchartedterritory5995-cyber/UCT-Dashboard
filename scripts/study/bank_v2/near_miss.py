"""BANK V2: "nothing fired" near-misses, the No charts the setup questions and Hard mode need.

Before this, the only No setup charts in the bank were 84 detector fixtures on six megacaps in 2022 (spot.fixtures), so
Hard mode's "nothing fired" answer came from the same few charts. A near-miss is a chart that LOOKS like a setup and
fails one of its rules on the last bar, where none of the seven Hard-mode setups fires at all (study_hard
.fired_on_last_bar over the member's own 120-bar window: an empty set, a complete sweep). Three setups have a miss that
is certain on the day itself:

- Kicker look-alike: the day before closed red with a real body, this day opened above it, but closed at or under the
  red day's high (the owner's rule: the kicker closes above the red day's high).
- Oops look-alike: opened under the prior close and undercut the prior day's low, but closed at or under the prior
  close (the scanner Oops closes back above the prior close).
- High Volume Edge look-alike: the biggest volume in a year, at least 5 times the 50-day average, without the up day
  of 5% or more (the owner's HVE: an up day on volume that dwarfs everything before it; his drafting rule, 5% up).

Gap Support is left out on purpose: a close under the gap-up day's low can still be reclaimed in the next sessions (the
owner graded such charts great, 2026-10-26/27), so a No would not be certain on the day.

Each item is a spot question (the same wording as the Yes items), key No, the owner's definition, then the measured
miss. Liquid (top 1,000 by dollar volume that day), above the 50-day for the Kicker and Oops look-alikes (a chart a
member would look at twice), spread over eras, stocks and sectors, covered by the web pod's bars and checked against
Yahoo. Segment spot.near_miss. All drafts.

  python -X utf8 scripts/study/bank_v2/near_miss.py --bars <bars.db> [--per-setup 150]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys
from collections import Counter, defaultdict

import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from api.services import study_hard as H  # noqa: E402
from scripts.study._common import make_item, write_segment  # noqa: E402
from scripts.study.bank_v2 import gen_chartiq as G  # noqa: E402
from scripts.study.bank_v2 import scan_history as SH  # noqa: E402
from scripts.study.bank_v2 import second_source  # noqa: E402
from scripts.study.bank_v2.pod_coverage import PodCoverage  # noqa: E402
from scripts.study.gen_setup_examples import SETUPS  # noqa: E402

PER_STOCK_ERA = 2
NAME = {"kicker": "Kicker Candle", "oops": "Oops Reversal", "hve": "High Volume Edge"}
SKILL = {k: SETUPS[v][0] for k, v in NAME.items()}


def look_alike(b, i, s50, av50, vmax250):
    """(kind, miss sentence, facts) when bar i looks like a setup and fails it on the day, else None."""
    x, p = b[i], b[i - 1]
    if p["c"] <= 0 or x["h"] <= x["l"]:
        return None
    up = (x["c"] / p["c"] - 1) * 100
    if s50 and x["c"] > s50:
        body = (p["o"] - p["c"]) / p["c"] * 100
        gap = (x["o"] / p["c"] - 1) * 100
        if p["c"] < p["o"] and body >= 1.0 and gap >= 0.5 and x["c"] <= p["h"]:
            f = {"prior_red_body_pct": round(body, 2), "gap_pct": round(gap, 2), "close": round(x["c"], 2),
                 "red_day_high": round(p["h"], 2), "day_pct": round(up, 2)}
            return "kicker", (f"the day before closed red, {f['prior_red_body_pct']}% open to close, and this day opened "
                              f"{f['gap_pct']}% higher, but it closed at {f['close']}, at or under the red day's high of "
                              f"{f['red_day_high']}: the follow-through never came"), f
        if x["o"] < p["c"] and x["l"] < p["l"] and x["c"] <= p["c"]:
            f = {"open": round(x["o"], 2), "prior_close": round(p["c"], 2), "prior_low": round(p["l"], 2),
                 "low": round(x["l"], 2), "close": round(x["c"], 2), "day_pct": round(up, 2)}
            return "oops", (f"it opened at {f['open']}, under the prior close of {f['prior_close']}, and undercut the prior "
                            f"day's low of {f['prior_low']} (a low of {f['low']}), but closed at {f['close']}, still at or "
                            f"under the prior close: no reversal"), f
    if av50 and x["v"] >= vmax250 and x["v"] >= 5 * av50 and up < 5.0:
        f = {"rvol": round(x["v"] / av50, 1), "day_pct": round(up, 2)}
        side = f"closed down {abs(f['day_pct'])}%" if up < 0 else f"closed up only {f['day_pct']}%"
        return "hve", (f"the volume was the biggest in a year, {f['rvol']} times the 50-day average, but the stock {side}: "
                       f"the record volume came without the up day of 5% or more"), f
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", required=True)
    ap.add_argument("--per-setup", type=int, default=150)
    ap.add_argument("--top", type=int, default=1000)
    a = ap.parse_args(argv)
    c = sqlite3.connect(f"file:{a.bars}?mode=ro", uri=True)
    etfs = set(json.loads((REPO / "api/data/prebuilt_etfs.json").read_text(encoding="utf-8")))
    syms = [r[0] for r in c.execute("SELECT ticker FROM ohlcv WHERE tf='D' GROUP BY ticker HAVING count(*) >= ?",
                                    (SH.MIN_HISTORY,))]
    syms = [s for s in syms if s not in etfs and s.isalpha()]
    spy = SH.spy_table(c)
    dates = sorted(spy)
    didx = {t: k for k, t in enumerate(dates)}
    dv50 = np.full((len(dates), len(syms)), np.nan, dtype=np.float32)
    loaded = {}
    for n, sym in enumerate(syms):                    # pass 1: the liquidity table
        rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
        b = [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5] or 0)}
             for r in rows if r[1] and r[4]]
        if len(b) < 260:
            continue
        dvs = np.array([x["c"] * x["v"] for x in b], dtype=np.float64)
        med = np.median(np.lib.stride_tricks.sliding_window_view(dvs, 50), axis=1)
        rows_j = np.array([didx.get(x["t"], -1) for x in b[49:]])
        ok = rows_j >= 0
        dv50[rows_j[ok], n] = med[ok]
        loaded[sym] = None
    thr = {}
    for j, t in enumerate(dates):
        row = dv50[j][~np.isnan(dv50[j])]
        if row.size:
            thr[t] = float(np.sort(row)[::-1][min(a.top, row.size) - 1])
    col = {s: k for k, s in enumerate(syms)}
    cands = defaultdict(list)
    for sym in syms:                                  # pass 2: the look-alikes
        if sym not in loaded:
            continue
        rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
        b = [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5] or 0)}
             for r in rows if r[1] and r[4]]
        cl = np.array([x["c"] for x in b]); vol = np.array([x["v"] for x in b])
        slots = Counter()
        for i in range(260, len(b) - 21):
            j = didx.get(b[i]["t"])
            if j is None or np.isnan(dv50[j, col[sym]]) or dv50[j, col[sym]] < thr.get(b[i]["t"], float("inf")):
                continue
            s50 = float(cl[i - 49:i + 1].mean())
            av50 = float(vol[i - 50:i].mean())
            hit = look_alike(b, i, s50, av50, float(vol[i - 250:i].max()))
            if not hit:
                continue
            kind, why, f = hit
            key = (kind, G.era_of(b[i]["t"]))
            if slots[key] >= PER_STOCK_ERA or not SH.clean_window(b, i):
                continue
            w = b[i - G.WINDOW + 1:i + 1]
            fired, ok = H.fired_on_last_bar(w)
            if not ok or fired:
                continue                              # something fires on this bar: not a clean "nothing fired"
            slots[key] += 1
            valid = dv50[j][~np.isnan(dv50[j])]
            rank = int((valid > dv50[j, col[sym]]).sum()) + 1
            if not G.liquid({"liq_rank": rank, "liq_universe": int(valid.size)}, a.top):
                continue
            cands[kind].append({"sym": sym, "t": b[i]["t"], "name": kind, "why": why, "facts": f, "liq_rank": rank,
                                "liq_universe": int(valid.size)})
    print("look-alikes found:", {k: len(v) for k, v in cands.items()}, flush=True)
    sec = G.sectors()
    G.YAHOO.update(second_source.load_cache(G.YAHOO_CACHE))
    G.POD.update(cov=PodCoverage(a.bars), keep=set())
    out, dropped = [], Counter()
    for kind, setup in NAME.items():
        skill, definition, detector = SETUPS[setup]
        for r in G.pick([x for x in cands[kind] if sec.get(x["sym"]) != "ETF"], a.per_setup * 2, sec):
            if sum(1 for x in out if x["skill_id"] == skill) >= a.per_setup:
                break
            if not G.pod_ok(r["sym"], r["t"]) or not G.yahoo_ok(r["sym"], r["t"], a.bars):
                dropped[kind] += 1
                continue
            asof = G.iso(r["t"])
            ref = f"scripts/study/bank_v2/near_miss.py#{setup}#{r['sym']}#{asof}"
            facts = dict(r["facts"], near_miss_of=setup, miss=r["why"], fired_on_last_bar=[], era=G.era_of(r["t"]),
                         sector=sec.get(r["sym"]), liq_rank=r["liq_rank"], liq_universe=r["liq_universe"])
            lesson = f"{definition} Here: {r['why']}. So no: the {setup} does not fire, and nothing else does on this bar."
            out.append(make_item(
                type="spot", skill_id=skill, q=f"Does the firm's {setup} setup fire on the last bar of this chart?",
                answer="no", choices=["Yes", "No"], prompt_extra={"chart": {"window_bars": G.WINDOW, "tf": "D"}},
                reveal={"detector": detector, "setup": setup, "fires": False, "quote": definition, "facts": facts,
                        "source": ref, "window_bars": G.WINDOW, "forward_bars": G.FORWARD,
                        "example": {"sym": r["sym"], "asof": asof, "found_by": "scripts/study/bank_v2/near_miss.py"}},
                lesson_text=lesson, lesson_origin="session", source_kind="setups", source_ref=ref, difficulty=3,
                sym=r["sym"], asof=asof, adjustment_basis="split-adjusted",
                bars={"sym": r["sym"], "tf": "D", "asof": asof, "window": G.WINDOW, "forward": G.FORWARD}))
    second_source.save_cache(G.YAHOO, G.YAHOO_CACHE)
    path = write_segment("spot.near_miss", out)
    print(f"spot.near_miss: {len(out)} items -> {path}")
    print("   by setup:", dict(Counter(i["skill_id"] for i in out)), "| dropped:", dict(dropped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
