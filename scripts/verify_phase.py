"""Pattern Recognition phase verification harness.

Runs 9 health checks against the engine + memory + live API. Saves a structured
markdown report to docs/superpowers/phase-reports/.

Usage:
  python scripts/verify_phase.py 0           # verify Phase 0
  python scripts/verify_phase.py 1           # verify Phase 1 (cumulative)
  python scripts/verify_phase.py 0 --skip-api  # skip live API smoke
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time

# Force UTF-8 stdout/stderr for emoji output on Windows (cp1252 default).
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# Make sibling packages + repo root importable when run as `python scripts/verify_phase.py`
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from verify_phase_checks import (
    test_suite, inventory, schema, api_smoke, fixture_battery,
    fp_sweep, perf_bench, confidence_dist, consistency,
)


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_REPORT_DIR = os.path.join(_REPO_ROOT, "docs", "superpowers", "phase-reports")


def _run_check(name: str, fn, **kwargs):
    """Run a single check; return (status, emoji, summary_line, details_markdown)."""
    t0 = time.time()
    try:
        result = fn(**kwargs)
        elapsed = time.time() - t0
        status = result.get("status", "PASS")
        emoji  = {"PASS": "✅", "WARN": "⚠️ ", "FAIL": "❌"}.get(status, "❓")
        summary = result.get("summary", "")
        details = result.get("details", "")
        return status, emoji, f"{summary} ({elapsed:.2f}s)", details
    except Exception as e:
        elapsed = time.time() - t0
        return "ERROR", "💥", f"raised {type(e).__name__}: {e} ({elapsed:.2f}s)", ""


def main(phase: int, skip_api: bool = False):
    print(f"\n{'=' * 60}")
    print(f"  PATTERN RECOGNITION — Phase {phase} Verification")
    print(f"  {dt.datetime.now().isoformat()}")
    print(f"{'=' * 60}\n")

    checks = [
        ("Test Suite",             test_suite.run,        {}),
        ("Detector Inventory",     inventory.run,         {}),
        ("Schema Integrity",       schema.run,            {}),
        ("Live API Smoke",         api_smoke.run,         {"skip": skip_api}),
        ("Fixture Batteries",      fixture_battery.run,   {}),
        ("False-Positive Sweep",   fp_sweep.run,          {}),
        ("Performance Bench",      perf_bench.run,        {}),
        ("Confidence Distribution", confidence_dist.run,  {}),
        ("Cross-Detector Consistency", consistency.run,   {}),
    ]

    results = []
    overall = "PASS"
    for name, fn, kwargs in checks:
        print(f"→ Running {name}...")
        status, emoji, summary, details = _run_check(name, fn, **kwargs)
        print(f"  {emoji} {summary}\n")
        results.append((name, status, emoji, summary, details))
        if status in ("FAIL", "ERROR"):
            overall = "FAIL"
        elif status == "WARN" and overall != "FAIL":
            overall = "WARN"

    # Write report
    os.makedirs(_REPORT_DIR, exist_ok=True)
    date = dt.datetime.now().strftime("%Y-%m-%d")
    report_path = os.path.join(_REPORT_DIR, f"{date}-phase-{phase}-verification.md")
    _write_report(report_path, phase, overall, results)

    print(f"{'=' * 60}")
    print(f"  Overall: {overall}")
    print(f"  Report: {report_path}")
    print(f"{'=' * 60}\n")

    sys.exit(0 if overall == "PASS" else 1)


def _write_report(path: str, phase: int, overall: str, results: list):
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# Phase {phase} Verification Report\n\n")
        f.write(f"**Date:** {dt.datetime.now().isoformat()}\n")
        f.write(f"**Overall:** {overall}\n\n")
        f.write("## Summary\n\n")
        f.write("| Check | Status | Result |\n")
        f.write("|---|---|---|\n")
        for name, status, emoji, summary, _ in results:
            f.write(f"| {name} | {emoji} {status} | {summary} |\n")
        f.write("\n## Details\n\n")
        for name, status, emoji, summary, details in results:
            f.write(f"### {emoji} {name} — {status}\n\n")
            f.write(f"{summary}\n\n")
            if details:
                f.write(f"{details}\n\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify a pattern recognition phase")
    parser.add_argument("phase", type=int, help="Phase number to verify (0-7)")
    parser.add_argument("--skip-api", action="store_true", help="Skip live API smoke checks")
    args = parser.parse_args()
    main(args.phase, skip_api=args.skip_api)
