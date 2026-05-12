"""Confidence histogram per detector from stored detections."""
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
