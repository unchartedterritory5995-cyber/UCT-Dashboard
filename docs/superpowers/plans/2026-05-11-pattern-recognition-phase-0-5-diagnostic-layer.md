# Pattern Recognition — Phase 0.5 (Diagnostic & Testing Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permanent diagnostic + verification layer for the pattern recognition engine. After each phase ships, a single command produces a structured health report. Real-time admin diagnostics endpoint surfaces engine state. Heavy universe-scan script for pre-Gate-5 verification.

**Architecture:** Three loosely-coupled components, all reading from the existing engine + memory layer:
1. `scripts/verify_phase.py` — CLI that runs 9 health checks and writes a markdown report
2. `api/routers/admin_patterns.py` + `api/services/pattern_engine/diagnostics.py` — `/api/admin/patterns/health` endpoint
3. `scripts/run_universe_scan.py` — heavy verification harness

**Tech Stack:** Python stdlib + existing project deps (pytest, fastapi, sqlite3, numpy). No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md` Section 9 (Testing & Verification Strategy).

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/verify_phase.py` | Orchestrator + 9 check functions + markdown report writer |
| `scripts/verify_phase_checks/__init__.py` | empty package marker |
| `scripts/verify_phase_checks/test_suite.py` | Run `pytest tests/pattern_engine`, summarize |
| `scripts/verify_phase_checks/inventory.py` | List registered detectors |
| `scripts/verify_phase_checks/schema.py` | Verify SQLite tables/indexes |
| `scripts/verify_phase_checks/api_smoke.py` | Hit live `/api/patterns/*` endpoints |
| `scripts/verify_phase_checks/fixture_battery.py` | Run all detector fixture batteries |
| `scripts/verify_phase_checks/fp_sweep.py` | Light false-positive sweep on synthetic data |
| `scripts/verify_phase_checks/perf_bench.py` | Detection latency benchmarks |
| `scripts/verify_phase_checks/confidence_dist.py` | Confidence histograms from stored detections |
| `scripts/verify_phase_checks/consistency.py` | Cross-detector schema + pattern_id uniqueness |
| `scripts/run_universe_scan.py` | Full universe × all TFs scanner harness |
| `api/services/pattern_engine/diagnostics.py` | Pure functions for admin endpoint |
| `api/routers/admin_patterns.py` | `GET /api/admin/patterns/health` |
| `docs/superpowers/phase-reports/.gitkeep` | Directory placeholder |
| `tests/pattern_engine/test_diagnostics.py` | Unit tests for diagnostics functions |
| `tests/pattern_engine/test_admin_router.py` | Tests for the admin endpoint |
| `tests/pattern_engine/test_verify_phase_checks.py` | Tests for the check modules (where deterministic) |

---

## Task 1: verify_phase.py orchestrator + report writer

**Files:**
- Create: `scripts/verify_phase.py`
- Create: `scripts/verify_phase_checks/__init__.py` (empty)
- Create: `docs/superpowers/phase-reports/.gitkeep`

- [ ] **Step 1: Write `scripts/verify_phase_checks/__init__.py`**

Empty file (package marker).

- [ ] **Step 2: Write `scripts/verify_phase.py`**

```python
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

# Make sibling packages importable when run as `python scripts/verify_phase.py`
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from verify_phase_checks import (
    test_suite, inventory, schema, api_smoke, fixture_battery,
    fp_sweep, perf_bench, confidence_dist, consistency,
)


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_REPORT_DIR = os.path.join(_REPO_ROOT, "docs", "superpowers", "phase-reports")


def _run_check(name: str, fn, **kwargs):
    """Run a single check; return (status_emoji, summary_line, details_markdown)."""
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
```

- [ ] **Step 3: Create the phase-reports directory placeholder**

Create `docs/superpowers/phase-reports/.gitkeep` (empty file).

- [ ] **Step 4: Verify the orchestrator imports**

Run: `python -c "import scripts.verify_phase"` — should fail (check modules not yet built). That's expected; we'll build them next.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify_phase.py scripts/verify_phase_checks/__init__.py docs/superpowers/phase-reports/.gitkeep
git commit -m "feat(patterns): verify_phase.py orchestrator + report writer"
```

---

## Task 2: Test suite + Detector inventory checks

**Files:**
- Create: `scripts/verify_phase_checks/test_suite.py`
- Create: `scripts/verify_phase_checks/inventory.py`

- [ ] **Step 1: Write `test_suite.py`**

```python
"""Run pytest against tests/pattern_engine and parse the summary."""
from __future__ import annotations

import os
import re
import subprocess


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def run() -> dict:
    cmd = ["python", "-m", "pytest", "tests/pattern_engine", "-q", "--no-header"]
    proc = subprocess.run(
        cmd, cwd=_REPO_ROOT,
        capture_output=True, text=True,
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    # pytest summary line looks like: "78 passed, 4021 warnings in 1.72s"
    m = re.search(r"(\d+) passed", output)
    f = re.search(r"(\d+) failed", output)
    e = re.search(r"(\d+) error", output)
    passed = int(m.group(1)) if m else 0
    failed = int(f.group(1)) if f else 0
    errored = int(e.group(1)) if e else 0
    total = passed + failed + errored

    status = "PASS" if (failed == 0 and errored == 0 and passed > 0) else "FAIL"
    summary = f"{passed}/{total} passing"
    details_lines = ["```", *output.strip().splitlines()[-25:], "```"]
    details = "\n".join(details_lines)
    return {"status": status, "summary": summary, "details": details,
            "passed": passed, "failed": failed, "errored": errored}
```

- [ ] **Step 2: Write `inventory.py`**

```python
"""Report all registered detectors + their categories."""
from __future__ import annotations


def run() -> dict:
    # Import patterns router to trigger detector self-registration.
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids

    ids = list_pattern_ids()
    if not ids:
        return {"status": "FAIL", "summary": "no detectors registered", "details": ""}

    # Try to infer category from _PATTERN_METADATA
    try:
        from api.routers.patterns import _PATTERN_METADATA
        meta = _PATTERN_METADATA
    except Exception:
        meta = {}

    lines = ["| pattern_id | category |", "|---|---|"]
    for pid in ids:
        category = meta.get(pid, {}).get("category", "?")
        lines.append(f"| `{pid}` | {category} |")

    return {
        "status": "PASS",
        "summary": f"{len(ids)} detector(s) registered",
        "details": "\n".join(lines),
    }
```

- [ ] **Step 3: Smoke-check**

Run from repo root:
```bash
python -c "import sys; sys.path.insert(0, 'scripts'); from verify_phase_checks import test_suite, inventory; print(test_suite.run()['summary']); print(inventory.run()['summary'])"
```

Expected: `78/78 passing` and `1 detector(s) registered`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify_phase_checks/test_suite.py scripts/verify_phase_checks/inventory.py
git commit -m "feat(patterns): verify checks — test_suite + inventory"
```

---

## Task 3: Schema + Live API smoke checks

**Files:**
- Create: `scripts/verify_phase_checks/schema.py`
- Create: `scripts/verify_phase_checks/api_smoke.py`

- [ ] **Step 1: Write `schema.py`**

```python
"""Verify the 4 pattern_* tables + their indexes exist in auth.db."""
from __future__ import annotations

from api.services.auth_db import get_connection, init_db


_EXPECTED_TABLES = {"pattern_detections", "pattern_outcomes", "pattern_stats", "pattern_feedback"}
_EXPECTED_INDEXES = {"idx_pd_sym_tf", "idx_pd_pattern", "idx_pd_status", "idx_pf_detection"}


def run() -> dict:
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pattern_%'"
        ).fetchall()
        tables = {r["name"] for r in rows}

        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_p%'"
        ).fetchall()
        indexes = {r["name"] for r in rows}

        missing_tables = _EXPECTED_TABLES - tables
        missing_indexes = _EXPECTED_INDEXES - indexes

        if missing_tables or missing_indexes:
            details_lines = []
            if missing_tables:
                details_lines.append(f"Missing tables: {sorted(missing_tables)}")
            if missing_indexes:
                details_lines.append(f"Missing indexes: {sorted(missing_indexes)}")
            return {"status": "FAIL", "summary": "schema incomplete",
                    "details": "\n".join(details_lines)}

        # Check hash_key UNIQUE constraint
        cols = conn.execute("PRAGMA table_info(pattern_detections)").fetchall()
        col_names = [c["name"] for c in cols]
        has_hash_key = "hash_key" in col_names

        details = (
            f"Tables: {sorted(tables)}\n"
            f"Indexes: {sorted(indexes)}\n"
            f"pattern_detections has hash_key column: {has_hash_key}"
        )
        return {"status": "PASS", "summary": "all 4 tables + 4 indexes present",
                "details": details}
    finally:
        conn.close()
```

- [ ] **Step 2: Write `api_smoke.py`**

```python
"""Hit the live /api/patterns/* endpoints on Railway and verify response shapes."""
from __future__ import annotations

import json
import os
import urllib.request


_BASE = os.environ.get("UCT_API_BASE", "https://uctintelligence.com")


def _get(path: str) -> tuple[int, dict | str]:
    req = urllib.request.Request(f"{_BASE}{path}", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode("utf-8")
            try:
                return r.status, json.loads(body)
            except json.JSONDecodeError:
                return r.status, body
    except Exception as e:
        return 0, str(e)


def _post(path: str, payload: dict) -> tuple[int, dict | str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{_BASE}{path}", data=data, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode("utf-8")
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body
    except Exception as e:
        return 0, str(e)


def run(skip: bool = False) -> dict:
    if skip:
        return {"status": "WARN", "summary": "skipped (--skip-api)", "details": ""}

    checks = []
    fails = 0

    # 1. GET /api/patterns/types
    code, body = _get("/api/patterns/types")
    if code == 200 and isinstance(body, dict) and "patterns" in body:
        checks.append(("GET /api/patterns/types", "PASS", f"{len(body['patterns'])} types"))
    else:
        checks.append(("GET /api/patterns/types", "FAIL", f"code={code} body={str(body)[:80]}"))
        fails += 1

    # 2. GET /api/patterns/{sym}
    code, body = _get("/api/patterns/AAPL?tf=D")
    if code == 200 and isinstance(body, dict) and "detections" in body and "count" in body:
        checks.append(("GET /api/patterns/AAPL", "PASS", f"{body['count']} detections"))
    else:
        checks.append(("GET /api/patterns/AAPL", "FAIL", f"code={code} body={str(body)[:80]}"))
        fails += 1

    # 3. POST /api/patterns/{id}/feedback with invalid rating → 400
    code, body = _post("/api/patterns/nonexistent-test-id/feedback",
                       {"rating": "garbage", "user_id": "test"})
    if code == 400:
        checks.append(("POST feedback (bad rating)", "PASS", "rejected with 400"))
    else:
        checks.append(("POST feedback (bad rating)", "FAIL", f"expected 400, got {code}"))
        fails += 1

    lines = ["| Endpoint | Status | Detail |", "|---|---|---|"]
    for ep, st, detail in checks:
        lines.append(f"| {ep} | {st} | {detail} |")

    status = "PASS" if fails == 0 else "FAIL"
    summary = f"{len(checks) - fails}/{len(checks)} endpoints OK"
    return {"status": status, "summary": summary, "details": "\n".join(lines)}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/verify_phase_checks/schema.py scripts/verify_phase_checks/api_smoke.py
git commit -m "feat(patterns): verify checks — schema + api_smoke"
```

---

## Task 4: Fixture battery + False-positive sweep

**Files:**
- Create: `scripts/verify_phase_checks/fixture_battery.py`
- Create: `scripts/verify_phase_checks/fp_sweep.py`

- [ ] **Step 1: Write `fixture_battery.py`**

```python
"""Run all detector fixture batteries and report per-detector pass/fail."""
from __future__ import annotations

import os

from api.services.pattern_engine.primitives.context import build_context


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_FIXTURE_ROOT = os.path.join(_REPO_ROOT, "tests", "fixtures")


def _discover_patterns() -> list[str]:
    """Find pattern_ids that have fixture directories."""
    if not os.path.isdir(_FIXTURE_ROOT):
        return []
    return sorted([
        name for name in os.listdir(_FIXTURE_ROOT)
        if os.path.isdir(os.path.join(_FIXTURE_ROOT, name))
    ])


def run() -> dict:
    # Import to trigger detector registration
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import get_detector
    from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

    pattern_ids = _discover_patterns()
    if not pattern_ids:
        return {"status": "WARN", "summary": "no fixture directories found", "details": ""}

    lines = ["| pattern | fixtures | pass | fail |", "|---|---|---|---|"]
    total_pass = 0
    total_fail = 0

    for pid in pattern_ids:
        try:
            fn = get_detector(pid)
        except KeyError:
            lines.append(f"| `{pid}` | — | — | (no detector registered) |")
            continue
        fixtures = load_all_fixtures(pid, include_internal=False)
        passed = 0
        failed = 0
        for fx in fixtures:
            ctx = fx.context if fx.context else build_context(fx.bars, sym="TEST")
            try:
                detections = fn(fx.bars, ctx)
            except Exception:
                failed += 1
                continue
            if fx.expected_fires:
                if not detections:
                    failed += 1
                    continue
                best = max(detections, key=lambda d: d["confidence"])
                if fx.min_confidence <= best["confidence"] <= fx.max_confidence:
                    passed += 1
                else:
                    failed += 1
            else:
                # Expected not to fire
                if not detections or all(d["confidence"] < 50.0 for d in detections):
                    passed += 1
                else:
                    failed += 1
        total_pass += passed
        total_fail += failed
        lines.append(f"| `{pid}` | {len(fixtures)} | {passed} | {failed} |")

    status = "PASS" if total_fail == 0 else "FAIL"
    summary = f"{total_pass}/{total_pass + total_fail} fixtures pass across {len(pattern_ids)} detector(s)"
    return {"status": status, "summary": summary, "details": "\n".join(lines)}
```

- [ ] **Step 2: Write `fp_sweep.py`**

```python
"""Light false-positive sweep: run all detectors on synthetic random walks and
monotonic trends, report detections per 1000 bars per detector.

Any detector that fires more than ~2× the median rate is flagged as potentially
over-eager. Heavy universe-scale sweep lives in scripts/run_universe_scan.py.
"""
from __future__ import annotations

import random
from statistics import median

from api.services.pattern_engine.primitives.context import build_context


def _random_walk(n: int, seed: int, drift: float = 0.0, start: float = 100.0,
                 sigma: float = 1.0) -> list[dict]:
    rng = random.Random(seed)
    bars = []
    price = start
    t = 1700000000
    for _ in range(n):
        d = rng.gauss(drift, sigma)
        new_price = max(0.01, price + d)
        h = max(price, new_price) + abs(rng.uniform(0, 0.3))
        l = min(price, new_price) - abs(rng.uniform(0, 0.3))
        bars.append({"t": t, "o": round(price, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(new_price, 2), "v": 1000.0})
        price = new_price
        t += 86400
    return bars


def _monotonic_trend(n: int, slope: float, start: float = 100.0) -> list[dict]:
    bars = []
    t = 1700000000
    for i in range(n):
        c = start + slope * i
        bars.append({"t": t, "o": c - 0.1, "h": c + 0.2, "l": c - 0.2,
                     "c": c, "v": 1000.0})
        t += 86400
    return bars


def run() -> dict:
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids, get_detector

    pids = list_pattern_ids()
    if not pids:
        return {"status": "WARN", "summary": "no detectors registered", "details": ""}

    # Build 10 synthetic series: 5 random walks + 5 monotonic trends
    series = []
    for seed in range(1, 6):
        series.append(("random_walk", _random_walk(200, seed=seed)))
    series.append(("uptrend_steep", _monotonic_trend(200, 0.5)))
    series.append(("uptrend_gentle", _monotonic_trend(200, 0.15)))
    series.append(("flat", _monotonic_trend(200, 0.0)))
    series.append(("downtrend_gentle", _monotonic_trend(200, -0.15)))
    series.append(("downtrend_steep", _monotonic_trend(200, -0.5)))

    total_bars = sum(len(s[1]) for s in series)
    per_pid_counts: dict[str, int] = {pid: 0 for pid in pids}

    for label, bars in series:
        ctx = build_context(bars, sym="SYN")
        for pid in pids:
            try:
                detections = get_detector(pid)(bars, ctx)
            except Exception:
                continue
            per_pid_counts[pid] += len(detections)

    # Detections per 1000 bars
    rates = {pid: round(count / total_bars * 1000, 2) for pid, count in per_pid_counts.items()}
    median_rate = median(rates.values()) if rates else 0.0

    lines = ["| pattern | detections | rate (per 1000 bars) | flag |", "|---|---|---|---|"]
    flagged = 0
    for pid in sorted(pids):
        rate = rates[pid]
        flag = ""
        if median_rate > 0 and rate > median_rate * 2:
            flag = "⚠ over-eager"
            flagged += 1
        elif rate > 10:
            flag = "⚠ high"
            flagged += 1
        lines.append(f"| `{pid}` | {per_pid_counts[pid]} | {rate} | {flag} |")

    status = "PASS" if flagged == 0 else "WARN"
    summary = f"sweep across {total_bars} synthetic bars; median rate {median_rate:.2f}/1k; {flagged} flagged"
    return {"status": status, "summary": summary, "details": "\n".join(lines)}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/verify_phase_checks/fixture_battery.py scripts/verify_phase_checks/fp_sweep.py
git commit -m "feat(patterns): verify checks — fixture_battery + fp_sweep"
```

---

## Task 5: Performance + Confidence distribution + Consistency

**Files:**
- Create: `scripts/verify_phase_checks/perf_bench.py`
- Create: `scripts/verify_phase_checks/confidence_dist.py`
- Create: `scripts/verify_phase_checks/consistency.py`

- [ ] **Step 1: Write `perf_bench.py`**

```python
"""Performance bench: time detect_all on synthetic 200/500/1000 bar series.

Reports p50/p95/p99 latency per detector. Phase 0 target is <100ms per detect
call (per spec section 8 performance contract).
"""
from __future__ import annotations

import random
import time
from statistics import median


def _make_bars(n: int, seed: int = 42) -> list[dict]:
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    price = 100.0
    for _ in range(n):
        price = max(0.01, price + rng.gauss(0, 0.6))
        h = price + abs(rng.uniform(0, 0.3))
        l = price - abs(rng.uniform(0, 0.3))
        bars.append({"t": t, "o": price - 0.1, "h": h, "l": l, "c": price, "v": 1000.0})
        t += 86400
    return bars


def run() -> dict:
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context

    sizes = [200, 500, 1000]
    iters_per_size = 20
    rows = []

    for size in sizes:
        timings = []
        bars = _make_bars(size, seed=size)
        ctx = build_context(bars, sym="BENCH")
        for i in range(iters_per_size):
            t0 = time.perf_counter()
            detect_all(bars, ctx)
            timings.append((time.perf_counter() - t0) * 1000)  # ms
        timings.sort()
        p50 = round(median(timings), 2)
        p95 = round(timings[int(len(timings) * 0.95)], 2)
        p99 = round(timings[-1], 2)
        rows.append((size, p50, p95, p99))

    lines = ["| bar count | p50 (ms) | p95 (ms) | p99 (ms) | target | result |",
             "|---|---|---|---|---|---|"]
    fails = 0
    for size, p50, p95, p99 in rows:
        target = 100.0  # ms p99 for 500 bars; relax for 1000
        target_actual = 100.0 if size <= 500 else 200.0
        ok = p99 < target_actual
        if not ok:
            fails += 1
        lines.append(f"| {size} | {p50} | {p95} | {p99} | <{target_actual}ms p99 | {'✅' if ok else '❌'} |")

    status = "PASS" if fails == 0 else "WARN"
    summary = (f"p99 latency across {sizes}: " +
               ", ".join([f"{p99}ms" for _, _, _, p99 in rows]))
    return {"status": status, "summary": summary, "details": "\n".join(lines)}
```

- [ ] **Step 2: Write `confidence_dist.py`**

```python
"""Confidence histogram per detector from stored detections.

Calibration sanity check: if a detector has hundreds of detections all in
70-80, something's probably off. Wide spread + median near 60-70 is healthy.
"""
from __future__ import annotations

from api.services.auth_db import get_connection, init_db


_BINS = [(0, 50), (50, 60), (60, 70), (70, 80), (80, 90), (90, 100.01)]


def run() -> dict:
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT pattern_id, confidence FROM pattern_detections"
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return {"status": "WARN", "summary": "no stored detections yet",
                "details": "Detections accumulate as the engine runs in production."}

    # Group by pattern_id
    per_pattern: dict[str, list[float]] = {}
    for r in rows:
        per_pattern.setdefault(r["pattern_id"], []).append(r["confidence"])

    headers = ["pattern", "n", "<50", "50-60", "60-70", "70-80", "80-90", "90+"]
    lines = ["| " + " | ".join(headers) + " |"]
    lines.append("| " + " | ".join("---" for _ in headers) + " |")

    for pid in sorted(per_pattern.keys()):
        confs = per_pattern[pid]
        n = len(confs)
        cells = [f"`{pid}`", str(n)]
        for lo, hi in _BINS:
            cnt = sum(1 for c in confs if lo <= c < hi)
            cells.append(str(cnt))
        lines.append("| " + " | ".join(cells) + " |")

    summary = f"distribution across {len(rows)} stored detection(s), {len(per_pattern)} pattern(s)"
    return {"status": "PASS", "summary": summary, "details": "\n".join(lines)}
```

- [ ] **Step 3: Write `consistency.py`**

```python
"""Cross-detector consistency checks.

Verify:
  1. No duplicate pattern_ids in the registry.
  2. Every detector returns a list (possibly empty) — never None / dict.
  3. Every Detection has all required keys.
"""
from __future__ import annotations


_REQUIRED_KEYS = {
    "id", "sym", "tf", "pattern_id", "pattern_name", "category", "direction",
    "start_t", "end_t", "pivot_ts", "geometry", "levels", "context",
    "confidence", "quality_components", "narrative", "status", "outcome",
    "detected_at", "last_seen_at",
}


def run() -> dict:
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids, get_detector
    from api.services.pattern_engine.primitives.context import build_context

    pids = list_pattern_ids()
    if not pids:
        return {"status": "WARN", "summary": "no detectors registered", "details": ""}

    # Duplicate pattern_ids — list_pattern_ids() returns sorted set so dup-free
    # by construction; we still verify by checking len equals set len.
    if len(pids) != len(set(pids)):
        return {"status": "FAIL", "summary": "duplicate pattern_ids in registry",
                "details": f"{pids}"}

    issues = []
    bars = [{"t": 1700000000 + i * 86400, "o": 100, "h": 101, "l": 99,
             "c": 100, "v": 1000} for i in range(40)]
    ctx = build_context(bars, sym="TEST")

    for pid in pids:
        try:
            out = get_detector(pid)(bars, ctx)
        except Exception as e:
            issues.append(f"`{pid}` raised {type(e).__name__}: {e}")
            continue
        if not isinstance(out, list):
            issues.append(f"`{pid}` returned {type(out).__name__}, expected list")
            continue
        for d in out:
            missing = _REQUIRED_KEYS - set(d.keys())
            if missing:
                issues.append(f"`{pid}` Detection missing keys: {sorted(missing)}")

    if issues:
        return {"status": "FAIL",
                "summary": f"{len(issues)} consistency issue(s)",
                "details": "\n".join(f"- {i}" for i in issues)}

    return {"status": "PASS",
            "summary": f"{len(pids)} detector(s) emit valid Detection schema, no duplicates",
            "details": ""}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify_phase_checks/perf_bench.py scripts/verify_phase_checks/confidence_dist.py scripts/verify_phase_checks/consistency.py
git commit -m "feat(patterns): verify checks — perf_bench + confidence_dist + consistency"
```

---

## Task 6: Admin diagnostics endpoint

**Files:**
- Create: `api/services/pattern_engine/diagnostics.py`
- Create: `api/routers/admin_patterns.py`
- Modify: `api/main.py` (register router)
- Create: `tests/pattern_engine/test_diagnostics.py`
- Create: `tests/pattern_engine/test_admin_router.py`

- [ ] **Step 1: Write `tests/pattern_engine/test_diagnostics.py`**

```python
from api.services.pattern_engine import diagnostics
from api.services.pattern_engine import memory
from api.services.auth_db import init_db


def _det(**overrides):
    base = {
        "id": "diag-1", "sym": "DIAG", "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "pivot_ts": [],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100, "entry_condition": "", "stop": 95, "stop_basis": "",
                   "target_primary": 110, "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 75.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                               "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": 1700100100, "last_seen_at": 1700100100,
    }
    base.update(overrides)
    return base


def test_collect_returns_required_top_level_keys():
    init_db()
    h = diagnostics.collect_health()
    for key in ("detector_count", "stored_detections_total", "stored_by_pattern",
                "stored_by_status", "recent_24h_count", "registered_detectors"):
        assert key in h


def test_stored_by_pattern_counts():
    init_db()
    memory.store_detection(_det(id="diag-1", sym="AAAA", start_t=1, end_t=2))
    memory.store_detection(_det(id="diag-2", sym="BBBB", start_t=3, end_t=4))
    h = diagnostics.collect_health()
    assert h["stored_by_pattern"].get("bull_flag", 0) >= 2


def test_registered_detectors_includes_bull_flag():
    h = diagnostics.collect_health()
    assert "bull_flag" in h["registered_detectors"]
```

- [ ] **Step 2: Write `api/services/pattern_engine/diagnostics.py`**

```python
"""Diagnostic snapshot of the pattern engine state.

Pure read functions, no side effects. Consumed by /api/admin/patterns/health.
"""
from __future__ import annotations

import time

from api.services.auth_db import get_connection, init_db


def collect_health() -> dict:
    """Build a single dict snapshotting the engine state."""
    # Import patterns router to trigger detector registration.
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids

    init_db()

    registered = list_pattern_ids()

    conn = get_connection()
    try:
        # Total stored
        row = conn.execute("SELECT COUNT(*) AS n FROM pattern_detections").fetchone()
        total = row["n"] if row else 0

        # By pattern
        rows = conn.execute(
            "SELECT pattern_id, COUNT(*) AS n FROM pattern_detections GROUP BY pattern_id"
        ).fetchall()
        by_pattern = {r["pattern_id"]: r["n"] for r in rows}

        # By status
        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM pattern_detections GROUP BY status"
        ).fetchall()
        by_status = {r["status"]: r["n"] for r in rows}

        # Recent 24h
        now = int(time.time())
        cutoff = now - 86400
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM pattern_detections WHERE detected_at >= ?",
            (cutoff,),
        ).fetchone()
        recent = row["n"] if row else 0

        # Last detection timestamp
        row = conn.execute(
            "SELECT MAX(detected_at) AS t FROM pattern_detections"
        ).fetchone()
        last_detected_at = row["t"] if row and row["t"] else None
    finally:
        conn.close()

    return {
        "generated_at": int(time.time()),
        "detector_count": len(registered),
        "registered_detectors": registered,
        "stored_detections_total": total,
        "stored_by_pattern": by_pattern,
        "stored_by_status": by_status,
        "recent_24h_count": recent,
        "last_detected_at": last_detected_at,
        "schema_version": "phase_0",
    }
```

- [ ] **Step 3: Write `tests/pattern_engine/test_admin_router.py`**

```python
from fastapi.testclient import TestClient

from api.main import app


client = TestClient(app)


def test_health_endpoint_returns_200_and_required_keys():
    r = client.get("/api/admin/patterns/health")
    assert r.status_code == 200
    body = r.json()
    for key in ("detector_count", "stored_detections_total", "registered_detectors",
                "stored_by_pattern", "stored_by_status", "schema_version"):
        assert key in body
```

- [ ] **Step 4: Write `api/routers/admin_patterns.py`**

```python
"""Admin diagnostics for the pattern engine.

Phase 0.5 surfaces engine health as JSON. Phase 5+ will add AuthGuard
admin-only enforcement once the UI lands.
"""
from __future__ import annotations

from fastapi import APIRouter

from api.services.pattern_engine.diagnostics import collect_health


router = APIRouter(prefix="/api/admin/patterns", tags=["admin-patterns"])


@router.get("/health")
def health():
    return collect_health()
```

- [ ] **Step 5: Wire into main.py**

In `api/main.py`, find the existing `from api.routers import patterns as patterns_router` line and add right after:
```python
from api.routers import admin_patterns as admin_patterns_router
```
Find the existing `app.include_router(patterns_router.router)` and add right after:
```python
app.include_router(admin_patterns_router.router)
```

- [ ] **Step 6: Run tests**

```bash
python -m pytest tests/pattern_engine/test_diagnostics.py tests/pattern_engine/test_admin_router.py -v
```
Expected: 4/4 passing.

- [ ] **Step 7: Commit**

```bash
git add api/services/pattern_engine/diagnostics.py api/routers/admin_patterns.py api/main.py tests/pattern_engine/test_diagnostics.py tests/pattern_engine/test_admin_router.py
git commit -m "feat(patterns): /api/admin/patterns/health diagnostics endpoint"
```

---

## Task 7: Universe scan harness (skeleton)

**Files:**
- Create: `scripts/run_universe_scan.py`

- [ ] **Step 1: Write the harness**

```python
"""Heavy universe-scale scan of the pattern engine.

For each ticker in cap_universe.json × specified timeframes, fetch bars from
bars_sqlite, run all registered detectors, store detections to memory layer.

Used for:
  - Phase 6 Gate 3 (false positive sweep at scale)
  - Phase 6 Gate 4 (confidence calibration baseline)
  - Continuous post-launch monitoring

Usage:
  python scripts/run_universe_scan.py --tf D --max 100      # 100 tickers, daily
  python scripts/run_universe_scan.py --tf D --tf W         # all tickers, daily + weekly
  python scripts/run_universe_scan.py --dry-run             # don't store, just count
"""
from __future__ import annotations

import argparse
import json
import os
import time

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_UNIVERSE_PATH = os.path.join(_REPO_ROOT, "api", "data", "cap_universe.json")


def _load_universe() -> list[str]:
    with open(_UNIVERSE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return [t for t in data if isinstance(t, str)]
    if isinstance(data, dict) and "tickers" in data:
        return data["tickers"]
    return []


def run(timeframes: list[str], max_tickers: int | None, dry_run: bool, bars_per: int):
    from api.services import bars_sqlite
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.primitives.context import build_context
    from api.routers import patterns as _patterns  # noqa: F401

    universe = _load_universe()
    if max_tickers:
        universe = universe[:max_tickers]
    print(f"Scanning {len(universe)} ticker(s) × {len(timeframes)} timeframe(s) = "
          f"{len(universe) * len(timeframes)} symbol-TFs")

    t0 = time.time()
    counts = {tf: 0 for tf in timeframes}
    per_pattern: dict[str, int] = {}
    fetch_misses = 0

    for sym in universe:
        for tf in timeframes:
            rows = bars_sqlite.get_bars(sym, tf, bars_per)
            if not rows:
                fetch_misses += 1
                continue
            bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                    for r in rows]
            ctx = build_context(bars, sym=sym)
            detections = detect_all(bars, ctx)
            counts[tf] += len(detections)
            for d in detections:
                pid = d.get("pattern_id", "?")
                per_pattern[pid] = per_pattern.get(pid, 0) + 1
                if not dry_run:
                    d["sym"] = sym
                    d["tf"] = tf
                    try:
                        memory.store_detection(d)
                    except Exception as e:
                        print(f"  store failed for {sym} {tf} {pid}: {e}")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")
    print(f"Fetch misses (no bars): {fetch_misses}")
    print(f"Detections per timeframe:")
    for tf in timeframes:
        print(f"  {tf}: {counts[tf]}")
    print(f"Detections per pattern:")
    for pid, n in sorted(per_pattern.items(), key=lambda x: -x[1]):
        print(f"  {pid}: {n}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tf", action="append", default=[], help="timeframe(s) to scan")
    parser.add_argument("--max", type=int, default=None, help="cap on tickers")
    parser.add_argument("--bars", type=int, default=200, help="bars per symbol-tf")
    parser.add_argument("--dry-run", action="store_true", help="don't store detections")
    args = parser.parse_args()
    tfs = args.tf if args.tf else ["D"]
    run(tfs, args.max, args.dry_run, args.bars)
```

- [ ] **Step 2: Smoke test (don't fully run — it's heavy)**

Just verify imports work:
```bash
python -c "import scripts.run_universe_scan"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/run_universe_scan.py
git commit -m "feat(patterns): run_universe_scan.py harness (Phase 6 verification + post-launch)"
```

---

## Task 8: Run verify_phase.py 0 → first phase report

The payoff. Run the harness against the current state and commit the first verification report.

- [ ] **Step 1: Run verify_phase.py 0**

```bash
python scripts/verify_phase.py 0
```

Expected:
- Console summary with 9 check results
- Report file at `docs/superpowers/phase-reports/YYYY-MM-DD-phase-0-verification.md`
- Overall: PASS (assuming Railway is responsive; if not, run with `--skip-api`)

- [ ] **Step 2: Review the report**

Read the generated report. If any check returned FAIL or unexpected WARN, diagnose. Fix the underlying issue OR adjust the check to be more accurate. Re-run.

- [ ] **Step 3: Push everything to Railway**

```bash
git push
```

- [ ] **Step 4: Wait for redeploy + re-verify the admin endpoint live**

```bash
until curl -s -m 10 https://uctintelligence.com/api/admin/patterns/health 2>/dev/null | head -c 50 | grep -q "detector_count"; do sleep 15; done
curl -s https://uctintelligence.com/api/admin/patterns/health | python -m json.tool
```

Expected: `detector_count: 1`, `registered_detectors: ["bull_flag"]`, schema_version `phase_0`, plus zero stored detections (engine on-demand, none stored yet).

- [ ] **Step 5: Commit the phase report**

```bash
git add docs/superpowers/phase-reports/
git commit -m "verify(patterns): Phase 0 verification report — all 9 checks pass"
git push
```

---

## Phase 0.5 Done — what shipped

After this plan:
- `verify_phase.py` CLI: 9-check health harness, structured markdown reports
- `/api/admin/patterns/health`: live diagnostic JSON endpoint
- `run_universe_scan.py`: heavy verification harness (Phase 6 + post-launch)
- First Phase 0 verification report committed to repo

After Phase 1-7: every phase signoff requires `python scripts/verify_phase.py N` returning PASS. If a phase introduces a regression in any of the 9 checks, it's blocked until fixed.

## Self-review

- All 9 checks have a dedicated module under `scripts/verify_phase_checks/`.
- `verify_phase.py` discovers + runs all of them, writes structured report.
- Admin endpoint surfaces real-time state without requiring CLI access.
- Universe scan harness is skeleton-only; Phase 6 fleshes out the full sweep.
- 2 new unit tests added (diagnostics + admin router).
- No new dependencies introduced.
- Type consistency: every check returns `{status, summary, details}`.
