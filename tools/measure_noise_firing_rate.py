"""hits_real / hits_simulated — does the predicate describe the market or the noise?

⭐⭐ THE RESEARCH CALLS THIS "the highest-value non-obvious build in the whole
file" (docs/superpowers/research/bases/12-academic-algorithmic-detection.md,
"Build these" #4), and we shipped only half of it:

    "for every pattern you ship, publish `hits_real / hits_simulated`. If it is
     near 1.0, the predicate is describing the noise process, not the market."

The ledger already runs a random-data null — but it compares OUTCOMES (does the
lift survive on shuffled returns?). That answers "is the edge real". It does not
answer the prior question: **would this detector fire just as often on noise?**
A structure can clear every outcome gate while firing at the same rate on
shuffled data, which means the SHAPE it names is not a real feature of price —
it is what a random walk looks like a certain percentage of the time.

⛔ THE COUNTS WERE ALREADY BEING COMPUTED AND THROWN AWAY. `null_lifts_many`
calls `measure_many` on shuffled series, whose result carries `n` and `anchors`,
and keeps only `lift`. Exactly the shape of the discarded `null_lifts` vector
that made a family-wise correction uncomputable until it was recovered.

⛔ THE SHUFFLE IS THE LEDGER'S OWN (`lift_ledger.shuffle_returns`, seeded
`NULL_SEED + k`), so this measures the same null the gates are graded against
rather than a second, differently-wrong one.

Usage:
    python tools/measure_noise_firing_rate.py --sample 400 --trials 3 \
        --out docs/noise_firing_rate.json
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
import random
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


def shipped_keys() -> list:
    """"For every pattern you SHIP" — read from the ledger, never typed."""
    rows = ll.load().get("structures") or {}
    return sorted(k for k, v in rows.items() if v.get("published"))


def firing_rates(bars_by: dict, keys: list, probe) -> dict:
    """{key: (fired_anchors, total_anchors)} over one set of series."""
    structs = {k: bc._BY_KEY[k] for k in keys}
    by_window = collections.defaultdict(list)
    for key in structs:
        by_window[WINDOWS.get(key, DEFAULT_WINDOW)].append(key)

    fired = collections.Counter()
    total = collections.Counter()
    horizon = ll.HORIZON_BARS
    for ticker, bars in bars_by.items():
        with probe.item(ticker):
            n = len(bars)
            for window, group in by_window.items():
                for i in range(window, n - horizon - 1, horizon):
                    w = bars[max(0, i + 1 - window):i + 1]
                    ctx = bases._context(w, w)
                    for key in group:
                        total[key] += 1
                        try:
                            if structs[key].detect(ctx):
                                fired[key] += 1
                        except Exception:      # noqa: BLE001
                            pass
            probe.ok()
    return {k: (fired[k], total[k]) for k in structs}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=400)
    ap.add_argument("--trials", type=int, default=3,
                    help="shuffled passes; each is a full universe scan")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    keys = shipped_keys()
    if not keys:
        raise SystemExit("no published structures — nothing ships, nothing to check")
    print("[keys] %d shipped: %s" % (len(keys), ", ".join(keys)))

    bars_by = load_universe(args.sample)
    print("[universe] %d tickers" % len(bars_by))

    with Probe("real firing rate", expect_min=150) as p:
        real = firing_rates(bars_by, keys, p)

    sim = {k: [0, 0] for k in keys}
    for trial in range(args.trials):
        rng = random.Random(ll.NULL_SEED + trial)
        shuffled = {}
        for sym, bars in bars_by.items():
            sh = ll.shuffle_returns(bars, rng)
            if sh:
                shuffled[sym] = sh
        with Probe("shuffled firing rate trial %d" % trial, expect_min=150) as p:
            got = firing_rates(shuffled, keys, p)
        for k, (f, t) in got.items():
            sim[k][0] += f
            sim[k][1] += t

    print("\n%-24s%12s%12s%10s" % ("structure", "real rate", "noise rate", "ratio"))
    out = {}
    for k in keys:
        rf, rt = real[k]
        sf, st = sim[k]
        r_rate = rf / rt if rt else 0.0
        s_rate = sf / st if st else 0.0
        # ⛔ A RATIO NEEDS A DENOMINATOR. If the detector never fired on ANY
        # shuffled series the ratio is not "infinite" — it is unmeasured at this
        # sample size, and printing a number would be an unmeasurable result
        # wearing a measured one's clothes.
        ratio = (r_rate / s_rate) if s_rate > 0 else None
        out[k] = {"real_fired": rf, "real_anchors": rt,
                  "noise_fired": sf, "noise_anchors": st,
                  "real_rate": round(r_rate, 6), "noise_rate": round(s_rate, 6),
                  "ratio": round(ratio, 3) if ratio is not None else None}
        print("%-24s%11.4f%%%11.4f%%%10s"
              % (k, 100 * r_rate, 100 * s_rate,
                 ("%.2f" % ratio) if ratio is not None else "unmeasured"))

    print("\nA ratio near 1.0 means the predicate fires as often on a random walk")
    print("as on the market: it is describing the noise process, not a feature.")

    if args.out:
        blob = {"measured_at": time.strftime("%Y-%m-%d"),
                "sample_tickers": len(bars_by), "trials": args.trials,
                "null_seed": ll.NULL_SEED, "step_bars": ll.HORIZON_BARS,
                "structures": out}
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
