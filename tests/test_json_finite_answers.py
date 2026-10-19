"""A non-finite float persisted before the producer guards (a screener row, a
fundamentals snapshot) must cost a blank field, never a 500 for the whole answer
(Starlette encodes with allow_nan=False). 2026-10-18: KOPN's forward P/E."""
import math

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.json_finite import scrub


def test_scrub_replaces_every_non_finite_float_and_keeps_the_rest():
    src = {"a": float("inf"), "b": [1.5, float("nan"), {"c": -math.inf, "d": "x"}], "e": (2.0, float("inf")), "f": 0.0}
    out = scrub(src)
    assert out == {"a": None, "b": [1.5, None, {"c": None, "d": "x"}], "e": (2.0, None), "f": 0.0}
    assert math.isinf(src["a"])        # the input is never mutated


def test_a_clean_payload_comes_back_as_the_same_object():
    clean = {"rows": [{"pe": 12.0, "t": "A"}], "total": 1}
    assert scrub(clean) is clean


def _paid_app(router, dep):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[dep] = lambda: {"id": "u1", "role": "member"}
    return TestClient(app)


def test_a_scan_page_carrying_an_inf_answers_200_with_a_blank_cell(monkeypatch):
    from api.routers import screener as r
    monkeypatch.setattr(r.scr_query, "run_scan",
                        lambda body, user_id=None, user=None: {"rows": [{"ticker": "KOPN", "pe_fwd": float("inf")}], "total": 1})
    c = _paid_app(r.router, r.require_paid)
    resp = c.post("/api/screener/scan", json={})
    assert resp.status_code == 200, resp.text[:300]
    assert resp.json()["rows"][0]["pe_fwd"] is None


def test_a_fundamentals_snapshot_carrying_an_inf_answers_200(monkeypatch):
    from api.routers import fundamentals as f
    monkeypatch.setattr(f, "_fundamentals_payload", lambda sym: {"forward_pe": float("inf"), "status": "ok"})
    c = TestClient((lambda a: (a.include_router(f.router), a)[1])(FastAPI()))
    resp = c.get("/api/fundamentals/KOPN")
    assert resp.status_code == 200, resp.text[:300]
    assert resp.json()["forward_pe"] is None
