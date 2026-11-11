"""POST /api/auth/desk-usage -- Task 9 (desktop plan Stage 1): one coarse usage report per
member per ET day, allow-listed enums only, stored in activity_log as action 'desk_usage'."""
from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services.auth_db import get_connection, init_db

A = {"id": "du-user-a", "email": "a@example.com"}
B = {"id": "du-user-b", "email": "b@example.com"}
GOOD = {"multi_monitor": "yes", "popout_opened": False, "standalone": False, "os": "windows"}


@pytest.fixture()
def who():
    return {"u": A}


@pytest.fixture()
def client(who):
    app = FastAPI()
    app.include_router(auth_router.router)
    app.dependency_overrides[auth_router.get_current_user] = lambda: who["u"]
    init_db()
    conn = get_connection()
    conn.execute("DELETE FROM activity_log WHERE action = 'desk_usage'")
    for u in (A, B):
        conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
                     (u["id"], u["email"]))
    conn.commit()
    conn.close()
    return TestClient(app)


def _rows(uid=None):
    conn = get_connection()
    try:
        q, a = "SELECT user_id, details FROM activity_log WHERE action = 'desk_usage'", ()
        if uid:
            q, a = q + " AND user_id = ?", (uid,)
        return [dict(r) for r in conn.execute(q, a).fetchall()]
    finally:
        conn.close()


def test_session_required():
    init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    r = TestClient(app).post("/api/auth/desk-usage", json=GOOD)
    assert r.status_code in (401, 403)
    assert _rows() == []


def test_valid_write_stores_one_row_with_the_four_fields_and_the_et_date(client):
    r = client.post("/api/auth/desk-usage", json=GOOD)
    assert r.status_code == 200 and r.json() == {"ok": True}
    rows = _rows(A["id"])
    assert len(rows) == 1
    d = json.loads(rows[0]["details"])
    assert d["date"] == datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    assert {k: d[k] for k in GOOD} == GOOD
    assert set(d) == set(GOOD) | {"date"}


@pytest.mark.parametrize("bad", [
    {"multi_monitor": "maybe"}, {"multi_monitor": True}, {"os": "plan9"}, {"os": None},
    {"popout_opened": "yes"}, {"popout_opened": 1}, {"standalone": "false"},
    {"url": "https://x"}, {"ticker": "AAPL"},
])
def test_invalid_value_or_extra_field_is_422_and_nothing_stored(client, bad):
    r = client.post("/api/auth/desk-usage", json={**GOOD, **bad})
    assert r.status_code == 422
    assert _rows() == []


@pytest.mark.parametrize("missing", list(GOOD))
def test_missing_field_is_422(client, missing):
    body = {k: v for k, v in GOOD.items() if k != missing}
    assert client.post("/api/auth/desk-usage", json=body).status_code == 422
    assert _rows() == []


@pytest.mark.parametrize("v", ["yes", "no", "unknown"])
def test_each_multi_monitor_value_accepted(client, v):
    assert client.post("/api/auth/desk-usage", json={**GOOD, "multi_monitor": v}).status_code == 200


@pytest.mark.parametrize("v", ["windows", "mac", "linux", "chromeos", "android", "ios", "other"])
def test_each_os_value_accepted(client, v):
    assert client.post("/api/auth/desk-usage", json={**GOOD, "os": v}).status_code == 200


def test_one_row_per_day_and_popout_upgrades_false_to_true_never_back(client):
    client.post("/api/auth/desk-usage", json=GOOD)
    client.post("/api/auth/desk-usage", json={**GOOD, "popout_opened": True})
    assert len(_rows(A["id"])) == 1
    assert json.loads(_rows(A["id"])[0]["details"])["popout_opened"] is True
    client.post("/api/auth/desk-usage", json={**GOOD, "popout_opened": False, "os": "mac"})
    rows = _rows(A["id"])
    assert len(rows) == 1
    d = json.loads(rows[0]["details"])
    assert d["popout_opened"] is True and d["os"] == "windows"  # first row's other fields kept


def test_another_members_row_is_untouched(client, who):
    client.post("/api/auth/desk-usage", json=GOOD)
    before = _rows(A["id"])
    who["u"] = B
    client.post("/api/auth/desk-usage", json={**GOOD, "popout_opened": True, "os": "mac"})
    assert _rows(A["id"]) == before
    assert len(_rows(B["id"])) == 1
    assert json.loads(_rows(B["id"])[0]["details"])["os"] == "mac"


def test_admin_recent_activity_feed_does_not_list_desk_usage(client):
    from api.services.auth_service import get_recent_activity
    client.post("/api/auth/desk-usage", json=GOOD)
    assert all(r["action"] != "desk_usage" for r in get_recent_activity(limit=500))


def test_the_route_is_inside_the_declared_auth_rate_limit_family():
    from api import rate_limit_policy as rlp
    hit = rlp.classify("/api/auth/desk-usage")
    assert hit is not None and hit[0] == rlp.KIND_FAMILY and hit[1] == "auth", hit


def test_admin_per_member_views_do_not_list_desk_usage(client):
    from api.services.auth_service import get_user_activity, get_user_detail
    from api.services.auth_service import log_activity
    client.post("/api/auth/desk-usage", json=GOOD)
    log_activity(A["id"], "login")
    assert [r["action"] for r in get_user_activity(A["id"], limit=50)] == ["login"]
    detail = get_user_detail(A["id"])
    assert detail is not None
    assert all(r["action"] != "desk_usage" for r in detail["recent_activity"])
    assert [r["action"] for r in detail["recent_activity"]] == ["login"]
    assert len(_rows(A["id"])) == 1  # the row is still stored (export path keeps it)
