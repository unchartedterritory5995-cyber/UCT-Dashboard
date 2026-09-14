"""D12 family: pattern_detections — PRUNED at 120 days by the 00:40 ET patterns_prune.

A nightly DELTA, not a table copy (production reached 13.6 GB): rows whose
``last_seen_at`` moved into ``(watermark, slot]``. ``last_seen_at`` has no index,
so the scan is bounded on the indexed ``detected_at`` to the pattern engine's
own active window (``memory.ACTIVE_WINDOW_SECS``, imported, never restated)
before the watermark — the only rows an upsert can still touch. New rows are
caught at birth, re-detections while they are active, and outcome updates by
the separate detection_outcomes dataset (``resolved_at`` is re-stamped on every
tracking pass), so nothing the prune removes was never archived.

Read-only URI (never ``pattern_db.get_connection``, which runs DDL and a one-shot
ATTACH), ordered by ``(detected_at, rowid)`` — exactly the index order, so no
temp sort — and streamed into 5,000-row gzip shards by the runner.
"""
from __future__ import annotations

import os

from api.services.wisdom.capture.families._base import (
    RowStream, result, ro_connect, safe_reader, slot_epoch, table_columns, to_date, unavailable,
    watermark_window,
)

FAMILY = "detections"
SOURCE = "api.services.pattern_engine.pattern_db:pattern_detections"
SLOT = (0, 17)
FIRST_WINDOW_S = 24 * 3600


def resolve_path() -> str:
    from api.services.pattern_engine import pattern_db

    return pattern_db._db_path()


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services.pattern_engine.memory import ACTIVE_WINDOW_SECS

    day = to_date(as_of) or now_et.date()
    try:
        path = resolve_path()
    except Exception as exc:  # noqa: BLE001 — PatternDbSharedRootGuard off-pod
        return unavailable(FAMILY, as_of=day, source=SOURCE, gap="patterns_db_path",
                           reason=f"{type(exc).__name__}: {exc}"[:300])
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=day, source=SOURCE, gap="patterns_db",
                           reason=f"patterns store not found at {path}")
    conn = ro_connect(path)
    try:
        if not table_columns(conn, "pattern_detections"):
            return unavailable(FAMILY, as_of=day, source=SOURCE, gap="pattern_detections",
                               reason="table pattern_detections does not exist")
    finally:
        conn.close()
    hi = slot_epoch(day, *SLOT)
    lo, hi, gaps = watermark_window(state, day, hi, first_window_s=FIRST_WINDOW_S)
    meta = {"window_lo": lo, "watermark_next": hi, "window_as_of": day.isoformat(),
            "active_window_s": int(ACTIVE_WINDOW_SECS)}
    if lo >= hi:
        return result(FAMILY, as_of=day, source=SOURCE, rows=0, payload=[], gaps=gaps, meta=meta)
    stream = RowStream(
        path,
        "SELECT * FROM pattern_detections WHERE detected_at > ? AND last_seen_at > ? AND last_seen_at <= ? "
        "ORDER BY detected_at, rowid",
        (lo - int(ACTIVE_WINDOW_SECS), lo, hi),
    )
    return result(FAMILY, as_of=day, source=SOURCE, rows=None, payload=stream, gaps=gaps, meta=meta)
