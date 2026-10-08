"""REVISION SAFETY — an older tab or device must never overwrite newer workspace work.

The REAL auth router (``POST/GET /api/auth/preferences``) and the REAL workspace-document store
(a SQLite file in ``tmp_path``) — only the identity is substituted. Every board-key write from a
revision-aware client names the document version at which it last saw that key; the server
commits it only if the key is unchanged since then, in ONE ``BEGIN IMMEDIATE`` transaction.

Matrix (owner brief): A two tabs · B simultaneous (threads AND processes) · C rapid edits ·
D delayed request · E/F active layout + board · I lost response · J existing records / old
clients · K member isolation · L indicator settings survive.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services import auth_service
from api.services import workspace_doc_store as wds
from tests.authclients import authorize

LAYOUT = "charts_workspace_layout"
ACTIVE = "charts_active_template"
SETTINGS = "chart_settings"


def board(*ids):
    return json.dumps({"version": 2, "cols": 24, "widgets": [
        {"id": i, "type": "chart", "x": 0, "y": 0, "w": 12, "h": 20, "color": "A", "opts": {}} for i in ids]})


def _member():
    return {"id": f"rv-{uuid.uuid4().hex[:12]}", "email": "rv@example.test", "role": "member", "plan": "free"}


@pytest.fixture
def armed(tmp_path, monkeypatch):
    path = tmp_path / "workspace_docs.db"
    monkeypatch.setattr(wds, "_DB_PATH", str(path))
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    return path


def _client(user):
    from api.services import auth_db
    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, user)
    return TestClient(app)


def _read(client):
    """A tab loading: the prefs it shows and the revision the server says they are."""
    r = client.get("/api/auth/preferences")
    assert r.status_code == 200
    stamp = r.headers.get("X-Workspace-Doc") or ""
    m = re.search(r"\bv=(\d+)", stamp)
    return r.json(), (int(m.group(1)) if m else 0)


def _write(client, key, value, base):
    body = {"key": key, "value": value}
    if base is not None:
        body["base_version"] = base
    return client.post("/api/auth/preferences", json=body)


def _seed(user, client, **prefs):
    for k, v in prefs.items():
        auth_service.set_user_preference(user["id"], k, v)


# ═══ A. two tabs, same workspace ══════════════════════════════════════════════
def test_A_stale_tab_cannot_overwrite_the_newer_board_and_nothing_is_written(armed):
    user = _member()
    tab_a, tab_b = _client(user), _client(user)
    _seed(user, tab_a, **{LAYOUT: board("w1")})
    _, rev_a = _read(tab_a)
    _, rev_b = _read(tab_b)
    assert rev_a == rev_b
    ok = _write(tab_a, LAYOUT, board("w1", "w2"), rev_a)
    assert ok.status_code == 200 and ok.json()["version"] > rev_a
    stale = _write(tab_b, LAYOUT, board("old"), rev_b)
    assert stale.status_code == 409
    d = stale.json()["detail"]
    assert d["code"] == "workspace_conflict" and d["key"] == LAYOUT
    assert set(d) == {"code", "key", "head_version", "message"}          # nothing else (no other member data)
    assert auth_service.get_user_preferences(user["id"])[LAYOUT] == board("w1", "w2")
    prefs, rev = _read(tab_a)
    assert prefs[LAYOUT] == board("w1", "w2") and rev == ok.json()["version"]   # both stores, unchanged by the refusal


def test_A_an_unrelated_key_from_the_other_tab_still_saves(armed):
    """Per key: a theme change in one tab does not refuse a board move in another."""
    user = _member()
    tab_a, tab_b = _client(user), _client(user)
    _seed(user, tab_a, **{LAYOUT: board("w1"), SETTINGS: json.dumps({"bg": "#000"})})
    _, rev = _read(tab_a)
    _read(tab_b)
    assert _write(tab_a, LAYOUT, board("w1", "w2"), rev).status_code == 200
    r = _write(tab_b, SETTINGS, json.dumps({"bg": "#fff"}), rev)
    assert r.status_code == 200
    p = auth_service.get_user_preferences(user["id"])
    assert p[LAYOUT] == board("w1", "w2") and json.loads(p[SETTINGS]) == {"bg": "#fff"}


# ═══ B. two simultaneous requests with the same base — exactly one commits ════
def test_B_concurrent_threads_same_base_exactly_one_commits(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _, rev = _read(c)
    results = []
    gate = threading.Barrier(8)

    def go(i):
        gate.wait()
        try:
            results.append(("ok", wds.write_pref_checked(user["id"], LAYOUT, board(f"t{i}"), base_version=rev,
                                                         prefs_reader=auth_service.get_user_preferences)))
        except wds.VersionConflict:
            results.append(("conflict", None))

    ts = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert sum(1 for r in results if r[0] == "ok") == 1
    assert sum(1 for r in results if r[0] == "conflict") == 7


_PROC = r"""
import os, sys, time, json
sys.path.insert(0, sys.argv[1])
from api.services import workspace_doc_store as wds
wds._DB_PATH = sys.argv[2]
start = float(sys.argv[5])
while time.time() < start:
    time.sleep(0.001)
try:
    wds.write_pref_checked(sys.argv[3], "charts_workspace_layout", sys.argv[4], base_version=int(sys.argv[6]),
                           prefs_reader=lambda u: {})
    print("ok")
except wds.VersionConflict:
    print("conflict")
"""


def test_B_concurrent_PROCESSES_same_base_exactly_one_commits(armed, tmp_path):
    """No shared in-process lock: separate OS processes on the same SQLite file. The compare and
    the append are one transaction, so exactly one wins."""
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _, rev = _read(c)
    script = tmp_path / "w.py"
    script.write_text(_PROC)
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    start = time.time() + 2.5
    procs = [subprocess.Popen([sys.executable, str(script), repo, str(armed), user["id"], board(f"p{i}"),
                               str(start), str(rev)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
             for i in range(4)]
    outs = [p.communicate(timeout=60)[0].strip() for p in procs]
    assert sorted(outs) == ["conflict", "conflict", "conflict", "ok"], outs


# ═══ C. rapid edits in one tab — no self-conflict ═════════════════════════════
def test_C_rapid_sequential_edits_from_one_tab_all_save_and_the_last_persists(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _, rev = _read(c)
    for i in range(12):
        r = _write(c, LAYOUT, board(f"w{i}"), rev)
        assert r.status_code == 200, r.text
        rev = r.json()["version"]
    assert auth_service.get_user_preferences(user["id"])[LAYOUT] == board("w11")


def test_C_one_tab_writing_DIFFERENT_keys_concurrently_never_conflicts_with_itself(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0"), SETTINGS: "{}"})
    _, rev = _read(c)
    assert _write(c, LAYOUT, board("w1"), rev).status_code == 200
    assert _write(c, SETTINGS, json.dumps({"x": 1}), rev).status_code == 200   # still the base it read


# ═══ D. a delayed older request lands after a newer one ═══════════════════════
def test_D_an_older_request_arriving_late_cannot_overwrite_the_newer_state(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _, rev = _read(c)
    newer = _write(c, LAYOUT, board("newer"), rev)
    assert newer.status_code == 200
    late = _write(c, LAYOUT, board("older"), rev)                     # sent first, arrived second
    assert late.status_code == 409
    assert auth_service.get_user_preferences(user["id"])[LAYOUT] == board("newer")


# ═══ E/F. layout switch elsewhere; the active-layout pointer ══════════════════
def test_EF_a_layout_switch_in_another_tab_refuses_the_stale_tabs_board_and_pointer(armed):
    user = _member()
    tab_a, tab_b = _client(user), _client(user)
    _seed(user, tab_a, **{LAYOUT: board("a1"), ACTIVE: json.dumps({"id": 1, "name": "A", "scope": "user"})})
    _, rev = _read(tab_a)
    _read(tab_b)
    # Tab A opens layout B: the pointer and the board both change.
    r1 = _write(tab_a, ACTIVE, json.dumps({"id": 2, "name": "B", "scope": "user"}), rev)
    r2 = _write(tab_a, LAYOUT, board("b1"), rev)
    assert r1.status_code == 200 and r2.status_code == 200
    # Tab B, still showing layout A, autosaves its board and re-opens A.
    assert _write(tab_b, LAYOUT, board("a1", "a2"), rev).status_code == 409
    assert _write(tab_b, ACTIVE, json.dumps({"id": 1, "name": "A", "scope": "user"}), rev).status_code == 409
    p = auth_service.get_user_preferences(user["id"])
    assert p[LAYOUT] == board("b1") and json.loads(p[ACTIVE])["id"] == 2


# ═══ I. the write committed but the response was lost ═════════════════════════
def test_I_a_retry_of_a_committed_write_succeeds_without_a_new_version(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _, rev = _read(c)
    first = _write(c, LAYOUT, board("w1"), rev)
    assert first.status_code == 200
    retry = _write(c, LAYOUT, board("w1"), rev)                       # the client never saw `first`
    assert retry.status_code == 200 and retry.json()["version"] == first.json()["version"]
    # …but a retry of something ELSE from that stale base is still refused.
    assert _write(c, LAYOUT, board("w2"), rev).status_code == 409


# ═══ J. existing records and old clients ══════════════════════════════════════
def test_J_a_member_with_no_document_yet_saves_and_keeps_every_existing_key(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0"), SETTINGS: json.dumps({"keep": True})})
    assert wds.head(user["id"]) is None
    prefs, rev = _read(c)
    assert rev == 0 and prefs[LAYOUT] == board("w0")                  # served from the old store
    r = _write(c, LAYOUT, board("w1"), rev)
    assert r.status_code == 200
    p = auth_service.get_user_preferences(user["id"])
    assert p[LAYOUT] == board("w1") and json.loads(p[SETTINGS]) == {"keep": True}
    h = wds.head(user["id"])
    assert wds.prefs_from_doc(h["doc"])[SETTINGS] == json.dumps({"keep": True})


def test_J_old_bundle_without_a_revision_keeps_working_until_a_revision_aware_client_writes_that_key(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0"), SETTINGS: "{}"})
    assert _write(c, LAYOUT, board("old1"), None).status_code == 200            # legacy: unguarded key
    _, rev = _read(c)
    assert _write(c, LAYOUT, board("new"), rev).status_code == 200              # a revision-aware tab
    r = _write(c, LAYOUT, board("old2"), None)                                  # the old tab, again
    assert r.status_code == 409 and r.json()["detail"]["code"] == "workspace_revision_required"
    assert auth_service.get_user_preferences(user["id"])[LAYOUT] == board("new")
    assert _write(c, SETTINGS, json.dumps({"y": 1}), None).status_code == 200  # an untouched key still saves


def test_J_a_template_apply_protects_its_keys_from_old_bundles(armed):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _read(c)
    h = wds.head(user["id"])
    base = h["version"] if h else 0
    wds.apply_patch(user["id"], wds.BOARD_CHARTS, {LAYOUT: board("tpl")}, base_version=base,
                    prefs_reader=auth_service.get_user_preferences)
    assert wds.key_is_guarded(user["id"], LAYOUT)
    assert _write(c, LAYOUT, board("old"), None).status_code == 409


def test_J_flag_off_the_revision_is_ignored_and_the_write_path_is_the_old_one(tmp_path, monkeypatch):
    monkeypatch.setattr(wds, "_DB_PATH", str(tmp_path / "workspace_docs.db"))
    monkeypatch.delenv(wds.ENABLED_ENV, raising=False)
    user = _member()
    c = _client(user)
    r = _write(c, LAYOUT, board("w1"), 7)
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert not (tmp_path / "workspace_docs.db").exists()


# ═══ K. member isolation ══════════════════════════════════════════════════════
def test_K_one_member_cannot_touch_another_members_board_or_revision(armed):
    alice, bob = _member(), _member()
    ca, cb = _client(alice), _client(bob)
    _seed(alice, ca, **{LAYOUT: board("alice")})
    _, rev_a = _read(ca)
    assert _write(ca, LAYOUT, board("alice2"), rev_a).status_code == 200
    # Bob replays Alice's revision: it only ever addresses Bob's own document.
    r = _write(cb, LAYOUT, board("bob"), rev_a)
    assert r.status_code in (200, 409)
    assert auth_service.get_user_preferences(alice["id"])[LAYOUT] == board("alice2")
    assert wds.prefs_from_doc(wds.head(alice["id"])["doc"])[LAYOUT] == board("alice2")
    if r.status_code == 409:
        assert "alice" not in json.dumps(r.json())


# ═══ L. indicator settings survive writes, conflicts and reloads unchanged ════
def test_L_chart_settings_with_indicator_instances_round_trip_byte_for_byte(armed):
    user = _member()
    tab_a, tab_b = _client(user), _client(user)
    blob = json.dumps({"indicatorInstances": [{"id": "i1", "defId": "rsi", "params": {"period": 28},
                                               "display": {"pane": "new", "color": "#f3efe4"}}],
                       "paneOrder": ["main", "i1"], "paneSizes": {"i1": 0.25}})
    _seed(user, tab_a, **{SETTINGS: blob})
    _, rev = _read(tab_a)
    _read(tab_b)
    assert _write(tab_a, LAYOUT, board("w1"), rev).status_code == 200            # an unrelated board save
    assert _write(tab_b, SETTINGS, json.dumps({"indicatorInstances": []}), rev).status_code == 200
    p, rev2 = _read(tab_a)
    # tab B's write was a legitimate edit of an unchanged key; now a stale write of it is refused
    assert _write(tab_a, SETTINGS, blob, rev).status_code == 409
    assert p[SETTINGS] == json.dumps({"indicatorInstances": []})
    assert _write(tab_a, SETTINGS, blob, rev2).status_code == 200
    assert auth_service.get_user_preferences(user["id"])[SETTINGS] == blob       # byte-for-byte


def test_B_concurrent_PROCESSES_on_an_EXISTING_document_exactly_one_commits(armed, tmp_path):
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _, rev0 = _read(c)
    rev = _write(c, LAYOUT, board("w1"), rev0).json()["version"]       # a live, versioned document
    script = tmp_path / "w.py"
    script.write_text(_PROC)
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    start = time.time() + 2.5
    procs = [subprocess.Popen([sys.executable, str(script), repo, str(armed), user["id"], board(f"q{i}"),
                               str(start), str(rev)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
             for i in range(5)]
    outs = [p.communicate(timeout=60)[0].strip() for p in procs]
    assert sorted(outs) == ["conflict"] * 4 + ["ok"], outs


def test_retention_runs_on_the_checked_write_path(armed, monkeypatch):
    """The history grows on this path now, so it is bounded on this path (as the mirror is)."""
    calls = []
    real = wds.prune_versions
    monkeypatch.setattr(wds, "prune_versions", lambda *a, **k: calls.append(a) or real(*a, **k))
    user = _member()
    c = _client(user)
    _seed(user, c, **{LAYOUT: board("w0")})
    _, rev = _read(c)
    assert _write(c, LAYOUT, board("w1"), rev).status_code == 200
    assert calls and calls[-1][0] == user["id"]
