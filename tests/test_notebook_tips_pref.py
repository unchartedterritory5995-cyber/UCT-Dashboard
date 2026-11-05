"""S13 + Tier 2 fix round 1 (review minors 5 and 7): `notebook_tips`, the one-time Notebook tips a member has seen.

* A real schema: exactly {"v": 1, "seen": [ids]}, every id a tip the client knows, no repeats, at most 512 bytes.
* MERGED on write: two tabs recording different tips onto stale copies never erase each other's.
* The server's id list is the client's: `TIP_IDS` in app/src/pages/journal-2-0/lib/notebookTips.js, parsed here.
"""
from __future__ import annotations

import json
import os
import re

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from tests.authclients import PAID_MEMBER, authorize

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIPS_JS = os.path.join(REPO, "app", "src", "pages", "journal-2-0", "lib", "notebookTips.js")


@pytest.fixture(scope="module")
def client():
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


def test_the_server_knows_exactly_the_clients_tip_ids():
    src = open(TIPS_JS, encoding="utf-8").read()
    m = re.search(r"export const TIP_IDS = Object\.freeze\(\{([^}]*)\}\)", src)
    assert m, "TIP_IDS not found in notebookTips.js"
    client_ids = re.findall(r"'([a-z0-9-]+)'", m.group(1))
    assert client_ids, "non-vacuity: TIP_IDS names its ids"
    assert sorted(client_ids) == sorted(auth_router.NOTEBOOK_TIP_IDS)


@pytest.mark.parametrize("value", [
    '{"v": 1, "seen": []}', '{"v": 1, "seen": ["ticker"]}', '{"v": 1, "seen": ["chart", "ticker"]}',
])
def test_accepts_the_shapes_the_client_writes(value):
    auth_router._validate_preference("notebook_tips", value)


def test_accepts_the_first_run_and_first_live_widget_marks():
    """Tier 3a fix round 1: the first run's marks and the per-account first-live-widget mark ride this key, so the
    schema must accept every one (a refused write would leave the first run re-opening on every visit)."""
    every = ["ticker", "chart", "first-run", "first-run-skipped", "first-run-built", "first-run-inline", "first-live-widget"]
    auth_router._validate_preference("notebook_tips", json.dumps({"v": 1, "seen": every}))
    assert len(json.dumps({"v": 1, "seen": every}).encode()) <= 512


@pytest.mark.parametrize("value", [
    "", "x", "[]", "null", '{"v": 1}', '{"seen": []}', '{"v": 2, "seen": []}', '{"v": true, "seen": []}',
    '{"v": 1, "seen": ["nope"]}', '{"v": 1, "seen": ["ticker", "ticker"]}', '{"v": 1, "seen": "ticker"}',
    '{"v": 1, "seen": [], "extra": 1}', '{"v": 1, "seen": [1]}',
    json.dumps({"v": 1, "seen": ["ticker"], "pad": "x" * 600}),
])
def test_refuses_anything_else(value):
    with pytest.raises(HTTPException) as e:
        auth_router._validate_preference("notebook_tips", value)
    assert e.value.status_code == 400


def test_merge_is_the_union_in_first_seen_order():
    merged = auth_router.merge_notebook_tips('{"v":1,"seen":["chart"]}', '{"v": 1, "seen": ["ticker"]}')
    assert json.loads(merged) == {"v": 1, "seen": ["chart", "ticker"]}
    # an unreadable stored value counts as none
    assert json.loads(auth_router.merge_notebook_tips("garbage", '{"v":1,"seen":["ticker"]}')) == {"v": 1, "seen": ["ticker"]}
    # CONTROL: an incoming that already holds everything changes nothing
    assert json.loads(auth_router.merge_notebook_tips('{"v":1,"seen":["ticker"]}', '{"v":1,"seen":["ticker"]}'))["seen"] == ["ticker"]


def test_two_tabs_through_the_endpoint_keep_both_tips(client):
    r1 = client.post("/api/auth/preferences", json={"key": "notebook_tips", "value": '{"v": 1, "seen": ["chart"]}'})
    assert r1.status_code == 200
    # the second tab never saw "chart": its whole value names only "ticker"
    r2 = client.post("/api/auth/preferences", json={"key": "notebook_tips", "value": '{"v": 1, "seen": ["ticker"]}'})
    assert r2.status_code == 200
    stored = client.get("/api/auth/preferences").json()["notebook_tips"]
    assert sorted(json.loads(stored)["seen"]) == ["chart", "ticker"]
    assert json.loads(r2.json()["value"]) == json.loads(stored)


def test_a_bad_value_through_the_endpoint_is_the_one_400(client):
    r = client.post("/api/auth/preferences", json={"key": "notebook_tips", "value": '{"v": 1, "seen": ["nope"]}'})
    assert r.status_code == 400
