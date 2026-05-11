"""Tests for the Compass orchestrator. Anthropic client is mocked."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
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

def _seed_account(db_conn, user_id="u_coach"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)

class FakeClient:
    def __init__(self, *, review_body, summary, observations, updated_profile=""):
        self.review_body = review_body
        self.summary = summary
        self.observations = observations
        self.updated_profile = updated_profile
        self.calls: list[dict] = []
    def write_review(self, *, system_prompt, user_message):
        self.calls.append({"kind": "review", "system": system_prompt, "user": user_message})
        return {"body": self.review_body, "summary": self.summary, "key_observations": self.observations}
    def write_profile_update(self, *, system_prompt, user_message):
        self.calls.append({"kind": "profile", "system": system_prompt, "user": user_message})
        return {"updated_profile": self.updated_profile}

def test_generate_weekly_review_writes_output_row(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    client = FakeClient(review_body="# Week of 2026-05-04\n\nBody text.", summary="Quiet week.", observations=["obs A", "obs B"])
    result = coach.generate_weekly_review(user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", client=client, conn=db_conn)
    assert result["body"].startswith("# Week of 2026-05-04")
    row = db_conn.execute("SELECT * FROM j2_coach_outputs WHERE user_id = ? AND account_id = ?", ("u_coach", acc["id"])).fetchone()
    assert row is not None
    assert row["output_type"] in ("weekly_review", "profile_update")

def test_generate_weekly_review_updates_trader_profile(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    client = FakeClient(review_body="# Body", summary="s", observations=[], updated_profile="# Trader Profile\n\nFresh updated content.")
    coach.generate_weekly_review(user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", client=client, conn=db_conn)
    row = db_conn.execute("SELECT trader_profile FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    assert "Fresh updated content" in row["trader_profile"]

def test_generate_weekly_review_idempotent_on_same_week(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    client = FakeClient(review_body="# Body", summary="s", observations=[])
    first = coach.generate_weekly_review(user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", client=client, conn=db_conn)
    second = coach.generate_weekly_review(user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", client=client, conn=db_conn)
    assert first["id"] == second["id"]
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_coach_outputs WHERE output_type = 'weekly_review'").fetchone()["n"]
    assert n == 1


# ── Phase G v2: EOD orchestrator ────────────────────────────────────────────


class FakeEODClient:
    """FakeClient supporting EOD + retry behavior. Lets a test script multiple
    responses across calls so we can simulate the retry loop."""
    def __init__(self, *, responses: list[dict], updated_profile: str = ""):
        # responses: list of dicts each containing {body, summary, key_observations?}
        self.responses = list(responses)
        self.updated_profile = updated_profile
        self.calls: list[dict] = []

    def _pop(self):
        if not self.responses:
            raise RuntimeError("FakeEODClient ran out of responses")
        return self.responses.pop(0)

    def write_review(self, *, system_prompt, user_message):
        self.calls.append({"kind": "review", "user": user_message})
        return self._pop()

    def write_profile_update(self, *, system_prompt, user_message):
        self.calls.append({"kind": "profile", "user": user_message})
        return {"updated_profile": self.updated_profile}

    def write_eod_recap(self, *, system_prompt, user_message):
        self.calls.append({"kind": "eod", "user": user_message})
        return self._pop()


def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    """Insert a closed trade with sensible defaults (mirrors helper in
    test_coach_data_assembler.py — duplicated here so tests are self-contained)."""
    defaults = dict(
        symbol="TEST", side="Long", shares=100,
        entry_price=100.0, entry_date=exit_iso,
        exit_price=105.0, exit_date=exit_iso,
        original_stop=95.0, setup="Bull Flag", notes=None,
        pnl_dollar=500.0, pnl_percent=5.0, r_multiple=1.0,
        hold_days=2, result="Win", context_at_entry="{}",
        created_at=exit_iso, mistake_tags="[]", emotion_tags="[]",
        fees=0, regime=None,
    )
    defaults.update(kwargs)
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id, mistake_tags, emotion_tags, fees, regime
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()), user_id, str(uuid.uuid4()),
            defaults["symbol"], defaults["side"], defaults["shares"],
            defaults["entry_price"], defaults["entry_date"],
            defaults["exit_price"], defaults["exit_date"],
            defaults["original_stop"], defaults["setup"], defaults["notes"],
            defaults["pnl_dollar"], defaults["pnl_percent"], defaults["r_multiple"],
            defaults["hold_days"], defaults["result"], defaults["context_at_entry"],
            defaults["created_at"], account_id, defaults["mistake_tags"],
            defaults["emotion_tags"], defaults["fees"], defaults["regime"],
        ),
    )
    conn.commit()


def test_generate_eod_recap_writes_row(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    client = FakeEODClient(responses=[
        {
            "body": "Today's two trades were a mixed read. The Pullback on AAPL "
                    "(+2.1R) was clean. What was different about today's AAPL "
                    "entry compared to your prior Pullbacks this week?",
            "summary": "Mixed day.",
            "key_observations": [],
        },
    ])
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    out = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    assert out["body"].startswith("Today's two trades")
    row = db_conn.execute(
        "SELECT output_type, metadata FROM j2_coach_outputs WHERE user_id = ? AND account_id = ?",
        ("u_coach", acc["id"]),
    ).fetchone()
    assert row["output_type"] == "eod_recap"
    meta = json.loads(row["metadata"])
    assert meta.get("day") == "2026-05-11"


def test_generate_eod_recap_idempotent_on_same_day(db_conn):
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    body = ("Today's read on AAPL was clean — the Pullback delivered +2.1R. "
            "What about today's entry was different from your prior AAPL Pullbacks?")
    client = FakeEODClient(responses=[
        {"body": body, "summary": "Clean Pullback day.", "key_observations": []},
    ])
    first = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    second = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    assert first["id"] == second["id"]
    n = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()["n"]
    assert n == 1


def test_generate_eod_recap_retries_on_validation_failure(db_conn):
    """First response invents an R-multiple; second response is clean."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    bad_body = ("AAPL delivered +9.9R today (hallucinated). What about your AAPL entry stood out?")
    good_body = ("AAPL's Pullback delivered +2.1R today. What about your AAPL entry stood out today?")
    client = FakeEODClient(responses=[
        {"body": bad_body, "summary": "", "key_observations": []},
        {"body": good_body, "summary": "Clean.", "key_observations": []},
    ])
    out = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    eod_calls = [c for c in client.calls if c["kind"] == "eod"]
    assert len(eod_calls) == 2
    assert "+2.1R" in out["body"]
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()
    meta = json.loads(row["metadata"])
    assert meta.get("validation", {}).get("passed") is True


def test_generate_eod_recap_persists_with_flag_after_second_failure(db_conn):
    """Both responses fail validation — orchestrator stores the second one
    with passed=false so the user sees the ⚠ badge."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-11T20:00:00+00:00",
        symbol="AAPL", setup="Pullback", r_multiple=2.1, pnl_dollar=420, result="Win",
    )
    bad1 = "AAPL +9.9R today. Did you stick to your plan?"
    bad2 = "AAPL +8.8R today. Want to keep doing Pullbacks?"
    client = FakeEODClient(responses=[
        {"body": bad1, "summary": "", "key_observations": []},
        {"body": bad2, "summary": "", "key_observations": []},
    ])
    coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()
    meta = json.loads(row["metadata"])
    assert meta["validation"]["passed"] is False
    assert len(meta["validation"]["flags"]) > 0


def test_generate_eod_recap_skips_when_no_activity(db_conn):
    """No trades AND no open positions today → return skip sentinel, write nothing."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    client = FakeEODClient(responses=[])   # would error if called
    out = coach.generate_eod_recap(
        user_id="u_coach", account_id=acc["id"], day="2026-05-11",
        client=client, conn=db_conn,
    )
    assert out.get("skipped") is True
    n = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_coach_outputs WHERE output_type = 'eod_recap'",
    ).fetchone()["n"]
    assert n == 0


def test_generate_weekly_review_writes_this_weeks_focus_to_metadata(db_conn):
    """v2 amendment: Weekly Review extracts the focus section at write time."""
    from api.services.journal_two import coach
    acc = _seed_account(db_conn)
    body = (
        "# Week of 2026-05-04 — Compass's Review\n\n"
        "Mixed week.\n\n"
        "## Performance\nNet P&L: +$500\n\n"
        "## This week's focus\n"
        "Skip Pullback setups entirely. You're -3.1R YTD on them.\n"
    )
    client = FakeEODClient(responses=[
        {"body": body, "summary": "Mixed.", "key_observations": []},
    ])
    coach.generate_weekly_review(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04",
        client=client, conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE output_type='weekly_review'",
    ).fetchone()
    meta = json.loads(row["metadata"])
    assert "this_weeks_focus" in meta
    assert "Skip Pullback" in meta["this_weeks_focus"]
