"""D12 family: pattern_outcomes — orphaned and deleted with their detections at 120 days.

``memory._store_outcome`` upserts and re-stamps ``resolved_at`` on every tracking
pass, so a ``resolved_at`` watermark catches each change to an outcome. The
table is small (one row per tracked detection), so the read is a plain
read-only query. Same (watermark, 00:17 slot] window as detections.
"""
from __future__ import annotations

import os

from api.services.wisdom.capture.families import detections as detections_family
from api.services.wisdom.capture.families._base import (
    result, ro_connect, safe_reader, slot_epoch, table_columns, to_date, unavailable, watermark_window,
)

FAMILY = "detection_outcomes"
SOURCE = "api.services.pattern_engine.pattern_db:pattern_outcomes"


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    day = to_date(as_of) or now_et.date()
    try:
        path = detections_family.resolve_path()
    except Exception as exc:  # noqa: BLE001
        return unavailable(FAMILY, as_of=day, source=SOURCE, gap="patterns_db_path",
                           reason=f"{type(exc).__name__}: {exc}"[:300])
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=day, source=SOURCE, gap="patterns_db",
                           reason=f"patterns store not found at {path}")
    hi = slot_epoch(day, *detections_family.SLOT)
    lo, hi, gaps = watermark_window(state, day, hi, first_window_s=detections_family.FIRST_WINDOW_S)
    meta = {"window_lo": lo, "watermark_next": hi, "window_as_of": day.isoformat()}
    conn = ro_connect(path)
    try:
        if not table_columns(conn, "pattern_outcomes"):
            return unavailable(FAMILY, as_of=day, source=SOURCE, gap="pattern_outcomes",
                               reason="table pattern_outcomes does not exist")
        rows = [] if lo >= hi else [dict(r) for r in conn.execute(
            "SELECT * FROM pattern_outcomes WHERE resolved_at > ? AND resolved_at <= ? "
            "ORDER BY resolved_at, detection_id", (lo, hi))]
    finally:
        conn.close()
    return result(FAMILY, as_of=day, source=SOURCE, rows=len(rows), payload=rows, gaps=gaps, meta=meta)
