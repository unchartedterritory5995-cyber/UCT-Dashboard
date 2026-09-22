"""Packet J CP1 -- GET /api/confidence-scores/{symbol}'s first row-shaping/
degradation test coverage (the existing paid-gate test only covers the gate
itself: tests/test_paywall_gate_free_tier.py). Signed by the owner 2026-09-22
(fingerprint d3e86c615).

⛔⛔ THIS ENDPOINT DOES THE SAME CROSS-REPO IMPORT as leader-persistence
(`uct_intelligence.db.get_connection`), resolved from `UCT_INTEL_PATH` (default
`C:\\Users\\Patrick\\uct-intelligence` -- a REAL directory on this box). Every
test below injects a fully fake `uct_intelligence` package tree into
`sys.modules` before the endpoint ever runs, so this file can never reach the
real checkout regardless of what exists on the machine running it.
"""
import contextlib
import json
import sqlite3
import sys
import types

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
import api.routers.intelligence as intelligence_router

FREE_USER = {"id": "cs-free-1", "email": "csfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "cs-paid-1", "email": "cspaid@example.test", "role": "member", "plan": "pro"}


@pytest.fixture
def fake_engine(tmp_path, monkeypatch):
    """Injects a fully fake uct_intelligence.api / uct_intelligence.db into
    sys.modules for the duration of the test. Returns a `seed(row)` helper
    that inserts one confidence_scores row (defaults filled for any field
    not passed)."""
    db_path = str(tmp_path / "fake_uct_intelligence.db")
    init = sqlite3.connect(db_path)
    init.execute(
        """CREATE TABLE confidence_scores (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               candidate_id INTEGER NOT NULL DEFAULT 0,
               symbol TEXT NOT NULL DEFAULT '',
               score_date TEXT NOT NULL DEFAULT '',
               total_score INTEGER NOT NULL DEFAULT 0,
               base_score INTEGER NOT NULL DEFAULT 0,
               regime_fit INTEGER NOT NULL DEFAULT 0,
               volume_confirm INTEGER NOT NULL DEFAULT 0,
               rs_confirm INTEGER NOT NULL DEFAULT 0,
               sector_fit INTEGER NOT NULL DEFAULT 0,
               catalyst_score INTEGER NOT NULL DEFAULT 0,
               grade TEXT NOT NULL DEFAULT '',
               qualifying TEXT NOT NULL DEFAULT '[]',
               invalidating TEXT NOT NULL DEFAULT '[]',
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
           )"""
    )
    init.commit()
    init.close()

    @contextlib.contextmanager
    def _get_connection():
        c = sqlite3.connect(db_path)
        c.row_factory = sqlite3.Row
        try:
            yield c
        finally:
            c.close()

    fake_api = types.ModuleType("uct_intelligence.api")
    fake_db = types.ModuleType("uct_intelligence.db")
    fake_db.get_connection = _get_connection
    fake_pkg = types.ModuleType("uct_intelligence")
    fake_pkg.api = fake_api
    fake_pkg.db = fake_db

    monkeypatch.setitem(sys.modules, "uct_intelligence", fake_pkg)
    monkeypatch.setitem(sys.modules, "uct_intelligence.api", fake_api)
    monkeypatch.setitem(sys.modules, "uct_intelligence.db", fake_db)

    def seed(**overrides):
        row = {
            "candidate_id": 1, "symbol": "NVDA", "score_date": "2026-09-18",
            "total_score": 78, "base_score": 40, "regime_fit": 10, "volume_confirm": 8,
            "rs_confirm": 10, "sector_fit": 5, "catalyst_score": 5, "grade": "B",
            "qualifying": json.dumps(["above 50-day", "RS line rising"]),
            "invalidating": json.dumps([]),
            "created_at": "2026-09-18T14:30:00",
        }
        row.update(overrides)
        c = sqlite3.connect(db_path)
        c.execute(
            """INSERT INTO confidence_scores
               (candidate_id, symbol, score_date, total_score, base_score, regime_fit,
                volume_confirm, rs_confirm, sector_fit, catalyst_score, grade,
                qualifying, invalidating, created_at)
               VALUES (:candidate_id, :symbol, :score_date, :total_score, :base_score,
                       :regime_fit, :volume_confirm, :rs_confirm, :sector_fit,
                       :catalyst_score, :grade, :qualifying, :invalidating, :created_at)""",
            row,
        )
        c.commit()
        c.close()

    return seed


@pytest.fixture
def client_as():
    def _make(user):
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def test_free_user_is_refused_with_402(client_as, fake_engine):
    resp = client_as(FREE_USER).get("/api/confidence-scores/NVDA")
    assert resp.status_code == 402


def test_anonymous_caller_is_refused(fake_engine):
    resp = TestClient(app, raise_server_exceptions=False).get("/api/confidence-scores/NVDA")
    assert resp.status_code in (401, 403)


def test_a_real_score_returns_the_full_breakdown_with_parsed_json_lists(client_as, fake_engine):
    fake_engine(
        symbol="NVDA", grade="A", total_score=92,
        qualifying=json.dumps(["above 50-day", "RS line rising", "volume confirmed"]),
        invalidating=json.dumps(["extended >8% from EMA20"]),
    )
    resp = client_as(PAID_USER).get("/api/confidence-scores/NVDA")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "NVDA"
    score = body["score"]
    assert score is not None
    assert score["grade"] == "A"
    assert score["total_score"] == 92
    # qualifying/invalidating must be real lists, not JSON-encoded strings
    assert score["qualifying"] == ["above 50-day", "RS line rising", "volume confirmed"]
    assert score["invalidating"] == ["extended >8% from EMA20"]
    for key in ("base_score", "regime_fit", "volume_confirm", "rs_confirm", "sector_fit", "catalyst_score"):
        assert key in score


def test_the_newest_score_wins_when_a_ticker_has_been_scored_more_than_once(client_as, fake_engine):
    fake_engine(symbol="NVDA", score_date="2026-09-10", created_at="2026-09-10T14:30:00", grade="C", total_score=55)
    fake_engine(symbol="NVDA", score_date="2026-09-18", created_at="2026-09-18T14:30:00", grade="A", total_score=90)
    resp = client_as(PAID_USER).get("/api/confidence-scores/NVDA")
    body = resp.json()
    assert body["score"]["grade"] == "A"
    assert body["score"]["total_score"] == 90


def test_a_ticker_never_scored_is_an_honest_null_not_an_error(client_as, fake_engine):
    resp = client_as(PAID_USER).get("/api/confidence-scores/ZZZZ")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "ZZZZ"
    assert body["score"] is None


def test_lookup_is_case_insensitive_on_symbol(client_as, fake_engine):
    fake_engine(symbol="NVDA", grade="B", total_score=70)
    resp = client_as(PAID_USER).get("/api/confidence-scores/nvda")
    assert resp.status_code == 200
    assert resp.json()["score"]["grade"] == "B"


def test_engine_unavailable_degrades_honestly_never_an_error(client_as, monkeypatch):
    monkeypatch.setattr(intelligence_router, "_get_api", lambda: None)
    resp = client_as(PAID_USER).get("/api/confidence-scores/NVDA")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "NVDA"
    assert body["score"] is None


def test_malformed_qualifying_json_degrades_to_an_empty_list_not_a_500(client_as, fake_engine):
    fake_engine(symbol="NVDA", qualifying="not valid json", invalidating="also not valid")
    resp = client_as(PAID_USER).get("/api/confidence-scores/NVDA")
    assert resp.status_code == 200
    score = resp.json()["score"]
    assert score["qualifying"] == []
    assert score["invalidating"] == []
