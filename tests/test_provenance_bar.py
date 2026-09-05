"""Tests for GET /api/provenance/bar (S8 <Cited> narrow interim form)."""
import time

import pytest
from fastapi.testclient import TestClient

from api.services import bar_provenance


@pytest.fixture(scope="module")
def client():
    from api.main import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _isolated_db(monkeypatch, tmp_path):
    db_path = str(tmp_path / "auth_test.db")
    monkeypatch.setattr(bar_provenance, "_DB_PATH", db_path)
    bar_provenance.init_schema()
    yield


def test_a_recorded_bar_returns_its_provenance_row(client):
    now = int(time.time())
    bar_provenance.record("AAPL", "D", 1788307200, "massive")
    r = client.get("/api/provenance/bar", params={"ticker": "aapl", "tf": "D", "bar_time": 1788307200})
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "AAPL"
    assert body["source"] == "massive"
    assert body["validated_at"] >= now
    assert body["verified_at"] is None


def test_a_verified_bar_reports_verified_at(client):
    bar_provenance.record("MSFT", "D", 1788307200, "fmp")
    bar_provenance.mark_verified("MSFT", "D", 1788307200)
    r = client.get("/api/provenance/bar", params={"ticker": "MSFT", "tf": "D", "bar_time": 1788307200})
    assert r.json()["verified_at"] is not None


def test_a_genuinely_unrecorded_bar_answers_404_not_a_500(client):
    r = client.get("/api/provenance/bar", params={"ticker": "ZZZNOTREAL", "tf": "D", "bar_time": 1})
    assert r.status_code == 404
