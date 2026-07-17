import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from api.services.journal_two.broker import sync as broker_sync


def _run(coro):
    return asyncio.run(coro)


def test_warming_clears_after_two_stable_ticks(monkeypatch):
    acct = {"id": "ba1", "userId": "u1", "warmingLastActivityCount": 10,
            "warmingStableTicks": 1, "warmingUntil":
            (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}

    calls = {"cleared": [], "bumped": [], "synced": 0}

    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", lambda now: [acct])
    monkeypatch.setattr(broker_sync, "_user_is_paid", lambda uid, cache: True)
    monkeypatch.setattr(broker_sync, "_activity_count", lambda uid, baid: 10)  # unchanged

    async def _fake_sync(uid, baid, *, full=False, cooldown_seconds=0.0):
        calls["synced"] += 1
        return {"imported": 0}
    monkeypatch.setattr(broker_sync, "sync_account", _fake_sync)
    monkeypatch.setattr(broker_sync.connections, "bump_warming_state",
                        lambda *a, **k: calls["bumped"].append(k))
    monkeypatch.setattr(broker_sync.connections, "clear_warming",
                        lambda uid, baid: calls["cleared"].append(baid))

    _run(broker_sync._warming_sync())

    assert calls["synced"] == 1            # full sync ran
    assert calls["cleared"] == ["ba1"]     # 1 prior + 1 now unchanged == 2 stable → cleared


def test_warming_resets_stable_ticks_when_activities_grow(monkeypatch):
    acct = {"id": "ba2", "userId": "u1", "warmingLastActivityCount": 10,
            "warmingStableTicks": 1, "warmingUntil":
            (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
    calls = {"cleared": [], "bumped": []}

    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", lambda now: [acct])
    monkeypatch.setattr(broker_sync, "_user_is_paid", lambda uid, cache: True)
    monkeypatch.setattr(broker_sync, "_activity_count", lambda uid, baid: 25)  # grew

    async def _fake_sync(uid, baid, *, full=False, cooldown_seconds=0.0):
        return {"imported": 5}
    monkeypatch.setattr(broker_sync, "sync_account", _fake_sync)
    monkeypatch.setattr(broker_sync.connections, "bump_warming_state",
                        lambda uid, baid, **k: calls["bumped"].append(k))
    monkeypatch.setattr(broker_sync.connections, "clear_warming",
                        lambda uid, baid: calls["cleared"].append(baid))

    _run(broker_sync._warming_sync())

    assert calls["cleared"] == []                       # still warming
    assert calls["bumped"][-1]["stable_ticks"] == 0     # reset
    assert calls["bumped"][-1]["activity_count"] == 25


def test_warming_no_accounts_is_noop(monkeypatch):
    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", lambda now: [])
    # Must not raise and must not call sync_account.
    called = {"sync": False}
    async def _boom(*a, **k):
        called["sync"] = True
    monkeypatch.setattr(broker_sync, "sync_account", _boom)
    _run(broker_sync._warming_sync())
    assert called["sync"] is False


def test_run_warming_sync_blocking_never_raises(monkeypatch):
    def _boom(now):
        raise RuntimeError("db down")
    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", _boom)
    broker_sync.run_warming_sync_blocking()  # should swallow


def test_warming_clears_immediately_when_snaptrade_reports_backfill_done(monkeypatch):
    """sync_status.transactions.initial_sync_completed (captured during the
    sync) is the deterministic done-signal — warming ends without waiting for
    stable ticks."""
    acct = {"id": "ba3", "userId": "u1", "warmingLastActivityCount": None,
            "warmingStableTicks": 0, "warmingUntil":
            (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
    calls = {"cleared": [], "bumped": []}

    monkeypatch.setattr(broker_sync.connections, "list_warming_accounts", lambda now: [acct])
    monkeypatch.setattr(broker_sync, "_user_is_paid", lambda uid, cache: True)
    monkeypatch.setattr(broker_sync, "_activity_count", lambda uid, baid: 3)

    async def _fake_sync(uid, baid, *, full=False, cooldown_seconds=0.0):
        return {"imported": 3}
    monkeypatch.setattr(broker_sync, "sync_account", _fake_sync)
    monkeypatch.setattr(broker_sync.connections, "get_broker_account",
                        lambda uid, baid: {"id": baid, "txInitialSyncCompleted": True})
    monkeypatch.setattr(broker_sync.connections, "bump_warming_state",
                        lambda uid, baid, **k: calls["bumped"].append(k))
    monkeypatch.setattr(broker_sync.connections, "clear_warming",
                        lambda uid, baid: calls["cleared"].append(baid))

    _run(broker_sync._warming_sync())

    assert calls["cleared"] == ["ba3"]
    assert calls["bumped"] == []
