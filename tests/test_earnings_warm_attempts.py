"""One failed background attempt per name per ET day, durable across a restart.

A warm generation that leaves no stored file used to be re-billed on every pass
(four a day over a 500-name board). The model call is mocked; nothing here spends.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import anthropic
import httpx
import pytest

from api.services import daily_counters, earnings_ai_store as store, engine
from api.services.cache import cache

DAY = "2026-11-05"
SYM = "PL"
COMPLETE = {k: None for k in engine._ENRICHMENT_LEG_KEYS}
REPLY = '{"preview": "A real preview.", "summary": "A real recap.", "bullets": ["a", "b", "c"]}'
REQUEST = httpx.Request("POST", "https://example.invalid/v1/messages")


@pytest.fixture
def warm(tmp_path, monkeypatch):
    from api.services import auth_db, earnings_enrichment, earnings_estimates
    path = str(tmp_path / "auth.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    monkeypatch.setenv("AUTH_DB_PATH", path)
    monkeypatch.setattr(store, "_DIR", str(tmp_path / "earnings_ai_cache"))
    monkeypatch.setattr(store, "_et_day", lambda: DAY)
    monkeypatch.setattr(engine, "_fetch_quarterly_history", lambda _sym: [])
    monkeypatch.setattr(earnings_estimates, "_fh_get", lambda *_a, **_k: [])
    enrichment = {"value": dict(COMPLETE)}
    monkeypatch.setattr(earnings_enrichment, "enrich_earnings_response",
                        lambda *_a, **_k: enrichment["value"])
    client = MagicMock()
    client.messages.create.return_value = MagicMock(content=[MagicMock(type="text", text=REPLY)])
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: client)
    cache.clear()
    yield MagicMock(client=client, enrichment=enrichment)
    cache.clear()


def _row(eps=1.0):
    return {"sym": SYM, "eps_estimate": eps, "date": "2026-11-06", "session": "AMC", "verdict": "Beat"}


GENERATORS = [("preview", engine._generate_earnings_preview),
              ("analysis", engine._generate_earnings_analysis)]


def _calls(warm):
    return warm.client.messages.create.call_count


def _attempts(kind):
    return daily_counters.value(DAY, f"{store.ATTEMPT_SCOPE}:{kind}", SYM)


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_incomplete_enrichment_bills_once_across_passes(warm, kind, gen):
    warm.enrichment["value"] = {}                     # the fan-out deadline cut every leg
    for _ in range(4):
        gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 1
    assert store.read(kind, SYM) is None


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_the_attempt_survives_a_restart(warm, kind, gen):
    warm.enrichment["value"] = {}
    gen(SYM, _row(), force_fresh_check=True)
    cache.clear()                                     # a restart loses memory, not auth.db
    gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 1


def test_a_process_killed_mid_call_still_used_the_attempt(warm):
    assert store.claim_attempt("preview", SYM) is True  # claimed, then the pod died
    engine._generate_earnings_preview(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 0


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_used_attempt_skips_the_provider_fan_out_too(warm, kind, gen, monkeypatch):
    fetched = []
    monkeypatch.setattr(engine, "_fetch_quarterly_history", lambda s: fetched.append(s) or [])
    assert store.claim_attempt(kind, SYM) is True
    gen(SYM, _row(), force_fresh_check=True)
    assert fetched == []


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_new_day_gets_a_new_attempt(warm, kind, gen, monkeypatch):
    warm.enrichment["value"] = {}
    gen(SYM, _row(), force_fresh_check=True)
    monkeypatch.setattr(store, "_et_day", lambda: "2026-11-06")
    gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 2


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_an_unusable_reply_uses_the_attempt(warm, kind, gen):
    warm.client.messages.create.return_value = MagicMock(content=[MagicMock(type="text", text="no json")])
    gen(SYM, _row(), force_fresh_check=True)
    gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 1


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_timeout_uses_the_attempt(warm, kind, gen):
    warm.client.messages.create.side_effect = anthropic.APITimeoutError(REQUEST)
    gen(SYM, _row(), force_fresh_check=True)
    gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 1


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_an_http_error_is_free_and_keeps_the_attempt(warm, kind, gen):
    warm.client.messages.create.side_effect = anthropic.InternalServerError(
        "overloaded", response=httpx.Response(529, request=REQUEST), body=None)
    gen(SYM, _row(), force_fresh_check=True)
    warm.client.messages.create.side_effect = None
    gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 2
    assert store.read(kind, SYM) is not None


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_an_error_after_a_stream_began_keeps_the_attempt(warm, kind, gen):
    """The SDK raises an SSE error event as an APIStatusError carrying the stream's 200."""
    warm.client.messages.create.side_effect = anthropic.APIStatusError(
        "overloaded", response=httpx.Response(200, request=REQUEST), body=None)
    gen(SYM, _row(), force_fresh_check=True)
    gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 1
    assert _attempts(kind) == 1


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_a_payload_the_store_refuses_uses_the_attempt(warm, kind, gen):
    warm.enrichment["value"] = {**COMPLETE, "pre_earnings": {"label": "x", "ret": float("nan")}}
    gen(SYM, _row(), force_fresh_check=True)
    gen(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 1


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_success_is_unchanged_stable_inputs_skip_and_moved_inputs_regenerate(warm, kind, gen):
    gen(SYM, _row(), force_fresh_check=True)
    assert store.read(kind, SYM) is not None
    gen(SYM, _row(), force_fresh_check=True)          # skip-if-stable
    assert _calls(warm) == 1
    gen(SYM, _row(eps=2.0), force_fresh_check=True)   # same day, the inputs moved
    assert _calls(warm) == 2
    assert _attempts(kind) == 0


@pytest.mark.parametrize("kind,gen", GENERATORS)
def test_the_click_path_neither_reads_nor_uses_the_attempt(warm, kind, gen):
    assert store.claim_attempt(kind, SYM) is True
    gen(SYM, _row())
    assert _calls(warm) == 1
    assert _attempts(kind) == 1


def test_a_pending_row_uses_no_analysis_attempt(warm):
    engine._generate_earnings_analysis(SYM, {**_row(), "verdict": ""}, force_fresh_check=True)
    assert _calls(warm) == 0
    assert _attempts("analysis") == 0


def test_a_counter_that_cannot_be_written_fails_closed(warm, monkeypatch):
    def boom():
        raise OSError("disk")
    monkeypatch.setattr(daily_counters, "_connect", boom)
    assert store.claim_attempt("preview", SYM) is False
    engine._generate_earnings_preview(SYM, _row(), force_fresh_check=True)
    assert _calls(warm) == 0


def test_preview_and_analysis_have_their_own_attempt(warm):
    assert store.claim_attempt("preview", SYM) is True
    assert store.claim_attempt("analysis", SYM) is True
    assert store.claim_attempt("preview", SYM) is False
