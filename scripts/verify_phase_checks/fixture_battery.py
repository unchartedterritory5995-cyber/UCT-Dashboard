"""Run all detector fixture batteries and report per-detector pass/fail."""
from __future__ import annotations

import os

from api.services.pattern_engine.primitives.context import build_context


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_FIXTURE_ROOT = os.path.join(_REPO_ROOT, "tests", "fixtures")


def _discover_patterns() -> list[str]:
    if not os.path.isdir(_FIXTURE_ROOT):
        return []
    return sorted([
        name for name in os.listdir(_FIXTURE_ROOT)
        if os.path.isdir(os.path.join(_FIXTURE_ROOT, name))
    ])


def run() -> dict:
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
