import os
os.environ["PUSH_SECRET"] = "test-secret-123"

import pytest
from fastapi.testclient import TestClient
from api.main import app
from api.services.catalyst import store as catalyst_store

client = TestClient(app)

EP = "/api/catalysts/today-internal"


@pytest.fixture(autouse=True)
def _catalyst_schema_exists():
    """Create the schema this suite reads through, in whatever store is in force.

    ⚠️ THIS TEST WAS PASSING BECAUSE OF A PRODUCTION FILE. Nothing here ever
    created a `catalysts` table; the 200 came from `C:\\data\\catalysts.db`, the
    live store the engine writes every morning. Isolate `CATALYST_DB_PATH` and
    the endpoint 500s on `no such table: catalysts` — the assertion below was
    measuring the owner's data directory, not the route.

    `_init_db()` is the store's OWN schema function, so this cannot drift from
    the tables the route queries.
    """
    catalyst_store._init_db()


def test_internal_valid_secret_returns_payload():
    resp = client.get(EP, headers={"Authorization": "Bearer test-secret-123"})
    assert resp.status_code == 200
    body = resp.json()
    assert "rows" in body and "market_date" in body


def test_internal_invalid_secret_returns_401():
    resp = client.get(EP, headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401


def test_internal_no_auth_returns_401():
    resp = client.get(EP)
    assert resp.status_code == 401
