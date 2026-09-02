"""Expectancy in R, trades per year, and break-even cost — the numbers the rate hides.

⭐⭐ TWO AUTHORITIES CONVERGE ON THIS AND THE CORPUS CALLS IT THEIR STRONGEST
POINT OF AGREEMENT. Grimes: report expectancy in R
(`p_win*avg_win_R - p_loss*avg_loss_R`) "alongside the base rate, NEVER a bare
win rate". Brandt, independently, in *Metrics That Matter*: the win rate is the
wrong headline. And 12-academic-algorithmic-detection.md "Build these" #6:
"Report trades/year and break-even cost/trade alongside every return number; it
kills bad strategies faster than any p-value."

⛔ THE LEDGER'S HEADLINE IS EXACTLY THE NUMBER THEY WARN ABOUT — a difference of
two rates, in percentage points. A structure can lift the win rate and still
lose money if the wins are small or the trades are too frequent to survive
costs.

⛔⛔ AND THE BINARY RATE CANNOT PRODUCE AN EXPECTANCY. `outcome()` merges
stop-first with never-resolved into `False`, so treating (1 - rate) as an 8%
loss overstates the downside: a trade that drifted to +1% and one that hit the
stop are the same `False`. This reads `outcome_detail()`, the three-state
authority `outcome()` is derived from, and marks unresolved trades to the
horizon's close.

⚠️ WHAT THIS IS NOT. It is a gross, frictionless expectancy on a fixed
target/stop bracket. No slippage, no commission, no borrow on the short side,
no position sizing. That is the point of the break-even figure: rather than
guessing a cost, it reports the round-trip cost at which the edge reaches zero,
so a reader can compare it against costs they actually pay.

Usage:
    python tools/measure_expectancy.py --sample 450 --out docs/expectancy.json
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
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

import sqlite3                                                      # noqa: E402
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

#: Trading days in a year. origin: uct — the standard US equity count, used
#: only to turn an anchor count into a trades/year figure.
BARS_PER_YEAR = 252


def shipped_keys() -> list:
    rows = ll.load().get("structures") or {}
    return sorted(k for k, v in rows.items() if v.get("published"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=450)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    keys = shipped_keys()
    if not keys:
        raise SystemExit("nothing is published — no expectancy to report")
    print("[keys] %s" % ", ".join(keys))

    bars_by = load_universe(args.sample)
    print("[universe] %d tickers" % len(bars_by))

    structs = {k: bc._BY_KEY[k] for k in keys}
    by_window = collections.defaultdict(list)
    for key in structs:
        by_window[WINDOWS.get(key, DEFAULT_WINDOW)].append(key)

    states = {k: collections.Counter() for k in keys}
    rets = {k: [] for k in keys}
    bars_seen = 0
    horizon = ll.HORIZON_BARS

    with Probe("expectancy", expect_min=150) as p:
        for ticker, bars in bars_by.items():
            with p.item(ticker):
                n = len(bars)
                bars_seen += n
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
                            states[key][d[0]] += 1
                            rets[key].append(d[1])
                p.ok()

    years = bars_seen / BARS_PER_YEAR
    print("\n%-22s%7s%7s%7s%8s%9s%9s%10s"
          % ("structure", "n", "win%", "stop%", "unres%", "E(R)", "E(%)", "b/e cost"))
    out = {}
    for key in keys:
        n = len(rets[key])
        if not n:
            print("%-22s   never fired" % key)
            continue
        c = states[key]
        e_pct = sum(rets[key]) / n
        e_r = e_pct / ll.STOP_PCT          # R = the risk unit = the stop distance
        per_year = n / years if years else 0.0
        out[key] = {
            "n": n, "target": c["target"], "stop": c["stop"],
            "unresolved": c["unresolved"],
            "win_rate": round(c["target"] / n, 4),
            "expectancy_pct": round(e_pct, 5),
            "expectancy_r": round(e_r, 4),
            "trades_per_year": round(per_year, 2),
            # ⛔ THE BREAK-EVEN IS THE EXPECTANCY ITSELF: the round-trip cost
            # that takes the edge to zero. Reported rather than a guessed cost.
            "breakeven_roundtrip_pct": round(e_pct, 5),
            "direction": ll.direction_for_bias(bc._BY_KEY[key].bias),
        }
        print("%-22s%7d%6.1f%%%6.1f%%%7.1f%%%9.3f%8.2f%%%9.3f%%"
              % (key, n, 100 * c["target"] / n, 100 * c["stop"] / n,
                 100 * c["unresolved"] / n, e_r, 100 * e_pct, 100 * e_pct))

    print("\nE(R) is expectancy per trade in units of the STOP distance "
          "(%.0f%%)." % (100 * ll.STOP_PCT))
    print("b/e cost is the ROUND-TRIP cost per trade at which the edge is zero.")

    if args.out:
        blob = {"measured_at": time.strftime("%Y-%m-%d"),
                "sample_tickers": len(bars_by),
                "target_pct": ll.TARGET_PCT, "stop_pct": ll.STOP_PCT,
                "horizon_bars": horizon, "bars_per_year": BARS_PER_YEAR,
                "universe_years": round(years, 1), "structures": out}
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
