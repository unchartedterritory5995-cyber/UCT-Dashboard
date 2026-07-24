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


import sqlite3
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

_logger = logging.getLogger(__name__)
_AUDIT_DIR = os.environ.get("AUDIT_DIR", "/data/audits")
_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")
# Reports had NO retention at all: one JSON per run, kept forever. By 2026-07-23
# that was 11,850 files / 1.0GB on the web volume, dating back to audit-1.json.
# The audit_runs table keeps the summary row regardless, so an expired report
# costs the run's issue detail, not the fact that it happened.
_AUDIT_KEEP = int(os.environ.get("AUDIT_REPORTS_KEEP", "200"))
_AUDIT_MAX_AGE_DAYS = int(os.environ.get("AUDIT_REPORTS_MAX_AGE_DAYS", "30"))


def prune_reports(keep: int = None, max_age_days: int = None) -> int:
    """Keep the newest `keep` reports; drop the rest once past `max_age_days`.

    🔒 Called unconditionally at the START of every run — NOT gated on the run
    finding issues or completing. Coupling cleanup to the interesting branch is
    exactly how the 2026-07-23 disk incident happened, twice.
    """
    keep = _AUDIT_KEEP if keep is None else keep
    max_age = (_AUDIT_MAX_AGE_DAYS if max_age_days is None else max_age_days) * 86400
    if not os.path.isdir(_AUDIT_DIR):
        return 0
    entries = []
    for name in os.listdir(_AUDIT_DIR):
        if not (name.startswith("audit-") and name.endswith(".json")):
            continue
        p = os.path.join(_AUDIT_DIR, name)
        try:
            entries.append((p, os.stat(p).st_mtime))
        except OSError:
            continue
    entries.sort(key=lambda e: e[1], reverse=True)      # newest first
    cutoff = time.time() - max_age
    removed = 0
    for p, mtime in entries[keep:]:
        if mtime >= cutoff:
            continue
        try:
            os.remove(p)
            removed += 1
        except OSError:
            pass
    if removed:
        _logger.info("[bars_audit] pruned %d expired report(s)", removed)
    return removed


def _init_audit_runs_table():
    schema = """
    CREATE TABLE IF NOT EXISTS audit_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      scope TEXT NOT NULL,
      scope_arg TEXT,
      tickers_scanned INTEGER NOT NULL DEFAULT 0,
      bars_scanned INTEGER NOT NULL DEFAULT 0,
      issues_found INTEGER NOT NULL DEFAULT 0,
      report_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_started ON audit_runs(started_at);
    """
    with sqlite3.connect(_DB_PATH, timeout=10.0) as db:
        db.executescript(schema)


def _record_audit_run(scope: str, scope_arg: str | None) -> int:
    with sqlite3.connect(_DB_PATH, timeout=10.0) as db:
        cur = db.execute(
            "INSERT INTO audit_runs (started_at, scope, scope_arg) VALUES (?, ?, ?)",
            (int(time.time()), scope, scope_arg),
        )
        return int(cur.lastrowid)


def _finish_audit_run(run_id: int, tickers: int, bars: int, issues: int, report_path: str):
    with sqlite3.connect(_DB_PATH, timeout=10.0) as db:
        db.execute(
            "UPDATE audit_runs SET finished_at=?, tickers_scanned=?, bars_scanned=?, "
            "issues_found=?, report_path=? WHERE id=?",
            (int(time.time()), tickers, bars, issues, report_path, run_id),
        )


def audit_universe(
    tickers: list[str],
    tfs: list[str] = list(_DEFAULT_TFS),
    bars_counts: list[int] = [5000],
    parallelism: int = 4,
    scope: str = "universe",
    scope_arg: str | None = None,
) -> dict:
    """Scan every ticker in `tickers`. Persist report to /data/audits/."""
    _init_audit_runs_table()
    started_at = int(time.time())
    run_id = _record_audit_run(scope, scope_arg)
    os.makedirs(_AUDIT_DIR, exist_ok=True)
    try:
        prune_reports()
    except Exception as e:                      # never let housekeeping kill a run
        _logger.warning("[bars_audit] report prune failed (non-fatal): %s", e)

    all_issues: list[dict] = []
    bars_scanned = 0
    tickers_scanned = 0

    with ThreadPoolExecutor(max_workers=parallelism) as ex:
        futures = {
            ex.submit(audit_ticker, t, tuple(tfs), tuple(bars_counts)): t
            for t in tickers
        }
        for fut in as_completed(futures):
            try:
                rep = fut.result()
            except Exception as e:
                _logger.warning("[bars_audit] %s failed: %s", futures[fut], e)
                continue
            tickers_scanned += 1
            bars_scanned += rep["bars_scanned"]
            all_issues.extend(rep["issues"])

    report = {
        "run_id": run_id,
        "started_at": started_at,
        "scope": scope,
        "scope_arg": scope_arg,
        "tickers_scanned": tickers_scanned,
        "bars_scanned": bars_scanned,
        "issues_found": len(all_issues),
        "by_failure_type": _bucket_by_reason(all_issues),
        "issues": all_issues[:10000],
        "issues_truncated": len(all_issues) > 10000,
    }
    report_path = os.path.join(_AUDIT_DIR, f"audit-{run_id}.json")
    with open(report_path, "w") as f:
        json.dump(report, f)
    report["report_path"] = report_path

    _finish_audit_run(run_id, tickers_scanned, bars_scanned, len(all_issues), report_path)
    return report


def _bucket_by_reason(issues: list[dict]) -> dict:
    buckets: dict[str, int] = {}
    for i in issues:
        key = (i.get("reason") or "unknown").split(";")[0].strip()
        buckets[key] = buckets.get(key, 0) + 1
    return buckets


def latest_report() -> dict | None:
    """Return the most recent audit report from disk, or None.

    Uses audit_runs table for correct ordering (lexicographic listdir sort
    breaks once run_id >= 10).
    """
    try:
        with sqlite3.connect(_DB_PATH, timeout=10.0) as db:
            row = db.execute(
                "SELECT report_path FROM audit_runs "
                "WHERE report_path IS NOT NULL "
                "ORDER BY id DESC LIMIT 1"
            ).fetchone()
        if not row or not row[0]:
            return None
        with open(row[0]) as f:
            return json.load(f)
    except (sqlite3.Error, OSError, json.JSONDecodeError):
        return None
