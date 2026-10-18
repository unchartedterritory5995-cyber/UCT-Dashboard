"""P4b: sharing a page layout through the community library."""
from __future__ import annotations

import itertools
import json
import re
import uuid
from pathlib import Path

import pytest

from api.services.journal_two import page_layout_share as pls
from api.services.journal_two import template_gallery as gallery
# P4b-R-X17: the shared throwaway auth.db fixture, imported by name (never copied).
from tests._style_library_helpers import conn  # noqa: F401

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

def _client_panels() -> dict[str, tuple[str, ...]]:
    text = PAGE_LAYOUTS_JS.read_text(encoding="utf-8")
    out = {}
    for page in ("today", "trade"):
        m = re.search(rf"{page}: Object\.freeze\(\[(.*?)\]\)", text, re.S)
        assert m, f"PANELS.{page} not found in pageLayouts.js"
        out[page] = tuple(re.findall(r"id: '([A-Za-z]+)'", m.group(1)))
    return out


def test_the_server_registry_is_the_client_registry():
    assert _client_panels() == {p: pls.LAYOUT_PANEL_IDS[p] for p in pls.LAYOUT_PAGES}
    m = re.search(r"export const PHASES = Object\.freeze\(\[(.*?)\]\)", PAGE_LAYOUTS_JS.read_text(encoding="utf-8"))
    assert tuple(re.findall(r"'([a-z]+)'", m.group(1))) == pls.LAYOUT_PHASES
    assert len(pls.LAYOUT_PANEL_IDS["today"]) >= 2 and len(pls.LAYOUT_PANEL_IDS["trade"]) >= 2   # non-vacuity


def _row(conn, *, item_type, status="approved", user_id="u1", source_page=None, title="T"):
    gid = uuid.uuid4().hex
    now = "2026-10-18T00:00:00+00:00"
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
        " listed_at, created_at, updated_at, preview_json, item_type, payload_json, source_page)"
        " VALUES (?, ?, 'member', ?, '', 'journal', '{}', ?, ?, ?, ?, '[]', ?, ?, ?)",
        (gid, user_id, title, status, now, now, now, item_type,
         json.dumps({"page": "trade", "lists": {"trade": [{"id": "chart", "shown": True}]}}), source_page))
    conn.commit()
    return gid


@pytest.mark.parametrize("off", SWITCHES)
def test_layout_rows_vanish_unless_all_three_switches_are_on(conn, monkeypatch, off):
    _set(monkeypatch, {n: n != off for n in SWITCHES})
    outline = _row(conn, item_type="outline", title="O")
    layout = _row(conn, item_type="page_layout", source_page="trade", title="L")
    pending = _row(conn, item_type="page_layout", status="pending", source_page="today", title="P")
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
    _row(conn, item_type="page_layout", source_page="trade", title="L")
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
