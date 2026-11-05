"""The 480 s deadline as a maximum safety bound: a turn past it is cancelled, and nothing it held stays held.

The hard shape is a worker that will not come back. Python cannot kill a thread, so these tests hang a real one on an
Event and prove the slot, the reservation and the member's stream are all cleaned up beside it. Real threads, real
SQLite, stub providers: nothing is sent.
"""
from __future__ import annotations

import contextlib
import threading
import time
import types

import pytest
import requests

from api.routers import uct_agent as router
from api.services import call_deadline, engine, perplexity_search as pplx
from api.services.uct_agent import budget, limits, turn, turn_v2 as v2
from tests.test_uct_agent_planner_v2 import CAPS, CTX, resp, tool_use
from tests.test_uct_agent_spend_limits import ADMIN, KW, ZERO_SITE, _caller, _resp, clean, client  # noqa: F401 -- fixtures


def held():
    """What a turn could leave behind: an in-flight row, or an open reservation."""
    with contextlib.closing(limits._connect()) as c:
        slots = c.execute("SELECT COUNT(*) FROM agent_inflight").fetchone()[0]
    with contextlib.closing(budget._connect()) as c:
        open_rows = c.execute("SELECT COUNT(*) FROM agent_spend WHERE status='reserved'").fetchone()[0]
    return slots, open_rows


def until(condition, seconds=10.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.01)
    return False


@pytest.fixture
def short(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv(budget.TURN_DEADLINE_ENV, "0.3")
    monkeypatch.setattr(limits, "EXPIRE_GRACE_S", 0.1)


@pytest.fixture
def hung(monkeypatch):
    """A model call that never returns until the test lets it, as a stuck socket would."""
    entered, release = threading.Event(), threading.Event()

    def caller(**kw):
        entered.set()
        assert release.wait(30)
        return _resp()

    monkeypatch.setattr(turn, "_default_caller", caller)
    yield types.SimpleNamespace(entered=entered, release=release)
    release.set()


# ═══ a stuck worker: everything is released beside it ════════════════════════════════════════════
def test_a_turn_stuck_past_the_deadline_leaves_nothing_held(short, hung, client):  # noqa: F811
    answer = {}
    t = threading.Thread(target=lambda: answer.update(r=client.post("/api/agent/turn", json={"message": "add rsi"})))
    t.start()
    assert hung.entered.wait(10)
    assert held()[0] == 1 and held()[1] == 1               # the turn really was holding both
    assert until(lambda: held() == (0, 0))                 # and the thread is still stuck in its call
    assert t.is_alive()
    hung.release.set()
    t.join(20)
    assert held() == (0, 0)


def test_the_stuck_turns_reservation_stays_charged_at_its_worst_case(short, hung, client):  # noqa: F811
    """Closed, not released: the call may be billed, and $0 would weaken the $5 cap."""
    t = threading.Thread(target=lambda: client.post("/api/agent/turn", json={"message": "add rsi"}))
    t.start()
    assert hung.entered.wait(10)
    assert until(lambda: held() == (0, 0))
    st = budget.state()
    assert st["settled_usd"] > 0 and st["calls"]["charged_worst_case"] == 1
    charged = st["settled_usd"]
    hung.release.set()
    t.join(20)
    assert budget.state()["settled_usd"] == pytest.approx(charged)     # a late reply cannot lower it, nor call again


def test_a_stuck_turns_stream_ends_with_the_clear_message(short, hung, client):  # noqa: F811
    with client.stream("POST", "/api/agent/turn/stream", json={"message": "add rsi"}) as r:
        body = "".join(r.iter_text())
    assert budget.TURN_DEADLINE in body and '"t":"error"' in body
    assert hung.entered.is_set() and not hung.release.is_set()         # the worker is still stuck, the member is not


def test_the_member_can_start_again_once_the_stuck_turn_is_cleaned_up(short, hung, client, monkeypatch):  # noqa: F811
    t = threading.Thread(target=lambda: client.post("/api/agent/turn", json={"message": "add rsi"}))
    t.start()
    assert hung.entered.wait(10)
    assert until(lambda: held() == (0, 0))
    limits.done(limits.admit(ADMIN["id"], new_request=False))          # refused while the slot was held
    hung.release.set()
    t.join(20)


def test_a_turn_that_ends_in_time_keeps_its_answer_and_runs_no_cleanup(clean, client, monkeypatch):  # noqa: F811
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    assert client.post("/api/agent/turn", json={"message": "add rsi"}).status_code == 200
    assert held() == (0, 0) and budget.state()["calls"]["charged_worst_case"] == 0


# ═══ the guard ═══════════════════════════════════════════════════════════════════════════════════
def test_GUARD_keeps_a_slow_stage_on_its_lease(clean, monkeypatch):  # noqa: F811
    """Before: only a paid call or a step wait renewed, so a slow stage between them could lose the slot."""
    monkeypatch.setenv("UCT_AGENT_INFLIGHT_LEASE_S", "1")
    monkeypatch.setattr(limits, "RENEW_EVERY_S", 0.05)
    token = limits.admit("u", new_request=False)
    with limits.guard("u", token, budget.TurnClock()):
        time.sleep(1.3)
        with pytest.raises(limits.Refused) as e:
            limits.admit("u", new_request=False)
        assert e.value.reason == "in_flight"


def test_GUARD_frees_the_slot_on_an_exception_too(clean):  # noqa: F811
    token = limits.admit("u", new_request=False)
    with pytest.raises(RuntimeError):
        with limits.guard("u", token, budget.TurnClock()):
            raise RuntimeError("boom")
    assert held()[0] == 0


def test_GUARD_a_cleanup_that_fails_does_not_stop_the_others(clean):  # noqa: F811
    clock, ran = budget.TurnClock(), []
    clock.on_expire(lambda: (_ for _ in ()).throw(OSError("disk")))
    clock.on_expire(lambda: ran.append(1))
    clock.expire()
    clock.expire()
    assert ran == [1]


# ═══ every wait stops at the deadline ════════════════════════════════════════════════════════════
def test_WAIT_a_paid_call_past_it_settles_then_tells_the_member(clean):  # noqa: F811
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)

    def timed_out(**kw):
        m.deadline = time.monotonic() - 1
        raise TimeoutError("a read timed out at the capped timeout")

    with pytest.raises(budget.BudgetRefused) as e:
        m.call("turn", timed_out, **KW)
    assert e.value.reason == "turn_deadline" and held()[1] == 0


def test_WAIT_a_call_that_fails_in_time_keeps_its_own_error(clean):  # noqa: F811
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)

    def timed_out(**kw):
        raise TimeoutError("an ordinary timeout")

    with pytest.raises(TimeoutError):
        m.call("turn", timed_out, **KW)


def _recording_client(monkeypatch, stream=None):
    seen = []

    class C:
        messages = types.SimpleNamespace(create=lambda **k: "ok", stream=stream)

        def with_options(self, **kw):
            seen.append(kw)
            return self

    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: C())
    return seen


def test_WAIT_a_model_timeout_is_capped_to_what_is_left(monkeypatch):
    seen = _recording_client(monkeypatch)
    with call_deadline.until(time.monotonic() + 5):
        turn._default_caller(model="m")
    turn._default_caller(model="m")
    assert 0 < seen[0]["timeout"] <= 5 and seen[1]["timeout"] == 60


def test_WAIT_a_trickling_stream_stops_at_the_deadline(monkeypatch):
    """A timeout is per read, so a stream that keeps trickling would never trip one."""
    class Trickle:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def __iter__(self):
            while True:
                time.sleep(0.01)
                yield types.SimpleNamespace(type="text", text="x")

    _recording_client(monkeypatch, stream=lambda **k: Trickle())
    with call_deadline.until(time.monotonic() + 0.1):
        with pytest.raises(call_deadline.Expired):
            turn._default_stream_caller(lambda _t: None, model="m")


def test_WAIT_a_step_wait_ends_at_the_deadline_not_two_minutes_later():
    import queue
    wait = router._v2_waiter(queue.Queue(), "u")
    started = time.monotonic()
    with call_deadline.until(started + 0.1):
        assert wait("s1") is None
    assert time.monotonic() - started < 2


def test_WAIT_the_stopped_step_says_the_turn_ran_out_not_that_a_step_did(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    monkeypatch.setenv(v2.TOOLS_ENV, "search")
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)
    step = tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}})
    m = budget.Meter(user_id="u", request_id=None, turn_request_id=budget.open_request("u", "c", "x"))

    def caller(**kw):
        return resp(step)

    def expired_wait(_step_id):
        time.sleep(0.11)
        return None

    with call_deadline.until(time.monotonic() + 0.1):
        out = v2.run_turn_v2(message="switch to weekly", context=CTX, history=[], capabilities=CAPS, caller=caller,
                             meter=m, wait_step=expired_wait)
    assert out["usage"]["stopped"] == "turn_deadline" and v2.TURN_DEADLINE in out["envelope"]["reply"]


def test_WAIT_a_lookup_makes_no_further_billed_attempt_past_it(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    pplx._SEARCH_CACHE.clear()
    posts = []

    def post(*a, timeout=None, **k):
        posts.append(timeout)
        threading.Event().wait(0.11)                       # `time.sleep` is stubbed for the retry pause
        raise requests.Timeout()

    monkeypatch.setattr(pplx.requests, "post", post)
    with call_deadline.until(time.monotonic() + 0.1):
        out = pplx.web_search(query="deadline-q", cost_surface="deadlinetest")
    assert len(posts) == 1 and posts[0] <= 0.1 and out["error"]


def test_WAIT_nothing_changes_outside_a_turn():
    assert call_deadline.left() is None and call_deadline.expired() is False and call_deadline.cap(60) == 60


# ═══ a paused turn does not get a new 480 s ══════════════════════════════════════════════════════
def test_RESUME_the_clock_carries_the_active_time_already_used():
    clock = budget.TurnClock(used_s=400)
    assert 79 <= clock.left() <= 80
    assert budget.TurnClock(used_s=500).left() < 0


def test_RESUME_a_real_pause_banks_its_running_time_and_not_the_card(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    monkeypatch.setenv(v2.TOOLS_ENV, "search")
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)
    step = tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}})
    m = budget.Meter(user_id="u", request_id=None, turn_request_id=budget.open_request("u", "c", "x"))

    def slow_caller(**kw):
        time.sleep(0.15)
        return resp(step)

    out = v2.run_turn_v2(message="switch to weekly", context=CTX, history=[], capabilities=CAPS, caller=slow_caller,
                         meter=m, wait_step=lambda step_id: {"id": step_id, "status": "proposed"})
    assert out["paused"] is True
    banked = out["state"]["active_s"]
    assert 0.15 <= banked < 5
    time.sleep(0.2)                                        # the member reads the card
    assert out["state"]["active_s"] == banked
    assert budget.TurnClock(used_s=banked).left() == pytest.approx(480 - banked, abs=0.5)


def test_RESUME_a_turn_with_nothing_left_is_refused_before_any_call(clean):  # noqa: F811
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE, clock=budget.TurnClock(used_s=480))
    calls = []
    with pytest.raises(budget.BudgetRefused):
        m.call("turn", _caller(calls), **KW)
    assert calls == [] and held()[1] == 0


# ═══ admission fails closed, because the limit is real ═══════════════════════════════════════════
def test_ADMIT_a_store_error_refuses_rather_than_passing_the_limit(clean, monkeypatch):  # noqa: F811
    with monkeypatch.context() as broken, pytest.raises(limits.Refused) as e:
        broken.setattr(limits, "_connect", lambda: (_ for _ in ()).throw(OSError("disk")))
        limits.admit("u", new_request=True)
    assert e.value.reason == "store_unavailable" and e.value.sentence == limits.UNAVAILABLE


def test_ADMIT_the_existing_protections_did_not_move():
    assert budget.DEFAULT_TURN_USD == 0.25 and budget.DEFAULT_CAP_USD == 5.0
    assert budget.DEFAULT_TURN_DEADLINE_S == 480 and limits.DEFAULTS["UCT_AGENT_INFLIGHT_GLOBAL"] == 20
    from api.services.catalyst import cost_guard
    assert cost_guard.hard_cap_usd() == 15.0
