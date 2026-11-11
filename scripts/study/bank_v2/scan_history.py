"""BANK V2, STEP 1: every qualifying setup instance across the full daily history of the liquid universe.

The owner, 2026-11-06: "lets use a variety of diverse and liquid and institutionally traded stocks and setups going
back deep in time that we have access to. Use access of all the power and resources and variables and APIs and
everything possible to enhance and improve this all."

What this does, read-only, over a bars.db (the pod's, or the workbench's dump of it):
  * for every stock (ETFs excluded) and EVERY session since its history starts (1995 for the oldest names), it runs
    the owner-calibrated finders' own rules, unchanged (scripts/study/find_*_examples.py: the engine gate, then the
    finder's scored facts and its liquidity rule), so a candidate here is a candidate the owner's finders would accept;
  * it lifts the one thing that kept the bank in 2019-2026 (the shared clean_window rejected any chart before
    2019-01-01, a side effect of the first finder scanning ~6 years, never a ruling) and adds what deep history needs:
    a window with a split-sized one-day move (40%+) is refused, since old bars can carry an unadjusted split;
  * it RECORDS instead of filtering what the finders filtered: the finder's must-work verdict (`works`), so failed
    examples are kept and labelled, not thrown away (the owner, of an Oops pass: "crappy ones that fail a few days
    later" is a reason to label them, not to hide them from the analysis);
  * it adds, per instance, deterministic context and outcome fields from the bars: the point-in-time liquidity rank
    (the 50-day median dollar volume ranked across every stock that session: the institutional proxy), the sector and
    industry (the ticker meta cache), the market's condition (SPY against its 50 and 200-day), the distance from the
    52-week high, the 63-session strength against SPY, which of the seven setups' engine rules fired on the same bar,
    and the outcome over 60 sessions (the culmination before a close breaks the signal candle, the days to it,
    whether the signal low broke, the return at +20 sessions).

Nothing is invented; every field is measured. Output: one JSON line per instance (gzip), plus a summary printed at the
end. Selection, near-misses and drafting are later steps (choose.py); this file only finds and measures.

Usage:
  python scripts/study/bank_v2/scan_history.py --bars <bars.db> --meta <ticker_meta_cache dir> --out <atlas.jsonl.gz>
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import pathlib
import sqlite3
import sys
import time
from collections import Counter, defaultdict

import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))
os.chdir(REPO)   # the finders read api/data relative to the repo

from api.services import study_hard as H  # noqa: E402
from api.services.pattern_engine.detectors.uct import (  # noqa: E402
    uct_gap_support, uct_kicker, uct_oops_reversal, uct_slingshot)
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa: E402
from scripts.study import (  # noqa: E402
    find_bear_gap_examples as FB, find_gap_support_examples as FG, find_hve_examples as FH,
    find_launchpad_examples as FL, find_oops_examples as FO, find_pass4_examples as FK, find_slingshot_examples as FS)

FORWARD_OUT = 60          # outcome window
WINDOW = 120              # the bank chart's visible window
SPLIT_MOVE = 0.40         # a one-day close-to-close move this big in the window = possibly an unadjusted split: refuse
MIN_HISTORY = 400


def clean_window(bars, i, window=WINDOW, forward=20):
    """The finders' clean_window without the 2019 cutoff, with a split-sized-move guard for old bars."""
    lo, hi = i - window + 1, i + forward
    if lo < 1 or hi >= len(bars):
        return False
    d0 = dt.date(int(str(bars[lo]["t"])[:4]), int(str(bars[lo]["t"])[4:6]), int(str(bars[lo]["t"])[6:8]))
    d1 = dt.date(int(str(bars[hi]["t"])[:4]), int(str(bars[hi]["t"])[4:6]), int(str(bars[hi]["t"])[6:8]))
    if (d1 - d0).days > (window + forward) * 1.9:
        return False
    for k in range(lo, hi + 1):
        a, b = bars[k - 1], bars[k]
        if a["c"] <= 0 or abs(b["c"] / a["c"] - 1) > SPLIT_MOVE:
            return False
        body = max(b["o"], b["c"]) - min(b["o"], b["c"]); rng = b["h"] - b["l"]
        if rng > 0 and body > 0 and rng > 12 * body and rng / b["c"] > 0.25:
            return False
    return True


# ── the seven finders, each exactly as its own main() runs it (gate → facts → liquid), works recorded ────────────────

def kicker(bars, S, i):
    if not uct_kicker.evaluate(bars, S, i):
        return None
    ok, sc, f = FK.kicker_facts(bars, S, i)
    if not ok:
        return None
    lq, dv = FK.liquid(bars, i)
    w, wf = FK.works(bars, i)
    return lq, dv, sc, f, w, wf


def launchpad(bars, S, i):
    ok, sc, f = FL.facts(bars, S, i)
    if not ok:
        return None
    lq, dv = FL.liquid(bars, i)
    w, wf = FL.works(bars, i)
    return lq, dv, sc, f, w, wf


def slingshot(bars, S, i):
    det = uct_slingshot.evaluate(bars, S, i)
    if not det:
        return None
    ok, sc, f = FS.facts(bars, S, i, det)
    if not ok:
        return None
    lq, dv = FS.liquid(bars, i)
    w, wf = FS.works(bars, i)
    return lq, dv, sc, f, w, wf


def oops(bars, S, i):
    if not uct_oops_reversal.evaluate(bars, S, i):
        return None
    ok, sc, f = FO.oops_facts(bars, S, i)
    if not ok or not FO.legible(bars, i):
        return None
    # the oops finder's own floor is shares (>= 300K a day, close >= $5); the bank asks for institutional size too: the
    # same $20M a day of dollar volume and $10 close the other finders use
    w120 = bars[i - WINDOW + 1:i + 1]
    dv = sum(x["c"] * x["v"] for x in w120) / len(w120)
    lq = FO.window_liquid(bars, i) and bars[i]["c"] >= 10.0 and dv >= 20_000_000
    w, wf = FK.works(bars, i)      # the oops finder judges its forward strip the same way the kicker pass does
    return lq, dv, sc, f, w, wf


def gap_support(bars, S, i):
    det = uct_gap_support.evaluate(bars, S, i)
    if not det:
        return None
    ok, sc, f = FG.facts(bars, S, i, det)
    if not ok:
        return None
    lq, dv = FG.liquid(bars, i)
    w, wf = FG.works(bars, i)
    nxt = bars[i + 1:i + 21]
    f = dict(f, gap_stayed_open_20=bool(nxt) and min(x["c"] for x in nxt) >= det["gap_top"])
    return lq, dv, sc, f, w, wf


def hve(bars, S, i):
    f = FH.facts(bars, S, i)
    if not f:
        return None
    lq, dv = FH.liquid(bars, i)
    fw = FH.forward(bars, i, bars[i]["c"])
    return lq, dv, f.get("setup_score", 0), f, None, fw


def bear_gap(bars, S, i):
    b, p = bars[i], bars[i - 1]
    if not (b["h"] < p["l"] and p["c"] > 0 and (b["o"] / p["c"] - 1) * 100 <= -FB.MIN_GAP_PCT):
        return None
    ok, sc, f = FB.facts(bars, S, i)
    if not ok:
        return None
    lq, dv = FB.liquid(bars, i)
    return lq, dv, sc, f, None, {}


FINDERS = {
    "setup.family3.kicker": (kicker, FK.MIN_GAP, 260),
    "setup.family1.launchpad": (launchpad, FL.MIN_GAP, 260),
    "setup.family4.slingshot": (slingshot, FS.MIN_GAP, 260),
    "setup.family4.oops": (oops, FO.MIN_GAP, 260),
    "setup.family3.gap_support": (gap_support, FG.MIN_GAP, 260),
    "setup.family3.hve": (hve, FH.MIN_GAP, 60),
    "setup.family3.bear_gap": (bear_gap, FB.MIN_GAP, FB.HIGH_LOOKBACK + 10),
}
SHORT = {"setup.family3.bear_gap"}


def outcome(bars, i, short):
    """The culmination before a close breaks the signal candle against the trade (hardMode.culmination's rule)."""
    s = bars[i]
    fwd = bars[i + 1:i + 1 + FORWARD_OUT]
    if not fwd:
        return {}
    end, broke = len(fwd), None
    for k, b in enumerate(fwd):
        if (b["c"] > s["h"]) if short else (b["c"] < s["l"]):
            end, broke = k + 1, k
            break
    best = 0
    for k in range(1, end):
        if (fwd[k]["l"] < fwd[best]["l"]) if short else (fwd[k]["h"] > fwd[best]["h"]):
            best = k
    px = fwd[best]["l"] if short else fwd[best]["h"]
    r20 = (fwd[19]["c"] / s["c"] - 1) * 100 if len(fwd) >= 20 else None
    return {"culm_pct": round((px / s["c"] - 1) * 100, 2), "culm_sessions": best + 1,
            "broke_at": None if broke is None else broke + 1, "ret20_pct": None if r20 is None else round(r20, 2)}


def context(bars, S, i, spy):
    b = bars[i]
    hi252 = max(x["h"] for x in bars[max(0, i - 251):i + 1])
    s50, s200 = S["s50"][i], S["s200"][i]
    ctx = {"off_high_pct": round((b["c"] / hi252 - 1) * 100, 1),
           "vs50_pct": round((b["c"] / s50 - 1) * 100, 1) if s50 else None,
           "vs200_pct": round((b["c"] / s200 - 1) * 100, 1) if s200 else None,
           "s200_rising": bool(s200 and i >= 20 and S["s200"][i - 20] and s200 > S["s200"][i - 20])}
    sp = spy.get(b["t"])
    if sp:
        ctx["market"] = sp["regime"]
        if i >= 63 and bars[i - 63]["c"] > 0 and sp.get("c63"):
            ctx["rs63_pct"] = round(((b["c"] / bars[i - 63]["c"]) / sp["c63"] - 1) * 100, 1)
    return ctx


def spy_table(c):
    rows = c.execute("SELECT ts,c FROM ohlcv WHERE ticker='SPY' AND tf='D' ORDER BY ts").fetchall()
    out, closes = {}, [r[1] for r in rows]
    for k, (t, cl) in enumerate(rows):
        s50 = sum(closes[k - 49:k + 1]) / 50 if k >= 49 else None
        s200 = sum(closes[k - 199:k + 1]) / 200 if k >= 199 else None
        regime = None
        if s50 and s200:
            regime = "uptrend" if cl > s50 > s200 else "downtrend" if cl < s50 < s200 else "mixed"
        out[t] = {"regime": regime, "c63": (cl / closes[k - 63]) if k >= 63 and closes[k - 63] else None}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", required=True)
    ap.add_argument("--meta", default=None, help="ticker_meta_cache directory (sector, industry)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0, help="scan only the first N stocks (a dry run)")
    a = ap.parse_args()
    c = sqlite3.connect(f"file:{a.bars}?mode=ro", uri=True)
    etfs = set(json.loads((REPO / "api/data/prebuilt_etfs.json").read_text(encoding="utf-8")))
    try:
        from api.services import cap_universe
        etfs |= set(cap_universe.etf_symbols())
    except Exception:
        pass
    syms = [r[0] for r in c.execute("SELECT ticker FROM ohlcv WHERE tf='D' GROUP BY ticker HAVING count(*) >= ?", (MIN_HISTORY,))]
    syms = [s for s in syms if s not in etfs and s.isalpha()]
    if a.limit:
        syms = syms[:a.limit]
    spy = spy_table(c)
    dates = sorted(spy)
    didx = {t: k for k, t in enumerate(dates)}
    dv50 = np.full((len(dates), len(syms)), np.nan, dtype=np.float32)
    meta = {}
    if a.meta:
        for s in syms:
            p = pathlib.Path(a.meta) / f"{s}.json"
            if p.exists():
                try:
                    m = json.loads(p.read_text(encoding="utf-8")); meta[s] = (m.get("sector"), m.get("industry"))
                except Exception:
                    pass
    hits = []
    t0 = time.time()
    for n, sym in enumerate(syms):
        rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
        bars = [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5] or 0)} for r in rows]
        bars = [b for b in bars if b["c"] > 0 and b["h"] >= b["l"]]
        if len(bars) < MIN_HISTORY:
            continue
        dvs = np.array([b["c"] * b["v"] for b in bars], dtype=np.float64)
        med = np.median(np.lib.stride_tricks.sliding_window_view(dvs, 50), axis=1)   # med[k - 49] = the 50 sessions to k
        rows_j = np.array([didx.get(b["t"], -1) for b in bars[49:]])
        ok = rows_j >= 0
        dv50[rows_j[ok], n] = med[ok]
        S = U.series(bars)
        for skill, (fn, min_gap, start) in FINDERS.items():
            last = -10_000
            for i in range(max(start, WINDOW), len(bars) - 21):
                if i - last < min_gap:
                    continue
                try:
                    res = fn(bars, S, i)
                except Exception:
                    res = None
                if not res:
                    continue
                lq, dv, sc, f, w, wf = res
                if not lq or not clean_window(bars, i):
                    continue
                last = i
                fired = set()
                for sk, rules in H.SETUP_RULES.items():
                    for r in rules:
                        try:
                            if r(bars, S, i):
                                fired.add(sk); break
                        except Exception:
                            pass
                hits.append({"skill": skill, "sym": sym, "t": bars[i]["t"], "close": bars[i]["c"], "score": sc,
                             "works": w, "fwd": wf, "facts": f, "dv": dv, "sector": (meta.get(sym) or (None, None))[0],
                             "industry": (meta.get(sym) or (None, None))[1], "co_fires": sorted(fired - {skill}),
                             "ctx": context(bars, S, i, spy), "out": outcome(bars, i, skill in SHORT)})
        if (n + 1) % 100 == 0:
            print(f"  {n + 1}/{len(syms)} stocks, {len(hits)} instances, {time.time() - t0:.0f}s", flush=True)
    # point-in-time liquidity rank: the instance's 50-day median dollar volume against every stock that session
    col = {s: k for k, s in enumerate(syms)}
    for h in hits:
        j = didx.get(h["t"])
        row = dv50[j] if j is not None else None
        n_sym = col[h["sym"]]
        mine = row[n_sym] if row is not None else np.nan
        if row is not None and not np.isnan(mine):
            valid = row[~np.isnan(row)]
            h["liq_rank"] = int((valid > mine).sum()) + 1
            h["liq_universe"] = int(valid.size)
    with gzip.open(a.out, "wt", encoding="utf-8") as fh:
        for h in hits:
            fh.write(json.dumps(h, default=str) + "\n")
    by = Counter(h["skill"].split(".")[-1] for h in hits)
    era = defaultdict(Counter)
    for h in hits:
        era[h["skill"].split(".")[-1]][str(h["t"])[:3] + "0s"] += 1
    print(f"scanned {len(syms)} stocks in {time.time() - t0:.0f}s; {len(hits)} instances")
    for k, v in by.most_common():
        print(f"  {k:12s} {v:6d}  by decade {dict(sorted(era[k].items()))}")


if __name__ == "__main__":
    main()
