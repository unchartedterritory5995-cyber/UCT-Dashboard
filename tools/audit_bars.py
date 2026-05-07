"""CLI: audit one ticker's cached bars against Polygon canonical.

Usage (from repo root):

    python -m tools.audit_bars QQQ
    python -m tools.audit_bars QQQ --tf 30 --bars 200
    python -m tools.audit_bars NVDA --tf D --bars 500 --json

Requires MASSIVE_API_KEY in the environment so the canonical fetch can
hit Polygon directly (this tool deliberately uses Polygon ONLY — no
fallback to FMP/yfinance — so the comparison is meaningful).

DATA_DIR must point at the SQLite directory we want to audit. On Railway
that's /data; locally for dev it usually is too if you've pulled a
snapshot. Override via env: ``DATA_DIR=./tmp/data python -m tools.audit_bars QQQ``.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from api.services.audit import audit_ticker, AuditResult


def _format_ts(ts: int, tf: str) -> str:
    """Render a stored timestamp human-readably. Intraday is unix seconds;
    daily/weekly/monthly is YYYYMMDD int."""
    if tf in ("D", "W", "M"):
        s = str(ts)
        if len(s) == 8:
            return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
        return s
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _emit_text(result: AuditResult) -> None:
    """Pretty CLI output. Designed to be readable in a terminal but
    also greppable for failed/warned timestamps."""
    print()
    print(f"Audit: {result.ticker} tf={result.tf}")
    print("─" * 60)
    if result.error:
        print(f"  ERROR: {result.error}")
        return
    print(f"  Bars compared:        {result.bars_compared}")
    print(f"  Only in cache:        {len(result.bars_only_in_cache)}")
    print(f"  Only in canonical:    {len(result.bars_only_in_canonical)}")
    print(f"  Field-level diffs:    {len(result.diffs)}")
    print(f"    fail-severity:      {result.fail_count}")
    print(f"    warn-severity:      {result.warn_count}")
    print(f"  Pass rate:            {result.pass_rate * 100:.2f}%")

    if result.diffs:
        print()
        print("  Per-bar diffs (fail = real bug, warn = investigate):")
        for d in result.diffs[:50]:  # cap output for huge lists
            ts_h = _format_ts(d.timestamp, result.tf)
            pct = f" ({d.pct_delta * 100:+.3f}%)" if d.pct_delta is not None else ""
            sev_marker = "✗" if d.severity == "fail" else "!"
            print(
                f"    {sev_marker} {ts_h}  {d.field_name:>2s}: "
                f"cache={d.cached!s:<10}  canonical={d.canonical!s:<10}  "
                f"Δ={d.delta:+.4f}{pct}  [{d.severity}]"
            )
        if len(result.diffs) > 50:
            print(f"    … {len(result.diffs) - 50} more (use --json for full)")

    if result.bars_only_in_cache and len(result.bars_only_in_cache) <= 10:
        print()
        print("  Bars present in cache but not canonical:")
        for ts in result.bars_only_in_cache:
            print(f"    {_format_ts(ts, result.tf)}")
    elif result.bars_only_in_cache:
        print(f"\n  {len(result.bars_only_in_cache)} extra bars in cache "
              f"(usually pre/post-market — use --json for the full list)")

    if result.bars_only_in_canonical and len(result.bars_only_in_canonical) <= 10:
        print()
        print("  Bars present in canonical but MISSING from cache (gaps):")
        for ts in result.bars_only_in_canonical:
            print(f"    {_format_ts(ts, result.tf)}")
    elif result.bars_only_in_canonical:
        print(f"\n  {len(result.bars_only_in_canonical)} canonical bars "
              f"missing from cache — likely cache gaps. Use --json for the list.")
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tools.audit_bars",
        description="Audit cached bars against Polygon canonical.",
    )
    parser.add_argument("ticker", help="Ticker symbol (e.g. QQQ, NVDA)")
    parser.add_argument(
        "--tf", default="30",
        help="Timeframe: 1, 5, 15, 30, 60, D, W, M (default: 30)",
    )
    parser.add_argument(
        "--bars", type=int, default=200,
        help="Number of recent bars to compare (default: 200)",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit JSON instead of pretty-printed text",
    )
    args = parser.parse_args(argv)

    if not os.environ.get("MASSIVE_API_KEY"):
        print(
            "ERROR: MASSIVE_API_KEY env var not set. The audit tool fetches "
            "canonical bars directly from Polygon (Massive) — it cannot run "
            "without that credential. Run with `MASSIVE_API_KEY=... python "
            "-m tools.audit_bars ...` or set it in your shell profile.",
            file=sys.stderr,
        )
        return 2

    result = audit_ticker(args.ticker, args.tf, args.bars)

    if args.json:
        print(json.dumps(result.to_dict(), indent=2))
    else:
        _emit_text(result)

    # Exit code reflects audit result so this is CI-usable:
    #   0 = clean (or warn-only)
    #   1 = at least one fail-severity diff
    #   2 = could not run (Massive failure, no canonical)
    if result.error:
        return 2
    if result.fail_count > 0 or result.bars_only_in_canonical:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
