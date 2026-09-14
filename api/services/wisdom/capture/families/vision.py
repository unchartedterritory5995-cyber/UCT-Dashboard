"""D12 family: Pattern Vision verdicts — INSERT OR REPLACE per (ticker, tf, setup, asof_date).

A replaced verdict loses its earlier judgement, so capture takes a ``judged_at``
watermark delta: verdicts judged in ``(watermark, 17:34 ET of the session]``.
Read-only (``store.init_db`` writes). ⚠️ ``pattern_feedback`` also exists in
patterns.db with a different schema; this reader touches only pattern_verdicts.
"""
from __future__ import annotations

import os

from api.services.wisdom.capture.families._base import (
    et_day_start_epoch, result, ro_connect, safe_reader, session_of, slot_epoch, table_columns, to_date,
    unavailable, watermark_window,
)

FAMILY = "vision"
SOURCE = "api.services.pattern_vision.store:pattern_verdicts"
SLOT = (17, 34)


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services.pattern_vision import store as vision_store

    session = to_date(as_of) or session_of(now_et)
    path = vision_store.get_db_path()
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=session, source=SOURCE, gap="pattern_vision_db",
                           reason=f"pattern vision store not found at {path}")
    hi = slot_epoch(session, *SLOT)
    first = hi - et_day_start_epoch(session)
    lo, hi, gaps = watermark_window(state, session, hi, first_window_s=first)
    meta = {"window_lo": lo, "watermark_next": hi, "window_as_of": session.isoformat()}
    conn = ro_connect(path)
    try:
        if not table_columns(conn, "pattern_verdicts"):
            return unavailable(FAMILY, as_of=session, source=SOURCE, gap="pattern_verdicts",
                               reason="table pattern_verdicts does not exist")
        rows = [] if lo >= hi else [dict(r) for r in conn.execute(
            "SELECT * FROM pattern_verdicts WHERE judged_at > ? AND judged_at <= ? "
            "ORDER BY judged_at, ticker, tf, setup, asof_date", (lo, hi))]
    finally:
        conn.close()
    return result(FAMILY, as_of=session, source=SOURCE, rows=len(rows), payload=rows, gaps=gaps, meta=meta)
