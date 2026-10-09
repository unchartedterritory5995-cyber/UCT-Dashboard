"""GET /api/patterns/catalog -- each pattern id's name and direction.

The terminal's BRKO (a BULLISH breakout list) reads this to keep bearish ids such as
`td_sequential_sell` out of its setup words; the screener's `pattern_engine_ids`
column lists every active detection whatever its direction.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import patterns


def _client():
    app = FastAPI()
    app.include_router(patterns.router)
    app.dependency_overrides[patterns.require_paid] = lambda: {"id": "u1", "role": "member"}
    return TestClient(app)


def test_catalog_serves_every_metadata_id_with_its_direction():
    body = _client().get("/api/patterns/catalog").json()["patterns"]
    assert set(body) == set(patterns._PATTERN_METADATA)
    assert body["td_sequential_sell"]["direction"] == "bearish"
    assert body["bull_flag"]["direction"] == "bullish"
    assert {v["direction"] for v in body.values()} <= {"bullish", "bearish", "neutral"}
    # non-vacuity: the catalog really carries all three kinds
    assert {v["direction"] for v in body.values()} == {"bullish", "bearish", "neutral"}


def test_catalog_is_declared_before_the_ticker_route():
    paths = [getattr(r, "path", "") for r in patterns.router.routes]
    assert paths.index("/api/patterns/catalog") < paths.index("/api/patterns/{sym}")


def test_catalog_requires_a_paid_member():
    app = FastAPI()
    app.include_router(patterns.router)
    r = TestClient(app).get("/api/patterns/catalog")
    assert r.status_code in (401, 402, 403)
