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

    # 🔴 WARM AND DETECT IN ONE PASS, PER TICKER. Warming the whole universe
    # FIRST and detecting afterwards cannot work: `api.services.cache.cache` is a
    # 1,000-entry LRU and `bars_split_repair._splits_for` reads it CACHE-ONLY, so
    # warming 3,794 keys evicts all but the last ~1,000 and every earlier ticker
    # answers "no splits" WITHOUT EVER BEING ASKED. Measured 2026-08-09: a
    # `--universe --warm` dry run returned 83 hits spanning RNST→ZBH and not one
    # from A–Q — and DD and ABTC, both PROVEN unadjusted an hour earlier, sat in
    # the evicted range and were reported clean.
    #
    # ⭐ The splits are handed to `repair_ticker` EXPLICITLY, so this pass never
    # depends on the cache surviving at all — the same shape `api/main.py`'s
    # scheduled sweep uses, and the reason that one was never affected.
    results: list[dict] = []
    meta_failed: list[str] = []
    for i, t in enumerate(tickers, 1):
        splits = None
        if args.warm:
            key = bars_sanitize._META_KEY.format(t)
            meta = cache.get(key)
            if meta is None:
                try:
                    meta = bars_sanitize._fetch_meta(t)
                    cache.set(key, meta, ttl=bars_sanitize._META_TTL)
                except Exception:                              # noqa: BLE001
                    # ⛔ NEVER let a refused call fall through as "no splits" —
                    # that is a clean-looking sweep over a ticker nobody asked
                    # about. Count it, name it, and skip it.
                    cache.set(key, {"ipo": None, "splits": []},
                              ttl=bars_sanitize._META_FAIL_TTL)
                    meta_failed.append(t)
                    continue
                time.sleep(0.05)          # provider politeness, not a rate limit
            splits = list((meta or {}).get("splits") or [])
        for tf in tfs:
            # One ticker's exception must not end the run.
            try:
                results.append(bars_split_repair.repair_ticker(
                    t, tf, splits=splits, apply=args.apply))
            except Exception as exc:                           # noqa: BLE001
                results.append({"ticker": t, "tf": tf, "boundaries": [],
                                "changed": 0,
                                "error": f"{type(exc).__name__}: {exc}"})
        if i % 100 == 0:
            print(f"  swept {i}/{len(tickers)}  "
                  f"hits={len([r for r in results if r.get('boundaries')])} "
                  f"meta_failed={len(meta_failed)}", flush=True)

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
    # ⭐ SEPARATE COUNTS, NOT ONE TOTAL — "asked, and there was nothing" and
    # "could not ask" are different facts, and collapsing them is exactly how a
    # sweep that reached nothing reads as a quiet night.
    print(f"[sweep] {len(tickers) - len(meta_failed)}/{len(tickers)} tickers were "
          f"actually ASKED about; {len(meta_failed)} could not be")
    if meta_failed:
        # 🔴 ASCII ONLY, AND THAT IS NOT A STYLE CHOICE. This line existed to NAME
        # the tickers nobody asked about, and the first real run it did died in it:
        # a "⚠️" in the string, stdout redirected to a file, Windows cp1252 ->
        # UnicodeEncodeError. The summary above had already printed "16 could not
        # be", so the run reported a coverage hole and then took the list of names
        # to the grave -- the one output the operator needed. A rail that NAMES
        # things must be able to emit the names on the console it actually runs on.
        print("[sweep] NOT SWEPT (the provider would not answer): "
              + ",".join(meta_failed))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
