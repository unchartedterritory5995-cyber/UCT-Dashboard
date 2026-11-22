"""Library moderation (Studio plan, section 8: cheap before members arrive, costly after).

  * UCT can take a listing DOWN. The entry leaves the library, its owner cannot list it
    again, and nothing else of theirs changes (their copy, their link, installed copies).
    Lifting it restores exactly what the owner last asked for.
  * One member can have at most `LISTINGS_PER_MEMBER_MAX` definitions listed at once.
    An admin is exempt (the house indicators are published from one).
  * A script pasted from somewhere else carries the licence its author declared, and the
    library entry says it.

The routes are admin-only, proven through the real router with a member and an admin.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import user_definitions as router_mod
from api.services import user_definitions as svc

OWNER = "u-owner"
OTHER = "u-other"


def defn(def_id: str, name: str = "My Average", period: int = 20) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "MA", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": period}]}},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def did(n: int) -> str:
    return "u_%012d" % n


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "defs.db"))
    svc._init_db()
    return svc


def _listed(store, user=OWNER, n=1, **kw):
    store.save(user, did(n), defn(did(n), **kw))
    return store.publish(user, did(n))


def _tokens(store):
    return [e["token"] for e in store.public_library(limit=60)["entries"]]


# ─── takedown ───────────────────────────────────────────────────────────────

def test_a_takedown_removes_the_entry_and_the_owner_cannot_list_it_again(store):
    out = _listed(store)
    keep = _listed(store, user=OTHER, n=2, name="Control")
    assert set(_tokens(store)) == {out["token"], keep["token"]}

    assert store.take_down(out["token"], "misleading") == {
        "token": out["token"], "taken_down": True, "reason": "misleading"}

    assert _tokens(store) == [keep["token"]]                       # only that entry left
    status = store.listing_status(OWNER, did(1))
    assert status["taken_down"] is True and status["listed"] is False
    assert status["requested"] is True                             # the owner's own word is untouched
    with pytest.raises(store.ShareRefused) as exc:
        store.publish(OWNER, did(1))
    assert exc.value.reason == "taken-down"
    # nothing else of the owner's changed: their copy and their link still work
    assert store.get(OWNER, did(1)) is not None
    assert store.resolve_share(out["token"])["definition"]["meta"]["name"] == "My Average"


def test_lifting_it_restores_what_the_owner_last_asked_for(store):
    out = _listed(store)
    store.take_down(out["token"], "other")
    store.take_down(out["token"], "other", down=False)
    assert _tokens(store) == [out["token"]]
    assert store.listing_status(OWNER, did(1))["taken_down"] is False
    # and an owner who had withdrawn it in the meantime stays withdrawn
    store.take_down(out["token"], "other")
    store.unpublish(OWNER, did(1))
    store.take_down(out["token"], "other", down=False)
    assert _tokens(store) == []


def test_a_takedown_needs_a_known_token_and_a_reason_from_the_closed_set(store):
    out = _listed(store)
    assert store.take_down("sh_notarealtoken", "other") is None
    assert store.take_down("not-a-token", "other") is None
    with pytest.raises(ValueError):
        store.take_down(out["token"], "because I said so")
    assert _tokens(store) == [out["token"]]                         # nothing was written


def test_a_revoked_link_can_still_be_taken_down_so_relisting_cannot_bring_it_back(store):
    out = _listed(store)
    store.unshare(OWNER, did(1))
    assert store.take_down(out["token"], "abuse")["taken_down"] is True
    with pytest.raises(store.ShareRefused) as exc:
        store.publish(OWNER, did(1))
    assert exc.value.reason == "taken-down"


def test_the_takedown_rows_leave_with_the_owners_account(store):
    out = _listed(store)
    store.take_down(out["token"], "other")
    report = store.purge_user(OWNER)
    assert report["ok"] is True, report
    import sqlite3
    with sqlite3.connect(svc._DB_PATH) as c:
        left = c.execute("SELECT COUNT(*) FROM definition_listing_takedowns WHERE user_id=?",
                         (OWNER,)).fetchone()[0]
    assert left == 0
    assert report["rows_deleted"].get("definition_listing_takedowns") == 1


# ─── the per-member cap ─────────────────────────────────────────────────────

def test_one_member_can_list_at_most_the_cap_and_unlisting_frees_a_slot(store, monkeypatch):
    monkeypatch.setattr(svc, "LISTINGS_PER_MEMBER_MAX", 3)
    for n in (1, 2, 3):
        _listed(store, n=n)
    store.save(OWNER, did(4), defn(did(4)))
    with pytest.raises(store.ShareRefused) as exc:
        store.publish(OWNER, did(4))
    assert exc.value.reason == "listing-limit"
    # re-publishing one already listed is not a new slot
    assert store.publish(OWNER, did(2))["listed"] is True
    # another member is not counted against this one
    assert _listed(store, user=OTHER, n=9)["listed"] is True
    store.unpublish(OWNER, did(1))
    assert store.publish(OWNER, did(4))["listed"] is True


def test_an_admin_is_not_capped(store, monkeypatch):
    monkeypatch.setattr(svc, "LISTINGS_PER_MEMBER_MAX", 1)
    _listed(store, n=1)
    store.save(OWNER, did(2), defn(did(2)))
    with pytest.raises(store.ShareRefused):
        store.publish(OWNER, did(2))
    assert store.publish(OWNER, did(2), role="admin")["listed"] is True


# ─── the licence ────────────────────────────────────────────────────────────

MPL = ("// This Pine Script™ code is subject to the terms of the Mozilla Public License 2.0"
       " at https://mozilla.org/MPL/2.0/\n// © someone\n//@version=6\nindicator('x')\nplot(close)\n")


@pytest.mark.parametrize("src,want", [
    (MPL, "Mozilla Public License 2.0"),
    ("// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/\n"
     "//@version=5\nindicator('y')\n", "Mozilla Public License 2.0"),
    ("//@version=6\n// Copyright nobody\nindicator('z')\n", None),
    # a licence sentence AFTER the first line of code is not the header: not read
    ("//@version=6\nindicator('w')\n// subject to the terms of the MIT License\n", None),
    ("", None),
    (None, None),
])
def test_the_licence_is_read_from_the_header_comments_only(src, want):
    assert svc.licence_of(src) == want


def test_a_library_entry_carries_its_scripts_licence_and_none_without_a_script(store):
    store.save(OWNER, did(1), defn(did(1), name="Ported"), pine_source=MPL)
    store.publish(OWNER, did(1))
    _listed(store, user=OTHER, n=2, name="Plain")
    by_name = {e["name"]: e for e in store.public_library(limit=60)["entries"]}
    assert by_name["Ported"]["licence"] == "Mozilla Public License 2.0"
    assert by_name["Plain"]["licence"] is None
    # the owner's publish panel reads the same answer before publishing
    assert store.listing_status(OWNER, did(1))["licence"] == "Mozilla Public License 2.0"
    assert store.listing_status(OTHER, did(2))["licence"] is None


# ─── the routes ─────────────────────────────────────────────────────────────

@pytest.fixture()
def client(store):
    who = {"user": {"id": "a1", "role": "admin", "plan": "pro"}}
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[router_mod.require_paid] = lambda: dict(who["user"])

    def as_(user):
        who["user"] = user
        return tc
    tc = TestClient(app, raise_server_exceptions=False)
    return as_


ADMIN = {"id": "a1", "role": "admin", "plan": "pro"}
MEMBER = {"id": OWNER, "role": "user", "plan": "pro"}


def test_only_an_admin_can_take_down_or_lift(store, client):
    out = _listed(store)
    path = f"/api/user-definitions/library/{out['token']}/takedown"
    r = client(MEMBER).post(path, json={"reason": "other"})
    assert r.status_code == 403
    assert _tokens(store) == [out["token"]]
    r = client(ADMIN).post(path, json={"reason": "licence"})
    assert r.status_code == 200 and r.json()["taken_down"] is True
    assert _tokens(store) == []
    assert client(MEMBER).delete(path).status_code == 403
    assert client(ADMIN).delete(path).status_code == 200
    assert _tokens(store) == [out["token"]]
    assert client(ADMIN).post("/api/user-definitions/library/sh_nope/takedown", json={"reason": "other"}).status_code == 404
    assert client(ADMIN).post(path, json={"reason": "nonsense"}).status_code == 400


def test_the_owners_publish_refusals_reach_them_by_name(store, client, monkeypatch):
    out = _listed(store)
    store.take_down(out["token"], "broken")
    r = client(MEMBER).post(f"/api/user-definitions/{did(1)}/list")
    assert r.status_code == 403
    assert r.json()["detail"]["reason"] == "taken-down"
    assert "UCT took this indicator out of the library" in r.json()["detail"]["message"]
    monkeypatch.setattr(svc, "LISTINGS_PER_MEMBER_MAX", 0)
    store.save(OWNER, did(5), defn(did(5)))
    r = client(MEMBER).post(f"/api/user-definitions/{did(5)}/list")
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "listing-limit"


def test_the_takedown_route_is_not_shadowed_by_the_definition_routes(store, client):
    """`/library/{token}/takedown` must reach its own handler, never a `/{def_id}` one."""
    paths = [getattr(r, "path", "") for r in router_mod.router.routes]
    take = paths.index("/api/user-definitions/library/{token}/takedown")
    wild = [i for i, p in enumerate(paths) if p.startswith("/api/user-definitions/{def_id}")]
    assert wild and take < min(wild)
