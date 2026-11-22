"""The nightly scan sweep's BOOT CATCH-UP (`scan_evaluator.sweep_catch_up`).

Measured 2026-11-22: a web restart at 10:00-10:01Z landed on the 05:00 ET slot and
the night's sweep did not run. The scheduler's jobs live in memory, so a pod that
starts after the slot computes the next fire as tomorrow; `misfire_grace_time` only
helps a scheduler that was running at the slot. The catch-up reads the ARTIFACT (a
`scan_coverage` row per definition for the session) and sweeps only what has none,
once, between today's slot and its deadline (the store-backup catch-up's pattern, #1281).

Mutation proof (run before calling these done; restore from a saved copy):
    A. sweep every definition, receipts ignored  -> test_it_sweeps_ONLY_what_has_no_receipt_and_a_second_run_sweeps_nothing RED
    B. no slot check                             -> test_before_todays_slot_it_leaves_the_night_to_the_scheduled_sweep RED
    C. no deadline check                         -> test_past_todays_deadline_it_runs_nothing RED
    D. the catch-up job without the shared lock  -> test_the_catch_up_never_runs_beside_a_sweep RED
    E. the boot job not registered               -> test_the_boot_job_is_registered_beside_the_sweep RED
"""
from __future__ import annotations

import datetime

import pytest

from api.services.screener import scan_evaluator
from api.services.screener import scan_store
from tests.test_scan_evaluator import (  # noqa: F401  (store, bars are fixtures)
    PRICE_TREE, SESSION, SESSION_DATE, TF, _FakeScheduler, _at, _daily_bars, _definition,
    _num, _op, _series, bars, store,
)


def _two():
    return (_definition(PRICE_TREE, def_id="u_00000000000a"),
            _definition(_op("<", _series("close"), _num(0)), def_id="u_00000000000b"))


@pytest.fixture
def night(monkeypatch, bars):
    """Tonight's definitions, the universe, the session, and a spy on `run_sweep`."""
    bars["A"] = _daily_bars()
    first, second = _two()
    state = {"definitions": [first, second], "handed": []}
    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep", lambda: list(state["definitions"]))
    monkeypatch.setattr(scan_evaluator.snapshot_builder, "_load_universe", lambda: ["A"])
    monkeypatch.setattr(scan_evaluator, "expected_session", lambda: SESSION)
    real = scan_evaluator.run_sweep

    def spy(definitions, *a, **kw):
        state["handed"].append([d["id"] for d in definitions])
        return real(definitions, *a, **kw)

    monkeypatch.setattr(scan_evaluator, "run_sweep", spy)
    state["first"], state["second"] = first, second
    return state


def _clock(monkeypatch, when):
    monkeypatch.setattr(scan_evaluator, "_now_et", lambda: when)


def _receipt(definition):
    return scan_store.coverage(scan_evaluator._scannable_handle(definition), TF, SESSION)


def test_it_sweeps_ONLY_what_has_no_receipt_and_a_second_run_sweeps_nothing(store, night, monkeypatch):
    """The 05:00 run was cut after the first definition: the catch-up sweeps the
    second alone, and a later boot finds both receipts and sweeps nothing."""
    slot = _at(scan_evaluator.SWEEP_HOUR_ET, scan_evaluator.SWEEP_MINUTE_ET)
    _clock(monkeypatch, slot)
    scan_evaluator.run_sweep([night["first"]], TF, universe=["A"], as_of=SESSION)
    assert _receipt(night["first"]) is not None and _receipt(night["second"]) is None
    night["handed"].clear()

    _clock(monkeypatch, _at(6))
    out = scan_evaluator.sweep_catch_up()
    assert night["handed"] == [["u_00000000000b"]], night["handed"]
    assert out and out["as_of"] == SESSION and out["swept"] == 1
    assert _receipt(night["second"]) is not None

    assert scan_evaluator.sweep_catch_up() is None
    assert night["handed"] == [["u_00000000000b"]], "the second boot swept again"


def test_a_night_that_never_ran_is_swept_whole(store, night, monkeypatch):
    _clock(monkeypatch, _at(6, 30))
    out = scan_evaluator.sweep_catch_up()
    assert night["handed"] == [["u_00000000000a", "u_00000000000b"]]
    assert out["swept"] == 2
    assert _receipt(night["first"]) is not None and _receipt(night["second"]) is not None


def test_before_todays_slot_it_leaves_the_night_to_the_scheduled_sweep(store, night, monkeypatch):
    _clock(monkeypatch, _at(scan_evaluator.SWEEP_HOUR_ET - 1, 59))
    assert scan_evaluator.sweep_catch_up() is None
    assert night["handed"] == []


def test_past_todays_deadline_it_runs_nothing(store, night, monkeypatch):
    deadline = scan_evaluator.sweep_deadline(_at(6))
    _clock(monkeypatch, deadline)
    assert scan_evaluator.sweep_catch_up() is None
    _clock(monkeypatch, deadline + datetime.timedelta(hours=3))
    assert scan_evaluator.sweep_catch_up() is None
    assert night["handed"] == []
    # control: a minute before the deadline it does run
    _clock(monkeypatch, deadline - datetime.timedelta(minutes=1))
    assert scan_evaluator.sweep_catch_up() is not None
    assert night["handed"] == [["u_00000000000a", "u_00000000000b"]]


def test_an_unreadable_definitions_store_is_contained(store, monkeypatch):
    def boom():
        raise RuntimeError("definitions store unreadable")

    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep", boom)
    _clock(monkeypatch, _at(6))
    assert scan_evaluator.sweep_catch_up() is None


# ── the wiring in api/main.py ────────────────────────────────────────────────

def _registered(monkeypatch, enabled=True):
    import api.main as main_mod

    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    if enabled:
        monkeypatch.setenv("SCAN_SWEEP_ENABLED", "1")
    else:
        monkeypatch.delenv("SCAN_SWEEP_ENABLED", raising=False)
    monkeypatch.setattr(main_mod, "start_screener_snapshot_warm", lambda: None)
    sched = _FakeScheduler()
    main_mod.register_screener_jobs(sched)
    return {j["id"]: j for j in sched.jobs}


def test_the_boot_job_is_registered_beside_the_sweep(monkeypatch):
    t0 = datetime.datetime.now(scan_evaluator._ET)
    by_id = _registered(monkeypatch)
    job = by_id.get("screener_scan_sweep_catchup_boot")
    assert job is not None, "no boot catch-up job: a restart across 05:00 ET loses the night"
    assert job["trigger"] == "date" and job["max_instances"] == 1
    lag = (job["run_date"] - t0).total_seconds()
    assert scan_evaluator.SWEEP_CATCHUP_BOOT_DELAY_S - 5 <= lag <= scan_evaluator.SWEEP_CATCHUP_BOOT_DELAY_S + 60, lag
    assert job.get("misfire_grace_time", 0) >= 600
    calls = []
    monkeypatch.setattr(scan_evaluator, "sweep_catch_up", lambda: calls.append(1))
    job["fn"]()
    assert calls == [1]
    # and dark with the sweep itself
    assert "screener_scan_sweep_catchup_boot" not in _registered(monkeypatch, enabled=False)


def test_the_catch_up_never_runs_beside_a_sweep(monkeypatch):
    """One lock over both jobs: a catch-up that ran beside a sweep in flight would read
    that sweep's not-yet-written receipts as "behind" and sweep them a second time."""
    by_id = _registered(monkeypatch)
    sweep, catch_up = by_id["screener_scan_sweep"]["fn"], by_id["screener_scan_sweep_catchup_boot"]["fn"]
    ran = []
    monkeypatch.setattr(scan_evaluator, "sweep_catch_up", lambda: ran.append("catch-up"))

    def sweeping():
        ran.append("sweep")
        catch_up()          # fires while the sweep holds the lock

    monkeypatch.setattr(scan_evaluator, "sweep_job", sweeping)
    sweep()
    assert ran == ["sweep"], ran

    ran.clear()
    monkeypatch.setattr(scan_evaluator, "sweep_catch_up", lambda: (ran.append("catch-up"), sweep()))
    monkeypatch.setattr(scan_evaluator, "sweep_job", lambda: ran.append("sweep"))
    catch_up()
    assert ran == ["catch-up"], ran

    # control: released afterwards, each runs alone
    ran.clear()
    monkeypatch.setattr(scan_evaluator, "sweep_catch_up", lambda: ran.append("catch-up"))
    sweep()
    catch_up()
    assert ran == ["sweep", "catch-up"], ran
