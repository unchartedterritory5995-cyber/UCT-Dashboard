"""UCT Agent planner v1 — the server-enforced PER-TURN dollar cap (owner 2026-11-04; docs/agent/budget/PER-TURN-CAP.md).

One member request (its planner call, schema retry, server repair, research lookup, post-research call, the browser's
reroute / repair of the same request, its background naming call, and E-1's classifier where present) may COMMIT at
most UCT_AGENT_TURN_USD ($0.25): settled actuals + open worst-case reservations + the next call's worst case, checked
in the same ledger transaction as the $5 daily cap. No model is ever called: every caller here is a script.
"""
from __future__ import annotations

import json
import threading
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters, narrative_cost_guard
from api.services.uct_agent import budget, limits, store, turn, turn_v2

ADMIN = {"id": "38c023cf-0e81-4187-aa43-ac51a751a001", "plan": "pro", "role": "admin"}
ENV = {"disposition": "answer", "reply": "hi", "question": None, "ops": [], "unsupported_category": None,
       "research": None, "title": None}
ZERO_SITE = lambda: (0.0, 15.0)  # noqa: E731
KW = {"model": "claude-haiku-4-5", "max_tokens": 2048, "system": [{"type": "text", "text": "x" * 20000}],
      "messages": [{"role": "user", "content": "y" * 4000}], "output_config": {"format": {"type": "json_schema", "schema": {}}}}
HAIKU_USAGE = (1200, 80, 0, 0)                     # $0.0012 in + $0.0004 out = $0.0016 actual


def _resp(env=None, usage=HAIKU_USAGE, stop="end_turn"):
    u = None if usage is None else types.SimpleNamespace(input_tokens=usage[0], output_tokens=usage[1],
                                                         cache_read_input_tokens=usage[2],
                                                         cache_creation_input_tokens=usage[3])
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env or ENV))],
                                 stop_reason=stop, usage=u)


def _caller(calls, *envs, usage=HAIKU_USAGE):
    envs = list(envs) or [ENV]

    def call(**kw):
        calls.append(kw)
        return _resp(envs[min(len(calls), len(envs)) - 1], usage)
    return call


def _reserve(rid, usd, counts_as_call=False, category="turn"):
    return budget.reserve(user_id="u", request_id=rid, category=category, model="m", worst_usd=usd,
                          site_reader=ZERO_SITE, counts_as_call=counts_as_call)


@pytest.fixture
def clean(monkeypatch):
    store._reset_for_tests()
    budget._reset_for_test()
    limits._reset_for_test()
    daily_counters.clear()
    for k in ("UCT_AGENT_BUDGET_USD", "UCT_AGENT_MAX_CALLS_PER_REQUEST", budget.TURN_USD_ENV, *limits.DEFAULTS):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(budget, "site_spend_usd", ZERO_SITE)
    yield
    budget._reset_for_test()
    limits._reset_for_test()
    daily_counters.clear()


@pytest.fixture
def client(clean, monkeypatch):
    narrative_cost_guard._reset_for_test(turn.COST_SURFACE)
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: ADMIN
    yield TestClient(app)
    narrative_cost_guard._reset_for_test(turn.COST_SURFACE)


def _first_call_kwargs(**run):
    """The exact request run_turn's first planner call sends (a dry run without a meter)."""
    seen = []
    turn.run_turn(caller=_caller(seen), **run)
    return seen[0]


# ═══ the switch ═════════════════════════════════════════════════════════════════════════════════
def test_SWITCH_defaults_to_25_cents_and_garbage_never_means_unlimited(monkeypatch):
    monkeypatch.delenv(budget.TURN_USD_ENV, raising=False)
    assert budget.turn_cap_usd() == 0.25 == budget.DEFAULT_TURN_USD
    for v in ("0", "", "abc", "-1", "nan"):
        monkeypatch.setenv(budget.TURN_USD_ENV, v)
        assert budget.turn_cap_usd() == 0.25
    monkeypatch.setenv(budget.TURN_USD_ENV, "0.4")
    assert budget.turn_cap_usd() == 0.4
    assert turn_v2.turn_usd() == 0.4 and turn_v2.TURN_USD_ENV == budget.TURN_USD_ENV   # one switch, v1 and v2


# ═══ boundary ═══════════════════════════════════════════════════════════════════════════════════
def test_BOUNDARY_a_call_whose_worst_case_is_exactly_25_cents_is_admitted_one_micro_dollar_more_is_not(clean):
    rid = budget.open_request("u", "c", "hello")
    with pytest.raises(budget.BudgetRefused) as e:
        _reserve(rid, 0.250001)
    assert e.value.reason == "turn_cap" and e.value.sentence == budget.TURN_CAP_FIRST     # nothing was sent yet
    _reserve(rid, 0.25)
    assert budget.turn_committed_usd(rid) == pytest.approx(0.25)
    with pytest.raises(budget.BudgetRefused) as e:
        _reserve(rid, 0.000001)
    assert e.value.reason == "turn_cap" and e.value.sentence == budget.TURN_CAP_LATER


def test_BOUNDARY_the_sum_of_calls_lands_exactly_on_the_cap_without_float_drift(clean):
    rid = budget.open_request("u", "c", "hello")
    for _ in range(25):
        _reserve(rid, 0.01)                         # 25 x $0.01 == $0.25 exactly (rounded to the micro-dollar)
    with pytest.raises(budget.BudgetRefused):
        _reserve(rid, 0.000001)


def test_BOUNDARY_settling_at_actual_frees_the_difference_for_the_next_call(clean):
    rid = budget.open_request("u", "c", "hello")
    r1 = _reserve(rid, 0.20)
    with pytest.raises(budget.BudgetRefused):
        _reserve(rid, 0.10)                         # $0.20 open + $0.10 > $0.25
    budget.settle(r1, actual_usd=0.05)
    _reserve(rid, 0.20)                             # $0.05 actual + $0.20 == $0.25
    assert budget.turn_committed_usd(rid) == pytest.approx(0.25)


def test_BOUNDARY_every_category_and_the_off_ceiling_calls_count_toward_the_turn(clean):
    """Research and E-1's classifier (counts_as_call=False) do not use one of the request's calls, but every dollar
    of theirs counts toward the turn; the call ceiling is untouched by them."""
    rid = budget.open_request("u", "c", "what's new with NVDA")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    m.call("evidence", lambda **kw: _resp(usage=(1000, 10, 0, 0)), counts_as_call=False, **KW)    # E-1 shape
    m.research(lambda: {"answer": "x", "citations": [], "cached": False, "cost_usd": 0.007})
    assert m.calls_left() == 2
    assert budget.turn_committed_usd(rid) == pytest.approx(0.007 + (1000 * 1 + 10 * 5) / 1e6)
    assert m.turn_room_usd() == pytest.approx(0.25 - budget.turn_committed_usd(rid))


def test_BOUNDARY_a_request_without_an_id_is_not_turn_capped_but_the_daily_cap_still_holds(clean, monkeypatch):
    """Scripts and planner v2 (which caps its own turn, turn_v2.py) carry no request id."""
    _reserve(None, 0.30)
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "0.5")
    with pytest.raises(budget.BudgetRefused) as e:
        _reserve(None, 0.30)
    assert e.value.reason == "agent_cap"


def test_BOUNDARY_the_daily_cap_is_preserved_and_wins_when_both_would_refuse(clean, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "0.10")
    rid = budget.open_request("u", "c", "hello")
    with pytest.raises(budget.BudgetRefused) as e:
        _reserve(rid, 0.26)                         # over both
    assert e.value.reason == "agent_cap" and e.value.sentence == budget.AGENT_EXHAUSTED
    with pytest.raises(budget.BudgetRefused) as e:
        _reserve(rid, 0.11)                         # inside the turn, over the day
    assert e.value.reason == "agent_cap"
    assert budget.state()["turn_cap_usd"] == 0.25 and budget.state()["cap_usd"] == 0.10


def test_BOUNDARY_a_refused_call_takes_no_place_in_the_call_ceiling(clean):
    rid = budget.open_request("u", "c", "hello")
    with pytest.raises(budget.BudgetRefused):
        _reserve(rid, 0.30, counts_as_call=True)
    assert budget.calls_used(rid) == 0


def test_BOUNDARY_a_one_hour_cache_write_is_priced_at_2x(clean):
    one_h = {**KW, "system": [{"type": "text", "text": "x" * 20000, "cache_control": {"type": "ephemeral", "ttl": "1h"}}]}
    n = budget.request_bytes(one_h) + budget.FRAMING_TOKENS
    assert budget.worst_case_usd(one_h) >= n * 2.0 / 1e6 + 2048 * 5 / 1e6 - 1e-9
    assert budget.worst_case_usd(one_h) > budget.worst_case_usd(KW)


# ═══ retries and failures ════════════════════════════════════════════════════════════════════════
def test_FAILURE_a_provider_error_response_releases_its_reservation_and_the_retry_fits(clean, monkeypatch):
    import anthropic
    import httpx
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.worst_case_usd(KW) + 0.001, 6)))
    rid = budget.open_request("u", "c", "hello")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    err = anthropic.BadRequestError("schema too complex", response=httpx.Response(
        400, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")), body=None)
    with pytest.raises(anthropic.BadRequestError):
        m.call("turn", lambda **kw: (_ for _ in ()).throw(err), **KW)
    assert budget.turn_committed_usd(rid) == 0 and budget.calls_used(rid) == 0
    m.call("schema_retry", lambda **kw: _resp(), **KW)            # the retry has the whole turn again
    assert budget.turn_committed_usd(rid) == pytest.approx(0.0016)


def test_FAILURE_a_timeout_is_charged_its_worst_case_to_the_turn_and_blocks_a_retry_that_cannot_fit(clean, monkeypatch):
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.worst_case_usd(KW) * 1.5, 6)))
    rid = budget.open_request("u", "c", "hello")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    with pytest.raises(TimeoutError):
        m.call("turn", lambda **kw: (_ for _ in ()).throw(TimeoutError()), **KW)
    assert budget.turn_committed_usd(rid) == pytest.approx(budget.worst_case_usd(KW), abs=1e-6)
    tried = []
    with pytest.raises(budget.BudgetRefused) as e:
        m.call("turn", lambda **kw: tried.append(1) or _resp(), **KW)
    assert e.value.reason == "turn_cap" and tried == []              # refused BEFORE the call


def test_FAILURE_partial_usage_settles_at_the_reported_input_plus_the_output_ceiling(clean):
    rid = budget.open_request("u", "c", "hello")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)

    def dropped(**kw):
        e = ConnectionError("stream dropped")
        e.uct_usage = {"input": 3000, "cache_read": 4000, "cache_write": 0}
        raise e

    with pytest.raises(ConnectionError):
        m.call("turn", dropped, **KW)
    expected = (3000 * 1 + 4000 * 0.1 + 2048 * 5) / 1e6
    assert budget.turn_committed_usd(rid) == pytest.approx(expected)
    assert expected < budget.worst_case_usd(KW)
    st = budget.state()
    assert st["calls"]["charged_worst_case"] == 1 and st["tokens"]["output"] == 2048


def test_FAILURE_the_streamed_caller_reports_the_input_the_provider_billed_when_it_fails_mid_stream(clean, monkeypatch):
    from api.services import engine

    class Stream:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def __iter__(self):
            yield types.SimpleNamespace(type="message_start", message=types.SimpleNamespace(usage=types.SimpleNamespace(
                input_tokens=2500, cache_read_input_tokens=0, cache_creation_input_tokens=0)))
            yield types.SimpleNamespace(type="text", text='{"disposition":')
            raise ConnectionError("dropped")

    fake = types.SimpleNamespace(messages=types.SimpleNamespace(stream=lambda **kw: Stream()))
    fake.with_options = lambda **kw: fake
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: fake)
    rid = budget.open_request("u", "c", "hello")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    with pytest.raises(ConnectionError):
        m.call("turn", lambda **kw: turn._default_stream_caller(lambda t: None, **kw), **KW)
    assert budget.turn_committed_usd(rid) == pytest.approx((2500 * 1 + 2048 * 5) / 1e6)


def test_FAILURE_a_failed_settle_keeps_the_worst_case_on_the_turn(clean, monkeypatch):
    rid = budget.open_request("u", "c", "hello")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    monkeypatch.setattr(budget, "settle", lambda *a, **k: 0.0)        # the ledger write fails: the row stays reserved
    m.call("turn", lambda **kw: _resp(), **KW)
    assert budget.turn_committed_usd(rid) == pytest.approx(budget.worst_case_usd(KW), abs=1e-6)


def test_FAILURE_an_unreadable_ledger_refuses_the_call(clean, monkeypatch):
    rid = budget.open_request("u", "c", "hello")
    monkeypatch.setattr(budget, "_turn_sum", lambda c, r: (_ for _ in ()).throw(OSError("disk")))
    with pytest.raises(budget.BudgetRefused) as e:
        _reserve(rid, 0.01)
    assert e.value.reason == "unavailable"


# ═══ concurrency ════════════════════════════════════════════════════════════════════════════════
def _race(n, fn):
    ok, no, barrier = [], [], threading.Barrier(n)

    def one(i):
        barrier.wait()
        try:
            ok.append(fn(i))
        except budget.BudgetRefused as e:
            no.append(e.reason)

    ts = [threading.Thread(target=one, args=(i,)) for i in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return ok, no


def test_CONCURRENCY_calls_of_one_request_racing_never_pass_its_cap(clean):
    rid = budget.open_request("u", "c", "hello")
    ok, no = _race(20, lambda i: _reserve(rid, 0.05))
    assert len(ok) == 5 and no == ["turn_cap"] * 15                  # $0.25 / $0.05, not one more
    assert budget.turn_committed_usd(rid) == pytest.approx(0.25)


def test_CONCURRENCY_two_turns_from_one_member_at_once_each_get_their_own_cap(clean):
    a = budget.open_request("u", "c", "first")
    b = budget.open_request("u", "c", "second")
    ok, no = _race(24, lambda i: _reserve(a if i % 2 else b, 0.05))
    assert len(ok) == 10 and no == ["turn_cap"] * 14
    assert budget.turn_committed_usd(a) == pytest.approx(0.25) == budget.turn_committed_usd(b)


def test_CONCURRENCY_two_turns_at_once_still_share_the_daily_cap(clean, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "0.30")
    a = budget.open_request("u", "c", "first")
    b = budget.open_request("u", "c", "second")
    ok, no = _race(2, lambda i: _reserve(a if i else b, 0.25))
    assert len(ok) == 1 and no == ["agent_cap"]
    assert budget.state()["committed_usd"] == pytest.approx(0.25)


def test_CONCURRENCY_a_reroute_and_the_naming_call_of_one_request_cannot_both_slip_under(clean):
    rid = budget.open_request("u", "c", "add rsi")
    _reserve(rid, 0.15)
    ok, no = _race(2, lambda i: _reserve(rid, 0.08, counts_as_call=bool(i)))
    assert len(ok) == 1 and no == ["turn_cap"]


# ═══ the turn (scripted model) ══════════════════════════════════════════════════════════════════
def test_TURN_a_request_larger_than_one_turn_allows_is_refused_before_anything_is_sent(clean, monkeypatch):
    monkeypatch.setenv(budget.TURN_USD_ENV, "0.001")
    rid = budget.open_request("u", "c", "hi")
    calls = []
    with pytest.raises(budget.BudgetRefused) as e:
        turn.run_turn(message="hi", context={}, history=[], caller=_caller(calls),
                      meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert calls == [] and e.value.reason == "turn_cap" and e.value.sentence == budget.TURN_CAP_FIRST
    assert budget.state()["committed_usd"] == 0


def test_TURN_max_tokens_is_never_lowered_to_fit_the_cap(clean, monkeypatch):
    kw = _first_call_kwargs(message="hi", context={}, history=[])
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.worst_case_usd(kw), 6)))     # exactly one call's worth
    rid = budget.open_request("u", "c", "hi")
    calls = []
    out = turn.run_turn(message="hi", context={}, history=[], caller=_caller(calls),
                        meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert out["envelope"]["reply"] == "hi" and [c["max_tokens"] for c in calls] == [turn.output_ceiling(turn.model())]


QUESTION = "what's the latest news on NVDA earnings this week?"
RESEARCH_ENV = {**ENV, "reply": "Let me check.", "research": {"query": "NVDA earnings", "recency": "week"}}


def test_TURN_research_runs_when_the_lookup_and_the_call_that_reads_it_fit(clean, monkeypatch):
    looked = []
    monkeypatch.setattr(turn, "_research", lambda q, r: looked.append(q) or {"answer": "A.", "citations": [], "cached": False, "cost_usd": 0.01})
    rid = budget.open_request("u", "c", QUESTION)
    calls = []
    out = turn.run_turn(message=QUESTION, context={}, history=[], caller=_caller(calls, RESEARCH_ENV, {**ENV, "reply": "NVDA reported on Tuesday."}),
                        meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert looked and len(calls) == 2 and out["envelope"]["reply"] == "NVDA reported on Tuesday."
    assert budget.turn_committed_usd(rid) <= 0.25


def test_TURN_research_is_skipped_honestly_when_it_and_its_answer_cannot_fit(clean, monkeypatch):
    kw = _first_call_kwargs(message=QUESTION, context={}, history=[])
    # room for the first call, not for the $0.108 lookup + the call that reads it
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.worst_case_usd(kw) + 0.05, 6)))
    looked = []
    monkeypatch.setattr(turn, "_research", lambda q, r: looked.append(q) or {"answer": "A.", "citations": []})
    rid = budget.open_request("u", "c", QUESTION)
    calls = []
    out = turn.run_turn(message=QUESTION, context={}, history=[], caller=_caller(calls, RESEARCH_ENV),
                        meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert looked == [] and len(calls) == 1
    assert out["envelope"]["reply"] == turn.RESEARCH_TURN_CAP and out["usage"]["research_skipped"] == "turn_cap"
    assert "research" not in budget.state()["by_category"]


def test_TURN_a_mixed_request_keeps_its_planned_change_when_research_is_skipped_for_the_cap(clean, monkeypatch):
    from tests.test_uct_agent import CAPS, CTX, env as mkenv
    op = {"action": "chart.setType", "target": "c1", "args": {"type": "line"}}
    kw = _first_call_kwargs(message="switch to line and what's the latest news on NVDA?", context=CTX, history=[], capabilities=CAPS)
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.worst_case_usd(kw) + 0.05, 6)))
    monkeypatch.setattr(turn, "_research", lambda q, r: pytest.fail("no lookup"))
    rid = budget.open_request("u", "c", "x")
    mixed = mkenv("apply", ops=[op], reply="Switching.", research={"query": "NVDA news", "recency": "week"})
    out = turn.run_turn(message="switch to line and what's the latest news on NVDA?", context=CTX, history=[], capabilities=CAPS,
                        caller=_caller([], mixed), meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    e = out["envelope"]
    assert e["reply"] == turn.RESEARCH_TURN_CAP and e["disposition"] == "apply"
    assert [o["action"] for o in e["ops"]] == ["chart.setType"]   # planned, not claimed as researched


def test_TURN_the_server_repair_is_skipped_when_it_cannot_fit_and_the_plan_is_served_as_checked(clean, monkeypatch):
    from tests import test_uct_agent_w11_repair_b as rb
    monkeypatch.setenv("UCT_AGENT_NL1", "1")
    message = "mark when the 9 ema crosses above the 20 on this chart"
    first = rb._unsupported(rb.LT4_REPLY)
    seen = []
    turn.run_turn(message=message, context=rb.CTX2, history=[], capabilities=rb.ALL, caller=_caller(seen, first, rb._plan_ia()))
    assert len(seen) == 2                                           # without a meter: the repair runs
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.worst_case_usd(seen[0]) + 0.0001, 6)))
    rid = budget.open_request("u", "c", message)
    calls = []
    out = turn.run_turn(message=message, context=rb.CTX2, history=[], capabilities=rb.ALL, caller=_caller(calls, first, rb._plan_ia()),
                        meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert len(calls) == 1 and out["usage"]["repair_skipped"] == "turn_cap" and "repaired" not in out["usage"]
    assert not out["envelope"]["ops"]                                # nothing is planned, nothing claimed done
    assert budget.turn_committed_usd(rid) <= budget.turn_cap_usd()


def test_TURN_the_naming_call_is_refused_when_its_request_has_no_room_and_names_nothing(clean, monkeypatch):
    rid = budget.open_request("u", "c", "hello")
    _reserve(rid, 0.249)
    calls = []
    with pytest.raises(budget.BudgetRefused) as e:
        turn.name_conversation([{"role": "member", "text": "show me nvda weekly"}], caller=_caller(calls),
                               meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert e.value.reason == "turn_cap" and calls == []


# ═══ the /turn route ════════════════════════════════════════════════════════════════════════════
def test_ROUTE_a_turn_cap_refusal_is_a_400_with_the_fixed_sentence_and_nothing_is_sent(client, monkeypatch):
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    monkeypatch.setenv(budget.TURN_USD_ENV, "0.001")
    r = client.post("/api/agent/turn", json={"message": "hi"})
    assert r.status_code == 400 and r.json()["detail"] == budget.TURN_CAP_FIRST and calls == []
    assert daily_counters.value(rx._et_day(), rx.SCOPE, ADMIN["id"]) == 0       # the day's count given back


def test_ROUTE_a_reroute_is_charged_to_the_same_turn_and_refused_honestly_when_it_cannot_fit(client, monkeypatch):
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls, {**ENV, "title": "RSI on the chart"}))   # named in-turn
    r1 = client.post("/api/agent/turn", json={"message": "add rsi"})
    assert r1.status_code == 200
    made = len(calls)
    assert made == 1                                                 # one call used: the ceiling leaves the reroute one
    spent = budget.state()["committed_usd"]
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(spent + 0.001, 6)))     # the reroute's worst case cannot fit
    r2 = client.post("/api/agent/turn", json={"message": "add rsi", "reroute": True, "conversationId": r1.json()["conversationId"]})
    assert r2.status_code == 400 and r2.json()["detail"] == budget.TURN_CAP_LATER and len(calls) == made
    # the transcript stores UCT's fixed sentence, never a claim
    turns = store.get_turns(ADMIN["id"], r1.json()["conversationId"])
    assert turns[-1]["text"] == budget.TURN_CAP_LATER


def test_ROUTE_the_background_naming_call_counts_toward_its_turn_and_a_refusal_never_fails_the_turn(client, monkeypatch):
    kw = _first_call_kwargs(message="show nvda weekly", context={}, history=[], conversation_title=rx.NO_TITLE_YET)
    # the first call bills nearly its whole worst case (every byte a cache write, all output), leaving less room
    # than the naming call's worst case
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls, usage=(0, 2048, 0, budget.request_bytes(kw))))
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.worst_case_usd(kw) + 0.0001, 6)))
    r = client.post("/api/agent/turn", json={"message": "show nvda weekly"})
    assert r.status_code == 200 and len(calls) == 1                  # the naming call was refused, not made
    assert "title" not in budget.state()["by_category"]
    monkeypatch.delenv(budget.TURN_USD_ENV)
    r = client.post("/api/agent/turn", json={"message": "show nvda daily"})
    assert r.status_code == 200 and len(calls) == 3                  # with room: the turn + its naming call
    assert "title" in budget.state()["by_category"]


def test_TURN_a_typical_golden_manifest_question_still_researches_after_a_cache_miss(clean, monkeypatch):
    """The cap must not take research away from an ordinary request: the full golden manifest (at the 60-action
    limit), an empty chat, and a first call that missed the cache (its whole prompt billed as a cache write at a
    realistic ~3.5 bytes per token)."""
    from pathlib import Path
    golden = json.loads((Path(__file__).resolve().parents[1] / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
    caps = golden["capabilities"][:turn.MAX_CAPABILITIES]
    kw = _first_call_kwargs(message=QUESTION, context={}, history=[], capabilities=caps)
    usage = (0, 300, 0, budget.request_bytes(kw) * 2 // 7)
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "A" * 2400, "citations": ["https://example.com/" + "p" * 80] * 6,
                                                         "cached": False, "cost_usd": 0.02})
    rid = budget.open_request("u", "c", QUESTION)
    calls = []
    out = turn.run_turn(message=QUESTION, context={}, history=[], capabilities=caps,
                        caller=_caller(calls, RESEARCH_ENV, {**ENV, "reply": "NVDA reported on Tuesday."}, usage=usage),
                        meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert len(calls) == 2 and out["usage"]["research_calls"] == 1 and "research_skipped" not in out["usage"]
    assert budget.turn_committed_usd(rid) <= 0.25


def test_FAILURE_an_error_event_after_the_stream_started_is_settled_never_released(clean):
    import anthropic
    import httpx
    rid = budget.open_request("u", "c", "hello")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)

    def overloaded(**kw):
        e = anthropic.InternalServerError("overloaded", response=httpx.Response(
            529, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")), body=None)
        e.uct_usage = {"input": 1000, "cache_read": 0, "cache_write": 0}
        raise e

    with pytest.raises(anthropic.InternalServerError):
        m.call("turn", overloaded, **KW)
    assert budget.turn_committed_usd(rid) == pytest.approx((1000 + 2048 * 5) / 1e6) and budget.state()["calls"]["released"] == 0


# ═══ review #785 nits ═══════════════════════════════════════════════════════════════════════════
def test_MIGRATION_two_first_opens_racing_on_an_old_ledger_both_succeed_and_add_the_column_once(tmp_path):
    """Two threads, each on its own connection to a ledger from before the per-turn cap, both read the column as
    missing before either adds it (the first-boot race): the loser's "duplicate column" is tolerated, no call fails."""
    import contextlib
    import sqlite3
    db = str(tmp_path / "old_ledger.db")
    with contextlib.closing(sqlite3.connect(db)) as c:
        c.execute("CREATE TABLE agent_spend (id INTEGER PRIMARY KEY AUTOINCREMENT, et_day TEXT NOT NULL, request_id INTEGER,"
                  " status TEXT NOT NULL, reserved_usd REAL NOT NULL, created_at INTEGER NOT NULL)")
        c.commit()
    gate = threading.Barrier(2, timeout=20)

    class StaleRead:
        """A connection whose PRAGMA answer was read before the gate, like two first opens interleaving."""

        def __init__(self):
            self.conn = sqlite3.connect(db, timeout=30, isolation_level=None, check_same_thread=False)
            self.cols = [r[1] for r in self.conn.execute("PRAGMA table_info(agent_spend)").fetchall()]

        def execute(self, sql, *a):
            if sql.startswith("PRAGMA"):
                return types.SimpleNamespace(fetchall=lambda: [(i, c) for i, c in enumerate(self.cols)])
            return self.conn.execute(sql, *a)

    errors, done = [], []

    def first_open():
        c = StaleRead()
        try:
            gate.wait()
            budget._add_turn_column(c)
            done.append(1)
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))
        finally:
            c.conn.close()

    ts = [threading.Thread(target=first_open) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert errors == [] and len(done) == 2
    with contextlib.closing(sqlite3.connect(db)) as c:
        cols = [r[1] for r in c.execute("PRAGMA table_info(agent_spend)").fetchall()]
    assert cols.count("turn_request_id") == 1


def test_MIGRATION_a_failed_first_open_closes_its_connection(monkeypatch):
    import sqlite3
    closed = []

    class Broken:
        isolation_level = ""

        def executescript(self, s):
            raise sqlite3.OperationalError("disk I/O error")

        def close(self):
            closed.append(1)

    monkeypatch.setattr(store, "_connect", lambda: Broken())
    monkeypatch.setattr(budget, "_READY_FOR", None)
    with pytest.raises(sqlite3.OperationalError):
        budget._connect()
    assert closed == [1]
    monkeypatch.setattr(budget, "_READY_FOR", None)


def test_WORDING_a_later_refusal_says_nothing_was_changed():
    assert "Nothing was changed." in budget.TURN_CAP_LATER and "shown above" not in budget.TURN_CAP_LATER
    assert "nothing changed" in budget.TURN_CAP_FIRST


def test_BYTES_the_output_schema_is_counted_twice():
    no_schema = {k: v for k, v in KW.items() if k != "output_config"}
    schema_bytes = len(json.dumps(KW["output_config"], ensure_ascii=False).encode("utf-8"))
    # without a schema the body still carries `"output_config": null` (4 bytes)
    assert budget.request_bytes(KW) == budget.request_bytes(no_schema) - 4 + 2 * schema_bytes


def test_ROUTE_a_refused_browser_repair_is_not_written_to_the_transcript_the_member_never_saw_it(client, monkeypatch):
    """useAgent.js ignores a failed NL-1 repair (r2 not ok) and serves its first plan: no 'stopped' row may appear."""
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls, {**ENV, "title": "RSI on the chart"}))
    r1 = client.post("/api/agent/turn", json={"message": "add rsi"})
    assert r1.status_code == 200
    cid = r1.json()["conversationId"]
    before = store.get_turns(ADMIN["id"], cid)
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(budget.state()["committed_usd"] + 0.001, 6)))
    r2 = client.post("/api/agent/turn", json={"message": "add rsi", "reroute": True, "conversationId": cid,
                                              "repair": {"errors": ["unknown action x.y"], "plan": []}})
    assert r2.status_code == 400 and r2.json()["detail"] == budget.TURN_CAP_LATER
    assert store.get_turns(ADMIN["id"], cid) == before              # nothing the member did not see


def test_TURN_research_results_too_large_for_the_turn_are_measured_and_not_read(clean, monkeypatch):
    """The pre-check's 12 KB allowance is not a bound: oversized real results are measured before the follow-up call
    is reserved, and the turn ends honestly instead of a late refusal."""
    kw = _first_call_kwargs(message=QUESTION, context={}, history=[])
    after = budget.worst_case_usd({**kw, "messages": kw["messages"] + [{"role": "assistant", "content": json.dumps(RESEARCH_ENV)},
                                                                      {"role": "user", "content": "r" * turn.RESEARCH_RESULT_BYTES}]})
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(0.0016 + budget.research_worst_case_usd() + after + 0.002, 6)))
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "é" * 2400, "citations": ["https://x.example/" + "p" * 9000] * 6,
                                                         "cached": False, "cost_usd": budget.research_worst_case_usd()})
    rid = budget.open_request("u", "c", QUESTION)
    calls = []
    out = turn.run_turn(message=QUESTION, context={}, history=[], caller=_caller(calls, RESEARCH_ENV),
                        meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert len(calls) == 1 and out["usage"]["research_unread"] == "turn_cap"
    assert out["envelope"]["reply"] == turn.RESEARCH_UNREAD_TURN_CAP and out["envelope"]["ops"] == []
    assert budget.turn_committed_usd(rid) <= budget.turn_cap_usd()


# ═══ verification review #785 (round 2) ═════════════════════════════════════════════════════════
class _PplxResp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def raise_for_status(self):
        import requests
        if self.status_code >= 400:
            err = requests.HTTPError(f"{self.status_code} error")
            err.response = self
            raise err

    def json(self):
        return self._payload


#: the real lookup, captured at collection: tools/agent_eval_ledger.stub_research REPLACES turn._research for the rest of
#: the process when an eval test runs first
_REAL_RESEARCH = turn._research


@pytest.fixture
def pplx(monkeypatch):
    assert not getattr(_REAL_RESEARCH, "_eval_stub", False)
    monkeypatch.setattr(turn, "_research", _REAL_RESEARCH)
    # the module turn._research will import NOW (sys.modules), not a binding another test file may have purged
    import importlib
    p = importlib.import_module("api.services.perplexity_search")
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(p.time, "sleep", lambda s: None)
    monkeypatch.setattr(p, "_save_shadow", lambda *a, **k: None)
    # hermetic whatever ran before: no shared cost-log writes, no daily search gate, no cached answer
    import api.services as services_pkg
    for ncg in {id(m): m for m in (importlib.import_module("api.services.narrative_cost_guard"),
                                   getattr(services_pkg, "narrative_cost_guard", None)) if m is not None}.values():
        monkeypatch.setattr(ncg, "record", lambda *a, **k: None)
    monkeypatch.setattr(p, "_check_daily_budget", lambda surface: None)
    for k in ("PERPLEXITY_TEST_ENFORCE_BUDGET", "PERPLEXITY_DAILY_LIMIT", "PPLX_REQUEST_FEE_USD"):
        monkeypatch.delenv(k, raising=False)
    p._SEARCH_CACHE.clear() if hasattr(p._SEARCH_CACHE, "clear") else None
    yield p
    p._SEARCH_CACHE.clear() if hasattr(p._SEARCH_CACHE, "clear") else None


_PPLX_OK = {"choices": [{"message": {"content": "answer text"}}], "citations": [],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50}}


def _posts(monkeypatch, p, replies):
    sent = []

    def post(*a, **k):
        sent.append(1)
        return replies[min(len(sent), len(replies)) - 1]

    monkeypatch.setattr(p.requests, "post", post)
    return sent


def test_RESEARCH_web_search_reports_its_attempts_and_whether_usage_came_back(pplx, monkeypatch):
    sent = _posts(monkeypatch, pplx, [_PplxResp(503), _PplxResp(502), _PplxResp(200, _PPLX_OK)])
    res = pplx.web_search(query="retry count q1", mode="fast", cost_surface="uct_agent", return_cost=True)
    assert len(sent) == 3 and res["attempts"] == 3 and res["usage_reported"] is True
    _posts(monkeypatch, pplx, [_PplxResp(200, {k: v for k, v in _PPLX_OK.items() if k != "usage"})])
    res = pplx.web_search(query="no usage q2", mode="fast", cost_surface="uct_agent", return_cost=True)
    assert res["attempts"] == 1 and res["usage_reported"] is False
    # every other caller gets exactly the dict it always got
    _posts(monkeypatch, pplx, [_PplxResp(200, _PPLX_OK)])
    assert "attempts" not in pplx.web_search(query="plain q3", mode="fast")


def test_RESEARCH_a_retried_lookup_keeps_the_whole_reservation_not_the_last_attempts_cost(clean, pplx, monkeypatch):
    _posts(monkeypatch, pplx, [_PplxResp(503), _PplxResp(200, _PPLX_OK)])
    rid = budget.open_request("u", "c", "q")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    res = m.research(lambda: turn._research("retried q4", "week"))
    assert res.get("attempts") == 2 and res["cost_usd"] < budget.research_worst_case_usd(), {k: v for k, v in res.items() if k != "answer"}
    assert budget.turn_committed_usd(rid) == pytest.approx(budget.research_worst_case_usd())
    assert budget.state()["calls"]["charged_worst_case"] == 1


def test_RESEARCH_missing_usage_keeps_the_whole_reservation_not_just_the_fee(clean, pplx, monkeypatch):
    _posts(monkeypatch, pplx, [_PplxResp(200, {k: v for k, v in _PPLX_OK.items() if k != "usage"})])
    rid = budget.open_request("u", "c", "q")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    res = m.research(lambda: turn._research("no usage q5", "week"))
    assert res["usage_reported"] is False and res["cost_usd"] == pytest.approx(0.006)
    assert budget.turn_committed_usd(rid) == pytest.approx(budget.research_worst_case_usd())


def test_RESEARCH_one_attempt_with_usage_settles_at_its_reported_cost(clean, pplx, monkeypatch):
    _posts(monkeypatch, pplx, [_PplxResp(200, _PPLX_OK)])
    rid = budget.open_request("u", "c", "q")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    m.research(lambda: turn._research("clean q6", "week"))
    assert budget.turn_committed_usd(rid) == pytest.approx(100 * 3 / 1e6 + 50 * 15 / 1e6 + 0.006)


def test_RESEARCH_a_failed_lookup_keeps_the_whole_reservation(clean, pplx, monkeypatch):
    _posts(monkeypatch, pplx, [_PplxResp(503)] * 4)
    rid = budget.open_request("u", "c", "q")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    res = m.research(lambda: turn._research("failing q7", "week"))
    assert res["answer"] == "research unavailable right now"
    assert budget.turn_committed_usd(rid) == pytest.approx(budget.research_worst_case_usd())


def test_CLIENTS_both_agent_callers_turn_sdk_retries_off(monkeypatch):
    """max_retries=0 on BOTH Agent clients: an SDK default change can never retry (and bill) behind a reservation."""
    from api.services import engine
    seen = []

    class Stream:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def __iter__(self):
            return iter(())

        def get_final_message(self):
            return "final"

    fake = types.SimpleNamespace(messages=types.SimpleNamespace(create=lambda **kw: "made", stream=lambda **kw: Stream()))
    fake.with_options = lambda **kw: seen.append(kw) or fake
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: fake)
    assert turn._default_caller(model="m") == "made"
    assert turn._default_stream_caller(lambda t: None, model="m") == "final"
    assert len(seen) == 2 and all(kw.get("max_retries") == 0 for kw in seen)


def test_SWEEP_stale_reservations_are_settled_at_their_worst_case_never_released(clean):
    import contextlib
    import time as _t
    rid = budget.open_request("u", "c", "q")
    old = _reserve(rid, 0.2)
    fresh = _reserve(rid, 0.04)
    with contextlib.closing(budget._connect()) as c:
        c.execute("UPDATE agent_spend SET created_at = ? WHERE id = ?", (int(_t.time()) - budget.STALE_RESERVATION_S - 5, old))
    before = budget.state()
    assert budget.sweep_stale_reservations() == 1
    after = budget.state()
    assert after["committed_usd"] == pytest.approx(before["committed_usd"])        # nothing handed back
    assert after["reserved_usd"] == pytest.approx(0.04) and after["settled_usd"] == pytest.approx(0.2)
    assert after["calls"]["released"] == 0
    budget.release(old)                                                           # too late: stays charged
    budget.settle(old, actual_usd=0.001)
    assert budget.turn_committed_usd(rid) == pytest.approx(0.24)
    assert budget.sweep_stale_reservations() == 0                                 # the fresh one is untouched
    budget.settle(fresh, actual_usd=0.01)


def test_SWEEP_runs_inside_every_reservation_and_is_bounded(clean, monkeypatch):
    import contextlib
    import time as _t
    monkeypatch.setattr(budget, "STALE_SWEEP_LIMIT", 3)
    ids = [_reserve(None, 0.01) for _ in range(5)]
    with contextlib.closing(budget._connect()) as c:
        c.execute("UPDATE agent_spend SET created_at = ? WHERE id IN (%s)" % ",".join("?" * len(ids)),
                  (int(_t.time()) - 10_000, *ids))
    _reserve(None, 0.01)                                                          # one reservation sweeps 3 of 5
    assert budget.state()["calls"]["open"] == 3
    _reserve(None, 0.01)                                                          # the next sweeps the other 2
    st = budget.state()
    assert st["calls"]["open"] == 2 and st["committed_usd"] == pytest.approx(0.07)


def test_TELEMETRY_a_paid_lookup_whose_results_are_not_read_is_still_counted(clean, monkeypatch):
    kw = _first_call_kwargs(message=QUESTION, context={}, history=[])
    after = budget.worst_case_usd({**kw, "messages": kw["messages"] + [{"role": "assistant", "content": json.dumps(RESEARCH_ENV)},
                                                                      {"role": "user", "content": "r" * turn.RESEARCH_RESULT_BYTES}]})
    monkeypatch.setenv(budget.TURN_USD_ENV, str(round(0.0016 + budget.research_worst_case_usd() + after + 0.002, 6)))
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "é" * 2400, "citations": ["https://x.example/" + "p" * 9000] * 6,
                                                         "cached": False, "cost_usd": 0.02, "attempts": 2})
    rid = budget.open_request("u", "c", QUESTION)
    out = turn.run_turn(message=QUESTION, context={}, history=[], caller=_caller([], RESEARCH_ENV),
                        meter=budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    assert out["usage"]["research_unread"] == "turn_cap" and out["usage"]["research_calls"] == 1


def test_WORDING_no_absolute_claims_in_the_budget_code():
    src = open(budget.__file__, encoding="utf-8").read()
    for phrase in ("not a guess", "By construction", "An upper bound on one"):
        assert phrase not in src


def test_SWEEP_has_an_index_on_status_and_age(clean):
    import contextlib
    with contextlib.closing(budget._connect()) as c:
        plan = " ".join(str(tuple(r)) for r in c.execute(
            "EXPLAIN QUERY PLAN SELECT id FROM agent_spend WHERE status='reserved' AND created_at < 1 ORDER BY id LIMIT 200"))
    assert "idx_agent_spend_open" in plan
