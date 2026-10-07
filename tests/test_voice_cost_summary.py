"""`GET /api/voice/cost` reads the columns the schema actually has.

THE DEFECT. `voice_cost_service.get_monthly_cost_summary` (added `f3611f6999`,
2026-05-12) asked `voice_usage_monthly` for `seconds_used`, ordered by
`month_key`. The table was created four days earlier (`13d77734af`) with
`mode_a_seconds` and `year_month`, and neither of the other two names has ever
existed in any schema or migration. So the query raised
`no such column: seconds_used` on every database, new or old, and the endpoint
answered 500 from the day it shipped.

These tests run the real query against a database built by `init_db()` from
nothing, and against one whose usage table has the shape it had on 2026-05-08
(before `mode_d_seconds` was added by migration).
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

OLD_USAGE_TABLE = """
CREATE TABLE voice_usage_monthly (
    user_id              TEXT NOT NULL,
    year_month           TEXT NOT NULL,
    mode_a_seconds       INTEGER NOT NULL DEFAULT 0,
    mode_b_calls         INTEGER NOT NULL DEFAULT 0,
    mode_c_seconds       INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd   REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, year_month)
);
"""


def _fresh_db(monkeypatch, *, old_shape: bool):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    if old_shape:
        conn = sqlite3.connect(tmp.name)
        conn.executescript(OLD_USAGE_TABLE)
        conn.execute("INSERT INTO voice_usage_monthly (user_id, year_month, mode_a_seconds) VALUES ('old', '2026-05', 7)")
        conn.commit()
        conn.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    return tmp.name


@pytest.fixture(params=[False, True], ids=["fresh database", "database shaped like 2026-05-08"])
def any_db(request, monkeypatch):
    path = _fresh_db(monkeypatch, old_shape=request.param)
    yield path
    try:
        os.unlink(path)
    except OSError:
        pass


def _member() -> str:
    from api.services.auth_db import get_connection
    uid = f"cost-{uuid.uuid4().hex[:10]}"
    conn = get_connection()
    try:
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, 'x', 'T', 'admin')",
                     (uid, f"{uid}@test.local"))
        conn.commit()
    finally:
        conn.close()
    return uid


def test_the_summary_can_be_read_with_no_usage_at_all(any_db):
    from api.services import voice_cost_service
    out = voice_cost_service.get_monthly_cost_summary(_member())
    assert out["month_to_date_usd"] == 0
    assert out["breakdown"]["mode_a_tts"] == {"cost_usd": 0, "seconds": 0}


def test_read_aloud_seconds_recorded_this_month_reach_the_summary(any_db):
    """The usage writer and the cost reader have to mean the same column: what
    `record_mode_a_seconds` writes is what the summary reports."""
    from api.services import voice_cost_service, voice_usage
    uid = _member()
    voice_usage.record_mode_a_seconds(uid, 120)
    out = voice_cost_service.get_monthly_cost_summary(uid)
    assert out["breakdown"]["mode_a_tts"]["seconds"] == 120
    assert out["breakdown"]["mode_a_tts"]["cost_usd"] == voice_cost_service.estimate_mode_a_cost(120 * 25) > 0


def test_a_past_months_seconds_are_not_counted_as_this_months(any_db):
    """The summary is for the current calendar month. The old query took the
    newest row whatever its month, so a quiet month would have shown the last
    busy one's usage."""
    from api.services import voice_cost_service
    from api.services.auth_db import get_connection
    uid = _member()
    last_month = (datetime.now(timezone.utc).replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    conn = get_connection()
    try:
        conn.execute("INSERT INTO voice_usage_monthly (user_id, year_month, mode_a_seconds) VALUES (?, ?, 900)",
                     (uid, last_month))
        conn.commit()
    finally:
        conn.close()
    assert voice_cost_service.get_monthly_cost_summary(uid)["breakdown"]["mode_a_tts"]["seconds"] == 0


def test_the_old_shaped_table_gained_the_newer_column_and_kept_its_row(monkeypatch):
    """Non-vacuity for the old-shape case: the table really was the old one, and
    `init_db()` brought it up to date without losing what it held."""
    path = _fresh_db(monkeypatch, old_shape=True)
    conn = sqlite3.connect(path)
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(voice_usage_monthly)")}
        assert {"mode_a_seconds", "year_month", "mode_d_seconds"} <= cols
        assert "seconds_used" not in cols and "month_key" not in cols
        assert conn.execute("SELECT mode_a_seconds FROM voice_usage_monthly WHERE user_id = 'old'").fetchone()[0] == 7
    finally:
        conn.close()
        os.unlink(path)


def test_every_column_the_cost_query_names_is_in_the_schema(any_db):
    """The pin, by the database's own word: each statement the service sends is
    prepared against the real schema. A column that does not exist fails here by
    name, on both database shapes."""
    import ast
    import inspect
    from api.services import voice_cost_service
    from api.services.auth_db import get_connection
    tree = ast.parse(inspect.getsource(voice_cost_service))
    statements = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)
                  and n.value.lstrip().upper().startswith(("SELECT", "UPDATE"))]
    assert len(statements) >= 4, "the reader found fewer SQL statements than the service sends"
    conn = get_connection()
    try:
        for sql in statements:
            params = (None,) * sql.count("?")
            conn.execute("EXPLAIN " + sql, params)     # raises on an unknown table or column
    finally:
        conn.close()


@pytest.fixture
def client(any_db):
    from api.main import app
    from api.middleware import auth_middleware as authmw
    uid = _member()
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": uid, "role": "admin"}
    yield TestClient(app), uid
    app.dependency_overrides.pop(authmw.get_current_user, None)


def test_the_cost_door_answers_on_a_database_built_from_nothing(client):
    """REPRODUCTION: the request the Voice Telemetry panel in Settings makes."""
    c, _uid = client
    r = c.get("/api/voice/cost")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True and body["month_to_date_usd"] == 0


def test_the_cost_door_gives_a_handled_answer_when_usage_cannot_be_read(client, monkeypatch):
    """Fail soft: a broken read is a 200 that says so, never a 500, and never a
    row of zeros that would read as "you have used nothing"."""
    from api.services import voice_cost_service
    c, _uid = client

    def broken(user_id):
        raise sqlite3.OperationalError("no such column: seconds_used")

    monkeypatch.setattr(voice_cost_service, "get_monthly_cost_summary", broken)
    r = c.get("/api/voice/cost")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False
    assert body["month_to_date_usd"] is None and body["breakdown"] is None
    assert "seconds_used" not in r.text, "the database's own error text reached the member"
    assert body["message"].endswith(".")
