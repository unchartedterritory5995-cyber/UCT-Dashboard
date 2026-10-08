"""CLOSED-VALUE SETTINGS — the server refuses a value the app does not offer.

`theme`, `default_chart_tf`, `alert_sound` and `alert_sound_type` were checked only in the
browser (Settings' pickers, UCT Agent's typed actions); any client could store anything.
Now `POST /api/auth/preferences` (and `/api/workspace-doc/apply`, which runs the same
validator) refuses an unknown value BEFORE any write. These tests drive the REAL router
through a real client, and re-derive every allowed list from `app/src/**` so the server
can never fall behind the client (a client value the server lacks fails here, not in a
member's face).
"""
from __future__ import annotations

import os
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from tests.authclients import PAID_MEMBER, authorize

APP_SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "src")


@pytest.fixture(scope="module")
def client():
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


def _read(*parts):
    with open(os.path.join(APP_SRC, *parts), "r", encoding="utf-8") as fh:
        return fh.read()


def _post(client, key, value):
    return client.post("/api/auth/preferences", json={"key": key, "value": value})


def _stored(client, key):
    return client.get("/api/auth/preferences").json().get(key)


# ── the server's lists ARE the client's lists ───────────────────────────────────────

def test_theme_catalog_matches_the_client_catalog():
    ids = re.findall(r"\b(?:dark|light)\('([a-z0-9-]+)'", _read("styles", "appThemes.js"))
    assert len(ids) >= 18, "theme catalog scan is broken"
    assert sorted(ids) == sorted(auth_router._APP_THEME_CATALOG)
    base = re.findall(r"\{ value: '([a-z]+)'", _read("components", "AppThemePicker.jsx"))
    assert sorted(base) == sorted(auth_router._APP_THEME_BASE)


def test_alert_sounds_match_the_client():
    keys = re.findall(r"\{ key: '([a-z_]+)',", _read("utils", "alertSound.js"))
    assert len(keys) >= 10
    assert sorted(keys) == sorted(auth_router._ALERT_SOUNDS)


def test_settings_timeframes_are_all_accepted():
    src = _read("pages", "Settings.jsx")
    block = src[src.index("const TF_OPTIONS"):src.index("]", src.index("const TF_OPTIONS"))]
    tfs = re.findall(r"value: '([0-9A-Z]+)'", block)
    assert tfs and set(tfs) <= set(auth_router._CHART_TF_CODES)


# ── accepted ─────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("key,value", (
    [("theme", v) for v in ("dark", "oled", "light", "uct:slate", "uct:paper", "uct:mint", "midnight", "dim", "system")]
    + [("default_chart_tf", v) for v in ("5", "30", "60", "D", "W", "1", "M")]
    + [("alert_sound", v) for v in ("on", "off")]
    + [("alert_sound_type", v) for v in auth_router._ALERT_SOUNDS]
    + [(k, "") for k in ("theme", "default_chart_tf", "alert_sound", "alert_sound_type")]   # cleared
))
def test_every_offered_legacy_and_cleared_value_is_accepted_and_stored(client, key, value):
    r = _post(client, key, value)
    assert r.status_code == 200, r.text
    assert _stored(client, key) == value


# ── refused, and NOTHING written ─────────────────────────────────────────────────────

@pytest.mark.parametrize("key,value", [
    ("theme", "neon"), ("theme", "uct:does-not-exist"), ("theme", "Dark"), ("theme", " dark"),
    ("theme", '{"theme":"dark"}'), ("theme", "uct:"),
    ("default_chart_tf", "2"), ("default_chart_tf", "d"), ("default_chart_tf", "daily"),
    ("alert_sound", "yes"), ("alert_sound", "ON"), ("alert_sound", "true"),
    ("alert_sound_type", "airhorn"), ("alert_sound_type", "<script>"),
])
def test_an_unknown_value_is_refused_before_any_write(client, key, value):
    assert _post(client, key, {"theme": "light"}.get(key, "") or "").status_code == 200   # a known start
    before = _stored(client, key)
    r = _post(client, key, value)
    assert r.status_code == 400
    assert "is not a valid value for" in r.json()["detail"]
    assert _stored(client, key) == before


@pytest.mark.parametrize("body", [
    {"key": "theme", "value": {"nested": "dark"}},
    {"key": "theme", "value": ["dark"]},
    {"key": "theme"},
])
def test_malformed_payloads_are_refused(client, body):
    assert client.post("/api/auth/preferences", json=body).status_code in (400, 422)


def test_an_unknown_key_is_still_refused(client):
    assert _post(client, "theme_override", "dark").status_code == 400


def test_an_opaque_key_is_untouched_by_this_change(client):
    # Every other key keeps its shipped behaviour (any string).
    assert _post(client, "chart_settings", "anything at all").status_code == 200


def test_workspace_doc_apply_validates_every_key_before_writing_any():
    """The batch door runs the same validator over ALL keys first: one bad value → nothing written."""
    from api.routers import workspace_doc
    src = open(workspace_doc.__file__, encoding="utf-8").read()
    i = src.index("def apply(")
    body = src[i:src.index("wds.apply_patch", i)]
    assert "_validate_preference(key" in body
