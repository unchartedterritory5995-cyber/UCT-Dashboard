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
