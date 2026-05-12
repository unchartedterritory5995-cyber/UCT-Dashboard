"""Tests for profile suggestion service + auto-create hooks."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_p"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def test_create_suggestion_inserts_row(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    sid = ps.create_suggestion(
        user_id="u_p", account_id=acc["id"],
        source_type="eod_recap", source_id="recap-123",
        suggestion="Trader said the FOMO observation was wrong — refine that section.",
        conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT source_type, suggestion, status FROM j2_profile_suggestions WHERE id = ?", (sid,)
    ).fetchone()
    assert row["source_type"] == "eod_recap"
    assert "FOMO" in row["suggestion"]
    assert row["status"] == "pending"


def test_list_pending_returns_only_pending(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    s1 = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                               source_type="eod_recap", source_id="r1",
                               suggestion="one", conn=db_conn)
    s2 = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                               source_type="eod_recap", source_id="r2",
                               suggestion="two", conn=db_conn)
    ps.resolve_suggestion(s1, user_id="u_p", conn=db_conn)
    out = ps.list_pending(user_id="u_p", account_id=acc["id"], conn=db_conn)
    ids = [s["id"] for s in out["suggestions"]]
    assert s2 in ids
    assert s1 not in ids


def test_resolve_marks_resolved_with_timestamp(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    sid = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                                source_type="weekly_review", source_id="w1",
                                suggestion="trim X", conn=db_conn)
    n = ps.resolve_suggestion(sid, user_id="u_p", conn=db_conn)
    assert n == 1
    row = db_conn.execute(
        "SELECT status, resolved_at FROM j2_profile_suggestions WHERE id = ?", (sid,)
    ).fetchone()
    assert row["status"] == "resolved"
    assert row["resolved_at"] is not None


def test_dismiss_marks_dismissed(db_conn):
    from api.services.journal_two import profile_suggestions as ps
    acc = _seed_account(db_conn)
    sid = ps.create_suggestion(user_id="u_p", account_id=acc["id"],
                                source_type="trade_review", source_id="t1",
                                suggestion="trim Y", conn=db_conn)
    ps.dismiss_suggestion(sid, user_id="u_p", conn=db_conn)
    row = db_conn.execute(
        "SELECT status FROM j2_profile_suggestions WHERE id = ?", (sid,)
    ).fetchone()
    assert row["status"] == "dismissed"


def test_weekly_review_unhelpful_feedback_creates_suggestion(db_conn):
    """When set_feedback runs with 'unhelpful' on a weekly review, a suggestion is auto-created."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    # Seed a weekly review row
    rid = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_coach_outputs
           (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
           VALUES (?, 'u_p', ?, 'weekly_review', 'body', 'summary', '{}', 0, ?)""",
        (rid, acc["id"], datetime.now(timezone.utc).isoformat()),
    )
    db_conn.commit()
    coach.set_feedback(rid, feedback="unhelpful", user_id="u_p", conn=db_conn)
    n = db_conn.execute(
        """SELECT COUNT(*) AS n FROM j2_profile_suggestions
           WHERE source_id = ? AND source_type = 'weekly_review'""",
        (rid,),
    ).fetchone()["n"]
    assert n == 1


def test_weekly_review_helpful_feedback_does_not_create_suggestion(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    rid = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_coach_outputs
           (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
           VALUES (?, 'u_p', ?, 'weekly_review', 'body', 'summary', '{}', 0, ?)""",
        (rid, acc["id"], datetime.now(timezone.utc).isoformat()),
    )
    db_conn.commit()
    coach.set_feedback(rid, feedback="helpful", user_id="u_p", conn=db_conn)
    n = db_conn.execute(
        """SELECT COUNT(*) AS n FROM j2_profile_suggestions WHERE source_id = ?""",
        (rid,),
    ).fetchone()["n"]
    assert n == 0


def test_trade_review_unhelpful_feedback_creates_suggestion(db_conn):
    """When trade_review.set_feedback runs with 'unhelpful', a suggestion is auto-created."""
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    # Seed a trade + review
    trade_id = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
           VALUES (?, 'u_p', ?, 'NVDA', 'Long', 100, 200, '2026-05-11T18:00:00+00:00',
           205, '2026-05-11T20:00:00+00:00', 198, 'Bull Flag', NULL,
           500, 2.5, 2.0, 0, 'Win', '{}', '2026-05-11T20:00:00+00:00', ?, '[]', '[]', 0)""",
        (trade_id, str(uuid.uuid4()), acc["id"]),
    )
    rid = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trade_reviews
           (id, user_id, account_id, trade_id, body, summary, metadata, feedback, forgotten, created_at)
           VALUES (?, 'u_p', ?, ?, 'body', 'summary', '{}', NULL, 0, ?)""",
        (rid, acc["id"], trade_id, datetime.now(timezone.utc).isoformat()),
    )
    db_conn.commit()
    tr.set_feedback(rid, feedback="unhelpful", user_id="u_p", conn=db_conn)
    n = db_conn.execute(
        """SELECT COUNT(*) AS n FROM j2_profile_suggestions
           WHERE source_id = ? AND source_type = 'trade_review'""",
        (rid,),
    ).fetchone()["n"]
    assert n == 1
