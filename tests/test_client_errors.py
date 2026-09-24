"""The client error beacon's server half (D14): scrub, rate limit, kill
switch, retention, the log line, and the doors.

Every test points `CLIENT_ERRORS_DB_PATH` at its own tmp file, so nothing here
can reach the shared data root (the repo-root conftest would fail the run if
it did).
"""
from __future__ import annotations

import json
import logging
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import client_errors as ce

TOKEN = "tok_7f3a9c1e5b2d4f60"   # the planted secret: must never be stored


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "client_errors.db"
    monkeypatch.setenv("CLIENT_ERRORS_DB_PATH", str(path))
    monkeypatch.delenv(ce.KILL_SWITCH, raising=False)
    monkeypatch.setattr(ce, "_last_prune", 0.0)
    return path


def _rows(path):
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute("SELECT * FROM client_errors ORDER BY id")]
    finally:
        c.close()


def _report(**over):
    r = {"kind": "error", "name": "TypeError",
         "message": "Cannot read properties of undefined (reading …)",
         "stack": "    at render (https://uctintelligence.com/assets/index-abc.js:12:34)",
         "page": "/journal/notebook", "ts": 1.0}
    r.update(over)
    return r


# ── The transport scrub ──────────────────────────────────────────────────────

def test_a_token_in_a_url_FRAGMENT_is_never_stored(store):
    """The login-link token rides in a fragment (`/smoke-login#token=…`). A
    fragment is the one part of a URL a server never sees on the wire — and the
    one part a JS error message happily quotes back."""
    ce.record_reports([_report(
        page=f"/smoke-login#token={TOKEN}",
        message=f"Failed to load https://uctintelligence.com/smoke-login#token={TOKEN}",
        stack=f"    at go (https://uctintelligence.com/assets/app.js?t={TOKEN}:9:3)",
    )], user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert TOKEN not in json.dumps(row)
    assert row["page"] == "/smoke-login"
    assert "https://uctintelligence.com/smoke-login" in row["message"]
    # The frame keeps its location — :line:col is not a secret, the query was.
    assert row["stack"].endswith("assets/app.js:9:3)")


def test_query_strings_relative_urls_bare_fragments_and_credentials_all_go(store):
    ce.record_reports([_report(
        message=(f"GET /api/j2/notes?q=my+private+search failed; hash #access_token={TOKEN}; "
                 f"retry with key={TOKEN}"),
        page="/journal/notebook?note=abc123&task=2",
    )], user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert TOKEN not in row["message"]
    assert "my+private+search" not in row["message"]
    assert "/api/j2/notes" in row["message"]
    assert "key=[removed]" in row["message"]
    assert row["page"] == "/journal/notebook"


def test_a_data_uri_never_carries_its_payload(store):
    ce.record_reports([_report(message="bad image data:image/png;base64,QUJDREVGRw==")],
                      user_id=None, ip="1.2.3.4", user_agent="UA")
    [row] = _rows(store)
    assert "QUJDREVGRw" not in row["message"]
    assert "data:[removed]" in row["message"]


def test_fields_are_capped_and_control_characters_removed(store):
    ce.record_reports([_report(message="x" * 5000, stack="y" * 50000, name="N\x00ame" * 100)],
                      user_id=None, ip="1.2.3.4", user_agent="U" * 9000)
    [row] = _rows(store)
    assert len(row["message"]) == ce.CAP_MESSAGE
    assert len(row["stack"]) == ce.CAP_STACK
    assert len(row["name"]) <= ce.CAP_NAME and "\x00" not in row["name"]
    assert len(row["user_agent"]) == ce.CAP_USER_AGENT


def test_an_unknown_kind_is_not_stored(store):
    out = ce.record_reports([_report(kind="evil"), "not a dict", _report()],
                            user_id=None, ip="1.2.3.4", user_agent="UA")
    assert out == {"stored": 1, "dropped": 0, "invalid": 2}


def test_the_row_holds_a_hash_never_the_raw_address(store):
    ce.record_reports([_report()], user_id=None, ip="203.0.113.77", user_agent="UA")
    raw = store.read_bytes()
    assert b"203.0.113.77" not in raw
    assert _rows(store)[0]["rate_key"] == ce.rate_key_for(None, "203.0.113.77")


# ── The rate limit ───────────────────────────────────────────────────────────

def test_the_rate_limit_is_per_key_and_counted_from_the_store(store):
    now = 1_000_000.0
    first = ce.record_reports([_report()] * ce.MAX_REPORTS_PER_REQUEST,
                              user_id=None, ip="1.1.1.1", user_agent="UA", now=now)
    assert first["stored"] == ce.MAX_REPORTS_PER_REQUEST
    for _ in range(ce.RATE_LIMIT // ce.MAX_REPORTS_PER_REQUEST):
        ce.record_reports([_report()] * ce.MAX_REPORTS_PER_REQUEST,
                          user_id=None, ip="1.1.1.1", user_agent="UA", now=now + 1)
    assert len(_rows(store)) == ce.RATE_LIMIT
    over = ce.record_reports([_report()], user_id=None, ip="1.1.1.1", user_agent="UA", now=now + 2)
    assert over == {"stored": 0, "dropped": 1, "invalid": 0}
    # A different address is its own bucket …
    other = ce.record_reports([_report()], user_id=None, ip="2.2.2.2", user_agent="UA", now=now + 2)
    assert other["stored"] == 1
    # … and a signed-in member is keyed by id, not by the shared address.
    member = ce.record_reports([_report()], user_id="u1", ip="1.1.1.1", user_agent="UA", now=now + 2)
    assert member["stored"] == 1
    # Once the window has passed, the same address may report again.
    later = ce.record_reports([_report()], user_id=None, ip="1.1.1.1", user_agent="UA",
                              now=now + ce.RATE_WINDOW_S + 5)
    assert later["stored"] == 1


def test_the_global_ceiling_holds_across_rotating_addresses(store, monkeypatch):
    monkeypatch.setattr(ce, "GLOBAL_LIMIT_PER_HOUR", 5)
    now = 2_000_000.0
    stored = sum(ce.record_reports([_report()], user_id=None, ip=f"10.0.0.{i}",
                                   user_agent="UA", now=now)["stored"] for i in range(9))
    assert stored == 5


def test_more_than_the_per_request_cap_is_dropped_not_stored(store):
    out = ce.record_reports([_report()] * (ce.MAX_REPORTS_PER_REQUEST + 3),
                            user_id=None, ip="3.3.3.3", user_agent="UA")
    assert out["stored"] == ce.MAX_REPORTS_PER_REQUEST
    assert out["dropped"] == 3


# ── Retention ────────────────────────────────────────────────────────────────

def test_rows_past_fourteen_days_are_pruned(store):
    day = 86400
    now = 5_000_000.0
    ce.record_reports([_report(message="old")], user_id=None, ip="4.4.4.4", user_agent="UA",
                      now=now - (ce.RETENTION_DAYS + 1) * day)
    ce.record_reports([_report(message="recent")], user_id=None, ip="4.4.4.4", user_agent="UA",
                      now=now - (ce.RETENTION_DAYS - 1) * day)
    assert ce.prune(now=now) == 1
    assert [r["message"] for r in _rows(store)] == ["recent"]


def test_a_write_prunes_opportunistically(store):
    day = 86400
    now = 6_000_000.0
    ce.record_reports([_report(message="old")], user_id=None, ip="5.5.5.5", user_agent="UA",
                      now=now - 20 * day)
    ce._last_prune = 0.0
    ce.record_reports([_report(message="new")], user_id=None, ip="5.5.5.6", user_agent="UA", now=now)
    assert [r["message"] for r in _rows(store)] == ["new"]


# ── The log line ─────────────────────────────────────────────────────────────

def test_one_structured_log_line_per_stored_report_and_no_token_in_it(store, caplog):
    caplog.set_level(logging.WARNING, logger=ce.__name__)
    ce.record_reports([_report(page=f"/x#token={TOKEN}"), _report()],
                      user_id="u9", ip="6.6.6.6", user_agent="UA")
    lines = [r.getMessage() for r in caplog.records if "[client-error]" in r.getMessage()]
    assert len(lines) == 2
    payload = json.loads(lines[0].split("[client-error] ", 1)[1])
    assert payload["user"] == "u9" and payload["page"] == "/x"
    assert TOKEN not in "\n".join(lines)


# ── The kill switch ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    (None, True), ("1", True), ("true", True), ("", True),
    ("0", False), ("false", False), ("OFF", False), (" no ", False),
])
def test_the_kill_switch_reads_unset_as_on(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv(ce.KILL_SWITCH, raising=False)
    else:
        monkeypatch.setenv(ce.KILL_SWITCH, value)
    assert ce.enabled() is expected


# ── The doors ────────────────────────────────────────────────────────────────

@pytest.fixture
def app(store):
    from api.routers import client_errors as router_mod
    fa = FastAPI()
    fa.include_router(router_mod.router)
    fa.dependency_overrides[authmw.get_current_user_optional] = lambda: None
    yield fa
    fa.dependency_overrides.clear()


def test_the_door_takes_a_report_without_a_session(app, store):
    r = TestClient(app).post("/api/client-errors", json={"reports": [_report()]})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "enabled": True, "stored": 1, "dropped": 0, "invalid": 0}
    assert _rows(store)[0]["user_id"] is None


def test_a_signed_in_report_carries_the_member_id(app, store):
    app.dependency_overrides[authmw.get_current_user_optional] = lambda: {"id": "u42"}
    TestClient(app).post("/api/client-errors", json=_report())
    assert _rows(store)[0]["user_id"] == "u42"


def test_the_kill_switch_is_read_PER_REQUEST_and_off_writes_nothing(app, store, monkeypatch):
    client = TestClient(app)
    monkeypatch.setenv(ce.KILL_SWITCH, "0")
    off = client.post("/api/client-errors", json={"reports": [_report()]})
    assert off.status_code == 200 and off.json()["enabled"] is False
    assert not store.exists() or _rows(store) == []
    # Same process, no restart: turning it back on takes effect on the next request.
    monkeypatch.delenv(ce.KILL_SWITCH)
    on = client.post("/api/client-errors", json={"reports": [_report()]})
    assert on.json()["stored"] == 1


def test_an_oversized_body_is_refused(app):
    big = {"reports": [_report(message="x" * 70_000)]}
    assert TestClient(app).post("/api/client-errors", json=big).status_code == 413


def test_a_non_json_body_is_a_400(app):
    r = TestClient(app).post("/api/client-errors", content=b"not json",
                             headers={"content-type": "application/json"})
    assert r.status_code == 400


def test_the_admin_read_is_admin_only_and_groups(app, store):
    client = TestClient(app)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "m", "role": "member"}
    assert client.get("/api/admin/client-errors").status_code == 403
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "a", "role": "admin"}
    client.post("/api/client-errors", json={"reports": [_report(), _report(), _report(name="RangeError")]})
    body = client.get("/api/admin/client-errors?days=1").json()
    assert body["total"] == 3 and body["enabled"] is True
    assert body["groups"][0]["n"] == 2
