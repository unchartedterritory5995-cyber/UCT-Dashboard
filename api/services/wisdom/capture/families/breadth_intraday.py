"""D12 family: the intraday breadth path — breadth_intraday.db keeps 7 DAYS.

Every per-minute sample of a session, read-only, ordered by ``as_of``. The
permanent daily series (breadth_monitor.db) needs no archiving; the path inside
the day does. ``metrics`` is stored parsed; an unparseable blob is kept as its raw
text and counted as a gap, never dropped.
"""
from __future__ import annotations

import json
import os

from api.services.wisdom.capture.families._base import (
    result, ro_connect, safe_reader, session_of, table_columns, to_date, unavailable,
)

FAMILY = "breadth_intraday"
SOURCE = "api.services.breadth_intraday:breadth_intraday"


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services import breadth_intraday

    session = to_date(as_of) or session_of(now_et)
    path = breadth_intraday._db_path()
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=session, source=SOURCE, gap="breadth_intraday_db",
                           reason=f"intraday breadth store not found at {path}")
    conn = ro_connect(path)
    try:
        if not table_columns(conn, "breadth_intraday"):
            return unavailable(FAMILY, as_of=session, source=SOURCE, gap="breadth_intraday",
                               reason="table breadth_intraday does not exist")
        raw = conn.execute(
            "SELECT as_of, metrics FROM breadth_intraday WHERE session_date = ? ORDER BY as_of",
            (session.isoformat(),),
        ).fetchall()
    finally:
        conn.close()
    samples, bad = [], 0
    for row in raw:
        try:
            metrics = json.loads(row["metrics"])
        except (TypeError, ValueError):
            metrics, bad = row["metrics"], bad + 1
        samples.append({"as_of": row["as_of"], "metrics": metrics})
    gaps = {"unparseable_metrics": f"{bad} samples kept as raw text"} if bad else {}
    meta = {"first_as_of": samples[0]["as_of"] if samples else None,
            "last_as_of": samples[-1]["as_of"] if samples else None,
            "retention_days": getattr(breadth_intraday, "RETENTION_DAYS", None)}
    return result(FAMILY, as_of=session, source=SOURCE, rows=len(samples), payload=samples, gaps=gaps, meta=meta)
