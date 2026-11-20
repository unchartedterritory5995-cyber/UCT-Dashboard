"""THE VERDICT DOOR'S SHARED GATES, RE-SHAPED (2026-11-19). No protection removed.

Measured (`docs/pine/evidence/2026-11-19-admission-budget/`): with the gates as they were, steady
persisted work (list/serve runs on unstored sources) or another member's big verdicts held a ~1 ms
script's verdict "still being checked" for 15-90 s. Re-shaped:

  * G2: the verdict door's 1/6 is a TOKEN BUCKET (`VERDICT_BUCKET_SECONDS`, refilling at
    `VERDICT_DUTY_CYCLE`), not an idle-after-every-run cool-down. Same long-run 1/6.
  * G3: a verdict projected at most `VERDICT_RESERVE_SECONDS` may run during the persisted cool-down,
    one run at a time, charged to the bucket and the member's budget, never while a save waits.
  * A pending answer says WHY: `pending_reason` busy / starting / paused.

Held here, on a simulated clock (the detector's cost is charged to the clock, so the bounds are exact):
the long-run duty bounds hold (verdicts <= C + T/6 + one run; persisted <= T/3 + one run; together
<= 1/2), a small verdict is not starved by persisted traffic or by another member's big verdict, a big
verdict still yields, a waiting save still has priority, and each pending reason is the true one.
"""
from __future__ import annotations

import contextlib
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import pine_capabilities as pc
from api.services import pine_capability_worker as cw
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

#: the simulated detector's cost: 2 us per source byte (measured on this box: ~1.3 us)
PER_BYTE = 2e-6
SMALL_BYTES = 1_000          # ~2 ms: a typical assistant-written script
BIG_BYTES = 50_000           # ~100 ms: projected over the reserve


class Clock:
    """`time` as `runtime_definitions` reads it, driven by hand: the detector advances it by its cost."""

    def __init__(self):
        self.t = 1000.0

    def monotonic(self):
        return self.t

    perf_counter = monotonic

    def time(self):
        return self.t

    def sleep(self, dt):
        self.t += max(0.0, dt)


@pytest.fixture
def clock(monkeypatch, tmp_path):
    for k in (rt.KILL_ENV, rt.ALLOW_ENV, rt.CAPABILITY_DENY_ENV, cw.WORKER_ENV):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    rt._reset_capability_cache(persisted=True)
    c = Clock()
    monkeypatch.setattr(rt, "time", types.SimpleNamespace(monotonic=c.monotonic, perf_counter=c.perf_counter,
                                                           time=c.time, sleep=c.sleep))
    monkeypatch.setattr(rt, "_SECONDS_PER_BYTE", [PER_BYTE])
    spent = {"verdict": 0.0, "persisted": 0.0, "max": 0.0}
    role = {"now": None}

    def detector(src):
        cost = len(src) * PER_BYTE
        c.t += cost
        spent[role["now"]] += cost
        spent["max"] = max(spent["max"], cost)
        return frozenset({"core"})
    monkeypatch.setattr(pc, "capabilities_of", detector)
    monkeypatch.setattr(rt, "admitted_capabilities", lambda: {"admitted": ["core"], "historyOnly": [],
                                                              "withheld": {}, "denied": []})
    c.spent, c.role = spent, role
    yield c
    rt._reset_capability_cache(persisted=True)


def _src(nbytes: int, tag) -> str:
    head = f"//@version=5\nindicator('{tag}')\n"
    return head + "x" * max(0, nbytes - len(head))


def _verdict(clock, nbytes, tag, member):
    clock.role["now"] = "verdict"
    return rt.runtime_admission(_src(nbytes, tag), member=member)


def _serve(clock, nbytes, tag):
    clock.role["now"] = "persisted"
    return rt.capabilities_for(_src(nbytes, tag), budget=rt.DetectorBudget(), persist=False)


def test_the_verdict_door_stays_under_its_long_run_one_sixth(clock):
    """Big verdicts from members who each still have budget, asked every 50 ms for 300 s."""
    T, step, k = 300.0, 0.05, 0
    end = clock.t + T
    while clock.t < end:
        k += 1
        _verdict(clock, BIG_BYTES, f"v{k}", member=f"m{k}")
        clock.t += step
    used = clock.spent["verdict"]
    assert used <= rt.VERDICT_BUCKET_SECONDS + T * rt.VERDICT_DUTY_CYCLE + clock.spent["max"] + 1e-9
    assert used >= T * rt.VERDICT_DUTY_CYCLE * 0.9          # and the door is not shut tighter than its rate


def test_with_persisted_work_saturating_the_total_stays_under_one_half_and_small_verdicts_still_land(clock):
    """Cold big serves every 50 ms (the persisted 1/3 saturated) and a small verdict every 50 ms."""
    T, step, k, landed = 300.0, 0.05, 0, 0
    end = clock.t + T
    while clock.t < end:
        k += 1
        _serve(clock, BIG_BYTES, f"s{k}")
        landed += _verdict(clock, SMALL_BYTES, f"v{k}", member=f"m{k}")["missing"] != [rt.PENDING]
        clock.t += step
    one = clock.spent["max"]
    assert clock.spent["persisted"] <= T / 3 + one + 1e-9
    assert clock.spent["verdict"] <= rt.VERDICT_BUCKET_SECONDS + T * rt.VERDICT_DUTY_CYCLE + one + 1e-9
    assert clock.spent["persisted"] + clock.spent["verdict"] <= T / 2 + rt.VERDICT_BUCKET_SECONDS + 2 * one + 1e-9
    assert landed >= 0.9 * k                                  # the small verdicts were not starved


def test_a_members_small_script_gets_its_verdict_on_the_first_ask_under_persisted_load(clock):
    for i in range(20):                                        # the persisted cool-down is running
        _serve(clock, BIG_BYTES, f"warm{i}")
        clock.t += 0.01
    assert clock.t < rt._DETECTOR_IDLE_UNTIL[0]
    got = _verdict(clock, SMALL_BYTES, "mine", member="me")
    assert got["admitted"] is True


def test_a_big_verdict_still_yields_to_the_persisted_cool_down(clock):
    _serve(clock, BIG_BYTES, "serve")
    assert clock.t < rt._DETECTOR_IDLE_UNTIL[0]
    got = _verdict(clock, BIG_BYTES, "big", member="me")
    assert got["missing"] == [rt.PENDING] and got["pending_reason"] == rt.PENDING_BUSY


def test_another_members_big_verdict_does_not_shut_the_door_on_a_small_one(clock):
    assert _verdict(clock, BIG_BYTES, "theirs", member="them")["admitted"] is True
    assert _verdict(clock, SMALL_BYTES, "mine", member="me")["admitted"] is True       # no 5x idle after it


def test_a_drained_bucket_holds_verdicts_until_it_refills(clock):
    rt._VERDICT_BUCKET[:] = [-0.5, clock.t]
    held = _verdict(clock, SMALL_BYTES, "a", member="me")
    assert held["missing"] == [rt.PENDING] and held["pending_reason"] == rt.PENDING_BUSY
    clock.t += 0.5 / rt.VERDICT_DUTY_CYCLE + 0.01                                       # refilled past zero
    assert _verdict(clock, SMALL_BYTES, "a", member="me")["admitted"] is True


def test_a_waiting_save_keeps_its_priority_over_a_new_verdict(clock):
    rt._PERSISTED_WAITERS[0] = 1
    try:
        held = _verdict(clock, SMALL_BYTES, "a", member="me")
        assert held["missing"] == [rt.PENDING] and held["pending_reason"] == rt.PENDING_BUSY
    finally:
        rt._PERSISTED_WAITERS[0] = 0
    assert _verdict(clock, SMALL_BYTES, "a", member="me")["admitted"] is True


def test_a_save_waiting_on_the_gate_is_counted_and_holds_new_verdicts(clock):
    """The real save path (a bounded wait), not the counter set by hand: while it waits, verdicts yield."""
    import threading
    clock.role["now"] = "persisted"
    assert rt._DETECTOR_GATE.acquire(blocking=False)              # another run holds the gate
    saved = {}
    t = threading.Thread(target=lambda: saved.setdefault(
        "caps", rt.capabilities_for(_src(SMALL_BYTES, "save"), wait=rt.SAVE_WAIT_SECONDS, persist=False)))
    t.start()
    try:
        for _ in range(200):                                       # the save is now waiting in acquire
            if rt._PERSISTED_WAITERS[0]:
                break
            threading.Event().wait(0.005)
        assert rt._PERSISTED_WAITERS[0] == 1
        held = rt.runtime_admission(_src(SMALL_BYTES, "v"), member="me")
        assert held["missing"] == [rt.PENDING] and held["pending_reason"] == rt.PENDING_BUSY
    finally:
        rt._DETECTOR_GATE.release()
        t.join(5)
    assert saved["caps"] == frozenset({"core"}) and rt._PERSISTED_WAITERS[0] == 0


def test_the_members_own_budget_still_holds_a_hammering_member(clock):
    rt._verdict_member_charge("hammer", clock.t, rt.VERDICT_MEMBER_SECONDS)
    held = _verdict(clock, SMALL_BYTES, "h", member="hammer")
    assert held["missing"] == [rt.PENDING] and held["pending_reason"] == rt.PENDING_BUSY
    assert _verdict(clock, SMALL_BYTES, "o", member="other")["admitted"] is True


# ═══ the pending reason ═══════════════════════════════════════════════════════════════════

@contextlib.contextmanager
def _gate_held():
    assert rt._DETECTOR_GATE.acquire(blocking=False)
    try:
        yield
    finally:
        rt._DETECTOR_GATE.release()


def test_a_held_gate_reads_busy(clock):
    with _gate_held():
        got = _verdict(clock, SMALL_BYTES, "a", member="me")
    assert got["missing"] == [rt.PENDING] and got["pending_reason"] == rt.PENDING_BUSY


@pytest.mark.parametrize("status, quarantined, reason", [
    (cw.BUSY, False, rt.PENDING_BUSY), (cw.UNAVAILABLE, False, rt.PENDING_STARTING),
    (cw.QUARANTINED, True, rt.PENDING_PAUSED), (cw.TIMEOUT, True, rt.PENDING_STARTING),
    (cw.CRASHED, False, rt.PENDING_STARTING), (cw.ERROR, True, rt.PENDING_PAUSED),
    (cw.ERROR, False, rt.PENDING_STARTING)])
def test_each_worker_answer_reads_its_own_reason(clock, monkeypatch, status, quarantined, reason):
    monkeypatch.setenv(cw.WORKER_ENV, "on")
    monkeypatch.setattr(cw, "detect", lambda *a, **k: (None, 0.0, status))
    monkeypatch.setattr(cw, "is_quarantined", lambda *a, **k: quarantined)
    got = _verdict(clock, SMALL_BYTES, f"w{status}", member="me")
    assert got["missing"] == [rt.PENDING] and got["pending_reason"] == reason


def test_the_reason_reaches_the_window_through_the_route_and_only_on_a_pending_answer(clock):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "me", "role": "admin", "plan": "premium"}
    http = TestClient(app)
    clock.role["now"] = "verdict"
    with _gate_held():
        body = http.post("/api/user-definitions/runtime-admission", json={"source": _src(SMALL_BYTES, "r")}).json()
    assert body["missing"] == [rt.PENDING] and body["pending_reason"] == rt.PENDING_BUSY
    body = http.post("/api/user-definitions/runtime-admission", json={"source": _src(SMALL_BYTES, "r")}).json()
    assert body["admitted"] is True and "pending_reason" not in body
