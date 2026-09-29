"""TERM-077 / FB-A12-03 — copy-from-source or link-to-source, chosen at import.

The four rails the ticket names, each against the ROUTES a member's browser
calls (not only the service), because "built, tested, green and unreachable" is
the defect this repo keeps paying for:

  1. flag OFF => today's behaviour, byte for byte: no ``origin`` key, no 409s,
     the save route 404s, the auth payload does not grow a key;
  2. a COPY is independent of later source changes;
  3. a LINK reflects the source, and says honestly when it cannot (source gone,
     or the list was edited while unguarded) — never silently turning into a copy;
  4. the choice is REQUIRED, persists, and is honoured (a link is read-only here).
"""
from __future__ import annotations

import importlib
import json
import uuid

import pytest
from fastapi import HTTPException

from api.services.auth_db import get_connection, init_db
from api.services.auth_service import create_user
from api.services import watchlist_service, watchlist_origin
from api.routers import watchlists as r

FLAG = watchlist_origin.FLAG


class _Req:
    def __init__(self, headers=None):
        self.headers = headers or {}


def _body(resp):
    return json.loads(resp.body) if hasattr(resp, "body") else resp


def _user():
    init_db()
    uid = create_user(f"wlorigin_{uuid.uuid4()}@example.com", "p")["id"]
    return {"id": uid, "role": "member"}


def _source(owner, syms, public=True, name="Leaders"):
    wl = watchlist_service.create_watchlist(owner["id"], name, is_public=public)
    watchlist_service.bulk_add_items(owner["id"], wl["id"], syms)
    return wl


def _syms(wl):
    return [i["sym"] for i in wl["items"]]


def _mine(user, wl_id):
    return next(w for w in r.list_watchlists(include_items=True, include_prebuilt=True, user=user)
                if w["id"] == wl_id)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def off(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)


def _save(user, src_id, mode, name=None):
    return r.save_watchlist_as(src_id, r.WatchlistSaveAs(mode=mode, name=name), user=user)


# ── 1. flag OFF is byte-identical ─────────────────────────────────────────────

def test_flag_default_is_off_and_read_per_call(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    assert watchlist_origin.enabled() is False
    monkeypatch.setenv(FLAG, "1")
    assert watchlist_origin.enabled() is True
    monkeypatch.setenv(FLAG, "0")
    assert watchlist_origin.enabled() is False


def test_flag_off_the_save_route_answers_404(off):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA"])
    with pytest.raises(HTTPException) as ei:
        _save(me, src["id"], "copy")
    assert ei.value.status_code == 404


def test_flag_off_list_and_get_are_byte_identical_even_for_a_linked_list(monkeypatch):
    """A list linked while the flag was ON reads exactly like any list once it is OFF."""
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA", "AMD"])
    monkeypatch.setenv(FLAG, "1")
    linked = _save(me, src["id"], "link")
    monkeypatch.delenv(FLAG)

    # The route's list output is exactly the service's output — nothing added.
    via_route = r.list_watchlists(include_items=True, include_prebuilt=True, user=me)
    direct = watchlist_service.list_user_watchlists(me["id"])
    assert json.dumps(via_route, default=str) == json.dumps(direct, default=str)
    assert all("origin" not in w for w in via_route)

    # The single-list body is exactly what the pre-feature route serialised.
    resp = r.get_watchlist(_Req(), linked["id"], user=me)
    expected = json.dumps(watchlist_service.get_watchlist(linked["id"], me["id"]),
                          separators=(",", ":"), default=str).encode()
    assert resp.body == expected

    # ...and its items are editable, as every list was before the feature.
    assert r.add_item(linked["id"], r.WatchlistItem(sym="TSLA"), user=me)["sym"] == "TSLA"


def test_flag_off_the_auth_payload_does_not_grow_a_key(monkeypatch):
    auth = importlib.import_module("api.routers.auth")
    user = {"id": "u1", "email": "m@example.com", "role": "member"}
    monkeypatch.delenv(FLAG, raising=False)
    assert "watchlist_copy_or_link_enabled" not in auth._access_payload(user, "pro")
    monkeypatch.setenv(FLAG, "1")
    assert auth._access_payload(user, "pro")["watchlist_copy_or_link_enabled"] is True


# ── 2. a COPY is independent ──────────────────────────────────────────────────

def test_a_copy_is_independent_of_later_source_changes(on):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA", "AMD", "AVGO"])
    copy = _save(me, src["id"], "copy")
    assert _syms(copy) == ["NVDA", "AMD", "AVGO"]
    assert copy["origin"]["mode"] == "copy"
    assert copy["origin"]["state"] == "independent"
    assert copy["origin"]["source_name"] == "Leaders"

    # The source changes: one added, one removed, re-ranked.
    watchlist_service.add_item(owner["id"], src["id"], "PLTR")
    amd = next(i for i in watchlist_service.get_watchlist(src["id"], owner["id"])["items"] if i["sym"] == "AMD")
    watchlist_service.remove_item(owner["id"], src["id"], amd["id"])

    again = _mine(me, copy["id"])
    assert _syms(again) == ["NVDA", "AMD", "AVGO"], "a copy must never follow its source"
    assert again["origin"]["mode"] == "copy"

    # A copy is the member's own: editing it is allowed.
    assert r.add_item(copy["id"], r.WatchlistItem(sym="META"), user=me)["sym"] == "META"


# ── 3. a LINK reflects the source, and shows staleness honestly ──────────────

def test_a_link_reflects_the_source(on):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA", "AMD"])
    link = _save(me, src["id"], "link")
    assert link["origin"]["mode"] == "link"
    assert link["origin"]["state"] == "current"
    first_sync = link["origin"]["synced_at"]

    watchlist_service.add_item(owner["id"], src["id"], "PLTR")
    again = _mine(me, link["id"])
    assert _syms(again) == ["NVDA", "AMD", "PLTR"]
    assert again["origin"]["state"] == "current"
    assert again["origin"]["synced_at"] >= first_sync

    # The single-list door follows too.
    watchlist_service.add_item(owner["id"], src["id"], "SMCI")
    one = _body(r.get_watchlist(_Req(), link["id"], user=me))
    assert _syms(one) == ["NVDA", "AMD", "PLTR", "SMCI"]
    assert one["origin"]["mode"] == "link"


def test_a_link_whose_source_is_gone_says_so_and_keeps_its_last_sync(on):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA", "AMD"])
    link = _save(me, src["id"], "link")
    synced = link["origin"]["synced_at"]

    watchlist_service.update_watchlist(owner["id"], src["id"], {"is_public": False})
    hidden = _mine(me, link["id"])
    assert hidden["origin"]["state"] == "source_unavailable"
    assert hidden["origin"]["mode"] == "link", "an unavailable source never turns a link into a copy"
    assert hidden["origin"]["synced_at"] == synced
    assert _syms(hidden) == ["NVDA", "AMD"]

    watchlist_service.delete_watchlist(owner["id"], src["id"])
    gone = _mine(me, link["id"])
    assert gone["origin"]["state"] == "source_unavailable"
    assert _syms(gone) == ["NVDA", "AMD"]


def test_a_link_edited_while_unguarded_is_paused_never_overwritten(monkeypatch):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA", "AMD"])
    monkeypatch.setenv(FLAG, "1")
    link = _save(me, src["id"], "link")

    monkeypatch.delenv(FLAG)                       # guard off: the member edits it
    watchlist_service.add_item(me["id"], link["id"], "MINE")
    monkeypatch.setenv(FLAG, "1")                  # guard back on; the source moves
    watchlist_service.add_item(owner["id"], src["id"], "PLTR")

    again = _mine(me, link["id"])
    assert _syms(again) == ["NVDA", "AMD", "MINE"], "the member's edit must survive"
    assert again["origin"]["state"] == "paused_edited"
    assert again["origin"]["mode"] == "link"


# ── 4. the choice is required, persists, and is honoured ─────────────────────

@pytest.mark.parametrize("mode", [None, "", "snapshot", "subscribe", "COPY"])
def test_there_is_no_default_mode(on, mode):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA"])
    before = len(watchlist_service.list_user_watchlists(me["id"]))
    with pytest.raises(HTTPException) as ei:
        _save(me, src["id"], mode)
    assert ei.value.status_code == 400
    assert len(watchlist_service.list_user_watchlists(me["id"])) == before, "no list without a choice"


def test_the_request_model_requires_a_mode():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        r.WatchlistSaveAs()
    # Control: the same model DOES build when a mode is given.
    assert r.WatchlistSaveAs(mode="link").mode == "link"


def test_a_source_the_member_cannot_see_is_404(on):
    owner, me = _user(), _user()
    private = _source(owner, ["NVDA"], public=False)
    with pytest.raises(HTTPException) as ei:
        _save(me, private["id"], "copy")
    assert ei.value.status_code == 404


def test_every_list_saved_from_a_list_has_its_choice_recorded(on):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA", "AMD"])
    made = [_save(me, src["id"], "copy")["id"], _save(me, src["id"], "link")["id"]]
    conn = get_connection()
    try:
        rows = {row["wl_id"]: row["mode"] for row in conn.execute(
            "SELECT wl_id, mode FROM watchlist_origins WHERE user_id = ?", (me["id"],))}
    finally:
        conn.close()
    assert rows == {made[0]: "copy", made[1]: "link"}


def test_the_choice_persists_across_reads_and_source_changes(on):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA"])
    copy = _save(me, src["id"], "copy")
    link = _save(me, src["id"], "link")
    for sym in ("AMD", "AVGO", "PLTR"):
        watchlist_service.add_item(owner["id"], src["id"], sym)
        assert _mine(me, copy["id"])["origin"]["mode"] == "copy"
        assert _mine(me, link["id"])["origin"]["mode"] == "link"


@pytest.mark.parametrize("action", ["add", "bulk", "remove", "reorder", "notes"])
def test_a_linked_list_is_read_only_here(on, action):
    owner, me = _user(), _user()
    src = _source(owner, ["NVDA", "AMD"])
    link = _save(me, src["id"], "link")
    item = link["items"][0]
    calls = {
        "add": lambda: r.add_item(link["id"], r.WatchlistItem(sym="TSLA"), user=me),
        "bulk": lambda: r.bulk_add_items(link["id"], r.BulkAddItems(symbols=["TSLA"]), user=me),
        "remove": lambda: r.remove_item(link["id"], item["id"], user=me),
        "reorder": lambda: r.reorder_items(link["id"], r.ReorderItems(item_ids=[item["id"]]), user=me),
        "notes": lambda: r.update_item_notes(link["id"], item["id"], r.ItemNotesUpdate(notes="x"), user=me),
    }
    with pytest.raises(HTTPException) as ei:
        calls[action]()
    assert ei.value.status_code == 409
    assert _syms(_mine(me, link["id"])) == ["NVDA", "AMD"]


def test_a_member_list_with_no_origin_is_untouched_when_on(on):
    me = _user()
    plain = _source(me, ["NVDA"], public=False, name="Mine")
    got = _mine(me, plain["id"])
    assert "origin" not in got
    assert r.add_item(plain["id"], r.WatchlistItem(sym="AMD"), user=me)["sym"] == "AMD"
