"""`GET /api/flow/ticker/{symbol}/day-counts` + `GET /api/flow/tape-span` (2026-10-06).

The terminal's HIS flow lane wants one number per session: how many prints the tape holds for a
ticker. It used to download the ticker's whole `CreatedDate` column (~390K rows / ~4 MB decoded
for NVDA) plus two `/dates` scans to count lines on web. These routes answer that on flow-worker
with a GROUP BY over the symbol's slice of `idx_flow_symbol_created` and a loose-index date walk.

What is pinned here:
  * the counts are EXACTLY the tape's rows per session (both partitions, or one when asked);
  * counts only -- no column of the tape rides the answer;
  * the plan is a SYMBOL SEEK (covering when the index exists), never a partition/table scan --
    `+source` keeps `idx_flow_source_date*` out of index selection;
  * a read past its budget is a 503, never a quiet (empty) tape;
  * bad input is a 400; the routes sit behind `require_flow_user`.
"""
from __future__ import annotations

import os
import sqlite3
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.flow_db import COLUMNS, FlowDB
from tests.authclients import sign_in_flow_caller


def _csv(rows):
    out = [",".join(COLUMNS)]
    for i, (sym, mdy) in enumerate(rows):
        r = {c: f"{c}-{i}" for c in COLUMNS}
        r.update({"Symbol": sym, "CreatedDate": mdy, "Premium": "987654", "CallPut": "C"})
        out.append(",".join(r[c] for c in COLUMNS))
    return "\n".join(out) + "\n"


@pytest.fixture
def db():
    d = tempfile.mkdtemp(prefix="flow-daycounts-")
    fdb = FlowDB(os.path.join(d, "flow.db"))
    fdb.insert_csv(_csv([("NVDA", "10/1/2026")] * 3 + [("NVDA", "10/2/2026")] * 2
                        + [("NVDA", "9/30/2026")] + [("AMD", "10/1/2026")]), source="stocks")
    fdb.insert_csv(_csv([("SPY", "10/2/2026")] * 4 + [("SPY", "9/29/2026")]), source="indexes")
    # A name reclassified mid-history (2026-07-09: DRAM, SPCX): rows in BOTH partitions.
    fdb.insert_csv(_csv([("DRAM", "9/29/2026")] * 2), source="stocks")
    fdb.insert_csv(_csv([("DRAM", "10/2/2026")]), source="indexes")
    yield fdb


@pytest.fixture
def client(db, monkeypatch):
    from api import flow_router as fr
    sign_in_flow_caller(monkeypatch)
    monkeypatch.setattr(fr, "db", db)
    app = FastAPI()
    app.include_router(fr.flow_router)
    return TestClient(app, cookies={"uct_session": "member"})


def test_counts_are_the_tapes_rows_per_session(client):
    r = client.get("/api/flow/ticker/nvda/day-counts")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "NVDA" and body["source"] == "all"
    assert body["days"] == {"2026-09-30": 1, "2026-10-01": 3, "2026-10-02": 2}
    assert list(body["days"]) == sorted(body["days"])            # chronological, ISO
    assert body["sessions"] == 3 and body["prints"] == 6


def test_all_spans_both_partitions_and_a_source_asks_one(client):
    both = client.get("/api/flow/ticker/DRAM/day-counts").json()["days"]
    stocks = client.get("/api/flow/ticker/DRAM/day-counts", params={"source": "stocks"}).json()["days"]
    idx = client.get("/api/flow/ticker/DRAM/day-counts", params={"source": "indexes"}).json()["days"]
    assert both == {"2026-09-29": 2, "2026-10-02": 1}
    assert stocks == {"2026-09-29": 2} and idx == {"2026-10-02": 1}
    assert client.get("/api/flow/ticker/SPY/day-counts", params={"source": "stocks"}).json()["days"] == {}


def test_the_answer_is_counts_only(client):
    """The tape holds premium, side, strike and expiry; none of it rides this route."""
    text = client.get("/api/flow/ticker/NVDA/day-counts").text
    for paid in ("987654", "Premium", "CallPut", "Strike", "ExpirationDate", "Side"):
        assert paid not in text
    assert set(client.get("/api/flow/ticker/NVDA/day-counts").json()) == {
        "symbol", "source", "days", "sessions", "prints", "tape"}


def test_an_unknown_ticker_is_an_empty_map_not_an_error(client):
    body = client.get("/api/flow/ticker/ZZZZ/day-counts").json()
    assert body["days"] == {} and body["prints"] == 0


def test_an_unknown_source_is_refused_never_a_quietly_different_partition(client):
    assert client.get("/api/flow/ticker/NVDA/day-counts", params={"source": "options"}).status_code == 400


def test_the_tape_span_covers_both_partitions(client):
    span = client.get("/api/flow/ticker/NVDA/day-counts").json()["tape"]
    assert span == {"first": "2026-09-29", "last": "2026-10-02", "ok": True}
    assert client.get("/api/flow/tape-span").json() == {"first": "2026-09-29", "last": "2026-10-02"}


def test_the_tape_span_equals_the_union_of_the_dates_routes(client):
    """`/tape-span` replaces HIS's two `/dates` reads, so it must say what they said."""
    from datetime import datetime
    held = set()
    for src in ("stocks", "indexes"):
        for d in client.get("/api/flow/dates", params={"source": src}).json()["dates"]:
            held.add(datetime.strptime(d, "%m/%d/%Y").date().isoformat())
    span = client.get("/api/flow/tape-span").json()
    assert (span["first"], span["last"]) == (min(held), max(held))


def test_a_read_past_its_budget_is_a_503_never_a_quiet_tape(client, db, monkeypatch):
    from api import flow_router as fr
    # Enough rows that the GROUP BY passes the progress handler's VM-step interval.
    db.insert_csv(_csv([("BIGT", f"10/{1 + i % 20}/2026") for i in range(30000)]), source="stocks")
    monkeypatch.setattr(fr, "_DAY_COUNTS_BUDGET_S", -1.0)          # already past the deadline
    r = client.get("/api/flow/ticker/BIGT/day-counts")
    assert r.status_code == 503 and r.headers.get("retry-after")
    monkeypatch.setattr(fr, "_DAY_COUNTS_BUDGET_S", 30.0)          # control: same read, in budget
    ok = client.get("/api/flow/ticker/BIGT/day-counts")
    assert ok.status_code == 200 and ok.json()["prints"] == 30000


def test_the_routes_are_behind_require_flow_user(db, monkeypatch):
    from api import flow_router as fr
    monkeypatch.setattr(fr, "db", db)
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    app = FastAPI()
    app.include_router(fr.flow_router)
    anon = TestClient(app)
    assert anon.get("/api/flow/ticker/NVDA/day-counts").status_code == 401
    assert anon.get("/api/flow/tape-span").status_code == 401


def _plan(db, sql, args):
    with sqlite3.connect(db.db_path) as c:
        return " ".join(r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, args).fetchall())


def test_the_plan_is_a_symbol_seek_and_covering_when_the_index_exists(db):
    """Production's flow.db carries `idx_flow_symbol_created (Symbol, CreatedDate)` (built by
    flow_heal_enrich), which COVERS the both-partition count: no table row is read."""
    from api import flow_router as fr
    with sqlite3.connect(db.db_path) as c:
        c.execute("CREATE INDEX IF NOT EXISTS idx_flow_symbol_created ON flow(Symbol, CreatedDate)")
        # flow-worker's own boot index, the one that can seduce a GROUP BY CreatedDate plan.
        c.execute("CREATE INDEX IF NOT EXISTS idx_flow_created_symbol ON flow(CreatedDate, Symbol)")
    all_plan = _plan(db, fr._DAY_COUNTS_SQL_ALL, ("NVDA",))
    assert "COVERING INDEX idx_flow_symbol_created (Symbol=?)" in all_plan, all_plan
    src_plan = _plan(db, fr._DAY_COUNTS_SQL_SRC, ("NVDA", "stocks"))
    assert "idx_flow_symbol_created (Symbol=?)" in src_plan, src_plan
    for plan in (all_plan, src_plan):
        assert "idx_flow_source" not in plan and "idx_flow_classified" not in plan
        assert "SCAN" not in plan, plan


def test_without_the_covering_index_it_still_seeks_the_symbol(db):
    """A fresh flow.db (no heal run yet) has only `idx_flow_symbol`: slower, never a scan."""
    from api import flow_router as fr
    for sql, args in ((fr._DAY_COUNTS_SQL_ALL, ("NVDA",)), (fr._DAY_COUNTS_SQL_SRC, ("NVDA", "stocks"))):
        plan = _plan(db, sql, args)
        assert "(Symbol=?)" in plan and "SCAN flow" not in plan, plan
