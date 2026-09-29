"""TERM-021 (FB-S5-01) — the member-facing half: the flag, the preferences write path, and the
document routes (read, history, restore, tombstoned DELETE).

The REAL auth router and the REAL workspace router are mounted on a bare app; only the identity
is substituted (``tests.authclients``' rule). ``user_preferences`` lives in the per-session
sandbox auth.db the repo-root conftest pins; the document store is a file in ``tmp_path``.

⭐ THE FLAG-OFF RAIL IS THE LOAD-BEARING ONE. With ``WORKSPACE_DOC_STORE_ENABLED`` unset, the
preferences write must behave exactly as before this ticket — same response, same stored bytes —
and the document store must not be opened, read or created. Every workspace route answers 404.
"""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services import auth_service
from api.services import workspace_doc_store as wds
from tests.authclients import authorize

CORRUPT = '{"widgets":[{"i":"w1","type":"chart","x":0,"y":0,"w":12,"h'
EMPTY_BOARD = json.dumps({"widgets": [], "cols": 24, "version": 1})
BOARD_ROUTES = [
    ("get", "/api/workspace/doc"),
    ("get", "/api/workspace/doc/versions"),
    ("get", "/api/workspace/doc/versions/1"),
    ("post", "/api/workspace/doc/restore"),
    ("delete", "/api/workspace/doc?base_version=1"),
    ("get", "/api/workspace/doc/health"),
    ("post", "/api/workspace/doc/apply"),
]


def _member():
    return {"id": f"wd-{uuid.uuid4().hex[:12]}", "email": "wd@example.test", "role": "member", "plan": "free"}


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


def _prefs(client):
    r = client.get("/api/auth/preferences")
    assert r.status_code == 200
    return r.json()


# ═══ 1. dark: the existing path is byte-for-byte what it was ══════════════════
def test_flag_off_the_preference_write_path_is_untouched(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    touched = []

    def spy(name):
        def _f(*a, **k):
            touched.append(name)
            raise AssertionError(f"{name} ran while dark")
        return _f

    # ⛔ The hooks swallow exceptions BY DESIGN (a shadow must never fail a member's write), so a
    # raising spy alone would be absorbed and this rail would pass while the store was touched.
    # The spies RECORD, and the record is what is asserted. Mutation-proved (M1).
    monkeypatch.setattr(wds, "_connect", spy("_connect"))
    monkeypatch.setattr(wds, "ensure_snapshot", spy("ensure_snapshot"))
    monkeypatch.setattr(wds, "mirror_pref", spy("mirror_pref"))
    monkeypatch.setattr(wds, "prune_versions", spy("prune_versions"))
    monkeypatch.setattr(wds, "_HOOK_FAILURES", {"snapshot": 0, "mirror": 0})
    for key, value in (("charts_workspace_layout", CORRUPT), ("chart_settings", "{}"), ("theme", "oled")):
        r = client.post("/api/auth/preferences", json={"key": key, "value": value})
        assert (r.status_code, r.json()) == (200, {"ok": True})
    assert touched == [], f"the workspace document store was touched while dark: {touched}"
    assert wds._HOOK_FAILURES == {"snapshot": 0, "mirror": 0}
    assert _prefs(client) == {"charts_workspace_layout": CORRUPT, "chart_settings": "{}", "theme": "oled"}
    assert not store_path.exists()


def test_flag_off_every_workspace_route_is_404_and_creates_nothing(store_path):
    client = _client(_member())
    for method, path in BOARD_ROUTES:
        kw = {"json": {"version": 1, "base_version": 1}} if method == "post" else {}
        r = getattr(client, method)(path, **kw)
        assert r.status_code == 404, (method, path, r.status_code)
    assert not store_path.exists()


def test_the_flag_is_read_per_request(store_path, monkeypatch):
    client = _client(_member())
    assert client.get("/api/workspace/doc").status_code == 404
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    assert client.get("/api/workspace/doc").status_code == 200
    monkeypatch.setenv(wds.ENABLED_ENV, "0")
    assert client.get("/api/workspace/doc").status_code == 404


# ═══ 2. armed: write-both, read-old ══════════════════════════════════════════
def test_armed_a_board_write_is_mirrored_after_a_snapshot_of_what_it_replaces(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    auth_service.set_user_preference(user["id"], "charts_workspace_layout", CORRUPT)   # pre-arming state
    monkeypatch.setenv(wds.ENABLED_ENV, "1")

    r = client.post("/api/auth/preferences", json={"key": "charts_workspace_layout", "value": EMPTY_BOARD})
    assert (r.status_code, r.json()) == (200, {"ok": True})
    # READ-OLD: the member's read is the old store's, unchanged in shape.
    assert _prefs(client)["charts_workspace_layout"] == EMPTY_BOARD

    versions = client.get("/api/workspace/doc/versions").json()["versions"]
    assert [(v["version"], v["source"]) for v in versions] == [(2, "mirror"), (1, "migration")]
    v1 = client.get("/api/workspace/doc/versions/1").json()
    assert v1["doc"]["prefs"]["charts_workspace_layout"] == CORRUPT


def test_acceptance_a_and_b_a_member_restores_the_blob_a_default_board_overwrote(store_path, monkeypatch):
    """STATE-2, end to end: a corrupt blob, a default board autosaved over it, and a restore of
    version N-1 that puts the ORIGINAL BYTES back where the client reads them.
    ⛔ Seen red without the pre-write snapshot: version 1 is then the empty board."""
    user = _member()
    client = _client(user)
    auth_service.set_user_preference(user["id"], "charts_workspace_layout", CORRUPT)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    client.post("/api/auth/preferences", json={"key": "charts_workspace_layout", "value": EMPTY_BOARD})

    doc = client.get("/api/workspace/doc").json()
    assert doc["version"] == 2
    assert doc["parse_failures"] == 1, "a corrupt blob must be COUNTED, not absorbed"

    r = client.post("/api/workspace/doc/restore", json={"version": 1, "base_version": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 3 and body["restored_from"] == 1 and body["complete"] is True
    assert body["prefs_written"] == ["charts_workspace_layout"]
    assert _prefs(client)["charts_workspace_layout"] == CORRUPT


def test_a_restore_on_a_stale_base_is_409_and_changes_nothing(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "a"})
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "b"})
    head = client.get("/api/workspace/doc").json()["version"]
    r = client.post("/api/workspace/doc/restore", json={"version": 1, "base_version": head - 1})
    assert r.status_code == 409
    assert r.json()["detail"]["head_version"] == head
    assert _prefs(client)["charts_theme"] == "b"
    assert client.get("/api/workspace/doc").json()["version"] == head


def test_restoring_a_missing_version_is_404(store_path, monkeypatch):
    client = _client(_member())
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    head = client.get("/api/workspace/doc").json()["version"]
    r = client.post("/api/workspace/doc/restore", json={"version": 99, "base_version": head})
    assert r.status_code == 404


def test_delete_appends_a_tombstone_and_leaves_the_board_and_history_alone(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "a"})
    head = client.get("/api/workspace/doc").json()["version"]

    stale = client.delete(f"/api/workspace/doc?base_version={head - 1}")
    assert stale.status_code == 409
    r = client.delete(f"/api/workspace/doc?base_version={head}")
    assert r.status_code == 200 and r.json()["tombstone"] is True
    # READ-OLD: a document delete does not reach user_preferences in this phase.
    assert _prefs(client)["charts_theme"] == "a"
    got = client.get("/api/workspace/doc/versions").json()["versions"]
    assert got[0]["tombstone"] is True and len(got) == head + 1
    back = client.post("/api/workspace/doc/restore", json={"version": head, "base_version": head + 1})
    assert back.status_code == 200 and back.json()["version"] == head + 2


def test_armed_a_non_board_key_never_creates_a_document(store_path, monkeypatch):
    client = _client(_member())
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    r = client.post("/api/auth/preferences", json={"key": "notebook_tour", "value": "1"})
    assert r.status_code == 200
    assert not store_path.exists()


def test_a_failing_mirror_never_fails_the_members_write(store_path, monkeypatch):
    client = _client(_member())
    monkeypatch.setenv(wds.ENABLED_ENV, "1")

    def boom(*a, **k):
        raise RuntimeError("shadow down")

    monkeypatch.setattr(wds, "ensure_snapshot", boom)
    monkeypatch.setattr(wds, "mirror_pref", boom)
    r = client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "z"})
    assert (r.status_code, r.json()) == (200, {"ok": True})
    assert _prefs(client)["charts_theme"] == "z"


def test_a_refused_preference_write_mirrors_nothing(store_path, monkeypatch):
    """The allow-list refuses first; a refused write must not become a version."""
    client = _client(_member())
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    r = client.post("/api/auth/preferences", json={"key": "not_a_key", "value": "x"})
    assert r.status_code == 400
    assert not store_path.exists()


def test_health_is_admin_only(store_path, monkeypatch):
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    assert _client(_member()).get("/api/workspace/doc/health").status_code == 403
    admin = {"id": "wd-admin", "email": "a@example.test", "role": "admin", "plan": "free"}
    r = _client(admin).get("/api/workspace/doc/health")
    assert r.status_code == 200 and "parse_failures" in r.json()


def test_the_workspace_router_is_mounted_on_the_real_app():
    """By the route table, not by grep: include_router must survive merges."""
    import ast
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    mounted = {ast.unparse(n.args[0]) for n in ast.walk(tree)
               if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "include_router" and n.args}
    assert "workspace_doc_router.router" in mounted
    # Control: the same walk sees a router known to be mounted.
    assert "charts_layouts_router.router" in mounted


# ═══ 3. READ-NEW: the member's read comes from the document ══════════════════
# The read-new phase: GET /api/auth/preferences reads the board's keys from the document head,
# a template apply is ONE document write, and a crash in the middle of one cannot leave a
# half-applied board. Flag off, the read is byte-for-byte what it was.
from api.routers import workspace_doc as workspace_doc_router   # noqa: E402

LAYOUT_T = json.dumps({"widgets": [{"id": "t1", "type": "scanner", "x": 0, "y": 0, "w": 24, "h": 20}],
                       "cols": 24, "version": 1})
TEMPLATE = {                                   # what applyTemplate sends for a prebuilt layout
    "charts_workspace_layout": LAYOUT_T,
    "watchlist_settings": '{"canvas":"#000"}',
    "theme_tracker_settings": '{"canvas":"#111"}',
    "fundamentals_settings": '{"canvas":"#222"}',
    "breadth_widget_settings": '{"canvas":"#333"}',
    "watchlist_columns": "",
    "chart_settings": '{"settingsVersion":2}',
    "charts_theme": "default",
    "charts_vol_pane_pct": "",
    "charts_active_template": '{"id":7,"name":"Scanner","scope":"global"}',
}
BEFORE = {k: f"before-{k}" for k in TEMPLATE}


def _raw_prefs(uid):
    return auth_service.get_user_preferences(uid)


def _seed(uid, values):
    for k, v in values.items():
        auth_service.set_user_preference(uid, k, v)


def test_flag_off_the_preference_READ_is_byte_identical_and_carries_no_header(store_path, monkeypatch):
    """⭐ The load-bearing rail for this phase. The CONTROL is the handler exactly as it was
    (`return get_user_preferences(user["id"])`), mounted on its own app: same bytes, same
    content type, no X-Workspace-Doc — and the store is never opened, read or created."""
    user = _member()
    client = _client(user)
    _seed(user["id"], {"charts_workspace_layout": CORRUPT, "chart_settings": '{"u":"é☃"}',
                       "charts_vol_pane_pct": "", "theme": "oled"})

    from fastapi import APIRouter, Depends
    from api.middleware.auth_middleware import get_current_user
    legacy = APIRouter()

    @legacy.get("/api/auth/preferences")
    def _legacy(user: dict = Depends(get_current_user)):
        return auth_service.get_user_preferences(user["id"])

    control_app = FastAPI()
    control_app.include_router(legacy)
    authorize(control_app, user)
    control = TestClient(control_app).get("/api/auth/preferences")

    touched = []
    monkeypatch.setattr(wds, "_connect", lambda *a, **k: touched.append("_connect"))
    r = client.get("/api/auth/preferences")
    assert r.status_code == control.status_code == 200
    assert r.content == control.content
    assert r.headers["content-type"] == control.headers["content-type"]
    assert "x-workspace-doc" not in {h.lower() for h in r.headers}
    assert touched == [] and not store_path.exists()


def test_armed_every_read_says_which_store_answered(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    _seed(user["id"], {"charts_theme": "tv"})
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    r = client.get("/api/auth/preferences")
    assert r.json() == {"charts_theme": "tv"}
    assert r.headers["x-workspace-doc"] == "fallback; reason=absent"      # never a silent default
    client.get("/api/workspace/doc")                                       # the migration copy
    r = client.get("/api/auth/preferences")
    assert r.json() == {"charts_theme": "tv"} and r.headers["x-workspace-doc"] == "document; v=1"


def _apply(client, prefs, base=None):
    if base is None:
        base = client.get("/api/workspace/doc").json()["version"]
    return client.post("/api/workspace/doc/apply", json={"base_version": base, "prefs": prefs})


def test_apply_is_ONE_version_and_the_member_reads_every_key(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    _seed(user["id"], {**BEFORE, "charts_workspace_groups": '{"A":"NVDA"}'})
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    base = client.get("/api/workspace/doc").json()["version"]
    r = _apply(client, TEMPLATE, base)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == base + 1 and body["appended"] and body["complete"] is True
    assert body["prefs_written"] == sorted(TEMPLATE)
    versions = client.get("/api/workspace/doc/versions").json()["versions"]
    assert [(v["version"], v["source"]) for v in versions] == [(base + 1, "write"), (base, "migration")]
    got = client.get("/api/auth/preferences").json()
    assert {k: got[k] for k in TEMPLATE} == TEMPLATE
    assert got["charts_workspace_groups"] == '{"A":"NVDA"}'   # a key the template did not name
    assert wds.outstanding_writebacks(user["id"]) == {}


def test_a_crash_mid_apply_cannot_leave_a_half_applied_board(store_path, monkeypatch):
    """The process dies after the document version is appended and after TWO of the ten
    user_preferences writes. The member's next read is the WHOLE template — never five of one
    board and five of another — and that read finishes the write-back.
    ⛔ Seen red three ways: no pending row in the version's transaction, the document not
    winning for a covered key, and the apply appended one key at a time."""
    user = _member()
    uid = user["id"]
    client = _client(user)
    _seed(uid, BEFORE)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")

    def dies_after_two(uid_, values):
        for key in sorted(values)[:2]:
            auth_service.set_user_preference(uid_, key, values[key])
        raise RuntimeError("the web pod was killed mid-apply")

    monkeypatch.setattr(workspace_doc_router, "_write_back", dies_after_two)
    with pytest.raises(RuntimeError, match="killed mid-apply"):
        _apply(client, TEMPLATE)
    raw = _raw_prefs(uid)
    assert sum(raw[k] == TEMPLATE[k] for k in TEMPLATE) == 2, "the old store IS half-applied"

    r = client.get("/api/auth/preferences")
    assert {k: r.json()[k] for k in TEMPLATE} == TEMPLATE, "the member reads the whole template"
    assert r.headers["x-workspace-doc"].startswith("document; v=")
    assert "doc_newer=" in r.headers["x-workspace-doc"]
    # ...and that read finished the job: the old store now agrees, the ledger is closed.
    assert {k: _raw_prefs(uid)[k] for k in TEMPLATE} == TEMPLATE
    assert wds.outstanding_writebacks(uid) == {}
    assert client.get("/api/auth/preferences").headers["x-workspace-doc"].count(";") == 1


def test_CONTROL_the_legacy_per_key_path_DOES_half_apply_on_the_same_crash(store_path):
    """Flag off, a template apply is ten separate writes. The same crash after two leaves the
    member reading a board that is two parts template and eight parts the old one — the failure
    the test above proves the document path cannot have. (It can tell the two apart.)"""
    user = _member()
    uid = user["id"]
    client = _client(user)
    _seed(uid, BEFORE)
    for key in sorted(TEMPLATE)[:2]:
        client.post("/api/auth/preferences", json={"key": key, "value": TEMPLATE[key]})
    got = client.get("/api/auth/preferences").json()
    assert sum(got[k] == TEMPLATE[k] for k in TEMPLATE) == 2


def test_a_failed_writeback_key_is_named_and_the_member_still_reads_every_key(store_path, monkeypatch):
    user = _member()
    uid = user["id"]
    client = _client(user)
    _seed(uid, BEFORE)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    real = auth_service.set_user_preference

    def flaky(uid_, key, value):
        if key == "chart_settings":
            raise RuntimeError("database is locked")
        return real(uid_, key, value)

    monkeypatch.setattr(auth_service, "set_user_preference", flaky)
    r = _apply(client, TEMPLATE)
    assert r.status_code == 200
    assert r.json()["prefs_failed"] == ["chart_settings"] and r.json()["complete"] is False
    monkeypatch.setattr(auth_service, "set_user_preference", real)
    assert client.get("/api/auth/preferences").json()["chart_settings"] == TEMPLATE["chart_settings"]
    assert _raw_prefs(uid)["chart_settings"] == TEMPLATE["chart_settings"]   # completed by the read
    assert wds.outstanding_writebacks(uid) == {}


def test_apply_on_a_stale_base_is_409_and_writes_nothing_to_either_store(store_path, monkeypatch):
    user = _member()
    uid = user["id"]
    client = _client(user)
    _seed(uid, BEFORE)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    base = client.get("/api/workspace/doc").json()["version"]
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "another-tab"})
    r = _apply(client, TEMPLATE, base)
    assert r.status_code == 409
    assert r.json()["detail"] == {"error": "version_conflict", "base_version": base, "head_version": base + 1}
    assert _raw_prefs(uid) == {**BEFORE, "charts_theme": "another-tab"}
    assert client.get("/api/workspace/doc").json()["version"] == base + 1
    assert wds.outstanding_writebacks(uid) == {}


@pytest.mark.parametrize("prefs, why", [
    ({"theme": "oled"}, "outside the board"),          # an allowed preference, not a board key
    ({"not_a_key": "x"}, "Unknown preference key"),    # refused by the old endpoint's own allow-list
    ({}, "Nothing to apply"),
])
def test_apply_refuses_what_it_cannot_version_and_writes_nothing(store_path, monkeypatch, prefs, why):
    user = _member()
    client = _client(user)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    r = client.post("/api/workspace/doc/apply", json={"base_version": 0, "prefs": prefs})
    assert r.status_code == 400 and why in r.text
    assert _raw_prefs(user["id"]) == {}
    assert not store_path.exists() or wds.head(user["id"]) is None


def test_a_restore_closes_its_writeback(store_path, monkeypatch):
    user = _member()
    client = _client(user)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "a"})
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "b"})
    head = client.get("/api/workspace/doc").json()["version"]
    assert client.post("/api/workspace/doc/restore", json={"version": head - 1, "base_version": head}).status_code == 200
    assert wds.outstanding_writebacks(user["id"]) == {}
    assert _prefs(client)["charts_theme"] == "a"


def test_rearming_after_a_write_made_while_dark_serves_that_write(store_path, monkeypatch):
    """Disarming is a flag flip; so is re-arming. A board write made while dark reaches only
    user_preferences, so on re-arm the document is BEHIND — and must not win."""
    user = _member()
    client = _client(user)
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "armed"})
    monkeypatch.setenv(wds.ENABLED_ENV, "0")
    client.post("/api/auth/preferences", json={"key": "charts_theme", "value": "while-dark"})
    monkeypatch.setenv(wds.ENABLED_ENV, "1")
    r = client.get("/api/auth/preferences")
    assert r.json()["charts_theme"] == "while-dark"
    assert r.headers["x-workspace-doc"].endswith("old_newer=charts_theme")
    doc = client.get("/api/workspace/doc").json()
    assert doc["doc"]["prefs"]["charts_theme"] == "while-dark" and doc["source"] == "mirror"
