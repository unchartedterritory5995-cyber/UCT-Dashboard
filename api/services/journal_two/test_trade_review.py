"""Tests for the per-trade Compass review service."""
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


def _seed_account(db_conn, user_id="u_r"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    defaults = dict(
        symbol="NVDA", side="Long", shares=100, entry_price=200.0,
        entry_date=exit_iso, exit_price=210.0, exit_date=exit_iso,
        original_stop=198.0, setup="Bull Flag", notes=None,
        pnl_dollar=1000.0, pnl_percent=5.0, r_multiple=2.0,
        hold_days=3, result="Win", context_at_entry="{}",
        created_at=exit_iso, mistake_tags="[]", emotion_tags="[]",
        fees=0, regime="AMBER",
    )
    defaults.update(kwargs)
    tid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id, mistake_tags, emotion_tags, fees, regime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (tid, user_id, str(uuid.uuid4()),
         defaults["symbol"], defaults["side"], defaults["shares"],
         defaults["entry_price"], defaults["entry_date"],
         defaults["exit_price"], defaults["exit_date"],
         defaults["original_stop"], defaults["setup"], defaults["notes"],
         defaults["pnl_dollar"], defaults["pnl_percent"], defaults["r_multiple"],
         defaults["hold_days"], defaults["result"], defaults["context_at_entry"],
         defaults["created_at"], account_id, defaults["mistake_tags"],
         defaults["emotion_tags"], defaults["fees"], defaults["regime"]),
    )
    conn.commit()
    return tid


class FakeReviewClient:
    def __init__(self, body):
        self.body = body
        self.calls = []

    def write_review(self, *, system_prompt, user_message):
        self.calls.append({"system_prompt": system_prompt, "user_message": user_message})
        return {"body": self.body}


def test_generate_review_writes_row(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    client = FakeReviewClient(
        "This NVDA Bull Flag at +2.0R landed cleanly. Entry at 200 hit "
        "your stop discipline. The hold of 3 days matches your setup avg. "
        "Takeaway: this is the rhythm — repeat."
    )
    result = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=client, conn=db_conn,
    )
    assert result["body"].startswith("This NVDA")
    assert result["trade_id"] == trade_id
    row = db_conn.execute(
        "SELECT body, summary FROM j2_trade_reviews WHERE trade_id = ?",
        (trade_id,),
    ).fetchone()
    assert row is not None
    assert "Bull Flag" in row["body"]


def test_generate_review_idempotent(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    client = FakeReviewClient("First review body.")
    first = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=client, conn=db_conn,
    )
    second = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=client, conn=db_conn,
    )
    assert first["id"] == second["id"]
    assert len(client.calls) == 1


def test_generate_review_regen_replaces_existing(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=FakeReviewClient("First body."), conn=db_conn,
    )
    second = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id=trade_id,
        client=FakeReviewClient("Second body, refreshed."), conn=db_conn,
        regenerate=True,
    )
    assert "refreshed" in second["body"]
    n = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_trade_reviews WHERE trade_id = ?",
        (trade_id,),
    ).fetchone()["n"]
    assert n == 1


def test_generate_review_returns_error_for_missing_trade(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    result = tr.generate_review(
        user_id="u_r", account_id=acc["id"], trade_id="missing-id",
        client=FakeReviewClient("ignored"), conn=db_conn,
    )
    assert result.get("error") is not None


def test_list_reviews_returns_recent_first(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    t1 = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                       exit_iso="2026-05-10T20:00:00+00:00")
    t2 = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                       exit_iso="2026-05-11T20:00:00+00:00")
    tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=t1,
                       client=FakeReviewClient("review one"), conn=db_conn)
    tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=t2,
                       client=FakeReviewClient("review two"), conn=db_conn)
    out = tr.list_reviews(user_id="u_r", account_id=acc["id"], conn=db_conn)
    assert len(out["reviews"]) == 2
    assert out["reviews"][0]["trade_id"] == t2


def test_set_feedback_updates_row(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    r = tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=trade_id,
                            client=FakeReviewClient("body"), conn=db_conn)
    n = tr.set_feedback(r["id"], feedback="helpful", user_id="u_r", conn=db_conn)
    assert n == 1
    row = db_conn.execute("SELECT feedback FROM j2_trade_reviews WHERE id = ?", (r["id"],)).fetchone()
    assert row["feedback"] == "helpful"


def test_forget_review_marks_forgotten(db_conn):
    from api.services.journal_two import trade_review as tr
    acc = _seed_account(db_conn)
    trade_id = _insert_trade(db_conn, user_id="u_r", account_id=acc["id"],
                              exit_iso="2026-05-11T20:00:00+00:00")
    r = tr.generate_review(user_id="u_r", account_id=acc["id"], trade_id=trade_id,
                            client=FakeReviewClient("body"), conn=db_conn)
    n = tr.forget_review(r["id"], user_id="u_r", conn=db_conn)
    assert n == 1
    out = tr.list_reviews(user_id="u_r", account_id=acc["id"], conn=db_conn)
    assert all(rev["id"] != r["id"] for rev in out["reviews"])
