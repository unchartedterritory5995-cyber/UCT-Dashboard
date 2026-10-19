"""P4b: sharing a page layout through the community library."""
from __future__ import annotations

import itertools
import json
import re
from pathlib import Path

import pytest

from api.services.journal_two import page_layout_share as pls
from api.services.journal_two import template_gallery as gallery
# P4b-R-X17: the shared fixtures and the one insert helper, imported by name (never copied).
from tests._style_library_helpers import _row, api, conn  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
PAGE_LAYOUTS_JS = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "pageLayouts.js"

SWITCHES = ("NOTEBOOK_STYLE_LIBRARY_ENABLED", "JOURNAL_PAGE_LAYOUTS_ENABLED", "NOTEBOOK_LAYOUT_SHARING_ENABLED")


def _set(monkeypatch, on: dict[str, bool]) -> None:
    for name in SWITCHES:
        monkeypatch.setenv(name, "1" if on.get(name) else "0")


@pytest.mark.parametrize("combo", list(itertools.product((False, True), repeat=3)))
def test_layout_sharing_needs_all_three_switches(monkeypatch, combo):
    _set(monkeypatch, dict(zip(SWITCHES, combo)))
    assert gallery.layout_sharing_enabled() is all(combo)


def test_layout_sharing_is_read_per_call(monkeypatch):
    _set(monkeypatch, {n: True for n in SWITCHES})
    assert gallery.layout_sharing_enabled() is True
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", "0")
    assert gallery.layout_sharing_enabled() is False


@pytest.mark.parametrize("value", ["", "maybe", "2", "off", "no"])
def test_an_unrecognised_value_is_off(monkeypatch, value):
    _set(monkeypatch, {n: True for n in SWITCHES})
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", value)
    assert gallery.layout_sharing_enabled() is False


def test_the_switch_is_server_only():
    from api.routers import auth
    assert "NOTEBOOK_LAYOUT_SHARING_ENABLED" not in auth.NOTEBOOK_FLAGS   # R-P4b-10: no payload key, +0 B


# ── Task 3: the page_layout item type, the panel registry, and one visibility rule ─────────────────

#: P4b-R-T3-5 (review Minor 3): an id written with double quotes, with no space after the colon, or with a
#: digit is still an id. `\bid:` keeps `ident:` or `valid:` from reading as one.
_PANEL_ID = re.compile(r"""\bid:\s*['"]([^'"]+)['"]""")


def _panel_ids(block: str) -> tuple[str, ...]:
    """The ids in one `PANELS.<page>` block, in order. Every `{`-entry must yield an id: an entry the regex
    cannot read would otherwise be invisible to the pin, and the two registries could differ while it is green."""
    ids = tuple(_PANEL_ID.findall(block))
    entries = block.count("{")
    assert entries == len(ids), f"{entries} panel entries but {len(ids)} ids read: one is written in a form the rail cannot see"
    return ids


def _client_panels() -> dict[str, tuple[str, ...]]:
    text = PAGE_LAYOUTS_JS.read_text(encoding="utf-8")
    out = {}
    for page in ("today", "trade"):
        m = re.search(rf"{page}: Object\.freeze\(\[(.*?)\]\)", text, re.S)
        assert m, f"PANELS.{page} not found in pageLayouts.js"
        out[page] = _panel_ids(m.group(1))
    return out


def test_the_server_registry_is_the_client_registry():
    assert _client_panels() == {p: pls.LAYOUT_PANEL_IDS[p] for p in pls.LAYOUT_PAGES}
    m = re.search(r"export const PHASES = Object\.freeze\(\[(.*?)\]\)", PAGE_LAYOUTS_JS.read_text(encoding="utf-8"))
    assert tuple(re.findall(r"'([a-z]+)'", m.group(1))) == pls.LAYOUT_PHASES
    assert len(pls.LAYOUT_PANEL_IDS["today"]) >= 2 and len(pls.LAYOUT_PANEL_IDS["trade"]) >= 2   # non-vacuity


def test_the_pin_sees_an_id_in_double_quotes_or_with_a_digit():
    # The CONTROL for the pin (P4b-R-T3-5): the forms the old `id: '([A-Za-z]+)'` could not read.
    block = """
    { id: 'coachStrip', label: 'Coach notes', defaultShown: true },
    { id: "newPanel2", label: "Today's note", defaultShown: false },
    { id:'p3', label: 'x' },
    """
    assert _panel_ids(block) == ("coachStrip", "newPanel2", "p3")
    with pytest.raises(AssertionError):
        _panel_ids("{ id: 'a' }, { ident: 'b' }")          # an entry with no readable id is loud, not skipped


def test_the_preference_key_is_the_clients():
    text = PAGE_LAYOUTS_JS.read_text(encoding="utf-8")
    assert re.search(r"export const LAYOUT_PREF = '([^']+)'", text).group(1) == pls.LAYOUT_PREF
    from api.routers import auth
    assert pls.LAYOUT_PREF in auth._PREFERENCE_KEYS


def _layout(conn, **kw):
    """A `page_layout` gallery row written directly (the shared insert, P4b-R-X17)."""
    kw.setdefault("payload_json", json.dumps({"page": "trade", "lists": {"trade": [{"id": "chart", "shown": True}]}}))
    return _row(conn, item_type="page_layout", **kw)


@pytest.mark.parametrize("off", SWITCHES)
def test_layout_rows_vanish_unless_all_three_switches_are_on(conn, monkeypatch, off):
    _set(monkeypatch, {n: n != off for n in SWITCHES})
    outline = _row(conn, item_type="outline", title="O")
    layout = _layout(conn, source_page="trade", title="L")
    pending = _layout(conn, status="pending", source_page="today", title="P")
    titles = [t["title"] for t in gallery.list_gallery("v", conn=conn)]
    assert "L" not in titles
    assert "O" in titles                                                  # non-vacuity: the list was read
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("v", item_type="page_layout", conn=conn)
    assert gallery.get_item("v", layout, conn=conn) is None
    assert gallery.get_item("u1", layout, conn=conn) is None            # the author too (R-P4b-10)
    assert gallery.get_item("v", outline, conn=conn) is not None
    queue = gallery.admin_queue(conn=conn)["pending"]
    assert all(r["id"] != pending for r in queue)                        # a PENDING layout row
    handle = gallery.author_handle("u1", conn)
    # P4b-R-X3: with the library off the author page is None (the library's own gate); otherwise it is read
    # and carries the outline but never a layout.
    page = gallery.author_page("v", handle, conn=conn)
    if off == "NOTEBOOK_STYLE_LIBRARY_ENABLED":
        assert page is None
    else:
        assert [i["title"] for i in page["items"]] == ["O"]              # non-vacuity: the page was read
    assert all(i["itemType"] != "page_layout" for i in (page or {"items": []})["items"])
    # The feed, the same care (P4b-R-X3): [] with the library off, never a layout otherwise.
    conn.execute("INSERT INTO j2_gallery_follows (follower_id, author_id, created_at) VALUES ('v', 'u1', 'x')")
    conn.commit()
    followed = gallery.feed("v", conn=conn)
    assert all(i["itemType"] != "page_layout" for i in followed)
    if off != "NOTEBOOK_STYLE_LIBRARY_ENABLED":
        assert [i["title"] for i in followed] == ["O"]                   # non-vacuity: the feed was read


def test_layout_rows_list_when_all_three_are_on(conn, monkeypatch):
    _set(monkeypatch, {n: True for n in SWITCHES})
    _layout(conn, source_page="trade", title="L")
    rows = gallery.list_gallery("v", item_type="page_layout", conn=conn)
    assert [(r["title"], r["itemType"], r["layoutPage"]) for r in rows] == [("L", "page_layout", "trade")]


def test_one_rule_decides_type_visibility(monkeypatch):
    _set(monkeypatch, {"NOTEBOOK_STYLE_LIBRARY_ENABLED": False})
    assert set(gallery._hidden_item_types()) == {"style", "page_layout"}
    _set(monkeypatch, {n: True for n in SWITCHES})
    assert gallery._hidden_item_types() == ()
    assert gallery._type_visible_clause() == "1"


def test_the_client_item_types_include_page_layout():
    from tests.test_style_library import _client_keys
    assert "page_layout" in _client_keys("ITEM_TYPES")
    assert _client_keys("ITEM_TYPES") == gallery.ITEM_TYPES


# ── Task 4: publishing a layout, and held revisions ─────────────────────────────────────────────────

def _save_pref(conn, user_id, blob):
    # V3 / P4b-R-X1: written through the REAL upsert (`auth_service.set_user_preference`, the statement
    # `POST /api/auth/preferences` runs) into `user_preferences(pref_key, pref_value)`. `conn` is the test's
    # connection to the same auth.db; `publish_layout` reads the row back through it.
    from api.services import auth_service
    auth_service.set_user_preference(user_id, pls.LAYOUT_PREF, blob if isinstance(blob, str) else json.dumps(blob))


@pytest.fixture
def sharing_on(monkeypatch):
    _set(monkeypatch, {n: True for n in SWITCHES})


TRADE = [{"id": "story", "shown": True}, {"id": "chart", "shown": False}, {"id": "outcome", "shown": True}]


def _publish(conn, page="trade", user_id="author", title="Prop trade page"):
    return gallery.publish_layout(user_id, page, title=title, description="", category="journal",
                                  trading_style="prop", conn=conn)


def test_a_shared_layout_carries_only_registry_panels(conn, sharing_on):
    _save_pref(conn, "author", {
        "version": 1, "notes": "my account 1234", "__proto__": {"x": 1},
        "today": {"market": [{"id": "regime", "shown": True}], "overnight": [{"id": "regime", "shown": True}]},
        "trade": TRADE + [{"id": "futurePanel", "shown": True}, {"id": "story", "shown": False}],
    })
    item = _publish(conn)
    raw = conn.execute("SELECT payload_json, item_type, source_page, status FROM j2_template_gallery WHERE id = ?",
                       (item["id"],)).fetchone()
    assert (raw["item_type"], raw["source_page"], raw["status"]) == ("page_layout", "trade", "pending")
    assert json.loads(raw["payload_json"]) == {"page": "trade", "lists": {"trade": TRADE}}
    for leaked in ("my account 1234", "__proto__", "overnight", "futurePanel", "regime", "version"):
        assert leaked not in raw["payload_json"]
    assert item["droppedPanels"] == 2           # futurePanel, and the repeated story


def test_the_write_door_refuses_an_unknown_panel():
    good = {"page": "trade", "lists": {"trade": TRADE}}
    assert pls.validate_layout_payload(good) is good
    for bad in (
        {"page": "trade", "lists": {"trade": [{"id": "futurePanel", "shown": True}]}},
        {"page": "trade", "lists": {"trade": [{"id": "chart", "shown": True}, {"id": "chart", "shown": False}]}},
        {"page": "trade", "lists": {"market": [{"id": "chart", "shown": True}]}},
        {"page": "today", "lists": {"market": [{"id": "regime", "shown": "yes"}]}},
        {"page": "today", "lists": {"market": [{"id": "regime", "shown": True, "label": "x"}]}},
        {"page": "tray", "lists": {"trade": []}},
        {"page": "trade", "lists": {}},
        {"page": "trade", "lists": {"trade": TRADE}, "extra": 1},
    ):
        with pytest.raises(pls.LayoutPayloadError):
            pls.validate_layout_payload(bad)


@pytest.mark.parametrize("bad_id", [["chart"], {"id": "chart"}, 7, None])
def test_the_write_door_refuses_a_non_text_id_with_its_own_error(bad_id):
    # P4b-R-T3-5 (review Minor 1): an unhashable id was a TypeError out of the set lookup, which a caller
    # catching LayoutPayloadError (publish, the revision approval) would surface as a 500.
    with pytest.raises(pls.LayoutPayloadError):
        pls.validate_layout_payload({"page": "trade", "lists": {"trade": [{"id": bad_id, "shown": True}]}})


def test_nothing_to_share_is_refused_with_a_sentence(conn, sharing_on):
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn)                                        # no preference row at all
    assert str(e.value) == pls.NOT_CUSTOMIZED_SENTENCE
    _save_pref(conn, "author", {"version": 1, "today": {"market": [{"id": "regime", "shown": True}]}})
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn, page="trade")                          # Today saved, the trade page never was
    assert str(e.value) == pls.NOT_CUSTOMIZED_SENTENCE
    _save_pref(conn, "author", "{not json")
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn)
    assert str(e.value) == pls.UNREADABLE_SENTENCE
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn, page="sidebar")
    assert str(e.value) == pls.PAGE_SENTENCE
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0] == 0     # nothing was written


def test_an_approved_layout_update_is_held_not_listed(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn, title="V1")
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    _save_pref(conn, "author", {"version": 1, "trade": list(reversed(TRADE))})
    again = _publish(conn, title="V2")
    assert again["id"] == item["id"]
    listed = gallery.get_item("viewer", item["id"], conn=conn)
    assert (listed["title"], listed["version"], listed["payload"]["lists"]["trade"]) == ("V1", 1, TRADE)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    assert rev["hasRevision"] is True
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)
    after = gallery.get_item("viewer", item["id"], conn=conn)
    assert (after["title"], after["version"]) == ("V2", 2)
    assert after["payload"]["lists"]["trade"] == list(reversed(TRADE))


def test_status_names_the_members_own_items_only(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn)
    status = gallery.layout_status("author", conn=conn)
    assert status["shared"]["trade"]["id"] == item["id"] and status["shared"]["today"] is None
    assert gallery.layout_status("someone-else", conn=conn) == {"shared": {"today": None, "trade": None}}


def test_publish_layout_is_none_while_sharing_is_off(conn, monkeypatch):
    _set(monkeypatch, {"NOTEBOOK_STYLE_LIBRARY_ENABLED": True, "JOURNAL_PAGE_LAYOUTS_ENABLED": True})
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    assert _publish(conn) is None
    assert gallery.layout_status("author", conn=conn) is None


def test_the_page_is_checked_before_any_field_is_cleaned(conn, sharing_on):
    # Task 4 review Minor 2: a bad page answers PAGE_SENTENCE even when the title is empty too.
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn, page="sidebar", title="")
    assert str(e.value) == pls.PAGE_SENTENCE
    with pytest.raises(gallery.GalleryError) as e:              # control: a good page reaches the title check
        _publish(conn, page="trade", title="")
    assert str(e.value) != pls.PAGE_SENTENCE


def test_the_existing_lookup_is_keyed_on_the_item_type_too(conn, sharing_on):
    # Task 4 review Minor 4: a row of another type that carries the same source_page is never the layout's
    # existing item, so it is never replaced or given a held revision. (Today no other type writes
    # source_page; the unique index on (user_id, source_page) then refuses the second row, which is the
    # loud outcome. A future type that reuses the column needs item_type in that index.)
    import sqlite3
    other = _row(conn, item_type="outline", user_id="author", title="Not a layout", source_page="trade")
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    with pytest.raises(sqlite3.IntegrityError):
        _publish(conn)
    conn.rollback()
    row = conn.execute("SELECT title, item_type, pending_json, payload_json FROM j2_template_gallery WHERE id = ?",
                       (other,)).fetchone()
    assert (row["title"], row["item_type"], row["pending_json"], row["payload_json"]) == \
        ("Not a layout", "outline", None, None)
    conn.execute("DELETE FROM j2_template_gallery WHERE id = ?", (other,))
    conn.commit()
    assert _publish(conn)["itemType"] == "page_layout"          # control: the same publish, without the foreign row


# ── Task 4: the build, entry by entry ──────────────────────────────────────────────────────────────

def test_the_build_takes_only_the_shared_pages_lists_and_counts_only_its_drops():
    blob = {"version": 1,
            "today": {"premarket": [{"id": "regime", "shown": True}, {"id": "regime", "shown": False},
                                    {"id": "coachStrip", "shown": 1}, "junk", {"id": "x" * 41, "shown": True}],
                      "postclose": [{"id": "notices", "shown": False, "label": "carried"}],
                      "overnight": [{"id": "regime", "shown": True}, {"id": "nope", "shown": True}]},
            "trade": [{"id": "futurePanel", "shown": True}]}
    payload, dropped = pls.layout_payload(json.dumps(blob), "today")
    # PHASES order, only the known phases present; an extra field is not shared and not a drop.
    assert payload == {"page": "today", "lists": {"premarket": [{"id": "regime", "shown": True}],
                                                  "postclose": [{"id": "notices", "shown": False}]}}
    assert dropped == 4       # the repeat, the non-boolean shown, the non-entry, the unknown id. Not overnight, not trade.


@pytest.mark.parametrize("raw, sentence", [
    (None, "NOT_CUSTOMIZED_SENTENCE"),
    ("", "NOT_CUSTOMIZED_SENTENCE"),
    (json.dumps({"version": 1}), "NOT_CUSTOMIZED_SENTENCE"),
    (json.dumps({"version": 1, "trade": []}), "NOT_CUSTOMIZED_SENTENCE"),
    (json.dumps({"version": 1, "trade": [{"id": "futurePanel", "shown": True}]}), "NOT_CUSTOMIZED_SENTENCE"),
    ("{not json", "UNREADABLE_SENTENCE"),
    ('{"version": 1, "trade": [{"id": "chart", "shown": NaN}]}', "UNREADABLE_SENTENCE"),
    (json.dumps({"version": 2, "trade": TRADE}), "UNREADABLE_SENTENCE"),
    (json.dumps({"version": True, "trade": TRADE}), "UNREADABLE_SENTENCE"),
    (json.dumps([1, 2]), "UNREADABLE_SENTENCE"),
    (json.dumps({"version": 1, "trade": {"chart": True}}), "UNREADABLE_SENTENCE"),
])
def test_the_build_refuses_with_one_of_the_three_sentences(raw, sentence):
    with pytest.raises(pls.LayoutPayloadError) as e:
        pls.layout_payload(raw, "trade")
    assert str(e.value) == getattr(pls, sentence)


def test_the_page_is_checked_before_the_preference_is_read():
    for page in ("sidebar", "", None, ["trade"]):
        with pytest.raises(pls.LayoutPayloadError) as e:
            pls.layout_payload("{not json", page)
        assert str(e.value) == pls.PAGE_SENTENCE


def test_the_build_passes_its_answer_through_the_door(monkeypatch):
    seen = []
    real = pls.validate_layout_payload
    monkeypatch.setattr(pls, "validate_layout_payload", lambda p: seen.append(p) or real(p))
    payload, _ = pls.layout_payload(json.dumps({"version": 1, "trade": TRADE}), "trade")
    assert seen == [payload]


def test_the_door_runs_at_the_write_even_when_the_build_lets_a_panel_through(conn, sharing_on, monkeypatch):
    # R-P4b-6a: `validate_layout_payload` runs on the payload immediately before the write, so a build that
    # let an unknown panel through is refused, with the unreadable sentence (never the door's own words),
    # and nothing is written.
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    leaky = {"page": "trade", "lists": {"trade": [{"id": "futurePanel", "shown": True}]}}
    real = pls.layout_payload
    monkeypatch.setattr(pls, "layout_payload", lambda raw, page: (leaky, 0))
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn)
    assert str(e.value) == pls.UNREADABLE_SENTENCE
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0] == 0
    monkeypatch.setattr(pls, "layout_payload", real)
    assert _publish(conn)["droppedPanels"] == 0                        # non-vacuity: the same publish, unpatched


def test_publishing_again_while_pending_replaces_it_in_place(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    first = _publish(conn, title="One")
    _save_pref(conn, "author", {"version": 1, "trade": TRADE[:1]})
    second = _publish(conn, title="Two")
    assert second["id"] == first["id"] and second["status"] == "pending" and second["title"] == "Two"
    row = conn.execute("SELECT payload_json, pending_json FROM j2_template_gallery WHERE id = ?", (first["id"],)).fetchone()
    assert json.loads(row["payload_json"])["lists"]["trade"] == TRADE[:1] and row["pending_json"] is None
    # The other page is its own item: one live copy per (author, page).
    _save_pref(conn, "author", {"version": 1, "trade": TRADE, "today": {"market": [{"id": "regime", "shown": True}]}})
    today = _publish(conn, page="today", title="Today")
    assert today["id"] != first["id"] and today["layoutPage"] == "today"


def test_a_shared_layout_is_stored_with_an_empty_body_and_preview(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn)
    row = conn.execute("SELECT body_json, preview_json, property_defs_json, trading_style, version, kind"
                       " FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone()
    assert json.loads(row["body_json"]) == {"type": "doc", "content": []}
    assert json.loads(row["preview_json"]) == []
    assert (row["property_defs_json"], row["trading_style"], row["version"], row["kind"]) == (None, "prop", 1, "member")
    assert item["authorHandle"]                                          # the handle is minted before the write


# ── Task 4: what a layout row's read serves (P4b-R-X5) ──────────────────────────────────────────────

def test_a_layout_item_serves_its_payload_and_never_a_body(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    for viewer, admin in (("viewer", False), ("author", False), ("admin", True)):
        got = gallery.get_item(viewer, item["id"], is_admin=admin, conn=conn)
        assert got["payload"] == {"page": "trade", "lists": {"trade": TRADE}}, viewer
        assert "bodyJson" not in got and "propertyDefs" not in got, viewer
    # Whatever is stored is read through `usable_layout` (`safe_layout` first): registry ids, known lists, {id, shown} only.
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(
        {"page": "trade", "extra": "leak", "lists": {"trade": [{"id": "chart", "shown": True, "note": "leak"},
                                                               {"id": "futurePanel", "shown": True}],
                                                     "market": [{"id": "regime", "shown": True}]}}), item["id"]))
    conn.commit()
    got = gallery.get_item("viewer", item["id"], conn=conn)
    assert got["payload"] == {"page": "trade", "lists": {"trade": [{"id": "chart", "shown": True}]}}
    conn.execute("UPDATE j2_template_gallery SET payload_json = '{not json' WHERE id = ?", (item["id"],))
    conn.commit()
    assert gallery.get_item("viewer", item["id"], conn=conn)["payload"] is None                 # not a 500


def test_a_held_layout_revision_reaches_a_reviewer_through_usable_layout(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn, title="V1")
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    _save_pref(conn, "author", {"version": 1, "trade": list(reversed(TRADE))})
    _publish(conn, title="V2")
    admin = gallery.get_item("admin", item["id"], is_admin=True, conn=conn)
    assert admin["pendingRevision"]["payload"] == {"page": "trade", "lists": {"trade": list(reversed(TRADE))}}
    assert (admin["pendingRevision"]["version"], admin["pendingRevision"]["title"]) == (2, "V2")
    assert "pendingRevision" not in gallery.get_item("author", item["id"], conn=conn)        # admins only
    rev = json.loads(conn.execute("SELECT pending_json FROM j2_template_gallery WHERE id = ?",
                                  (item["id"],)).fetchone()[0])
    rev["payload"]["lists"]["trade"].append({"id": "futurePanel", "shown": True, "x": "leak"})
    conn.execute("UPDATE j2_template_gallery SET pending_json = ? WHERE id = ?", (json.dumps(rev), item["id"]))
    conn.commit()
    admin = gallery.get_item("admin", item["id"], is_admin=True, conn=conn)
    assert admin["pendingRevision"]["payload"] == {"page": "trade", "lists": {"trade": list(reversed(TRADE))}}


def test_approving_an_unreadable_layout_revision_lists_nothing(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn, title="V1")
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    _save_pref(conn, "author", {"version": 1, "trade": list(reversed(TRADE))})
    _publish(conn, title="V2")
    rev = json.loads(conn.execute("SELECT pending_json FROM j2_template_gallery WHERE id = ?",
                                  (item["id"],)).fetchone()[0])
    rev["payload"]["lists"]["trade"].append({"id": "futurePanel", "shown": True})
    conn.execute("UPDATE j2_template_gallery SET pending_json = ? WHERE id = ?", (json.dumps(rev), item["id"]))
    conn.commit()
    queued = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=queued["updatedAt"], conn=conn)
    assert str(e.value) == ("That revision could not be read, so nothing was listed. "
                            "Ask the author to submit it again.")
    listed = gallery.get_item("viewer", item["id"], conn=conn)
    assert (listed["title"], listed["version"], listed["payload"]["lists"]["trade"]) == ("V1", 1, TRADE)


def test_the_page_label_is_a_closed_enum_whatever_is_stored(conn, sharing_on):
    # P4b-R-T3-5 (review Minor 2): `layoutPage` is clamped to LAYOUT_PAGES on the way out.
    odd = _layout(conn, source_page="sidebar", title="Odd")
    good = _layout(conn, source_page="trade", title="Good", user_id="u2")
    pages = {r["title"]: r["layoutPage"] for r in gallery.list_gallery("v", item_type="page_layout", conn=conn)}
    assert pages == {"Odd": None, "Good": "trade"}
    assert gallery.get_item("v", odd, conn=conn)["layoutPage"] is None
    assert gallery.get_item("v", good, conn=conn)["layoutPage"] == "trade"


def test_status_carries_the_review_state_of_each_page(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE, "today": {"market": [{"id": "regime", "shown": True}]}})
    trade = _publish(conn, page="trade")
    gallery.admin_act("admin", trade["id"], "approve", reviewed_updated_at=trade["updatedAt"], conn=conn)
    _publish(conn, page="trade", title="Held")
    today = _publish(conn, page="today", title="Today")
    shared = gallery.layout_status("author", conn=conn)["shared"]
    assert (shared["trade"]["status"], shared["trade"]["version"], shared["trade"]["hasRevision"]) == ("approved", 1, True)
    assert (shared["today"]["id"], shared["today"]["status"], shared["today"]["hasRevision"]) == (today["id"], "pending", False)


# ── Task 4: the routes ─────────────────────────────────────────────────────────────────────────────

LAYOUTS_URL = "/api/j2/template-gallery/layouts"
STATUS_URL = "/api/j2/template-gallery/layouts/status"
BODY = {"page": "trade", "title": "Prop trade page", "category": "journal", "tradingStyle": "prop"}
_UNPAID = {"id": "author", "role": "member", "plan": "free"}


def _as(api, who):
    from api.middleware import auth_middleware as authmw
    overrides = api.app.dependency_overrides
    if who == "unpaid":
        overrides[authmw.get_current_user_with_plan] = lambda: dict(_UNPAID)
    elif who == "signed_out":
        overrides.pop(authmw.get_current_user, None)
        overrides.pop(authmw.get_current_user_with_plan, None)


def test_the_layout_routes_are_the_one_404_for_everyone_while_sharing_is_off(api, conn, monkeypatch):
    _set(monkeypatch, {"NOTEBOOK_STYLE_LIBRARY_ENABLED": True, "JOURNAL_PAGE_LAYOUTS_ENABLED": True})
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    one_404 = api.get("/api/j2/template-gallery/no-such-item")              # the gallery's own not-found
    assert one_404.status_code == 404
    answers = []
    for who in ("paid", "unpaid", "signed_out"):
        _as(api, who)
        answers += [api.post(LAYOUTS_URL, json=BODY), api.post(LAYOUTS_URL, content=b"{bad"), api.get(STATUS_URL)]
    assert [r.status_code for r in answers] == [404] * 9
    assert all(r.json() == one_404.json() for r in answers)               # the SAME body, not different 404s
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0] == 0


def test_the_layout_routes_need_a_paid_plan(api, conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    assert api.get(STATUS_URL).status_code == 200                         # non-vacuity: the route is there
    _as(api, "unpaid")
    assert api.post(LAYOUTS_URL, json=BODY).status_code == 402
    assert api.get(STATUS_URL).status_code == 402


def test_post_layouts_publishes_and_status_reads_it_back(api, conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE + [{"id": "futurePanel", "shown": True}]})
    r = api.post(LAYOUTS_URL, json=BODY)
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) == {"template", "droppedPanels"} and out["droppedPanels"] == 1
    assert (out["template"]["itemType"], out["template"]["layoutPage"], out["template"]["status"]) == \
        ("page_layout", "trade", "pending")
    status = api.get(STATUS_URL).json()
    assert status == {"shared": {"today": None, "trade": status["shared"]["trade"]}}
    assert status["shared"]["trade"]["id"] == out["template"]["id"]


def test_a_refused_layout_publish_gives_the_daily_charge_back(api, conn, sharing_on):
    from api.services.journal_two.calendar import et_today
    scope = "notebook_gallery_publish"

    def charged():
        row = conn.execute("SELECT value FROM daily_usage_counters WHERE scope = ? AND subject = ? AND day = ?",
                           (scope, "author", et_today())).fetchone()
        return None if row is None else row[0]

    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    assert api.post(LAYOUTS_URL, json=BODY).status_code == 200
    before = charged()
    assert before == 1                                                     # non-vacuity: a success IS charged
    refusals = [
        ({**BODY, "page": "today"}, pls.NOT_CUSTOMIZED_SENTENCE),          # Today was never customised
        ({**BODY, "page": "sidebar"}, pls.PAGE_SENTENCE),
        ({**BODY, "title": ""}, None),
        ({**BODY, "category": "nope"}, None),
    ]
    for body, sentence in refusals:
        r = api.post(LAYOUTS_URL, json=body)
        assert r.status_code == 400, (body, r.text)
        if sentence:
            assert r.json()["detail"] == sentence
        assert charged() == before, body                                   # the refusal gave it back
    _save_pref(conn, "author", "{not json")
    r = api.post(LAYOUTS_URL, json=BODY)
    assert (r.status_code, r.json()["detail"]) == (400, pls.UNREADABLE_SENTENCE)
    assert charged() == before


# ── P4b final, item 5: a sentence a layout's author or reviewer reads names a layout, never a template ──────

def test_an_empty_layout_title_is_refused_as_a_layout(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn, title="   ")
    assert str(e.value) == "A gallery layout needs a title."


def test_reporting_your_own_layout_is_refused_as_a_layout(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    with pytest.raises(gallery.GalleryError) as e:
        gallery.report("author", item["id"], reason="spam", conn=conn)
    assert str(e.value) == "You can't report your own layout. Unpublish it instead."


def test_a_stale_layout_approval_names_a_layout(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn)
    for token in ("", "2000-01-01T00:00:00+00:00"):          # no token, and a token the row has moved past
        with pytest.raises(gallery.GalleryConflict) as e:
            gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=token, conn=conn)
        assert str(e.value) == gallery.LAYOUT_APPROVE_STALE_SENTENCE
    assert gallery.LAYOUT_APPROVE_STALE_SENTENCE == ("This layout changed after you opened it. Nothing was listed. "
                                                      "Look at it again, then approve.")
    assert gallery.APPROVE_STALE_SENTENCE.startswith("This template changed")     # control: the template row's is unchanged
