"""Router-level tests for Wave 4 (Search Evolution I)'s GET /api/j2/notes
additions: dateFrom/dateTo validation and end-to-end date-filtered search
through the real HTTP endpoint (not just the service layer, which
test_wave4_search_evolution.py already covers in depth).

Same standalone-FastAPI-app + temp-auth.db pattern as
tests/test_journal_two_positions_attention.py.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


# 1. dateFrom/dateTo validation — malformed input is a clean 400, never a
#    silent no-op and never a 500 ─────────────────────────────────────────

def test_malformed_date_from_is_a_400_not_a_500(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes", params={"dateFrom": "not-a-date"})
    assert r.status_code == 400
    assert "dateFrom" in r.json()["detail"]


def test_malformed_date_to_is_a_400(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes", params={"dateTo": "03/15/2026"})
    assert r.status_code == 400
    assert "dateTo" in r.json()["detail"]


def test_well_formed_dates_pass_validation(app, client):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes", params={"dateFrom": "2026-03-01", "dateTo": "2026-03-31"})
    assert r.status_code == 200
    assert r.json()["notes"] == []


# 2. End-to-end: create a note, filter it in and out by date range ─────────

def test_date_filter_end_to_end_through_the_real_endpoint(app, client):
    _login_as(app, "u1")
    created = client.post("/api/j2/notes", json={"title": "March note"})
    assert created.status_code == 200
    note_id = created.json()["note"]["id"]

    today = created.json()["note"]["createdAt"][:10]  # YYYY-MM-DD

    # The note's real creation date is included in range -> found.
    r_in = client.get("/api/j2/notes", params={"dateFrom": today, "dateTo": today})
    assert r_in.status_code == 200
    assert [n["id"] for n in r_in.json()["notes"]] == [note_id]

    # A date range that excludes today -> not found, but still 200 (an
    # honest empty result, never an error).
    r_out = client.get("/api/j2/notes", params={"dateFrom": "1999-01-01", "dateTo": "1999-01-02"})
    assert r_out.status_code == 200
    assert r_out.json()["notes"] == []
    assert r_out.json()["total"] == 0


def test_sector_theme_filter_with_no_provider_match_is_an_honest_empty_result(app, client, monkeypatch):
    """An unrecognized/no-match sector must never 500 or silently ignore
    the filter -- it's a legitimate-but-unmatched value, so it resolves to
    an honest empty result (see resolve_sector_theme_symbols's own
    docstring)."""
    _login_as(app, "u1")
    created = client.post("/api/j2/notes", json={"title": "A note"})
    assert created.status_code == 200

    r = client.get("/api/j2/notes", params={"sector": "NoSuchSectorAtAll"})
    assert r.status_code == 200
    assert r.json()["notes"] == []
    assert r.json()["total"] == 0
