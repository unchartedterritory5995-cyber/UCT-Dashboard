"""Share privacy (2026-11-13): an honest source disclosure, no author id, and no client-written author.

1. DECIDED: a shared RUNTIME document carries its Pine source (the runtime lane cannot draw it
   without the script). So the share says so: every share answer carries ``includesSource``
   (the read BEFORE a link exists, the mint, the library publish, the preview), and the panel
   shows the sentence before the member presses Create (`SharePanel.test.jsx`).
2. ``author_id`` is a member identifier. No share preview, installed copy, fork, listing or history
   a member receives carries it, at any route of `/api/user-definitions` (the rail walks the
   router table). The lineage stays server-side, in the stored document, where the erasure path
   scrubs it.
3. The server never believes a client-sent ``origin.author_id``: after `purge_user` scrubs the
   author, an Undo in a tab left open (re-PUTting the old document) cannot write the id back, and
   a forged one is replaced by the server's.

Mutation-proved: `docs/pine/evidence/2026-11-13-share-privacy/EVIDENCE.md`.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import indicator_alert_service as ias
from api.services import runtime_definitions as rt
from api.services import user_definition_relint as rl
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_DOCS = {d["slug"]: d for d in json.loads(
    (ROOT / "tests/fixtures/runtime_documents/documents.json").read_text(encoding="utf-8"))["documents"]}
AUTHOR, VIEWER, THIRD = "u-privacy-author-5e1d", "u-privacy-viewer-77b0", "u-privacy-third-c4a9"


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV, rt.CAPABILITY_ADMISSION_ENV):
        monkeypatch.delenv(k, raising=False)
    rl._NOTICE_CACHE.clear()
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    yield
    rl._NOTICE_CACHE.clear()


def _as(user_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": user_id, "role": "member", "plan": "premium"}
    return TestClient(app)


def _ast_doc(name: str = "Private Screen") -> dict:
    close = {"type": "series", "name": "close"}
    tree = {"type": "op", "name": ">", "args": [close, {"type": "num", "value": 10}]}
    return {
        "schemaVersion": 1, "id": svc.new_def_id(), "version": 1,
        "meta": {"name": name, "shortName": "PRV", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree, "fn": svc.ast_hash(tree)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def _runtime_doc(monkeypatch) -> dict:
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    return copy.deepcopy(RUNTIME_DOCS["adx-and-di-for-v4"]["definition"])


def _installed(author: str = AUTHOR, member: str = VIEWER) -> tuple:
    """(author's def id, token, member's installed copy id)."""
    d = _ast_doc()
    svc.save(author, d["id"], d)
    token = svc.share(author, d["id"])["token"]
    return d["id"], token, svc.install_share(member, token)["def_id"]


# -- 1. the disclosure ------------------------------------------------------------------------------

def test_a_runtime_share_says_it_carries_the_source_BEFORE_a_link_exists(monkeypatch):
    d = _runtime_doc(monkeypatch)
    svc.save(AUTHOR, d["id"], d)
    me = _as(AUTHOR)
    before = me.get(f"/api/user-definitions/{d['id']}/share").json()
    assert before == {"token": None, "includesSource": True}          # read-only, and it says so
    minted = me.post(f"/api/user-definitions/{d['id']}/share").json()
    assert minted["includesSource"] is True
    assert me.get(f"/api/user-definitions/{d['id']}/share").json()["includesSource"] is True
    body = _as(VIEWER).get(f"/api/user-definitions/shared/{minted['token']}").json()
    assert body["includesSource"] is True
    assert body["definition"]["compute"]["source"] == d["compute"]["source"]


def test_a_formula_share_says_it_carries_no_source():
    d = _ast_doc()
    svc.save(AUTHOR, d["id"], d)
    me = _as(AUTHOR)
    assert me.get(f"/api/user-definitions/{d['id']}/share").json() == {"token": None, "includesSource": False}
    token = me.post(f"/api/user-definitions/{d['id']}/share").json()["token"]
    assert _as(VIEWER).get(f"/api/user-definitions/shared/{token}").json()["includesSource"] is False


def test_publishing_to_the_library_says_it_too(monkeypatch):
    d = _runtime_doc(monkeypatch)
    svc.save(AUTHOR, d["id"], d)
    assert _as(AUTHOR).post(f"/api/user-definitions/{d['id']}/list").json()["includesSource"] is True


def test_another_members_id_reads_no_disclosure_of_a_row_it_cannot_see(monkeypatch):
    d = _runtime_doc(monkeypatch)
    svc.save(AUTHOR, d["id"], d)
    assert _as(VIEWER).get(f"/api/user-definitions/{d['id']}/share").json() == \
        {"token": None, "includesSource": False}


def test_the_disclosure_follows_the_PINNED_version_not_the_newest(monkeypatch):
    """(review of #1227) A link serves the version PINNED at mint. A formula saved over the script
    afterwards does not change what the link hands out, so it must not change what the share
    state says either; re-minting pins the formula, and then it says so."""
    d = _runtime_doc(monkeypatch)
    svc.save(AUTHOR, d["id"], d)
    me = _as(AUTHOR)
    token = me.post(f"/api/user-definitions/{d['id']}/share").json()["token"]
    formula = _ast_doc()
    formula["id"] = d["id"]
    put = me.put(f"/api/user-definitions/{d['id']}", json={"definition": formula})
    assert put.status_code == 200, put.text
    preview = _as(VIEWER).get(f"/api/user-definitions/shared/{token}").json()
    assert preview["definition"]["compute"]["source"] == d["compute"]["source"]    # the pinned script
    assert preview["includesSource"] is True
    assert me.get(f"/api/user-definitions/{d['id']}/share").json()["includesSource"] is True
    assert svc.share_status(AUTHOR, d["id"])["includesSource"] is True
    # re-mint: the link now pins the formula, which carries no script
    assert me.post(f"/api/user-definitions/{d['id']}/share").json()["includesSource"] is False
    assert me.get(f"/api/user-definitions/{d['id']}/share").json()["includesSource"] is False
    assert _as(VIEWER).get(f"/api/user-definitions/shared/{token}").json()["includesSource"] is False


# -- 2. no author id in anything a member receives -------------------------------------------------

def _every_route_as(user_id: str, ids: dict) -> list:
    """Every route of the router, called as ``user_id`` with each id substituted: ``[(route, text)]``."""
    client = _as(user_id)
    out = []
    # every reading route BEFORE any DELETE (a DELETE tombstones the row the reads are meant to see)
    calls = sorted(((m, r) for r in router_mod.router.routes for m in r.methods),
                   key=lambda mr: (mr[0] == "DELETE", mr[1].path, mr[0]))
    for method, r in calls:
        for def_id in ids["def_ids"]:
            url = r.path.replace("{def_id}", def_id).replace("{token}", ids["token"])
            got = client.request(method, url, json={} if method in ("POST", "PUT") else None)
            out.append((f"{method} {r.path} [{def_id}]", got.text))
            if "{def_id}" not in r.path:
                break
    return out


def test_NO_route_hands_a_member_the_authors_id():
    """The viewer installs a copy, forks it, and then every route of the router is called as the
    viewer with every id in play. The author's member id appears in none of the answers -- while
    the store still holds it (CONTROL: the probe would see it if a route served it)."""
    author_def, token, copy_id = _installed()
    fork_id = svc.fork(VIEWER, copy_id)["def_id"]
    svc.publish(AUTHOR, author_def)
    # the lineage is kept server-side, on the copy AND on its fork (read BEFORE the probe, whose
    # DELETE route tombstones the viewer's rows)
    assert svc.get(VIEWER, copy_id)["definition"]["origin"]["author_id"] == AUTHOR
    assert svc.get(VIEWER, fork_id)["definition"]["origin"]["author_id"] == AUTHOR
    # CONTROL: served raw, the stored row WOULD carry it (so the probe is not blind)
    assert AUTHOR in json.dumps(svc.get(VIEWER, copy_id))
    probed = _every_route_as(VIEWER, {"def_ids": [copy_id, fork_id, author_def], "token": token})
    assert len(probed) > 40
    leaks = [route for route, text in probed if AUTHOR in text]
    assert leaks == []


def test_the_install_answer_and_the_preview_carry_no_author_id():
    d = _ast_doc()
    svc.save(AUTHOR, d["id"], d)
    token = svc.share(AUTHOR, d["id"])["token"]
    preview = _as(VIEWER).get(f"/api/user-definitions/shared/{token}").json()
    assert "author_id" not in preview
    assert "author_id" not in svc.resolve_share(token)
    installed = _as(VIEWER).post(f"/api/user-definitions/shared/{token}/install").json()
    assert installed["origin"]["def_id"] == d["id"] and "author_id" not in installed["origin"]


def test_a_re_shared_copy_does_not_hand_on_its_ORIGINAL_authors_id():
    """VIEWER installs AUTHOR's formula, then shares that copy with THIRD: THIRD's preview and
    THIRD's own copy carry neither member id."""
    _author_def, _token, copy_id = _installed()
    token2 = svc.share(VIEWER, copy_id)["token"]
    preview = _as(THIRD).get(f"/api/user-definitions/shared/{token2}").text
    assert AUTHOR not in preview and VIEWER not in preview
    mine = svc.install_share(THIRD, token2)["def_id"]
    assert AUTHOR not in _as(THIRD).get(f"/api/user-definitions/{mine}").text
    assert svc.get(THIRD, mine)["definition"]["origin"]["author_id"] == VIEWER   # server-side only


# -- 3. the server decides origin.author_id ---------------------------------------------------------

def _put(user_id: str, def_id: str, definition: dict):
    return _as(user_id).put(f"/api/user-definitions/{def_id}", json={"definition": definition})


def test_an_UNDO_after_the_authors_erasure_cannot_restore_the_scrubbed_id():
    """The viewer's tab holds the copy as it was BEFORE the author deleted their account (the
    stored document, author id and all). The purge scrubs it; the tab's Undo re-PUTs the old
    document; the stored copy still names nobody."""
    _author_def, _token, copy_id = _installed()
    stale = copy.deepcopy(svc.get(VIEWER, copy_id)["definition"])
    assert stale["origin"]["author_id"] == AUTHOR
    svc.purge_user(AUTHOR)
    assert svc.get(VIEWER, copy_id)["definition"]["origin"]["author_id"] is None
    stale["meta"]["name"] = "Undo in an old tab"
    assert _put(VIEWER, copy_id, stale).status_code == 200
    newest = svc.get(VIEWER, copy_id)
    assert newest["definition"]["meta"]["name"] == "Undo in an old tab"     # the save landed
    assert newest["definition"]["origin"]["author_id"] is None              # and named nobody


def test_a_FORGED_author_id_is_replaced_by_the_servers():
    _author_def, _token, copy_id = _installed()
    doc = copy.deepcopy(svc.get(VIEWER, copy_id)["definition"])
    doc["origin"]["author_id"] = THIRD
    doc["meta"]["name"] = "Forged"
    assert _put(VIEWER, copy_id, doc).status_code == 200
    stored = svc.get(VIEWER, copy_id)["definition"]
    assert stored["meta"]["name"] == "Forged" and stored["origin"]["author_id"] == AUTHOR


def test_a_NEW_definition_cannot_claim_an_author():
    doc = _ast_doc()
    doc["origin"] = {"author_id": THIRD, "def_id": "u_aaaaaaaaaaaa", "version": 1}
    out = _as(VIEWER).post("/api/user-definitions", json={"definition": doc}).json()
    stored = svc.get(VIEWER, out["def_id"])["definition"]
    assert "author_id" not in stored["origin"]
    assert stored["origin"]["def_id"] == "u_aaaaaaaaaaaa"                   # the rest is untouched


def test_the_served_copy_sent_back_unchanged_is_still_a_no_op():
    """The member's copy is served without its author id; sent back as served, it is the stored
    document byte for byte (the server re-derives the id), so no version is appended."""
    _author_def, _token, copy_id = _installed()
    served = _as(VIEWER).get(f"/api/user-definitions/{copy_id}").json()["definition"]
    assert "author_id" not in served["origin"]
    before = svc.get(VIEWER, copy_id)["version"]
    out = _put(VIEWER, copy_id, served).json()
    assert out["appended"] is False and out["version"] == before
    assert svc.get(VIEWER, copy_id)["definition"]["origin"]["author_id"] == AUTHOR
