"""EXPORT-FLOW -- the member's options-flow export, read from flow-worker.

The tape lives on flow-worker (P5 cutover). The export must read it the way every other
web-side flow read does: a server-side GET of `/api/flow/ticker/{symbol}` at the worker, with
the PUSH_SECRET service credential and never the member's cookie. Minimal app, no api.main.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import data_exports as svc

HEADER = ("CreatedDate,CreatedTime,Symbol,Type,Volume,Price,Side,CallPut,Strike,Spot,Premium,"
          "ExpirationDate,Color,ImpliedVolatility,Dte,ER,StockEtf,Sector,Uoa,Weekly,MktCap,OI")


def _row(date, premium, strike="100"):
    return (f"{date},09:31:00,NVDA,SWEEP,100,1.25,A,CALL,{strike},101.5,{premium},"
            f"10/17/2026,green,0.45,7,,Stock,Technology,,,3000000000000,1200")


# CreatedDate TEXT order, exactly as flow_db.store_date_order emits it: '10/1' before '9/30'.
LINES = [HEADER,
         _row("10/1/2026", 50000), _row("10/1/2026", 75000),
         _row("10/9/2026", 125000), _row("10/9/2026", 130000), _row("10/9/2026", 99000),
         _row("9/30/2026", 1000)]


def test_blank_date_is_the_NEWEST_session_not_the_last_one_streamed():
    cols, rows, stem = svc.flow_rows("nvda", "stocks", "", lines=LINES)
    assert cols == HEADER.split(",")
    assert len(rows) == 3 and {r["CreatedDate"] for r in rows} == {"10/9/2026"}
    assert stem == "flow_NVDA_2026-10-09"
    assert rows[0]["Premium"] == 125000 and rows[0]["Price"] == 1.25   # numbers stay numbers


def test_a_date_selects_that_session_only():
    _cols, rows, stem = svc.flow_rows("NVDA", "stocks", "2026-09-30", lines=LINES)
    assert [r["Premium"] for r in rows] == [1000]
    assert stem == "flow_NVDA_2026-09-30"


def test_no_rows_is_None_so_the_route_gives_the_charge_back():
    assert svc.flow_rows("NVDA", "stocks", "2026-01-02", lines=LINES) is None
    assert svc.flow_rows("NVDA", "stocks", "", lines=[HEADER]) is None


def test_the_row_cap_holds(monkeypatch):
    monkeypatch.setattr(svc, "FLOW_MAX_ROWS", 2)
    _cols, rows, _stem = svc.flow_rows("NVDA", "stocks", "", lines=LINES)
    assert len(rows) == 2


@pytest.mark.parametrize("sym,src,date", [("", "stocks", ""), ("NV DA", "stocks", ""),
                                          ("NVDA", "options", ""), ("NVDA", "stocks", "10/9/2026")])
def test_bad_input_is_a_sentence(sym, src, date):
    with pytest.raises(ValueError):
        svc.flow_rows(sym, src, date, lines=LINES)


class _Resp:
    def __init__(self, status, lines):
        self.status_code, self._lines = status, lines

    def iter_lines(self):
        yield from self._lines

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_the_read_goes_to_the_WORKER_with_the_service_credential(monkeypatch):
    import httpx
    from api import flow_proxy
    seen = {}

    def fake_stream(method, url, params=None, headers=None, timeout=None):
        seen.update(method=method, url=url, params=params, headers=headers)
        return _Resp(200, LINES)

    monkeypatch.setattr(flow_proxy, "PROXY_ENABLED", True)
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "http://flow-worker.internal:8080")
    monkeypatch.setenv("PUSH_SECRET", "svc-secret")
    monkeypatch.setattr(httpx, "stream", fake_stream)
    _cols, rows, _stem = svc.flow_rows("NVDA", "indexes", "")
    assert len(rows) == 3
    assert seen["url"] == "http://flow-worker.internal:8080/api/flow/ticker/NVDA"
    assert seen["params"] == {"source": "indexes"}
    assert seen["headers"] == {"Authorization": "Bearer svc-secret"}
    assert "cookie" not in {k.lower() for k in seen["headers"]}


def test_a_failed_worker_read_is_an_error_never_an_empty_file(monkeypatch):
    import httpx
    monkeypatch.setattr(httpx, "stream", lambda *a, **k: _Resp(502, []))
    with pytest.raises(RuntimeError):
        svc.flow_rows("NVDA", "stocks", "")


@pytest.fixture
def client(monkeypatch):
    from api.middleware import auth_middleware as authmw
    from api.routers import data_exports as router_mod
    monkeypatch.setenv(svc.FLAG, "1")
    monkeypatch.setattr(svc, "take", lambda uid: True)
    returned = []
    monkeypatch.setattr(svc, "give_back", lambda uid: returned.append(uid))
    fa = FastAPI()
    fa.include_router(router_mod.router)
    fa.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {
        "id": "u-flow", "role": "member", "plan": "pro"}
    monkeypatch.setattr(authmw, "is_paid_user", lambda u: True)
    monkeypatch.setattr(router_mod, "is_paid_user", lambda u: True)
    c = TestClient(fa, raise_server_exceptions=False)
    c.returned = returned
    return c


def test_the_route_answers_a_csv_file(client, monkeypatch):
    monkeypatch.setattr(svc, "_flow_lines", lambda sym, src: iter(LINES))
    r = client.get("/api/exports/flow/NVDA")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["x-export-rows"] == "3"
    assert 'filename="flow_NVDA_2026-10-09_' in r.headers["content-disposition"]
    assert client.returned == []


def test_the_route_answers_xlsx_too(client, monkeypatch):
    monkeypatch.setattr(svc, "_flow_lines", lambda sym, src: iter(LINES))
    r = client.get("/api/exports/flow/NVDA", params={"format": "xlsx", "date": "2026-10-01"})
    assert r.status_code == 200
    assert r.content[:2] == b"PK" and r.headers["x-export-rows"] == "2"


def test_a_worker_outage_is_a_503_sentence_and_the_charge_comes_back(client, monkeypatch):
    def boom(sym, src):
        raise RuntimeError("Options flow is unavailable right now. Try again shortly.")
        yield  # pragma: no cover
    monkeypatch.setattr(svc, "_flow_lines", boom)
    r = client.get("/api/exports/flow/NVDA")
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]
    assert client.returned == ["u-flow"]


def test_the_route_is_dark_while_exports_are_off(client, monkeypatch):
    monkeypatch.setenv(svc.FLAG, "0")
    assert client.get("/api/exports/flow/NVDA").status_code == 404
