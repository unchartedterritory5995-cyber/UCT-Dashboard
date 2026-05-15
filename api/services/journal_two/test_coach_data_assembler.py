"""Tests for the Coach data assembler.

These tests verify that the assembler produces the right shape from
seeded DB rows. No Anthropic involvement — pure data assembly.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

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


def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    """Insert a closed trade with sensible defaults."""
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


def test_assemble_week_empty_returns_skeleton(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    week_start = "2026-05-04"  # a Monday
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start=week_start, conn=db_conn,
    )
    assert data["week"]["range"].startswith(week_start)
    assert data["week"]["trades"] == []
    assert data["week"]["aggregates"]["trade_count"] == 0
    assert data["trader_profile"] == ""
    assert data["memory"] == []


def test_assemble_week_includes_trades_in_range(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    # Insert 3 trades in the target week (Mon-Fri 2026-05-04 to 2026-05-08)
    for day in ("2026-05-04", "2026-05-06", "2026-05-08"):
        iso = f"{day}T20:00:00+00:00"
        _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"], exit_iso=iso)
    # Insert one trade OUTSIDE the range
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"], exit_iso="2026-04-28T20:00:00+00:00")

    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    assert data["week"]["aggregates"]["trade_count"] == 3
    assert len(data["week"]["trades"]) == 3


def test_aggregates_compute_win_rate_and_total_r(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    for r, result in [(2.0, "Win"), (1.0, "Win"), (-1.0, "Loss")]:
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso="2026-05-05T20:00:00+00:00",
            r_multiple=r, result=result,
            pnl_dollar=100 * r, pnl_percent=r,
        )
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    agg = data["week"]["aggregates"]
    assert agg["wins"] == 2
    assert agg["losses"] == 1
    assert abs(agg["win_rate"] - (2 / 3)) < 1e-6
    assert abs(agg["avg_r"] - (2.0 / 3)) < 1e-6
    assert agg["trade_count"] == 3


def test_setup_performance_groups_by_setup(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-05T20:00:00+00:00", setup="Bull Flag", r_multiple=2.0, result="Win")
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-06T20:00:00+00:00", setup="Bull Flag", r_multiple=-1.0, result="Loss",
                  pnl_dollar=-100)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-07T20:00:00+00:00", setup="Pullback", r_multiple=1.0, result="Win")
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    setups = {s["setup"]: s for s in data["week"]["setup_performance"]}
    assert setups["Bull Flag"]["trade_count"] == 2
    assert abs(setups["Bull Flag"]["total_r"] - 1.0) < 1e-6
    assert setups["Pullback"]["trade_count"] == 1


def test_includes_recent_coach_memory(db_conn):
    """When prior weekly_review rows exist, memory list is populated."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    # Seed 2 prior weekly_review rows
    import json
    for week, summary in [("2026-04-27", "Last week summary"), ("2026-04-20", "Older summary")]:
        db_conn.execute(
            """
            INSERT INTO j2_coach_outputs (id, user_id, account_id, output_type, body, summary, metadata, created_at)
            VALUES (?, ?, ?, 'weekly_review', ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()), "u_coach", acc["id"],
                "full body", summary,
                json.dumps({"week_start": week, "key_observations": ["obs A", "obs B"]}),
                f"{week}T20:00:00+00:00",
            ),
        )
    db_conn.commit()

    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    assert len(data["memory"]) == 2
    assert data["memory"][0]["summary"] == "Last week summary"
    assert data["memory"][0]["key_observations"] == ["obs A", "obs B"]


def test_discipline_events_count_a_plus_taken_and_breaches(db_conn):
    """When the user has maxRiskPerTradePct=1% and aPlusSetups=['Bull Flag'],
    a Bull Flag trade with 2% risk should still count as a breach (1.5x mult
    = 1.5% effective cap), and the trade should be counted as a_plus_taken."""
    from api.services.journal_two import coach_data_assembler as assembler
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    # Configure settings
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": ["Bull Flag"],
        "shareJournalData": False,
        "tradingMode": "both",
        "maxRiskPerTradePct": 1,
        "aPlusSetups": ["Bull Flag"],
        "aPlusRiskMultiplier": 1.5,
    }
    accounts_service.upsert_account_settings("u_coach", acc["id"], payload, conn=db_conn)
    # Insert a Bull Flag trade with 2% risk:
    # 100 sh × ($100 - $80) = $2000 risk = 2% of $100k. Cap is 1% × 1.5 = 1.5%.
    # 2% > 1.5% → breach.
    _insert_trade(
        db_conn, user_id="u_coach", account_id=acc["id"],
        exit_iso="2026-05-05T20:00:00+00:00",
        setup="Bull Flag", side="Long",
        shares=100, entry_price=100.0, original_stop=80.0,
        result="Win", pnl_dollar=500, r_multiple=2.5,
    )
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    de = data["week"]["discipline_events"]
    assert de["a_plus_taken"] == 1
    assert de["risk_cap_breaches"] == 1
    assert de["risk_cap_overrides"] == 1


def test_discipline_events_daily_loss_lockouts(db_conn):
    """3 losing trades on the same day summing to -3% (vs 2% limit) should
    trigger 1 daily_loss_lockout (one breached day)."""
    from api.services.journal_two import coach_data_assembler as assembler
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings("u_coach", acc["id"], {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "dailyLossLimitPct": 2,
    }, conn=db_conn)
    for _ in range(3):
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso="2026-05-05T20:00:00+00:00",
            result="Loss", pnl_dollar=-1000, r_multiple=-1.0,
        )
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    assert data["week"]["discipline_events"]["daily_loss_lockouts"] == 1


def test_discipline_events_cooling_off_counts_losing_trades(db_conn):
    """Each Loss trade in the week is a cooling-off-candidate when the
    setting is enabled. 2 losses in the week → cooling_off_fires=2."""
    from api.services.journal_two import coach_data_assembler as assembler
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings("u_coach", acc["id"], {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "coolingOffMinutesAfterLoss": 15,
    }, conn=db_conn)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-05T20:00:00+00:00", result="Loss",
                  pnl_dollar=-100, r_multiple=-1.0)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-07T20:00:00+00:00", result="Loss",
                  pnl_dollar=-100, r_multiple=-1.0)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-06T20:00:00+00:00", result="Win",
                  pnl_dollar=200, r_multiple=2.0)
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    assert data["week"]["discipline_events"]["cooling_off_fires"] == 2


# ── Phase G v2: assemble_day + arcs ────────────────────────────────────────


def test_assemble_day_empty_returns_skeleton(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    assert data["today"]["date"] == "2026-05-11"
    assert data["today"]["trades"] == []
    assert data["today"]["aggregates"]["trade_count"] == 0
    assert data["today"]["open_positions"] == []
    assert data["recent_arcs"] == []


def test_assemble_day_includes_today_trades(db_conn):
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00", setup="Bull Flag",
                  r_multiple=1.5, result="Win")
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-10T20:00:00+00:00", setup="Bull Flag",
                  r_multiple=-1.0, result="Loss")
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    assert data["today"]["aggregates"]["trade_count"] == 1
    assert len(data["today"]["trades"]) == 1
    assert data["today"]["trades"][0]["setup"] == "Bull Flag"


def test_arc_consecutive_setup_losses(db_conn):
    """Three Bull Flag losses on consecutive trading days should produce one arc."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-07T20:00:00+00:00", setup="Bull Flag",
                  symbol="TSLA", result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-08T20:00:00+00:00", setup="Bull Flag",
                  symbol="NVDA", result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    _insert_trade(db_conn, user_id="u_coach", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00", setup="Bull Flag",
                  symbol="CRWD", result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    arcs = data["recent_arcs"]
    assert any("3" in a and "Bull Flag" in a for a in arcs), arcs


def test_arc_repeated_mistake_tag(db_conn):
    """Three FOMO-tagged trades in the rolling window should produce an arc."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    import json
    for day in ("2026-05-07", "2026-05-08", "2026-05-11"):
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso=f"{day}T20:00:00+00:00",
            mistake_tags=json.dumps(["FOMO"]),
            result="Loss", r_multiple=-1.0, pnl_dollar=-100,
        )
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    arcs = data["recent_arcs"]
    assert any("FOMO" in a for a in arcs), arcs


def test_arc_days_since_last_winner(db_conn):
    """Three days in a row with no winner should produce an arc."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    for day in ("2026-05-07", "2026-05-08", "2026-05-11"):
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso=f"{day}T20:00:00+00:00",
            result="Loss", r_multiple=-1.0, pnl_dollar=-100,
        )
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    arcs = data["recent_arcs"]
    assert any("no closing winner" in a.lower() or "no winner" in a.lower() for a in arcs), arcs


def test_arc_cap_at_3(db_conn):
    """When more than 3 arcs could be reported, only the top 3 surface."""
    from api.services.journal_two import coach_data_assembler as assembler
    acc = _seed_account(db_conn)
    import json
    # Make it look like every arc fires
    for day in ("2026-05-07", "2026-05-08", "2026-05-11"):
        _insert_trade(
            db_conn, user_id="u_coach", account_id=acc["id"],
            exit_iso=f"{day}T20:00:00+00:00", setup="Bull Flag",
            mistake_tags=json.dumps(["FOMO"]),
            result="Loss", r_multiple=-1.0, pnl_dollar=-100,
            regime="ORANGE",
        )
    data = assembler.assemble_day(
        user_id="u_coach", account_id=acc["id"], day_iso="2026-05-11", conn=db_conn,
    )
    assert len(data["recent_arcs"]) <= 3


def test_assemble_week_now_includes_weekly_eod_context(db_conn):
    """Phase G v2 amends assemble_week to inject EOD summaries from the week."""
    from api.services.journal_two import coach_data_assembler as assembler
    import json, uuid
    acc = _seed_account(db_conn)
    # Seed an EOD recap from this week
    db_conn.execute(
        """
        INSERT INTO j2_coach_outputs
            (id, user_id, account_id, output_type, body, summary, metadata, created_at)
        VALUES (?, ?, ?, 'eod_recap', ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()), "u_coach", acc["id"],
            "Tuesday's full body", "Tuesday's summary",
            json.dumps({"day": "2026-05-05"}),
            "2026-05-05T20:00:00+00:00",
        ),
    )
    db_conn.commit()
    data = assembler.assemble_week(
        user_id="u_coach", account_id=acc["id"], week_start="2026-05-04", conn=db_conn,
    )
    weo = data.get("weekly_eod_context") or []
    assert any(e.get("day") == "2026-05-05" for e in weo), weo


# ── Unified-mode ('_all_') union tests ──────────────────────────────────────


def _seed_named_account(db_conn, user_id, name, compass_enabled=1):
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.create_account(
        user_id,
        {"name": name, "color": "blue", "startingBalance": 100_000},
        conn=db_conn,
    )
    if compass_enabled != 1:
        db_conn.execute(
            "UPDATE j2_accounts SET compass_enabled = ? WHERE id = ?",
            (compass_enabled, acc["id"]),
        )
        db_conn.commit()
    return acc


def test_trades_in_range_unions_across_accounts(db_conn):
    """account_id == '_all_' pulls trades from every compass_enabled account
    and tags each row with its source account name."""
    from api.services.journal_two import coach_data_assembler as cda
    a1 = _seed_named_account(db_conn, "u_uni", "Default")
    a2 = _seed_named_account(db_conn, "u_uni", "Cash")
    _insert_trade(db_conn, user_id="u_uni", account_id=a1["id"],
                  exit_iso="2026-05-05T20:00:00+00:00", symbol="AAPL")
    _insert_trade(db_conn, user_id="u_uni", account_id=a2["id"],
                  exit_iso="2026-05-06T20:00:00+00:00", symbol="NVDA")
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2030, 1, 1, tzinfo=timezone.utc)
    rows = cda._trades_in_range(db_conn, "u_uni", "_all_", start, end)
    by_sym = {r["symbol"]: r for r in rows}
    assert set(by_sym) == {"AAPL", "NVDA"}
    assert by_sym["AAPL"]["account_name"] == "Default"
    assert by_sym["NVDA"]["account_name"] == "Cash"


def test_trades_in_range_excludes_compass_disabled_account(db_conn):
    from api.services.journal_two import coach_data_assembler as cda
    a1 = _seed_named_account(db_conn, "u_uni2", "Default")
    a2 = _seed_named_account(db_conn, "u_uni2", "Excluded", compass_enabled=0)
    _insert_trade(db_conn, user_id="u_uni2", account_id=a1["id"],
                  exit_iso="2026-05-05T20:00:00+00:00", symbol="AAPL")
    _insert_trade(db_conn, user_id="u_uni2", account_id=a2["id"],
                  exit_iso="2026-05-06T20:00:00+00:00", symbol="TSLA")
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2030, 1, 1, tzinfo=timezone.utc)
    rows = cda._trades_in_range(db_conn, "u_uni2", "_all_", start, end)
    assert {r["symbol"] for r in rows} == {"AAPL"}


def test_open_positions_unions_across_accounts(db_conn):
    from api.services.journal_two import coach_data_assembler as cda
    import uuid
    a1 = _seed_named_account(db_conn, "u_uni3", "Default")
    a2 = _seed_named_account(db_conn, "u_uni3", "Cash")
    for acc, sym in ((a1, "MSFT"), (a2, "GOOG")):
        db_conn.execute(
            """INSERT INTO j2_positions
               (id, user_id, account_id, symbol, side, shares, original_shares,
                entry_price, stop_price, entry_date, context_at_entry,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, 'Long', 10, 10, 100, 95,
                       '2026-05-01T14:00:00+00:00', '{}',
                       '2026-05-01T14:00:00+00:00', '2026-05-01T14:00:00+00:00')""",
            (str(uuid.uuid4()), "u_uni3", acc["id"], sym),
        )
    db_conn.commit()
    rows = cda._open_positions(db_conn, "u_uni3", "_all_")
    by_sym = {r["symbol"]: r for r in rows}
    assert set(by_sym) == {"MSFT", "GOOG"}
    assert by_sym["MSFT"]["account_name"] == "Default"
    assert by_sym["GOOG"]["account_name"] == "Cash"


def test_discipline_events_unified_sums_across_accounts(db_conn):
    """Unified mode sums discipline counters across enabled accounts using
    each account's own caps. Two losing trades in two accounts → 2 cooling
    -off fires when each account has cooling-off configured."""
    from api.services.journal_two import coach_data_assembler as cda
    a1 = _seed_named_account(db_conn, "u_uni4", "Default")
    a2 = _seed_named_account(db_conn, "u_uni4", "Cash")
    for acc in (a1, a2):
        db_conn.execute(
            "UPDATE j2_accounts SET cooling_off_minutes_after_loss = 15 WHERE id = ?",
            (acc["id"],),
        )
    db_conn.commit()
    _insert_trade(db_conn, user_id="u_uni4", account_id=a1["id"],
                  exit_iso="2026-05-05T20:00:00+00:00", result="Loss",
                  r_multiple=-1.0, pnl_dollar=-100)
    _insert_trade(db_conn, user_id="u_uni4", account_id=a2["id"],
                  exit_iso="2026-05-06T20:00:00+00:00", result="Loss",
                  r_multiple=-1.0, pnl_dollar=-100)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2030, 1, 1, tzinfo=timezone.utc)
    ev = cda._discipline_events(db_conn, "u_uni4", "_all_", start, end)
    assert ev["cooling_off_fires"] == 2
