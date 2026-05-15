"""Router-level tests for Multi-Account Compass.

The route handlers take `user` via Depends(get_current_user); we call the
handler functions directly with a fake user dict so we exercise the real
gate + unified-coach logic without standing up an authenticated TestClient.
DB access goes through get_connection() which honors AUTH_DB_PATH.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid

import pytest
from fastapi import HTTPException


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


def _seed_account(user_id, name="Default"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.create_account(
        user_id, {"name": name, "color": "blue", "startingBalance": 100_000},
    )


# ── _require_compass_enabled ────────────────────────────────────────────────


def test_require_compass_enabled_allows_all_sentinel(db_path):
    from api.routers import journal_two as r
    _seed_account("u_r1")
    # Should not raise: unified coach defaults to compass_enabled=1
    r._require_compass_enabled("u_r1", "_all_")


def test_require_compass_enabled_403_when_unified_disabled(db_path):
    from api.routers import journal_two as r
    from api.services.journal_two import unified_coach
    unified_coach.get_or_create(None, "u_r2")
    unified_coach.update_state(None, "u_r2", compass_enabled=False)
    with pytest.raises(HTTPException) as exc:
        r._require_compass_enabled("u_r2", "_all_")
    assert exc.value.status_code == 403


def test_require_compass_enabled_404_for_unknown_account(db_path):
    from api.routers import journal_two as r
    with pytest.raises(HTTPException) as exc:
        r._require_compass_enabled("u_r3", "no-such-account")
    assert exc.value.status_code == 404


def test_require_compass_enabled_404_when_feature_flag_off(db_path, monkeypatch):
    from api.routers import journal_two as r
    _seed_account("u_r4")
    monkeypatch.setenv("UNIFIED_COMPASS_ENABLED", "false")
    with pytest.raises(HTTPException) as exc:
        r._require_compass_enabled("u_r4", "_all_")
    assert exc.value.status_code == 404


# ── _reject_unified_for_per_trade ───────────────────────────────────────────


def test_reject_unified_for_per_trade_blocks_all_sentinel():
    from api.routers import journal_two as r
    with pytest.raises(HTTPException) as exc:
        r._reject_unified_for_per_trade("_all_")
    assert exc.value.status_code == 400
    assert "single account" in exc.value.detail.lower()


def test_reject_unified_for_per_trade_allows_real_account():
    from api.routers import journal_two as r
    # Should not raise
    r._reject_unified_for_per_trade("acc-real-123")


# ── /unified-coach endpoints ────────────────────────────────────────────────


def test_get_unified_coach_seeds_defaults(db_path):
    from api.routers import journal_two as r
    out = r.get_unified_coach_state_route(user={"id": "u_e1"})
    assert out["traderProfile"] == ""
    assert out["compassEnabled"] is True
    assert out["onboarded"] is False


def test_put_unified_coach_persists_profile(db_path):
    from api.routers import journal_two as r
    out = r.put_unified_coach_state_route(
        payload={"traderProfile": "Multi-account swing trader."},
        user={"id": "u_e2"},
    )
    assert out["traderProfile"] == "Multi-account swing trader."
    reread = r.get_unified_coach_state_route(user={"id": "u_e2"})
    assert reread["traderProfile"] == "Multi-account swing trader."


def test_put_unified_coach_toggles_compass_enabled(db_path):
    from api.routers import journal_two as r
    out = r.put_unified_coach_state_route(
        payload={"compassEnabled": False}, user={"id": "u_e3"},
    )
    assert out["compassEnabled"] is False


def test_put_unified_coach_rejects_bad_types(db_path):
    from api.routers import journal_two as r
    with pytest.raises(HTTPException) as exc:
        r.put_unified_coach_state_route(
            payload={"traderProfile": 123}, user={"id": "u_e4"},
        )
    assert exc.value.status_code == 400
