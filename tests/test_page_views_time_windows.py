"""page_views time windows compare in the column's own text form.

``page_views.created_at`` defaults to SQLite's CURRENT_TIMESTAMP, stored as
``YYYY-MM-DD HH:MM:SS`` (a space). The three readers used an ISO cutoff
(``...T...+00:00``), and ``' ' < 'T'``, so every same-day row compared as OLDER
than the cutoff:

* ``log_page_view``'s 60-second dedup never matched, so every navigation wrote a row;
* ``get_active_now`` (the admin "active now" list) returned nobody;
* ``get_page_analytics`` dropped the boundary day's later rows.

Each test fails on the ISO cutoff and passes on the stored-format one.
"""
from __future__ import annotations

import pytest

from api.services import auth_db, auth_service


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'x')")
    conn.commit()
    conn.close()
    return tmp_path


def _count(page: str = "/dashboard") -> int:
    c = auth_db.get_connection()
    try:
        return c.execute("SELECT COUNT(*) FROM page_views WHERE user_id='u1' AND page=?", (page,)).fetchone()[0]
    finally:
        c.close()


def test_a_repeat_view_inside_sixty_seconds_is_deduplicated(db):
    auth_service.log_page_view("u1", "/dashboard")
    auth_service.log_page_view("u1", "/dashboard")
    auth_service.log_page_view("u1", "/dashboard")
    assert _count() == 1


def test_the_dedup_is_per_page(db):
    """Control: the dedup must not swallow a DIFFERENT page."""
    auth_service.log_page_view("u1", "/dashboard")
    auth_service.log_page_view("u1", "/journal")
    assert _count("/dashboard") == 1
    assert _count("/journal") == 1


def test_a_view_older_than_sixty_seconds_does_not_block_a_new_one(db):
    """Control: the window has an edge; an old row is not a duplicate."""
    c = auth_db.get_connection()
    c.execute("INSERT INTO page_views (id, user_id, page, created_at)"
              " VALUES ('old', 'u1', '/dashboard', datetime('now', '-5 minutes'))")
    c.commit()
    c.close()
    auth_service.log_page_view("u1", "/dashboard")
    assert _count() == 2


def test_active_now_sees_a_member_who_just_viewed_a_page(db):
    auth_service.log_page_view("u1", "/dashboard")
    out = auth_service.get_active_now(minutes=5)
    assert out["count"] == 1
    assert out["users"][0]["page"] == "/dashboard"


def test_active_now_leaves_out_a_member_seen_an_hour_ago(db):
    c = auth_db.get_connection()
    c.execute("INSERT INTO page_views (id, user_id, page, created_at)"
              " VALUES ('old', 'u1', '/dashboard', datetime('now', '-60 minutes'))")
    c.commit()
    c.close()
    assert auth_service.get_active_now(minutes=5)["count"] == 0


def test_page_analytics_counts_a_view_made_today(db):
    auth_service.log_page_view("u1", "/dashboard")
    rows = auth_service.get_page_analytics(days=1)
    assert rows and rows[0]["page"] == "/dashboard" and rows[0]["views"] == 1


def test_the_cutoff_is_in_the_stored_form(db):
    stamp = auth_service._page_views_cutoff(auth_service.timedelta(seconds=0))
    assert "T" not in stamp and "+" not in stamp and len(stamp) == 19


# -- anonymised rows: account deletion sets page_views.user_id to '' (the column is NOT NULL) --

def _anon_rows(n: int, page: str = "/dashboard") -> None:
    c = auth_db.get_connection()
    for i in range(n):
        c.execute("INSERT INTO page_views (id, user_id, page) VALUES (?, '', ?)", (f"anon-{i}", page))
    c.commit()
    c.close()


def test_anonymised_rows_do_not_inflate_the_unique_visitor_count(db):
    """'' is not a visitor: two anonymised rows beside one real member is still ONE unique user,
    while all three rows still count as views."""
    auth_service.log_page_view("u1", "/dashboard")
    _anon_rows(2)
    rows = auth_service.get_page_analytics(days=1)
    assert len(rows) == 1 and rows[0]["page"] == "/dashboard"
    assert rows[0]["views"] == 3
    assert rows[0]["unique_users"] == 1


def test_a_page_seen_only_by_deleted_members_has_zero_unique_visitors(db):
    _anon_rows(3, "/gone")
    rows = auth_service.get_page_analytics(days=1)
    assert [(r["page"], r["views"], r["unique_users"]) for r in rows] == [("/gone", 3, 0)]


def test_active_now_never_lists_an_anonymised_row(db):
    """Control on the other page_views reader: its JOIN on users already drops ''."""
    _anon_rows(2)
    assert auth_service.get_active_now(minutes=5)["count"] == 0
