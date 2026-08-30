"""Re-measure lift for every named structure and rewrite the ledger artifact.

    python tools/run_lift_ledger.py                    # measure, print, write
    python tools/run_lift_ledger.py --dry-run          # measure and print only
    python tools/run_lift_ledger.py --sample 800       # wider sample, slower
    python tools/run_lift_ledger.py --null-trials 30   # harder null
    python tools/run_lift_ledger.py --only darvas-box

⛔ WHY THIS IS A TOOL AND NOT A SCHEDULER JOB. The completion plan called for a
cron job; that was the wrong call and this is the correction. The web pod
already carries ~135 cron jobs, 39 threads and a 39s boot, and the jobs cannot
move off it because 20+ SQLite databases live on its per-service volume. This
harness runs for MINUTES (each structure is re-scanned once per null trial),
and what it measures — whether a multi-week structure beats the market's own
base rate — moves on a quarterly timescale, not a nightly one. Adding a
multi-minute monthly job to that pod buys nothing and costs real headroom.

So the freshness guarantee is the other half of this pair:
`lift_ledger.is_stale()` plus `test_the_ledger_is_not_stale`, which fails BY
NAME once the artifact ages past the bound and names this command in the
failure message. A job that silently stops running is invisible; a rail that
goes red is not.

⚠️ RUN THIS WHERE `bars.db` IS COMPLETE. On a thin local copy the sample is
quietly smaller and every interval quietly wider.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import bars_sqlite                                # noqa: E402
from api.services.screener import base_catalog as bc                # noqa: E402
from api.services.screener import lift_ledger as ll                 # noqa: E402
from api.services.screener import technicals                        # noqa: E402

#: Per-structure scan window. A structure may only be measured over a window
#: that can actually contain it — Green Line Breakout reads MONTHLY highs, so a
#: 400-bar window would silently redefine its "all-time" high as an 18-month
#: high and the measurement would be of a different pattern.
WINDOWS = {
    "darvas-box":          400,
    "green-line-breakout": 1500,
    "pocket-pivot":        300,
    "power-play":          200,
}
DEFAULT_WINDOW = 400


def load_universe(sample: int, seed: int = 7) -> dict:
    from api.services.screener import snapshot_db
    db = snapshot_db.get_db_path()
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    day = con.execute("select max(snapshot_date) from screener_rows").fetchone()[0]
    tickers = [r[0] for r in con.execute(
        "select ticker from screener_rows where snapshot_date=? order by ticker",
        (day,))]
    random.Random(seed).shuffle(tickers)

    out = {}
    for t in tickers[:sample]:
        raw = bars_sqlite.get_bars(t, "D", 3000) or []
        bars = technicals.usable_bars(
            [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
             for r in raw])
        if len(bars) >= 400:
            out[t] = bars
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=400)
    ap.add_argument("--null-trials", type=int, default=ll.NULL_TRIALS)
    ap.add_argument("--bootstrap", type=int, default=ll.BOOTSTRAP_TRIALS)
    ap.add_argument("--only", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default=ll.LEDGER_PATH)
    args = ap.parse_args()

    bars_by = load_universe(args.sample)
    print(f"universe: {len(bars_by)} tickers\n")

    existing = ll.load(args.out)
    structures = dict((existing.get("structures") or {}))

    for s in bc.RELATIONS:
        if args.only and s.key != args.only:
            continue
        window = WINDOWS.get(s.key, DEFAULT_WINDOW)
        usable = {k: v for k, v in bars_by.items() if len(v) >= window + 25}
        det = (lambda st: (lambda w: bool(
            st.detect(SimpleNamespace(bars=w, bars_full=w)))))(s)
        kw = dict(window=window, min_history=window, step=ll.HORIZON_BARS)

        t0 = time.time()
        obs = ll.measure(det, usable, bootstrap=args.bootstrap, **kw)
        nulls = ll.null_lifts(det, usable, trials=args.null_trials, **kw)
        verdict = ll.adjudicate(obs, nulls)

        print(f"=== {s.label} ({s.key}) ===")
        print(f"  tickers {len(usable)}  anchors {obs['anchors']:,}  "
              f"n {obs['n']:,}  ({time.time() - t0:.0f}s)")
        if obs["lift"] is not None:
            print(f"  lift {obs['lift'] * 100:+.2f}pp  "
                  f"cluster CI [{obs['ci_low'] * 100:+.2f}, "
                  f"{obs['ci_high'] * 100:+.2f}]")
        if nulls:
            print(f"  null n={len(nulls)}  max {max(nulls) * 100:+.2f}pp")
        print(f"  PUBLISHED: {verdict['published']}")
        for r in verdict.get("reasons", []):
            print(f"    refused: {r}")
        print()

        row = {"published": bool(verdict["published"])}
        if obs["lift"] is not None:
            row.update({
                "lift": round(obs["lift"], 4),
                "ci_low": round(obs["ci_low"], 4),
                "ci_high": round(obs["ci_high"], 4),
                "n": obs["n"],
                "rate": round(obs["rate"], 4),
                "baseline": round(obs["baseline"], 4),
            })
        if nulls:
            row["null_max"] = round(max(nulls), 4)
            row["null_trials"] = len(nulls)
        if not verdict["published"]:
            row["reasons"] = verdict.get("reasons", [])
        # ⛔ Keep any hand-written `note` — the artifact's prose records WHY a
        # verdict landed where it did, and a re-run must not silently erase it.
        prior = structures.get(s.key) or {}
        if prior.get("note"):
            row["note"] = prior["note"]
        structures[s.key] = row

    if args.dry_run:
        print("--dry-run: artifact not written")
        return 0

    data = dict(existing)
    data["structures"] = structures
    data["measured_at"] = time.strftime("%Y-%m-%d")
    data["sample"] = (f"{len(bars_by)} tickers x up to 3,000 daily bars, drawn "
                      f"seeded-random from the screener universe.")
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
