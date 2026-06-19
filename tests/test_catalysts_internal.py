import os
os.environ["PUSH_SECRET"] = "test-secret-123"

from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

EP = "/api/catalysts/today-internal"


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
