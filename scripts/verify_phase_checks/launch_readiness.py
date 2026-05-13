"""Phase 7 launch-readiness check.

Verifies the engine + UI + scheduler are all positioned for the chart-overlay
default to be flipped to ON. Run as part of `verify_phase.py 7`.

This is a meta-check that aggregates evidence of Gate 4 + Gate 5 readiness.
It does NOT run those gates — those are operational steps the operator (Patrick)
performs via `scripts/calibration_backtest.py` and `/admin/patterns` respectively.
"""
from __future__ import annotations

import glob
import os
from datetime import datetime, timedelta


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def run() -> dict:
    lines = []
    issues = []

    # 1. chartDefaults.showPatterns state
    chart_defaults_path = os.path.join(
        _REPO_ROOT, "app", "src", "components", "chart", "chartDefaults.js"
    )
    try:
        with open(chart_defaults_path, encoding="utf-8") as f:
            content = f.read()
        if "showPatterns: true" in content:
            launch_state = "LAUNCHED (showPatterns default ON)"
            lines.append(f"- chartDefaults.showPatterns: **true** — overlay default ON for all users ✅")
        elif "showPatterns: false" in content:
            launch_state = "PRE-LAUNCH (showPatterns default OFF)"
            lines.append(f"- chartDefaults.showPatterns: **false** — overlay default OFF (pre-launch)")
        else:
            launch_state = "UNKNOWN (showPatterns not found in chartDefaults)"
            issues.append("chartDefaults.showPatterns not detected — Phase 5 scaffolding may be missing")
            lines.append(f"- ⚠️ chartDefaults.showPatterns: not detected")
    except FileNotFoundError:
        launch_state = "UNKNOWN (chartDefaults.js missing)"
        issues.append("chartDefaults.js not found")
        lines.append(f"- ❌ chartDefaults.js not found")

    # 2. Gate 4 evidence — calibration backtest reports
    report_dir = os.path.join(_REPO_ROOT, "docs", "superpowers", "phase-reports")
    calibration_reports = sorted(glob.glob(os.path.join(report_dir, "*-calibration-backtest.md")))
    if calibration_reports:
        most_recent = calibration_reports[-1]
        lines.append(f"- Gate 4 evidence: most recent backtest = `{os.path.basename(most_recent)}` ✅")
    else:
        lines.append(f"- Gate 4 evidence: ⚠️ no calibration backtest report found in `{report_dir}`")
        issues.append("No Gate 4 calibration backtest report — run `python scripts/calibration_backtest.py` before launch")

    # 3. Gate 5 evidence — admin reviews in last 7 days
    try:
        from api.services.auth_db import init_db, get_connection
        init_db()
        conn = get_connection()
        try:
            import time
            week_ago = int(time.time()) - 7 * 86400
            rows = conn.execute(
                """SELECT rating, COUNT(*) AS n
                   FROM pattern_feedback
                   WHERE user_id = 'admin_operator' AND created_at >= ?
                   GROUP BY rating""",
                (week_ago,),
            ).fetchall()
            review_count = sum(r["n"] for r in rows)
            accept_count = sum(r["n"] for r in rows if r["rating"] == "great")
            accept_rate = (accept_count / review_count * 100) if review_count else 0
            if review_count >= 500 and accept_rate >= 85:
                lines.append(
                    f"- Gate 5 evidence: {review_count} reviews / {accept_rate:.1f}% accept rate over last 7 days ✅ (PASSES ≥500 reviews + ≥85%)"
                )
            elif review_count > 0:
                lines.append(
                    f"- Gate 5 evidence: {review_count} reviews / {accept_rate:.1f}% accept rate over last 7 days ⚠️ (need ≥500 reviews + ≥85% — keep reviewing)"
                )
                if launch_state.startswith("LAUNCHED"):
                    issues.append(
                        f"chartDefaults already flipped to true but Gate 5 not met ({review_count} reviews, {accept_rate:.1f}%)"
                    )
            else:
                lines.append(f"- Gate 5 evidence: no admin reviews yet — start at https://uctintelligence.com/admin/patterns")
                if launch_state.startswith("LAUNCHED"):
                    issues.append("chartDefaults flipped to true but no Gate 5 reviews exist — ROLLBACK recommended")
        finally:
            conn.close()
    except Exception as e:
        lines.append(f"- Gate 5 evidence: ⚠️ couldn't query pattern_feedback ({e})")

    # 4. Detector count check
    try:
        from api.routers import patterns as _patterns  # noqa: F401
        from api.services.pattern_engine.detectors.registry import list_pattern_ids
        n_detectors = len(list_pattern_ids())
        if n_detectors >= 50:
            lines.append(f"- Detector count: **{n_detectors}** ✅ (catalog complete)")
        else:
            lines.append(f"- Detector count: {n_detectors} ⚠️ (expected 50)")
            issues.append(f"Only {n_detectors} detectors registered, expected 50")
    except Exception as e:
        lines.append(f"- Detector count: ⚠️ couldn't load registry ({e})")

    # 5. Documentation present
    docs_present = [
        ("Launch checklist", "docs/operations/phase-7-launch-checklist.md"),
        ("Gate 5 runbook", "docs/operations/gate-5-shadow-mode-runbook.md"),
        ("Pattern recognition spec", "docs/superpowers/specs/2026-05-11-pattern-recognition-design.md"),
    ]
    for label, rel_path in docs_present:
        full = os.path.join(_REPO_ROOT, rel_path)
        if os.path.exists(full):
            lines.append(f"- {label}: ✅ `{rel_path}`")
        else:
            lines.append(f"- {label}: ❌ missing at `{rel_path}`")
            issues.append(f"{label} missing")

    # Summary
    if issues:
        status = "WARN" if launch_state.startswith("PRE-LAUNCH") else "FAIL"
        summary = f"{launch_state} — {len(issues)} issue(s)"
    else:
        status = "PASS"
        summary = f"{launch_state} — all readiness checks pass"

    details = "\n".join(lines)
    if issues:
        details += "\n\n**Open issues:**\n" + "\n".join(f"- {i}" for i in issues)

    return {"status": status, "summary": summary, "details": details}
