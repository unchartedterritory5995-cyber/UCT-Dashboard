"""UCT Agent Phase 0A/0B — the hard dollar cap, the shared-$15 stop, the call ceiling and the rate
limits (owner Gate A decisions, 2026-10-13). No model is ever called: every caller here is a stub."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import daily_counters, narrative_cost_guard
from api.services.uct_agent import budget, limits, store, turn

ADMIN = {"id": "38c023cf-0e81-4187-aa43-ac51a751a001", "plan": "pro", "role": "admin"}
ENV = {"disposition": "answer", "reply": "hi", "question": None, "ops": [], "unsupported_category": None,
       "research": None, "title": None}
ZERO_SITE = lambda: (0.0, 15.0)  # noqa: E731


def _resp(env=None, usage=(1200, 80, 0, 0)):
    u = None if usage is None else types.SimpleNamespace(input_tokens=usage[0], output_tokens=usage[1],
                                                         cache_read_input_tokens=usage[2],
                                                         cache_creation_input_tokens=usage[3])
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env or ENV))],
                                 stop_reason="end_turn", usage=u)


def _caller(calls, env=None, usage=(1200, 80, 0, 0)):
    def call(**kw):
        calls.append(kw)
        return _resp(env, usage)
    return call


@pytest.fixture
def clean(monkeypatch):
    store._reset_for_tests()
    budget._reset_for_test()
    limits._reset_for_test()
    daily_counters.clear()
    for k in ("UCT_AGENT_BUDGET_USD", "UCT_AGENT_MAX_CALLS_PER_REQUEST", *limits.DEFAULTS):
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


KW = {"model": "claude-haiku-4-5", "max_tokens": 2048, "system": [{"type": "text", "text": "x" * 20000}],
      "messages": [{"role": "user", "content": "y" * 4000}], "output_config": {"format": {"type": "json_schema", "schema": {}}}}


# ═══ the worst case is an upper bound ════════════════════════════════════════════════════════════
def test_WORST_CASE_bounds_every_way_the_same_request_can_be_billed():
    worst = budget.worst_case_usd(KW)
    n = budget.request_bytes(KW)                     # every byte a token is the most input can be
    for usage in [dict(input=n), dict(cache_write=n), dict(cache_read=n), dict(input=n // 2, cache_write=n // 2)]:
        assert budget._price("claude-haiku-4-5", output=2048, **usage) <= worst
    # an unknown model is priced at the dearest known rate, never $0
    assert budget.worst_case_usd({**KW, "model": "claude-mystery-9"}) > worst
    assert budget.research_worst_case_usd() >= 4 * (0.006 + 600 * 15 / 1e6)


# ═══ the Agent cap: exact under concurrency, durable, conservative ════════════════════════════════
def test_CAP_concurrent_reservations_never_pass_the_cap(clean, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "5")
    admitted, refused = [], []
    barrier = threading.Barrier(40)

    def one():
        barrier.wait()
        try:
            admitted.append(budget.reserve(user_id="u", request_id=None, category="turn", model="m",
                                           worst_usd=0.2, site_reader=ZERO_SITE))
        except budget.BudgetRefused as e:
            refused.append(e.reason)

    ts = [threading.Thread(target=one) for _ in range(40)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(admitted) == 25 and refused == ["agent_cap"] * 15       # $5 / $0.20, not one more
    assert budget.state()["committed_usd"] == pytest.approx(5.0)


def test_CAP_settles_to_actual_and_frees_the_difference(clean, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "1")
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)
    m.call("turn", lambda **kw: _resp(usage=(1000, 100, 2000, 0)), **KW)
    st = budget.state()
    assert st["reserved_usd"] == 0 and st["calls"]["settled"] == 1
    assert st["settled_usd"] == pytest.approx((1000 * 1 + 2000 * 0.1 + 100 * 5) / 1e6)
    assert st["tokens"] == {"input": 1000, "output": 100, "cache_read": 2000, "cache_write": 0}


def test_CAP_missing_usage_and_timeouts_are_charged_the_worst_case(clean):
    m = budget.Meter(user_id="u", request_id=None, site_reader=ZERO_SITE)
    m.call("turn", lambda **kw: _resp(usage=None), **KW)                 # a reply without usage

    class Timeout(Exception):
        pass

    with pytest.raises(Timeout):
        m.call("turn", lambda **kw: (_ for _ in ()).throw(Timeout()), **KW)
    st = budget.state()
    assert st["settled_usd"] == pytest.approx(2 * budget.worst_case_usd(KW), abs=1e-5)
    assert st["calls"]["charged_worst_case"] == 2


def test_CAP_a_provider_error_response_is_not_billed_and_gives_the_call_back(clean):
    import anthropic
    import httpx
    rid = budget.open_request("u", "c", "hello")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    err = anthropic.BadRequestError("credit balance is too low", response=httpx.Response(
        400, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")), body=None)
    with pytest.raises(anthropic.BadRequestError):
        m.call("turn", lambda **kw: (_ for _ in ()).throw(err), **KW)
    st = budget.state()
    assert st["committed_usd"] == 0 and st["calls"]["released"] == 1
    assert budget.calls_used(rid) == 0


def test_CAP_an_unsettled_reservation_keeps_counting_its_worst_case(clean, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "1")
    budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.7, site_reader=ZERO_SITE)
    # the process "dies" here: nothing settles it
    with pytest.raises(budget.BudgetRefused) as e:
        budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.4, site_reader=ZERO_SITE)
    assert e.value.reason == "agent_cap" and budget.state()["reserved_usd"] == pytest.approx(0.7)


def test_CAP_survives_a_restart(clean, tmp_path):
    """Two separate Python processes on one store: the second sees the first's spend."""
    db = str(tmp_path / "agent_restart.db")
    code = ("import sys, json; from api.services.uct_agent import budget;"
            "budget.site_spend_usd = lambda: (0.0, 15.0);"
            "op = sys.argv[1];"
            "budget.reserve(user_id='u', request_id=None, category='turn', model='m', worst_usd=3.0) if op == 'spend' else None;"
            "print(json.dumps(budget.state()['committed_usd']))")
    env = {**os.environ, "UCT_AGENT_DB_PATH": db, "UCT_AGENT_BUDGET_USD": "5"}
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    run = lambda op: subprocess.run([sys.executable, "-c", code, op], cwd=root, env=env,  # noqa: E731
                                    capture_output=True, text=True, timeout=120)
    first = run("spend")
    assert first.returncode == 0, first.stderr[-2000:]
    second = run("read")
    assert second.returncode == 0, second.stderr[-2000:]
    assert json.loads(second.stdout.strip().splitlines()[-1]) == pytest.approx(3.0)


def test_CAP_zero_blank_and_garbage_never_mean_unlimited(monkeypatch):
    for v in ("0", "", "abc", "-3"):
        monkeypatch.setenv("UCT_AGENT_BUDGET_USD", v)
        assert budget.cap_usd() == 5.0
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "2.5")
    assert budget.cap_usd() == 2.5


def test_CAP_fails_closed_when_the_ledger_is_unusable(clean, monkeypatch):
    with monkeypatch.context() as mp:
        mp.setattr(budget, "_connect", lambda: (_ for _ in ()).throw(OSError("disk")))
        with pytest.raises(budget.BudgetRefused) as e:
            budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.01, site_reader=ZERO_SITE)
    assert e.value.reason == "unavailable"


# ═══ the shared $15 stop (read-only) ═════════════════════════════════════════════════════════════
def test_SITE_the_agent_stops_when_the_site_ledger_is_spent_and_never_writes_to_it(clean):
    with pytest.raises(budget.BudgetRefused) as e:
        budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.01,
                       site_reader=lambda: (15.0, 15.0))
    assert e.value.reason == "site_cap" and "UCT's shared AI budget" in e.value.sentence
    with pytest.raises(budget.BudgetRefused) as e:
        budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.01,
                       site_reader=lambda: (_ for _ in ()).throw(OSError("catalysts.db")))
    assert e.value.reason == "unavailable"
    src = open(budget.__file__, encoding="utf-8").read()
    assert "cost_guard.record" not in src and "log_cost" not in src      # option 1: never added to the site total


def test_SITE_reads_the_real_catalyst_ledger(clean, monkeypatch):
    from api.services.catalyst import cost_guard, store as cstore
    monkeypatch.undo()                                                    # the real reader
    cstore._init_db()
    cost_guard.record(budget.et_day(), "AAPL", "claude-haiku-4-5", 0, 0)  # a $0 row: the table exists
    spent, cap = budget.site_spend_usd()
    assert cap == cost_guard.hard_cap_usd() and spent >= 0


# ═══ the call ceiling: 2 paid model calls per member request ════════════════════════════════════
def test_CEILING_two_calls_per_request_research_lookup_not_counted(clean):
    rid = budget.open_request("u", "c1", "what's new with NVDA")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    m.call("turn", lambda **kw: _resp(), **KW)
    m.research(lambda: {"answer": "x", "citations": [], "cached": False, "cost_usd": 0.007})
    assert m.calls_left() == 1
    m.call("after_research", lambda **kw: _resp(), **KW)
    with pytest.raises(budget.BudgetRefused) as e:
        m.call("title", lambda **kw: _resp(), **KW)
    assert e.value.reason == "call_limit"
    assert budget.state()["by_category"]["research"] == pytest.approx(0.007)


def test_CEILING_a_reroute_continues_its_request_and_cannot_be_forged(clean):
    rid = budget.open_request("u", "c1", "add rsi")
    assert budget.open_request("u", "c1", "add  rsi", reroute=True) == rid       # same words, same chat
    assert budget.open_request("u", "c2", "add rsi", reroute=True) is None       # another chat
    assert budget.open_request("u", "c1", "something else", reroute=True) is None
    assert budget.open_request("v", "c1", "add rsi", reroute=True) is None       # another member


def test_CEILING_research_is_skipped_honestly_when_no_call_is_left(clean, monkeypatch):
    """A reroute's first call is the request's second: if the model then asks for research, nothing is
    looked up and the member is told so in UCT's words."""
    rid = budget.open_request("u", "c1", "what's the latest on NVDA earnings?")
    m = budget.Meter(user_id="u", request_id=rid, site_reader=ZERO_SITE)
    m.call("turn", lambda **kw: _resp(), **KW)                                  # call 1 (asked for groups)
    looked = []
    monkeypatch.setattr(turn, "_research", lambda q, r: looked.append(q) or {"answer": "", "citations": []})
    env = {**ENV, "reply": "Let me check.", "research": {"query": "NVDA earnings", "recency": "week"}}
    out = turn.run_turn(message="what's the latest on NVDA earnings?", context={}, history=[],
                        caller=_caller([], env), meter=m, reroute=True)
    assert looked == [] and out["envelope"]["reply"] == turn.RESEARCH_STEP_LIMIT
    assert out["usage"]["research_skipped"] == "call_limit" and budget.calls_used(rid) == 2


# ═══ the /turn route ════════════════════════════════════════════════════════════════════════════
def test_ROUTE_agent_cap_refuses_before_any_model_call_and_instant_routes_still_work(client, monkeypatch):
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "0.0001")                       # below one call's worst case
    r = client.post("/api/agent/turn", json={"message": "hi"})
    assert r.status_code == 429 and r.json()["detail"] == budget.AGENT_EXHAUSTED and calls == []
    assert daily_counters.value(rx._et_day(), rx.SCOPE, ADMIN["id"]) == 0       # the day's count given back
    # deterministic Agent paths never touch the ledger
    assert client.post("/api/agent/record", json={"member": "weekly", "outcome": "Changed timeframe to W"}).status_code == 200
    assert client.get("/api/agent/conversations").status_code == 200


def test_ROUTE_site_cap_refuses_with_its_own_sentence(client, monkeypatch):
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    monkeypatch.setattr(budget, "site_spend_usd", lambda: (15.0, 15.0))
    r = client.post("/api/agent/turn", json={"message": "hi"})
    assert r.status_code == 429 and r.json()["detail"] == budget.SITE_EXHAUSTED and calls == []


def test_ROUTE_a_turn_records_tokens_model_category_and_outcome(client, monkeypatch):
    monkeypatch.setattr(turn, "_default_caller", _caller([], usage=(1500, 90, 3000, 0)))
    assert client.post("/api/agent/turn", json={"message": "hi"}).status_code == 200
    st = client.get("/api/agent/budget").json()
    assert st["calls"]["settled"] >= 1 and st["tokens"]["cache_read"] >= 3000
    assert "turn" in st["by_category"] and st["models"] == ["claude-haiku-4-5"]
    assert st["cap_usd"] == 5.0 and st["site"]["cap_usd"] == 15.0


def test_ROUTE_a_reroute_with_nothing_to_continue_is_refused(client, monkeypatch):
    calls = []
    monkeypatch.setattr(turn, "_default_caller", _caller(calls))
    r = client.post("/api/agent/turn", json={"message": "add rsi", "reroute": True, "conversationId": "ac_nope"})
    assert r.status_code == 400 and calls == []


# ═══ rate limits ════════════════════════════════════════════════════════════════════════════════
def test_RATE_member_minute_hour_and_global_windows(clean, monkeypatch):
    t = 1_000_000.0
    for _ in range(20):
        limits.done(limits.admit("a", new_request=True, now=t))
    with pytest.raises(limits.Refused) as e:
        limits.admit("a", new_request=True, now=t + 1)
    assert e.value.reason == "member_minute" and 1 <= e.value.retry_after <= 61
    limits.done(limits.admit("a", new_request=True, now=t + 61))         # the minute slid
    limits.done(limits.admit("a", new_request=False, now=t + 1))         # a reroute takes no new place
    monkeypatch.setenv("UCT_AGENT_RATE_MEMBER_HOUR", "21")
    with pytest.raises(limits.Refused) as e:
        limits.admit("a", new_request=True, now=t + 200)
    assert e.value.reason == "member_hour"
    monkeypatch.setenv("UCT_AGENT_RATE_GLOBAL_MINUTE", "3")
    limits._reset_for_test()
    for who in "xyz":
        limits.done(limits.admit(who, new_request=True, now=t))
    with pytest.raises(limits.Refused) as e:
        limits.admit("w", new_request=True, now=t)
    assert e.value.reason == "global_minute"


def test_RATE_one_request_in_flight_per_member_and_leases_expire(clean):
    t = 2_000_000.0
    tok = limits.admit("a", new_request=True, now=t)
    with pytest.raises(limits.Refused) as e:
        limits.admit("a", new_request=True, now=t + 1)
    assert e.value.reason == "in_flight"
    limits.done(limits.admit("b", new_request=True, now=t + 1))          # another member is not blocked
    limits.done(limits.admit("a", new_request=True, now=t + 151))        # a crashed request's lease expired
    limits.done(tok)


def test_RATE_concurrent_admissions_take_exactly_the_window(clean, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_INFLIGHT_PER_MEMBER", "100")
    ok, no = [], []
    barrier = threading.Barrier(30)

    def one():
        barrier.wait()
        try:
            ok.append(limits.admit("a", new_request=True, now=3_000_000.0))
        except limits.Refused:
            no.append(1)

    ts = [threading.Thread(target=one) for _ in range(30)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(ok) == 20 and len(no) == 10


def test_RATE_the_route_says_a_sentence_with_retry_after_and_instant_routes_are_never_limited(client, monkeypatch):
    monkeypatch.setattr(turn, "_default_caller", _caller([]))
    monkeypatch.setenv("UCT_AGENT_RATE_MEMBER_MINUTE", "2")
    assert client.post("/api/agent/turn", json={"message": "one"}).status_code == 200
    assert client.post("/api/agent/turn", json={"message": "two"}).status_code == 200
    r = client.post("/api/agent/turn", json={"message": "three"})
    assert r.status_code == 429 and r.json()["detail"] == limits.MEMBER_RATE and int(r.headers["Retry-After"]) >= 1
    for i in range(30):                                                  # fast-path receipts keep flowing
        assert client.post("/api/agent/record", json={"member": f"weekly {i}", "outcome": "Changed timeframe"}).status_code == 200


def test_RATE_a_daily_cap_refusal_does_not_use_a_window_place(client, monkeypatch):
    monkeypatch.setattr(turn, "_default_caller", _caller([]))
    monkeypatch.setenv("UCT_AGENT_DAILY_CAP", "1")
    monkeypatch.setenv("UCT_AGENT_RATE_MEMBER_MINUTE", "2")
    assert client.post("/api/agent/turn", json={"message": "one"}).status_code == 200
    for _ in range(3):
        assert client.post("/api/agent/turn", json={"message": "more"}).json()["detail"] == "You've reached today's UCT Agent limit."


# ═══ delayed settlement ═════════════════════════════════════════════════════════════════════════
def test_SETTLE_a_call_that_settles_after_et_midnight_charges_the_day_it_was_admitted(clean, monkeypatch):
    monkeypatch.setattr(budget, "et_day", lambda: "2026-10-13")
    rid = budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.5, site_reader=ZERO_SITE)
    monkeypatch.setattr(budget, "et_day", lambda: "2026-10-14")          # the reply arrives after midnight
    budget.settle(rid, actual_usd=0.01)
    assert budget.state("2026-10-13")["settled_usd"] == pytest.approx(0.01)
    assert budget.state("2026-10-14")["committed_usd"] == 0              # the new day starts clean


def test_SETTLE_is_idempotent_and_a_release_after_settle_changes_nothing(clean):
    rid = budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.5, site_reader=ZERO_SITE)
    assert budget.settle(rid, actual_usd=0.02) == pytest.approx(0.02)
    assert budget.settle(rid, actual_usd=0.40) == 0.0                    # a second settle is ignored
    budget.release(rid)                                                   # and cannot un-charge it
    st = budget.state()
    assert st["settled_usd"] == pytest.approx(0.02) and st["calls"]["released"] == 0


def test_SETTLE_a_failed_settle_leaves_the_worst_case_counting(clean, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "1")
    rid = budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.8, site_reader=ZERO_SITE)
    with monkeypatch.context() as mp:
        mp.setattr(budget, "_connect", lambda: (_ for _ in ()).throw(OSError("disk")))
        assert budget.settle(rid, actual_usd=0.01) == 0.0                # never raises into the request
    assert budget.state()["reserved_usd"] == pytest.approx(0.8)         # still held at its worst case
    with pytest.raises(budget.BudgetRefused):
        budget.reserve(user_id="u", request_id=None, category="turn", model="m", worst_usd=0.3, site_reader=ZERO_SITE)
