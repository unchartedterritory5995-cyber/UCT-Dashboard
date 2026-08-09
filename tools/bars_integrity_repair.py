"""Repair the impossible daily bars already sitting in the store.

The 2026-08-09 numerical audit counted, over 17,144,361 daily rows:

    open outside [low, high]     3,533 rows / 195 tickers
    close outside [low, high]       32
    close NULL                     119
    o/h/l NULL                       2
    close <= 0                       1
    intraday equivalents             0

`api/services/bars_sqlite.put_bars` now refuses to store such a row, so this tool
is only about the rows that are already there. It runs in two passes, in this
order, and the order is the whole point:

  --refetch   ask the PROVIDER for the sessions that carry a bad row and write
              what comes back. `put_bars` validates, so a still-bad answer is
              still refused. This is what recovers the 214 mixed-session opens
              and the 119 NaN closes: all of them are settled sessions that a
              provider can supply correctly today.

  --purge     delete what survives the refetch. That is the material NO source
              has — a vendor's `0.0` open sentinel on a closed-end fund's old
              history, an all-NULL `v=0` placeholder.

⛔ NOTHING HERE FABRICATES AN OHLC. Clamping the open into `[low, high]`, or
widening the high to admit it, invents a print that did not happen — the defect
class this audit exists to remove, not a repair of it. A row that cannot be
recovered is ABSENT, and `_fmt_sqlite_bars` already drops absent-shaped rows at
serve time, so nothing user-visible regresses.

⛔ THE SELECTOR IS THE RULE, NOT THE SYMPTOM. `bars_sqlite.impossible_bars` asks
`bar_validation.possible_bar_reasons` — the same question the write path asks —
so the post-repair re-scan is a real measurement. A repair keyed on "open above
high" could not re-find its own failures after changing them, and this repo has
paid for that shape before.

⚠️ `C:\\data\\bars.db` IS A LIVE SHARED ARTIFACT. Default is a DRY RUN, and
`--db` lets you point every pass at a sandbox copy first.

Usage
-----
    python tools/bars_integrity_repair.py --scan
    python tools/bars_integrity_repair.py --db %TEMP%\\sandbox --refetch --apply
    python tools/bars_integrity_repair.py --db %TEMP%\\sandbox --purge --apply
"""
from __future__ import annotations

import argparse
import collections
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _report(rows) -> None:
    by_reason = collections.Counter(r["reasons"][0] for r in rows)
    by_tf = collections.Counter(r["tf"] for r in rows)
    tickers = {r["ticker"] for r in rows}
    print(f"  impossible rows : {len(rows)} across {len(tickers)} tickers")
    for reason, n in by_reason.most_common():
        print(f"      {n:>7}  {reason}")
    print(f"  by timeframe    : {dict(by_tf)}")
    for r in rows[:8]:
        b = r["bar"]
        print(f"      {r['ticker']:<8} {r['tf']:<2} {r['ts']}  "
              f"o={b['o']} h={b['h']} l={b['l']} c={b['c']} v={b['v']}  {r['reasons']}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", help="DATA_DIR holding bars.db (default: the live one)")
    ap.add_argument("--scan", action="store_true", help="count and classify only")
    ap.add_argument("--refetch", action="store_true",
                    help="ask the provider for the affected sessions")
    ap.add_argument("--purge", action="store_true",
                    help="delete what survives the refetch")
    ap.add_argument("--apply", action="store_true",
                    help="actually write. Without it every pass is a dry run.")
    ap.add_argument("--tf", default=None, help="restrict to one timeframe")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    if args.db:
        os.environ["DATA_DIR"] = args.db
    from api.services import bars_sqlite

    rows = bars_sqlite.impossible_bars(tf=args.tf, limit=args.limit)
    print(f"[scan] {bars_sqlite._DB_PATH}")
    _report(rows)
    if args.scan or not (args.refetch or args.purge):
        return 0

    if args.refetch:
        from api.services import bars_fetch
        affected = sorted({(r["ticker"], r["tf"]) for r in rows})
        print(f"[refetch] {len(affected)} (ticker, tf) pairs"
              + ("" if args.apply else "  DRY RUN — nothing fetched"))
        if args.apply:
            for i, (ticker, tf) in enumerate(affected, 1):
                try:
                    bars_fetch.get_bars(ticker, tf, 5000)
                except Exception as exc:                      # noqa: BLE001
                    print(f"    {ticker} {tf}: {type(exc).__name__}: {exc}")
                if i % 25 == 0:
                    print(f"    … {i}/{len(affected)}")
            rows = bars_sqlite.impossible_bars(tf=args.tf, limit=args.limit)
            print("[after refetch]")
            _report(rows)

    if args.purge:
        out = bars_sqlite.purge_impossible_bars(tf=args.tf, apply=args.apply,
                                                limit=args.limit)
        print(f"[purge] {out}")
        if args.apply:
            left = bars_sqlite.impossible_bars(tf=args.tf)
            print(f"[verify] impossible rows remaining: {len(left)}")
            return 0 if not left else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
