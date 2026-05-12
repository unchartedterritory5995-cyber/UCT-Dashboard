"""Report all registered detectors + their categories."""
from __future__ import annotations


def run() -> dict:
    # Import patterns router to trigger detector self-registration.
    from api.routers import patterns as _patterns  # noqa: F401
    from api.services.pattern_engine.detectors.registry import list_pattern_ids

    ids = list_pattern_ids()
    if not ids:
        return {"status": "FAIL", "summary": "no detectors registered", "details": ""}

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
