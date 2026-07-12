"""Tests for the theme taxonomy DB batch lookup behind the breadth "group by
theme" drill view, plus the POST /api/breadth/themes endpoint.

Verifies primary-theme resolution (core > relevant > peripheral, tie-broken
by theme_id) matches the existing single-ticker ticker_meta._primary_theme
algorithm, that the batch path returns one entry per requested ticker, and
that the endpoint degrades to nulls rather than raising.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services import theme_db


def test_resolve_primary_prefers_core_then_relevant_then_peripheral():
    rows = [
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "a"},
        {"theme_name": "Core One", "tier": "core", "theme_id": "z"},
        {"theme_name": "Relevant One", "tier": "relevant", "theme_id": "b"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Core One"


def test_resolve_primary_tie_breaks_by_theme_id():
    rows = [
        {"theme_name": "Semiconductors", "tier": "core", "theme_id": "semis"},
        {"theme_name": "Artificial Intelligence", "tier": "core", "theme_id": "ai"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Artificial Intelligence"  # "ai" < "semis"


def test_resolve_primary_none_for_empty_or_missing():
    assert theme_db._resolve_primary([]) is None
    assert theme_db._resolve_primary(None) is None


def test_resolve_primary_unknown_tier_ranks_last():
    rows = [
        {"theme_name": "Weird", "tier": "watchlist", "theme_id": "a"},
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "z"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Peripheral One"


@pytest.fixture()
def tdb(tmp_path, monkeypatch):
    """Isolated theme DB: theme_db.get_connection() resolves through
    auth_db._DB_PATH (same mechanism as test_support_tickets.py /
    test_broker_sync.py use for auth_db-backed services)."""
    db_path = str(tmp_path / "theme_test.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    theme_db.init_theme_tables()
    conn = theme_db.get_connection()
    try:
        conn.execute("INSERT INTO theme_sectors (id, name, display_order) VALUES ('tech', 'Technology', 1)")
        conn.executemany(
            "INSERT INTO themes (id, name, sector_id, display_order) VALUES (?, ?, 'tech', ?)",
            [
                ("semis", "Semiconductors", 1),
                ("ai", "Artificial Intelligence", 2),
                ("quantum", "Quantum Computing", 3),
            ],
        )
        conn.executemany(
            "INSERT INTO theme_memberships (theme_id, sym, tier) VALUES (?, ?, ?)",
            [
                ("semis", "NVDA", "core"),
                ("ai", "NVDA", "core"),       # ties with semis at 'core' -> 'ai' wins alphabetically
                ("quantum", "NVDA", "relevant"),
                ("semis", "AMD", "peripheral"),
            ],
        )
        conn.commit()
    finally:
        conn.close()
    return db_path


def test_get_theme_map_picks_highest_tier(tdb):
    out = theme_db.get_theme_map(["AMD"])
    assert out == {"AMD": "Semiconductors"}


def test_get_theme_map_tie_breaks_by_theme_id(tdb):
    out = theme_db.get_theme_map(["NVDA"])
    assert out == {"NVDA": "Artificial Intelligence"}


def test_get_theme_map_returns_none_for_unclassified(tdb):
    out = theme_db.get_theme_map(["ZZZZ"])
    assert out == {"ZZZZ": None}


def test_get_theme_map_uppercases_and_dedupes(tdb):
    out = theme_db.get_theme_map(["amd", "AMD", ""])
    assert out == {"AMD": "Semiconductors"}


def test_get_theme_map_multiple_tickers_one_call(tdb):
    out = theme_db.get_theme_map(["AMD", "NVDA", "ZZZZ"])
    assert out == {
        "AMD": "Semiconductors",
        "NVDA": "Artificial Intelligence",
        "ZZZZ": None,
    }


def test_get_theme_map_empty_input(tdb):
    assert theme_db.get_theme_map([]) == {}


# ── Endpoint ────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(tdb):
    from api.routers import breadth_monitor
    app = FastAPI()
    app.include_router(breadth_monitor.router)
    return TestClient(app)


def test_endpoint_shape(client):
    r = client.post("/api/breadth/themes", json={"tickers": ["AMD", "NOPE"]})
    assert r.status_code == 200
    body = r.json()
    assert body["themes"]["AMD"] == "Semiconductors"
    assert body["themes"]["NOPE"] is None


def test_endpoint_caps_at_500(client):
    r = client.post("/api/breadth/themes", json={"tickers": [f"T{i}" for i in range(900)]})
    assert r.status_code == 200
    assert len(r.json()["themes"]) == 500


def test_endpoint_bad_body(client):
    r = client.post("/api/breadth/themes", json={"tickers": "notalist"})
    assert r.status_code == 400


def test_endpoint_degrades_on_lookup_error(client, monkeypatch):
    from api.services import theme_db as tdb_module

    def _boom(tickers):
        raise RuntimeError("db down")

    monkeypatch.setattr(tdb_module, "get_theme_map", _boom)
    r = client.post("/api/breadth/themes", json={"tickers": ["AMD"]})
    assert r.status_code == 200
    assert r.json()["themes"]["AMD"] is None
