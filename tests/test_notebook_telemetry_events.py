"""Wave 6 (D14) — the Notebook telemetry events: the client names them, the
server accepts them, the admin read counts them.

⛔ THE MIRROR, NOT A SECOND COPY (`lesson_rail_the_mirror_not_just_the_lane`).
The event names are READ out of the client helper and asserted against the
server allow-list, so the two can never drift into a state where each looks
right alone. A client rail proving "we posted it" would be green against a
server that 400s every one.
"""
from __future__ import annotations

import importlib
import json
import os
import re
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers.journal_two import _J2_TELEMETRY_EVENTS

CLIENT = Path("app/src/pages/journal-2-0/lib/notebookTelemetry.js")


def _client_event_names() -> list[str]:
    src = CLIENT.read_text(encoding="utf-8")
    block = src.split("export const NOTEBOOK_EVENTS = Object.freeze({", 1)[1].split("})", 1)[0]
    return re.findall(r"^\s*[A-Z_]+:\s*'([a-z_]+)',?\s*$", block, re.MULTILINE)


def test_the_client_names_are_read_not_typed_and_the_read_is_not_empty():
    names = _client_event_names()
    # Non-vacuity: a parse that silently returned nothing would make the next
    # test pass over an empty set.
    assert "note_open_ms" in names and "switcher_used" in names
    assert len(names) == len(set(names))


def test_every_client_event_is_on_the_server_allow_list():
    missing = [n for n in _client_event_names() if n not in _J2_TELEMETRY_EVENTS]
    assert not missing, f"the server would 400 these, and the count would read zero: {missing}"


def test_the_allow_list_is_still_a_list():
    # CONTROL: deleting the membership check would leave the test above green.
    assert "anything_at_all" not in _J2_TELEMETRY_EVENTS


def test_the_schemas_never_name_a_content_field():
    """The schema IS the set of keys that can leave the browser. A key named
    like content would be a door for it, whatever its type."""
    src = CLIENT.read_text(encoding="utf-8")
    body = src.split("export const EVENT_SCHEMAS", 1)[1].split("\n})", 1)[0]
    keys = set(re.findall(r"^\s{4}([a-zA-Z_]+):", body, re.MULTILINE))
    assert keys, "could not read the schema keys"
    for forbidden in ("title", "body", "bodyJson", "query", "q", "text", "question",
                      "content", "patch", "subtitle", "name", "url"):
        assert forbidden not in keys, f"schema carries {forbidden!r}"


# ── The admin counts read ────────────────────────────────────────────────────

@pytest.fixture
def db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in ("u1", "u2", "u3"):
        conn.execute("INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                     (uid, f"{uid}@x.test", "x", "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    os.unlink(tmp.name)


def _log(uid, event, details, days_ago=0.0):
    from api.services import auth_db
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO activity_log (id, user_id, action, details, created_at)"
        " VALUES (lower(hex(randomblob(8))), ?, ?, ?, datetime('now', ?))",
        (uid, f"j2:{event}", json.dumps(details), f"-{days_ago * 24} hours"),
    )
    conn.commit()
    conn.close()


def test_counts_cover_both_windows_zero_fill_and_count_members(db):
    from api.services.journal_two import notebook_telemetry as nt
    _log("u1", "search_used", {"results": 3}, days_ago=1)
    _log("u1", "search_used", {"results": 0}, days_ago=2)
    _log("u2", "search_used", {"results": 1}, days_ago=10)   # 30-day window only
    _log("u3", "search_used", {"results": 1}, days_ago=40)   # neither window
    _log("u1", "unrelated_action", {}, days_ago=1)           # not an allow-listed event
    out = nt.event_counts(["search_used", "ask_used"])
    w7, w30 = out["windows"]["7"], out["windows"]["30"]
    assert w7["search_used"] == {"count": 2, "members": 1}
    assert w30["search_used"] == {"count": 3, "members": 2}
    assert w7["ask_used"] == {"count": 0, "members": 0}      # present, zero
    assert "unrelated_action" not in w30


def test_note_open_reports_percentiles_from_the_ms_prop_only(db):
    from api.services.journal_two import notebook_telemetry as nt
    for ms in (100, 200, 300, 400, 1000):
        _log("u1", "note_open_ms", {"ms": ms, "source": "list"})
    _log("u1", "note_open_ms", {"ms": "fast"})                 # not a number: ignored
    w7 = nt.event_counts(["note_open_ms"])["windows"]["7"]["note_open_ms"]
    assert w7["count"] == 6
    assert w7["p50_ms"] == 300.0
    assert w7["p95_ms"] == 880.0


def test_the_admin_door_counts_every_allow_listed_event_and_is_admin_only(db):
    from api.routers import client_errors as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    client = TestClient(fa)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    assert client.get("/api/admin/notebook-telemetry").status_code == 403
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "admin"}
    _log("u1", "switcher_used", {"results": 4, "picked": True})
    body = client.get("/api/admin/notebook-telemetry").json()
    assert set(body["events"]) == set(_J2_TELEMETRY_EVENTS)
    assert body["windows"]["7"]["switcher_used"]["count"] == 1
