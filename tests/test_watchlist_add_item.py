"""watchlist_service.add_item — dedupe behaviour.

The quick-add UI (pinned add bar + per-list "+") makes it trivial to fire the
same symbol at the same list twice — a double-click on "+ NVDA", or Enter held
in the combobox. add_item must therefore be idempotent per (watchlist, sym)
rather than blindly INSERTing, the way bulk_add_items already is.
"""

import uuid

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import watchlist_service


def _user():
    init_db()
    return create_user(f"wladd_{uuid.uuid4()}@example.com", "p")["id"]


def _list(uid, name="Momentum"):
    return watchlist_service.create_watchlist(uid, name)


def test_add_item_adds_symbol():
    uid = _user()
    wl = _list(uid)
    out = watchlist_service.add_item(uid, wl["id"], "NVDA")
    assert out is not None
    assert out["sym"] == "NVDA"
    fresh = watchlist_service.get_watchlist(wl["id"], uid)
    assert [i["sym"] for i in fresh["items"]] == ["NVDA"]


def test_add_item_uppercases_symbol():
    uid = _user()
    wl = _list(uid)
    out = watchlist_service.add_item(uid, wl["id"], "nvda")
    assert out["sym"] == "NVDA"


def test_add_item_is_idempotent():
    """Adding the same symbol twice leaves exactly one row."""
    uid = _user()
    wl = _list(uid)
    first = watchlist_service.add_item(uid, wl["id"], "NVDA")
    second = watchlist_service.add_item(uid, wl["id"], "NVDA")

    assert second is not None, "duplicate add must not look like a missing list"
    fresh = watchlist_service.get_watchlist(wl["id"], uid)
    assert [i["sym"] for i in fresh["items"]] == ["NVDA"]
    # Caller gets the row that actually exists, so the UI can select/scroll to it.
    assert second["id"] == first["id"]


def test_add_item_dedupes_case_insensitively():
    uid = _user()
    wl = _list(uid)
    watchlist_service.add_item(uid, wl["id"], "NVDA")
    watchlist_service.add_item(uid, wl["id"], "nvda")
    fresh = watchlist_service.get_watchlist(wl["id"], uid)
    assert [i["sym"] for i in fresh["items"]] == ["NVDA"]


def test_add_item_preserves_existing_notes_on_duplicate():
    """A re-add must not blank a note the user already wrote."""
    uid = _user()
    wl = _list(uid)
    watchlist_service.add_item(uid, wl["id"], "NVDA", "watching the 20 EMA")
    watchlist_service.add_item(uid, wl["id"], "NVDA", "")
    fresh = watchlist_service.get_watchlist(wl["id"], uid)
    assert fresh["items"][0]["notes"] == "watching the 20 EMA"


def test_add_item_dedupe_is_scoped_to_one_list():
    """The same symbol in two different lists is not a duplicate."""
    uid = _user()
    a = _list(uid, "Momentum")
    b = _list(uid, "Earnings")
    watchlist_service.add_item(uid, a["id"], "NVDA")
    watchlist_service.add_item(uid, b["id"], "NVDA")
    assert [i["sym"] for i in watchlist_service.get_watchlist(a["id"], uid)["items"]] == ["NVDA"]
    assert [i["sym"] for i in watchlist_service.get_watchlist(b["id"], uid)["items"]] == ["NVDA"]


def test_add_item_rejects_foreign_list():
    uid = _user()
    other = _user()
    wl = _list(other)
    assert watchlist_service.add_item(uid, wl["id"], "NVDA") is None
