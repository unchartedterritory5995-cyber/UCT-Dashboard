"""history_backfill — restore j2_broker_equity_snapshots from the replay.

Disconnect wipes the snapshot table; the range tabs then have one point. The
backfill re-derives history from the re-imported ledger, strictly additive:
real sync rows always win, today is never written, insane values are skipped.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import history_backfill as hb
from api.services.journal_two.broker import historical_equity as he


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    conn.execute(
        "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, "
        "j2_account_id, sync_enabled, status, created_at, updated_at) "
        "VALUES ('bk1', 'u1', 'snap1', ?, 1, 'active', '2026-08-20', '2026-08-20')",
        (acct["id"],),
    )
    conn.commit()
    conn.close()
    return {"j2": acct["id"]}


def _snapshots(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT snapshot_date, total_equity, synced_at "
            "FROM j2_broker_equity_snapshots WHERE user_id = ? "
            "ORDER BY snapshot_date", (user,),
        ).fetchall()
    finally:
        conn.close()


def _seed_real_snapshot(date, equity, user="u1"):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
        "snapshot_date, total_equity, cash, market_value, synced_at) "
        "VALUES (?, 'bk1', ?, ?, -100.0, 500.0, 'sync')",
        (user, date, equity),
    )
    conn.commit()
    conn.close()


def test_backfill_writes_missing_dates_and_never_today(env, monkeypatch):
    monkeypatch.setattr(he, "_et_today", lambda: "2026-08-21")
    monkeypatch.setattr(
        he, "reconstruct_daily_equity",
        lambda uid, acct, conn=None: [
            {"date": "2026-08-18", "equity": 13000.0, "estimated": False},
            {"date": "2026-08-19", "equity": 13722.17, "estimated": False},
            {"date": "2026-08-20", "equity": 10230.0, "estimated": False},
            {"date": "2026-08-21", "equity": 10233.9, "estimated": False},  # today
        ],
    )

    out = hb.backfill_equity_snapshots("u1", env["j2"])

    rows = _snapshots()
    assert out["written"] == 3
    assert [r["snapshot_date"] for r in rows] == ["2026-08-18", "2026-08-19", "2026-08-20"]
    assert rows[1]["total_equity"] == 13722.17
    assert all(r["synced_at"].startswith("backfill:") for r in rows)


def test_a_real_sync_snapshot_always_wins(env, monkeypatch):
    _seed_real_snapshot("2026-08-19", 10227.88)
    monkeypatch.setattr(he, "_et_today", lambda: "2026-08-21")
    monkeypatch.setattr(
        he, "reconstruct_daily_equity",
        lambda uid, acct, conn=None: [
            {"date": "2026-08-19", "equity": 13722.17},   # replay disagrees
            {"date": "2026-08-20", "equity": 10230.0},
        ],
    )

    out = hb.backfill_equity_snapshots("u1", env["j2"])

    rows = {r["snapshot_date"]: r for r in _snapshots()}
    assert out["written"] == 1 and out["skippedExisting"] == 1
    assert rows["2026-08-19"]["total_equity"] == 10227.88   # the REAL row
    assert rows["2026-08-19"]["synced_at"] == "sync"
    assert rows["2026-08-20"]["total_equity"] == 10230.0


def test_insane_replay_values_are_skipped_not_written(env, monkeypatch):
    monkeypatch.setattr(he, "_et_today", lambda: "2026-08-21")
    monkeypatch.setattr(
        he, "reconstruct_daily_equity",
        lambda uid, acct, conn=None: [
            {"date": "2026-08-18", "equity": -500.0},       # replay artifact
            {"date": "2026-08-19", "equity": float("nan")},
            {"date": "2026-08-20", "equity": 10230.0},
        ],
    )

    out = hb.backfill_equity_snapshots("u1", env["j2"])

    assert out["written"] == 1 and out["skippedInsane"] == 2
    assert [r["snapshot_date"] for r in _snapshots()] == ["2026-08-20"]


def test_backfill_all_accounts_isolates_a_bad_replay(env, monkeypatch):
    monkeypatch.setattr(he, "_et_today", lambda: "2026-08-21")
    def boom(uid, acct, conn=None):
        raise RuntimeError("massive down")
    monkeypatch.setattr(he, "reconstruct_daily_equity", boom)

    out = hb.backfill_all_accounts("u1")

    assert list(out.values())[0]["error"] == "massive down"


def test_route_is_mounted():
    from api.routers import broker_sync as router_mod
    paths = {r.path for r in router_mod.router.routes}
    assert "/api/j2/broker/backfill-history" in paths
    assert "/api/j2/broker/trust" in paths   # control sibling


# ── automatic post-reconnect trigger ─────────────────────────────────────────

def _seed_activities(n, user="u1"):
    conn = auth_db.get_connection()
    for i in range(n):
        conn.execute(
            "INSERT INTO j2_broker_activities (id, user_id, broker_account_id, "
            "external_id, activity_type, occurred_at, raw_json, created_at) "
            "VALUES (?, ?, 'bk1', ?, 'BUY', '2026-01-01', '{}', '2026-01-01')",
            (f"a{i}", user, f"ext{i}"),
        )
    conn.commit()
    conn.close()


def _ba(env, tx_done=True):
    return {"id": "bk1", "j2AccountId": env["j2"], "txInitialSyncCompleted": tx_done}


def _run_trigger_and_wait(env, monkeypatch, ba):
    """Fire the trigger with the heavy backfill replaced by a recorder, and
    wait for the background thread to land."""
    import threading
    done = threading.Event()
    calls = []

    def fake_backfill(uid, acct, conn=None):
        calls.append((uid, acct))
        done.set()
        return {"written": 0}

    monkeypatch.setattr(hb, "backfill_equity_snapshots", fake_backfill)
    started = hb.maybe_backfill_after_initial_sync("u1", ba)
    if started:
        assert done.wait(5), "background backfill never ran"
    return started, calls


def test_auto_backfill_fires_once_the_initial_sync_completes(env, monkeypatch):
    _seed_activities(30)
    started, calls = _run_trigger_and_wait(env, monkeypatch, _ba(env))
    assert started is True
    assert calls == [("u1", env["j2"])]


def test_auto_backfill_waits_for_the_full_ledger(env, monkeypatch):
    """Running the replay on a PARTIAL ledger would write skewed values that
    INSERT OR IGNORE then makes sticky — the tx-complete flag is the gate."""
    _seed_activities(30)
    started, calls = _run_trigger_and_wait(env, monkeypatch, _ba(env, tx_done=False))
    assert started is False and calls == []


def test_auto_backfill_self_disarms_when_history_exists(env, monkeypatch):
    _seed_activities(30)
    for i in range(6):
        _seed_real_snapshot(f"2026-08-{10 + i:02d}", 1000.0 + i)
    started, calls = _run_trigger_and_wait(env, monkeypatch, _ba(env))
    assert started is False and calls == []


def test_auto_backfill_skips_an_empty_account(env, monkeypatch):
    _seed_activities(3)   # below MIN_ACTIVITIES
    started, calls = _run_trigger_and_wait(env, monkeypatch, _ba(env))
    assert started is False and calls == []
