"""D12 family: screener output — screener_rows holds ONE current row per ticker, rebuilt nightly.

⛔ ``snapshot_date`` is not the as_of: the 03:00 build stamps only the tickers it
rebuilt, and it runs on weekends against Friday's bars. The archive keys on the
MEDIAN ``bars_asof`` (the session the rows describe) and stores
``snapshot_db.describe_rows`` beside the rows so the mix is visible.

The ~3.7k × 200-column table is streamed straight into gzip (RowStream), never
loaded into memory on the web pod. Opened read-only; this module never writes
screener.db.
"""
from __future__ import annotations

import datetime as dt
import os

from api.services.wisdom.capture.families._base import (
    RowStream, result, ro_connect, safe_reader, table_columns, to_date, unavailable,
)
from api.services.wisdom.core import timeutil

FAMILY = "screener"
SOURCE = "api.services.screener.snapshot_db:screener_rows"
BUILD_DONE_ET = dt.time(4, 0)  # the nightly build runs 03:00 ET


def expected_bars_session(now_et: dt.datetime) -> dt.date:
    build_day = now_et.date() if now_et.time() >= BUILD_DONE_ET else now_et.date() - dt.timedelta(days=1)
    return timeutil.previous_session(build_day)


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services.screener import snapshot_db

    expected = expected_bars_session(now_et)
    path = snapshot_db.get_db_path()
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=as_of or expected, source=SOURCE, gap="screener_db",
                           reason=f"screener store not found at {path}")
    conn = ro_connect(path)
    try:
        cols = table_columns(conn, "screener_rows")
        if not cols:
            return unavailable(FAMILY, as_of=as_of or expected, source=SOURCE, gap="screener_rows",
                               reason="table screener_rows does not exist")
        describe = snapshot_db.describe_rows(conn)
        median_bars = None
        if "bars_asof" in cols:
            row = conn.execute(
                "SELECT bars_asof FROM screener_rows WHERE bars_asof IS NOT NULL ORDER BY bars_asof "
                "LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM screener_rows WHERE bars_asof IS NOT NULL)"
            ).fetchone()
            median_bars = row[0] if row else None
    finally:
        conn.close()

    gaps: dict = {}
    meta: dict = {"describe": describe, "median_bars_asof": median_bars, "columns": len(cols)}
    bars_date = to_date(median_bars)
    if bars_date is None:
        bars_date = to_date(describe.get("snapshot_date")) or expected
        gaps["bars_asof"] = "no median bars_asof; keyed on the median snapshot_date instead"
    if as_of is not None:
        if to_date(as_of) != bars_date:
            gaps["as_of_requested"] = (f"requested {to_date(as_of)}, the rows describe {bars_date}; "
                                       "archived under the rows' own session")
    elif bars_date < expected:
        gaps["stale"] = f"median bars_asof {bars_date} is older than the expected session {expected}"
        meta["stale_session"] = expected.isoformat()
    if describe.get("rows", 0) == 0:
        return result(FAMILY, as_of=bars_date, source=SOURCE, rows=0, payload=[], gaps=gaps, meta=meta)
    stream = RowStream(path, "SELECT * FROM screener_rows ORDER BY ticker")
    return result(FAMILY, as_of=bars_date, source=SOURCE, rows=int(describe["rows"]), payload=stream,
                  gaps=gaps, meta=meta)
