"""Regime backfill — build day→regime map + fill NULL-regime trades (P5 A6)."""

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


# uct_exposure (0-150) → classify_regime: >=90 green, >=50 amber, >=15 orange, else red
FAKE_HISTORY = [
    {"date": "2026-07-08", "uct_exposure": 120},  # green
    {"date": "2026-07-07", "uct_exposure": 60},   # amber
    {"date": "2026-07-06", "uct_exposure": 20},   # orange
    {"date": "2026-07-05", "uct_exposure": 5},    # red
    {"date": "2026-07-04", "uct_exposure": None},  # no score → skipped
]


def _fake_history(monkeypatch, history=FAKE_HISTORY):
    from api.services.journal_two import regime_backfill
    monkeypatch.setattr(
        regime_backfill.breadth_monitor, "get_history",
        lambda days=1200: history,
    )


def _insert_trade(conn, *, user_id, exit_date, trading_day_et=None,
                  regime=None, symbol="AAA"):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, pnl_dollar, pnl_percent, hold_days, result,
            context_at_entry, created_at, regime, trading_day_et
        ) VALUES (?, ?, ?, ?, 'Long', 100, 10.0, ?, 12.0, ?, 9.0, 200.0,
                  0.2, 1, 'Win', '{}', ?, ?, ?)
        """,
        (tid, user_id, f"manual-{uuid.uuid4()}", symbol, exit_date, exit_date,
         now, regime, trading_day_et),
    )
    conn.commit()
    return tid


# ── build_regime_by_day ──────────────────────────────────────────────────────


def test_build_regime_by_day_maps_scores_to_labels(monkeypatch):
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    m = regime_backfill.build_regime_by_day()
    assert m["2026-07-08"] == "green"
    assert m["2026-07-07"] == "amber"
    assert m["2026-07-06"] == "orange"
    assert m["2026-07-05"] == "red"
    # AMBER (not "yellow") is the label set
    assert set(m.values()) <= {"green", "amber", "orange", "red"}
    # None-score day is skipped entirely
    assert "2026-07-04" not in m


def test_build_regime_by_day_handles_metrics_json_string(monkeypatch):
    """Metrics may arrive as a JSON string with the score nested inside."""
    from api.services.journal_two import regime_backfill
    hist = [{"date": "2026-07-08", "metrics": json.dumps({"uct_exposure": 100})}]
    _fake_history(monkeypatch, hist)
    m = regime_backfill.build_regime_by_day()
    assert m["2026-07-08"] == "green"


def test_build_regime_by_day_handles_metrics_dict(monkeypatch):
    from api.services.journal_two import regime_backfill
    hist = [{"date": "2026-07-07", "metrics": {"uct_exposure": 55}}]
    _fake_history(monkeypatch, hist)
    m = regime_backfill.build_regime_by_day()
    assert m["2026-07-07"] == "amber"


# ── backfill_regime ──────────────────────────────────────────────────────────


def test_backfill_fills_matching_day_and_leaves_unmatched_null(db_conn, monkeypatch):
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    t_match = _insert_trade(db_conn, user_id="u1",
                            trading_day_et="2026-07-08",
                            exit_date="2026-07-08T20:00:00Z")
    t_nomatch = _insert_trade(db_conn, user_id="u1",
                              trading_day_et="2020-01-01",
                              exit_date="2020-01-01T20:00:00Z")

    stats = regime_backfill.backfill_regime(user_id="u1", conn=db_conn)
    assert stats == {"scanned": 2, "updated": 1, "skipped_no_day_match": 1}

    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (t_match,)
    ).fetchone()["regime"] == "green"
    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (t_nomatch,)
    ).fetchone()["regime"] is None


def test_backfill_uses_exit_date_when_trading_day_null(db_conn, monkeypatch):
    """Legacy rows with no trading_day_et fall back to substr(exit_date,1,10)."""
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    tid = _insert_trade(db_conn, user_id="u1", trading_day_et=None,
                        exit_date="2026-07-07T00:00:00Z")
    regime_backfill.backfill_regime(user_id="u1", conn=db_conn)
    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (tid,)
    ).fetchone()["regime"] == "amber"


def test_backfill_is_idempotent(db_conn, monkeypatch):
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    _insert_trade(db_conn, user_id="u1", trading_day_et="2026-07-08",
                  exit_date="2026-07-08T20:00:00Z")

    first = regime_backfill.backfill_regime(user_id="u1", conn=db_conn)
    assert first["updated"] == 1
    # Second run: the filled row is no longer NULL → not re-scanned, 0 updates.
    second = regime_backfill.backfill_regime(user_id="u1", conn=db_conn)
    assert second["scanned"] == 0
    assert second["updated"] == 0


def test_backfill_respects_user_scope(db_conn, monkeypatch):
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    t1 = _insert_trade(db_conn, user_id="u1", trading_day_et="2026-07-08",
                       exit_date="2026-07-08T20:00:00Z")
    t2 = _insert_trade(db_conn, user_id="u2", trading_day_et="2026-07-08",
                       exit_date="2026-07-08T20:00:00Z")

    regime_backfill.backfill_regime(user_id="u1", conn=db_conn)
    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (t1,)
    ).fetchone()["regime"] == "green"
    # Other user's NULL-regime row is untouched
    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (t2,)
    ).fetchone()["regime"] is None


def test_backfill_all_users_when_no_user_id(db_conn, monkeypatch):
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    t1 = _insert_trade(db_conn, user_id="u1", trading_day_et="2026-07-08",
                       exit_date="2026-07-08T20:00:00Z")
    t2 = _insert_trade(db_conn, user_id="u2", trading_day_et="2026-07-07",
                       exit_date="2026-07-07T20:00:00Z")

    stats = regime_backfill.backfill_regime(conn=db_conn)
    assert stats["updated"] == 2
    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (t1,)
    ).fetchone()["regime"] == "green"
    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (t2,)
    ).fetchone()["regime"] == "amber"


def test_backfill_respects_limit(db_conn, monkeypatch):
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    for _ in range(3):
        _insert_trade(db_conn, user_id="u1", trading_day_et="2026-07-08",
                      exit_date="2026-07-08T20:00:00Z")

    stats = regime_backfill.backfill_regime(user_id="u1", limit=2, conn=db_conn)
    assert stats["scanned"] == 2
    assert stats["updated"] == 2


def test_backfill_force_rescans_non_null_rows(db_conn, monkeypatch):
    """force=True scans ALL rows (even already-stamped ones) and re-derives from
    the map; a matching day overwrites, a non-matching day is left as-is."""
    from api.services.journal_two import regime_backfill
    _fake_history(monkeypatch)
    # Already stamped 'red' but its day maps to 'green' → force corrects it.
    tid = _insert_trade(db_conn, user_id="u1", trading_day_et="2026-07-08",
                        exit_date="2026-07-08T20:00:00Z", regime="red")

    without_force = regime_backfill.backfill_regime(user_id="u1", conn=db_conn)
    assert without_force["scanned"] == 0  # no NULLs → nothing scanned

    forced = regime_backfill.backfill_regime(user_id="u1", force=True, conn=db_conn)
    assert forced["scanned"] == 1
    assert forced["updated"] == 1
    assert db_conn.execute(
        "SELECT regime FROM j2_trades WHERE id=?", (tid,)
    ).fetchone()["regime"] == "green"
