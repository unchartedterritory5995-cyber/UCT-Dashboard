"""Tests for api/services/alphavantage_client.py — the shared AlphaVantage
budget/cooldown/throttle-detection coordination point (data-dependability
migration, Task 15).

All AlphaVantage HTTP calls are mocked — no real network traffic.

Module-level state (`_av_bucket_day`, `_av_bucket_used`,
`_av_bucket_denied_total`, `_av_cooldown_until`) is a process-wide singleton
by design (mirrors `api/services/finnhub_client.py`'s token bucket), so
every test in this file resets it before AND after via an autouse fixture.
This file collects before the other two AV-touching test files
(`tests/test_av_transcripts.py`, `tests/test_catalyst_finviz_av_news.py`) in
default alphabetical order, and several tests here deliberately exhaust the
day's 25-call budget — without a teardown reset that state would leak into
whichever test file collects next in the same pytest process.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from api.services import alphavantage_client as av


@pytest.fixture(autouse=True)
def _reset_av_client_state():
    """Reset the module-global bucket/cooldown/denial-counter before and
    after every test in this file — see module docstring."""

    def _reset():
        av._av_bucket_day = None
        av._av_bucket_used = 0
        av._av_bucket_denied_total = 0
        av._av_cooldown_until = 0.0

    _reset()
    yield
    _reset()


def _mock_ok_response(json_body):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = json_body
    return resp


_HAPPY_BODY = {"feed": [{"title": "NVDA soars"}]}
_THROTTLE_NOTE = {
    "Note": "Thank you for using Alpha Vantage! "
            "Our standard API call frequency is 5 calls per minute.",
}
_THROTTLE_INFO = {
    "Information": "Thank you for using Alpha Vantage! "
                    "Our standard API rate limit is 25 requests per day.",
}


def _mock_requests(monkeypatch):
    """Patch api.services.alphavantage_client.requests.get and set a
    dummy API key. Returns the mock module so callers can set
    .get.return_value / .get.side_effect."""
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "test-key-for-tests-only")
    mock_module = MagicMock()
    monkeypatch.setattr("api.services.alphavantage_client.requests", mock_module)
    return mock_module


# ── Daily budget: the 26th call ─────────────────────────────────────────────

class TestDailyBudget:
    def test_26th_call_returns_none_without_network_call(self, monkeypatch):
        """25 calls succeed; the 26th is shed by the local bucket with ZERO
        network calls — the load-bearing Task 15 guarantee (mirrors
        finnhub_client's non-blocking-shedding contract, but at a 25/day
        rather than ~55/min shape)."""
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)

        for i in range(25):
            result = av.av_get({"function": "NEWS_SENTIMENT"})
            assert result == _HAPPY_BODY, f"call {i + 1} unexpectedly failed"
        assert mock_req.get.call_count == 25

        # The 26th call: budget spent — must return None with NO new call.
        result_26 = av.av_get({"function": "NEWS_SENTIMENT"})
        assert result_26 is None
        assert mock_req.get.call_count == 25, (
            "26th call must not reach the network — the daily bucket must shed it"
        )

    def test_26th_call_increments_denied_counter(self, monkeypatch):
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)
        for _ in range(25):
            av.av_get({"function": "NEWS_SENTIMENT"})

        before = av.av_budget_denied_total()
        av.av_get({"function": "NEWS_SENTIMENT"})
        after = av.av_budget_denied_total()

        assert after == before + 1

    def test_call_25_still_succeeds(self, monkeypatch):
        """Boundary check: the 25th call (not just the 26th) must still go
        through — the cap is 25, not 24."""
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)
        for _ in range(24):
            av.av_get({"function": "NEWS_SENTIMENT"})

        result_25 = av.av_get({"function": "NEWS_SENTIMENT"})

        assert result_25 == _HAPPY_BODY
        assert mock_req.get.call_count == 25


# ── Throttle classification (shared detector) ────────────────────────────

class TestThrottleClassification:
    def test_note_key_classified_as_throttle(self):
        assert av.is_av_throttle_response(_THROTTLE_NOTE) is True

    def test_information_key_classified_as_throttle(self):
        assert av.is_av_throttle_response(_THROTTLE_INFO) is True

    def test_ordinary_body_not_classified_as_throttle(self):
        assert av.is_av_throttle_response(_HAPPY_BODY) is False

    def test_non_dict_not_classified_as_throttle(self):
        assert av.is_av_throttle_response([1, 2, 3]) is False
        assert av.is_av_throttle_response(None) is False

    def test_throttle_response_via_av_get_status_returns_throttled_true(self, monkeypatch):
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_THROTTLE_NOTE)

        data, throttled = av.av_get_status({"function": "NEWS_SENTIMENT"})

        assert data is None
        assert throttled is True

    def test_throttle_response_via_av_get_returns_none(self, monkeypatch):
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_THROTTLE_INFO)

        assert av.av_get({"function": "NEWS_SENTIMENT"}) is None

    def test_throttle_response_consumes_a_budget_token(self, monkeypatch):
        """Design choice, documented in the module docstring ("Design
        choice: a throttle-classified response still counts against the
        local daily bucket"): the token is spent BEFORE the network round
        trip is attempted, and is NOT refunded on a throttle-classified
        reply. There is no reliable way to distinguish "our local
        day-boundary has drifted from AV's real one" from "this call was
        genuinely over budget" — refunding in that ambiguous case would let
        an already-out-of-sync process keep hammering a 25/day account, the
        wrong failure direction. So: one throttled attempt == one spent
        slot, same as a successful one."""
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_THROTTLE_NOTE)

        av.av_get_status({"function": "NEWS_SENTIMENT"})

        assert av._av_bucket_used == 1, (
            "a throttle-classified response must still consume a daily-bucket slot"
        )

    def test_throttle_response_engages_shared_cooldown(self, monkeypatch):
        assert av.av_in_cooldown() is False
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_THROTTLE_NOTE)

        av.av_get_status({"function": "NEWS_SENTIMENT"})

        assert av.av_in_cooldown() is True

    def test_ordinary_success_does_not_engage_cooldown(self, monkeypatch):
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)

        av.av_get_status({"function": "NEWS_SENTIMENT"})

        assert av.av_in_cooldown() is False


# ── Non-blocking guarantee ────────────────────────────────────────────────

class TestNeverSleeps:
    def test_budget_exhausted_call_is_near_instant(self, monkeypatch):
        """Proves no blocking wait was introduced: once the day's budget is
        spent, av_get must return in well under a second — it must NEVER
        sleep to wait for the next day's reset (the exact mistake the
        deleted `engine._av_get` 13s-sleep made — see module docstring)."""
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)
        for _ in range(25):
            av.av_get({"function": "NEWS_SENTIMENT"})

        start = time.monotonic()
        result = av.av_get({"function": "NEWS_SENTIMENT"})
        elapsed = time.monotonic() - start

        assert result is None
        assert elapsed < 0.1, (
            f"av_get took {elapsed:.3f}s on a budget-exhausted call — must be near-instant, never sleep"
        )

    def test_missing_api_key_call_is_near_instant(self, monkeypatch):
        monkeypatch.delenv("ALPHAVANTAGE_API_KEY", raising=False)

        start = time.monotonic()
        result = av.av_get({"function": "NEWS_SENTIMENT"})
        elapsed = time.monotonic() - start

        assert result is None
        assert elapsed < 0.1


# ── Daily reset (ET-midnight convention) ──────────────────────────────────

class TestDailyReset:
    def test_bucket_resets_on_day_rollover(self, monkeypatch):
        """Simulate crossing the ET-midnight day boundary via an injected
        `now` — never depend on the actual day this test runs (test-oracle
        law: 'pass an explicit now')."""
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)

        day1 = datetime(2026, 8, 5, 23, 0, 0, tzinfo=timezone.utc)  # 7pm ET (EDT, UTC-4)
        day2 = day1 + timedelta(hours=6)  # 1am ET next day — crosses ET midnight

        for _ in range(25):
            assert av.av_get({"function": "NEWS_SENTIMENT"}, now=day1) == _HAPPY_BODY

        # Budget spent for day1 — a further call on the SAME (ET) day is denied.
        assert av.av_get({"function": "NEWS_SENTIMENT"}, now=day1) is None

        # A call on the NEXT calendar day (ET) must succeed again.
        result_next_day = av.av_get({"function": "NEWS_SENTIMENT"}, now=day2)
        assert result_next_day == _HAPPY_BODY, "bucket did not reset across the ET day boundary"

    def test_same_et_calendar_day_does_not_reset(self, monkeypatch):
        """Two UTC instants that are STILL the same ET calendar day must
        NOT reset the bucket — guards against a naive UTC-date comparison
        (which would wrongly reset near ET midnight, ~4-5h before UTC
        midnight in summer)."""
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)

        t1 = datetime(2026, 8, 5, 15, 0, 0, tzinfo=timezone.utc)   # 11:00am ET
        t2 = datetime(2026, 8, 5, 23, 30, 0, tzinfo=timezone.utc)  # 7:30pm ET, same ET day

        for _ in range(25):
            av.av_get({"function": "NEWS_SENTIMENT"}, now=t1)

        # Still the same ET calendar day at t2 — budget must remain exhausted.
        assert av.av_get({"function": "NEWS_SENTIMENT"}, now=t2) is None

    def test_naive_now_is_handled_without_raising(self, monkeypatch):
        """A caller passing a naive (tz-less) datetime must not crash —
        treated as UTC before converting to the ET reset zone."""
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)

        naive_now = datetime(2026, 8, 5, 12, 0, 0)  # no tzinfo

        result = av.av_get({"function": "NEWS_SENTIMENT"}, now=naive_now)

        assert result == _HAPPY_BODY


# ── av_take_token (public wrapper for a bare-HTTP-client caller) ─────────

class TestAvTakeToken:
    def test_public_wrapper_shares_the_same_bucket(self, monkeypatch):
        mock_req = _mock_requests(monkeypatch)
        mock_req.get.return_value = _mock_ok_response(_HAPPY_BODY)

        for _ in range(25):
            assert av.av_take_token() is True

        assert av.av_take_token() is False
        # And av_get, sharing the SAME bucket, is now also denied.
        assert av.av_get({"function": "NEWS_SENTIMENT"}) is None
