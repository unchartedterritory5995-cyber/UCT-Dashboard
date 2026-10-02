"""COV-06 — version history on saved screens and named layouts (``ARTIFACT_VERSIONS_ENABLED``).

REAL stores, seeded through their own write functions: the sandbox auth.db the repo-root conftest
pins (``screener_saved_screens``), a ``charts_layouts.db`` and a ``workspace_docs.db`` in
``tmp_path``. The REAL router is mounted on a bare app; only the identity is substituted
(``tests.authclients``).

⭐ THE DARK RAIL IS THE LOAD-BEARING ONE: unset, a save must not open the version store at all,
and every route answers 404.
"""
from __future__ import annotations

import ast
import json
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import artifact_versions as av
from api.services import charts_layout_service as layouts
from api.services import workspace_doc_store as wds
from api.services.screener import saved_screens
from tests.authclients import authorize

REPO = Path(__file__).resolve().parents[1]


def _paid():
    return {"id": f"av-{uuid.uuid4().hex[:10]}", "email": "av@example.test", "role": "member", "plan": "pro"}


@pytest.fixture
def stores(tmp_path, monkeypatch):
    from api.services import auth_db

    auth_db.init_db()
    saved_screens.init()
    monkeypatch.setattr(layouts, "_DB_PATH", str(tmp_path / "charts_layouts.db"))
    layouts._init_db()
    monkeypatch.setattr(wds, "_DB_PATH", str(tmp_path / "workspace_docs.db"))
    monkeypatch.delenv(av.ENABLED_ENV, raising=False)
    clock = {"t": 1_800_000_000}
    monkeypatch.setattr(av, "_clock", lambda: clock["t"])
    monkeypatch.setattr(av, "_HOOK_FAILURES", {"record": 0})
    return {"versions_db": tmp_path / "workspace_docs.db", "clock": clock}


@pytest.fixture
def armed(stores, monkeypatch):
    monkeypatch.setenv(av.ENABLED_ENV, "1")
    return stores


def _client(user):
    from api.routers import artifact_versions

    app = FastAPI()
    app.include_router(artifact_versions.router)
    authorize(app, user)
    return TestClient(app)


def _spec(n):
    return {"filters": [{"key": "rs_rank", "op": "gte", "min": n}], "view": "technical"}


def _layout(n):
    return {"widgets": [{"i": f"w{k}", "type": "chart"} for k in range(n)], "cols": 24}


def _tick(stores, seconds=120):
    stores["clock"]["t"] += seconds


# ═══ 1. dark ═════════════════════════════════════════════════════════════════
def test_dark_saves_never_open_the_version_store_and_routes_are_404(stores, monkeypatch):
    opened = []
    monkeypatch.setattr(av, "_connect", lambda: opened.append("_connect") or (_ for _ in ()).throw(AssertionError))
    user = _paid()
    rec = saved_screens.create(user["id"], "Leaders", _spec(90))
    rec2 = saved_screens.update(rec["id"], user["id"], spec=_spec(80), name="Leaders 80")
    assert rec2["spec"] == _spec(80) and rec2["name"] == "Leaders 80"
    row = layouts.upsert("user", user["id"], "Board", _layout(2), None, "t")
    layouts.upsert("user", user["id"], "Board", _layout(3), None, "t")
    assert opened == []
    assert not stores["versions_db"].exists()
    c = _client(user)
    for method, path in (("get", "/api/artifact-versions/status"),
                         ("get", f"/api/artifact-versions/screen/{rec['id']}"),
                         ("get", f"/api/artifact-versions/screen/{rec['id']}/1"),
                         ("post", f"/api/artifact-versions/screen/{rec['id']}/restore"),
                         ("get", f"/api/artifact-versions/layout/{row['id']}"),
                         ("post", f"/api/artifact-versions/layout/{row['id']}/restore")):
        kw = {"json": {"version": 1, "base_version": 1}} if method == "post" else {}
        assert getattr(c, method)(path, **kw).status_code == 404, path
    assert not stores["versions_db"].exists()


def test_dark_record_save_is_the_write_gate_and_opens_nothing(stores, monkeypatch):
    opened = []
    monkeypatch.setattr(av, "_connect", lambda: opened.append(1))
    out = av.record_save("u1", av.KIND_LAYOUT, 1, before=None,
                         after={"layout_json": "{}", "groups_json": None})
    assert out is None and opened == []
    assert av.stats()["hook_failures"]["record"] == 0


# ═══ 2. saved screens ════════════════════════════════════════════════════════
def test_screen_every_save_is_a_version_and_restore_is_a_new_undoable_version(armed):
    user = _paid()
    c = _client(user)
    rec = saved_screens.create(user["id"], "Leaders", _spec(90), is_public=True)
    _tick(armed)
    saved_screens.update(rec["id"], user["id"], spec=_spec(70))
    _tick(armed)
    saved_screens.update(rec["id"], user["id"], name="Leaders loose")

    assert c.get("/api/artifact-versions/status").json()["enabled"] is True
    body = c.get(f"/api/artifact-versions/screen/{rec['id']}").json()
    assert body["head"] == 3 and body["retain"] == 10
    assert [(v["version"], v["source"]) for v in body["versions"]] == [(3, "save"), (2, "save"), (1, "save")]
    assert body["versions"][0]["label"] == "Leaders loose"
    v1 = c.get(f"/api/artifact-versions/screen/{rec['id']}/1").json()
    assert json.loads(v1["payload"]["spec_json"]) == _spec(90) and v1["payload"]["name"] == "Leaders"

    # A member unpublishes; a restore must NOT re-publish.
    saved_screens.update(rec["id"], user["id"], is_public=False)
    _tick(armed)
    r = c.post(f"/api/artifact-versions/screen/{rec['id']}/restore", json={"version": 1, "base_version": 3})
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["version"], out["appended"], out["restored_from"]) == (4, True, 1)
    now = saved_screens.get(rec["id"], user["id"])
    assert now["spec"] == _spec(90) and now["name"] == "Leaders" and now["is_public"] is False

    # Nothing was removed, and the restore is itself undone by restoring v3.
    hist = c.get(f"/api/artifact-versions/screen/{rec['id']}").json()["versions"]
    assert [v["version"] for v in hist] == [4, 3, 2, 1]
    assert (hist[0]["source"], hist[0]["restored_from"]) == ("restore", 1)
    _tick(armed)
    r = c.post(f"/api/artifact-versions/screen/{rec['id']}/restore", json={"version": 3, "base_version": 4})
    assert r.json()["version"] == 5
    now = saved_screens.get(rec["id"], user["id"])
    assert now["spec"] == _spec(70) and now["name"] == "Leaders loose"


def test_a_screen_saved_before_arming_gets_its_old_value_as_a_baseline(stores, monkeypatch):
    user = _paid()
    rec = saved_screens.create(user["id"], "Old", _spec(50))       # dark: no history
    monkeypatch.setenv(av.ENABLED_ENV, "1")
    saved_screens.update(rec["id"], user["id"], spec=_spec(60))
    hist = av.history(user["id"], av.KIND_SCREEN, rec["id"])
    assert [(v["version"], v["source"]) for v in hist] == [(2, "save"), (1, "baseline")]
    assert json.loads(av.get_version(user["id"], "screen", rec["id"], 1)["payload"]["spec_json"]) == _spec(50)


def test_stale_base_is_409_and_writes_nothing(armed):
    user = _paid()
    c = _client(user)
    rec = saved_screens.create(user["id"], "S", _spec(90))
    _tick(armed)
    saved_screens.update(rec["id"], user["id"], spec=_spec(80))
    r = c.post(f"/api/artifact-versions/screen/{rec['id']}/restore", json={"version": 1, "base_version": 1})
    assert r.status_code == 409
    assert r.json()["detail"]["head_version"] == 2
    assert saved_screens.get(rec["id"], user["id"])["spec"] == _spec(80)
    assert [v["version"] for v in av.history(user["id"], "screen", rec["id"])] == [2, 1]


def test_history_is_owner_scoped_and_paid(armed):
    owner, other = _paid(), _paid()
    rec = saved_screens.create(owner["id"], "Mine", _spec(90))
    oc = _client(other)
    assert oc.get(f"/api/artifact-versions/screen/{rec['id']}").status_code == 404
    assert oc.get(f"/api/artifact-versions/screen/{rec['id']}/1").status_code == 404
    r = oc.post(f"/api/artifact-versions/screen/{rec['id']}/restore", json={"version": 1, "base_version": 1})
    assert r.status_code == 404
    admin = {**_paid(), "role": "admin"}
    assert _client(admin).get(f"/api/artifact-versions/screen/{rec['id']}").status_code == 404
    free = {**owner, "plan": "free"}
    assert _client(free).get(f"/api/artifact-versions/screen/{rec['id']}").status_code == 402
    assert _client(owner).get(f"/api/artifact-versions/nope/{rec['id']}").status_code == 404


# ═══ 3. named layouts ════════════════════════════════════════════════════════
def test_layout_saves_are_versioned_and_restore_keeps_the_name(armed):
    user = _paid()
    c = _client(user)
    row = layouts.upsert("user", user["id"], "Swing", _layout(2), {"A": "NVDA"}, "t")
    _tick(armed)
    layouts.upsert("user", user["id"], "Swing", _layout(4), None, "t")
    layouts.rename(row["id"], "Swing v2")
    hist = c.get(f"/api/artifact-versions/layout/{row['id']}").json()
    assert hist["head"] == 2
    _tick(armed)
    r = c.post(f"/api/artifact-versions/layout/{row['id']}/restore", json={"version": 1, "base_version": 2})
    assert r.status_code == 200, r.text
    art = r.json()["artifact"]
    assert art["name"] == "Swing v2" and art["layout"] == _layout(2) and art["groups"] == {"A": "NVDA"}
    assert layouts.get(row["id"])["layout"] == _layout(2)
    assert [v["source"] for v in av.history(user["id"], "layout", row["id"])] == ["restore", "save", "save"]


def test_prebuilt_and_other_members_layouts_have_no_history(armed):
    user, other = _paid(), _paid()
    g = layouts.upsert("global", user["id"], "Prebuilt", _layout(2), None, "admin")
    layouts.upsert("global", user["id"], "Prebuilt", _layout(3), None, "admin")
    mine = layouts.upsert("user", user["id"], "Mine", _layout(2), None, "t")
    c = _client({**user, "role": "admin"})
    assert c.get(f"/api/artifact-versions/layout/{g['id']}").status_code == 404
    assert av.history(user["id"], "layout", g["id"]) == []
    assert _client(other).get(f"/api/artifact-versions/layout/{mine['id']}").status_code == 404


# ═══ 4. retention ════════════════════════════════════════════════════════════
def test_ten_deep_after_coalescing_keystroke_saves(armed):
    user = _paid()
    row = layouts.upsert("user", user["id"], "R", _layout(1), None, "t")
    for n in range(2, 15):                          # 13 more checkpoints, 2 min apart
        _tick(armed)
        layouts.upsert("user", user["id"], "R", _layout(n), None, "t")
    hist = av.history(user["id"], "layout", row["id"])
    assert [v["version"] for v in hist] == list(range(14, 4, -1))
    # A burst of auto-saves 1 s apart collapses to its last state, and the checkpoint
    # before the burst survives.
    _tick(armed)
    for n in range(20, 25):
        _tick(armed, 1)
        layouts.upsert("user", user["id"], "R", _layout(n), None, "t")
    hist = av.history(user["id"], "layout", row["id"])
    assert hist[0]["version"] == 19 and hist[1]["version"] == 14
    assert len(hist) == 10
    with av._connect() as c:
        reasons = {r[0] for r in c.execute("SELECT reason FROM artifact_version_prune_log")}
    assert reasons == {"depth", "coalesced"}


def test_a_restore_and_the_state_it_replaced_are_never_coalesced(armed):
    user = _paid()
    c = _client(user)
    row = layouts.upsert("user", user["id"], "U", _layout(1), None, "t")
    _tick(armed)
    layouts.upsert("user", user["id"], "U", _layout(2), None, "t")   # v2
    _tick(armed, 1)
    layouts.upsert("user", user["id"], "U", _layout(3), None, "t")   # v3: v2 coalesced
    _tick(armed, 1)
    r = c.post(f"/api/artifact-versions/layout/{row['id']}/restore", json={"version": 1, "base_version": 3})
    assert r.json()["version"] == 4
    _tick(armed, 1)
    layouts.upsert("user", user["id"], "U", _layout(5), None, "t")   # v5, 1 s after the restore
    assert [v["version"] for v in av.history(user["id"], "layout", row["id"])] == [5, 4, 3, 1]


# ═══ 5. failure isolation + the one removal ══════════════════════════════════
def test_a_failing_version_store_never_fails_the_save(armed, monkeypatch):
    def boom():
        raise RuntimeError("disk")
    monkeypatch.setattr(av, "_connect", boom)
    user = _paid()
    rec = saved_screens.create(user["id"], "S", _spec(1))
    assert saved_screens.update(rec["id"], user["id"], spec=_spec(2))["spec"] == _spec(2)
    assert av.stats()["hook_failures"]["record"] == 2


def _strip(src: str) -> str:
    """Code only: comments and docstrings removed before any literal hunt."""
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.Module)) and node.body \
                and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant):
            node.body = node.body[1:] or [ast.Pass()]
    return ast.unparse(tree)


def test_the_only_row_removal_is_retention_and_nothing_is_updated():
    tree = ast.parse(_strip((REPO / "api/services/artifact_versions.py").read_text(encoding="utf-8")))
    hits = []
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        for node in ast.walk(fn):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                up = node.value.upper()
                if "DELETE " in up or "UPDATE " in up or "DROP " in up:
                    hits.append((fn.name, node.value.split()[0].upper()))
    assert hits == [("_prune", "DELETE")], hits
