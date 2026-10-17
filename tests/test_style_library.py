"""P3a: item types, trading style, sorts and the library switch on the gallery list."""
from __future__ import annotations

import importlib
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
