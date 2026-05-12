"""Cross-detector consistency checks."""
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
