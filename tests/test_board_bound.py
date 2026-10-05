"""TERM-001 -- the board-size bound, enforced at save time on both doors that write the board.

Every number here is READ from ``app/src/pages/charts/boardBound.json`` (through
``api.services.board_bound``), never typed: moving the bound moves every expectation.

The rule under test, as sentences (``board_bound.py``'s docstring):
  1. a board within the bound saves exactly as before;
  2. a board that would GROW past the bound is refused, 400, with the bound's own sentence;
  3. a board ALREADY over the bound is never refused for being over it -- same size or smaller
     saves (editable down); it cannot grow;
  4. an over-bound write cannot replace a stored board whose size is unknown (STATE-2);
  5. the stored board is not read at all for an ordinary save.
"""
from __future__ import annotations

import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services import board_bound
from tests.authclients import PAID_MEMBER, authorize

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX = board_bound.MAX_BOARD_WIDGETS
KEY = board_bound.BOARD_KEY


def board(n: int) -> str:
    return json.dumps({"widgets": [{"id": f"w{i}", "type": "chart"} for i in range(n)],
                       "cols": 24, "version": 1})


def reader(value):
    calls = []

    def _read():
        calls.append(1)
        return value
    _read.calls = calls
    return _read


# ── the authority ────────────────────────────────────────────────────────────

def test_the_number_is_the_shared_files_and_both_runtimes_read_the_same_bytes():
    with open(os.path.join(REPO, "app", "src", "pages", "charts", "boardBound.json"),
              encoding="utf-8") as fh:
        data = json.load(fh)
    assert MAX == data["maxWidgets"]
    js = open(os.path.join(REPO, "app", "src", "pages", "charts", "boardBound.js"),
              encoding="utf-8").read()
    assert "from './boardBound.json'" in js
    assert "export const MAX_BOARD_WIDGETS = bound.maxWidgets" in js


def test_the_bound_has_headroom_over_the_measured_census_and_does_not_exceed_the_measured_spike():
    """The decision's two facts (2026-10-02 decision file): the census max is 5 widgets, and
    the largest board ever measured for cost is the 16-cell spike. The bound sits at or under
    what was measured and well over what anyone holds."""
    assert MAX >= 2 * 5
    assert MAX <= 16


# ── check(): the rule ────────────────────────────────────────────────────────

def test_within_the_bound_saves_and_never_reads_the_stored_board():
    r = reader(board(0))
    assert board_bound.check(KEY, board(MAX), r) is None
    assert r.calls == [], "an ordinary save must not cost a read"


def test_growth_past_the_bound_is_refused_in_words():
    sentence = board_bound.check(KEY, board(MAX + 1), reader(board(MAX)))
    assert sentence is not None
    assert f"at most {MAX} widgets" in sentence
    assert f"would hold {MAX + 1}" in sentence


def test_an_over_bound_board_stays_editable_down_and_the_same_size():
    stored = board(MAX + 3)
    assert board_bound.check(KEY, board(MAX + 3), reader(stored)) is None   # moved / resized
    assert board_bound.check(KEY, board(MAX + 2), reader(stored)) is None   # one closed
    assert board_bound.check(KEY, board(MAX + 4), reader(stored)) is not None  # cannot grow


def test_an_over_bound_write_cannot_replace_an_unreadable_or_absent_board():
    for stored in ("{not json", '{"widgets": "nope"}', None, ""):
        assert board_bound.check(KEY, board(MAX + 1), reader(stored)) is not None, stored


def test_other_keys_and_values_without_a_widget_list_are_not_this_rules_business():
    assert board_bound.check("chart_settings", board(MAX + 50), reader(None)) is None
    assert board_bound.check(KEY, "{not json", reader(None)) is None
    assert board_bound.check(KEY, "", reader(None)) is None


# ── the real routes ──────────────────────────────────────────────────────────

@pytest.fixture()
def client(monkeypatch):
    from api.services import auth_db

    auth_db.init_db()
    monkeypatch.delenv("WORKSPACE_DOC_STORE_ENABLED", raising=False)
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    c = TestClient(app)
    # A clean board for this member before each test.
    assert c.post("/api/auth/preferences", json={"key": KEY, "value": board(1)}).status_code == 200
    return c


def _stored(c):
    return json.loads(c.get("/api/auth/preferences").json()[KEY])


def test_route_refuses_growth_past_the_bound_and_leaves_the_stored_board_alone(client):
    assert client.post("/api/auth/preferences", json={"key": KEY, "value": board(MAX)}).status_code == 200
    r = client.post("/api/auth/preferences", json={"key": KEY, "value": board(MAX + 1)})
    assert r.status_code == 400
    assert f"at most {MAX} widgets" in r.json()["detail"]
    assert len(_stored(client)["widgets"]) == MAX


def test_route_keeps_an_over_bound_board_whole_and_editable_down(client, monkeypatch):
    # An over-bound board that predates the bound: planted straight into the store, the way
    # it would already exist for a member.
    from api.services import auth_service
    auth_service.set_user_preference(PAID_MEMBER["id"], KEY, board(MAX + 3))
    assert len(_stored(client)["widgets"]) == MAX + 3, "read never truncates"
    assert client.post("/api/auth/preferences", json={"key": KEY, "value": board(MAX + 3)}).status_code == 200
    assert client.post("/api/auth/preferences", json={"key": KEY, "value": board(MAX + 1)}).status_code == 200
    assert client.post("/api/auth/preferences", json={"key": KEY, "value": board(MAX + 2)}).status_code == 400
    assert len(_stored(client)["widgets"]) == MAX + 1


def test_the_workspace_doc_apply_door_enforces_the_same_function():
    src = open(os.path.join(REPO, "api", "routers", "workspace_doc.py"), encoding="utf-8").read()
    assert "enforce_board_bound(uid, key, value)" in src
    auth_src = open(os.path.join(REPO, "api", "routers", "auth.py"), encoding="utf-8").read()
    assert "enforce_board_bound(user[\"id\"], req.key, req.value)" in auth_src
