"""Shared fixtures and helpers for the P3a style-library tests.

Imported by name from the test modules (`from tests._style_library_helpers import conn, lib_on`),
not placed in `conftest.py`: they are specific to this feature and a conftest fixture would be
visible to the whole suite. A fixture imported into a test module is registered there like one
defined in it, so `conn` / `lib_on` / `api` keep working unchanged.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile
import uuid

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import page_layout_share as pls
from api.services.journal_two import template_gallery as gallery


@pytest.fixture
def conn(monkeypatch):
    # The gallery tests' own `db_path` fixture is the model (a private fixture there, so its
    # body is copied here rather than imported): a throwaway auth.db with the schema applied.
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = auth_db.get_connection()
    # init_db seeds the six firm outlines; these tests count rows, so start from an empty table.
    c.execute("DELETE FROM j2_template_gallery")
    c.commit()
    yield c
    c.close()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def lib_on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")


@pytest.fixture
def api(conn, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.limiter import limiter
    from api.middleware import auth_middleware as authmw
    from api.routers import notebook_template_gallery
    monkeypatch.setenv("NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "1")
    limiter.reset()
    app = FastAPI()
    app.include_router(notebook_template_gallery.router)
    user = {"id": "author", "role": "member", "plan": "pro"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    yield TestClient(app)
    app.dependency_overrides.clear()
    limiter.reset()


def _row(conn, *, item_type="outline", status="approved", trading_style=None, user_id="u1",
         listed_at="2026-10-10T00:00:00+00:00", title="T", source_page=None, payload_json=None):
    """One gallery row written directly. `source_page` and `payload_json` are for a P4b `page_layout` row
    (P4b-R-X17: the layout tests use this insert, never a copy of it); both stay NULL for every other caller."""
    gid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json,"
        " status, listed_at, created_at, updated_at, preview_json, item_type, trading_style, source_page,"
        " payload_json)"
        " VALUES (?, ?, 'member', ?, '', 'trade_plan', '{}', ?, ?, ?, ?, '[]', ?, ?, ?, ?)",
        (gid, user_id, title, status, listed_at, listed_at, listed_at, item_type, trading_style, source_page,
         payload_json))
    conn.commit()
    return gid


def _style(conn, user_id="author", **over):
    payload = {"name": "Weekend Prep", "kindId": "weekend_prep", "blocks": [],
               "outlineBodyJson": {"type": "doc", "content": [
                   {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]},
                   {"type": "paragraph", "content": [{"type": "text", "text": "mail me at a@b.com"}]},
                   {"type": "image", "attrs": {"src": "/api/j2/notes/n1/att/x.png"}},
                   {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": True},
                       "content": [{"type": "paragraph", "content": [{"type": "text", "text": "done"}]}]}]},
               ]}}
    payload.update(over)
    return js.create_style(user_id, payload, conn)


def _publish(conn, style_id, user_id="author", title="T", trading_style=None):
    return gallery.publish_style(user_id, style_id, title=title, description="", category="journal",
                                 trading_style=trading_style, conn=conn)


def listed_style(conn, **style_overrides):
    """Publish a style as "author" and approve it as an admin; return the approved summary plus
    `sourceStyleId` (the author's own row, which `_summary` carries only for the author and admins)."""
    s = _style(conn, "author", **style_overrides)
    item = _publish(conn, s["id"], "author", title="Weekend Prep")
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    out = gallery.get_item("author", item["id"], conn=conn)
    return out


def bump_and_approve(conn, item, **style_patch):
    """The author edits their style and shares it again; an admin approves the held revision, so the
    listed version goes up by one. `item` is a `listed_style` summary (it carries `sourceStyleId`)."""
    js.update_style("author", item["sourceStyleId"], style_patch, conn)
    gallery.publish_style("author", item["sourceStyleId"], title=item["title"], description="",
                          category="journal", trading_style=None, conn=conn)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)


# ── P4b page layouts: the three switches, the preference write and one trade list ──────────────────
# Shared by test_page_layout_share and test_page_layout_adopt (P4b T5 final row 11), so neither test module
# imports from the other.

SWITCHES = ("NOTEBOOK_STYLE_LIBRARY_ENABLED", "JOURNAL_PAGE_LAYOUTS_ENABLED", "NOTEBOOK_LAYOUT_SHARING_ENABLED")


def _set(monkeypatch, on: dict[str, bool]) -> None:
    for name in SWITCHES:
        monkeypatch.setenv(name, "1" if on.get(name) else "0")


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
