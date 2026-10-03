"""Entity Master UC-2: a saved watchlist row survives a rename without corruption.

The PRD's acceptance test, driven through the REAL watchlist service and a synthetic
Entity Master: a row created before a delisting still resolves to the same entity id
after it, renders its last valid alias marked delisted, and no other row is affected.
Plus the rename, the ticker-reissue trap, and the dark/never-a-delete controls.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import watchlist_entity_keys as wek
from api.services import watchlist_service as ws
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.entity_master import api as em
from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store


@pytest.fixture
def em_db(tmp_path, monkeypatch):
    monkeypatch.setattr(em_schema, "DB_PATH", str(tmp_path / "entity_master.db"))
    monkeypatch.setattr(em_store, "_local", type(em_store._local)())
    return str(tmp_path / "entity_master.db")


@pytest.fixture
def keys_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WATCHLIST_ENTITY_KEYS_DB_PATH", str(tmp_path / "watchlist_entity_keys.db"))
    return tmp_path / "watchlist_entity_keys.db"


@pytest.fixture
def armed(em_db, keys_db, monkeypatch):
    monkeypatch.setenv(wek.FLAG, "1")
    return {"em": em_db, "keys": keys_db}


def _entity(alias, since="2020-01-01"):
    r = em.apply_event("new_entity", {"entity_type": "equity", "initial_alias": alias,
                                      "initial_alias_valid_from": since},
                       f"t-{alias}-{uuid.uuid4().hex[:6]}", "test")
    assert r.accepted, r.reason
    return r.entity_id


def _list_with(*syms):
    init_db()
    uid = create_user(f"uc2_{uuid.uuid4().hex[:10]}@example.com", "p")["id"]
    wl = ws.create_watchlist(uid, "uc2")
    for s in syms:
        ws.add_item(uid, wl["id"], s)
    return uid, wl["id"]


def _rows(uid, wl_id):
    return {i["sym"]: i for i in ws.get_watchlist(wl_id, uid)["items"]}


def test_uc2_a_delisted_row_keeps_its_entity_and_says_delisted(armed):
    nvda, amd = _entity("NVDA"), _entity("AMD")
    uid, wl = _list_with("NVDA", "AMD")
    before = _rows(uid, wl)
    assert before["NVDA"]["entity_id"] == nvda and before["NVDA"]["entity_marker"] is None

    em.apply_event("alias_retired", {"entity_id": nvda, "alias": "NVDA", "valid_to": "2026-01-01"},
                   "t-ret", "test")
    em.apply_event("delisted", {"entity_id": nvda, "lifecycle_since": "2026-01-01"}, "t-del", "test")
    after = _rows(uid, wl)
    assert after["NVDA"]["entity_id"] == nvda, "the row moved off its entity"
    assert after["NVDA"]["display_sym"] == "NVDA" and after["NVDA"]["entity_marker"] == "delisted"
    assert after["AMD"]["entity_id"] == amd and after["AMD"]["entity_marker"] is None, \
        "another row was affected"


def test_a_reissued_ticker_does_not_capture_the_old_row(armed):
    old = _entity("ABC")
    uid, wl = _list_with("ABC")
    em.apply_event("alias_retired", {"entity_id": old, "alias": "ABC", "valid_to": "2026-01-01"},
                   "t-r2", "test")
    em.apply_event("delisted", {"entity_id": old, "lifecycle_since": "2026-01-01"}, "t-d2", "test")
    stranger = _entity("ABC", since="2026-02-01")
    row = _rows(uid, wl)["ABC"]
    assert row["entity_id"] == old != stranger
    assert row["entity_marker"] == "delisted"


def test_a_renamed_company_shows_its_new_alias_marked_renamed(armed):
    fb = _entity("FB")
    uid, wl = _list_with("FB")
    em.apply_event("renamed", {"entity_id": fb, "old_alias": "FB", "old_alias_valid_to": "2022-06-09",
                               "new_alias": "META", "new_alias_valid_from": "2022-06-09"},
                   "t-ren", "test")
    row = _rows(uid, wl)["FB"]
    assert row["sym"] == "FB", "the stored string is never rewritten"
    assert row["entity_id"] == fb and row["display_sym"] == "META" and row["entity_marker"] == "renamed"


def test_an_unknown_ticker_is_keyed_to_null_and_renders_as_before(armed):
    uid, wl = _list_with("ZZZZ")
    row = _rows(uid, wl)["ZZZZ"]
    assert row["entity_id"] is None and row["display_sym"] == "ZZZZ" and row["entity_marker"] is None


def test_dark_means_no_io_and_byte_identical_rows(em_db, keys_db, monkeypatch):
    monkeypatch.delenv(wek.FLAG, raising=False)
    _entity("NVDA")
    uid, wl = _list_with("NVDA")
    row = _rows(uid, wl)["NVDA"]
    assert "entity_id" not in row and "display_sym" not in row
    assert not keys_db.exists(), "a dark keyer created its store"


def test_the_key_is_written_once_and_never_re_resolved(armed):
    a = _entity("XYZ")
    uid, wl = _list_with("XYZ")
    item_id = _rows(uid, wl)["XYZ"]["id"]
    assert wek.key_items([(item_id, "QQQ")]) == 0, "an existing key was re-keyed"
    assert _rows(uid, wl)["XYZ"]["entity_id"] == a


def test_turning_it_off_deletes_no_key(armed, monkeypatch):
    _entity("NVDA")
    uid, wl = _list_with("NVDA")
    monkeypatch.delenv(wek.FLAG)
    _rows(uid, wl)
    import sqlite3
    with sqlite3.connect(armed["keys"]) as c:
        assert c.execute("SELECT COUNT(*) FROM watchlist_entity_keys").fetchone()[0] == 1


def test_the_store_is_declared_member_data_never_swept():
    from api.services import store_retention as sr
    e = sr.by_file("watchlist_entity_keys.db")
    assert e and e.member_data and e.prunes == ()
