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


def test_eval_requires_admin(client):
    _login(client, role="member")
    assert client.get("/api/patterns/admin/eval").status_code == 403


def test_eval_ok_for_admin(client, monkeypatch):
    import api.services.pattern_vision.eval as pv_eval
    monkeypatch.setattr(pv_eval, "evaluate",
                        lambda **k: {"per_setup": {}, "false_positive_rate": None, "n": 0})
    _login(client, role="admin")
    r = client.get("/api/patterns/admin/eval?max_rows=5")
    assert r.status_code == 200
    assert r.json()["n"] == 0


def test_feedback_requires_auth(client):
    r = client.post("/api/patterns/feedback", json={
        "ticker": "NVDA", "setup": "vcp", "asof_date": "2026-06-19", "rating": "up"})
    assert r.status_code == 401


def test_feedback_records(client, monkeypatch, tmp_path):
    s = _seed_store(tmp_path, monkeypatch)
    # seed a verdict so get_recent_verdicts surfaces the attached feedback
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 0, "vision_confidence": 40, "rationale": "weak",
                   "signals_hash": "z", "judged_at": 1})
    _login(client)
    r = client.post("/api/patterns/feedback", json={
        "ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
        "rating": "down", "note": "handle too deep"})
    assert r.status_code == 200 and r.json()["ok"] is True
    recent = s.get_recent_verdicts(limit=10)
    assert recent[0]["feedback"]["rating"] == "down"
    assert recent[0]["feedback"]["note"] == "handle too deep"


def test_feedback_inline_source_no_date(client, monkeypatch, tmp_path):
    s = _seed_store(tmp_path, monkeypatch)
    _login(client)
    # inline thumbs: no asof_date, carries a source — must default the date and store source
    r = client.post("/api/patterns/feedback", json={
        "ticker": "AAPL", "setup": "scan:pullback", "rating": "down",
        "note": "extended", "source": "scanner"})
    assert r.status_code == 200 and r.json()["ok"] is True
    log = s.list_feedback(source="scanner")
    assert len(log) == 1 and log[0]["asof_date"]  # date auto-filled


def test_feedback_list_requires_admin(client):
    _login(client, role="member")
    assert client.get("/api/patterns/admin/feedback").status_code == 403


def test_review_requires_admin(client):
    _login(client, role="member")
    assert client.get("/api/patterns/admin/review").status_code == 403


def test_exemplar_save_list_delete_admin(client, monkeypatch, tmp_path):
    import base64
    s = _seed_store(tmp_path, monkeypatch)
    _login(client, role="admin")
    img = "data:image/png;base64," + base64.b64encode(b"\x89PNGdrawn").decode()
    r = client.post("/api/patterns/exemplar", json={
        "setup": "vcp", "image": img, "ticker": "NVDA", "note": "ideal coil"})
    assert r.status_code == 200
    eid = r.json()["exemplar_id"]
    assert s.exemplar_pngs("vcp") == [b"\x89PNGdrawn"]
    lst = client.get("/api/patterns/admin/exemplars?setup=vcp")
    assert lst.status_code == 200 and len(lst.json()["exemplars"]) == 1
    d = client.delete(f"/api/patterns/exemplar/{eid}")
    assert d.status_code == 200 and s.exemplar_pngs("vcp") == []


def test_exemplar_bad_base64_400(client, monkeypatch, tmp_path):
    _seed_store(tmp_path, monkeypatch)
    _login(client, role="admin")
    r = client.post("/api/patterns/exemplar", json={"setup": "vcp", "image": "%%%notb64%%%"})
    assert r.status_code == 400


def test_exemplar_requires_admin(client):
    _login(client, role="member")
    assert client.post("/api/patterns/exemplar",
                       json={"setup": "vcp", "image": "x"}).status_code == 403
