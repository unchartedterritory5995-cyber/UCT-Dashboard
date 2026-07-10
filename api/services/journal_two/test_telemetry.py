"""J2 telemetry endpoint — POST /api/j2/telemetry.

Allow-listed FE events → the shared auth `activity_log` via
auth_service.log_activity, action=f"j2:{event}", details=json.dumps(props)[:500].
Unknown event → 400.

Route-level via FastAPI TestClient (mirrors test_filters.py's `route_client`),
because log_activity's write is the whole point — a real activity_log row is the
observable this must verify. get_current_user is overridden and auth_db._DB_PATH
is pointed at a seeded temp file (get_connection reads that module-global at call
time). foreign_keys=ON is enforced in get_connection, so a user row is seeded
(without it the FK-violating INSERT is swallowed and no row lands).
"""
import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def tele(monkeypatch, tmp_path):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_tele.db")
    # get_connection() / init_db() read the module-global _DB_PATH at call time.
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    auth_db.init_db()
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@x.dev', 'pw')"
    )
    conn.commit()
    conn.close()

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    return TestClient(app), db_path


def _rows(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(
            "SELECT action, details FROM activity_log WHERE user_id = 'u1'"
        ).fetchall()
    finally:
        conn.close()


def test_unknown_event_rejected(tele):
    client, db_path = tele
    r = client.post("/api/j2/telemetry", json={"event": "definitely_not_allowed", "props": {}})
    assert r.status_code == 400
    # Rejected events never touch the log.
    assert _rows(db_path) == []


def test_allowed_event_writes_activity_row(tele):
    client, db_path = tele
    r = client.post(
        "/api/j2/telemetry",
        json={"event": "surface_visit", "props": {"tab": "analytics"}},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    rows = _rows(db_path)
    assert len(rows) == 1
    assert rows[0]["action"] == "j2:surface_visit"
    assert json.loads(rows[0]["details"]) == {"tab": "analytics"}


def test_every_allowlisted_event_is_accepted(tele):
    client, db_path = tele
    from api.routers.journal_two import _J2_TELEMETRY_EVENTS

    for ev in sorted(_J2_TELEMETRY_EVENTS):
        assert client.post("/api/j2/telemetry", json={"event": ev}).status_code == 200
    actions = {r["action"] for r in _rows(db_path)}
    assert actions == {f"j2:{ev}" for ev in _J2_TELEMETRY_EVENTS}


def test_null_props_stored_as_empty_object(tele):
    client, db_path = tele
    # props omitted entirely (event-only ping).
    r = client.post("/api/j2/telemetry", json={"event": "trade_page_open"})
    assert r.status_code == 200
    rows = _rows(db_path)
    assert len(rows) == 1
    assert rows[0]["details"] == "{}"


def test_details_truncated_to_500(tele):
    client, db_path = tele
    big = {"blob": "x" * 2000}
    r = client.post(
        "/api/j2/telemetry",
        json={"event": "verdict_embed_run", "props": big},
    )
    assert r.status_code == 200
    rows = _rows(db_path)
    assert len(rows) == 1
    assert len(rows[0]["details"]) == 500
