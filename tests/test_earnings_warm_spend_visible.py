"""Every earnings AI call reaches the ledger, so the warm's spend is visible, and its dollar gate is ready.

The warm can queue hundreds of names and wrote no dollars anywhere. No dollar cap is set here: the amount is the
owner's decision, so the gate ships OFF and setting `EARNINGS_WARM_COST_CAP_DAILY` is config only.

Mocks only: the client is a MagicMock, and nothing is sent.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import anthropic
import httpx
import pytest

from api.services import earnings_preview_warm as warm_pass
from api.services import engine, narrative_cost_guard as guard
from api.services.uct_agent import budget
from tests.test_earnings_warm_attempts import GENERATORS, REQUEST, SYM, _row, warm  # noqa: F401 -- fixture

WARM, CLICK = "earnings_warm", "earnings_click"
HTTP_ERROR = anthropic.InternalServerError("overloaded", response=httpx.Response(529, request=REQUEST), body=None)


@pytest.fixture
def ledger(warm):  # noqa: F811
    guard._reset_for_test()
    usage = SimpleNamespace(input_tokens=2000, output_tokens=300)
    warm.client.messages.create.return_value.usage = usage
    yield warm
    guard._reset_for_test()


def _one_call(ledger):
    return ledger.client.messages.create.call_args.kwargs


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_warm_call_is_on_the_ledger_at_its_usage(ledger, kind, gen):
    gen(SYM, _row(), force_fresh_check=True)
    assert ledger.client.messages.create.call_count == 1
    assert guard.calls_today_for_surface(WARM) == 1
    assert guard.spend_today_usd(WARM) == pytest.approx(guard.estimate_cost(engine._EARNINGS_AI_MODEL, 2000, 300))


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_click_is_on_the_ledger_under_its_own_name(ledger, kind, gen):
    gen(SYM, _row())
    assert guard.calls_today_for_surface(CLICK) == 1 and guard.calls_today_for_surface(WARM) == 0


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_timeout_costs_its_worst_case(ledger, kind, gen):
    ledger.client.messages.create.side_effect = anthropic.APITimeoutError(REQUEST)
    gen(SYM, _row(), force_fresh_check=True)
    assert guard.spend_today_usd(WARM) == pytest.approx(budget.worst_case_usd(_one_call(ledger)))


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_an_http_error_is_free(ledger, kind, gen):
    ledger.client.messages.create.side_effect = HTTP_ERROR
    gen(SYM, _row(), force_fresh_check=True)
    assert guard.spend_today_usd(WARM) == 0


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_broken_ledger_does_not_lose_a_paid_answer(ledger, kind, gen, monkeypatch):
    monkeypatch.setattr(guard, "record_from_response", lambda *a: (_ for _ in ()).throw(OSError("disk")))
    gen(SYM, _row(), force_fresh_check=True)
    from api.services import earnings_ai_store as store
    assert store.read(kind, SYM) is not None


# ═══ the gate: off until the owner sets an amount ════════════════════════════════════════════════
@pytest.fixture
def gate(monkeypatch):
    guard._reset_for_test(WARM)
    monkeypatch.delenv(warm_pass._COST_CAP_ENV, raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    guard.record(WARM, "claude-sonnet-5", cost_usd=2.0)
    yield monkeypatch
    guard._reset_for_test(WARM)


@pytest.mark.parametrize("value", [None, "", "0", "-1", "lots"])
def test_the_gate_is_off_unless_a_real_amount_is_set(gate, value):
    if value is not None:
        gate.setenv(warm_pass._COST_CAP_ENV, value)
    assert warm_pass._cost_cap_reached() is False


def test_setting_an_amount_closes_the_gate_with_config_only(gate):
    gate.setenv(warm_pass._COST_CAP_ENV, "3")
    assert warm_pass._cost_cap_reached() is False
    gate.setenv(warm_pass._COST_CAP_ENV, "2")
    assert warm_pass._cost_cap_reached() is True


def test_a_closed_gate_skips_the_pass(gate):
    gate.setenv(warm_pass._COST_CAP_ENV, "1")
    assert warm_pass._run("preview", MagicMock(), reported=False) == {"skipped": "cost-cap"}


def test_a_closed_gate_stops_jobs_already_queued(gate):
    gate.setenv(warm_pass._COST_CAP_ENV, "1")
    generator = MagicMock()
    warm_pass._safe_gen(generator, "PL", {})
    assert generator.call_count == 0


def test_an_open_gate_lets_a_queued_job_run(gate):
    generator = MagicMock()
    warm_pass._safe_gen(generator, "PL", {})
    assert generator.call_count == 1


def test_a_broken_ledger_read_never_stops_the_warm(gate, monkeypatch):
    gate.setenv(warm_pass._COST_CAP_ENV, "1")
    monkeypatch.setattr(guard, "spend_today_usd", lambda _s: (_ for _ in ()).throw(OSError("disk")))
    assert warm_pass._cost_cap_reached() is False


def test_the_gate_reads_the_warm_only_so_clicks_do_not_close_it(gate):
    guard._reset_for_test(WARM)
    guard._reset_for_test(CLICK)
    guard.record(CLICK, "claude-sonnet-5", cost_usd=50.0)
    gate.setenv(warm_pass._COST_CAP_ENV, "1")
    assert warm_pass._cost_cap_reached() is False
    guard._reset_for_test(CLICK)
