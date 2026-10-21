"""Notebook widgets Task 17 — the server half of the `notebook_chart_sets` preference.

The member's saved chart sets and widget presets are ONE JSON string under one preference key, written by
`app/src/pages/journal-2-0/lib/notebookSets.js` (`saveSets`) with a direct POST, not through `setPref`, so
`tests/test_preference_key_validation.py`'s call-site scan cannot see the writer. This rail is that writer's
own: it READS the key the client writes from the source (never retyped) and proves the server accepts it,
stores the whole value, and that a near-miss key is still refused (the control: the endpoint is validating).
"""
import json
import os
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from tests.authclients import PAID_MEMBER, authorize

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETS_JS = os.path.join(REPO, "app", "src", "pages", "journal-2-0", "lib", "notebookSets.js")


def _client_key():
    with open(SETS_JS, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"export const CHART_SETS_PREF\s*=\s*'([^']+)'", src)
    assert m, "CHART_SETS_PREF not found in notebookSets.js — the read is broken"
    # The writer posts THIS constant (not a literal elsewhere), or the read above proves nothing.
    assert "key: CHART_SETS_PREF" in src, "saveSets no longer posts CHART_SETS_PREF"
    return m.group(1)


@pytest.fixture(scope="module")
def client():
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


VALUE = json.dumps({
    "v": 1,
    "sets": [{"id": "s_1", "name": "Semis", "charts": [{"symbol": "NVDA", "tf": "D"}, {"symbol": "AMD", "tf": "60"}]}],
    "presets": [{"id": "p_1", "name": "Flagged only", "kind": "myWatchlistToday",
                 "params": {"list": "flagged", "share": False}}],
})


def test_the_key_the_client_writes_is_the_key_the_table_lists():
    assert _client_key() == "notebook_chart_sets"
    assert auth_router._PREFERENCE_KEYS[_client_key()] == auth_router._PREF_OPAQUE


def test_the_server_accepts_and_stores_the_whole_value(client):
    key = _client_key()
    resp = client.post("/api/auth/preferences", json={"key": key, "value": VALUE})
    assert resp.status_code == 200, resp.text
    got = client.get("/api/auth/preferences").json()
    assert json.loads(got[key]) == json.loads(VALUE)


def test_a_near_miss_key_is_still_refused(client):
    """Control: the endpoint validates keys, so the acceptance above is a real answer."""
    resp = client.post("/api/auth/preferences", json={"key": "notebook_chart_set", "value": VALUE})
    assert resp.status_code == 400
