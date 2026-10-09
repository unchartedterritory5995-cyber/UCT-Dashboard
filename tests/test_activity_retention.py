"""Activity data retention: activity_log + page_views rows older than 365 days go.

Owner ruling 2026-10-09. The risk this file exists for is a timestamp-format
mismatch: both tables store ``created_at`` via ``DEFAULT CURRENT_TIMESTAMP``
(UTC text ``YYYY-MM-DD HH:MM:SS``), and a cutoff in any other format makes the
string comparison delete the wrong rows. Every aged row below is produced by
SQLite itself (``datetime(...)``) or by the product's own writers, never by a
hand-typed string, so the tests compare against the REAL stored format.
"""
from __future__ import annotations

import ast
import pathlib
import re
import uuid
from datetime import datetime, timezone

import pytest

from api.services import activity_retention as ar
from api.services import auth_db, auth_service

REPO = pathlib.Path(__file__).resolve().parent.parent
MAIN = REPO / "api" / "main.py"
STORED = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
NOW = datetime(2026, 10, 9, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'x')")
    conn.commit()
    conn.close()
    return tmp_path


def _conn():
    return auth_db.get_connection()


def _add(table: str, created_expr: str, params: tuple = ()) -> str:
    """Insert one row whose created_at is the SQLite expression given."""
    rid = uuid.uuid4().hex
    c = _conn()
    try:
        if table == "activity_log":
            c.execute("INSERT INTO activity_log (id, user_id, action, created_at)"
                      f" VALUES (?, 'u1', 'login', {created_expr})", (rid, *params))
        else:
            c.execute("INSERT INTO page_views (id, user_id, page, created_at)"
                      f" VALUES (?, 'u1', '/dashboard', {created_expr})", (rid, *params))
        c.commit()
    finally:
        c.close()
    return rid


def _ids(table: str) -> set[str]:
    c = _conn()
    try:
        return {r[0] for r in c.execute(f"SELECT id FROM {table}")}
    finally:
        c.close()


# -- the stored format is what the code assumes --------------------------------

def test_the_real_writers_store_created_at_in_the_format_the_cutoff_uses(db):
    """Write through the product's own doors and read the stored text back.
    If a writer ever starts passing an ISO or unix created_at, this goes red
    before the purge silently starts deleting the wrong rows."""
    auth_service.log_activity("u1", "login", "", "1.2.3.4")
    auth_service.log_page_view("u1", "/calendar")
    c = _conn()
    try:
        a = [r[0] for r in c.execute("SELECT created_at FROM activity_log")]
        p = [r[0] for r in c.execute("SELECT created_at FROM page_views")]
    finally:
        c.close()
    assert len(a) == 1 and len(p) == 1, (a, p)   # non-vacuity: both writers wrote
    for v in a + p:
        assert isinstance(v, str) and STORED.match(v), f"unexpected stored created_at: {v!r}"
    assert STORED.match(ar.cutoff_for(NOW))


# -- the cutoff, on both sides, in both tables ---------------------------------

@pytest.mark.parametrize("table", ar.TABLES)
def test_366_days_old_is_deleted_and_364_is_kept(db, table):
    old = _add(table, "datetime('now', '-366 days')")
    young = _add(table, "datetime('now', '-364 days')")
    fresh = _add(table, "CURRENT_TIMESTAMP")
    r = ar.purge_old_activity()
    assert r["ok"] and r["error"] is None, r
    assert r["deleted"][table] == 1, r
    assert _ids(table) == {young, fresh}
    assert old not in _ids(table)


def test_both_tables_purged_in_one_call(db):
    for t in ar.TABLES:
        _add(t, "datetime('now', '-400 days')")
        _add(t, "datetime('now', '-366 days')")
        _add(t, "datetime('now', '-10 days')")
    r = ar.purge_old_activity()
    assert r["deleted"] == {"activity_log": 2, "page_views": 2}, r
    for t in ar.TABLES:
        assert len(_ids(t)) == 1


@pytest.mark.parametrize("table", ar.TABLES)
def test_the_cutoff_is_exact_to_the_second_within_the_cutoff_day(db, table):
    """Seconds either side of the cutoff, on the SAME calendar day. This is the
    case an ISO cutoff ('2025-10-09T12:00:00+00:00') gets wrong: ' ' sorts before
    'T', so every stored row of the cutoff day would read as older and go."""
    base = NOW.strftime("%Y-%m-%d %H:%M:%S")
    before = _add(table, "datetime(?, '-365 days', '-1 seconds')", (base,))
    exact = _add(table, "datetime(?, '-365 days')", (base,))
    after = _add(table, "datetime(?, '-365 days', '+1 seconds')", (base,))
    r = ar.purge_old_activity(now=NOW)
    assert r["cutoff"] == "2025-10-09 12:00:00", r
    assert r["deleted"][table] == 1, r
    assert _ids(table) == {exact, after}
    assert before not in _ids(table)


def test_a_naive_now_is_read_as_utc_and_an_aware_one_is_converted():
    from zoneinfo import ZoneInfo
    assert ar.cutoff_for(datetime(2026, 10, 9, 12, 0, 0)) == "2025-10-09 12:00:00"
    et = datetime(2026, 10, 9, 8, 0, 0, tzinfo=ZoneInfo("America/New_York"))
    assert ar.cutoff_for(et) == "2025-10-09 12:00:00"


# -- batching ---------------------------------------------------------------------

def test_batching_deletes_everything_when_rows_exceed_the_batch(db):
    for _ in range(8):
        _add("activity_log", "datetime('now', '-500 days')")
    for _ in range(4):
        _add("page_views", "datetime('now', '-500 days')")
    keep = _add("activity_log", "datetime('now', '-1 days')")
    r = ar.purge_old_activity(batch=3)
    assert r["deleted"] == {"activity_log": 8, "page_views": 4}, r
    # 8 rows at 3 per batch = 3,3,2 ; 4 rows = 3,1
    assert r["batches"] == {"activity_log": 3, "page_views": 2}, r
    assert r["capped"] == []
    assert _ids("activity_log") == {keep}
    assert _ids("page_views") == set()


def test_max_batches_caps_the_run_and_says_so(db):
    for _ in range(10):
        _add("page_views", "datetime('now', '-500 days')")
    r = ar.purge_old_activity(batch=3, max_batches=2)
    assert r["ok"], r
    assert r["deleted"]["page_views"] == 6
    assert r["capped"] == ["page_views"]
    assert len(_ids("page_views")) == 4
    r2 = ar.purge_old_activity(batch=3, max_batches=2)   # the next day continues
    assert r2["deleted"]["page_views"] == 4 and r2["capped"] == []


# -- empty, refusals, never raising ---------------------------------------------

def test_empty_tables_return_zeros(db):
    r = ar.purge_old_activity()
    assert r["ok"] and r["error"] is None
    assert r["deleted"] == {"activity_log": 0, "page_views": 0}


def test_a_passed_connection_is_used_and_left_open(db):
    _add("activity_log", "datetime('now', '-400 days')")
    c = _conn()
    try:
        r = ar.purge_old_activity(c)
        assert r["deleted"]["activity_log"] == 1
        c.execute("SELECT 1").fetchone()   # still open
    finally:
        c.close()


@pytest.mark.parametrize("days", [0, -1, "365", True])
def test_a_nonsense_window_is_refused_and_deletes_nothing(db, days):
    _add("activity_log", "datetime('now', '-1 days')")
    r = ar.purge_old_activity(days=days)
    assert not r["ok"] and "refused" in r["error"]
    assert len(_ids("activity_log")) == 1


def test_a_database_error_is_reported_not_raised():
    import sqlite3
    c = sqlite3.connect(":memory:")   # no tables: the DELETE fails
    r = ar.purge_old_activity(c)
    assert not r["ok"]
    assert "OperationalError" in r["error"]
    c.close()


def test_the_retention_window_is_one_year():
    assert ar.RETENTION_DAYS == 365


# -- wiring: the job is registered in api/main.py -------------------------------

def _add_job_ids(tree) -> list[str]:
    """Every literal ``id=`` keyword on an ``add_job(...)`` call. An AST, not a
    grep: a grep would also match this file's own strings and main.py comments."""
    out = []
    for n in ast.walk(tree):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "add_job"):
            for kw in n.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    out.append(kw.value.value)
    return out


def test_the_retention_job_is_registered_on_the_scheduler_in_main():
    ids = _add_job_ids(ast.parse(MAIN.read_text(encoding="utf-8")))
    # Non-vacuity: the same probe must see a known neighbouring job, or a walk
    # that matched nothing would pass for both.
    assert "session_cleanup" in ids, "AST probe found no known job id; the probe is broken"
    assert "activity_log_retention" in ids, "activity retention is scheduled nowhere in api/main.py"
    assert ids.count("activity_log_retention") == 1
