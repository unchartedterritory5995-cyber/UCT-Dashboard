"""Accounts — CRUD, migration, comparison."""

import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _add_user(conn, user_id, email):
    conn.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')",
        (user_id, email),
    )
    conn.commit()


def _add_settings(conn, user_id, *, account_size=100_000, setups=None):
    from api.services.journal_two.settings import default_settings_data
    data = default_settings_data()
    data["accountSize"] = account_size
    if setups is not None:
        data["setups"] = setups
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT OR REPLACE INTO j2_settings "
        "(id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, json.dumps(data), now, now),
    )
    conn.commit()


def _add_position(conn, user_id, *, account_id=None, symbol="NVDA"):
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_positions (
            id, user_id, symbol, side, entry_date, shares, original_shares,
            entry_price, stop_price, breakeven_stop, raise_to_breakeven,
            setup, notes, context_at_entry, created_at, updated_at, account_id
        ) VALUES (?, ?, ?, 'Long', ?, 100, 100, 500, 490, NULL, 0,
                  NULL, NULL, '{}', ?, ?, ?)
        """,
        (pid, user_id, symbol, now, now, now, account_id),
    )
    conn.commit()
    return pid


def _add_trade(conn, user_id, *, account_id=None, pnl=100, result="Win"):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry, created_at,
            account_id
        ) VALUES (?, ?, 'manual', 'NVDA', 'Long', 100, 500, ?, 510, ?,
                  490, NULL, NULL, ?, 0.02, 1.5, 1, ?, '{}', ?, ?)
        """,
        (tid, user_id, now, now, pnl, result, now, account_id),
    )
    conn.commit()
    return tid


# ─── Migration ────────────────────────────────────────────────────────────────


def test_migration_creates_default_account_for_legacy_user(db_conn):
    """First call to get_or_migrate_default_account creates Default
    from existing j2_settings + bulk-assigns positions/trades."""
    from api.services.journal_two.accounts import get_or_migrate_default_account

    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1", account_size=50_000, setups=["VCP", "Breakout"])
    _add_position(db_conn, "u1")
    _add_trade(db_conn, "u1", pnl=100)

    acc = get_or_migrate_default_account("u1", conn=db_conn)
    assert acc["name"] == "Default"
    assert acc["color"] == "blue"
    assert acc["startingBalance"] == 50_000

    # All existing rows assigned
    pos_count = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_positions WHERE account_id = ?",
        (acc["id"],),
    ).fetchone()["n"]
    trade_count = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_trades WHERE account_id = ?",
        (acc["id"],),
    ).fetchone()["n"]
    assert pos_count == 1
    assert trade_count == 1


def test_migration_idempotent(db_conn):
    """Second call returns same account, doesn't double-create."""
    from api.services.journal_two.accounts import get_or_migrate_default_account

    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    a1 = get_or_migrate_default_account("u1", conn=db_conn)
    a2 = get_or_migrate_default_account("u1", conn=db_conn)
    assert a1["id"] == a2["id"]


def test_migration_for_user_without_settings(db_conn):
    """User in users table but no j2_settings → Default with system defaults."""
    from api.services.journal_two.accounts import get_or_migrate_default_account

    _add_user(db_conn, "u1", "u1@x.com")
    acc = get_or_migrate_default_account("u1", conn=db_conn)
    assert acc["name"] == "Default"
    assert acc["startingBalance"] == 100_000  # system default


def test_migration_carries_over_setups_and_share_flag(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, get_account_settings,
    )

    _add_user(db_conn, "u1", "u1@x.com")
    # Build a settings row with shareJournalData=True + setups
    from api.services.journal_two.settings import default_settings_data
    data = default_settings_data()
    data["shareJournalData"] = True
    data["setups"] = ["VCP", "EP"]
    now = datetime.now(timezone.utc).isoformat()
    db_conn.execute(
        "INSERT INTO j2_settings (id, user_id, data, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), "u1", json.dumps(data), now, now),
    )
    db_conn.commit()

    acc = get_or_migrate_default_account("u1", conn=db_conn)
    settings = get_account_settings("u1", acc["id"], conn=db_conn)
    assert settings["setups"] == ["VCP", "EP"]
    assert settings["shareJournalData"] is True


# ─── CRUD ─────────────────────────────────────────────────────────────────────


def test_create_account_with_defaults(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    get_or_migrate_default_account("u1", conn=db_conn)

    acc = create_account("u1", {
        "name": "Paper",
        "color": "purple",
        "broker": "TastyTrade",
        "startingBalance": 25_000,
    }, conn=db_conn)
    assert acc["name"] == "Paper"
    assert acc["color"] == "purple"
    assert acc["broker"] == "TastyTrade"
    assert acc["startingBalance"] == 25_000


def test_create_account_with_copy_settings_from(db_conn):
    """copySettingsFrom clones accountSize/defaultStop/breakevenRange/setups
    from the source account; share_journal_data is NOT copied."""
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account,
        upsert_account_settings, get_account_settings,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    src = get_or_migrate_default_account("u1", conn=db_conn)
    # Customise source settings
    upsert_account_settings("u1", src["id"], {
        "accountSize": 75_000,
        "defaultStop": {"mode": "fixed_dollar_risk", "amount": 250},
        "positionClosing": "FIFO",
        "breakevenRange": {"unit": "$", "value": 50},
        "setups": ["VCP", "EP"],
        "shareJournalData": True,
    }, conn=db_conn)

    new_acc = create_account("u1", {
        "name": "Earnings Plays",
        "color": "magenta",
        "startingBalance": 10_000,
        "copySettingsFrom": src["id"],
    }, conn=db_conn)

    new_settings = get_account_settings("u1", new_acc["id"], conn=db_conn)
    assert new_settings["accountSize"] == 75_000
    assert new_settings["defaultStop"]["amount"] == 250
    assert new_settings["setups"] == ["VCP", "EP"]
    # shareJournalData stays false (privacy default)
    assert new_settings["shareJournalData"] is False


def test_create_account_rejects_duplicate_name(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, AccountConflictError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    get_or_migrate_default_account("u1", conn=db_conn)

    with pytest.raises(AccountConflictError):
        create_account("u1", {
            "name": "Default",
            "color": "blue",
            "startingBalance": 1_000,
        }, conn=db_conn)


def test_create_account_rejects_invalid_color(db_conn):
    from api.services.journal_two.accounts import (
        create_account, AccountValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    with pytest.raises(AccountValidationError):
        create_account("u1", {
            "name": "X", "color": "rainbow", "startingBalance": 1_000,
        }, conn=db_conn)


def test_update_account_renames(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, update_account,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    acc = get_or_migrate_default_account("u1", conn=db_conn)

    updated = update_account("u1", acc["id"], {"name": "Live"}, conn=db_conn)
    assert updated["name"] == "Live"


def test_update_account_rename_to_existing_name_fails(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, update_account,
        AccountConflictError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    a = get_or_migrate_default_account("u1", conn=db_conn)
    b = create_account("u1", {
        "name": "Paper", "color": "purple", "startingBalance": 1_000,
    }, conn=db_conn)
    with pytest.raises(AccountConflictError):
        update_account("u1", b["id"], {"name": "Default"}, conn=db_conn)


def test_delete_account_blocked_when_has_trades(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, delete_account,
        AccountConflictError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    default = get_or_migrate_default_account("u1", conn=db_conn)
    paper = create_account("u1", {
        "name": "Paper", "color": "purple", "startingBalance": 5_000,
    }, conn=db_conn)
    _add_trade(db_conn, "u1", account_id=paper["id"])

    with pytest.raises(AccountConflictError) as excinfo:
        delete_account("u1", paper["id"], conn=db_conn)
    assert excinfo.value.payload["tradeCount"] == 1


def test_delete_empty_account_succeeds(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, delete_account,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    get_or_migrate_default_account("u1", conn=db_conn)
    paper = create_account("u1", {
        "name": "Paper", "color": "purple", "startingBalance": 5_000,
    }, conn=db_conn)
    assert delete_account("u1", paper["id"], conn=db_conn) is True


def test_cannot_delete_only_account(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, delete_account, AccountConflictError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    default = get_or_migrate_default_account("u1", conn=db_conn)
    with pytest.raises(AccountConflictError):
        delete_account("u1", default["id"], conn=db_conn)


def test_purge_deletes_account_with_trades_and_positions(db_conn):
    """purge=True wipes the account's trades + positions and deletes it,
    without requiring a move."""
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, delete_account,
        get_account,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    get_or_migrate_default_account("u1", conn=db_conn)
    paper = create_account("u1", {
        "name": "Paper", "color": "purple", "startingBalance": 5_000,
    }, conn=db_conn)
    _add_trade(db_conn, "u1", account_id=paper["id"])
    _add_trade(db_conn, "u1", account_id=paper["id"])
    _add_position(db_conn, "u1", account_id=paper["id"])

    assert delete_account("u1", paper["id"], conn=db_conn, purge=True) is True
    assert get_account("u1", paper["id"], conn=db_conn) is None
    # Its trades + positions are gone too.
    n_tr = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_trades WHERE account_id = ?",
        (paper["id"],),
    ).fetchone()["n"]
    n_pos = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_positions WHERE account_id = ?",
        (paper["id"],),
    ).fetchone()["n"]
    assert n_tr == 0 and n_pos == 0


def test_purge_only_touches_target_account(db_conn):
    """Purging one account leaves another account's data intact."""
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, delete_account,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    default = get_or_migrate_default_account("u1", conn=db_conn)
    paper = create_account("u1", {
        "name": "Paper", "color": "purple", "startingBalance": 5_000,
    }, conn=db_conn)
    _add_trade(db_conn, "u1", account_id=default["id"])
    _add_trade(db_conn, "u1", account_id=paper["id"])

    delete_account("u1", paper["id"], conn=db_conn, purge=True)

    kept = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_trades WHERE account_id = ?",
        (default["id"],),
    ).fetchone()["n"]
    assert kept == 1


def test_cannot_purge_only_account(db_conn):
    """The last remaining account can't be purged either — guard runs
    before any data is wiped."""
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, delete_account, AccountConflictError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    default = get_or_migrate_default_account("u1", conn=db_conn)
    _add_trade(db_conn, "u1", account_id=default["id"])

    with pytest.raises(AccountConflictError):
        delete_account("u1", default["id"], conn=db_conn, purge=True)
    # Data must survive a refused purge.
    n_tr = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_trades WHERE account_id = ?",
        (default["id"],),
    ).fetchone()["n"]
    assert n_tr == 1


def test_user_isolation(db_conn):
    """User A can't see / update / delete user B's accounts."""
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, list_accounts, get_account,
    )
    _add_user(db_conn, "alice", "alice@x.com")
    _add_user(db_conn, "bob", "bob@x.com")
    _add_settings(db_conn, "alice")
    _add_settings(db_conn, "bob")
    a = get_or_migrate_default_account("alice", conn=db_conn)
    b = get_or_migrate_default_account("bob", conn=db_conn)

    alice_accs = list_accounts("alice", conn=db_conn)
    assert len(alice_accs) == 1
    assert alice_accs[0]["id"] == a["id"]

    # Alice trying to fetch Bob's account
    assert get_account("alice", b["id"], conn=db_conn) is None


# ─── Move trades ──────────────────────────────────────────────────────────────


def test_move_all_to(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, move_all_to,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    default = get_or_migrate_default_account("u1", conn=db_conn)
    paper = create_account("u1", {
        "name": "Paper", "color": "purple", "startingBalance": 5_000,
    }, conn=db_conn)
    _add_trade(db_conn, "u1", account_id=default["id"])
    _add_trade(db_conn, "u1", account_id=default["id"])
    _add_position(db_conn, "u1", account_id=default["id"])

    result = move_all_to("u1", default["id"], paper["id"], conn=db_conn)
    assert result["movedTrades"] == 2
    assert result["movedPositions"] == 1


def test_move_to_self_rejected(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, move_all_to, AccountValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    default = get_or_migrate_default_account("u1", conn=db_conn)
    with pytest.raises(AccountValidationError):
        move_all_to("u1", default["id"], default["id"], conn=db_conn)


# ─── Comparison ───────────────────────────────────────────────────────────────


def test_comparison_metrics(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, create_account, comparison,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1", account_size=100_000)
    default = get_or_migrate_default_account("u1", conn=db_conn)
    paper = create_account("u1", {
        "name": "Paper", "color": "purple", "startingBalance": 25_000,
    }, conn=db_conn)
    # 2 winners + 1 loss in Default
    _add_trade(db_conn, "u1", account_id=default["id"], pnl=200, result="Win")
    _add_trade(db_conn, "u1", account_id=default["id"], pnl=300, result="Win")
    _add_trade(db_conn, "u1", account_id=default["id"], pnl=-100, result="Loss")
    # 1 winner in Paper
    _add_trade(db_conn, "u1", account_id=paper["id"], pnl=50, result="Win")

    got = comparison("u1", conn=db_conn)
    by_name = {a["name"]: a for a in got["accounts"]}
    assert by_name["Default"]["totalPnl"] == 400
    assert by_name["Default"]["winRate"] == pytest.approx(2 / 3)
    assert by_name["Default"]["currentBalance"] == 100_400
    assert by_name["Paper"]["totalPnl"] == 50
    assert by_name["Paper"]["currentBalance"] == 25_050


# ─── Per-account settings ─────────────────────────────────────────────────────


def test_get_account_settings_returns_default_on_first_call(db_conn):
    from api.services.journal_two.accounts import get_account_settings
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1", account_size=42_000, setups=["VCP"])

    settings = get_account_settings("u1", None, conn=db_conn)
    assert settings["accountName"] == "Default"
    assert settings["accountSize"] == 42_000
    assert settings["setups"] == ["VCP"]


def test_update_goals_round_trip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, update_goals, get_account,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    acc = get_or_migrate_default_account("u1", conn=db_conn)

    updated = update_goals("u1", acc["id"], {
        "daily": 100,
        "weekly": 500,
        "monthly": 2000,
        "yearly": 24000,
    }, conn=db_conn)
    assert updated["goals"]["daily"] == 100
    assert updated["goals"]["yearly"] == 24000


def test_update_goals_drops_unknown_keys(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, update_goals,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    acc = get_or_migrate_default_account("u1", conn=db_conn)

    updated = update_goals("u1", acc["id"], {
        "daily": 100,
        "hourly": 999,  # unknown — dropped
    }, conn=db_conn)
    assert "hourly" not in updated["goals"]
    assert updated["goals"]["daily"] == 100


def test_update_goals_rejects_negative(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, update_goals, AccountValidationError,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    acc = get_or_migrate_default_account("u1", conn=db_conn)
    with pytest.raises(AccountValidationError):
        update_goals("u1", acc["id"], {"daily": -50}, conn=db_conn)


def test_goal_progress_with_targets(db_conn):
    """Compute current Y/M/W/D P&L vs targets."""
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, update_goals, goal_progress,
    )
    from datetime import datetime, timezone
    _add_user(db_conn, "u1", "u1@x.com")
    acc = get_or_migrate_default_account("u1", conn=db_conn)
    update_goals("u1", acc["id"], {
        "daily": 100, "weekly": 500, "monthly": 2000, "yearly": 24000,
    }, conn=db_conn)

    # Trade dated today (ET) so all 4 periods include it.
    now_iso = datetime.now(timezone.utc).isoformat()
    _add_trade(db_conn, "u1", account_id=acc["id"], pnl=50, result="Win")
    # Override exit_date to "now" to land in today bucket
    db_conn.execute(
        "UPDATE j2_trades SET exit_date = ? WHERE user_id = ?",
        (now_iso, "u1"),
    )
    db_conn.commit()

    got = goal_progress("u1", acc["id"], conn=db_conn)
    assert got["periods"]["daily"]["target"] == 100
    assert got["periods"]["daily"]["pnl"] == 50
    assert got["periods"]["daily"]["progress"] == 0.5


def test_upsert_account_settings_round_trip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, upsert_account_settings,
        get_account_settings,
    )
    _add_user(db_conn, "u1", "u1@x.com")
    _add_settings(db_conn, "u1")
    acc = get_or_migrate_default_account("u1", conn=db_conn)

    upsert_account_settings("u1", acc["id"], {
        "accountSize": 200_000,
        "defaultStop": {"mode": "fixed_percent_distance", "percent": 5},
        "positionClosing": "LIFO",
        "breakevenRange": {"unit": "%", "value": 0.5},
        "setups": ["VCP", "EP", "Breakout"],
        "shareJournalData": True,
    }, conn=db_conn)

    settings = get_account_settings("u1", acc["id"], conn=db_conn)
    assert settings["accountSize"] == 200_000
    assert settings["positionClosing"] == "LIFO"
    assert settings["setups"] == ["VCP", "EP", "Breakout"]
    assert settings["shareJournalData"] is True


def test_phase_a_guards_roundtrip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, upsert_account_settings,
        get_account_settings,
    )
    user_id = "u_phase_a_roundtrip"
    account = get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "defaultSizePct": 5,
        "defaultRMultipleTarget": 2,
        "maxRiskPerTradePct": 1,
    }
    saved = upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["defaultSizePct"] == 5.0
    assert saved["defaultRMultipleTarget"] == 2.0
    assert saved["maxRiskPerTradePct"] == 1.0

    fresh = get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["defaultSizePct"] == 5.0
    assert fresh["defaultRMultipleTarget"] == 2.0
    assert fresh["maxRiskPerTradePct"] == 1.0


def test_phase_b_guards_roundtrip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, upsert_account_settings,
        get_account_settings,
    )
    user_id = "u_phase_b_roundtrip"
    account = get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "dailyLossLimitPct": 2,
        "coolingOffMinutesAfterLoss": 15,
        "noTradeWindowsET": [{"start": "11:30", "end": "13:30", "label": "Lunch"}],
    }
    saved = upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["dailyLossLimitPct"] == 2.0
    assert saved["coolingOffMinutesAfterLoss"] == 15
    assert saved["noTradeWindowsET"] == [{"start": "11:30", "end": "13:30", "label": "Lunch"}]

    fresh = get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["dailyLossLimitPct"] == 2.0
    assert fresh["coolingOffMinutesAfterLoss"] == 15
    assert fresh["noTradeWindowsET"] == [{"start": "11:30", "end": "13:30", "label": "Lunch"}]


def test_phase_c_guards_roundtrip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, upsert_account_settings,
        get_account_settings,
    )
    user_id = "u_phase_c_roundtrip"
    account = get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": ["Bull Flag", "Pullback"],
        "shareJournalData": False,
        "tradingMode": "both",
        "aPlusSetups": ["Bull Flag"],
        "aPlusRiskMultiplier": 1.5,
    }
    saved = upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["aPlusSetups"] == ["Bull Flag"]
    assert saved["aPlusRiskMultiplier"] == 1.5

    fresh = get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["aPlusSetups"] == ["Bull Flag"]
    assert fresh["aPlusRiskMultiplier"] == 1.5


def test_phase_d_regime_multipliers_roundtrip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, upsert_account_settings,
        get_account_settings,
    )
    user_id = "u_phase_d_roundtrip"
    account = get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "regimeSizeMultipliers": {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0},
    }
    saved = upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["regimeSizeMultipliers"] == {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0.0}

    fresh = get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["regimeSizeMultipliers"] == {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0.0}


def test_phase_e_taxonomies_roundtrip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, upsert_account_settings,
        get_account_settings,
    )
    user_id = "u_phase_e_roundtrip"
    account = get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "mistakeTags": ["fomo", "chasing"],
        "emotionTags": ["greedy", "anxious"],
    }
    saved = upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["mistakeTags"] == ["fomo", "chasing"]
    assert saved["emotionTags"] == ["greedy", "anxious"]

    fresh = get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["mistakeTags"] == ["fomo", "chasing"]
    assert fresh["emotionTags"] == ["greedy", "anxious"]


def test_phase_f_thresholds_roundtrip(db_conn):
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, upsert_account_settings,
        get_account_settings,
    )
    user_id = "u_phase_f_roundtrip"
    account = get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "lossStreakThreshold": 4,
        "winStreakThreshold": 7,
        "staleHoldDaysThreshold": 45,
    }
    saved = upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["lossStreakThreshold"] == 4
    assert saved["winStreakThreshold"] == 7
    assert saved["staleHoldDaysThreshold"] == 45

    fresh = get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["lossStreakThreshold"] == 4
    assert fresh["winStreakThreshold"] == 7
    assert fresh["staleHoldDaysThreshold"] == 45


def test_trader_profile_roundtrip(db_conn):
    """Settings doesn't expose trader_profile via PortfolioSettingsModal (the
    Coach writes it directly), but _account_to_settings should still surface
    it so the Coach can read it back."""
    from api.services.journal_two.accounts import (
        get_or_migrate_default_account, get_account_settings,
    )
    user_id = "u_coach_profile"
    account = get_or_migrate_default_account(user_id, conn=db_conn)
    # Direct DB write — emulates the Coach's path
    db_conn.execute(
        "UPDATE j2_accounts SET trader_profile = ? WHERE id = ?",
        ("# Test profile\n\nSome content.", account["id"]),
    )
    db_conn.commit()
    settings = get_account_settings(user_id, account["id"], conn=db_conn)
    assert settings.get("traderProfile") == "# Test profile\n\nSome content."


def test_compass_enabled_roundtrip(db_conn):
    from api.services.journal_two import accounts as accounts_service
    user_id = "u_compass_toggle"
    account = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "compassEnabled": False,
    }
    saved = accounts_service.upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["compassEnabled"] is False
    fresh = accounts_service.get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["compassEnabled"] is False
