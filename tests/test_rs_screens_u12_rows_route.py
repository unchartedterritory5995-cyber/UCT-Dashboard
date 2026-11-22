"""RS screens unit U12, item W3.4: several stocks' screener rows in one read.

``GET /api/screener/rows?tickers=A,B&columns=...`` is the single-row read of unit U8
(``GET /api/screener/row/{ticker}``) batched, so the "N dropped" popover on an RS screen
can say why each name left the list in ONE request instead of one a name.

Why each rail exists:
  * it returns the same stored numbers as the scan, so it is PAID, and it does not exist
    while ``RS_SCREENS_ENABLED`` is off;
  * ``columns`` is checked against the schema before any SQL exists, a ticker is only ever
    a bound parameter, and a name that cannot be a ticker never gets that far;
  * a 26th name is REFUSED, never cut silently: a popover that named 30 stocks and got
    reasons for 25 would show five names with no reason and no way to tell why;
  * a row whose bars stopped says so (``stale``), exactly as the single route does.

Hermetic: a ``screener.db`` in ``tmp_path``.
"""
from __future__ import annotations

import inspect

import pytest

from api.services.screener import query, snapshot_db


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    snapshot_db.init_db()
    query._STALE_GATE_MEMO = None
    yield
    query._STALE_GATE_MEMO = None


def _row(ticker, **kw):
    return {"ticker": ticker, "price": 50.0, "rs_rank": 80, "security_type": "Stock",
            "snapshot_date": "2026-11-13", "built_at": 1, "bars_asof": "20261113", **kw}


def _table(*rows):
    snapshot_db.upsert_rows(list(rows))


def _client(user="paid"):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    app = FastAPI()
    app.include_router(screener_mod.router)
    if user in ("paid", "free"):
        who = {"id": "u1", "role": "member", "plan": "pro" if user == "paid" else "free"}
        app.dependency_overrides[get_current_user] = lambda: dict(who)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def _get(**params):
    return _client().get("/api/screener/rows", params=params)


def test_several_rows_in_one_read_in_the_order_asked_with_the_missing_named():
    _table(_row("NVDA", price=140.5, rs_rank=97), _row("AMD", price=120.0, rs_rank=74),
           _row("OLD", bars_asof="20260801"))
    r = _get(tickers="amd, nvda,ZZZZ,OLD", columns="rs_rank,price")
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert list(body) == ["rows", "missing"]
    assert list(body["rows"]) == ["AMD", "NVDA", "OLD"], "the order asked, upper-cased"
    assert body["rows"]["NVDA"] == {"row": {"ticker": "NVDA", "rs_rank": 97, "price": 140.5}, "stale": False}
    assert body["rows"]["AMD"]["row"] == {"ticker": "AMD", "rs_rank": 74, "price": 120.0}
    assert body["rows"]["OLD"]["stale"] is True, "the scan leaves this row out: its bars stopped"
    assert body["missing"] == ["ZZZZ"]


def test_it_is_the_single_row_routes_answer_for_each_name():
    _table(_row("NVDA", price=140.5), _row("AMD", price=120.0))
    batch = _get(tickers="NVDA,AMD", columns="price,rs_rank").json()["rows"]
    for t in ("NVDA", "AMD"):
        one = _client().get(f"/api/screener/row/{t}", params={"columns": "price,rs_rank"}).json()
        assert batch[t] == {"row": one["row"], "stale": one["stale"]}, t


def test_one_request_reads_the_table_once(monkeypatch):
    _table(_row("NVDA"), _row("AMD"), _row("MU"))
    calls = []
    real = query.rows_for
    monkeypatch.setattr(query, "rows_for", lambda *a, **k: calls.append(a[0]) or real(*a, **k))
    assert _get(tickers="NVDA,AMD,MU", columns="price").status_code == 200
    assert calls == [["NVDA", "AMD", "MU"]], "one reader call for the whole request"


def test_no_name_and_names_that_cannot_be_tickers_are_two_empty_answers():
    _table(_row("NVDA"))
    assert _get(columns="price").json() == {"rows": {}, "missing": []}
    assert _get(tickers="", columns="price").json() == {"rows": {}, "missing": []}
    # a name that cannot be a ticker is dropped before the statement, never bound
    assert _get(tickers="NV DA,NVDA;DROP,../etc,.B", columns="price").json() == {"rows": {}, "missing": []}
    assert _get(tickers="NV DA,nvda", columns="price").json()["rows"] == \
        {"NVDA": {"row": {"ticker": "NVDA", "price": 50.0}, "stale": False}}
    # a repeated name is read once
    assert list(_get(tickers="NVDA,nvda,NVDA", columns="price").json()["rows"]) == ["NVDA"]


def test_twenty_five_names_are_served_and_a_twenty_sixth_is_refused_not_cut():
    assert query.MAX_ROW_TICKERS == 25
    _table(*[_row(f"T{i}") for i in range(30)])
    r = _get(tickers=",".join(f"T{i}" for i in range(25)), columns="price")
    assert r.status_code == 200 and len(r.json()["rows"]) == 25
    r = _get(tickers=",".join(f"T{i}" for i in range(26)), columns="price")
    assert r.status_code == 400 and r.json()["detail"] == "a row request can name at most 25 tickers"


def test_a_column_outside_the_registry_is_a_400_that_names_it():
    _table(_row("NVDA"))
    r = _get(tickers="NVDA", columns="price,password")
    assert r.status_code == 400 and r.json()["detail"] == "unknown columns: password"
    r = _get(tickers="NVDA", columns="price; DROP TABLE screener_rows")
    assert r.status_code == 400 and "unknown columns" in r.json()["detail"]
    # judged before any ticker is read: a bad column is a 400 even with no name at all
    assert _get(columns="nope").status_code == 400
    assert _get(tickers="NVDA").json()["rows"] == {"NVDA": {"row": {"ticker": "NVDA"}, "stale": False}}


def test_the_route_carries_the_paid_gate():
    from api.routers import screener as r
    sig = inspect.signature(r.screener_rows)
    assert sig.parameters["user"].default.dependency is r.require_paid
    assert list(sig.parameters) == ["tickers", "columns", "user"]
    _table(_row("NVDA"))
    assert _client(user="free").get("/api/screener/rows", params={"tickers": "NVDA"}).status_code in (402, 403)
    assert _client(user=None).get("/api/screener/rows", params={"tickers": "NVDA"}).status_code in (401, 403)


def test_the_route_does_not_exist_while_the_screens_are_off(monkeypatch):
    _table(_row("NVDA"))
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    called = []
    monkeypatch.setattr(query, "rows_for", lambda *a, **k: called.append(a) or {})
    r = _get(tickers="NVDA", columns="price")
    assert r.status_code == 404 and r.json()["detail"] == "Not Found"
    assert called == [], "a dark route read the table"


def test_a_value_json_cannot_carry_is_a_blank_never_a_500():
    import sqlite3
    _table(_row("NVDA"))
    with sqlite3.connect(snapshot_db.get_db_path()) as conn:
        conn.execute("UPDATE screener_rows SET price = ? WHERE ticker = 'NVDA'", (float("inf"),))
    r = _get(tickers="NVDA", columns="price")
    assert r.status_code == 200 and r.json()["rows"]["NVDA"]["row"]["price"] is None


def test_the_batch_route_is_declared_before_nothing_it_could_shadow():
    """`/api/screener/rows` and `/api/screener/row/{ticker}` are different paths: the
    single route's parameter is one path segment after `row/`, so `rows` never matches it."""
    from api.routers import screener as r
    paths = [route.path for route in r.router.routes]
    assert paths.count("/api/screener/rows") == 1 and paths.count("/api/screener/row/{ticker}") == 1
    _table(_row("ROWS"))
    assert _client().get("/api/screener/row/ROWS", params={"columns": "price"}).json()["ticker"] == "ROWS"
