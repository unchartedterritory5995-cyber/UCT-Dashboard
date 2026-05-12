"""Tests for the Pre-Trade Verdict service."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone, timedelta
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


def _seed_account(db_conn, user_id="u_v"):
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    db_conn.execute(
        """UPDATE j2_accounts
           SET account_size = ?, max_risk_per_trade_pct = ?,
               daily_loss_limit_pct = ?
           WHERE id = ?""",
        (100000.0, 1.0, 3.0, acc["id"]),
    )
    db_conn.commit()
    return acc


def test_hard_check_muted_setup_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET muted_setups = ? WHERE id = ?",
        (json.dumps([{"setup_name": "Bull Flag", "until_date": "2026-12-31"}]), acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 198.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "muted" in result["paragraph"].lower()


def test_hard_check_paper_only_day_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    today = datetime.now(timezone.utc).date().isoformat()
    db_conn.execute(
        "UPDATE j2_accounts SET paper_only_days = ? WHERE id = ?",
        (json.dumps([{"date": today, "reason": "compass_chat"}]), acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 198.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "paper" in result["paragraph"].lower()


def test_hard_check_risk_above_cap_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 180.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "risk" in result["paragraph"].lower()


def test_hard_check_account_size_unset_returns_error(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.get_or_migrate_default_account("u_v", conn=db_conn)
    db_conn.execute("UPDATE j2_accounts SET account_size = 0 WHERE id = ?", (acc["id"],))
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 198.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "ERROR"


def test_hard_check_daily_loss_limit_breached_returns_skip(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    today_iso = datetime.now(timezone.utc).date().isoformat()
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees, regime)
           VALUES (?, 'u_v', ?, 'XYZ', 'Long', 100, 100, ?, 95, ?, 99, 'Pullback',
           NULL, -3500, -3.5, -1, 0, 'Loss', '{}', ?, ?, '[]', '[]', 0, NULL)""",
        (str(uuid.uuid4()), str(uuid.uuid4()),
         f"{today_iso}T14:00:00+00:00", f"{today_iso}T20:00:00+00:00",
         f"{today_iso}T20:00:00+00:00", acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    assert result["label"] == "SKIP"
    assert result["source"] == "hard_check"
    assert "daily" in result["paragraph"].lower() or "loss limit" in result["paragraph"].lower()


class FakeVerdictClient:
    def __init__(self, response_text):
        self.response_text = response_text
        self.calls = []

    def write_verdict(self, *, system_prompt, user_message):
        self.calls.append({"system_prompt": system_prompt, "user_message": user_message})
        return {"body": self.response_text}


def test_llm_path_returns_structured_verdict(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    fake = FakeVerdictClient(json.dumps({
        "label": "GO",
        "paragraph": "Bull Flag at AMBER is your strong zone. Size is in range. Go.",
        "factors": ["Bull Flag +1.8R avg in AMBER", "1% sizing within cap"],
    }))
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        client=fake, conn=db_conn,
    )
    assert result["label"] == "GO"
    assert result["source"] == "llm"
    assert "Bull Flag" in result["paragraph"]
    assert len(result["factors"]) == 2


def test_llm_path_persists_to_j2_verdicts(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    fake = FakeVerdictClient(json.dumps({
        "label": "HOLD",
        "paragraph": "Sample size too small.",
        "factors": ["only 3 prior trades on this setup"],
    }))
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        client=fake, conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT label, paragraph, source FROM j2_verdicts WHERE id = ?",
        (result["verdict_id"],),
    ).fetchone()
    assert row["label"] == "HOLD"
    assert row["source"] == "llm"


def test_hard_check_verdict_also_persisted(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET muted_setups = ? WHERE id = ?",
        (json.dumps([{"setup_name": "Bull Flag", "until_date": "2026-12-31"}]), acc["id"]),
    )
    db_conn.commit()
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        conn=db_conn,
    )
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_verdicts").fetchone()["n"]
    assert n == 1


def test_llm_path_handles_malformed_json_gracefully(db_conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    acc = _seed_account(db_conn)
    fake = FakeVerdictClient("Sorry, I can't help with that.")
    result = ptv.generate_verdict(
        user_id="u_v", account_id=acc["id"],
        params={"symbol": "NVDA", "side": "Long", "shares": 100,
                "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"},
        client=fake, conn=db_conn,
    )
    assert result["label"] in ("HOLD", "SKIP")
