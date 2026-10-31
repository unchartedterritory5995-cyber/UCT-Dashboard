"""Account deletion removes the Pine support loop's rows for that member, and only theirs.

`api/services/journal_two/account_purge.py` (owner-approved 2026-10-30): the member's
`indicator_support_reports` by `user_id`, and their `indicator_gap_hits` by the keyed
hash `indicator_support.member_key(user_id)` -- the purge calls that helper rather than
re-implementing the HMAC. Driven through the real service writes on a real auth.db, and
through `purge_user_rows`, the database half of the purge that a restore also replays.
Spec: docs/pine/support-loop/PHASE-A.md.
"""
from __future__ import annotations

import pytest

from api.services import auth_db
from api.services import indicator_support as svc
from api.services.journal_two import account_purge

LEAVER = "u-leaver-0001"
STAYER = "u-stayer-0002"
GAPS = [{"name": "ta.supertrend", "kind": "name-unknown"}, {"name": "ta.kc", "kind": "call-unmapped"}]


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_purge.db"))
    auth_db.init_db()
    monkeypatch.setenv(svc.FLAG_ENV, "1")
    monkeypatch.setenv("PUSH_SECRET", "purge-test-secret")
    for uid in (LEAVER, STAYER):
        svc.create_report(uid, consent=True, source=f"// script of {uid}\nplot(close)\n")
        svc.create_report(uid, consent=True, source=f"// second script of {uid}\nplot(open)\n")
        svc.record_gaps(uid, GAPS, 1)
    return tmp_path


def _rows(sql: str, params=()):
    conn = auth_db.get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _purge(uid: str) -> dict:
    conn = auth_db.get_connection()
    try:
        return account_purge.purge_user_rows(uid, conn)
    finally:
        conn.close()


def test_control_both_members_have_rows_before_the_purge():
    for uid in (LEAVER, STAYER):
        assert len(_rows("SELECT id FROM indicator_support_reports WHERE user_id = ?", (uid,))) == 2
        assert len(_rows("SELECT name FROM indicator_gap_hits WHERE member_key = ?", (svc.member_key(uid),))) == 3


def test_the_purge_removes_this_members_rows_in_each_table():
    report = _purge(LEAVER)
    assert report["ok"], report["errors"]
    assert report["rows_deleted"]["indicator_support_reports"] == 2
    assert report["rows_deleted"]["indicator_gap_hits"] == 3
    assert _rows("SELECT id FROM indicator_support_reports WHERE user_id = ?", (LEAVER,)) == []
    assert _rows("SELECT name FROM indicator_gap_hits WHERE member_key = ?", (svc.member_key(LEAVER),)) == []


def test_the_purge_leaves_other_members_rows_untouched():
    before_reports = _rows("SELECT * FROM indicator_support_reports WHERE user_id = ? ORDER BY id", (STAYER,))
    before_gaps = _rows("SELECT * FROM indicator_gap_hits WHERE member_key = ? ORDER BY name",
                        (svc.member_key(STAYER),))
    _purge(LEAVER)
    assert _rows("SELECT * FROM indicator_support_reports WHERE user_id = ? ORDER BY id", (STAYER,)) == before_reports
    assert _rows("SELECT * FROM indicator_gap_hits WHERE member_key = ? ORDER BY name",
                 (svc.member_key(STAYER),)) == before_gaps
    # and nothing else is left over: what remains is exactly the stayer's
    assert {r[0] for r in _rows("SELECT DISTINCT user_id FROM indicator_support_reports")} == {STAYER}
    assert {r[0] for r in _rows("SELECT DISTINCT member_key FROM indicator_gap_hits")} == {svc.member_key(STAYER)}


def test_the_gap_hash_delete_matches_the_stored_hash():
    """The key the purge deletes by is the key the write stored: read it back off the
    table (the only member key there for that write) and check the purge removes it."""
    conn = auth_db.get_connection()
    try:
        conn.execute("DELETE FROM indicator_gap_hits")
        conn.commit()
    finally:
        conn.close()
    svc.record_gaps(LEAVER, GAPS[:1])
    stored = {r[0] for r in _rows("SELECT member_key FROM indicator_gap_hits")}
    assert len(stored) == 1 and LEAVER not in next(iter(stored))
    assert _purge(LEAVER)["rows_deleted"]["indicator_gap_hits"] == 1
    assert _rows("SELECT * FROM indicator_gap_hits") == []


def test_a_pod_where_the_tables_never_existed_is_a_clean_no_op(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "fresh.db"))
    auth_db.init_db()
    report = _purge(LEAVER)
    assert report["ok"], report["errors"]
    assert report["rows_deleted"]["indicator_support_reports"] == 0
    assert report["rows_deleted"]["indicator_gap_hits"] == 0
