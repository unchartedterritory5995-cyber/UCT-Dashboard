"""The uncapped CSV stream must have a DEFINED row order.

`stream_csv`'s uncapped path issued no ORDER BY, and its docstring claimed rows
"come out in rowid order for small ranges / days=1". That was written before
`idx_flow_classified (source, CreatedDate, Color, id)` landed (2026-07-09).
Measured on prod 2026-09-11, the planner picks that index and emits rows GROUPED
BY COLOR — 94,923 of 94,931 positions differ from id order.

Row order is load-bearing: `tk.topTrades` is an order-dependent bounded reservoir
(see tickerDbOrderDependence.test.js), so the emitted order decides which prints
survive into per-ticker aggregates. Leaving it to the planner means a future
ANALYZE, schema change or SQLite upgrade can silently move member-visible money.

⛔ `ORDER BY CreatedDate, id` and NOT `ORDER BY id`: measured on prod, plain
`ORDER BY id` makes the planner abandon the date index for `idx_flow_source` and
scan the whole source — 556 ms -> 7,141 ms at days=5. `(CreatedDate, id)` is
`idx_flow_source_date_id`'s own key order, so it is a covering walk with no sort
(no TEMP B-TREE in any plan).

⛔ THE CAPPED PATH IS NOT TOUCHED. days >= FLOW_CSV_CAP_DAYS (or all-data) already
carries `ORDER BY CAST(Premium AS REAL) DESC LIMIT ?`, which IS its defined order;
adding a second ORDER BY there would change which rows survive the cap.
"""
from __future__ import annotations

from api.flow_db import FlowDB, COLUMNS

_VOL = COLUMNS.index("Volume")


def _db(tmp_path, name, n=30, date="8/25/2026"):
    """Insert n rows in a known order, tagged by Volume, with Colors interleaved
    so a Color-grouped scan is visibly different from insertion order."""
    db = FlowDB(str(tmp_path / name))
    colors = ["WHITE", "MAGENTA", "YELLOW"]
    with db._conn() as conn:
        conn.executemany(
            "INSERT INTO flow (source, CreatedDate, Volume, Color, Premium, dedup_key) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [("stocks", date, str(i), colors[i % 3], str(1000 * (i % 7)), "k%d" % i)
             for i in range(n)],
        )
    return db


def _volumes(db, **kw):
    text = "".join(db.stream_csv(source="stocks", **kw))
    rows = [r for r in text.splitlines()[1:] if r.strip()]
    return [int(r.split(",")[_VOL]) for r in rows]


def test_the_uncapped_stream_is_ordered_by_date_then_id(tmp_path):
    db = _db(tmp_path, "ord.db")
    vols = _volumes(db, days=1)
    assert vols == sorted(vols), (
        "uncapped rows are not in insertion order — the planner's index choice "
        "is still deciding the row order: %s" % vols[:12])


def test_rows_from_several_days_are_grouped_by_date_then_ordered_within_it(tmp_path):
    db = FlowDB(str(tmp_path / "multi.db"))
    colors = ["WHITE", "MAGENTA", "YELLOW"]
    with db._conn() as conn:
        conn.executemany(
            "INSERT INTO flow (source, CreatedDate, Volume, Color, Premium, dedup_key) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [("stocks", d, str(i), colors[i % 3], "500", "k%s%d" % (d, i))
             for d in ("8/24/2026", "8/25/2026") for i in range(12)],
        )
    text = "".join(db.stream_csv(source="stocks", days=2))
    rows = [r.split(",") for r in text.splitlines()[1:] if r.strip()]
    dates = [r[COLUMNS.index("CreatedDate")] for r in rows]
    assert dates == sorted(dates), "rows are not grouped by date"
    for d in set(dates):
        vols = [int(r[_VOL]) for r in rows if r[COLUMNS.index("CreatedDate")] == d]
        assert vols == sorted(vols), "within %s the order is not insertion order" % d


def test_the_capped_stream_is_still_premium_ordered(tmp_path):
    """CONTROL. The cap's own ORDER BY decides which rows survive; a second
    ordering there would silently change the payload."""
    db = _db(tmp_path, "cap.db", n=30)
    text = "".join(db.stream_csv(source="stocks", days=1, cap_rows=10))
    rows = [r.split(",") for r in text.splitlines()[1:] if r.strip()]
    prems = [float(r[COLUMNS.index("Premium")]) for r in rows]
    assert len(rows) == 10
    assert prems == sorted(prems, reverse=True), "capped path lost its premium order"
