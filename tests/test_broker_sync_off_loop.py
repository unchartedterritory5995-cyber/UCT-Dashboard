"""A request-path broker sync must not run its synchronous work on the caller's
event loop.

WHY (measured on production 2026-10-12): `_do_sync` awaits only the SnapTrade
calls; storing/healing the activity ledger, the FIFO reconstruct over the whole
ledger, cash-flow reconcile, balances, option reconcile, mirror check and the
dedup scan are all synchronous. Run on the web pod's single uvicorn loop (the
journal's on-open `POST /api/j2/broker/sync?background=1`), one member's sync
held the loop 10.2 s (`[boot-probe] ... loop-lag=10243ms`) and stalled 31
unrelated requests to ~12 s; an earlier one stalled 24 requests to 22-30 s.

These rails pin: (1) `off_loop=True` keeps the caller's loop responsive while
the sync's synchronous part runs, with a CONTROL proving the probe detects a
blocked loop; (2) the off-loop result is identical to the on-loop one; (3) every
request-loop caller in the router asks for it; (4) the shared SnapTrade rate
limiter survives being used from several event loops at once.
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, activities_store, reconstruct, sync,
)
from api.services.journal_two.broker.rate_limit import AsyncRateLimiter


class _Resp:
    def __init__(self, body):
        self.body = body


class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


class _NoThrottle:
    async def acquire(self, n=1):
        return None


def _act(aid, typ, ticker, units, price, date):
    return {"id": aid, "type": typ, "units": units, "price": price, "fee": 0,
            "symbol": {"symbol": ticker}, "trade_date": date, "currency": "USD"}


ACTS = [
    _act("a1", "BUY", "AAPL", 10, 100, "2026-04-01"),
    _act("a2", "SELL", "AAPL", 10, 110, "2026-04-02"),
    _act("a3", "SELL", "TSLA", 5, 60, "2026-04-01"),
    _act("a4", "BUY", "TSLA", 5, 50, "2026-04-03"),
]


def _activities_fn(acts):
    def fn(**kw):
        offset = kw.get("offset", 0)
        limit = kw.get("limit", 1000)
        page = acts[offset:offset + limit]
        return _Resp({"data": page,
                      "pagination": {"offset": offset, "limit": limit, "total": len(acts)}})
    return fn


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    connections.save_broker_user("u1", "snap-uid", "secret")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Schwab", "number": "1234",
        "institution_name": "Schwab", "type": "margin",
    })
    snap.configure(_Group(account_information=_Group(
        get_account_activities=_activities_fn(ACTS),
        get_user_account_positions=lambda **kw: _Resp([]),
        get_user_account_balance=lambda **kw: _Resp([]),
    )))
    yield {"ba_id": ba["id"]}
    snap.reset()


def _trade_count(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM j2_trades WHERE user_id=?", (user,)).fetchone()["n"]
    finally:
        conn.close()


_BLOCK_S = 0.6


def _slow_reconstruct(monkeypatch):
    """Make the synchronous FIFO step take _BLOCK_S of wall time WITHOUT
    yielding — the shape of a large ledger's reconstruct."""
    real = reconstruct.reconstruct_account

    def slow(*a, **kw):
        time.sleep(_BLOCK_S)
        return real(*a, **kw)

    monkeypatch.setattr(reconstruct, "reconstruct_account", slow)


async def _max_loop_gap_while(coro) -> tuple[float, object]:
    """Run `coro` while a 10 ms ticker measures the longest gap between its
    ticks on THIS loop. A blocked loop shows up as a gap ~ the block."""
    done = False
    gaps: list[float] = []

    async def ticker():
        last = time.perf_counter()
        while not done:
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            gaps.append(now - last)
            last = now

    t = asyncio.create_task(ticker())
    try:
        result = await coro
    finally:
        done = True
        await t
    return (max(gaps) if gaps else 0.0), result


async def test_CONTROL_an_on_loop_sync_blocks_the_callers_loop(env, monkeypatch):
    # Non-vacuity: proves the probe below can SEE a blocked loop. If this ever
    # stops being true the next test passes for the wrong reason.
    _slow_reconstruct(monkeypatch)
    gap, out = await _max_loop_gap_while(sync.sync_account("u1", env["ba_id"]))
    assert out["imported"] == 2
    assert gap >= _BLOCK_S * 0.8, f"probe failed to see a {_BLOCK_S}s block (max gap {gap:.3f}s)"


async def test_an_off_loop_sync_leaves_the_callers_loop_responsive(env, monkeypatch):
    _slow_reconstruct(monkeypatch)
    gap, out = await _max_loop_gap_while(
        sync.sync_account("u1", env["ba_id"], off_loop=True))
    assert out["imported"] == 2
    assert gap < _BLOCK_S * 0.5, f"caller's loop stalled {gap:.3f}s during an off-loop sync"


async def test_off_loop_produces_the_same_result_as_on_loop(env):
    out = await sync.sync_account("u1", env["ba_id"], off_loop=True)
    assert out["imported"] == 2
    assert out["newActivities"] == 4
    assert _trade_count() == 2
    assert activities_store.count("u1", env["ba_id"]) == 4
    ba = connections.get_broker_account("u1", env["ba_id"])
    assert ba["activitiesCursor"] == "2026-04-03T00:00:00Z"
    assert ba["lastSyncStatus"] == "ok"
    # Idempotent on re-run, and the per-account lock still serializes two
    # concurrent off-loop syncs of one account (no duplicate trades).
    await asyncio.gather(
        sync.sync_account("u1", env["ba_id"], off_loop=True),
        sync.sync_account("u1", env["ba_id"], off_loop=True),
    )
    assert _trade_count() == 2
    assert activities_store.count("u1", env["ba_id"]) == 4


async def test_sync_all_for_user_passes_off_loop_through(env, monkeypatch):
    seen = []

    async def fake(user_id, ba_id, *, full=False, cooldown_seconds=0.0, off_loop=False):
        seen.append(off_loop)
        return {"ok": True}

    monkeypatch.setattr(sync, "sync_account", fake)
    await sync.sync_all_for_user("u1", off_loop=True)
    await sync.sync_all_for_user("u1")
    assert seen == [True, False]


async def test_every_request_loop_caller_in_the_router_asks_for_off_loop(monkeypatch):
    """The /sync route (background AND blocking) and the webhook worker run on
    the web pod's request loop, so each must request off_loop. Driven through
    the real handlers, not a grep."""
    from api.routers import broker_sync as router_mod

    seen = []

    async def recorder(user_id, *, full=False, cooldown_seconds=0.0, off_loop=False):
        seen.append(off_loop)
        return {}

    monkeypatch.setattr(sync, "sync_all_for_user", recorder)
    monkeypatch.setattr(router_mod, "_guard_configured", lambda: None)

    await router_mod.sync_now(user={"id": "u1"}, full=False, force=False, background=False)
    await router_mod.sync_now(user={"id": "u1"}, full=False, force=False, background=True)
    for _ in range(50):  # let the detached background task run
        if len(seen) >= 2:
            break
        await asyncio.sleep(0.01)
    await router_mod.broker_service_sync_all("u1")
    assert seen == [True, True, True], seen


async def test_sync_due_accounts_passes_off_loop_through(monkeypatch):
    seen = []

    async def fake(user_id, ba_id, **kw):
        seen.append(kw.get("off_loop", False))
        return {}

    monkeypatch.setattr(sync, "sync_account", fake)
    monkeypatch.setattr(sync.connections, "list_due_accounts",
                        lambda interval: [{"userId": "u1", "id": "a1"}])
    monkeypatch.setattr(sync, "_user_is_paid", lambda uid, cache: True)
    await sync.sync_due_accounts(interval_minutes=0, off_loop=True)
    await sync.sync_due_accounts(interval_minutes=0)
    assert seen == [True, False]


async def test_the_reset_partner_auth_resync_asks_for_off_loop(monkeypatch):
    """The admin reset-partner-auth route resyncs on the web pod's request
    loop, so its sync_due_accounts call must request off_loop. Driven through
    the real handler."""
    from api.routers import broker_sync as router_mod
    from api.services.journal_two.broker import connections as conns

    seen = []

    async def recorder(*, interval_minutes=None, concurrency=None, off_loop=False):
        seen.append((interval_minutes, off_loop))
        return {"due": 0, "synced": 0, "failed": 0}

    class _Req:
        headers = {"authorization": "Bearer s3cret"}

    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setattr(conns, "reset_partner_auth_broken",
                        lambda dry_run=False: {"reset": 1})
    monkeypatch.setattr(sync, "sync_due_accounts", recorder)

    out = await router_mod.admin_reset_partner_auth_broken(_Req(), resync=True, dry_run=False)
    assert seen == [(0, True)], seen
    assert out["resync"] == {"due": 0, "synced": 0, "failed": 0}


def test_the_shared_rate_limiter_survives_use_from_several_event_loops():
    """One process-wide limiter is acquired from the request loop, the
    scheduler's asyncio.run threads and the off-loop syncs. An asyncio.Lock
    contended across loops raises ("bound to a different event loop") or
    strands a waiter; the limiter's lock must be loop-agnostic."""
    def slow_clock():
        # The clock is read INSIDE the critical section; a 1 ms stall there
        # guarantees real cross-thread contention on the lock.
        time.sleep(0.001)
        return time.monotonic()

    lim = AsyncRateLimiter(rate=1e9, capacity=1e9, clock=slow_clock)
    errors: list[BaseException] = []
    n_threads, per_thread = 6, 60

    def worker():
        async def run():
            for _ in range(per_thread):
                await lim.acquire(1)
        try:
            asyncio.run(asyncio.wait_for(run(), timeout=20))
        except BaseException as e:  # noqa: BLE001 — recorded, asserted below
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert not any(t.is_alive() for t in threads), "a limiter waiter was stranded"
    assert errors == []
