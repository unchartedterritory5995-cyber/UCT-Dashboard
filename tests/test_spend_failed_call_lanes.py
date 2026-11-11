"""A paid call that fails with no usage is not free, on every ledger.

The rule the Agent, the indicator doors and the catalyst lanes already keep: only an HTTP error response costs $0.
A timeout or a dropped connection may have generated every token, so it is charged its worst case. Before this,
these lanes wrote nothing for one, and a run of timeouts could not reach their daily caps.

Mocks only: every client here is a stub, and nothing is sent.
"""
from __future__ import annotations

import importlib
from pathlib import Path
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from api.services import engine, narrative_cost_guard as guard
from api.services.uct_agent import budget

ROOT = Path(__file__).resolve().parent.parent
REQUEST = httpx.Request("POST", "https://example.invalid/v1/messages")
HTTP_ERROR = anthropic.InternalServerError("x", response=httpx.Response(500, request=REQUEST), body=None)
TIMEOUT = anthropic.APITimeoutError(REQUEST)
DROPPED = anthropic.APIConnectionError(request=REQUEST)
ONE = {"model": "claude-sonnet-5", "max_tokens": 400, "system": "s", "messages": [{"role": "user", "content": "x"}]}


class Client:
    def __init__(self, outcome):
        self.outcome, self.calls = outcome, []
        self.messages = self

    def with_options(self, **_kw):
        return self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.fixture
def surface():
    name = "spendtest_lane"
    guard._reset_for_test(name)
    yield name
    guard._reset_for_test(name)


# ═══ the rule, on the shared daily ledger ════════════════════════════════════════════════════════
@pytest.mark.parametrize("failure", [TIMEOUT, DROPPED], ids=["timeout", "dropped"])
def test_a_failure_with_no_usage_costs_its_worst_case_and_still_raises(surface, failure):
    with pytest.raises(type(failure)):
        with guard.charge_if_failed(surface, ONE):
            raise failure
    assert guard.spend_today_usd(surface) == pytest.approx(budget.worst_case_usd(ONE))


def test_an_http_error_response_is_free(surface):
    with pytest.raises(anthropic.InternalServerError):
        with guard.charge_if_failed(surface, ONE):
            raise HTTP_ERROR
    assert guard.spend_today_usd(surface) == 0 and guard.calls_today_for_surface(surface) == 0


def test_a_call_that_worked_is_left_to_its_own_usage(surface):
    with guard.charge_if_failed(surface, ONE):
        pass
    assert guard.calls_today_for_surface(surface) == 0


def test_a_broken_ledger_never_replaces_the_calls_own_error(surface, monkeypatch):
    monkeypatch.setattr(budget, "worst_case_usd", lambda _r: (_ for _ in ()).throw(OSError("disk")))
    with pytest.raises(anthropic.APITimeoutError):
        with guard.charge_if_failed(surface, ONE):
            raise TIMEOUT


def test_timeouts_alone_now_reach_a_lanes_daily_cap(surface, monkeypatch):
    monkeypatch.setenv("SPENDTEST_CAP", "0.05")
    made = 0
    while not guard.over_budget(surface, "SPENDTEST_CAP", 5.0):
        made += 1
        assert made < 100
        with pytest.raises(anthropic.APITimeoutError):
            with guard.charge_if_failed(surface, ONE):
                raise TIMEOUT
    assert made == int(0.05 // budget.worst_case_usd(ONE)) + 1


# ═══ each lane really goes through it ════════════════════════════════════════════════════════════
def _ticker(monkeypatch, client):
    from api.services import ticker_explain as lane
    monkeypatch.setattr(lane, "_get_client", lambda: client)
    return lane._COST_SURFACE, lambda: lane._call_model("NVDA", "why", [], "claude-sonnet-5")


def _comparison(monkeypatch, client):
    from api.services.research import comparison_ai_adapter as lane
    monkeypatch.setattr(lane, "_get_client", lambda: client)
    return lane._COST_SURFACE, lambda: lane._call_model("NVDA", "AMD", "which", [], "claude-sonnet-5")


def _txn(monkeypatch, client):
    from api.services.trade_exchange_news import explain as lane
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: client)
    return lane.COST_SURFACE, lambda: lane._call("s", [{"role": "user", "content": "x"}])


def _deep(monkeypatch, client):
    from api.services import ai_search_deep as lane
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: client)
    return "ai_search_deep", lambda: lane._anthropic_text("claude-sonnet-5", "s", "p", 400, 5.0)


@pytest.mark.parametrize("lane", [_ticker, _comparison, _txn, _deep], ids=["ticker", "comparison", "txn", "deep"])
def test_a_lane_charges_a_timeout_and_keeps_an_http_error_free(monkeypatch, lane):
    client = Client(TIMEOUT)
    name, call = lane(monkeypatch, client)
    guard._reset_for_test(name)
    with pytest.raises(anthropic.APITimeoutError):
        call()
    assert len(client.calls) == 1
    assert guard.spend_today_usd(name) == pytest.approx(budget.worst_case_usd(client.calls[0]))

    guard._reset_for_test(name)
    client.outcome = HTTP_ERROR
    with pytest.raises(anthropic.InternalServerError):
        call()
    assert guard.spend_today_usd(name) == 0
    guard._reset_for_test(name)


def test_the_degraded_answer_is_on_the_ledger_when_it_works_and_when_it_times_out(monkeypatch):
    """It had no ledger row at all: a Perplexity outage moved spend onto a path nothing counted."""
    from api.routers import ai_search as lane
    name = lane._DEGRADED_SURFACE
    guard._reset_for_test(name)
    meta = {"ctx_block": "desk context"}
    reply = SimpleNamespace(content=[SimpleNamespace(type="text", text="answer")],
                            usage=SimpleNamespace(input_tokens=1000, output_tokens=100))
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: Client(reply))
    assert lane._desk_only_answer("q", "s", meta, [])["degraded"] is True
    assert guard.spend_today_usd(name) == pytest.approx(guard.estimate_cost("claude-sonnet-5", 1000, 100))

    guard._reset_for_test(name)
    client = Client(TIMEOUT)
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: client)
    assert lane._desk_only_answer("q", "s", meta, []) is None
    assert guard.spend_today_usd(name) == pytest.approx(budget.worst_case_usd(client.calls[0]))
    guard._reset_for_test(name)


@pytest.mark.parametrize("path,count", [
    ("api/services/ai_search_agent.py", 1), ("api/services/ai_search_deep.py", 1), ("api/routers/ai_search.py", 2),
    ("api/services/research/comparison_ai_adapter.py", 1), ("api/services/ticker_explain.py", 1),
    ("api/services/trade_exchange_news/explain.py", 1),
])
def test_every_call_in_a_lane_sits_inside_the_charge(path, count):
    src = (ROOT / path).read_text("utf-8")
    assert src.count("charge_if_failed(") == src.count(".messages.create(") == count


# ═══ theme engine: its own ledger ════════════════════════════════════════════════════════════════
def test_THEME_a_timeout_reaches_the_engines_cost_log(monkeypatch):
    from api.services.theme_engine import store
    logged = []
    monkeypatch.setattr(store, "log_cost", lambda *a: logged.append(a) or 0.0)
    request = dict(model="claude-opus-4-8", max_tokens=700, messages=[{"role": "user", "content": "x"}])
    with pytest.raises(anthropic.APITimeoutError):
        with store.charge_if_failed("run", request):
            raise TIMEOUT
    assert logged == [("run", "claude-opus-4-8", budget.request_bytes(request) + budget.FRAMING_TOKENS, 700)]

    logged.clear()
    with pytest.raises(anthropic.InternalServerError):
        with store.charge_if_failed("run", request):
            raise HTTP_ERROR
    assert logged == []


def test_THEME_a_failed_orphan_call_is_charged_and_the_batch_lives(monkeypatch):
    from api.services.theme_engine import orphans, store
    logged = []
    monkeypatch.setattr(store, "log_cost", lambda *a: logged.append(a) or 0.0)
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: Client(TIMEOUT))
    ctx = {"sym": "NVDA", "run_id": "run", "industry": "x", "rs_rank": 1, "candidates": [], "narrative": ""}
    out = orphans._adjudicate(ctx)
    assert out["theme_id"] is None and len(logged) == 1 and logged[0][3] == 200


@pytest.mark.parametrize("path", ["api/services/theme_engine/improve.py", "api/services/theme_engine/orphans.py"])
def test_THEME_each_call_sits_inside_the_charge(path):
    src = (ROOT / path).read_text("utf-8")
    assert src.count("store.charge_if_failed(") == 1 and src.count(".messages.create(**request)") == 1
    assert src.count(".messages.create(") == 1


# ═══ pattern vision: the $10 scheduled lane ══════════════════════════════════════════════════════
def _pv(tmp_path, monkeypatch, outcome, pictures=0):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as store
    importlib.reload(store)
    store.init_db()
    import api.services.pattern_vision.orchestrator as orch
    importlib.reload(orch)
    monkeypatch.setattr(orch, "candidates_for", lambda t, tf="D": [
        {"setup": "vcp", "raw_confidence": 0.6, "asof_date": "2026-06-19", "key_level": 10.0}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    monkeypatch.setattr(orch, "_example_pngs", lambda setup: [b"x"] * pictures)
    return store, orch, orch.judge_ticker("NVDA", client=Client(outcome))


def _today():
    import datetime
    return datetime.date.today().isoformat()


def test_VISION_JUDGE_a_timeout_costs_every_picture_and_every_output_token(tmp_path, monkeypatch):
    store, orch, out = _pv(tmp_path, monkeypatch, TIMEOUT, pictures=2)
    judge = orch.vision_judge
    tokens_in, tokens_out = judge.worst_case_tokens("vcp", key_level=10.0, example_pngs=[b"x", b"x"])
    assert out["errored"] == 1 and tokens_out == 900
    assert tokens_in > 3 * judge.IMAGE_TOKENS_WORST + budget.FRAMING_TOKENS
    assert store.cost_today(_today()) == pytest.approx(orch._cost("claude-opus-4-8", tokens_in, tokens_out))


def test_VISION_JUDGE_an_http_error_is_free(tmp_path, monkeypatch):
    store, _, out = _pv(tmp_path, monkeypatch, HTTP_ERROR)
    assert out["errored"] == 1 and store.cost_today(_today()) == 0


def test_VISION_JUDGE_a_ledger_failure_does_not_stop_the_slot(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.orchestrator as orch
    monkeypatch.setattr(orch.store, "log_cost", lambda *a: (_ for _ in ()).throw(OSError("disk")))
    orch._charge_failed_call(TIMEOUT, "2026-11-05", "NVDA", "vcp", None, [])


def test_VISION_JUDGE_timeouts_stop_at_the_hard_cap(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "0.20")
    store, orch, _ = _pv(tmp_path, monkeypatch, TIMEOUT)
    client = Client(TIMEOUT)
    outs = [orch.judge_ticker(f"T{i}", client=client) for i in range(10)]
    assert any(o["cost_capped"] for o in outs) and len(client.calls) < 10
