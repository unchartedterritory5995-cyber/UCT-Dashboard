"""UCT Agent spend protection: runaway and infinite-loop shapes, proved against the real ledger.

Owner requirement: no unattended UCT Agent workflow can generate uncontrolled AI spending. Website AI costs only.
NO provider is ever called: every caller is a stub. The ledger, its transactions and its threads are real SQLite.

Each test names a shape the audit was asked to prove. Anything not proved here is listed in the PR body as read only.
"""
from __future__ import annotations

import re
import threading
import time
import types
from pathlib import Path

import pytest

from api.services import narrative_cost_guard, perplexity_search as pplx
from api.services.uct_agent import budget, limits, turn, turn_v2 as v2
from api.services.uct_agent.research import rs1
from tests.test_uct_agent_planner_v2 import CAPS, CTX, resp, text, tool_use
from tests.test_uct_agent_spend_limits import KW, ZERO_SITE, _caller, _resp, clean, client  # noqa: F401 -- fixtures

ROOT = Path(__file__).resolve().parent.parent


class Timeout(Exception):
    """A client-side failure: not an HTTP error response, so the call may have been billed."""


def no_usage(*blocks):
    r = resp(*blocks)
    r.usage = None
    return r


def forever(*blocks, usage=(1000, 50)):
    """A model that never finishes: the same reply for every call."""
    calls = []

    def caller(**kw):
        calls.append(kw)
        return resp(*blocks, usage=usage)
    caller.calls = calls
    return caller


def step_result(status="done"):
    return lambda step_id: {"id": step_id, "status": status, "refusal": "it failed" if status == "failed" else None}


@pytest.fixture
def v2env(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv(v2.PLANNER_ENV, "v2")
    for k in (v2.ROUNDS_ENV, v2.TURN_USD_ENV, v2.TOOLS_ENV, "UCT_AGENT_EFFORT", "UCT_AGENT_MODEL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)
    rid = budget.open_request("u", "c", "switch to weekly")
    return budget.Meter(user_id="u", request_id=None, turn_request_id=rid)


def run_v2(caller, meter, wait=None, **kw):
    return v2.run_turn_v2(message="switch to weekly", context=CTX, history=[], capabilities=CAPS, caller=caller,
                          meter=meter, wait_step=wait or step_result(), **kw)


CHANGE = tool_use("chart__setTimeframe", {"target": "c1", "args": {"timeframe": "W"}})


# ═══ the model loops ═════════════════════════════════════════════════════════════════════════════
def test_MODEL_repeatedly_requests_the_same_tool_stops_at_the_round_limit(v2env):
    c = forever(tool_use("load_actions", {"names": ["chart__setTimeframe"]}))
    out = run_v2(c, v2env)
    assert len(c.calls) == v2.DEFAULT_ROUNDS and out["usage"]["stopped"] == "round_limit"


def test_MODEL_a_huge_rounds_setting_is_clamped(v2env, monkeypatch):
    monkeypatch.setenv(v2.ROUNDS_ENV, "100000")
    c = forever(tool_use("load_actions", {"names": []}))
    run_v2(c, v2env)
    assert len(c.calls) == 12


def test_TOOL_that_fails_every_time_stops_at_the_round_limit(v2env, monkeypatch):
    monkeypatch.setenv(v2.TOOLS_ENV, "search")
    c, sent = forever(CHANGE), []

    def fails(step_id):
        sent.append(step_id)
        return step_result("failed")(step_id)

    out = run_v2(c, v2env, fails)
    assert len(c.calls) == v2.DEFAULT_ROUNDS and out["usage"]["stopped"] == "round_limit"
    assert 0 < len(sent) <= v2.MAX_STEPS_PER_TURN


def test_PLAN_circular_steps_stop_at_the_step_limit(v2env, monkeypatch):
    """Twenty steps in one reply, then the same again: steps past the ceiling never reach the browser."""
    monkeypatch.setenv(v2.TOOLS_ENV, "search")
    c, sent = forever(*[tool_use(CHANGE.name, CHANGE.input, f"tu{i}") for i in range(20)]), []

    def wait(step_id):
        sent.append(step_id)
        return step_result()(step_id)

    out = run_v2(c, v2env, wait)
    assert len(sent) == v2.MAX_STEPS_PER_TURN == 12
    assert len(c.calls) <= v2.DEFAULT_ROUNDS
    assert out["envelope"]["planner"] == "v2"


def test_V1_a_plan_needing_more_calls_stops_at_two(clean):  # noqa: F811
    """schema retry, repair, research, reroute: whatever asks, the third model call of a request is refused."""
    rid = budget.open_request("u", "c", "x")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    calls = []
    fn = _caller(calls)
    m.call("turn", fn, **KW)
    m.call("repair", fn, **KW)
    with pytest.raises(budget.BudgetRefused) as e:
        m.call("reroute", fn, **KW)
    assert e.value.reason == "call_limit" and len(calls) == 2


# ═══ the browser or a client loops ═══════════════════════════════════════════════════════════════
def test_FOLLOWUP_resubmitting_the_same_message_stops_at_the_minute_window(client, monkeypatch):  # noqa: F811
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    codes = [client.post("/api/agent/turn", json={"message": "hi"}).status_code for _ in range(25)]
    assert codes.count(200) == limits.DEFAULTS["UCT_AGENT_RATE_MEMBER_MINUTE"] and codes[-1] == 429


def test_REROUTE_loop_on_one_request_stops_at_its_two_calls(client, monkeypatch):  # noqa: F811
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    cid = client.post("/api/agent/turn", json={"message": "add rsi"}).json()["conversationId"]
    codes = [client.post("/api/agent/turn", json={"message": "add rsi", "reroute": True, "conversationId": cid}).status_code
             for _ in range(10)]
    assert len(calls) <= budget.DEFAULT_MAX_CALLS and codes[-1] == 400


def test_a_provider_HTTP_error_gives_the_call_back_and_costs_nothing(clean):  # noqa: F811
    """A released call is free, so a reroute loop during an outage spends $0 and cannot run up the bill."""
    import anthropic
    import httpx
    err = anthropic.InternalServerError("overloaded", response=httpx.Response(
        500, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")), body=None)
    rid = budget.open_request("u", "c", "x")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    for _ in range(5):
        with pytest.raises(anthropic.InternalServerError):
            m.call("reroute", lambda **kw: (_ for _ in ()).throw(err), **KW)
    assert budget.state()["committed_usd"] == 0


# ═══ concurrency, on real threads and real SQLite ════════════════════════════════════════════════
def test_CONCURRENT_requests_of_one_member_admit_exactly_one(clean):  # noqa: F811
    barrier, tokens, refused = threading.Barrier(20), [], []

    def one():
        barrier.wait()
        try:
            tokens.append(limits.admit("u", new_request=True))
        except limits.Refused as e:
            refused.append(e.reason)

    ts = [threading.Thread(target=one) for _ in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(tokens) == 1 and len(refused) == 19


def test_CONCURRENT_reservations_of_one_request_hold_the_call_ceiling(clean):  # noqa: F811
    rid = budget.open_request("u", "c", "x")
    barrier, ok, no = threading.Barrier(20), [], []

    def one():
        barrier.wait()
        try:
            ok.append(budget.reserve(user_id="u", request_id=rid, category="turn", model="m", worst_usd=0.01,
                                     site_reader=ZERO_SITE))
        except budget.BudgetRefused as e:
            no.append(e.reason)

    ts = [threading.Thread(target=one) for _ in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(ok) == budget.DEFAULT_MAX_CALLS and set(no) == {"call_limit"}


def test_CONCURRENT_reservations_of_one_turn_hold_the_dollar_cap(clean):  # noqa: F811
    """No call ceiling here (v2, a lookup): the $0.25 alone must hold under a race. 0.25 / 0.06 = 4, not 5."""
    rid = budget.open_request("u", "c", "x")
    barrier, ok, no = threading.Barrier(20), [], []

    def one():
        barrier.wait()
        try:
            ok.append(budget.reserve(user_id="u", request_id=None, turn_request_id=rid, category="v2_round", model="m",
                                     worst_usd=0.06, site_reader=ZERO_SITE, counts_as_call=False))
        except budget.BudgetRefused as e:
            no.append(e.reason)

    ts = [threading.Thread(target=one) for _ in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(ok) == 4 and set(no) == {"turn_cap"}
    assert budget.turn_committed_usd(rid) <= budget.DEFAULT_TURN_USD


# ═══ research and the planner in one turn ════════════════════════════════════════════════════════
def test_V2_research_counts_against_the_turn_cap(v2env, monkeypatch):
    """Before: the lookup was metered with no request, so a v2 turn's $0.25 never saw it."""
    looked = []
    monkeypatch.setattr(turn, "_research", lambda q, r: looked.append(q) or
                        {"answer": "a", "citations": [], "cost_usd": 0.02, "attempts": 1, "usage_reported": True})
    calls = []

    def caller(**kw):
        calls.append(kw)
        return resp(tool_use(v2.RESEARCH_TOOL, {"query": "q", "recency": "any"})) if len(calls) == 1 else resp(text("done"))

    out = run_v2(caller, v2env)
    assert looked == ["q"] and out["usage"]["research_calls"] == 1
    assert budget.turn_committed_usd(v2env.turn_request_id) > 0.02


def test_V2_a_lookup_that_does_not_fit_the_turn_is_not_made(v2env, monkeypatch):
    monkeypatch.setenv(v2.TURN_USD_ENV, str(budget.research_worst_case_usd() - 0.01))
    looked = []
    monkeypatch.setattr(turn, "_research", lambda q, r: looked.append(q) or {"answer": "a", "citations": []})
    calls = []

    def caller(**kw):
        calls.append(kw)
        return resp(tool_use(v2.RESEARCH_TOOL, {"query": "q", "recency": "any"})) if len(calls) == 1 else resp(text("done"))

    run_v2(caller, v2env)
    assert looked == []


def test_V2_a_resumed_turn_stays_on_its_own_dollars(v2env, monkeypatch):
    """A paused turn resumes under a new Meter: the state carries the request, so the sum carries on."""
    state = v2._start("switch to weekly", CTX, [], CAPS, None, None, None, v2env, "tok")
    assert state["turn_request_id"] == v2env.turn_request_id


def test_RS1_a_fresh_turn_id_is_not_a_fresh_budget(clean, monkeypatch):  # noqa: F811
    """THE LEAD: `turn_id` is browser-supplied, so every read could be a new turn. Bounded by the server's request."""
    rs1._reset_for_test()
    looked = []
    monkeypatch.setattr(turn, "_research", lambda q, r: looked.append(q) or
                        {"answer": "a", "citations": [], "cost_usd": 0.02, "attempts": 3})    # retried: keeps its worst case
    budget.open_request("u", "c", "why is it moving")
    worst = budget.research_worst_case_usd()
    refused = [rs1.web_for_turn({"user_id": "u", "turn_id": f"t{i}"}, f"q{i}", "any")[0].get("budget_refused")
               for i in range(10)]
    assert len(looked) == int(budget.DEFAULT_TURN_USD / worst) == 2
    assert refused.count(True) == 8
    assert budget.state()["committed_usd"] <= budget.DEFAULT_TURN_USD
    rs1._reset_for_test()


def test_RS1_no_open_request_means_no_paid_lookup(clean, monkeypatch):  # noqa: F811
    rs1._reset_for_test()
    looked = []
    monkeypatch.setattr(turn, "_research", lambda q, r: looked.append(q) or {"answer": "a", "citations": []})
    res, _ = rs1.web_for_turn({"user_id": "nobody", "turn_id": "t"}, "q", "any")
    assert res["budget_refused"] is True and looked == []
    rs1._reset_for_test()


def test_RS1_shares_the_turn_with_the_planner_that_asked(clean, monkeypatch):  # noqa: F811
    """Planner and web lookup in one turn: the sum is one figure, on one request."""
    rs1._reset_for_test()
    monkeypatch.setattr(turn, "_research", lambda q, r: {"answer": "a", "citations": [], "cost_usd": 0.02,
                                                         "attempts": 1, "usage_reported": True})
    rid = budget.open_request("u", "c", "x")
    budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE).call("turn", lambda **kw: _resp(usage=(1000, 100, 0, 0)), **KW)
    planner = budget.turn_committed_usd(rid)
    rs1.web_for_turn({"user_id": "u", "turn_id": "t"}, "q", "any")
    assert budget.turn_committed_usd(rid) == pytest.approx(planner + 0.02)
    rs1._reset_for_test()


# ═══ timeouts, delays, crashes, missing usage ════════════════════════════════════════════════════
def test_TIMEOUTS_forever_stop_at_the_daily_cap(clean, monkeypatch):  # noqa: F811
    """Every call times out, so nothing reports usage. Each is charged its worst case, so the day still ends."""
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "0.20")
    made, worst = 0, budget.worst_case_usd(KW)

    def timed_out(**kw):
        nonlocal made
        made += 1
        raise Timeout()

    stopped = None
    for i in range(50):
        m = budget.Meter(user_id="u", request_id=budget.open_request("u", "c", str(i)), site_reader=ZERO_SITE)
        try:
            m.call("turn", timed_out, **KW)
        except Timeout:
            continue
        except budget.BudgetRefused as e:
            stopped = e.reason
            break
    assert stopped == "agent_cap" and made == int(0.20 / worst)


def test_DELAYED_reply_after_the_stale_sweep_cannot_lower_the_charge(clean):  # noqa: F811
    rid = budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.2, site_reader=ZERO_SITE)
    budget.sweep_stale_reservations(now=10 ** 11)
    assert budget.settle(rid, actual_usd=0.001) == 0.0
    assert budget.state()["settled_usd"] == pytest.approx(0.2)


def test_CRASH_and_restart_keep_open_reservations_at_their_worst_case(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "1")
    budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.7, site_reader=ZERO_SITE)
    budget._READY_FOR = None                               # what a new process starts with
    assert budget.sweep_stale_reservations(now=10 ** 11) == 1
    st = budget.state()
    assert st["reserved_usd"] == 0 and st["settled_usd"] == pytest.approx(0.7)
    with pytest.raises(budget.BudgetRefused) as e:
        budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.4, site_reader=ZERO_SITE)
    assert e.value.reason == "agent_cap"


def test_MISSING_usage_counts_at_worst_in_the_v2_loop_too(v2env, monkeypatch):
    """Before: the ledger charged the worst case and the loop's own sum added $0, so its cap never moved."""
    monkeypatch.setenv(v2.TURN_USD_ENV, "0.08")
    calls = []

    def caller(**kw):
        calls.append(kw)
        return no_usage(tool_use("load_actions", {"names": []}))

    out = run_v2(caller, v2env)
    assert out["usage"]["stopped"] == "turn_cap" and len(calls) < v2.DEFAULT_ROUNDS
    assert budget.turn_committed_usd(v2env.turn_request_id) <= 0.08


def test_MISSING_usage_moves_the_loops_own_sum_with_no_ledger_turn_behind_it(v2env, monkeypatch):
    """The same bound with no request on the Meter: only the loop's own sum can stop it, so this proves that sum."""
    monkeypatch.setenv(v2.TURN_USD_ENV, "0.08")
    calls = []

    def caller(**kw):
        calls.append(kw)
        return no_usage(tool_use("load_actions", {"names": []}))

    out = run_v2(caller, budget.Meter(user_id="u", request_id=None))
    assert out["usage"]["stopped"] == "turn_cap" and len(calls) < v2.DEFAULT_ROUNDS


def test_LEDGER_turn_cap_ends_a_v2_turn_with_its_sentence_not_an_error(v2env, monkeypatch):
    """Something outside the loop (a data-gateway lookup) spent this request's room: the ledger stops the round."""
    calls = []

    def caller(**kw):
        calls.append(kw)
        if len(calls) == 1:
            budget.reserve(user_id="u", request_id=None, turn_request_id=v2env.turn_request_id, category="research",
                           model="perplexity", worst_usd=0.235, site_reader=ZERO_SITE, counts_as_call=False)
        return resp(tool_use("load_actions", {"names": []}))

    out = run_v2(caller, v2env)
    assert out["usage"]["stopped"] == "turn_cap" and len(calls) == 1


def test_RETRIES_are_reserved_and_a_retried_lookup_keeps_every_attempts_worst_case(clean):  # noqa: F811
    assert budget.RESEARCH_ATTEMPTS == pplx._MAX_RETRIES + 1
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)
    m.research(lambda: {"answer": "a", "citations": [], "cost_usd": 0.01, "attempts": 4})
    assert budget.state()["settled_usd"] == pytest.approx(budget.research_worst_case_usd())


def test_model_clients_send_no_SDK_retries(monkeypatch):
    """Every Agent client sets max_retries=0, so one reservation is one billed attempt."""
    seen = []

    class C:
        messages = types.SimpleNamespace(create=lambda **k: "ok")

        def with_options(self, **kw):
            seen.append(kw)
            return self

    from api.services import engine
    from api.services.uct_agent.knowledge import evidence
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: C())
    turn._default_caller(model="m")
    evidence.default_call(model="m")
    assert [k["max_retries"] for k in seen] == [0, 0] and all(0 < k["timeout"] <= 60 for k in seen)


# ═══ no route around the caps ════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("model", ["claude-fable-5-1", "claude-fable-5", "claude-mystery-9"])
def test_BYPASS_a_dearer_model_string_cannot_halve_the_caps(model):
    """Before: Fable was absent, so `unknown = priciest` meant Opus rates, half Fable's real price."""
    assert narrative_cost_guard.estimate_cost(model, 1_000_000, 1_000_000) >= 60.0
    from api.services.catalyst import cost_guard
    assert cost_guard.estimate_cost(model, 1_000_000, 1_000_000) >= 60.0


def test_BYPASS_the_agent_package_reaches_providers_only_through_the_metered_call_sites():
    pkg = ROOT / "api/services/uct_agent"
    sites = sorted(str(p.relative_to(ROOT)).replace("\\", "/") for p in pkg.rglob("*.py")
                   if re.search(r"\.messages\.(create|stream)\(", p.read_text("utf-8")))
    assert sites == ["api/services/uct_agent/knowledge/evidence.py", "api/services/uct_agent/turn.py"]
    src = (pkg / "turn.py").read_text("utf-8")
    assert len(re.findall(r"\.messages\.create\(", src)) == 1 and len(re.findall(r"\.messages\.stream\(", src)) == 1
    v2src = (pkg / "turn_v2.py").read_text("utf-8")
    assert '_paid(meter, "v2_round"' in v2src
    router = (ROOT / "api/routers/uct_agent.py").read_text("utf-8")
    assert len(re.findall(r"agent\.run_turn\(", router)) == 2
    assert len(re.findall(r"meter=budget\.Meter\(", router)) == 3      # both turns and the chat-naming call


def test_BACKGROUND_nothing_scheduled_starts_an_agent_turn():
    """There is no Agent monitor: no scheduler, worker or job reaches run_turn, so nothing can re-trigger one."""
    allowed = {"api/routers/uct_agent.py", "api/services/uct_agent/turn.py",
               "api/services/uct_agent/knowledge/evidence.py",
               "api/services/uct_agent/scan/sat/section_b.py"}       # an operator CLI, not imported by the app
    callers = set()
    for p in (ROOT / "api").rglob("*.py"):
        rel = str(p.relative_to(ROOT)).replace("\\", "/")
        src = p.read_text("utf-8", errors="ignore")
        if rel.endswith("_test.py") or "ticker_explain_eval" in rel:
            continue
        if re.search(r"\b(turn|agent|t1)\.run_turn\(", src) or "run_turn_v2(" in src.replace("def run_turn_v2(", ""):
            callers.add(rel)
    assert callers <= allowed, sorted(callers - allowed)
    assert "section_b" not in (ROOT / "api/main.py").read_text("utf-8")


def test_LIMITS_a_slow_turn_keeps_its_slot_past_the_lease(clean):  # noqa: F811
    """Before: a turn slower than the 150 s lease lost its slot while running, and a second one started beside it."""
    limits.admit("u", new_request=True, now=1000.0)
    limits.renew("u", now=1100.0)
    with pytest.raises(limits.Refused):
        limits.admit("u", new_request=True, now=1200.0)


def test_LIMITS_without_a_renewal_a_crashed_turn_frees_its_slot(clean):  # noqa: F811
    limits.admit("u", new_request=True, now=1000.0)
    assert limits.admit("u", new_request=True, now=1000.0 + limits.DEFAULTS["UCT_AGENT_INFLIGHT_LEASE_S"] + 1)


def test_DAILY_CAP_3000_is_a_count_and_dollars_stop_first(clean, monkeypatch):  # noqa: F811
    """Production sets UCT_AGENT_DAILY_CAP=3000, a count per member. At $0.02 a turn $5 ends the day near 250."""
    monkeypatch.setenv("UCT_AGENT_DAILY_CAP", "3000")
    admitted = 0
    for _ in range(3000):
        try:
            r = budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.03, site_reader=ZERO_SITE)
        except budget.BudgetRefused as e:
            assert e.reason == "agent_cap"
            break
        budget.settle(r, actual_usd=0.02)
        admitted += 1
    assert 240 <= admitted <= 250


# ═══ exhausted: closed, with a sentence ══════════════════════════════════════════════════════════
@pytest.mark.parametrize("state,code,sentence", [
    (lambda mp: mp.setattr(budget, "cap_usd", lambda: 0.000001), 429, budget.AGENT_EXHAUSTED),
    (lambda mp: mp.setattr(budget, "site_spend_usd", lambda: (15.0, 15.0)), 429, budget.SITE_EXHAUSTED),
    (lambda mp: mp.setattr(budget, "site_spend_usd", lambda: (_ for _ in ()).throw(OSError("disk"))), 503, budget.UNAVAILABLE),
], ids=["agent-cap", "shared-cap", "ledger-unreadable"])
def test_EXHAUSTED_fails_closed_with_a_clear_message(client, monkeypatch, state, code, sentence):  # noqa: F811
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    state(monkeypatch)
    r = client.post("/api/agent/turn", json={"message": "hi"})
    assert r.status_code == code and r.json()["detail"] == sentence and calls == []


# ═══ the Perplexity count sees what may have been billed ═════════════════════════════════════════
class _Reply:
    def __init__(self, status=200, payload=None):
        self.status_code, self.payload = status, payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f"{self.status_code}", response=self)

    def json(self):
        return self.payload


@pytest.fixture
def ask(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setenv("PERPLEXITY_TEST_ENFORCE_BUDGET", "1")
    monkeypatch.setenv(pplx._SURFACE_LIMITS_ENV, "")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    narrative_cost_guard._reset_for_test("pplx:spendtest")
    pplx._SEARCH_CACHE.clear() if hasattr(pplx._SEARCH_CACHE, "clear") else None
    n = [0]

    def run(q="q"):
        n[0] += 1
        return pplx.web_search(query=f"{q}{n[0]}", cost_surface="spendtest")
    yield run
    narrative_cost_guard._reset_for_test("pplx:spendtest")


def test_PERPLEXITY_timeouts_count_toward_the_daily_limit(ask, monkeypatch):
    """Before: a timed-out attempt wrote no row, so endless timeouts never reached the 500."""
    import requests
    posts = []
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: posts.append(1) or (_ for _ in ()).throw(requests.Timeout()))
    monkeypatch.setenv(pplx._DAILY_LIMIT_ENV, str(narrative_cost_guard.calls_today("pplx:") + 4))
    assert "timeout" in ask()["error"]
    assert len(posts) == 4
    assert "budget" in ask()["error"]
    assert len(posts) == 4


def test_PERPLEXITY_an_empty_200_counts_because_it_was_billed(ask, monkeypatch):
    payload = {"choices": [{"message": {"content": ""}}], "usage": {"prompt_tokens": 10, "completion_tokens": 10}}
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _Reply(200, payload))
    before = narrative_cost_guard.calls_today("pplx:")
    assert ask()["error"] == "empty answer"
    assert narrative_cost_guard.calls_today("pplx:") == before + 1


def test_PERPLEXITY_an_HTTP_error_does_not_eat_the_days_budget(ask, monkeypatch):
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _Reply(500))
    before = narrative_cost_guard.calls_today("pplx:")
    assert ask().get("error")
    assert narrative_cost_guard.calls_today("pplx:") == before


# ═══ call recap: the warm that re-fires on every panel re-ask ════════════════════════════════════
SEGMENTS = [{"speaker": "A", "text": "x"}, {"speaker": "B", "text": "y"}]


@pytest.fixture
def recap(monkeypatch):
    from api.services import call_recap_grounded as g, call_recap_store as store
    seen = []
    monkeypatch.setattr(store, "record_spend", lambda sym, usage, cost_multiplier=1.0: seen.append(usage) or 0.0)
    monkeypatch.setattr(g, "build_params", lambda sym, t: {"model": "m", "max_tokens": 4000, "system": "s" * 500,
                                                           "messages": [{"role": "user", "content": "t"}]})
    monkeypatch.setattr(g, "finish_from_message", lambda sym, t, r: None)        # unusable, whatever arrived
    return types.SimpleNamespace(g=g, seen=seen, set=lambda fn: monkeypatch.setattr(
        g, "_client", lambda: types.SimpleNamespace(messages=types.SimpleNamespace(create=fn))))


def test_RECAP_an_unusable_reply_reaches_the_ten_dollar_ledger(recap):
    recap.set(lambda **k: resp(text("not json"), usage=(17000, 900)))
    assert recap.g.synthesize("DIS", {"segments": SEGMENTS}) is None
    assert recap.seen[0]["input_tokens"] == 17000 and recap.seen[0]["output_tokens"] == 900


def test_RECAP_a_timeout_is_charged_its_worst_case(recap):
    def timed_out(**k):
        raise Timeout()

    recap.set(timed_out)
    assert recap.g.synthesize("DIS", {"segments": SEGMENTS}) is None
    assert recap.seen[0]["output_tokens"] == 4000 and recap.seen[0]["input_tokens"] > budget.FRAMING_TOKENS


def test_RECAP_an_HTTP_error_and_a_missing_key_cost_nothing(recap, monkeypatch):
    import anthropic
    import httpx
    err = anthropic.InternalServerError("x", response=httpx.Response(
        500, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")), body=None)

    def boom(**k):
        raise err

    recap.set(boom)
    recap.g.synthesize("DIS", {"segments": SEGMENTS})
    monkeypatch.setattr(recap.g, "_client", lambda: (_ for _ in ()).throw(RuntimeError("no key")))
    recap.g.synthesize("DIS", {"segments": SEGMENTS})
    assert recap.seen == []


def test_RECAP_the_client_is_bounded_with_one_attempt(monkeypatch):
    import anthropic
    from api.services import call_recap_grounded as g
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    built = {}
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: built.update(kw) or object())
    g._client()
    assert built["max_retries"] == 0 and 0 < built["timeout"] <= 300


# ═══ the concierge doors: a call with no usage is not free ═══════════════════════════════════════
@pytest.fixture
def ledger(monkeypatch):
    from api.services import definition_concierge as dc
    seen = []
    monkeypatch.setattr(dc.cost_guard, "record", lambda *a, **k: seen.append(a) or 0.5)
    monkeypatch.setattr(dc, "_record_spend", lambda u, d, s: seen.append(("allowance", s)))
    return seen


def test_CONCIERGE_a_timeout_is_charged_to_the_ledger_and_the_allowance(ledger):
    from api.services import definition_concierge as dc
    req = {"system": "s" * 1000, "tools": [], "messages": [{"role": "user", "content": "x"}]}
    assert dc.charge_unreported(Timeout(), "u", "2026-11-05", dc.MODEL, dc.MAX_TOKENS, req) == 0.5
    day, ticker, model, tokens_in, tokens_out = ledger[0]
    assert ticker == "concierge:u" and tokens_out == dc.MAX_TOKENS and tokens_in > budget.FRAMING_TOKENS
    assert ledger[1] == ("allowance", 0.5)


def test_CONCIERGE_an_HTTP_error_response_is_free(ledger):
    import anthropic
    import httpx
    from api.services import definition_concierge as dc
    err = anthropic.InternalServerError("x", response=httpx.Response(
        500, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")), body=None)
    assert dc.charge_unreported(err, "u", "2026-11-05", dc.MODEL, dc.MAX_TOKENS, {}) == 0.0
    assert ledger == []


# ═══ the turn deadline ═══════════════════════════════════════════════════════════════════════════
def _expired(meter):
    meter.deadline = time.monotonic() - 1
    return meter


def test_DEADLINE_is_derived_from_the_per_call_timeouts_and_the_environment_only_shortens_it(monkeypatch):
    from api.services import llm_timeouts
    assert budget.DEFAULT_TURN_DEADLINE_S == v2.DEFAULT_ROUNDS * llm_timeouts.REQUEST_PATH + budget.RESEARCH_ATTEMPTS * 30
    assert budget.DEFAULT_TURN_DEADLINE_S == 480 and budget.turn_deadline_s() == 480
    monkeypatch.setenv(budget.TURN_DEADLINE_ENV, "30")
    assert budget.turn_deadline_s() == 30
    for value in ("100000", "0", "-5", "soon", ""):
        monkeypatch.setenv(budget.TURN_DEADLINE_ENV, value)
        assert budget.turn_deadline_s() == 480


def test_DEADLINE_a_call_past_it_is_refused_before_anything_is_reserved_or_sent(clean):  # noqa: F811
    rid = budget.open_request("u", "c", "x")
    m = _expired(budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE))
    calls = []
    with pytest.raises(budget.BudgetRefused) as e:
        m.call("turn", _caller(calls), **KW)
    assert e.value.reason == "turn_deadline" and e.value.sentence == budget.TURN_DEADLINE
    assert calls == [] and budget.state()["committed_usd"] == 0 and budget.calls_used(rid) == 0


def test_DEADLINE_a_lookup_past_it_is_refused_the_same_way(clean):  # noqa: F811
    m = _expired(budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE))
    looked = []
    with pytest.raises(budget.BudgetRefused):
        m.research(lambda: looked.append(1) or {"answer": "a"})
    assert looked == [] and budget.state()["committed_usd"] == 0


def test_DEADLINE_a_call_that_started_in_time_is_not_cut_off(clean):  # noqa: F811
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)

    def slow(**kw):
        m.deadline = time.monotonic() - 1           # the deadline passes while this call runs
        return _resp(usage=(1000, 100, 0, 0))

    m.call("turn", slow, **KW)
    assert budget.state()["calls"]["settled"] == 1


def test_DEADLINE_ends_a_v2_turn_with_its_sentence_and_only_what_it_spent(v2env):
    calls = []

    def caller(**kw):
        calls.append(kw)
        v2env.deadline = time.monotonic() - 1
        return resp(tool_use("load_actions", {"names": []}))

    out = run_v2(caller, v2env)
    assert out["usage"]["stopped"] == "turn_deadline" and len(calls) == 1
    assert v2.TURN_DEADLINE in out["envelope"]["reply"]
    assert budget.state()["reserved_usd"] == 0


def test_DEADLINE_each_meter_has_its_own_clock_unless_it_is_given_the_turns():
    a = budget.Meter(user_id="u", request_id=None)
    a.deadline = time.monotonic() - 1
    assert budget.Meter(user_id="u", request_id=None).deadline > time.monotonic()


def test_DEADLINE_a_v1_turn_gets_the_clear_message_and_nothing_is_sent(client, monkeypatch):  # noqa: F811
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    monkeypatch.setattr(budget, "turn_deadline_s", lambda: -1.0)
    r = client.post("/api/agent/turn", json={"message": "add rsi"})
    assert r.status_code == 400 and r.json()["detail"] == budget.TURN_DEADLINE and calls == []


def test_DEADLINE_does_not_move_the_caps():
    assert budget.DEFAULT_TURN_USD == 0.25 and budget.DEFAULT_CAP_USD == 5.0


# ═══ turns in flight across the site ═════════════════════════════════════════════════════════════
def test_GLOBAL_in_flight_turns_stop_at_the_limit_and_a_finished_turn_frees_its_place(clean):  # noqa: F811
    cap = limits.DEFAULTS["UCT_AGENT_INFLIGHT_GLOBAL"]
    tokens = [limits.admit(f"u{i}", new_request=False) for i in range(cap)]
    assert all(tokens)
    with pytest.raises(limits.Refused) as e:
        limits.admit("one-more", new_request=False)
    assert e.value.reason == "global_in_flight" and e.value.sentence == limits.GLOBAL_RATE
    limits.done(tokens[0])
    assert limits.admit("one-more", new_request=False)


def test_GLOBAL_a_refused_turn_uses_no_place_in_the_rate_windows(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv("UCT_AGENT_INFLIGHT_GLOBAL", "1")
    assert limits.admit("first", new_request=True)
    for _ in range(25):
        with pytest.raises(limits.Refused) as e:
            limits.admit("second", new_request=True)
        assert e.value.reason == "global_in_flight"


def test_GLOBAL_crashed_turns_free_their_places_with_the_lease(clean, monkeypatch):  # noqa: F811
    monkeypatch.setenv("UCT_AGENT_INFLIGHT_GLOBAL", "1")
    limits.admit("first", new_request=False, now=1000.0)
    assert limits.admit("second", new_request=False, now=1000.0 + limits.DEFAULTS["UCT_AGENT_INFLIGHT_LEASE_S"] + 1)
