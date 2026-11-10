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


# The timeout handed down is (deadline - a later monotonic()). On a long-uptime box monotonic() is large, and that
# subtraction can round above the deadline span by ~1e-13 s. Compare spans with this tolerance, never exactly.
EPS = 1e-6


def until(condition, seconds=10.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.01)
    return False


@pytest.fixture
def clocks(monkeypatch):
    """Every turn clock made during the test, so a test can run the deadline out from inside the model call.
    A deadline set at turn start would also have to cover the turn's setup, which a long suite run can stretch."""
    made = []

    class Recorded(budget.TurnClock):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            made.append(self)

    monkeypatch.setattr(budget, "TurnClock", Recorded)
    monkeypatch.setattr(limits, "RENEW_EVERY_S", 0.05)     # the guard re-reads the clock this often

    def run_out(after_s=0.05):
        for clock in made:
            clock.at = time.monotonic() + after_s
    return run_out


@pytest.fixture
def short(clean, clocks, monkeypatch):  # noqa: F811
    monkeypatch.setattr(limits, "EXPIRE_GRACE_S", 0.1)
    return clocks


@pytest.fixture
def hung(monkeypatch, short):
    """A model call that never returns until the test lets it, as a stuck socket would. The deadline runs out
    once it has started."""
    entered, release = threading.Event(), threading.Event()

    def caller(**kw):
        short()
        entered.set()
        assert release.wait(30)
        return _resp()

    monkeypatch.setattr(turn, "_default_caller", caller)
    yield types.SimpleNamespace(entered=entered, release=release)
    release.set()
    assert until(lambda: limits.lingering_workers() == 0)  # no stuck worker outlives its test


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


def test_a_turn_finishing_just_past_the_deadline_keeps_its_final_on_the_stream(clean, clocks, client, monkeypatch):  # noqa: F811
    """Before: the guard's exit ended the stream, so the member saw the error while the final was already stored."""
    calls = []
    answer = _caller(calls)

    def slow(**kw):
        clocks()
        threading.Event().wait(0.2)                        # back past the deadline, well inside the grace
        return answer(**kw)

    monkeypatch.setattr(turn, "_default_caller", slow)
    with client.stream("POST", "/api/agent/turn/stream", json={"message": "add rsi"}) as r:
        body = "".join(r.iter_text())
    assert '"t":"final"' in body and '"t":"error"' not in body and budget.TURN_DEADLINE not in body
    assert held() == (0, 0)


def test_a_worker_that_came_back_closes_the_ledger_but_not_the_stream(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv(budget.TURN_DEADLINE_ENV, "0.1")
    clock, ended = budget.TurnClock(), []
    clock.on_stuck(lambda: ended.append("stream"))
    clock.on_expire(lambda: ended.append("ledger"))
    token = limits.admit("u", new_request=False)
    with limits.guard("u", token, clock):
        threading.Event().wait(0.2)
    assert ended == ["ledger"]


def test_a_stuck_worker_runs_both_kinds_of_cleanup_once():
    clock, ended = budget.TurnClock(), []
    clock.on_stuck(lambda: ended.append("stream"))
    clock.on_expire(lambda: ended.append("ledger"))
    clock.expire(worker_stuck=True)
    clock.expire(worker_stuck=True)
    assert ended == ["ledger", "stream"]


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
    assert 0 < seen[0]["timeout"] <= 5 + EPS and seen[1]["timeout"] == 60


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
    assert len(posts) == 1 and posts[0] <= 0.1 + EPS and out["error"]


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


# ═══ the independent review's findings ═══════════════════════════════════════════════════════════
def test_REVIEW_a_deadline_that_passes_during_reserve_sends_nothing_and_releases(clean, monkeypatch):  # noqa: F811
    """`reserve` can wait seconds on a busy store. Before: the call went out with a 1 ms timeout and could be billed."""
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)
    real = budget.reserve

    def slow_reserve(**kw):
        rid = real(**kw)
        m.deadline = time.monotonic() - 1
        return rid

    monkeypatch.setattr(budget, "reserve", slow_reserve)
    calls = []
    with pytest.raises(budget.BudgetRefused):
        m.call("turn", _caller(calls), **KW)
    assert calls == [] and held()[1] == 0 and budget.state()["committed_usd"] == 0


def test_REVIEW_cap_raises_past_the_deadline_rather_than_a_tiny_timeout():
    with call_deadline.until(time.monotonic() - 1), pytest.raises(call_deadline.NotStarted):
        call_deadline.cap(60)


def test_REVIEW_a_call_refused_at_the_client_is_released_not_charged(clean):  # noqa: F811
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)

    def refused_at_the_client(**kw):
        m.deadline = time.monotonic() - 1
        raise call_deadline.NotStarted()                   # what `cap` raises in the caller, before anything is sent

    with pytest.raises(budget.BudgetRefused):
        m.call("turn", refused_at_the_client, **KW)
    assert budget.state()["committed_usd"] == 0 and held()[1] == 0


def test_REVIEW_an_expired_turn_cannot_start_anything_through_a_new_meter(clean):  # noqa: F811
    """The ledger's word, not one clock's: rs1's lookup builds its own Meter, in any process."""
    rid = budget.open_request("u", "c", "x")
    assert budget.close_turn(rid) == 0
    fresh = budget.Meter(user_id="u", request_id=None, turn_request_id=rid, site_reader=ZERO_SITE)
    looked = []
    with pytest.raises(budget.BudgetRefused) as e:
        fresh.research(lambda: looked.append(1) or {"answer": "a"})
    assert e.value.reason == "turn_deadline" and looked == []
    with pytest.raises(budget.BudgetRefused):
        fresh.call("turn", _caller(looked), **KW)
    assert looked == [] and budget.state()["committed_usd"] == 0


def test_REVIEW_a_turn_that_ends_at_its_deadline_also_ends_on_the_ledger(clean):  # noqa: F811
    """No stuck worker here: the turn stopped by itself. A later reroute of the request still starts nothing."""
    rid = budget.open_request("u", "c", "x")
    clock = budget.TurnClock()
    budget.Meter(user_id="u", request_id=None, turn_request_id=rid, site_reader=ZERO_SITE, clock=clock)
    with limits.guard("u", limits.admit("u", new_request=False), clock):
        clock.at = time.monotonic() - 1
    assert held() == (0, 0)
    calls = []
    fresh = budget.Meter(user_id="u", request_id=None, turn_request_id=rid, site_reader=ZERO_SITE)
    with pytest.raises(budget.BudgetRefused) as e:
        fresh.call("turn", _caller(calls), **KW)
    assert e.value.reason == "turn_deadline" and calls == []


def test_REVIEW_a_late_reply_is_kept_as_confirmed_and_counts_once(clean):  # noqa: F811
    rid = budget.open_request("u", "c", "x")
    r = budget.reserve(user_id="u", request_id=None, turn_request_id=rid, category="turn", model="m", worst_usd=0.2,
                       site_reader=ZERO_SITE, counts_as_call=False)
    budget.close_turn(rid)
    st = budget.state()
    assert st["estimated_usd"] == pytest.approx(0.2) and st["confirmed_usd"] == 0
    assert budget.settle(r, actual_usd=0.05, tokens={"input": 10, "output": 5}) == 0.0
    st = budget.state()
    assert st["settled_usd"] == pytest.approx(0.2) and st["committed_usd"] == pytest.approx(0.2)
    assert st["confirmed_usd"] == pytest.approx(0.05) and st["estimated_usd"] == 0


def test_REVIEW_a_late_reply_above_its_worst_case_is_logged(clean, caplog):  # noqa: F811
    rid = budget.open_request("u", "c", "x")
    r = budget.reserve(user_id="u", request_id=None, turn_request_id=rid, category="turn", model="m", worst_usd=0.2,
                       site_reader=ZERO_SITE, counts_as_call=False)
    budget.close_turn(rid)
    with caplog.at_level("ERROR"):
        budget.settle(r, actual_usd=0.3)
    assert "exceeded its worst case" in caplog.text and budget.state()["confirmed_usd"] == pytest.approx(0.3)


def test_REVIEW_a_settled_call_is_confirmed_and_a_timeout_is_an_estimate(clean):  # noqa: F811
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)
    m.call("turn", lambda **kw: _resp(usage=(1000, 100, 0, 0)), **KW)
    with pytest.raises(TimeoutError):
        m.call("turn", lambda **kw: (_ for _ in ()).throw(TimeoutError()), **KW)
    st = budget.state()
    assert st["confirmed_usd"] > 0 and st["estimated_usd"] == pytest.approx(budget.worst_case_usd(KW), abs=1e-5)
    assert st["settled_usd"] == pytest.approx(st["confirmed_usd"] + st["estimated_usd"], abs=1e-5)


def test_REVIEW_naming_cannot_start_past_the_deadline(clean, monkeypatch):  # noqa: F811
    clock, names = budget.TurnClock(), []
    clock.at = time.monotonic() - 1
    monkeypatch.setattr(turn, "name_conversation", lambda *a, **k: names.append(1))
    router._name_unnamed("u", "c", None, clock)
    assert names == []


def test_REVIEW_naming_is_skipped_with_too_little_left_and_runs_with_enough(clean, monkeypatch):  # noqa: F811
    names = []
    monkeypatch.setattr(turn, "name_conversation", lambda *a, **k: names.append(1))
    from api.services.uct_agent import store
    monkeypatch.setattr(store, "title_info", lambda *a: None)
    monkeypatch.setattr(store, "get_turns", lambda *a: [])
    tight = budget.TurnClock()
    tight.at = time.monotonic() + router.NAMING_MIN_LEFT_S - 1
    router._name_unnamed("u", "c", None, tight)
    assert names == []
    router._name_unnamed("u", "c", None, budget.TurnClock())
    assert names == [1]


@pytest.mark.parametrize("reason,sentence", [("store_unavailable", limits.UNAVAILABLE), ("multiple_replicas", limits.UNAVAILABLE)])
def test_REVIEW_a_service_refusal_reaches_the_member_as_503_with_a_clear_message(client, monkeypatch, reason, sentence):  # noqa: F811
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    monkeypatch.setattr(limits, "admit", lambda *a, **k: (_ for _ in ()).throw(limits.Refused(reason, sentence, 5)))
    r = client.post("/api/agent/turn", json={"message": "add rsi"})
    assert r.status_code == 503 and r.json()["detail"] == sentence and r.headers["Retry-After"] == "5" and calls == []


def test_REVIEW_a_broken_store_reaches_the_route_as_a_refusal_not_a_paid_call(client, monkeypatch):  # noqa: F811
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    with monkeypatch.context() as broken:
        broken.setattr(limits, "_connect", lambda: (_ for _ in ()).throw(OSError("disk")))
        r = client.post("/api/agent/turn", json={"message": "add rsi"})
    assert r.status_code == 503 and r.json()["detail"] == limits.UNAVAILABLE and calls == []


def test_REVIEW_a_rate_refusal_is_still_429(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(limits, "admit", lambda *a, **k: (_ for _ in ()).throw(limits.Refused("in_flight", limits.IN_FLIGHT, 5)))
    assert client.post("/api/agent/turn", json={"message": "add rsi"}).status_code == 429


def test_REVIEW_the_lease_cannot_be_set_shorter_than_two_renewals(monkeypatch):
    monkeypatch.setenv("UCT_AGENT_INFLIGHT_LEASE_S", "1")
    assert limits.lease_s() == 60


def test_REVIEW_the_meter_cannot_extend_the_turns_deadline():
    m = budget.Meter(user_id="u", request_id=None)
    before = m.deadline
    m.deadline = before + 1000
    assert m.deadline == before


def test_REVIEW_a_stuck_worker_is_counted_until_it_ends(short, hung, client):  # noqa: F811
    t = threading.Thread(target=lambda: client.post("/api/agent/turn", json={"message": "add rsi"}))
    t.start()
    assert hung.entered.wait(10)
    assert until(lambda: limits.lingering_workers() == 1)
    hung.release.set()
    t.join(20)
    assert until(lambda: limits.lingering_workers() == 0)


def test_REVIEW_a_following_turn_of_the_request_is_not_closed_by_the_old_cleanup(clean):  # noqa: F811
    """The cleanups run before the slot is freed, so the order leaves nothing of a next turn to close."""
    order, clock = [], budget.TurnClock()
    clock.on_expire(lambda: order.append("cleanup"))
    clock.at = time.monotonic() - 10
    real = limits.done
    token = limits.admit("u", new_request=False)
    import unittest.mock as mock
    with mock.patch.object(limits, "done", side_effect=lambda t: (order.append("freed"), real(t))), \
            mock.patch.object(limits, "EXPIRE_GRACE_S", 0.0):
        with limits.guard("u", token, clock):
            assert until(lambda: "freed" in order)
    assert order[:2] == ["cleanup", "freed"]

