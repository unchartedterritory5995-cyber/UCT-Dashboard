"""P3a: item types, trading style, sorts and the library switch on the gallery list."""
from __future__ import annotations

import importlib
import json
import os
import re
import sqlite3
import tempfile
import uuid
from pathlib import Path

import pytest

from api.services.journal_two import template_gallery as gallery

ROOT = Path(__file__).resolve().parents[1]
STYLE_LIB = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "styleLibrary.js"


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


def _row(conn, *, item_type="outline", status="approved", trading_style=None, user_id="u1",
         listed_at="2026-10-10T00:00:00+00:00", title="T"):
    gid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json,"
        " status, listed_at, created_at, updated_at, preview_json, item_type, trading_style)"
        " VALUES (?, ?, 'member', ?, '', 'trade_plan', '{}', ?, ?, ?, ?, '[]', ?, ?)",
        (gid, user_id, title, status, listed_at, listed_at, listed_at, item_type, trading_style))
    conn.commit()
    return gid


_LEGACY_DDL = """CREATE TABLE j2_template_gallery (
    id TEXT PRIMARY KEY, user_id TEXT, source_template_id TEXT, seed_key TEXT,
    kind TEXT NOT NULL DEFAULT 'member', title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL, body_json TEXT NOT NULL, property_defs_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending', review_note TEXT, reviewed_by TEXT, reviewed_at TEXT,
    hidden INTEGER NOT NULL DEFAULT 0, hidden_by TEXT, hidden_at TEXT,
    featured INTEGER NOT NULL DEFAULT 0, listed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)"""


def test_existing_rows_read_as_outlines(tmp_path, monkeypatch):
    # A LEGACY table (no P3a columns, not even preview_json) holding a row written before them,
    # run through the real ensure_gallery_schema. The ALTER's DEFAULTs are the only thing that
    # can make that row an outline at version 1, so this is the test that fails without them.
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    c = sqlite3.connect(str(tmp_path / "legacy.db"))
    c.row_factory = sqlite3.Row
    try:
        c.execute(_LEGACY_DDL)
        c.execute("CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT)")
        c.execute("CREATE TABLE j2_template_gallery_uses ("
                  "gallery_id TEXT NOT NULL, user_id TEXT NOT NULL, used_at TEXT NOT NULL,"
                  " PRIMARY KEY (gallery_id, user_id))")
        c.execute("CREATE TABLE j2_template_gallery_reports ("
                  "id TEXT PRIMARY KEY, gallery_id TEXT NOT NULL, user_id TEXT NOT NULL,"
                  " reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',"
                  " created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT)")
        c.execute(
            "INSERT INTO j2_template_gallery (id, user_id, kind, title, category, body_json, status,"
            " listed_at, created_at, updated_at) VALUES ('legacy1', 'u1', 'member', 'Legacy', 'journal',"
            " '{}', 'approved', '2026-09-01T00:00:00+00:00', '2026-09-01T00:00:00+00:00',"
            " '2026-09-01T00:00:00+00:00')")
        c.commit()
        cols_before = {r[1] for r in c.execute("PRAGMA table_info(j2_template_gallery)")}
        assert "item_type" not in cols_before and "version" not in cols_before    # really legacy

        gallery.ensure_gallery_schema(c)

        cols = {r[1] for r in c.execute("PRAGMA table_info(j2_template_gallery)")}
        assert {"item_type", "payload_json", "version", "trading_style", "source_style_id",
                "pending_json", "pending_at"} <= cols
        assert tuple(c.execute("SELECT item_type, version FROM j2_template_gallery WHERE id = 'legacy1'"
                               ).fetchone()) == ("outline", 1)
        listed = {r["id"]: r for r in gallery.list_gallery("v", conn=c)}
        assert (listed["legacy1"]["itemType"], listed["legacy1"]["version"]) == ("outline", 1)
        # and a second pass changes nothing (the loop is idempotent)
        gallery.ensure_gallery_schema(c)
        assert tuple(c.execute("SELECT item_type, version FROM j2_template_gallery WHERE id = 'legacy1'"
                               ).fetchone()) == ("outline", 1)
    finally:
        c.close()


def test_library_off_hides_every_style_row_and_route(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    _row(conn, item_type="outline", title="O")
    _row(conn, item_type="style", title="S")
    titles = [t["title"] for t in gallery.list_gallery("v", conn=conn)]
    assert titles == ["O"]
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("v", item_type="style", conn=conn)


def test_library_off_hides_style_rows_in_mine_and_picks_too(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    _row(conn, item_type="outline", title="O", user_id="me")
    sid = _row(conn, item_type="style", title="S", user_id="me")
    oid = _row(conn, item_type="outline", title="OP", user_id="other")
    conn.execute("UPDATE j2_template_gallery SET featured = 1 WHERE id IN (?, ?)", (sid, oid))
    conn.commit()
    assert [t["title"] for t in gallery.list_gallery("me", section="mine", conn=conn)] == ["O"]
    assert [t["title"] for t in gallery.list_gallery("me", section="picks", conn=conn)] == ["OP"]
    # non-vacuity: with the library on the same style row IS in both sections
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    assert "S" in {t["title"] for t in gallery.list_gallery("me", section="mine", conn=conn)}
    assert "S" in {t["title"] for t in gallery.list_gallery("me", section="picks", conn=conn)}


def test_library_off_answers_trending_exactly_as_an_unknown_sort(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    _row(conn, item_type="outline", title="O")
    with pytest.raises(gallery.GalleryError) as unknown:
        gallery.list_gallery("v", sort="bogus", conn=conn)
    with pytest.raises(gallery.GalleryError) as trending:
        gallery.list_gallery("v", sort="trending", conn=conn)
    assert str(trending.value) == str(unknown.value) == "Sort by newest or most used."
    # the two sorts the gallery has today still work
    for ok in ("newest", "most_used"):
        assert [t["title"] for t in gallery.list_gallery("v", sort=ok, conn=conn)] == ["O"]


def test_library_on_accepts_trending_and_still_refuses_an_unknown_sort(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    _row(conn, item_type="style", title="S")
    assert [t["title"] for t in gallery.list_gallery("v", sort="trending", conn=conn)] == ["S"]
    with pytest.raises(gallery.GalleryError) as unknown:
        gallery.list_gallery("v", sort="bogus", conn=conn)
    assert "trending" in str(unknown.value)


def test_library_on_lists_both_and_filters_by_type_and_trading_style(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    _row(conn, item_type="outline", title="O")
    _row(conn, item_type="style", title="S", trading_style="swing")
    _row(conn, item_type="style", title="D", trading_style="day")
    assert {t["title"] for t in gallery.list_gallery("v", conn=conn)} == {"O", "S", "D"}
    assert [t["title"] for t in gallery.list_gallery("v", item_type="style", trading_style="swing",
                                                     conn=conn)] == ["S"]
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("v", trading_style="scalping", conn=conn)


def test_trending_counts_distinct_adoptions_in_the_last_seven_days(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    old = _row(conn, item_type="style", title="Old")
    new = _row(conn, item_type="style", title="New")
    conn.executemany("INSERT INTO j2_template_gallery_uses (gallery_id, user_id, used_at) VALUES (?, ?, ?)",
                     [(old, f"m{i}", "2026-09-01T00:00:00+00:00") for i in range(5)]
                     + [(new, "m9", gallery._now())])
    conn.commit()
    rows = gallery.list_gallery("v", sort="trending", conn=conn)
    assert [r["title"] for r in rows][:2] == ["New", "Old"]
    assert rows[0]["trendingCount"] == 1 and rows[1]["trendingCount"] == 0


def test_summary_carries_type_version_and_trading_style(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    _row(conn, item_type="style", trading_style="earnings")
    s = gallery.list_gallery("v", conn=conn)[0]
    assert (s["itemType"], s["version"], s["tradingStyle"]) == ("style", 1, "earnings")
    assert "hasRevision" not in s           # a browsing member never sees review state


def _client_keys(name: str) -> tuple[str, ...]:
    text = STYLE_LIB.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = Object\.freeze\(\[(.*?)\]\)", text, re.S)
    assert m, f"{name} not found in styleLibrary.js"
    return tuple(re.findall(r"key:\s*'([a-z_]+)'", m.group(1)))


def test_the_client_lists_are_the_server_lists():
    assert _client_keys("ITEM_TYPES") == gallery.ITEM_TYPES
    assert _client_keys("TRADING_STYLES") == gallery.TRADING_STYLES
    assert _client_keys("LIBRARY_SORTS") == gallery.SORTS
    assert len(gallery.TRADING_STYLES) >= 2          # non-vacuity


# ── Task 4: publishing a style, and held revisions ───────────────────────────────────────

from api.services.journal_two import journal_styles as js


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


@pytest.fixture
def lib_on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")


def test_a_published_style_payload_goes_through_the_gallery_reducer(conn, lib_on):
    s = _style(conn)
    item = gallery.publish_style("author", s["id"], title="Weekend Prep", description="",
                                 category="journal", trading_style="swing", conn=conn)
    raw = conn.execute("SELECT payload_json, status, item_type FROM j2_template_gallery WHERE id = ?",
                       (item["id"],)).fetchone()
    payload = json.loads(raw["payload_json"])
    text = json.dumps(payload)
    assert raw["status"] == "pending" and raw["item_type"] == "style"
    assert "a@b.com" not in text and '"image"' not in text and "/api/j2/notes/" not in text
    assert '"checked": true' not in text
    assert payload["kindId"] == "weekend_prep"


def test_a_style_on_a_custom_kind_is_refused(conn, lib_on):
    from api.services.journal_two import note_kinds as nk
    kind = nk.create_kind("author", "My scalps", conn=conn)          # the real creator: (user_id, name, icon, conn)
    s = _style(conn, kindId=kind["id"])
    with pytest.raises(gallery.GalleryError) as e:
        gallery.publish_style("author", s["id"], title="X", description="", category="journal",
                              trading_style=None, conn=conn)
    assert str(e.value) == gallery.CUSTOM_KIND_SENTENCE


def test_member_property_defaults_never_travel(conn, lib_on):
    from api.services.journal_two import note_properties as np
    mine = np.create_property_def("author", "Conviction", "text", None, conn=conn)
    s = _style(conn, properties={mine["id"]: "high", "builtin:confidence": "high"})
    out = gallery.style_payload("author", s["id"], conn)
    assert mine["id"] not in out["properties"] and out["droppedProperties"] == 1
    # non-vacuity: a BUILT-IN user-set default does travel, so "nothing travels" cannot pass this
    assert out["properties"] == {"builtin:confidence": "high"}


def test_the_kind_property_never_travels_as_a_default(conn, lib_on):
    # R-T1a: BUILTIN_USER_SET_IDS includes builtin:note_kind, and _clean_properties REFUSES it, so a
    # style carrying it could not be saved back. A stored row can still hold it (older data).
    from api.services.journal_two import note_properties as np
    assert "builtin:note_kind" in np.BUILTIN_USER_SET_IDS               # the trap the builder must not fall into
    s = _style(conn)
    conn.execute("UPDATE j2_journal_styles SET properties_json = ? WHERE id = ?",
                 (json.dumps({"builtin:note_kind": "thesis", "builtin:confidence": "high"}), s["id"]))
    conn.commit()
    out = gallery.style_payload("author", s["id"], conn)
    assert out["properties"] == {"builtin:confidence": "high"}
    assert out["droppedProperties"] == 0                                # the kind travels as kindId, not as a drop
    item = _publish(conn, s["id"])
    stored = json.loads(conn.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                     (item["id"],)).fetchone()["payload_json"])
    assert "builtin:note_kind" not in stored["properties"]


def test_only_known_blocks_travel(conn, lib_on):
    # R-T1a: _clean_blocks keeps an unknown block id verbatim (a newer version's block), so the
    # style layer holds it; the gallery must not publish an id this server cannot place.
    s = _style(conn, blocks=[{"block": "chart"}, {"block": "futureBlock", "settings": {"x": "y"}},
                             {"block": "myRules", "settings": {"which": "all"}}])
    held = js.get_style("author", s["id"], conn)
    assert [b["block"] for b in held["blocks"]] == ["chart", "futureBlock", "myRules"]    # non-vacuity
    out = gallery.style_payload("author", s["id"], conn)
    assert [b["block"] for b in out["blocks"]] == ["chart", "myRules"]
    assert out["blocks"][1]["settings"] == {"which": "all"}


def test_another_members_style_is_not_found(conn, lib_on):
    s = _style(conn)
    assert gallery.publish_style("intruder", s["id"], title="X", description="", category="journal",
                                 trading_style=None, conn=conn) is None
    assert gallery.publish_style("author", "builtin:weekend_prep", title="X", description="",
                                 category="journal", trading_style=None, conn=conn) is None


def test_a_bad_trading_style_is_refused(conn, lib_on):
    s = _style(conn)
    with pytest.raises(gallery.GalleryError):
        _publish(conn, s["id"], trading_style="scalping")


def test_resubmitting_a_pending_style_replaces_it_in_place(conn, lib_on):
    s = _style(conn)
    first = _publish(conn, s["id"], title="V1")
    again = _publish(conn, s["id"], title="V2")
    rows = conn.execute("SELECT title, status, pending_json, version FROM j2_template_gallery").fetchall()
    assert again["id"] == first["id"] and len(rows) == 1
    assert (rows[0]["title"], rows[0]["status"], rows[0]["pending_json"], rows[0]["version"]) == (
        "V2", "pending", None, 1)


def test_an_approved_style_update_is_held_not_listed(conn, lib_on):
    s = _style(conn)
    item = gallery.publish_style("author", s["id"], title="V1", description="", category="journal",
                                 trading_style=None, conn=conn)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    js.update_style("author", s["id"], {"name": "Weekend Prep 2"}, conn)
    again = gallery.publish_style("author", s["id"], title="V2", description="", category="journal",
                                  trading_style=None, conn=conn)
    assert again["id"] == item["id"]
    listed = gallery.get_item("viewer", item["id"], conn=conn)
    assert listed["title"] == "V1" and listed["version"] == 1           # still the approved version
    queue = gallery.admin_queue(conn=conn)
    rev = next(r for r in queue["pending"] if r["id"] == item["id"])
    assert rev["hasRevision"] is True and rev["revisionTitle"] == "V2"
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)
    after = gallery.get_item("viewer", item["id"], conn=conn)
    assert after["title"] == "V2" and after["version"] == 2
    assert gallery.get_item("author", item["id"], conn=conn)["hasRevision"] is False
    assert tuple(conn.execute("SELECT pending_json, pending_at FROM j2_template_gallery WHERE id = ?",
                              (item["id"],)).fetchone()) == (None, None)


def test_a_revision_approval_names_the_version_the_reviewer_saw(conn, lib_on):
    s = _style(conn)
    item = _publish(conn, s["id"], title="V1")
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    _publish(conn, s["id"], title="V2")
    seen = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    _publish(conn, s["id"], title="V3")                                  # the author resubmits after the review began
    with pytest.raises(gallery.GalleryConflict):
        gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=seen["updatedAt"], conn=conn)
    with pytest.raises(gallery.GalleryConflict):
        gallery.admin_act("admin", item["id"], "approve", conn=conn)     # no version named: nothing is listed unseen
    assert gallery.get_item("viewer", item["id"], conn=conn)["title"] == "V1"


def test_rejecting_a_revision_keeps_the_listed_version(conn, lib_on):
    s = _style(conn)
    item = gallery.publish_style("author", s["id"], title="V1", description="", category="journal",
                                 trading_style=None, conn=conn)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    gallery.publish_style("author", s["id"], title="V2", description="", category="journal",
                          trading_style=None, conn=conn)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    gallery.admin_act("admin", item["id"], "reject", note="Too thin", conn=conn)
    listed = gallery.get_item("viewer", item["id"], conn=conn)
    assert listed["title"] == "V1" and listed["version"] == 1
    mine = gallery.get_item("author", item["id"], conn=conn)
    assert mine["reviewNote"] == "Too thin" and mine["hasRevision"] is False
    row = conn.execute("SELECT status, listed_at, featured FROM j2_template_gallery WHERE id = ?",
                       (item["id"],)).fetchone()
    assert row["status"] == "approved" and row["listed_at"] and rev["id"] == item["id"]
    assert all(r["id"] != item["id"] for r in gallery.admin_queue(conn=conn)["pending"])


def test_rejecting_a_first_submission_still_unlists_it(conn, lib_on):
    # A row WITHOUT a revision keeps today's reject (status rejected, off the list).
    s = _style(conn)
    item = _publish(conn, s["id"])
    gallery.admin_act("admin", item["id"], "reject", note="Needs a title", conn=conn)
    assert conn.execute("SELECT status FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone()[0] == "rejected"


def test_publish_style_is_404_with_the_library_off(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    s = _style(conn)
    assert gallery.publish_style("author", s["id"], title="X", description="", category="journal",
                                 trading_style=None, conn=conn) is None


def test_the_admin_queue_lists_only_outlines_while_the_library_is_off(conn, monkeypatch):
    # R-T3-R2, the OFF direction: a style row (pending, or hidden) is not in the reviewer's queue.
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    o = _row(conn, item_type="outline", status="pending", title="O")
    s = _row(conn, item_type="style", status="pending", title="S")
    hs = _row(conn, item_type="style", status="approved", title="HS")
    ho = _row(conn, item_type="outline", status="approved", title="HO")
    conn.execute("UPDATE j2_template_gallery SET hidden = 1, hidden_at = ? WHERE id IN (?, ?)",
                 ("2026-10-11T00:00:00+00:00", hs, ho))
    conn.commit()
    queue = gallery.admin_queue(conn=conn)
    assert [r["id"] for r in queue["pending"]] == [o]
    assert [r["id"] for r in queue["hidden"]] == [ho]
    assert s not in [r["id"] for r in queue["pending"]]


def test_the_admin_queue_lists_style_rows_when_the_library_is_on(conn, monkeypatch):
    # R-T3-R2, the ON direction (also the non-vacuity of the test above).
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    o = _row(conn, item_type="outline", status="pending", title="O")
    s = _row(conn, item_type="style", status="pending", title="S")
    hs = _row(conn, item_type="style", status="approved", title="HS")
    conn.execute("UPDATE j2_template_gallery SET hidden = 1, hidden_at = ? WHERE id = ?",
                 ("2026-10-11T00:00:00+00:00", hs))
    conn.commit()
    queue = gallery.admin_queue(conn=conn)
    assert {r["id"] for r in queue["pending"]} == {o, s}
    assert [r["id"] for r in queue["hidden"]] == [hs]


def test_a_style_row_is_the_one_not_found_while_the_library_is_off(conn, monkeypatch):
    # R-T3-w1 (R-P3-10: every style route 404s while off).
    gid = _row(conn, item_type="style", status="approved", user_id="author", title="S")
    oid = _row(conn, item_type="outline", status="approved", user_id="author", title="O")
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    assert gallery.get_item("viewer", gid, conn=conn)["title"] == "S"          # non-vacuity: it reads when on
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    for viewer, admin in (("viewer", False), ("author", False), ("admin", True)):
        assert gallery.get_item(viewer, gid, is_admin=admin, conn=conn) is None
    assert gallery.use_template("viewer", gid, conn=conn) is None
    assert gallery.report("viewer", gid, reason="spam", conn=conn) is None
    assert gallery.get_item("viewer", oid, conn=conn)["title"] == "O"          # an outline is untouched


# ── the route ────────────────────────────────────────────────────────────────────────────

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


def test_post_styles_is_404_while_the_library_is_off(api, conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    s = _style(conn)
    r = api.post("/api/j2/template-gallery/styles", json={"styleId": s["id"], "title": "T", "category": "journal"})
    assert r.status_code == 404
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0] == 0


def test_post_styles_publishes_a_pending_style_item(api, conn, lib_on):
    from api.services.journal_two import note_properties as np
    mine = np.create_property_def("author", "Conviction", "text", None, conn=conn)
    s = _style(conn, properties={mine["id"]: "high"})
    r = api.post("/api/j2/template-gallery/styles",
                 json={"styleId": s["id"], "title": "Weekend Prep", "description": "d", "category": "journal",
                       "tradingStyle": "swing"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["template"]["itemType"] == "style" and body["template"]["status"] == "pending"
    assert body["template"]["tradingStyle"] == "swing"
    assert body["droppedProperties"] == 1 and "droppedProperties" not in body["template"]


def test_post_styles_refusals(api, conn, lib_on):
    from api.services.journal_two import note_kinds as nk
    s = _style(conn)
    assert api.post("/api/j2/template-gallery/styles",
                    json={"styleId": "nope", "title": "T", "category": "journal"}).status_code == 404
    assert api.post("/api/j2/template-gallery/styles",
                    json={"styleId": s["id"], "title": "", "category": "journal"}).status_code == 400
    kind = nk.create_kind("author", "My scalps", conn=conn)
    custom = _style(conn, kindId=kind["id"], name="Scalp")
    r = api.post("/api/j2/template-gallery/styles", json={"styleId": custom["id"], "title": "T", "category": "journal"})
    assert r.status_code == 400 and r.json()["detail"] == gallery.CUSTOM_KIND_SENTENCE


def test_post_styles_is_the_one_404_for_everyone_while_the_library_is_off(api, conn, monkeypatch):
    # R-T4-2 / R-P3-10: a library-off pod looks exactly like today, where POST /styles does not exist.
    # The gate is a ROUTER DEPENDENCY ordered before the session, the plan and the body, so an unpaid
    # member, a paid member and a signed-out caller all get the gallery's one 404.
    from api.middleware import auth_middleware as authmw
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    s = _style(conn)
    body = {"styleId": s["id"], "title": "T", "category": "journal"}
    url = "/api/j2/template-gallery/styles"
    paid = api.post(url, json=body)
    api.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "author", "role": "member", "plan": "free"}
    unpaid = api.post(url, json=body)
    api.app.dependency_overrides.pop(authmw.get_current_user, None)
    api.app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)
    signed_out = api.post(url, content=b"{bad")
    assert (paid.status_code, unpaid.status_code, signed_out.status_code) == (404, 404, 404)
    assert paid.json() == unpaid.json() == signed_out.json()                 # the SAME body, not three different 404s


def test_post_styles_needs_a_paid_plan_while_the_library_is_on(api, conn, lib_on):
    from api.middleware import auth_middleware as authmw
    s = _style(conn)
    api.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "author", "role": "member", "plan": "free"}
    r = api.post("/api/j2/template-gallery/styles", json={"styleId": s["id"], "title": "T", "category": "journal"})
    assert r.status_code == 402
