"""U5 (2026-11-14): the capability detector in its own process, off the request GIL.

`api/services/pine_capability_worker.py` (module header) behind `PINE_CAPABILITY_DETECTOR_WORKER`.
What must hold, each railed below against a REAL spawned child:

* OFF (the default): no process is ever started and the detector runs in-process, as before;
* ON: the answer is the in-process answer, the PARENT spends no CPU on it (it waits on a pipe), and
  the parent's detector is never called, not even when the worker is busy (no inline fallback);
* every failure is PENDING, never an admission: a crash, a hang (killed at the timeout), a child
  that raises or answers junk, a worker still starting, a busy worker, a spent restart budget;
* a dead or hung child is restarted on a later call, within a bounded restart budget;
* the contracts #1204 railed still hold through the worker: one run at a time process-wide, the
  duty cycle, the per-request budget, the save door's bounded wait and 503, the verdict door's
  per-member budget, the 8-concurrent-cold-lists bound.
"""
from __future__ import annotations

import copy
import json
import sqlite3
import threading
import time
from multiprocessing.connection import wait as _mp_wait
from pathlib import Path

import pytest

from api.routers import user_definitions as router_mod
from api.services import pine_capabilities as pc
from api.services import pine_capability_worker as pcw
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
DOCS = {d["slug"]: d for d in json.loads((ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json").read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]
USER = "u-worker-admin"
MEMBER_COPY = ADX["compute"]["source"] + "\n// my own copy\n"
TARGET = "tests._capability_worker_targets:crash_or_hang"


def adversarial(tag: str) -> str:
    base = ADX["compute"]["source"] + f"\n// {tag}\n"
    unit = "f(a, b\n"
    return (base + unit * ((126 * 1024 - len(base)) // len(unit)))[: 126 * 1024]


def member_doc(source: str = MEMBER_COPY) -> dict:
    d = copy.deepcopy(ADX)
    d["compute"]["source"] = source
    return d


@pytest.fixture(autouse=True)
def _own_store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV, rt.CAPABILITY_ADMISSION_ENV,
              rt.CAPABILITY_DENY_ENV, pcw.WORKER_ENV):
        monkeypatch.delenv(k, raising=False)
    rt._reset_capability_cache(persisted=True)
    yield
    pcw._reset_for_tests()
    rt._reset_capability_cache(persisted=True)


@pytest.fixture
def worker(monkeypatch):
    """Admission ON, the worker ON, a fresh child running the test target, up and READY."""
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setenv(pcw.WORKER_ENV, "on")
    w = pcw._reset_for_tests(TARGET)
    w.ensure_started()
    assert w.ready.wait(30), "the detector process never said READY"
    return w


def _gone(proc, within: float = 5.0) -> bool:
    """Has the OS ended this child? Read from its SENTINEL (POSIX: its pipe hits EOF; Windows: its
    handle is signalled), never `join()` + `is_alive()`: on POSIX those call waitpid, and the
    product's own reaper thread (`pcw._reap`) waits on the same pid. Whichever loses gets ECHILD,
    which multiprocessing reports as "still alive" for a child that is already reaped (three
    pine-heavy runs: HUNG, JUNK, HUNG)."""
    return bool(_mp_wait([proc.sentinel], within))


def _no_inline(monkeypatch) -> list:
    """The PARENT's detector, booby-trapped: the worker path must never call it."""
    calls = []

    def trap(src):
        calls.append(1)
        raise AssertionError("the detector ran in the request process")
    monkeypatch.setattr(pc, "capabilities_of", trap)
    return calls


# ─── OFF ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    (None, False), ("", False), ("off", False), ("1", False), ("true", False), ("yes", False),
    ("onn", False), ("o n", False), ("enabled", False),
    ("on", True), ("ON", True), (" on ", True), ("ON ", True),   # case and spaces, as admission reads
])
def test_OFF_unless_on(monkeypatch, value, expected):
    """Literal expectations (review L7), not the implementation restated: only `on`, in any case
    and with surrounding spaces, as `capability_admission_on` reads its own mode."""
    if value is None:
        monkeypatch.delenv(pcw.WORKER_ENV, raising=False)
    else:
        monkeypatch.setenv(pcw.WORKER_ENV, value)
    assert pcw.worker_enabled() is expected


def test_OFF_the_default_is_pinned_in_SOURCE_and_in_the_mode_table():
    src = (ROOT / "api" / "services" / "pine_capability_worker.py").read_text(encoding="utf-8")
    assert 'os.environ.get("PINE_CAPABILITY_DETECTOR_WORKER", "off")' in src
    assert rt.PINE_RUNTIME_MODE_FLAGS[pcw.WORKER_ENV] == ("off", ("off", "on"))


def test_OFF_the_detector_runs_in_process_and_no_process_is_started(monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    w = pcw._reset_for_tests(TARGET)
    calls = []
    real = pc.capabilities_of
    monkeypatch.setattr(pc, "capabilities_of", lambda s: calls.append(1) or real(s))
    assert rt.capabilities_for(MEMBER_COPY) == real(MEMBER_COPY)
    assert calls == [1]
    pcw.prestart()
    assert w.proc is None and w.stats["starts"] == 0 and w.stats["calls"] == 0


# ─── ON: the same answer, off the request GIL ────────────────────────────────

def test_ON_the_answer_is_the_in_process_answer_and_the_parent_never_runs_it(worker, monkeypatch):
    srcs = [ADX["compute"]["source"], MEMBER_COPY,
            MEMBER_COPY + "var line l = na\nl := line.new(bar_index, low, bar_index, high)\n",
            adversarial("same answer"), "", "   "]
    expected = [pc.capabilities_of(s) for s in srcs]
    _no_inline(monkeypatch)
    got = []
    for s in srcs:
        rt._reset_capability_cache()
        got.append(rt.capabilities_for(s, persist=False) if s.strip() else pcw.detect(s)[0])
    assert got == expected
    assert worker.stats["ok"] == len(srcs)


def test_ON_the_parent_spends_no_cpu_while_the_child_detects(worker, monkeypatch):
    """The point of U5: the request process WAITS (GIL released) while the child computes. The
    parent's own CPU time over a near-cap adversarial run is a sliver of the run's wall time."""
    src = adversarial("cpu")
    pcw.detect(adversarial("warm the child"))
    cpu0, wall0 = time.process_time(), time.perf_counter()
    caps, elapsed, status = pcw.detect(src)
    cpu, wall = time.process_time() - cpu0, time.perf_counter() - wall0
    assert status == pcw.OK and caps == pc.capabilities_of(src)
    assert wall > 0.05, wall                       # a real run happened in the child
    assert cpu < 0.35 * wall, (cpu, wall)          # in-process, cpu ~= wall


def test_ON_another_thread_keeps_running_while_the_child_detects(worker):
    src = adversarial("gil")
    pcw.detect(adversarial("warm"))
    ticks, stop = [0], threading.Event()

    def spin():
        while not stop.is_set():
            ticks[0] += 1
    t = threading.Thread(target=spin)
    t.start()
    try:
        t0 = time.perf_counter()
        n0 = ticks[0]
        status = pcw.detect(src)[2]
        dt = time.perf_counter() - t0
        n1 = ticks[0]
    finally:
        stop.set()
        t.join()
    assert status == pcw.OK
    t1 = time.perf_counter()
    m0 = ticks[0]
    while time.perf_counter() - t1 < dt:   # the spinner's rate alone, for the same time
        ticks[0] += 1
    alone = ticks[0] - m0
    assert (n1 - n0) > 0.3 * alone, (n1 - n0, alone)


# ─── every failure is pending ────────────────────────────────────────────────

def _pending_everywhere(src: str) -> None:
    rt._reset_capability_cache()
    assert rt.capabilities_for(src) is None
    rt._reset_capability_cache()
    assert rt.capability_admitted(src) == (False, [rt.PENDING])
    rt._reset_capability_cache()
    row = {"def_id": ADX["id"], "definition": member_doc(src)}
    served = rt.stamp_served(row, budget=rt.DetectorBudget())
    meta = served["definition"]["meta"]
    assert meta.get("runtimePending") is True and "still being checked" in meta["runtimeNotGraded"]


def test_a_CRASHED_child_is_pending_never_admitted_and_is_restarted(worker, monkeypatch):
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    _no_inline(monkeypatch)
    caps, _e, status = pcw.detect(MEMBER_COPY + "// @@CRASH@@\n")
    assert caps is None and status == pcw.CRASHED
    assert worker.proc is None                         # forgotten; the next call restarts it
    monkeypatch.setattr(rt, "_DETECTOR_IDLE_UNTIL", [0.0])
    _pending_everywhere(MEMBER_COPY + "// @@CRASH@@ again\n")
    assert worker.ready.wait(30)
    rt._reset_capability_cache()
    assert rt.capabilities_for(MEMBER_COPY) == frozenset(pcw.detect(MEMBER_COPY)[0])
    assert worker.stats["starts"] >= 2


def test_a_HUNG_child_is_killed_at_the_timeout_and_answers_pending(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    _no_inline(monkeypatch)
    proc = worker.proc
    t0 = time.perf_counter()
    caps, _e, status = pcw.detect(MEMBER_COPY + "// @@HANG@@\n", timeout=0.5)
    assert caps is None and status == pcw.TIMEOUT
    assert time.perf_counter() - t0 < 1.5              # bounded: the caller never waits on a hang
    assert _gone(proc), "the hung child was not killed"
    worker.ensure_started()
    assert worker.ready.wait(30)
    monkeypatch.setattr(rt, "_DETECTOR_IDLE_UNTIL", [0.0])
    assert rt.capabilities_for(MEMBER_COPY) is not None       # restarted, answering


def test_a_hang_through_capabilities_for_is_pending_within_the_call_timeout(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)          # read per call
    _no_inline(monkeypatch)
    t0 = time.perf_counter()
    assert rt.capability_admitted(MEMBER_COPY + "// @@HANG@@\n") == (False, [rt.PENDING])
    assert time.perf_counter() - t0 < 1.5


def test_M1_a_source_that_makes_the_detector_RAISE_is_pending_and_the_healthy_child_is_KEPT(worker, monkeypatch):
    _no_inline(monkeypatch)
    pid = worker.proc.pid
    src = MEMBER_COPY + "// @@RAISE@@\n"
    caps, _ran, status = pcw.detect(src)
    assert caps is None and status == pcw.ERROR
    assert worker.proc is not None and worker.proc.pid == pid and worker.ready.is_set()   # not killed
    assert worker.stats["killed"] == 0 and worker.stats["raised"] == 1
    assert pcw.detect(src) == (None, 0.0, pcw.QUARANTINED)          # not sent again
    assert pcw.detect(MEMBER_COPY)[2] == pcw.OK                     # the same child answers others
    rt._reset_capability_cache()
    monkeypatch.setattr(rt, "_DETECTOR_IDLE_UNTIL", [0.0])
    assert rt.capability_admitted(src) == (False, [rt.PENDING])


def test_a_child_that_answers_JUNK_is_out_of_step_killed_and_pending(worker, monkeypatch):
    _no_inline(monkeypatch)
    proc = worker.proc
    caps, _ran, status = pcw.detect(MEMBER_COPY + "// @@JUNK@@\n")
    assert caps is None and status == pcw.ERROR and worker.proc is None
    assert _gone(proc)


def test_M1_a_source_that_TIMED_OUT_is_quarantined_not_retried_on_every_list(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    _no_inline(monkeypatch)
    src = MEMBER_COPY + "// @@HANG@@ quarantine\n"
    assert pcw.detect(src)[2] == pcw.TIMEOUT
    worker.ensure_started()
    assert worker.ready.wait(30)
    starts, killed = worker.stats["starts"], worker.stats["killed"]
    for _ in range(5):                                              # five list reads later
        rt._reset_capability_cache()
        monkeypatch.setattr(rt, "_DETECTOR_IDLE_UNTIL", [0.0])
        assert rt.capability_admitted(src) == (False, [rt.PENDING])
    assert worker.stats["quarantined"] == 5
    assert (worker.stats["starts"], worker.stats["killed"]) == (starts, killed)   # the child untouched
    assert pcw.detect(MEMBER_COPY)[2] == pcw.OK


def test_M1_the_quarantine_ends_and_doubles_on_a_repeat(monkeypatch):
    w = pcw._Worker(TARGET)
    monkeypatch.setattr(pcw, "QUARANTINE_BASE_S", 10.0)
    w.strike("k", 100.0)
    assert w.quarantined("k", 105.0) and not w.quarantined("k", 110.5)
    w.strike("k", 111.0)                                             # a repeat after it ended
    assert w.quarantined("k", 130.0) and not w.quarantined("k", 131.5)
    monkeypatch.setattr(pcw, "QUARANTINE_MAX_S", 25.0)
    w.strike("k", 200.0)
    assert w.quarantined("k", 224.0) and not w.quarantined("k", 225.5)   # capped at 25 s
    monkeypatch.setattr(pcw, "QUARANTINE_MAX_ENTRIES", 2)
    for k in ("a", "b", "c"):
        w.strike(k, 300.0)
    assert set(w.quarantine) == {"b", "c"}


def test_a_BUSY_worker_answers_pending_at_once_and_never_runs_inline(worker, monkeypatch):
    calls = _no_inline(monkeypatch)
    assert worker.call_lock.acquire(blocking=False)
    try:
        t0 = time.perf_counter()
        assert pcw.detect(MEMBER_COPY) == (None, 0.0, pcw.BUSY)
        assert rt.capabilities_for(MEMBER_COPY) is None
        assert time.perf_counter() - t0 < 0.1
    finally:
        worker.call_lock.release()
    assert calls == []


def test_a_worker_still_STARTING_is_pending_for_a_serve_and_awaited_by_the_save_door(monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setenv(pcw.WORKER_ENV, "on")
    w = pcw._reset_for_tests(TARGET)
    _no_inline(monkeypatch)
    t0 = time.perf_counter()
    assert rt.capabilities_for(MEMBER_COPY) is None            # a serve never waits for the start
    assert time.perf_counter() - t0 < 0.5
    assert w.stats["starts"] == 1                               # ...but it started the worker
    assert w.ready.wait(30)
    # a save that arrives while the worker is down waits for READY within its own deadline
    w2 = pcw._reset_for_tests(TARGET)
    rt._reset_capability_cache()
    caps = rt.capabilities_for(MEMBER_COPY, wait=25.0)
    assert caps is not None and w2.stats["ok"] == 1


def test_a_spent_restart_budget_stays_pending_and_starts_nothing_more(worker, monkeypatch):
    monkeypatch.setattr(pcw, "MAX_STARTS_PER_WINDOW", 2)
    _no_inline(monkeypatch)
    pcw.detect(MEMBER_COPY + "// @@CRASH@@\n")                       # start 1 crashed
    worker.ensure_started()                                          # start 2
    assert worker.ready.wait(30)
    pcw.detect(MEMBER_COPY + "// @@CRASH@@ 2\n")                     # crashed again
    starts = worker.stats["starts"]
    for _ in range(3):
        assert pcw.detect(MEMBER_COPY, ready_wait=0.2)[2] == pcw.UNAVAILABLE
    assert worker.stats["starts"] == starts and worker.proc is None


def test_M1_timeouts_do_not_spend_the_crash_budget_and_have_their_own_bound(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    monkeypatch.setattr(pcw, "MAX_STARTS_PER_WINDOW", 1)            # the boot start used it up
    monkeypatch.setattr(pcw, "MAX_TIMEOUT_STARTS_PER_WINDOW", 2)
    _no_inline(monkeypatch)
    for i in range(2):                                              # two distinct slow sources
        assert pcw.detect(MEMBER_COPY + f"// @@HANG@@ {i}\n")[2] == pcw.TIMEOUT
        worker.ensure_started()
        assert worker.ready.wait(30), f"restart {i} after a timeout was refused"
    assert pcw.detect(MEMBER_COPY + "// @@HANG@@ 3\n")[2] == pcw.TIMEOUT
    worker.ensure_started()                                         # the timeout budget is spent
    assert worker.proc is None and pcw.detect(MEMBER_COPY, ready_wait=0.2)[2] == pcw.UNAVAILABLE


def test_L2_the_cool_down_and_budget_are_charged_with_the_CHILDS_run_time(monkeypatch):
    """A save that waits ~1 s for a starting child (its warm-up is slow) is charged the child's
    few milliseconds, not the second of parent wall time."""
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setenv(pcw.WORKER_ENV, "on")
    pcw._reset_for_tests("tests._capability_worker_targets:slow_warm")
    _no_inline(monkeypatch)
    t0 = time.perf_counter()
    assert rt.capabilities_for(MEMBER_COPY, wait=25.0) is not None
    assert time.perf_counter() - t0 > 0.9                             # it really waited
    assert rt._DETECTOR_IDLE_UNTIL[0] - time.monotonic() < 0.5        # ~2x the child's ms
    caps, ran, status = pcw.detect(adversarial("ran"))
    assert status == pcw.OK and ran > 0


def test_L3_a_pipe_that_will_not_take_the_source_is_a_bounded_timeout(monkeypatch):
    monkeypatch.setattr(pcw, "SEND_TIMEOUT_S", 0.3)
    w = pcw._Worker(TARGET)

    class Proc:
        pid = 1
        terminated = False

        def terminate(self):
            Proc.terminated = True

        def join(self, *_a):
            pass

        def is_alive(self):
            return False

        def kill(self):
            pass

    class Stuck:
        def send(self, _msg):
            time.sleep(3)

        def close(self):
            pass
    w.proc, w.conn = Proc(), Stuck()
    w.ready.set()
    t0 = time.perf_counter()
    caps, ran, status = w.detect(MEMBER_COPY)
    assert caps is None and status == pcw.TIMEOUT
    assert 0.25 <= ran < 1.0                       # follow-up L1: the stall is charged, not 0
    assert time.perf_counter() - t0 < 1.0 and Proc.terminated and w.proc is None
    assert w.next_start_kind == "timeout"


def test_L4_the_lifespan_stops_the_child_at_shutdown():
    import ast as _ast
    tree = _ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    life = next(n for n in _ast.walk(tree) if isinstance(n, _ast.AsyncFunctionDef) and n.name == "lifespan")
    seen_yield = called_after = False
    for st in life.body:
        if isinstance(st, _ast.Expr) and isinstance(st.value, _ast.Yield):
            seen_yield = True
            continue
        text = _ast.unparse(st)
        if seen_yield and "pine_capability_worker" in text and "shutdown()" in text:
            called_after = True
    assert seen_yield and called_after, "shutdown() is not called after the lifespan's yield"


def test_L6_the_admin_read_of_the_worker(worker):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    pcw.detect(MEMBER_COPY)

    def client(role):
        app = FastAPI()
        app.include_router(router_mod.router)
        app.dependency_overrides[get_current_user_with_plan] = (
            lambda: {"id": "u-x", "role": role, "plan": "premium"})
        return TestClient(app)
    assert client("member").get("/api/user-definitions/capability-worker").status_code == 403
    body = client("admin").get("/api/user-definitions/capability-worker").json()
    assert body["enabled"] is True and body["alive"] is True and body["ready"] is True
    assert body["ok"] >= 1 and "quarantine" in body and body["pid"] == worker.proc.pid


def test_a_child_that_cannot_load_its_detector_is_killed_and_pending(monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setenv(pcw.WORKER_ENV, "on")
    w = pcw._reset_for_tests("tests._capability_worker_targets:broken_import")
    w.ensure_started()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and (w.starting or w.proc is not None):
        time.sleep(0.05)
    assert not w.ready.is_set() and w.proc is None
    assert pcw.detect(MEMBER_COPY)[0] is None


# ─── the #1204 contracts, through the worker ─────────────────────────────────

def test_the_duty_cycle_and_the_budget_are_charged_from_a_worker_run(worker, monkeypatch):
    _no_inline(monkeypatch)
    rt._reset_capability_cache()
    b = rt.DetectorBudget()
    assert rt.capabilities_for(adversarial("duty"), budget=b) is not None
    assert b.done == 1 and b.spent > 0
    assert rt._DETECTOR_IDLE_UNTIL[0] > time.monotonic()            # cooling: the next run waits
    assert rt.capabilities_for(adversarial("duty 2"), budget=rt.DetectorBudget()) is None


def test_the_verdict_door_charges_the_members_own_budget(worker, monkeypatch):
    _no_inline(monkeypatch)
    monkeypatch.setattr(rt, "VERDICT_MEMBER_SECONDS", 0.0001)
    first = rt.runtime_admission(adversarial("verdict"), member="m-hammer")
    assert first["missing"] != [rt.PENDING] and worker.stats["ok"] == 1     # ran, in the worker
    monkeypatch.setattr(rt, "_VERDICT_BUCKET", [rt.VERDICT_BUCKET_SECONDS, None])
    monkeypatch.setattr(rt, "_DETECTOR_IDLE_UNTIL", [0.0])
    # the member's rolling spend was charged with the worker run's time: the next is held back
    assert rt.runtime_admission(adversarial("verdict 2"), member="m-hammer")["missing"] == [rt.PENDING]
    assert rt.runtime_admission(adversarial("verdict 3"), member="m-other")["missing"] != [rt.PENDING]


def _hold_gate(seconds: float) -> threading.Thread:
    held = threading.Event()

    def hold():
        assert rt._DETECTOR_GATE.acquire(timeout=5)
        held.set()
        time.sleep(seconds)
        rt._DETECTOR_GATE.release()
    t = threading.Thread(target=hold)
    t.start()
    assert held.wait(5)
    return t


def test_the_save_door_is_503_busy_on_a_crash_and_stores_nothing(worker, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    _no_inline(monkeypatch)
    with pytest.raises(rt.CapabilityCheckBusy, match="try again in a moment"):
        svc.save(USER, ADX["id"], member_doc(MEMBER_COPY + "// @@CRASH@@\n"), role="admin")
    assert svc.get(USER, ADX["id"]) is None
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute(rt._CAPS_DDL)
        assert c.execute(f"SELECT COUNT(*) FROM {rt.CAPS_TABLE}").fetchone()[0] == 0


def test_the_save_door_still_waits_out_a_short_busy_spell_and_stores(worker, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    _no_inline(monkeypatch)
    holder = _hold_gate(0.2)
    try:
        svc.save(USER, ADX["id"], member_doc(), role="admin")
    finally:
        holder.join(10)
    assert svc.get(USER, ADX["id"])["definition"]["compute"]["source"] == MEMBER_COPY
    with sqlite3.connect(svc._DB_PATH) as c:
        assert c.execute(f"SELECT COUNT(*) FROM {rt.CAPS_TABLE}").fetchone()[0] == 1


def _seed_member_rows(monkeypatch, user: str, sources: list) -> None:
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(ADX["compute"]["source"]))
    ids = []
    for _ in sources:
        d = copy.deepcopy(ADX)
        did = svc.new_def_id()
        d["id"] = did
        svc.save(user, did, d, role="admin")
        ids.append(did)
    with sqlite3.connect(svc._DB_PATH) as c:
        for did, src in zip(ids, sources):
            rid, blob = c.execute("SELECT id, definition FROM user_definitions WHERE def_id = ? AND user_id = ?",
                                  (did, user)).fetchone()
            d = json.loads(blob)
            d["compute"]["source"] = src
            c.execute("UPDATE user_definitions SET definition = ? WHERE id = ?", (json.dumps(d), rid))
    monkeypatch.delenv(rt.ALLOW_ENV)


def test_GATE_8_concurrent_cold_lists_through_the_worker_each_under_1s_one_run(worker, monkeypatch):
    members = [f"u-wgate-{i}" for i in range(8)]
    for i, m in enumerate(members):
        _seed_member_rows(monkeypatch, m, [adversarial(f"m{i} r{k}") for k in range(12)])
    monkeypatch.setattr(svc, "server_lanes_stamp", lambda row: {})
    rt._reset_capability_cache(persisted=True)
    _no_inline(monkeypatch)
    ok0 = worker.stats["ok"]
    walls, errors = {}, []
    start = threading.Barrier(len(members))

    def one(m):
        try:
            start.wait()
            t0 = time.perf_counter()
            body = router_mod.list_definitions(user={"id": m, "role": "admin", "plan": "premium"},
                                               graph=False, engine=None)
            walls[m] = time.perf_counter() - t0
            assert len(body["definitions"]) == 12
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    threads = [threading.Thread(target=one, args=(m,)) for m in members]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert max(walls.values()) < 1.0, walls
    assert worker.stats["ok"] - ok0 == 1


# ─── U5 follow-up (re-review): a hang is charged, variants are refused, the save says why ────────

HANG = MEMBER_COPY + "// @@HANG@@ follow-up\n"


def test_FL1_a_timeout_charges_its_WALL_time_not_zero(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    caps, ran, status = pcw.detect(HANG)
    assert caps is None and status == pcw.TIMEOUT
    assert 0.45 <= ran < 1.5, ran


def test_FL1_a_hang_charges_the_request_budget_and_the_cool_down(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    _no_inline(monkeypatch)
    b = rt.DetectorBudget()
    assert rt.capabilities_for(HANG + "// budget\n", budget=b) is None
    assert b.spent >= 0.45 and b.done == 1
    # the duty cycle (1/3) cools the detector for 2x the run: a hang is not free
    assert rt._DETECTOR_IDLE_UNTIL[0] - time.monotonic() >= 0.8


def test_FL1_a_hang_at_the_verdict_door_charges_the_members_own_budget(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    _no_inline(monkeypatch)
    out = rt.runtime_admission(HANG + "// verdict\n", member="m-hang")
    assert out["missing"] == [rt.PENDING]
    assert rt._verdict_member_spent("m-hang", time.monotonic()) >= 0.45


def test_FL1_a_member_whose_sources_keep_striking_is_quarantined_as_a_member(worker, monkeypatch):
    """One-character variants of a hanging script each hash differently; the member strike is what
    stops them. Another member is untouched, and so are this member's stored or cached sets."""
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    _no_inline(monkeypatch)
    for i in range(pcw.MEMBER_STRIKES_LIMIT):
        assert pcw.detect(HANG + f"// variant {i}\n", member="m-var")[2] == pcw.TIMEOUT
        worker.ensure_started()
        assert worker.ready.wait(30)
    starts = worker.stats["starts"]
    assert pcw.detect(HANG + "// variant next\n", member="m-var") == (None, 0.0, pcw.QUARANTINED)
    assert pcw.detect(MEMBER_COPY, member="m-var")[2] == pcw.QUARANTINED   # any fresh run, this member
    assert worker.stats["starts"] == starts                                # the child untouched
    assert pcw.detect(MEMBER_COPY, member="m-other")[2] == pcw.OK
    assert pcw.is_quarantined(MEMBER_COPY, member="m-var") is True
    assert pcw.status()["members_quarantined"] == 1
    # the strikes age out of the window
    later = time.monotonic() + pcw.MEMBER_STRIKE_WINDOW_S + 1
    assert worker.member_quarantined("m-var", later) is False


def test_FL1_capabilities_for_strikes_the_requests_member(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    _no_inline(monkeypatch)
    for i in range(pcw.MEMBER_STRIKES_LIMIT):
        monkeypatch.setattr(rt, "_DETECTOR_IDLE_UNTIL", [0.0])
        assert rt.capabilities_for(HANG + f"// cf {i}\n", budget=rt.DetectorBudget(member="m-list")) is None
        worker.ensure_started()
        assert worker.ready.wait(30)
    assert worker.member_quarantined("m-list", time.monotonic()) is True


def test_FL1_the_list_and_history_routes_name_their_member_on_the_budget(monkeypatch):
    seen = []
    real = rt.DetectorBudget

    class Spy(real):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            seen.append(self.member)
    monkeypatch.setattr(rt, "DetectorBudget", Spy)
    router_mod.list_definitions(user={"id": "u-route", "role": "admin", "plan": "premium"},
                                graph=False, engine=None)
    assert seen == ["u-route"]
    src = (ROOT / "api" / "routers" / "user_definitions.py").read_text(encoding="utf-8")
    assert src.count('DetectorBudget(member=str(user["id"]))') == 2       # list AND history


def test_FL3_a_quarantined_script_at_the_save_door_says_PAUSED_not_busy(worker, monkeypatch):
    monkeypatch.setattr(pcw, "CALL_TIMEOUT_S", 0.5)
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    _no_inline(monkeypatch)
    src = HANG + "// save\n"
    with pytest.raises(rt.CapabilityCheckPaused, match="temporarily paused after repeated failures; try again later"):
        svc.save(USER, ADX["id"], member_doc(src), role="admin")
    assert svc.get(USER, ADX["id"]) is None                                 # nothing stored
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": USER, "role": "admin", "plan": "premium"}
    r = TestClient(app).post("/api/user-definitions", json={"definition": member_doc(src)})
    assert r.status_code == 503 and r.headers.get("Retry-After") == "600"
    assert "temporarily paused" in r.json()["detail"] and r.json()["retryable"] is True


def test_FL3_a_busy_gate_still_says_busy_with_a_short_retry(worker, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    _no_inline(monkeypatch)
    holder = _hold_gate(rt.SAVE_WAIT_SECONDS + 1.0)
    try:
        with pytest.raises(rt.CapabilityCheckBusy) as exc:
            svc.save(USER, ADX["id"], member_doc(), role="admin")
        assert not isinstance(exc.value, rt.CapabilityCheckPaused)
        assert "try again in a moment" in str(exc.value) and exc.value.retry_after == 2
    finally:
        holder.join(10)
