"""W2 / R2 — the joystick hub's one-tap owner report endpoint.

⛔ THREE AUTH ANSWERS, NOT ONE. "An admin can post" says nothing about who else can. The hub is
admin-preview surface and this endpoint carries a gesture trace and device details, so a member must
get 403 and an anonymous request must get 401 — each asserted, each distinguishable.

⛔ THE DB IS REDIRECTED AND THAT IS PROVEN, NOT ASSUMED. `/data` is a real directory on the dev box,
so a service that defaulted there would write the owner's live volume from a test run. The fixture
pins `HUB_REPORTS_DB_PATH` and a control asserts the resolved path is NOT under the shared root —
because "it's probably sandboxed" is exactly how `C:\\data\\auth.db` grew to a gigabyte.
"""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services import hub_reports
from tests.authclients import ADMIN, FREE_MEMBER, authorize


@pytest.fixture(autouse=True)
def _sandbox_db(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_REPORTS_DB_PATH", str(tmp_path / "hub_reports.db"))
    yield
    app.dependency_overrides.clear()


@pytest.fixture()
def client():
    return TestClient(app)


def _payload(**over):
    base = {
        "note": "the fan opened when I wanted Chart it",
        "trace": {"rows": [{"type": "pointerup", "elapsed": 214}], "recorded": 1, "dropped": 0},
        "device": {"viewport": [393, 852], "dpr": 3, "userAgent": "iPhone"},
        "visibility": {"hiddenAttr": False, "display": "block", "box": [24, 700, 84, 84]},
        "page": "/screener",
        "mode": "scan",
        "stage": 1,
        "flags": {"HUB_VISUAL_V2": True, "HUB_SURFACE": "default"},
        "clientTime": 1758000000000,
    }
    base.update(over)
    return base


# ── the control that makes every assertion below mean something ────────────────────────────────
def test_the_db_is_redirected_away_from_the_shared_root(tmp_path):
    resolved = hub_reports.db_path()
    assert str(tmp_path) in resolved, "the fixture did not redirect the DB"
    assert not resolved.startswith("/data"), "a test would write the owner's live volume"


# ── auth: all three answers ────────────────────────────────────────────────────────────────────
def test_an_admin_can_file_a_report(client):
    authorize(app, ADMIN)
    r = client.post("/api/hub/reports", json=_payload())
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    assert isinstance(r.json()["id"], int)


def test_a_member_is_refused_403(client):
    authorize(app, FREE_MEMBER)
    r = client.post("/api/hub/reports", json=_payload())
    assert r.status_code == 403, f"a member reached an admin-preview endpoint: {r.status_code}"


def test_an_anonymous_request_is_refused_401(client):
    app.dependency_overrides.clear()
    r = client.post("/api/hub/reports", json=_payload())
    assert r.status_code == 401, f"a signed-out request was not 401: {r.status_code}"


def test_reading_reports_is_admin_only(client):
    authorize(app, FREE_MEMBER)
    assert client.get("/api/hub/reports").status_code == 403


# ── the round trip ─────────────────────────────────────────────────────────────────────────────
def test_the_row_round_trips_byte_exact(client):
    authorize(app, ADMIN)
    sent = _payload()
    posted = client.post("/api/hub/reports", json=sent)
    assert posted.status_code == 200, posted.text

    got = client.get("/api/hub/reports").json()
    assert got["count"] == 1 and got["total"] == 1
    row = got["reports"][0]
    assert row["note"] == sent["note"]
    assert row["user_email"] == ADMIN["email"]
    # ⭐ The whole payload, not a field or two: a store that quietly drops a key is a store that
    # loses the one field the owner cared about, and nothing would say so.
    assert row["payload"] == sent, "the payload did not survive the round trip unchanged"


def test_newest_first(client):
    authorize(app, ADMIN)
    client.post("/api/hub/reports", json=_payload(note="first"))
    client.post("/api/hub/reports", json=_payload(note="second"))
    notes = [r["note"] for r in client.get("/api/hub/reports").json()["reports"]]
    assert notes[0] == "second", f"not newest-first: {notes}"


# ── validation, in the style that closed box 4 ─────────────────────────────────────────────────
def test_an_unknown_top_level_key_is_refused_BY_NAME(client):
    authorize(app, ADMIN)
    r = client.post("/api/hub/reports", json=_payload(smuggled={"x": 1}))
    assert r.status_code == 400
    assert "smuggled" in r.text, "the refusal did not name the offending key"


def test_an_unknown_key_INSIDE_a_known_one_is_ACCEPTED(client):
    # ⭐ Deliberate, and the same reasoning as the preference-key validation: a phone running an
    # older bundle sends the shape it was built with. Refusing that would turn a stale tab into a
    # permanent 400 on the one action this workstream exists to make frictionless.
    authorize(app, ADMIN)
    r = client.post("/api/hub/reports", json=_payload(device={"viewport": [1, 2], "future": "x"}))
    assert r.status_code == 200, r.text


def test_a_note_over_the_cap_is_refused(client):
    authorize(app, ADMIN)
    r = client.post("/api/hub/reports", json=_payload(note="x" * 281))
    assert r.status_code == 400


def test_a_one_tap_report_with_NO_note_is_valid(client):
    # ⛔ THE DESIGNED CASE. "This, here, now" is the whole point of one tap; a report that required
    # typing would reproduce the problem R2 exists to remove.
    authorize(app, ADMIN)
    r = client.post("/api/hub/reports", json=_payload(note=None))
    assert r.status_code == 200, r.text
    assert client.get("/api/hub/reports").json()["reports"][0]["note"] is None


def test_an_empty_note_is_stored_as_NULL_not_empty_string(client):
    # `lesson_chosen_with_nullish_consumed_with_truthiness`: '' and None read differently
    # downstream, so only one of them may reach the table.
    authorize(app, ADMIN)
    client.post("/api/hub/reports", json=_payload(note="   "))
    assert client.get("/api/hub/reports").json()["reports"][0]["note"] is None


def test_an_oversized_payload_is_refused_413(client):
    authorize(app, ADMIN)
    r = client.post("/api/hub/reports", json=_payload(trace={"blob": "y" * (600 * 1024)}))
    assert r.status_code == 413


# ── the store's own honesty ────────────────────────────────────────────────────────────────────
def test_an_unparseable_row_is_REPORTED_not_dropped(monkeypatch):
    # A silently skipped row makes the intake table read quieter than it is — the one thing an
    # intake must never do (`lesson_a_saturated_instrument_reports_zero`).
    hub_reports.add_report(user_id="u", user_email="e", note=None, payload={"page": "/x"})
    import sqlite3
    with sqlite3.connect(hub_reports.db_path()) as conn:
        conn.execute("UPDATE hub_reports SET payload_json = ?", ("{not json",))
        conn.commit()
    rows = hub_reports.list_reports()
    assert len(rows) == 1, "the unparseable row vanished"
    assert rows[0]["payload"].get("_unparseable") is True
