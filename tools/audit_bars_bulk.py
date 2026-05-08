"""CLI: bulk-audit a basket of tickers across timeframes via the running
backend's /api/admin/audit-bars endpoint.

Usage (from repo root):

    python -m tools.audit_bars_bulk
    python -m tools.audit_bars_bulk --tfs D,W,30,60 --bars 200
    python -m tools.audit_bars_bulk --tickers SPY,NVDA,AAPL --tfs D
    python -m tools.audit_bars_bulk --basket sp500 --tfs D --json out.json

Why this exists: single-ticker audit-bars is ad-hoc; without bulk we can't
answer "how correct is the universe right now" across the full market.
This tool drives the post-warm-universe verification loop and the daily
drift-detector.

Auth: needs PUSH_SECRET (env or --secret). Defaults to the dashboard URL
in DASHBOARD_URL env, falls back to the Railway production URL.

Output:
  - per-ticker line: TICKER tf=X bars_compared=N pass=P fail=F warn=W
  - summary block with aggregate pass-rate per timeframe
  - exit code: 0 clean, 1 at least one fail-severity diff anywhere
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Iterable

import urllib.request
import urllib.error


_DEFAULT_DASHBOARD = "https://web-production-05cb6.up.railway.app"

# Curated baskets so callers don't have to type out tickers. Lean toward
# liquid, well-known tickers so failures point at real bugs rather than
# data-source quirks for obscure symbols.
_BASKETS: dict[str, list[str]] = {
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


@dataclass
class _AuditRow:
    ticker: str
    tf: str
    bars_compared: int = 0
    fail_count: int = 0
    warn_count: int = 0
    pass_rate: float = 0.0
    only_in_cache: int = 0
    only_in_canonical: int = 0
    error: str | None = None
    elapsed_s: float = 0.0


def _request(url: str, secret: str, timeout: float = 30.0) -> dict:
    """Single GET against the audit endpoint. Returns parsed JSON or
    raises with a useful message."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            return json.loads(data)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200] if e.fp else ""
        raise RuntimeError(f"HTTP {e.code} {e.reason}: {body}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"URL error: {e.reason}") from None


def _audit_one(base: str, secret: str, ticker: str, tf: str, bars: int) -> _AuditRow:
    started = time.time()
    url = f"{base}/api/admin/audit-bars/{ticker}?tf={tf}&bars={bars}"
    try:
        d = _request(url, secret)
    except Exception as e:
        return _AuditRow(ticker=ticker, tf=tf, error=str(e)[:200],
                         elapsed_s=time.time() - started)
    return _AuditRow(
        ticker=ticker,
        tf=tf,
        bars_compared=int(d.get("bars_compared", 0)),
        fail_count=int(d.get("fail_count", 0)),
        warn_count=int(d.get("warn_count", 0)),
        pass_rate=float(d.get("pass_rate", 0.0)),
        only_in_cache=len(d.get("bars_only_in_cache", []) or []),
        only_in_canonical=len(d.get("bars_only_in_canonical", []) or []),
        error=d.get("error"),
        elapsed_s=time.time() - started,
    )


def _resolve_tickers(args) -> list[str]:
    if args.tickers:
        return [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    if args.basket:
        if args.basket not in _BASKETS:
            raise SystemExit(
                f"Unknown basket {args.basket!r}. Available: "
                f"{', '.join(sorted(_BASKETS))}"
            )
        return list(_BASKETS[args.basket])
    return list(_BASKETS["core"])


def _format_summary(rows: list[_AuditRow]) -> str:
    by_tf: dict[str, list[_AuditRow]] = {}
    for r in rows:
        by_tf.setdefault(r.tf, []).append(r)
    lines = ["", "Summary by timeframe:", "-" * 70]
    lines.append(
        f"  {'tf':>3}  "
        f"{'tickers':>7}  {'audited':>7}  {'fails':>5}  {'warns':>5}  "
        f"{'pass%':>6}  {'gap-bars':>8}"
    )
    overall_fails = 0
    for tf in sorted(by_tf):
        group = by_tf[tf]
        audited = [r for r in group if r.error is None]
        fails = sum(r.fail_count for r in audited)
        warns = sum(r.warn_count for r in audited)
        compared_total = sum(r.bars_compared for r in audited)
        # pass% = fraction of compared bars without a fail-severity diff,
        # weighted across the basket
        if compared_total > 0:
            failed_bars = fails  # one fail = one bar (roughly; over-counts when
                                  # multiple fields diverge in same bar)
            pass_pct = max(0.0, 100.0 * (1.0 - failed_bars / compared_total))
        else:
            pass_pct = 0.0
        gap = sum(r.only_in_canonical for r in audited)
        lines.append(
            f"  {tf:>3}  "
            f"{len(group):>7}  {len(audited):>7}  {fails:>5}  {warns:>5}  "
            f"{pass_pct:>5.2f}%  {gap:>8}"
        )
        overall_fails += fails
    lines.append("-" * 70)
    lines.append(
        f"  Overall fail-severity diffs across basket: {overall_fails}"
    )
    erroring = [r for r in rows if r.error]
    if erroring:
        lines.append(f"  Audit errors (skipped): {len(erroring)}")
        for r in erroring[:5]:
            lines.append(f"    {r.ticker} tf={r.tf}: {r.error}")
    return "\n".join(lines)


def _format_per_row(rows: list[_AuditRow]) -> str:
    out = []
    for r in sorted(rows, key=lambda x: (x.tf, x.ticker)):
        if r.error:
            out.append(f"  {r.ticker:<6}  tf={r.tf:<2}  ERROR: {r.error[:80]}")
            continue
        out.append(
            f"  {r.ticker:<6}  tf={r.tf:<2}  "
            f"compared={r.bars_compared:>4}  "
            f"fail={r.fail_count:>2}  warn={r.warn_count:>2}  "
            f"pass={r.pass_rate * 100:>6.2f}%  "
            f"gap={r.only_in_canonical:>3}  "
            f"({r.elapsed_s:.1f}s)"
        )
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tools.audit_bars_bulk",
        description="Bulk-audit a basket of tickers across timeframes.",
    )
    parser.add_argument("--tickers", default="",
                        help="Comma-separated tickers (overrides --basket)")
    parser.add_argument("--basket", default=None,
                        help=f"Named basket: {', '.join(sorted(_BASKETS))} (default: core)")
    parser.add_argument("--tfs", default="D",
                        help="Comma-separated timeframes (default: D)")
    parser.add_argument("--bars", type=int, default=200,
                        help="Bars per audit (default: 200)")
    parser.add_argument("--workers", type=int, default=8,
                        help="Parallel HTTP workers (default: 8)")
    parser.add_argument(
        "--base", default=os.environ.get("DASHBOARD_URL", _DEFAULT_DASHBOARD),
        help="Backend base URL (default: $DASHBOARD_URL or production)",
    )
    parser.add_argument(
        "--secret", default=os.environ.get("PUSH_SECRET", ""),
        help="Bearer token (default: $PUSH_SECRET)",
    )
    parser.add_argument("--json", default="",
                        help="Write full results to this path (also stdout summary)")
    parser.add_argument("--quiet", action="store_true",
                        help="Skip per-row output, just print summary")
    args = parser.parse_args(argv)

    if not args.secret:
        print("ERROR: PUSH_SECRET not set (env or --secret).", file=sys.stderr)
        return 2

    tickers = _resolve_tickers(args)
    tfs = [t.strip() for t in args.tfs.split(",") if t.strip()]
    if not tfs:
        print("ERROR: --tfs cannot be empty.", file=sys.stderr)
        return 2

    jobs = [(tk, tf) for tk in tickers for tf in tfs]
    rows: list[_AuditRow] = []

    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(_audit_one, args.base, args.secret, tk, tf, args.bars): (tk, tf)
            for tk, tf in jobs
        }
        for fut in as_completed(futures):
            rows.append(fut.result())
    elapsed = time.time() - started

    if not args.quiet:
        print()
        print(f"Bulk audit: {len(tickers)} tickers × {len(tfs)} tfs = "
              f"{len(jobs)} jobs in {elapsed:.1f}s")
        print(f"Backend: {args.base}")
        print()
        print(_format_per_row(rows))

    print(_format_summary(rows))

    if args.json:
        out = {
            "base": args.base,
            "tickers": tickers,
            "tfs": tfs,
            "bars": args.bars,
            "elapsed_s": elapsed,
            "rows": [r.__dict__ for r in rows],
        }
        with open(args.json, "w") as f:
            json.dump(out, f, indent=2)
        print(f"\nFull results: {args.json}")

    fails = sum(r.fail_count for r in rows if r.error is None)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
