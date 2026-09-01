"""Measure the SAME-DATE clustering of a structure's anchors, and rho's own CI.

⛔⛔ WHY THIS IS COMMITTED RATHER THAN RUN ONCE. `lift_ledger.adjudicate`'s gate
4 refuses to publish a row whose `cluster_deff` is unmeasured, and
`tests/test_same_date_clustering_is_gated.py` tells the next reader to
RE-MEASURE whenever a number drifts. For a while the harness that produces
`docs/base_lift_clustering.json` lived only in a session scratchpad — so the
artifact was cited by a gate, pinned by a rail, and reproducible by nobody. A
rail demanding a measurement nobody can reproduce is an instruction to guess.

⭐ WHAT IT MEASURES. Every interval in the ledger comes from a cluster bootstrap
that resamples TICKERS. That is right for one axis — one ticker's anchors are
not independent of each other — and silent about the other: a structure firing
on hundreds of DIFFERENT names on the SAME DAY has one market event, not
hundreds of observations, so the interval is too NARROW and both publishing
gates read an interval's bound.

The within-date intra-class correlation of the win/loss outcome is computed
directly (one-way random effects, unequal clusters), giving

    deff = 1 + (m_eff - 1) * rho          m_eff = sum(n_i^2)/N

by which the true variance exceeds the bootstrap's; an interval's half-width
scales with its square root.

⭐⭐ AND RHO CARRIES AN INTERVAL OF ITS OWN, resampled over WHOLE DATES. Gate 2
in this same module already refuses to compare a POINT estimate to the null —
it reads the CI's lower bound, because the pessimistic end is the honest one.
Correcting with a point estimate of rho is that same mistake one level up, so
`deff_conservative` (built from rho's upper bound) is what a gate should widen
by. The resampling unit is the DATE because the date is the cluster; resampling
anchors would destroy the structure being estimated and return a confidently
tiny interval.

⛔ THE ANCHOR GRID IS THE LEDGER'S OWN. Anchors are stepped by
`lift_ledger.HORIZON_BARS` from each structure's own window, which is the grid
the bootstrap resampled — so this measures the clustering those intervals
actually suffer, not a hypothetical. A denser grid would find MORE same-day
overlap, not less.

Usage:
    python tools/measure_anchor_clustering.py --sample 700 \
        --out docs/base_lift_clustering.json
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import pathlib
import random
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Sandboxes every /data pin and arms the shared-root tripwire. MUST come before
# any product import — the paths are captured at module import.
import conftest                                                     # noqa: E402

# ⛔ THE TWO DBs THIS READS ARE POINTED BACK AT THE LIVE FILES, AND BOTH ARE
# OPENED READ-ONLY. conftest sandboxes every /data pin, which is right for a
# test and wrong for a measurement -- an empty sandbox would make this report a
# confident zero. `bars_sqlite._conn` normally opens bars.db READ-WRITE to set
# PRAGMAs, so it is swapped for a `mode=ro` handle rather than trusted; the
# tripwire stays armed and its verdict is printed at the end.
LIVE_SCREENER = os.environ.get("UCT_LIVE_SCREENER_DB", r"C:\data\screener.db")
LIVE_BARS = os.environ.get("UCT_LIVE_BARS_DB", r"C:\data\bars.db")
os.environ["SCREENER_DB_PATH"] = LIVE_SCREENER

import sqlite3                                                      # noqa: E402
from api.services import bars_sqlite                                # noqa: E402

_RO_BARS = sqlite3.connect(
    "file:%s?mode=ro" % LIVE_BARS.replace("\\", "/"), uri=True,
    check_same_thread=False)
bars_sqlite._conn = lambda: _RO_BARS

from tools.probe import Probe                                       # noqa: E402
from tools.run_lift_ledger import (                                 # noqa: E402
    load_universe, WINDOWS, DEFAULT_WINDOW)
from api.services.screener import base_catalog as bc                # noqa: E402
from api.services.screener import bases                             # noqa: E402
from api.services.screener import lift_ledger as ll                 # noqa: E402


def published_keys() -> list:
    """The rows whose bounds are load-bearing, read from the ledger.

    ⛔ DERIVED, NOT TYPED. A refused row's interval decides nothing, so its
    clustering need not be measured; a row that starts publishing must be in
    this list the day it does, and a hand-list would not be.
    """
    rows = ll.load().get("structures") or {}
    return sorted(k for k, v in rows.items()
                  if v.get("published") or v.get("cluster_deff") is not None)


def icc_oneway(groups):
    """One-way random-effects ICC over unequal groups of 0/1 outcomes.

    Returns `(rho, m_eff, k, N)`. `m_eff` is the unequal-size cluster term
    `sum(n_i^2)/N` — what the design effect actually multiplies. A plain average
    understates it whenever the day sizes vary, and they do.
    """
    sizes = [len(v) for v in groups if v]
    k, N = len(sizes), sum(sizes)
    if k < 2 or N <= k:
        return None, None, k, N
    grand = sum(sum(v) for v in groups) / N
    msb = sum(len(v) * (sum(v) / len(v) - grand) ** 2 for v in groups) / (k - 1)
    msw = sum(sum((y - sum(v) / len(v)) ** 2 for y in v)
              for v in groups) / (N - k)
    m_eff = sum(n * n for n in sizes) / N
    n0 = (N - m_eff) / (k - 1)
    denom = msb + (n0 - 1) * msw
    if denom <= 0:
        return 0.0, m_eff, k, N
    return (msb - msw) / denom, m_eff, k, N


def icc_bootstrap(groups, trials=400, seed=11):
    """A 95% CI for rho, resampling WHOLE DATES with replacement."""
    rng = random.Random(seed)
    n = len(groups)
    if n < 2:
        return None, None
    out = []
    for _ in range(trials):
        r, _m, _k, _N = icc_oneway([groups[rng.randrange(n)] for _ in range(n)])
        if r is not None:
            out.append(max(r, 0.0))
    if len(out) < trials // 2:
        return None, None
    out.sort()
    return out[int(0.025 * len(out))], out[int(0.975 * len(out))]


def measure(bars_by: dict, keys: list) -> dict:
    structs = {k: bc._BY_KEY[k] for k in keys if k in bc._BY_KEY}
    missing = [k for k in keys if k not in structs]
    if missing:
        raise SystemExit("structures absent from the catalog: %s" % missing)

    # ⛔ GROUPED BY WINDOW, NOT BY DIRECTION. The per-anchor CONTEXT depends only
    # on the window, so one build serves both metrics; direction is applied when
    # the outcome is graded. Grouping by direction too would rebuild identical
    # contexts twice for nothing.
    by_window = collections.defaultdict(list)
    for key in structs:
        by_window[WINDOWS.get(key, DEFAULT_WINDOW)].append(key)

    fired = {k: collections.defaultdict(list) for k in structs}
    horizon = ll.HORIZON_BARS

    with Probe("same-date clustering", expect_min=200) as p:
        for ticker, bars in bars_by.items():
            with p.item(ticker):
                n = len(bars)
                hit = False
                for window, group in by_window.items():
                    for i in range(window, n - horizon - 1, horizon):
                        w = bars[max(0, i + 1 - window):i + 1]
                        ctx = bases._context(w, w)
                        day = bars[i].get("t")
                        for key in group:
                            st = structs[key]
                            try:
                                if not st.detect(ctx):
                                    continue
                            except Exception:      # noqa: BLE001
                                continue
                            res = ll.outcome(
                                bars, i, horizon=horizon,
                                direction=ll.direction_for_bias(st.bias))
                            if res is None:
                                continue
                            fired[key][day].append(1 if res else 0)
                            hit = True
                p.ok() if hit else p.skip("no target structure fired")

    out = {}
    for key in structs:
        groups = [v for v in fired[key].values() if v]
        rho, m_eff, k, N = icc_oneway(groups)
        if rho is None:
            print("%-24s too few dates to estimate (n=%d, dates=%d)"
                  % (key, N, k))
            continue
        rho = max(rho, 0.0)                # a negative ICC is noise, not credit
        lo, hi = icc_bootstrap(groups)
        deff = 1 + (m_eff - 1) * rho
        out[key] = {
            "rho": round(rho, 5),
            "rho_ci_low": round(lo, 5) if lo is not None else None,
            "rho_ci_high": round(hi, 5) if hi is not None else None,
            "m_eff": round(m_eff, 3),
            "deff": round(deff, 3),
            "deff_conservative": (round(1 + (m_eff - 1) * hi, 3)
                                  if hi is not None else None),
            "anchors": N,
            "dates": k,
            "direction": ll.direction_for_bias(bc._BY_KEY[key].bias),
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=700,
                    help="tickers to draw (seed 7, as the ledger does)")
    ap.add_argument("--out", default="",
                    help="write the measurement artifact here")
    ap.add_argument("--only", default="",
                    help="comma-separated structure keys (default: every row "
                         "whose bound is load-bearing)")
    args = ap.parse_args()

    keys = ([k.strip() for k in args.only.split(",") if k.strip()]
            or published_keys())
    print("[keys] %d: %s" % (len(keys), ", ".join(keys)))

    bars_by = load_universe(args.sample)
    print("[universe] %d tickers with >=400 usable bars" % len(bars_by))

    got = measure(bars_by, keys)

    print("\n%-24s%8s%7s%8s%8s%9s%9s"
          % ("structure", "anchors", "dates", "rho", "deff", "rho_hi", "deff_c"))
    for key, m in sorted(got.items()):
        print("%-24s%8d%7d%8.3f%8.2f%9s%9s"
              % (key, m["anchors"], m["dates"], m["rho"], m["deff"],
                 ("%.3f" % m["rho_ci_high"]) if m["rho_ci_high"] is not None else "-",
                 ("%.2f" % m["deff_conservative"]) if m["deff_conservative"] is not None else "-"))

    if args.out:
        blob = {"measured_at": __import__("time").strftime("%Y-%m-%d"),
                "sample_tickers": len(bars_by), "seed": 7,
                "step_bars": ll.HORIZON_BARS, "structures": got}
        path = os.path.join(str(ROOT), args.out) if not os.path.isabs(args.out) else args.out
        # ⛔ encode -> tmp -> replace. `open(w)` truncates BEFORE your write can
        # fail, and a half-written provenance file is worse than none.
        payload = json.dumps(blob, indent=2) + "\n"
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        os.replace(tmp, path)
        print("\nwrote %s" % path)

    refused = len(conftest.SHARED_ROOT_VIOLATIONS)
    print("[tripwire] writes refused into the shared root: %d" % refused)
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
