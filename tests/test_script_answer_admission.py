"""THE VERDICT IN THE ANSWER THAT WROTE THE SCRIPT (2026-11-19).

Measured 2026-11-19 (`docs/pine/evidence/2026-11-19-admission-budget/`, branch
infra/admission-budget-measure): two of four assistant-written scripts settled "Still being checked"
because the window's five asks of `POST /runtime-admission` all met the verdict door's PROCESS-WIDE
gates, held by other traffic, while the script turn had already run the detector on that very script
and thrown the set away. The script turn now keeps the set and returns the verdict with the answer.

Held here:
  * the answer's `admission` IS the verdict door's answer for the same source (one rule,
    `runtime_definitions.admission_verdict`): admitted, refused, history-only and killed alike;
  * the set goes into this process's LRU only: the store (`runtime_capabilities`) is untouched,
    because the converse door stores nothing;
  * a later ask of the verdict door is an LRU hit: it answers with every detector gate shut;
  * a detector that cannot run is `pending` (the window asks the door as before), never admitted;
  * with capability admission off the answer carries no `admission` at all (byte for byte as before).
"""
from __future__ import annotations

import contextlib
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import pine_capabilities as pc
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc
from tests.test_p2_truth_server import conv, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
# (the fixture and the three sample scripts are shared with tests/test_script_admission_window_contract.py: one
# helper both files import, so neither test file imports the other)
from tests._script_admission_fixtures import ADMITTED, HISTORY, UNADMITTED, adm  # noqa: F401 -- `adm` is a fixture
from tests.test_script_conversation import ask, lane, writes  # noqa: F401 -- `lane` is a fixture by name

MEMBER = "u1"


def _answer(conv, model, pine):
    model([writes(pine, name="script", reply="Here it is.")])
    r = ask(conv)
    assert r["ok"] is True and r["turn"] == "script" and r["script"]["pine"] == pine
    return r["script"]


def _stored_rows() -> int:
    with contextlib.closing(svc._connect()) as c:
        c.execute(rt._CAPS_DDL)
        return c.execute(f"SELECT COUNT(*) FROM {rt.CAPS_TABLE}").fetchone()[0]


@contextlib.contextmanager
def _every_gate_shut(monkeypatch):
    """The verdict door's gates, all closed at once, and a detector that must not be called: the
    member's budget spent, both cool-downs in the future, the one-run gate held."""
    def no_detector(_src):
        raise AssertionError("the detector ran")
    monkeypatch.setattr(pc, "capabilities_of", no_detector)
    now = time.monotonic()
    rt._verdict_member_charge(MEMBER, now, rt.VERDICT_MEMBER_SECONDS * 10)
    rt._VERDICT_BUCKET[:] = [-3600.0, now]                # the verdict bucket drained
    rt._DETECTOR_IDLE_UNTIL[0] = now + 3600
    assert rt._DETECTOR_GATE.acquire(blocking=False)
    try:
        yield
    finally:
        rt._DETECTOR_GATE.release()


def _door_client() -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": MEMBER, "role": "admin", "plan": "premium"}
    return TestClient(app)


@pytest.mark.parametrize("pine, admitted, history", [(ADMITTED, True, False), (HISTORY, True, True),
                                                      (UNADMITTED, False, False)])
def test_the_answers_admission_is_the_verdict_doors(conv, clean_env, model, lane, adm, pine, admitted, history):
    got = _answer(conv, model, pine)["admission"]
    assert got["sha256"] == rt.source_hash(pine)
    assert got["admitted"] is admitted and ("historyOnly" in got) is history
    if not admitted:
        assert "collections:matrix" in got["missing"]
    # the verdict door, asked fresh (its own detector run, no LRU), answers exactly the same
    rt._reset_capability_cache()
    assert rt.runtime_admission(pine, member=None) == got


def test_a_killed_script_reads_killed_in_the_answer_as_at_the_door(conv, clean_env, model, lane, adm, monkeypatch):
    monkeypatch.setenv(rt.KILL_ENV, rt.source_hash(ADMITTED)[:16])
    got = _answer(conv, model, ADMITTED)["admission"]
    assert got == {"sha256": rt.source_hash(ADMITTED), "admitted": False, "missing": []}
    rt._reset_capability_cache()
    assert rt.runtime_admission(ADMITTED, member=None) == got
    # CONTROL: the same script off the kill list is admitted (the kill list is what refused it)
    monkeypatch.delenv(rt.KILL_ENV)
    assert rt.script_answer_admission(ADMITTED, frozenset(pc.capabilities_of(ADMITTED)))["admitted"] is True


def test_the_set_goes_to_the_lru_and_never_to_the_store(conv, clean_env, model, lane, adm):
    before = _stored_rows()
    _answer(conv, model, ADMITTED)
    h = rt.source_hash(ADMITTED)
    assert rt._lru_get(h) == frozenset(pc.capabilities_of(ADMITTED))
    assert rt._store_get(h) is None and _stored_rows() == before == 0


def test_a_later_ask_of_the_verdict_door_answers_from_the_lru_with_every_gate_shut(
        conv, clean_env, model, lane, adm, monkeypatch):
    got = _answer(conv, model, ADMITTED)["admission"]
    with _every_gate_shut(monkeypatch):
        r = _door_client().post("/api/user-definitions/runtime-admission", json={"source": ADMITTED})
        assert r.status_code == 200 and r.json() == got and got["admitted"] is True
        # CONTROL: a script no answer carried meets the same shut gates and is only "still being checked"
        other = ADMITTED + "\n// not written by the assistant\n"
        r = _door_client().post("/api/user-definitions/runtime-admission", json={"source": other})
        assert r.status_code == 200 and r.json()["missing"] == [rt.PENDING]


def test_a_detector_that_cannot_run_is_pending_never_admitted(conv, clean_env, model, lane, adm, monkeypatch):
    def broken(_src):
        raise RuntimeError("detector down")
    monkeypatch.setattr(pc, "capabilities_of", broken)
    script = _answer(conv, model, ADMITTED)
    assert script["admission"] == {"sha256": rt.source_hash(ADMITTED), "admitted": False, "missing": [rt.PENDING]}
    assert script["waits_for_the_bar"] is False
    assert rt._lru_get(rt.source_hash(ADMITTED)) is None


def test_with_admission_off_the_answer_carries_no_admission(conv, clean_env, model, lane, adm, monkeypatch):
    monkeypatch.delenv(rt.CAPABILITY_ADMISSION_ENV)
    script = _answer(conv, model, ADMITTED)
    assert "admission" not in script
    assert set(script) == {"name", "pine", "round", "reference", "waits_for_the_bar"}
    assert rt._lru_get(rt.source_hash(ADMITTED)) is None


def test_the_script_turn_runs_the_detector_once_per_answer(conv, clean_env, model, lane, adm, monkeypatch):
    real, calls = pc.capabilities_of, []
    monkeypatch.setattr(pc, "capabilities_of", lambda src: (calls.append(src), real(src))[1])
    script = _answer(conv, model, HISTORY)
    assert script["waits_for_the_bar"] is True and script["admission"]["admitted"] is True
    assert calls == [HISTORY]
