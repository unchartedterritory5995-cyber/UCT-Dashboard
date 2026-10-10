"""TERMINAL-NEXT lane T2 (V2) — the UCT Terminal's layout on the TERM-021 versioned store.

``terminal_layout`` used to live ONLY in ``user_preferences`` (no history, no restore: a bad blob
silently became the default board). It is now the second board of the TERM-021 workspace-doc
store, ``terminal``, under the SAME flag and the same write-both / read-new rules as Charts:

  * a terminal key written through ``POST /api/auth/preferences`` is mirrored into the
    ``terminal`` board's document — never into the Charts one, and a Charts key never lands here;
  * the value a write replaces survives as the version before it (an unreadable layout is not
    lost when the shell writes over it), and ``/api/workspace/doc/restore?board=terminal``
    brings it back;
  * read-new serves the terminal keys from the document head, stamped in its OWN header, and the
    Charts header is unchanged.

The real auth + workspace routers on a bare app, identity substituted (``tests.authclients``).
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services import workspace_doc_store as wds
from tests.authclients import authorize

REPO = Path(__file__).resolve().parents[1]
# The key constants moved out of useTerminalLayout.js into boardPrefs.js (2143e1378).
LAYOUT_HOOK = REPO / "app" / "src" / "pages" / "terminal" / "boardPrefs.js"
UNREADABLE = '{"v":2,"count":4,"panels":[{"id":"p1","code":"GP"'      # truncated mid-write
GOOD = json.dumps({"v": 2, "count": 1, "focus": 0, "panels": [{"id": "p1", "code": "GP", "channel": "A"}]})


def _member():
    return {"id": f"t2-{uuid.uuid4().hex[:12]}", "email": "t2@example.test", "role": "member", "plan": "free"}


@pytest.fixture
def store_path(tmp_path, monkeypatch):
    monkeypatch.setattr(wds, "_DB_PATH", str(tmp_path / "workspace_docs.db"))
    monkeypatch.delenv(wds.ENABLED_ENV, raising=False)
    return tmp_path / "workspace_docs.db"


def _client(user):
    from api.routers import workspace_doc
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    app.include_router(workspace_doc.router)
    authorize(app, user)
    return TestClient(app)


def _post(client, key, value):
    r = client.post("/api/auth/preferences", json={"key": key, "value": value})
    assert (r.status_code, r.json()) == (200, {"ok": True}), r.text


# ═══ 1. the key set is the client's, both directions ═════════════════════════
def test_the_terminal_key_set_is_exactly_what_the_shell_persists():
    src = LAYOUT_HOOK.read_text(encoding="utf-8")
    derived = set(re.findall(r"export const TERMINAL_[A-Z_]+_PREF\s*=\s*'([a-z_]+)'", src))
    assert {"terminal_layout", "terminal_boards"} <= derived      # non-vacuity: the scan found them
    assert derived == set(wds.TERMINAL_PREF_KEYS), (
        f"client persists but store lacks: {sorted(derived - wds.TERMINAL_PREF_KEYS)}; "
        f"store lists but client never persists: {sorted(wds.TERMINAL_PREF_KEYS - derived)}")


def test_every_terminal_key_is_one_the_preferences_endpoint_accepts():
    assert set(wds.TERMINAL_PREF_KEYS) <= set(auth_router._PREFERENCE_KEYS)


def test_a_key_belongs_to_exactly_one_board():
    assert not (wds.TERMINAL_PREF_KEYS & wds.WORKSPACE_PREF_KEYS)
    assert wds.board_for_key("terminal_layout") == wds.BOARD_TERMINAL
    assert wds.board_for_key("charts_workspace_layout") == wds.BOARD_CHARTS
    assert wds.board_for_key("theme") is None


def test_a_document_cannot_carry_the_other_boards_key(store_path):
    with pytest.raises(wds.InvalidDocument):
        wds.validate_doc({"schema_version": 1, "board": "terminal",
                          "prefs": {"charts_workspace_layout": "{}"}}, "terminal")
    with pytest.raises(wds.InvalidDocument):
        wds.validate_doc({"schema_version": 1, "board": "charts",
                          "prefs": {"terminal_layout": "{}"}}, "charts")


# ═══ 2. dark: nothing is touched ═════════════════════════════════════════════
def test_flag_off_a_terminal_write_touches_no_store(store_path):
    client = _client(_member())
    _post(client, "terminal_layout", GOOD)
    r = client.get("/api/auth/preferences")
    assert r.json()["terminal_layout"] == GOOD
    assert "X-Workspace-Doc-Terminal" not in r.headers
    assert not store_path.exists()


# ═══ 3. armed: write-both, versioned, restorable ═════════════════════════════
def test_armed_an_unreadable_layout_survives_the_write_over_it_and_restores(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    _post(client, "terminal_layout", UNREADABLE)          # written while dark: only user_preferences
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    _post(client, "terminal_layout", GOOD)                # the shell writes over it, armed

    hist = client.get("/api/workspace/doc/versions?board=terminal").json()["versions"]
    assert [v["source"] for v in hist] == ["mirror", "migration"]
    def body(v):
        return client.get(f"/api/workspace/doc/versions/{v}?board=terminal").json()["doc"]["prefs"]
    assert body(hist[1]["version"])["terminal_layout"] == UNREADABLE     # kept VERBATIM as N-1
    assert body(hist[0]["version"])["terminal_layout"] == GOOD

    r = client.post("/api/workspace/doc/restore",
                    json={"board": "terminal", "version": 1, "base_version": hist[0]["version"]})
    assert r.status_code == 200, r.text
    assert r.json()["prefs_written"] == ["terminal_layout"]
    assert client.get("/api/auth/preferences").json()["terminal_layout"] == UNREADABLE


def test_armed_terminal_and_charts_versions_never_mix(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    _post(client, "terminal_layout", GOOD)
    _post(client, "terminal_boards", '{"v":1,"boards":[]}')
    _post(client, "charts_theme", "oled")
    term = client.get("/api/workspace/doc?board=terminal").json()
    charts = client.get("/api/workspace/doc?board=charts").json()
    assert set(term["doc"]["prefs"]) == {"terminal_layout", "terminal_boards"}
    assert set(charts["doc"]["prefs"]) == {"charts_theme"}
    assert term["doc"]["board"] == "terminal" and charts["doc"]["board"] == "charts"


def test_armed_read_new_stamps_the_terminal_board_in_its_own_header(store_path, monkeypatch):
    client = _client(_member())
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    _post(client, "terminal_layout", GOOD)
    r = client.get("/api/auth/preferences")
    assert r.json()["terminal_layout"] == GOOD
    assert r.headers["X-Workspace-Doc-Terminal"].startswith("document; v=")
    # The Charts board has no document yet: ITS header says so, unchanged in meaning.
    assert r.headers["X-Workspace-Doc"] == "fallback; reason=absent"


def test_armed_read_new_serves_the_terminal_document_over_a_stale_old_store(store_path, monkeypatch):
    """An interrupted restore write-back: the document is ahead, and read-new serves it."""
    user = _member()
    client = _client(user)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    _post(client, "terminal_layout", GOOD)
    head = client.get("/api/workspace/doc?board=terminal").json()["version"]
    newer = json.dumps({"v": 2, "count": 2, "focus": 1, "panels": []})
    wds.apply_patch(user["id"], "terminal", {"terminal_layout": newer}, base_version=head,
                    prefs_reader=lambda uid: {})      # the user_preferences half never ran
    assert client.get("/api/auth/preferences").json()["terminal_layout"] == newer
