"""Shared fixtures and helpers for the Task 11.8 tests (share, publish, adopt, use and credit).

Imported by name from the test modules (`from tests._gallery_w11_helpers import db, ...`), not placed in
`conftest.py`: they are specific to wave 11's library and a conftest fixture would be visible to the whole suite.
"""
from __future__ import annotations

import copy
import importlib
from datetime import datetime, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import journal_styles as js
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import routines, template_gallery as gallery, trackers
from api.services.journal_two import widget_definitions as wd
from api.services.journal_two.widget_engine import run

NOW = datetime(2026, 10, 26, 15, 30, tzinfo=timezone.utc)          # Mon 2026-10-26, 11:30 ET
AUTHOR, MEMBER, OTHER = "u-w11-author", "u-w11-member", "u-w11-other"
ALL_WAVES = (1, 2, 3, 4, 5, 6, 8, 9, 10, 11)
SETUP_PLAN = {"v": 1, "source": "closed_trades",
              "filters": [{"field": "setup", "op": "in", "values": ["Author's own setup"]}],
              "measures": [{"key": "trades"}], "range": {"token": "all"}}


def waves(monkeypatch, *on):
    for w in range(1, 13):
        if w in on:
            monkeypatch.setenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", "1")
        else:
            monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)


@pytest.fixture
def db(monkeypatch, tmp_path):
    """A throwaway auth.db with the schema applied, every wave on, the library and Journal styles on, three members
    (the author is "Sam"); yields one connection to it."""
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    importlib.reload(auth_db)
    auth_db.init_db()
    waves(monkeypatch, *ALL_WAVES)
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    monkeypatch.setattr(js, "_SLOT_POOL", nw.BoundedPool(js.SLOT_POOL_WORKERS, "nb-w11-gallery-test"))
    monkeypatch.setattr(js, "_MEMBER_IN_FLIGHT", {})
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-w11-gallery-pool",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    c = auth_db.get_connection()
    c.execute("DELETE FROM j2_template_gallery")
    for uid, name in ((AUTHOR, "Sam"), (MEMBER, "Member"), (OTHER, "Other")):
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, 'x', ?, 'member')",
                  (uid, f"{uid}@example.test", name))
    c.commit()
    try:
        yield c
    finally:
        c.close()
        run._reset_state()
        importlib.reload(auth_db)


def counts(c) -> dict:
    """Row counts of every table an adoption, a use or a share may write (a 'nothing was written' probe)."""
    tables = ("j2_template_gallery", "j2_widget_definitions", "j2_widget_definition_revs", "j2_routines",
              "j2_trackers", "j2_journal_styles", "j2_gallery_credits", "j2_template_gallery_uses",
              "j2_gallery_watches", "j2_gallery_use_days", "j2_notes", "j2_gallery_authors")
    return {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


def widget(c, uid=AUTHOR, plan=None, name="Win rate"):
    return wd.create(uid, name, copy.deepcopy(plan or SETUP_PLAN), conn=c)


def routine(c, uid=AUTHOR, name="Morning routine", items=("Coffee", "Mark levels")):
    return routines.create(uid, name=name, items=[{"text": t} for t in items], schedule={"kind": "every"},
                           now=NOW, conn=c)


def tracker(c, uid=AUTHOR, name="Sleep log", kind="number", unit="hrs"):
    return trackers.create(uid, name=name, kind=kind, unit=unit, now=NOW, conn=c)


def heading(text="Plan"):
    return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}


def para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def style(c, uid=AUTHOR, blocks=(), outline=None, name="Setup study", kind="weekend_prep"):
    ids = [b["block"] for b in blocks]
    body = outline or {"type": "doc", "content": [heading(), *[para("{{block:%s}}" % i) for i in ids]]}
    return js.create_style(uid, {"name": name, "kindId": kind, "blocks": list(blocks), "outlineBodyJson": body}, c)


def built(k, def_id, rev=1):
    return {"block": f"built_{k}", "enabled": True, "settings": {"ref": f"def:{def_id}", "defRev": rev}}


def routine_slot(k, rid, bind="note-day"):
    return {"block": f"routine_{k}", "enabled": True, "settings": {"ref": f"routine:{rid}", "bind": bind}}


def tracker_slot(k, tid):
    return {"block": f"tracker_{k}", "enabled": True, "settings": {"ref": f"tracker:{tid}"}}


def approve(c, gid):
    item = gallery.get_item("admin", gid, is_admin=True, conn=c)
    return gallery.admin_act("admin", gid, "approve", reviewed_updated_at=item["updatedAt"], conn=c)


def list_tool(c, kind, tool_id, uid=AUTHOR, edits=None, keep=()):
    """Share one of `uid`'s tools and approve it: the listed item's id."""
    out = gallery.publish_tool(uid, kind, tool_id, edits=edits, keep=keep, conn=c)
    approve(c, out["id"])
    return out["id"]


def list_template(c, style_id, uid=AUTHOR, edits=None, keep=(), title="Setup study"):
    out = gallery.publish_style(uid, style_id, title=title, description="", category="journal",
                                trading_style=None, edits=edits, keep=keep, conn=c)
    approve(c, out["id"])
    return out["id"]


def routine_edits(*texts):
    return {"items": list(texts)}
