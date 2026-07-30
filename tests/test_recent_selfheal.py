"""
Self-heal primitives for the curated /recent feed (2026-07-28).

Guards the fix for the mid-session wedge where a HUNG fill leaked its per-key
lock + semaphore slot forever, so /recent served alerts:[]/warming for ~55 min
while flow.db ingested normally. Tests the isolatable pieces:
  * _acquire_or_steal_fill — cold acquire, no-steal-when-fresh, steal-after-lease
  * _compute_and_store — bounded semaphore wait (returns None instead of blocking
    forever) + records last-good on success
"""

import os
import sys
import time
import types
import tempfile

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="lmr_"))

# Stub the heavy auth import chain (flow_admin_auth -> auth_service -> bcrypt ...)
# so the router imports headlessly; we only exercise pure threading/cache logic.
_fake_auth = types.ModuleType("api.flow_admin_auth")
_fake_auth.require_flow_admin = lambda *a, **k: {}
_fake_auth.require_flow_user = lambda *a, **k: {}
sys.modules.setdefault("api.flow_admin_auth", _fake_auth)

import pytest
from api import live_massive_router as m


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    m._recent_cache.clear()
    m._recent_cache_locks.clear()
    m._recent_fill_started.clear()
    m._recent_last_good.clear()
    monkeypatch.setattr(m, "_RECENT_SELFHEAL", True)
    monkeypatch.setattr(m, "_RECENT_FILL_LEASE_SEC", 0.3)
    monkeypatch.setattr(m, "_RECENT_SEM_WAIT_SEC", 0.3)
    yield


def test_cold_acquire_then_no_steal_while_fresh():
    ck = ("d", 1, "D", "recent", None, True)
    lock, got = m._acquire_or_steal_fill(ck)
    assert got is True and lock is not None
    # Held and still within the lease → a second caller must NOT steal.
    lock2, got2 = m._acquire_or_steal_fill(ck)
    assert got2 is False and lock2 is None
    lock.release()


def test_steal_after_lease_expires():
    ck = ("d", 2, "D", "recent", None, True)
    lock, got = m._acquire_or_steal_fill(ck)
    assert got
    # Simulate the holder hanging past the lease (the finally-release never ran).
    # Lease value is (owning_lock, started_at) — the lock is the fill's identity.
    m._recent_fill_started[ck] = (lock, time.time() - 1.0)   # > lease (0.3s)
    stolen, got2 = m._acquire_or_steal_fill(ck)
    assert got2 is True
    assert stolen is not lock                        # a FRESH lock was swapped in
    assert m._recent_cache_locks[ck] is stolen       # dict now points at the new lock
    stolen.release()
    lock.release()                                   # orphaned old lock — harmless


def test_no_steal_when_selfheal_disabled(monkeypatch):
    monkeypatch.setattr(m, "_RECENT_SELFHEAL", False)
    ck = ("d", 3, "D", "recent", None, True)
    lock, got = m._acquire_or_steal_fill(ck)
    assert got
    m._recent_fill_started[ck] = (lock, time.time() - 1.0)
    lock2, got2 = m._acquire_or_steal_fill(ck)
    assert got2 is False                             # kill-switch → legacy behaviour
    lock.release()


def test_compute_and_store_records_last_good(monkeypatch):
    ck = ("d", 4, "D", "recent", None, True)
    payload = {"alerts": [{"x": 1}], "status": {}}
    monkeypatch.setattr(m, "_compute_recent", lambda *a, **k: payload)
    out = m._compute_and_store(ck, "d", 1, "D", "recent", None, True)
    assert out is payload
    assert m._recent_cache[ck][1] is payload
    assert m._recent_last_good[ck] is payload        # last-good captured for fallback


def test_curated_health_reflects_cache_state():
    today = m._today_mdyyyy()
    ck = (today, m._CANON_CURATED_LIMIT, "D", "recent", None, True)
    # Cold canonical key → looks wedged to the monitor (not cached, empty).
    h = m._curated_health()
    assert h["cached"] is False and h["empty"] is True and h["alerts"] == 0
    # Populate it → healthy.
    m._recent_cache[ck] = (time.time(), {"alerts": [{"a": 1}, {"b": 2}]})
    h2 = m._curated_health()
    assert h2["cached"] is True and h2["alerts"] == 2 and h2["empty"] is False


def test_warm_recent_steals_a_wedged_canonical_lock(monkeypatch):
    today = m._today_mdyyyy()
    ck = (today, m._CANON_CURATED_LIMIT, "D", "recent", None, True)
    monkeypatch.setattr(m, "_compute_recent", lambda *a, **k: {"alerts": [{"x": 1}]})
    # Simulate a HUNG prior fill: canonical lock held + started past the lease.
    held = m._recent_lock_for(ck)
    assert held.acquire(blocking=False)
    m._recent_fill_started[ck] = (held, time.time() - 1.0)   # > lease (0.3s in fixture)
    _, n = m.warm_recent(limit=m._CANON_CURATED_LIMIT, min_grade="D",
                         sort_by="recent", tier=None, curated=True)
    assert n == 1                                    # stole the wedged key + filled it
    assert ck in m._recent_cache
    held.release()                                   # orphaned old lock — harmless


def test_compute_and_store_gives_up_on_exhausted_semaphore(monkeypatch):
    ck = ("d", 5, "D", "recent", None, True)
    monkeypatch.setattr(m, "_compute_recent", lambda *a, **k: {"alerts": []})
    # Drain both semaphore slots to simulate two hung fills holding them.
    assert m._recent_fill_sem.acquire(timeout=1)
    assert m._recent_fill_sem.acquire(timeout=1)
    try:
        t0 = time.time()
        out = m._compute_and_store(ck, "d", 1, "D", "recent", None, True)
        assert out is None                           # gave up instead of blocking forever
        assert time.time() - t0 >= 0.25              # waited ~the bounded timeout
        assert ck not in m._recent_cache             # nothing cached on give-up
    finally:
        m._recent_fill_sem.release()
        m._recent_fill_sem.release()
