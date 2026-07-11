"""Coverage-gated psychology analytics section (Journal A+ P5, Task A8).

Exercises `_psychology_section` through `get_analytics` (integration): emotion×
outcome matrix, cost-of-mistakes (NET $), the revenge detector, the per-ET-day
tilt signal, and the honest all-untagged empty state.
"""
from __future__ import annotations

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


def _add_account(conn, user_id, *, name="Default", starting_balance=100_000):
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_accounts (
            id, user_id, name, color, broker, starting_balance,
            account_size, default_stop, position_closing,
            breakeven_range, setups, share_journal_data,
            created_at, updated_at
        ) VALUES (?, ?, ?, 'blue', NULL, ?, ?,
                  '{"mode":"custom"}', 'FIFO',
                  '{"enabled":false,"unit":"$","value":0}',
                  '[]', 0, ?, ?)
        """,
        (aid, user_id, name, starting_balance, starting_balance, now, now),
    )
    conn.commit()
    return aid


def _add_trade(
    conn, user_id, *, account_id=None,
    entry_iso="2026-05-01T14:00:00Z", exit_iso="2026-05-01T14:30:00Z",
    pnl=100, fees=0.0, result="Win", symbol="NVDA",
    emotion_tags=None, mistake_tags=None, trading_day_et=None,
):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, trading_day_et, hour_et, fees,
            emotion_tags, mistake_tags
        ) VALUES (?, ?, 'manual', ?, 'Long', 100, 500, ?, 510, ?,
                  490, 'VCP', NULL, ?, 0.02, 1.5, 1, ?, '{}', ?, ?, ?, NULL, ?,
                  ?, ?)
        """,
        (
            tid, user_id, symbol, entry_iso, exit_iso, pnl, result,
            account_id, now, trading_day_et, fees,
            json.dumps(emotion_tags) if emotion_tags else None,
            json.dumps(mistake_tags) if mistake_tags else None,
        ),
    )
    conn.commit()
    return tid


# ── emotionOutcomes ──────────────────────────────────────────────────────────


def test_emotion_outcomes_per_emotion_stats(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    # calm × 4: +100 (W), +50 (W), -30 (L), +0 (BE) → avg 30.0, count 4.
    # winRate = wins / (wins + losses) = 2 / 3 — the breakeven is EXCLUDED from
    # the denominator (matches the setup/regime sections). The old wins/tradeCount
    # formula would have given 2/4 = 0.5, so this case pins the aligned metric.
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["calm"], pnl=100, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["calm"], pnl=50, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["calm"], pnl=-30, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["calm"], pnl=0, result="BE")
    # anxious × 1: -10 (L)
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["anxious"], pnl=-10, result="Loss")

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    by = {e["emotion"]: e for e in psy["emotionOutcomes"]}
    assert by["calm"]["tradeCount"] == 4
    assert by["calm"]["avgPnl"] == 30.0
    assert abs(by["calm"]["winRate"] - 2 / 3) < 1e-9
    # thin (<3) emotions are RETURNED (with count) — the FE decides display
    assert by["anxious"]["tradeCount"] == 1
    assert by["anxious"]["avgPnl"] == -10.0
    assert by["anxious"]["winRate"] == 0.0


def test_emotion_outcomes_winrate_none_on_all_breakeven(db_conn):
    """An emotion whose only trades are breakevens has NO decisive trade →
    winRate is None (reads "—"), matching bySetup/_regime_section — not a
    misleading confident 0.0."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    # zen × 2, both breakeven → wins + losses == 0.
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["zen"], pnl=0, result="BE")
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["zen"], pnl=0, result="BE")
    # calm × 2, one win one loss → the normal wins/(wins+losses) path still holds.
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["calm"], pnl=40, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["calm"], pnl=-20, result="Loss")

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    by = {e["emotion"]: e for e in psy["emotionOutcomes"]}
    assert by["zen"]["tradeCount"] == 2
    assert by["zen"]["winRate"] is None            # all-breakeven → None, not 0.0
    assert by["calm"]["tradeCount"] == 2
    assert by["calm"]["winRate"] == 0.5            # 1 / (1 + 1) still computes


def test_emotion_outcomes_use_net_pnl(db_conn):
    """avgPnl is NET of fees ($ actually kept)."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["greedy"],
               pnl=100, fees=25, result="Win")  # net 75

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    by = {e["emotion"]: e for e in psy["emotionOutcomes"]}
    assert by["greedy"]["avgPnl"] == 75.0


# ── costOfMistakes ───────────────────────────────────────────────────────────


def test_cost_of_mistakes_total_and_breakdown(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    # mistake-tagged: fomo -100 (fees 5 → net -105); fomo+chasing -40 (net -40)
    _add_trade(db_conn, "u1", account_id=aid, mistake_tags=["fomo"],
               pnl=-100, fees=5, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, mistake_tags=["fomo", "chasing"],
               pnl=-40, result="Loss")
    # untagged winner is NOT counted in cost-of-mistakes
    _add_trade(db_conn, "u1", account_id=aid, pnl=200, result="Win")

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    cost = psy["costOfMistakes"]
    # total = sum of NET pnl over the two mistake-tagged trades
    assert cost["total"] == -145.0
    by = {m["mistake"]: m for m in cost["byMistake"]}
    assert by["fomo"] == {"mistake": "fomo", "total": -145.0, "count": 2}
    assert by["chasing"] == {"mistake": "chasing", "total": -40.0, "count": 1}


# ── tilt ─────────────────────────────────────────────────────────────────────


def test_tilt_flags_revenge_day(db_conn):
    """A day carrying a revenge flag (loss + same-symbol re-entry in window)
    earns tilt level 1."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, symbol="NVDA",
               entry_iso="2026-05-01T14:00:00Z", exit_iso="2026-05-01T14:30:00Z",
               pnl=-50, result="Loss", trading_day_et="2026-05-01")
    _add_trade(db_conn, "u1", account_id=aid, symbol="NVDA",
               entry_iso="2026-05-01T15:00:00Z", exit_iso="2026-05-01T15:30:00Z",
               pnl=20, result="Win", trading_day_et="2026-05-01")

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    assert psy["tilt"]["byDay"].get("2026-05-01") == 1
    # and the underlying revenge flag is present
    assert len(psy["revenge"]["flags"]) == 1


def test_tilt_flags_loss_cluster_day(db_conn):
    """A day with >=3 consecutive losing trades earns tilt level 1 even without
    a revenge flag (different symbols)."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    for i, sym in enumerate(["AMD", "TSLA", "MSFT"]):
        hh = 14 + i
        _add_trade(db_conn, "u1", account_id=aid, symbol=sym,
                   entry_iso=f"2026-05-02T{hh:02d}:00:00Z",
                   exit_iso=f"2026-05-02T{hh:02d}:20:00Z",
                   pnl=-15, result="Loss", trading_day_et="2026-05-02")

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    assert psy["tilt"]["byDay"].get("2026-05-02") == 1
    # different symbols → no revenge flag; the tilt came from the loss cluster
    assert psy["revenge"]["flags"] == []


# ── honesty / empty state ────────────────────────────────────────────────────


def test_all_untagged_returns_empty_aggregates(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, pnl=100, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, pnl=50, result="Win")

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    assert psy["emotionOutcomes"] == []
    assert psy["costOfMistakes"] == {"total": 0.0, "byMistake": []}
    assert psy["revenge"]["flags"] == []
    assert psy["tilt"]["byDay"] == {}
    assert psy["taggedTradeCount"] == 0


def test_tagged_trade_count_counts_either_tag(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, emotion_tags=["calm"], pnl=10)
    _add_trade(db_conn, "u1", account_id=aid, mistake_tags=["fomo"], pnl=-10, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, pnl=5)  # untagged

    psy = get_analytics("u1", account_id=aid, conn=db_conn)["psychology"]
    assert psy["taggedTradeCount"] == 2
