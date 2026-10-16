"""The trader archive on the research surfaces: per-ticker daily activity (Terminal ATTN).

SYNTHETIC data only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the daily route answering an unpaid member (402) or anyone with the flag off (404);
2. a day the team did not post appearing as a zero row (absent is not zero);
3. the window leaking days outside [from, through], or counting another ticker's posts;
4. posts and calls being counted from the wrong column (stated_date vs posted);
5. the archive's overall reach missing, so a surface cannot tell "no post" from "not imported yet".
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import service
from api.services.wisdom.core import store
from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize

SECRET = "s3cret-archive-research-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}
DAILY = "/api/wisdom/archive/ticker/ZZTA/daily"


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


def _client(user):
    app = FastAPI()
    app.include_router(wisdom_archive.member_router)
    app.include_router(wisdom_archive.internal_router)
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def _rec(rid, date, tickers, author="tsdr"):
    return {"record_id": rid, "author_id": author, "stated_date": date, "record_type": "CALL",
            "tickers": tickers, "note": "synthetic note", "quote": "", "image_count": 0}


def _call(cid, rid, posted, ticker="ZZTA"):
    return {"call_id": cid, "record_id": rid, "author_id": "tsdr", "ticker": ticker, "direction": "long",
            "setup": "synthetic_setup", "posted": posted, "outcome": {"r20": 0.01, "status": "scored"}}


def _seed():
    c = _client(None)
    recs = [_rec("t9201", "2025-01-02", ["ZZTA"]), _rec("t9202", "2025-01-02", ["ZZTA", "ZZTB"]),
            _rec("t9203", "2025-01-05", ["ZZTA"]), _rec("t9204", "2025-01-05", ["ZZTB"]),
            _rec("t9205", "2024-06-01", ["ZZTA"])]
    calls = [_call("t9201#0", "t9201", "2025-01-02T14:00:00"),
             _call("t9203#0", "t9203", "2025-01-06T09:30:00"),   # posted the session after the record date
             _call("t9204#0", "t9204", "2025-01-05T10:00:00", ticker="ZZTB")]
    assert c.post(BATCH, json={"kind": "records", "items": recs}, headers=AUTH).json()["inserted"] == 5
    assert c.post(BATCH, json={"kind": "calls", "items": calls}, headers=AUTH).json()["inserted"] == 3


def test_daily_is_paid_and_flag_gated(wisdom_db, on, monkeypatch):
    _seed()
    assert _client(FREE_MEMBER).get(DAILY).status_code == 402
    assert _client(PAID_MEMBER).get(DAILY).status_code == 200                 # control
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    assert _client(PAID_MEMBER).get(DAILY).status_code == 404


def test_daily_counts_only_this_ticker_and_leaves_quiet_days_absent(wisdom_db, on):
    _seed()
    out = _client(PAID_MEMBER).get(DAILY + "?days=30").json()
    assert out["through"] == "2025-01-05" and out["from"] == "2024-12-07"
    assert out["days"] == [{"date": "2025-01-02", "posts": 2, "calls": 1},
                           {"date": "2025-01-05", "posts": 1, "calls": 0}]
    # 2025-01-06 is outside [from, through] (through is the newest POST day), so its call is not counted
    assert out["posts_total"] == 3 and out["calls_total"] == 1
    assert out["last_post"] == "2025-01-05"
    assert out["archive_through"] == "2025-01-05"                               # the whole archive's reach
    assert all(d["posts"] or d["calls"] for d in out["days"])                   # no zero rows


def test_the_window_bounds_the_days(wisdom_db, on):
    _seed()
    wide = _client(PAID_MEMBER).get(DAILY + "?days=400").json()
    assert [d["date"] for d in wide["days"]][0] == "2024-06-01"                 # control: in a wide window
    narrow = _client(PAID_MEMBER).get(DAILY + "?days=2").json()
    assert [d["date"] for d in narrow["days"]] == ["2025-01-05"]


def test_an_unknown_ticker_is_an_empty_answer_not_an_error(wisdom_db, on):
    _seed()
    out = _client(PAID_MEMBER).get("/api/wisdom/archive/ticker/ZZZQ/daily").json()
    assert out == {"ticker": "ZZZQ", "through": None, "days": [], "posts_total": 0, "calls_total": 0,
                   "last_post": None, "archive_through": "2025-01-05"}


def test_the_service_refuses_a_malformed_ticker(wisdom_db):
    with store.read() as conn, pytest.raises(service.ItemError):
        service.ticker_daily(conn, "not a ticker!")

def test_archive_through_is_the_whole_archive_not_this_ticker(wisdom_db, on):
    _seed()
    c = _client(None)
    later = [_rec("t9206", "2025-02-01", ["ZZTB"])]                              # another ticker, later
    assert c.post(BATCH, json={"kind": "records", "items": later}, headers=AUTH).json()["inserted"] == 1
    out = _client(PAID_MEMBER).get(DAILY).json()
    assert out["through"] == "2025-01-05"                                       # ZZTA's own newest post
    assert out["archive_through"] == "2025-02-01"                               # the archive reaches further
