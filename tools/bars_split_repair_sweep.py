"""Heal un-back-adjusted splits across the whole store, one ticker at a time.

The serve path hands `bars_split_repair` a ticker the moment it DETECTS an
unadjusted split (`bars_sanitize._schedule_store_repair`), so a charted ticker
heals itself. This is the pass for everything nobody charts — which on this
branch is most of the universe, and includes the two names the audit measured.

⚠️ DEFAULT IS A DRY RUN, and `C:\\data\\bars.db` is a live shared artifact. Point
`--db` at a sandbox copy and read the plan before pointing it at the real one.

⚠️ IT NEEDS CORPORATE-ACTION METADATA, WHICH IS READ FROM CACHE ONLY.
`bars_sanitize._meta_cached` never fetches synchronously — that is the
524-outage invariant — so a cold cache means "nothing to do yet" and the ticker
is reported as `no-splits`. `--warm` asks for the metadata first (bounded, one
FMP call per ticker), which is what makes a one-shot sweep meaningful.

Usage
-----
    python tools/bars_split_repair_sweep.py --db %TEMP%\\sandbox --tickers DD,ABTC
    python tools/bars_split_repair_sweep.py --universe --warm            # plan only
    python tools/bars_split_repair_sweep.py --universe --warm --apply
"""
from __future__ import annotations

import argparse
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _universe() -> list[str]:
    from api.services import bars_sqlite
    return sorted({t for t, _tf in (bars_sqlite.get_all_tickers() or [])})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", help="DATA_DIR holding bars.db (default: the live one)")
    ap.add_argument("--tickers", help="comma-separated list")
    ap.add_argument("--universe", action="store_true", help="every ticker in the store")
    ap.add_argument("--warm", action="store_true",
                    help="fetch corporate-action metadata first (one call/ticker)")
    ap.add_argument("--apply", action="store_true", help="write. Default is a dry run.")
    ap.add_argument("--tfs", default="D,W,M")
    args = ap.parse_args()

    if args.db:
        os.environ["DATA_DIR"] = args.db
    from api.services import bars_sanitize, bars_split_repair
    from api.services.cache import cache

    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    elif args.universe:
        tickers = _universe()
    else:
        ap.error("give --tickers or --universe")
        return 2

    tfs = tuple(t.strip() for t in args.tfs.split(",") if t.strip())
    print(f"[sweep] {len(tickers)} tickers x {tfs}  apply={args.apply}")

    if args.warm:
        for i, t in enumerate(tickers, 1):
            if cache.get(bars_sanitize._META_KEY.format(t)) is None:
                try:
                    meta = bars_sanitize._fetch_meta(t)
                    cache.set(bars_sanitize._META_KEY.format(t), meta,
                              ttl=bars_sanitize._META_TTL)
                except Exception:                              # noqa: BLE001
                    cache.set(bars_sanitize._META_KEY.format(t),
                              {"ipo": None, "splits": []},
                              ttl=bars_sanitize._META_FAIL_TTL)
                time.sleep(0.05)          # provider politeness, not a rate limit
            if i % 100 == 0:
                print(f"  warmed {i}/{len(tickers)}")

    results = bars_split_repair.sweep(tickers, apply=args.apply, tfs=tfs)
    hits = [r for r in results if r.get("boundaries")]
    rows = sum(r.get("written" if args.apply else "changed", 0) for r in hits)
    print(f"[sweep] {len(hits)} (ticker, tf) carry an unadjusted split; "
          f"{rows} rows {'rewritten' if args.apply else 'would be rewritten'}")
    for r in hits:
        print(f"    {r['ticker']:<8} {r['tf']:<2} {r['boundaries']}  "
              f"changed={r['changed']} written={r.get('written', 0)}")
    errors = [r for r in results if r.get("error")]
    if errors:
        print(f"[sweep] {len(errors)} ticker(s) raised:")
        for r in errors[:20]:
            print(f"    {r['ticker']} {r['tf']}: {r['error']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
