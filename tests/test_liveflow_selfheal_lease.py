"""
Regression rails for the 2026-07-30 curated-feed wedge.

Symptom: the canonical curated /recent key sat 500s+ stale mid-session (tape ~9 min
behind) while flow.db ingested normally, and `/status` reported
`fill_running_sec: None` the whole time — so "no fill running" and "a hung fill owns
this key" were indistinguishable. The monitor fired WEDGED, recovered, and re-fired,
nagging all session.

Three defects, one per group below:
  1. The lease DISARMED ITSELF. `_spawn_recent_fill`'s finally popped
     `_recent_fill_started[ck]` unconditionally, so a stolen-from (orphaned) fill
     erased the lease of the fill that had stolen from it. `_acquire_or_steal_fill`
     then saw lock-held + started-None, skipped the lease branch, and the key became
     PERMANENTLY un-stealable.
  2. The steal AMPLIFIED a slow fill. Stealing reclaims the per-key lock but never a
     semaphore slot, so stealing into a saturated semaphore just starts another scan
     that can only time out.

The third strand — the canonical key being starved of fill slots by an unwarmed
`sort_by=conviction` key — is fixed on master by 56aa713f's UNBOUNDED warmer lane
(`bounded=False`), so nothing here re-solves it; `bounded` is only threaded through
the steal path so the capacity guard can never gate that lane.
"""

import os
import time
import tempfile
import threading

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="lmr_lease_"))

# ⛔ NO `sys.modules.setdefault("api.flow_admin_auth", <two lambdas>)` HERE —
# see the note in `tests/test_flow_classification.py`. The stub was vestigial
# (bcrypt is installed, the real module imports, and nothing here resolves a
# FastAPI dependency), and leaving it installed let import ORDER decide what
# every other test in the process bound. Rail:
# `tests/test_shared_state_landmines.py`.
import pytest
from api import live_massive_router as m
from api.services import liveflow_monitor as mon


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


# --- 1. The lease must survive an orphaned fill's release ---------------------

def test_orphaned_fill_release_must_not_disarm_the_new_holders_lease(monkeypatch):
    """THE wedge. Fill A hangs and is stolen from by fill B. When A finally returns,
    its cleanup must NOT clear B's lease — otherwise the next steal check sees
    lock-held + no-lease, skips the lease branch, and the key can never be stolen
    again (production: `fill_running_sec: None` + age climbing forever)."""
    ck = ("d", 10, "D", "recent", None, True)
    let_a_finish = threading.Event()

    def _hanging_compute(*a, **k):
        let_a_finish.wait(3.0)
        return {"alerts": []}

    monkeypatch.setattr(m, "_compute_recent", _hanging_compute)

    lock_a, got_a = m._acquire_or_steal_fill(ck)
    assert got_a
    m._spawn_recent_fill(ck, "d", 1, "D", "recent", None, True, lock_a)

    time.sleep(0.45)                                   # lease (0.3s) expires
    lock_b, got_b = m._acquire_or_steal_fill(ck)       # B steals the wedged key
    assert got_b is True and lock_b is not lock_a

    let_a_finish.set()                                 # A returns -> its cleanup runs
    time.sleep(0.35)

    assert ck in m._recent_fill_started, (
        "orphaned fill A erased the lease -> /status reports fill_running_sec=None "
        "while a fill still owns the key")

    # The real symptom: B's lease is gone, so B's key can never be stolen again —
    # even long after B's own lease has expired.
    time.sleep(0.45)
    lock_c, got_c = m._acquire_or_steal_fill(ck)
    assert got_c is True, (
        "key became PERMANENTLY un-stealable after the orphan cleared the lease "
        "(this is the 2026-07-30 wedge)")
    lock_c.release()
    lock_b.release()


def test_a_completing_fill_still_clears_its_own_lease():
    """The mirror of the above: a fill that was NOT stolen from must still release
    its lease, or every key would look permanently busy."""
    ck = ("d", 12, "D", "recent", None, True)
    lock, got = m._acquire_or_steal_fill(ck)
    assert got
    m._release_fill(ck, lock)
    assert ck not in m._recent_fill_started
    assert lock.acquire(blocking=False), "lock was not released"
    lock.release()


# --- 2. A steal must not amplify load into a saturated semaphore --------------

def test_no_steal_when_the_fill_semaphore_has_no_free_slot():
    """Stealing reclaims the LOCK but never a semaphore slot. A BOUNDED steal into a
    full semaphore starts another concurrent scan of the same expensive key that can
    only time out — the 2026-07-30 conviction storm (a steal every ~45s, forever)."""
    ck = ("d", 11, "D", "conviction", None, True)
    lock_a, got_a = m._acquire_or_steal_fill(ck)
    assert got_a
    time.sleep(0.45)                                   # lease expired -> stealable

    sem = m._recent_fill_sem
    assert sem.acquire(timeout=1) and sem.acquire(timeout=1)   # drain both slots
    try:
        _, got_b = m._acquire_or_steal_fill(ck)
        assert got_b is False, (
            "stole into a saturated semaphore -> spawns a scan that can only time out")
    finally:
        sem.release()
        sem.release()
        lock_a.release()


def test_unbounded_warmer_steal_ignores_semaphore_capacity():
    """The capacity guard must NOT gate the flow-worker warmer's UNBOUNDED lane
    (56aa713f): that lane skips the semaphore entirely, so a full pool is irrelevant
    to it. Gating it would re-starve the exact key that fix was written to protect."""
    ck = ("d", 13, "D", "recent", None, True)
    lock_a, got_a = m._acquire_or_steal_fill(ck)
    assert got_a
    time.sleep(0.45)                                   # lease expired -> stealable

    sem = m._recent_fill_sem
    assert sem.acquire(timeout=1) and sem.acquire(timeout=1)   # drain both slots
    try:
        lock_b, got_b = m._acquire_or_steal_fill(ck, bounded=False)
        assert got_b is True, (
            "unbounded warmer steal was blocked by a full semaphore it never uses")
        lock_b.release()
    finally:
        sem.release()
        sem.release()
        lock_a.release()


# --- 4. /status must distinguish "no fill" from "a fill owns this key" --------

def test_curated_health_exposes_a_held_fill_lock():
    """The diagnosis gap: for 18 consecutive samples /status showed
    fill_running_sec=None while the key was stale and never refreshing, so a wedged
    key was indistinguishable from an idle healthy one."""
    today = m._today_mdyyyy()
    ck = (today, m._CANON_CURATED_LIMIT, "D", "recent", None, True)
    assert m._curated_health()["fill_lock_held"] is False
    lock, got = m._acquire_or_steal_fill(ck)
    assert got
    try:
        assert m._curated_health()["fill_lock_held"] is True
    finally:
        m._release_fill(ck, lock)


# --- 5. The alert must name the condition that actually fired ----------------

def test_wedge_reason_distinguishes_the_three_failure_modes():
    hung = mon._curated_wedge_reason({"cached": True, "age_sec": 5.0,
                                      "fill_running_sec": 200.0})
    cold = mon._curated_wedge_reason({"cached": False, "age_sec": None,
                                      "fill_running_sec": None})
    stale = mon._curated_wedge_reason({"cached": True, "age_sec": 530.5,
                                       "fill_running_sec": None})
    healthy = mon._curated_wedge_reason({"cached": True, "age_sec": 10.0,
                                         "fill_running_sec": None})
    assert "hung" in hung.lower()
    assert "cold" in cold.lower()
    assert "stale" in stale.lower()
    assert healthy is None


def test_wedge_alert_names_the_real_condition_not_a_hardcoded_empty(monkeypatch):
    """2026-07-30: the alert read '/recent is serving empty' while the feed was
    serving 104 alerts ~9 minutes stale. The text was hardcoded to one failure mode,
    so it pointed the responder at 'restart flow-worker' — the wrong action."""
    now = time.time()
    cur = {"cached": True, "age_sec": 530.5, "alerts": 104, "empty": False,
           "fill_running_sec": None}
    txt = mon._curated_alert_text("curated_wedged", cur, now - 300, now)
    assert "stale" in txt.lower(), txt
    assert "104" in txt, txt
    assert "serving empty" not in txt.lower(), (
        "alert still asserts 'empty' for a stale-but-populated feed")


def test_wedge_alert_still_says_empty_when_the_feed_really_is_empty():
    """The counterpart: don't lose the genuine empty-feed wording."""
    now = time.time()
    cur = {"cached": False, "age_sec": None, "alerts": 0, "empty": True,
           "fill_running_sec": None}
    txt = mon._curated_alert_text("curated_wedged", cur, now - 300, now)
    assert "empty" in txt.lower(), txt
    assert "cold" in txt.lower(), txt
