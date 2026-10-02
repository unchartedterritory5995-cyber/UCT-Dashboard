"""COV-06 follow-ups (``ARTIFACT_VERSIONS_ENABLED``): watchlist history, and bringing back a DELETED
screen, layout or watchlist from the history that outlived it.

REAL stores, seeded through their own write functions: the sandbox auth.db the repo-root conftest
pins (``watchlists`` / ``watchlist_items`` / ``screener_saved_screens``, real users via
``create_user`` because ``watchlists.user_id`` is a foreign key), a ``charts_layouts.db`` and a
``workspace_docs.db`` in ``tmp_path``. The REAL router is mounted on a bare app; only the identity
is substituted. The fixtures are the COV-06 suite's own, imported, so there is one recipe.
"""
from __future__ import annotations

import json
import uuid

import pytest

from api.services import artifact_versions as av
from api.services import charts_layout_service as layouts
from api.services import watchlist_origin, watchlist_service
from api.services.auth_db import get_connection, init_db
from api.services.auth_service import create_user
from api.services.screener import saved_screens
from tests.test_artifact_versions import _client, _layout, _spec, _tick, armed, stores  # noqa: F401

BASE = "/api/artifact-versions"


def _member(plan="pro"):
    init_db()
    uid = create_user(f"cov06f_{uuid.uuid4().hex[:10]}@example.com", "p")["id"]
    return {"id": uid, "email": "x@example.test", "role": "member", "plan": plan}


def _syms(wl):
    return [i["sym"] for i in wl["items"]]


def _versions(c, kind, aid):
    r = c.get(f"{BASE}/{kind}/{aid}")
    assert r.status_code == 200, r.text
    return r.json()["versions"]


# ═══ A1. watchlists ══════════════════════════════════════════════════════════
def test_dark_watchlist_edits_open_nothing_and_routes_are_404(stores, monkeypatch):
    opened = []
    monkeypatch.setattr(av, "_connect", lambda: opened.append(1) or (_ for _ in ()).throw(AssertionError))
    u = _member()
    wl = watchlist_service.create_watchlist(u["id"], "Dark list")
    watchlist_service.bulk_add_items(u["id"], wl["id"], ["NVDA", "AMD"])
    watchlist_service.add_item(u["id"], wl["id"], "TSLA")
    watchlist_service.delete_watchlist(u["id"], wl["id"])
    assert opened == [] and not stores["versions_db"].exists()
    c = _client(u)
    for method, path in (("get", f"{BASE}/watchlist/deleted"),
                         ("get", f"{BASE}/watchlist/{wl['id']}"),
                         ("post", f"{BASE}/watchlist/{wl['id']}/restore"),
                         ("post", f"{BASE}/watchlist/{wl['id']}/undelete")):
        kw = {"json": {"version": 1, "base_version": 1}} if method == "post" else {}
        assert getattr(c, method)(path, **kw).status_code == 404, path


def test_watchlist_every_edit_is_a_snapshot_of_the_whole_list_and_restore_is_undoable(armed):
    u = _member()
    c = _client(u)
    wl = watchlist_service.create_watchlist(u["id"], "Leaders", "my core")            # v1: empty
    _tick(armed)
    watchlist_service.bulk_add_items(u["id"], wl["id"], ["NVDA", "AMD", "AVGO"])     # v2
    _tick(armed)
    item = next(i for i in watchlist_service.get_watchlist(wl["id"], u["id"])["items"] if i["sym"] == "AMD")
    watchlist_service.update_item_notes(u["id"], wl["id"], item["id"], "earnings 10/28")  # v3
    _tick(armed)
    watchlist_service.remove_item(u["id"], wl["id"], item["id"])                     # v4
    _tick(armed)
    watchlist_service.update_watchlist(u["id"], wl["id"], {"name": "Leaders trimmed"})  # v5
    _tick(armed)
    watchlist_service.update_watchlist(u["id"], wl["id"], {"is_public": True})       # publication: no version

    hist = _versions(c, "watchlist", wl["id"])
    assert [(v["version"], v["source"]) for v in hist] == [(5, "save"), (4, "save"), (3, "save"), (2, "save"), (1, "save")]
    assert hist[0]["label"] == "Leaders trimmed"
    v3 = c.get(f"{BASE}/watchlist/{wl['id']}/3").json()["payload"]
    assert json.loads(v3["items_json"]) == [
        {"sym": "NVDA", "notes": ""}, {"sym": "AMD", "notes": "earnings 10/28"}, {"sym": "AVGO", "notes": ""}]

    r = c.post(f"{BASE}/watchlist/{wl['id']}/restore", json={"version": 3, "base_version": 5})
    assert r.status_code == 200, r.text
    assert (r.json()["version"], r.json()["restored_from"]) == (6, 3)
    now = watchlist_service.get_watchlist(wl["id"], u["id"])
    assert _syms(now) == ["NVDA", "AMD", "AVGO"] and now["name"] == "Leaders"
    assert next(i for i in now["items"] if i["sym"] == "AMD")["notes"] == "earnings 10/28"
    assert now["is_public"] == 1                      # a restore never touches publication
    _tick(armed)
    r = c.post(f"{BASE}/watchlist/{wl['id']}/restore", json={"version": 5, "base_version": 6})
    assert r.json()["version"] == 7
    now = watchlist_service.get_watchlist(wl["id"], u["id"])
    assert _syms(now) == ["NVDA", "AVGO"] and now["name"] == "Leaders trimmed"


def test_a_burst_of_list_edits_coalesces_and_ten_are_kept(armed):
    u = _member()
    wl = watchlist_service.create_watchlist(u["id"], "Burst")
    for n in range(12):                                   # 12 checkpoints, 2 min apart
        _tick(armed)
        watchlist_service.add_item(u["id"], wl["id"], f"T{n}")
    hist = av.history(u["id"], "watchlist", wl["id"])
    assert [v["version"] for v in hist] == list(range(13, 3, -1))
    _tick(armed)
    for s in ("B1", "B2", "B3", "B4"):                    # one burst, 1 s apart
        _tick(armed, 1)
        watchlist_service.add_item(u["id"], wl["id"], s)
    hist = av.history(u["id"], "watchlist", wl["id"])
    assert hist[0]["version"] == 17 and hist[1]["version"] == 13 and len(hist) == 10
    # A repeat add (duplicate) is not an edit and records nothing.
    watchlist_service.add_item(u["id"], wl["id"], "B4")
    assert av.history(u["id"], "watchlist", wl["id"])[0]["version"] == 17


def test_a_list_built_while_dark_gets_its_old_membership_as_a_baseline(stores, monkeypatch):
    u = _member()
    wl = watchlist_service.create_watchlist(u["id"], "Old")
    watchlist_service.bulk_add_items(u["id"], wl["id"], ["MSFT", "AAPL"])
    monkeypatch.setenv(av.ENABLED_ENV, "1")
    watchlist_service.add_item(u["id"], wl["id"], "META")
    hist = av.history(u["id"], "watchlist", wl["id"])
    assert [(v["version"], v["source"]) for v in hist] == [(2, "save"), (1, "baseline")]
    base = json.loads(av.get_version(u["id"], "watchlist", wl["id"], 1)["payload"]["items_json"])
    assert [i["sym"] for i in base] == ["MSFT", "AAPL"]


def test_flagged_prebuilt_linked_and_other_members_lists_have_no_history(armed, monkeypatch):
    u, other = _member(), _member()
    flagged = watchlist_service.sync_flagged_items(u["id"], ["NVDA"])
    watchlist_service.add_item(u["id"], flagged["id"], "AMD")
    pre = watchlist_service.create_watchlist(u["id"], "Russell")
    watchlist_service.update_watchlist(u["id"], pre["id"], {"is_prebuilt": True})
    _tick(armed)
    watchlist_service.add_item(u["id"], pre["id"], "IWM")
    monkeypatch.setenv(watchlist_origin.FLAG, "1")
    src = watchlist_service.create_watchlist(other["id"], "Src", is_public=True)
    watchlist_service.bulk_add_items(other["id"], src["id"], ["SHOP"])
    linked = watchlist_origin.save_from_list(u["id"], src["id"], "link")
    lid = linked["id"]
    mine = watchlist_service.create_watchlist(u["id"], "Mine")
    c, oc = _client(u), _client(other)
    for wid in (flagged["id"], pre["id"], lid):
        assert c.get(f"{BASE}/watchlist/{wid}").status_code == 404, wid
    for wid in (flagged["id"], lid):
        assert av.history(u["id"], "watchlist", wid) == [], wid
    # The INDEX list was a member list at its create (v1); once prebuilt, its edits record nothing.
    assert [v["version"] for v in av.history(u["id"], "watchlist", pre["id"])] == [1]
    assert oc.get(f"{BASE}/watchlist/{mine['id']}").status_code == 404
    r = oc.post(f"{BASE}/watchlist/{mine['id']}/restore", json={"version": 1, "base_version": 1})
    assert r.status_code == 404


# ═══ A2. deleted artefacts come back from the history that outlived them ═════
def test_a_deleted_screen_is_listed_readable_and_comes_back_unpublished_under_its_old_id(armed):
    u = _member()
    c = _client(u)
    rec = saved_screens.create(u["id"], "Leaders", _spec(90), is_public=True)       # v1
    _tick(armed)
    saved_screens.update(rec["id"], u["id"], spec=_spec(70), name="Leaders 70")      # v2
    _tick(armed)
    assert saved_screens.delete(rec["id"], u["id"]) is True                          # v3 tombstone
    assert saved_screens.get(rec["id"], u["id"]) is None

    gone = c.get(f"{BASE}/screen/deleted").json()["deleted"]
    assert [(d["artifact_id"], d["label"], d["head"]) for d in gone] == [(rec["id"], "Leaders 70", 3)]
    assert gone[0]["deleted_at"] == armed["clock"]["t"]
    hist = _versions(c, "screen", rec["id"])
    assert [(v["version"], v["source"]) for v in hist] == [(3, "delete"), (2, "save"), (1, "save")]
    # A restore needs the artefact to exist; bringing it back is the undelete door.
    assert c.post(f"{BASE}/screen/{rec['id']}/restore", json={"version": 1, "base_version": 3}).status_code == 404

    _tick(armed)
    r = c.post(f"{BASE}/screen/{rec['id']}/undelete", json={"version": 1, "base_version": 3})
    assert r.status_code == 200, r.text
    assert (r.json()["version"], r.json()["restored_from"]) == (4, 1)
    back = saved_screens.get(rec["id"], u["id"])
    assert back["spec"] == _spec(90) and back["name"] == "Leaders"
    assert back["is_public"] is False and back["share_token"] is None
    assert saved_screens.get_public(rec["share_token"]) is None
    assert c.get(f"{BASE}/screen/deleted").json()["deleted"] == []
    hist = _versions(c, "screen", rec["id"])
    assert [(v["version"], v["source"]) for v in hist][:2] == [(4, "restore"), (3, "delete")]
    # The next save after a tombstone appends, and a second undelete is refused.
    _tick(armed)
    saved_screens.update(rec["id"], u["id"], spec=_spec(80))
    assert _versions(c, "screen", rec["id"])[0]["version"] == 5
    r = c.post(f"{BASE}/screen/{rec['id']}/undelete", json={"version": 2, "base_version": 5})
    assert r.status_code == 409


def test_a_screen_saved_while_dark_and_deleted_while_armed_is_still_recoverable(stores, monkeypatch):
    u = _member()
    rec = saved_screens.create(u["id"], "Never versioned", _spec(55))
    monkeypatch.setenv(av.ENABLED_ENV, "1")
    saved_screens.delete(rec["id"], u["id"])
    hist = av.history(u["id"], "screen", rec["id"])
    assert [(v["version"], v["source"]) for v in hist] == [(2, "delete"), (1, "baseline")]
    r = _client(u).post(f"{BASE}/screen/{rec['id']}/undelete", json={"version": 2, "base_version": 2})
    assert r.status_code == 200, r.text
    assert saved_screens.get(rec["id"], u["id"])["spec"] == _spec(55)


def test_undelete_is_compare_and_set_owner_scoped_and_paid(armed):
    u, other = _member(), _member()
    rec = saved_screens.create(u["id"], "S", _spec(1))
    _tick(armed)
    saved_screens.delete(rec["id"], u["id"])
    c = _client(u)
    r = c.post(f"{BASE}/screen/{rec['id']}/undelete", json={"version": 1, "base_version": 1})
    assert r.status_code == 409 and r.json()["detail"]["head_version"] == 2
    assert saved_screens.get(rec["id"], u["id"]) is None
    oc = _client(other)
    assert oc.get(f"{BASE}/screen/deleted").json()["deleted"] == []
    assert oc.get(f"{BASE}/screen/{rec['id']}").status_code == 404
    r = oc.post(f"{BASE}/screen/{rec['id']}/undelete", json={"version": 1, "base_version": 2})
    assert r.status_code == 404
    assert _client({**u, "plan": "free"}).get(f"{BASE}/screen/deleted").status_code == 402
    assert saved_screens.get(rec["id"], u["id"]) is None


def test_a_deleted_layout_comes_back_unshared_and_renamed_if_its_name_was_reused(armed):
    u = _member()
    c = _client(u)
    row = layouts.upsert("user", u["id"], "Swing", _layout(2), {"A": "NVDA"}, "t")
    tok = layouts.share(u["id"], row["id"])["token"]
    assert layouts.resolve_share(tok)["id"] == row["id"]
    _tick(armed)
    layouts.delete(row["id"])
    layouts.upsert("user", u["id"], "Swing", _layout(5), None, "t")   # the name is used again
    gone = c.get(f"{BASE}/layout/deleted").json()["deleted"]
    assert [(d["artifact_id"], d["label"]) for d in gone] == [(row["id"], "Swing")]
    _tick(armed)
    r = c.post(f"{BASE}/layout/{row['id']}/undelete", json={"version": 2, "base_version": 2})
    assert r.status_code == 200, r.text
    art = r.json()["artifact"]
    assert (art["id"], art["name"], art["layout"], art["groups"]) == (row["id"], "Swing (restored)", _layout(2), {"A": "NVDA"})
    assert layouts.resolve_share(tok) is None          # the link the delete killed stays dead
    assert layouts.share_status(u["id"], row["id"]) is None


def test_a_deleted_watchlist_comes_back_private_with_its_members_and_notes(armed):
    u = _member()
    c = _client(u)
    wl = watchlist_service.create_watchlist(u["id"], "Swing list", is_public=True)
    _tick(armed)
    watchlist_service.bulk_add_items(u["id"], wl["id"], ["CRWD", "NET"])
    _tick(armed)
    net = next(i for i in watchlist_service.get_watchlist(wl["id"], u["id"])["items"] if i["sym"] == "NET")
    watchlist_service.update_item_notes(u["id"], wl["id"], net["id"], "base 3")
    _tick(armed)
    assert watchlist_service.delete_watchlist(u["id"], wl["id"]) is True
    with get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM watchlist_items WHERE watchlist_id=?", (wl["id"],)).fetchone()[0] == 0
    gone = c.get(f"{BASE}/watchlist/deleted").json()["deleted"]
    assert [(d["artifact_id"], d["label"], d["head"]) for d in gone] == [(wl["id"], "Swing list", 4)]
    _tick(armed)
    r = c.post(f"{BASE}/watchlist/{wl['id']}/undelete", json={"version": 4, "base_version": 4})
    assert r.status_code == 200, r.text
    back = watchlist_service.get_watchlist(wl["id"], u["id"])
    assert _syms(back) == ["CRWD", "NET"] and back["is_public"] == 0
    assert next(i for i in back["items"] if i["sym"] == "NET")["notes"] == "base 3"
    assert c.get(f"{BASE}/watchlist/deleted").json()["deleted"] == []
