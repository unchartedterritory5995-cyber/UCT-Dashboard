"""CLI: detect stale intraday caches and surgically refresh them.

The intraday SWR path can wedge in a state where _inflight stays set or
_delta_intraday returns empty, leaving a ticker frozen at some past
last_ts even though Polygon has fresh bars. The diagnostic symptom is
trivial — last bar in cache is hours stale during market hours — but
the recovery is brutal: per-ticker /api/admin/refresh-bars wipe + a
follow-up /api/bars call to trigger cold-fetch.

This tool automates that loop across a basket. Usage:

    python -m tools.refresh_stale_intraday
    python -m tools.refresh_stale_intraday --basket core --tfs 1,5,15
    python -m tools.refresh_stale_intraday --tickers QQQ,SPY,NVDA --tfs 1
    python -m tools.refresh_stale_intraday --max-stale-minutes 10

A cache is considered stale if the most recent bar's timestamp is older
than --max-stale-minutes (default 5) OR if /api/bars returns 0 bars.

Auth: PUSH_SECRET env or --secret.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import urllib.request
import urllib.error


_DEFAULT_DASHBOARD = "https://web-production-05cb6.up.railway.app"
ET = timezone(timedelta(hours=-4))  # EDT in May; flip to -5 outside DST


# Same baskets as audit_bars_bulk for consistency.
_BASKETS = {
    "core": [
        "SPY", "QQQ", "DIA", "IWM",
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
        "JPM", "V", "MA", "BAC", "WMT", "COST", "XOM", "CVX",
    ],
    "ai": ["NVDA", "AVGO", "AMD", "ASML", "TSM", "MRVL", "MU", "SMCI", "PLTR", "SNOW", "DDOG", "ARM"],
    "fintech": ["V", "MA", "PYPL", "SQ", "SOFI", "HOOD", "COIN", "AFRM", "NU"],
    "energy": ["XOM", "CVX", "COP", "OXY", "EOG", "SLB", "MPC", "VLO", "PSX"],
    "smallcap": ["SANM", "SOUN", "RKLB", "HUT", "MARA", "RIOT", "LCID", "RIVN"],
    "etfs": ["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "XLK", "XLF", "XLE", "XLV", "GLD", "TLT"],
}


def _get(url: str, timeout: float = 30.0) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, json.JSONDecodeError):
        return None


def _post(url: str, secret: str, timeout: float = 30.0) -> tuple[int, str]:
    req = urllib.request.Request(url, method="POST",
                                  headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")[:500]
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500] if e.fp else ""
        return e.code, body
    except urllib.error.URLError as e:
        return 0, str(e)


def _check_staleness(base: str, ticker: str, tf: str,
                      max_stale_min: float) -> tuple[bool, str, int]:
    """Returns (is_stale, reason, cache_count)."""
    url = f"{base}/api/bars/{ticker}?tf={tf}&bars=2000"
    d = _get(url, timeout=20)
    if d is None:
        return True, "fetch-failed", 0
    bars = d.get("bars", []) or []
    if not bars:
        return True, "empty", 0
    last_t = bars[-1].get("t")
    if not isinstance(last_t, (int, float)):
        return True, "no-last-ts", len(bars)
    last_dt = datetime.fromtimestamp(int(last_t), tz=ET)
    age_min = (datetime.now(tz=ET) - last_dt).total_seconds() / 60
    if age_min > max_stale_min:
        return True, f"age={age_min:.0f}min", len(bars)
    return False, f"current ({age_min:.0f}min ago)", len(bars)


def _refresh(base: str, secret: str, ticker: str, tf: str) -> tuple[int, str]:
    url = f"{base}/api/admin/refresh-bars/{ticker}?tf={tf}"
    return _post(url, secret, timeout=30)


def _trigger_repop(base: str, ticker: str, tf: str) -> int:
    """GET /api/bars to trigger cold-fetch repopulation. Returns bar count."""
    d = _get(f"{base}/api/bars/{ticker}?tf={tf}&bars=2000", timeout=45)
    if d is None:
        return 0
    return len(d.get("bars", []) or [])


def _process_one(base: str, secret: str, ticker: str, tf: str,
                  max_stale_min: float, dry_run: bool) -> dict:
    started = time.time()
    is_stale, reason, before_count = _check_staleness(base, ticker, tf, max_stale_min)
    out = {"ticker": ticker, "tf": tf, "before_count": before_count,
           "stale": is_stale, "reason": reason, "after_count": before_count,
           "elapsed_s": 0.0}
    if not is_stale:
        out["elapsed_s"] = time.time() - started
        return out
    if dry_run:
        out["elapsed_s"] = time.time() - started
        return out
    code, body = _refresh(base, secret, ticker, tf)
    out["refresh_status"] = code
    # The refresh endpoint sometimes 500s on a non-fatal layer error; the
    # SQLite wipe still happened. Always trigger a repop and verify.
    after_count = _trigger_repop(base, ticker, tf)
    out["after_count"] = after_count
    # Re-check staleness after repop.
    still_stale, post_reason, _ = _check_staleness(base, ticker, tf, max_stale_min)
    out["post_reason"] = post_reason
    out["elapsed_s"] = time.time() - started
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tools.refresh_stale_intraday",
        description="Detect stale intraday caches and surgically refresh them.",
    )
    parser.add_argument("--tickers", default="", help="Comma-separated tickers")
    parser.add_argument("--basket", default=None,
                        help=f"Named basket: {', '.join(sorted(_BASKETS))}")
    parser.add_argument("--tfs", default="1,5,15,30",
                        help="Comma-separated intraday timeframes (default: 1,5,15,30)")
    parser.add_argument("--max-stale-minutes", type=float, default=5.0,
                        help="Threshold for stale detection (default: 5min)")
    parser.add_argument("--workers", type=int, default=4,
                        help="Parallel HTTP workers — keep low to avoid backend 502s")
    parser.add_argument("--base", default=os.environ.get("DASHBOARD_URL", _DEFAULT_DASHBOARD))
    parser.add_argument("--secret", default=os.environ.get("PUSH_SECRET", ""))
    parser.add_argument("--dry-run", action="store_true",
                        help="Detect only, do not refresh")
    args = parser.parse_args(argv)

    if not args.dry_run and not args.secret:
        print("ERROR: PUSH_SECRET required for refresh (env or --secret).", file=sys.stderr)
        return 2

    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    elif args.basket:
        if args.basket not in _BASKETS:
            print(f"ERROR: unknown basket {args.basket}", file=sys.stderr)
            return 2
        tickers = list(_BASKETS[args.basket])
    else:
        tickers = list(_BASKETS["core"])

    tfs = [t.strip() for t in args.tfs.split(",") if t.strip()]
    if any(tf not in ("1", "5", "15", "30", "60") for tf in tfs):
        print("ERROR: --tfs must contain only intraday tfs (1, 5, 15, 30, 60)", file=sys.stderr)
        return 2

    jobs = [(t, tf) for t in tickers for tf in tfs]
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'REFRESH'}  "
          f"basket={len(tickers)} tickers x {len(tfs)} tfs = {len(jobs)} checks")
    print(f"Backend: {args.base}")
    print(f"Stale threshold: {args.max_stale_minutes}min")
    print()

    rows = []
    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(_process_one, args.base, args.secret, t, tf,
                        args.max_stale_minutes, args.dry_run): (t, tf)
            for t, tf in jobs
        }
        for fut in as_completed(futures):
            r = fut.result()
            rows.append(r)
            sym, tf = r["ticker"], r["tf"]
            if not r["stale"]:
                print(f"  {sym:6} tf={tf:<2}  OK     before={r['before_count']:>4}  "
                      f"reason={r['reason']}")
            else:
                if args.dry_run:
                    print(f"  {sym:6} tf={tf:<2}  STALE  before={r['before_count']:>4}  "
                          f"reason={r['reason']}  (would refresh)")
                else:
                    status = r.get("refresh_status", "?")
                    print(f"  {sym:6} tf={tf:<2}  REFRESHED  before={r['before_count']:>4} -> "
                          f"after={r['after_count']:>4}  refresh_http={status}  "
                          f"post={r['post_reason']}  ({r['elapsed_s']:.1f}s)")
    elapsed = time.time() - started
    stale = [r for r in rows if r["stale"]]
    print()
    print(f"Done in {elapsed:.1f}s. {len(stale)}/{len(rows)} were stale.")
    if not args.dry_run:
        recovered = sum(1 for r in stale if r["after_count"] > r["before_count"])
        still_stale = sum(1 for r in stale if "current" not in r.get("post_reason", ""))
        print(f"  Recovered (cache count grew): {recovered}/{len(stale)}")
        print(f"  Still stale after refresh:    {still_stale}/{len(stale)}")
    return 0 if not stale else 1


if __name__ == "__main__":
    sys.exit(main())
