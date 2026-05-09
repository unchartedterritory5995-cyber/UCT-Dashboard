"""Audit engine — scans cached bars for validation failures and series issues.

Two entry points:
  audit_ticker(ticker)        — single-ticker scan
  audit_universe()            — universe-wide parallel scan (Task 11)
"""
import json
import os
from typing import Optional

from api.services import bars_disk_cache, bar_validation


_DEFAULT_TFS = ("1", "5", "15", "30", "60", "D", "W", "M")


def _read_cache_file(ticker: str, tf: str, bars_count: int) -> Optional[dict]:
    p = os.path.join(bars_disk_cache._CACHE_DIR, f"{ticker}_{tf}_{bars_count}.json")
    try:
        with open(p) as f:
            return json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return None


def _scan_payload(ticker: str, tf: str, payload: dict) -> tuple[int, list[dict]]:
    """Return (bars_scanned, list_of_issues). Each issue: {ticker, tf, bar_time, reason}."""
    bars = payload.get("bars") or []
    issues: list[dict] = []
    prior_close = None
    for bar in bars:
        if not isinstance(bar, dict):
            continue
        ok, reasons = bar_validation.validate_bar(bar, prior_close=prior_close)
        if not ok:
            issues.append({
                "ticker": ticker,
                "tf": tf,
                "bar_time": bar.get("t"),
                "reason": "; ".join(reasons),
                "kind": "bar",
            })
        else:
            prior_close = bar.get("c")
    series_issues = bar_validation.validate_series(bars, tf)
    for si in series_issues:
        issues.append({
            "ticker": ticker,
            "tf": tf,
            "bar_time": si.get("bar_time"),
            "reason": si.get("reason"),
            "kind": "series",
        })
    return len(bars), issues


def audit_ticker(
    ticker: str,
    tfs: tuple[str, ...] | list[str] = _DEFAULT_TFS,
    bars_counts: tuple[int, ...] | list[int] = (5000,),
) -> dict:
    """Audit every cached (tf, bars_count) for one ticker."""
    bars_scanned = 0
    issues: list[dict] = []
    for tf in tfs:
        for bc in bars_counts:
            payload = _read_cache_file(ticker, tf, bc)
            if not payload:
                continue
            n, issue_list = _scan_payload(ticker, tf, payload)
            bars_scanned += n
            issues.extend(issue_list)
    return {
        "ticker": ticker,
        "bars_scanned": bars_scanned,
        "issues_found": len(issues),
        "issues": issues,
    }
