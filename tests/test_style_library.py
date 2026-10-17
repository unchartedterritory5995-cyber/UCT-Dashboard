"""P3a: item types, trading style, sorts and the library switch on the gallery list."""
from __future__ import annotations

import importlib
import os
import re
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


def test_existing_rows_read_as_outlines(conn):
    gid = _row(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_template_gallery)")}
    assert {"item_type", "payload_json", "version", "trading_style", "source_style_id",
            "pending_json", "pending_at"} <= cols
    assert tuple(conn.execute("SELECT item_type, version FROM j2_template_gallery WHERE id = ?",
                              (gid,)).fetchone()) == ("outline", 1)


def test_library_off_hides_every_style_row_and_route(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    _row(conn, item_type="outline", title="O")
    _row(conn, item_type="style", title="S")
    titles = [t["title"] for t in gallery.list_gallery("v", conn=conn)]
    assert titles == ["O"]
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("v", item_type="style", conn=conn)


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
