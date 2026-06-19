"""Pattern-vision API: confirmed-only read + admin judge/stats/eval."""
import importlib
import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db as auth_init_db
from api.services.auth_service import create_user, create_session


@pytest.fixture
def client():
    auth_init_db()
    return TestClient(app)


def _login(client, plan="pro", role="member"):
    user = create_user(f"pv_{uuid.uuid4()}@example.com", "password123")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user["id"]))
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, ?, 'active')",
            (uuid.uuid4().hex, user["id"], plan),
        )
        conn.commit()
    finally:
        conn.close()
    client.cookies.set("uct_session", create_session(user["id"]))
    return user["id"]


def _seed_store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


def test_confirmed_endpoint_returns_verdicts(client, monkeypatch, tmp_path):
    s = _seed_store(tmp_path, monkeypatch)
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 80, "rationale": "tight",
                   "signals_hash": "x", "judged_at": 1})
    _login(client)
    r = client.get("/api/patterns/confirmed/NVDA")
    assert r.status_code == 200
    assert r.json()["verdicts"][0]["setup"] == "vcp"


def test_confirmed_only_default_on_sym_route(client, monkeypatch, tmp_path):
    s = _seed_store(tmp_path, monkeypatch)
    s.put_verdict({"ticker": "AAPL", "tf": "D", "setup": "bull_flag", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 75, "rationale": "clean pole",
                   "signals_hash": "y", "judged_at": 1})
    _login(client)
    r = client.get("/api/patterns/AAPL")
    assert r.status_code == 200
    body = r.json()
    assert "verdicts" in body and body["verdicts"][0]["setup"] == "bull_flag"


def test_confirmed_endpoint_requires_auth(client):
    r = client.get("/api/patterns/confirmed/NVDA")
    assert r.status_code == 401


def test_judge_requires_admin(client):
    _login(client, role="member")
    assert client.post("/api/patterns/judge/NVDA").status_code == 403


def test_vision_stats_requires_admin(client):
    _login(client, role="member")
    assert client.get("/api/patterns/admin/vision-stats").status_code == 403


def test_vision_stats_ok_for_admin(client, monkeypatch, tmp_path):
    _seed_store(tmp_path, monkeypatch)
    _login(client, role="admin")
    r = client.get("/api/patterns/admin/vision-stats")
    assert r.status_code == 200
    assert "cost_today" in r.json() and "may_judge" in r.json()
