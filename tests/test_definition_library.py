"""⭐⭐ THE PUBLIC LIBRARY — and the consent boundary it is built around.

⛔⛔ THE ONE THING THIS FILE EXISTS TO PROVE: a link is not a publication.
Every share token in this store was minted by somebody who pressed Share to send a
link to a person they chose. Reading those rows as a directory would have
retroactively published every one of them — a consent nobody gave, and
unrecoverable the moment the page renders. Listing is a SECOND, ADDITIONAL opt-in,
and the first test below is the rail on that.

⭐ THE OTHER HALF IS THAT THE LISTING NEVER RESTATES WHAT THE SHARE KNOWS.
`definition_listings` carries no token and no revoked flag; an entry is live only
while `share_status` still answers. So revoking a link removes the entry with no
second write, and the two cannot disagree — `lesson_a_second_authority_over_one_value`
applied at the schema rather than in prose.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services import user_definitions as svc


USER = "u-owner"
OTHER = "u-other"


def _ast_sma(period: int) -> dict:
    return {"type": "call", "name": "sma",
            "args": [{"type": "series", "name": "close"},
                     {"type": "num", "value": period}]}


def defn(period: int = 20, *, name: str = "My Average",
         def_id: str = "u_000000000001") -> dict:
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": name, "shortName": "MA", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": _ast_sma(period)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """A throwaway database. ⛔ NEVER the shared root — the repo-root conftest's
    tripwire would fire, and it is right to."""
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "defs.db"))
    svc._init_db()
    return svc


def _publish(store, user=USER, def_id="u_000000000001", **kw):
    store.save(user, def_id, defn(def_id=def_id, **kw))
    return store.publish(user, def_id)


# ─── the consent boundary ────────────────────────────────────────────────────


def test_a_SHARED_definition_is_NOT_in_the_library_until_it_is_also_LISTED(store):
    """⛔⛔ THE LOAD-BEARING TEST OF THE WHOLE FEATURE.

    Pressing Share sends a link to one person. If that alone put the definition in
    a public directory, every link any member ever sent would be published the day
    this shipped — retroactively, and unrecoverably.
    """
    store.save(USER, "u_000000000001", defn())
    minted = store.share(USER, "u_000000000001")
    assert minted["token"].startswith("sh_")

    assert store.public_library()["entries"] == []
    assert store.listing_status(USER, "u_000000000001") == {
        "def_id": "u_000000000001", "listed": False, "requested": False, "shared": True,
    }


def test_publishing_lists_it_and_MINTS_the_link_when_there_is_none(store):
    """⭐ A listing nobody can open is a broken row, so publishing makes it
    openable — and says which token now serves it rather than doing it silently."""
    store.save(USER, "u_000000000001", defn(name="Trend filter"))
    assert store.share_status(USER, "u_000000000001") is None

    out = store.publish(USER, "u_000000000001")
    assert out["listed"] is True
    assert out["token"].startswith("sh_")
    # ⛔ THE SAME TOKEN the share door reports — one link, not two.
    assert store.share_status(USER, "u_000000000001")["token"] == out["token"]

    entries = store.public_library()["entries"]
    assert [e["name"] for e in entries] == ["Trend filter"]
    assert entries[0]["token"] == out["token"]


def test_unlisting_leaves_the_LINK_working(store):
    """⛔⛔ TWO DIFFERENT DECISIONS. Withdrawing from a directory must not break a
    link somebody already saved — that would be an unrelated consequence of an
    unrelated choice."""
    out = _publish(store)
    assert store.unpublish(USER, "u_000000000001") is True

    assert store.public_library()["entries"] == []
    # …and the link a recipient holds still resolves.
    assert store.resolve_share(out["token"])["definition"]["meta"]["name"] == "My Average"
    assert store.listing_status(USER, "u_000000000001")["shared"] is True


def test_revoking_the_LINK_removes_the_listing_with_no_second_write(store):
    """⭐⭐ DERIVED, NOT RESTATED. `unshare` writes nothing to
    `definition_listings`; the entry disappears because a listing is only live
    while its share is. A `listed` flag copied onto the share row would be the
    second authority that eventually disagrees."""
    _publish(store)
    assert store.unshare(USER, "u_000000000001") is True

    assert store.public_library()["entries"] == []
    state = store.listing_status(USER, "u_000000000001")
    # ⭐ AND THE PANEL CAN EXPLAIN WHY IT VANISHED: the owner still asked for it.
    assert state == {"def_id": "u_000000000001", "listed": False,
                     "requested": True, "shared": False}


def test_a_DELETED_definition_leaves_the_library_immediately(store):
    """⛔ A tombstone is not something to advertise. `resolve_share` already
    refuses it `gone`; an entry the library offers and the install door then
    refuses is worse than one it never showed."""
    _publish(store)
    assert store.soft_delete(USER, "u_000000000001") is True
    assert store.public_library()["entries"] == []


def test_a_MOVED_GRAMMAR_drops_the_entry_rather_than_offering_a_refusal(store, monkeypatch):
    """⛔⛔ THE SAME ACCEPTANCE CRITERION `resolve_share` ENFORCES. A byte-identical
    definition computes something else if the closed table moved under it. The
    library must not show what the install door will refuse — the member has
    already chosen it by then."""
    _publish(store)
    assert len(store.public_library()["entries"]) == 1

    monkeypatch.setattr(store, "_current_table_version", lambda: 999_999)
    assert store.public_library()["entries"] == []


# ─── what the listing says, and does not ─────────────────────────────────────


def test_the_library_names_NO_AUTHOR(store):
    """⚠️ A DECISION, NOT AN OMISSION. Members published a formula, not their
    name. Attribution is additive later and cannot be taken back once shipped, so
    the default is the reversible one — while `author_id` still rides on an
    INSTALL, where the recipient was handed the link deliberately.
    """
    out = _publish(store)
    entry = store.public_library()["entries"][0]
    assert "author_id" not in entry
    assert USER not in repr(entry)
    # …and the install path is unchanged: it still carries provenance.
    assert store.resolve_share(out["token"])["author_id"] == USER


def test_an_entry_carries_what_a_member_needs_to_choose_it(store):
    _publish(store, name="Oversold in an uptrend")
    entry = store.public_library()["entries"][0]
    assert entry["name"] == "Oversold in an uptrend"
    assert entry["repaint"] == "non-repainting"
    assert entry["placement"] == "price"
    assert entry["inputs"] == 0
    assert entry["ast_hash"] and entry["published_at"]


def test_publishing_TWICE_produces_ONE_entry(store):
    """⛔ A double-click must not appear as two library rows."""
    _publish(store)
    store.publish(USER, "u_000000000001")
    store.publish(USER, "u_000000000001")
    assert len(store.public_library()["entries"]) == 1


def test_two_members_both_appear_newest_first(store):
    _publish(store, user=USER, def_id="u_000000000001", name="First")
    _publish(store, user=OTHER, def_id="u_000000000002", name="Second")
    assert [e["name"] for e in store.public_library()["entries"]] == ["Second", "First"]


# ─── paging, and the trap in it ──────────────────────────────────────────────


def test_paging_walks_every_entry_and_TERMINATES(store):
    """⛔⛔ THE CURSOR IS THE LAST ROW *EXAMINED*, NOT THE LAST ONE RETURNED. Rows
    drop out for four reasons, so paging from the last SURVIVOR re-walks every
    skipped row on the next page — forever, if a dropped entry sits on the
    boundary. This walks a set with a revoked row at the seam and asserts it ends.
    """
    for i in range(1, 8):
        _publish(store, def_id="u_00000000000%d" % i, name="D%d" % i)
    # a hole exactly at a page boundary
    store.unshare(USER, "u_000000000004")

    seen, after, pages = [], None, 0
    while True:
        page = store.public_library(limit=2, after=after)
        seen += [e["name"] for e in page["entries"]]
        after = page["next"]
        pages += 1
        assert pages < 20, "paging did not terminate"
        if after is None:
            break
    assert sorted(seen) == ["D1", "D2", "D3", "D5", "D6", "D7"]
    assert len(seen) == len(set(seen)), "an entry was served twice"


def test_the_page_size_is_CAPPED_not_merely_defaulted(store):
    """⚠️ Every row costs a JSON parse. An unbounded `limit` is a way to make the
    pod do arbitrary work for one request."""
    for i in range(1, 4):
        _publish(store, def_id="u_00000000000%d" % i)
    assert len(store.public_library(limit=10_000)["entries"]) <= svc.LIBRARY_PAGE_MAX
    assert len(store.public_library(limit=0)["entries"]) == 1
    assert len(store.public_library(limit="nonsense")["entries"]) == 3


# ─── the module-wide invariants ──────────────────────────────────────────────


def test_the_LISTING_table_is_append_only_like_the_two_beside_it(store):
    """⛔ BY AST, and with a control. A listing row records that a member published
    something at a moment in time; rewriting it would erase the fact rather than
    end it."""
    tree = ast.parse(pathlib.Path(svc.__file__).read_text(encoding="utf-8"))
    sql = [n.value.strip().upper() for n in ast.walk(tree)
           if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    assert [s for s in sql if s.startswith("UPDATE") or s.startswith("DELETE FROM")] == []
    # the control: the same walk DOES see this table's inserts
    assert any("INSERT INTO DEFINITION_LISTINGS" in s for s in sql)


def test_the_library_route_is_not_shadowed_by_the_def_id_wildcard():
    """⛔⛔ FastAPI ANSWERS ON FIRST MATCH. Declared after `/{def_id}`, this route
    reads as a definition whose id is the literal string "library" — a 404 on a
    path that exists. I wrote the warning and then inserted the route below the
    wildcard anyway; this is what caught it.

    ⭐ IT RESOLVES AGAINST THE MOUNTED APP, not against the source order, so it
    stays true if the routes are ever reordered by something other than an edit.
    """
    from api.routers import user_definitions as router_mod

    # ⚠️ THE ROUTER CARRIES ITS PREFIX, so the paths are `/api/user-definitions/…`
    # — matched by SUFFIX rather than by a retyped prefix, which would be a second
    # copy of a string the router owns.
    paths = [r.path for r in router_mod.router.routes]
    lib = [i for i, p in enumerate(paths) if p.endswith("/library")]
    wild = [i for i, p in enumerate(paths) if p.endswith("/{def_id}")]
    assert lib, paths
    assert wild, paths
    assert min(lib) < min(wild), paths


def test_a_definition_that_was_never_saved_cannot_be_published(store):
    assert store.publish(USER, "u_000000000009") is None
    assert store.public_library()["entries"] == []


def test_unpublishing_something_never_published_says_so_rather_than_pretending(store):
    store.save(USER, "u_000000000001", defn())
    assert store.unpublish(USER, "u_000000000001") is False
