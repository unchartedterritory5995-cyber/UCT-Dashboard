"""Is the published edge the same edge in every cap tier? LMW says ask.

⭐⭐ THE STRONGEST PUBLISHED EVIDENCE IN THE CORPUS IS THAT THIS QUESTION HAS A
DIFFERENT ANSWER PER POPULATION. Lo, Mamaysky & Wang (2000), 50 stocks per
five-year subperiod across seven subperiods, 1962-1996: the SAME ten detectors,
the SAME algorithm and the SAME window give 7 of 10 patterns significant on
NYSE/AMEX and 10 of 10 on Nasdaq — and on the same NYSE/AMEX data, 7 of 10 by
one goodness-of-fit test and 5 of 10 by another. The research file's instruction
is one sentence: *"a pattern validated on large caps has not been validated on
small caps, and a statistic computed under one test is not the statistic under
another. Store the universe and the test with every published rate."*

⛔ THE LEDGER STORES A COUNT, NOT A COMPOSITION. Every published row carries
`sample_tickers` — how MANY symbols were scanned — and nothing about WHICH. The
universe is `screener_rows` at the latest snapshot, everything above the $300M
cap floor, so a large-cap edge and a micro-cap edge are averaged into one
number and reported as the structure's.

⛔ AND THE METRIC IS ONE BRACKET. `TARGET_PCT`/`STOP_PCT`/`HORIZON_BARS` are
origin: uct. LMW's second warning — one test is not another test — has a direct
analogue here that this harness does NOT address and must not pretend to: a
structure negative on 10%/8%/20 bars could be positive on a wider stop. Splitting
by population answers the first half of their instruction only.

⭐ WHAT A SPLIT CAN SHOW. If a published row's expectancy is carried by one tier
and absent or negative in another, the ledger's single number is an average over
populations that do not agree — which is exactly the shape LMW found, and it
would mean the row is published for a universe no member trades in full.

Usage:
    python tools/measure_by_population.py --sample 900 --out docs/by_population.json
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
import sqlite3
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import conftest                                                     # noqa: E402

LIVE_SCREENER = os.environ.get(
    "UCT_LIVE_SCREENER_DB", os.path.join("C:", os.sep, "data", "screener.db"))
LIVE_BARS = os.environ.get(
    "UCT_LIVE_BARS_DB", os.path.join("C:", os.sep, "data", "bars.db"))
os.environ["SCREENER_DB_PATH"] = LIVE_SCREENER

from api.services import bars_sqlite                                # noqa: E402

_RO_BARS = sqlite3.connect(
    "file:%s?mode=ro" % LIVE_BARS.replace(os.sep, "/"), uri=True,
    check_same_thread=False)
bars_sqlite._conn = lambda: _RO_BARS

from tools.probe import Probe                                       # noqa: E402
from tools.run_lift_ledger import (                                 # noqa: E402
    load_universe, WINDOWS, DEFAULT_WINDOW)
from api.services.screener import base_catalog as bc                # noqa: E402
from api.services.screener import bases                             # noqa: E402
from api.services.screener import lift_ledger as ll                 # noqa: E402

#: Cap tiers in dollars. origin: uct — chosen to split the universe into three
#: populations a member would recognise, not to make any number come out.
#: The floor is the screener's own $300M cap filter, so "micro" here means
#: 300M-2B, not true micro-cap.
TIERS = (("small 0.3-2B", 0, 2e9),
         ("mid 2-10B", 2e9, 1e10),
         ("large 10B+", 1e10, float("inf")))


def caps_by_ticker() -> dict:
    con = sqlite3.connect("file:%s?mode=ro" % LIVE_SCREENER.replace(os.sep, "/"),
                          uri=True)
    try:
        day = con.execute("select max(snapshot_date) from screener_rows").fetchone()[0]
        rows = con.execute(
            "select ticker, market_cap from screener_rows where snapshot_date=?",
            (day,)).fetchall()
    finally:
        con.close()
    return {t: c for t, c in rows if c}


def tier_of(cap) -> str:
    if cap is None:
        return "unknown"
    for name, lo, hi in TIERS:
        if lo <= cap < hi:
            return name
    return "unknown"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=900)
    ap.add_argument("--min-n", type=int, default=100,
                    help="per-tier floor below which no rate is printed")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    keys = sorted(k for k, v in (ll.load().get("structures") or {}).items()
                  if v.get("published"))
    if not keys:
        raise SystemExit("nothing is published")
    print("[keys] %s" % ", ".join(keys))

    caps = caps_by_ticker()
    bars_by = load_universe(args.sample)
    tiers = collections.Counter(tier_of(caps.get(t)) for t in bars_by)
    print("[universe] %d tickers  %s" % (len(bars_by), dict(tiers)))

    structs = {k: bc._BY_KEY[k] for k in keys}
    by_window = collections.defaultdict(list)
    for key in structs:
        by_window[WINDOWS.get(key, DEFAULT_WINDOW)].append(key)

    # key -> tier -> [sum of realised returns, n, wins]
    acc = {k: collections.defaultdict(lambda: [0.0, 0, 0]) for k in keys}
    horizon = ll.HORIZON_BARS

    with Probe("edge by population", expect_min=200) as p:
        for ticker, bars in bars_by.items():
            with p.item(ticker):
                tier = tier_of(caps.get(ticker))
                n = len(bars)
                for window, group in by_window.items():
                    for i in range(window, n - horizon - 1, horizon):
                        w = bars[max(0, i + 1 - window):i + 1]
                        ctx = bases._context(w, w)
                        for key in group:
                            st = structs[key]
                            try:
                                if not st.detect(ctx):
                                    continue
                            except Exception:      # noqa: BLE001
                                continue
                            d = ll.outcome_detail(
                                bars, i, horizon=horizon,
                                direction=ll.direction_for_bias(st.bias))
                            if d is None:
                                continue
                            cell = acc[key][tier]
                            cell[0] += d[1]
                            cell[1] += 1
                            cell[2] += 1 if d[0] == "target" else 0
                p.ok()

    print("\n%-22s%-16s%8s%9s%10s%10s"
          % ("structure", "tier", "n", "win%", "E(R)", "E(%)"))
    out = {}
    for key in keys:
        out[key] = {}
        for tier_name in [t[0] for t in TIERS] + ["unknown"]:
            s, n, wins = acc[key][tier_name]
            if not n:
                continue
            e_pct = s / n
            out[key][tier_name] = {
                "n": n, "win_rate": round(wins / n, 4),
                "expectancy_pct": round(e_pct, 5),
                "expectancy_r": round(e_pct / ll.STOP_PCT, 4),
            }
            # ⛔ A RATE ON A HANDFUL IS NOT A RATE.
            if n < args.min_n:
                print("%-22s%-16s%8d   (withheld, under the %d floor)"
                      % (key, tier_name, n, args.min_n))
                continue
            print("%-22s%-16s%8d%8.1f%%%10.3f%9.2f%%"
                  % (key, tier_name, n, 100 * wins / n,
                     e_pct / ll.STOP_PCT, 100 * e_pct))
        # does the sign of the edge AGREE across the tiers that clear the floor?
        signs = {t: (v["expectancy_r"] > 0)
                 for t, v in out[key].items() if v["n"] >= args.min_n}
        if len(signs) > 1:
            verdict = ("AGREE" if len(set(signs.values())) == 1
                       else "DISAGREE — the published number averages "
                            "populations that do not agree")
            print("%-22s%-16s%s" % ("", "-> sign:", verdict))

    if args.out:
        blob = {"measured_at": time.strftime("%Y-%m-%d"),
                "sample_tickers": len(bars_by),
                "tiers": {n: [lo, None if hi == float("inf") else hi]
                          for n, lo, hi in TIERS},
                "min_n": args.min_n, "structures": out}
        path = args.out if os.path.isabs(args.out) else os.path.join(str(ROOT), args.out)
        payload = json.dumps(blob, indent=2) + "\n"
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        os.replace(tmp, path)
        print("wrote %s" % path)

    refused = len(conftest.SHARED_ROOT_VIOLATIONS)
    print("[tripwire] writes refused into the shared root: %d" % refused)
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
