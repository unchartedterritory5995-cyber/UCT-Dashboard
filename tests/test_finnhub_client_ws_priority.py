"""api/services/finnhub_client.py — WS-vs-REST budget priority (2026-08-05).

Covers the mechanism that makes realtime_stream.py's WebSocket reconnect
loop YIELD to the request-facing REST path when Finnhub's account budget is
scarce, and the cross-source 429 coordination (a WS-side rejection engages
the SAME cooldown a REST 429 would, and vice versa).

Companion to test_finnhub_budget.py (which covers fh_get's own REST-only
behavior — this file is scoped to the NEW WS-priority surface promoted out
of earnings_estimates.py into this shared module).
"""
import pytest

from api.services import finnhub_client as fhc


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = fhc._time.monotonic()
    yield
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = fhc._time.monotonic()


# ── fh_ws_reconnect_allowed: reserve headroom ────────────────────────────────

def test_ws_reconnect_denied_when_bucket_has_only_bare_headroom():
    """A REST call (reserve=0) would succeed with just over 1 token, but WS
    requires _FH_WS_RESERVE_TOKENS MORE headroom — this is the mechanism that
    makes WS yield first under contention."""
    fhc._fh_bucket_tokens = 1.5  # enough for a bare REST call, not for WS
    assert fhc.fh_ws_reconnect_allowed() is False
    # Confirm a REST call at the SAME token level would have succeeded —
    # proves the denial above is WS-specific, not just "bucket is empty".
    assert fhc._fh_take_token(reserve=0.0) is True


def test_ws_reconnect_allowed_when_bucket_has_full_reserve_headroom():
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN  # full bucket
    assert fhc.fh_ws_reconnect_allowed() is True


def test_rest_call_succeeds_exactly_where_ws_would_be_denied():
    """The core priority guarantee: at a token level that denies WS, a REST
    call (fh_take_token with reserve=0) still goes through."""
    # Just enough for ONE bare call (reserve=0) but short of WS's reserve.
    fhc._fh_bucket_tokens = 1.0 + (fhc._FH_WS_RESERVE_TOKENS / 2)
    assert fhc.fh_ws_reconnect_allowed() is False
    # The token was NOT spent by the denied WS check (only tiny elapsed-time
    # refill can move it, never a whole token down).
    assert fhc._fh_bucket_tokens > 1.0 + (fhc._FH_WS_RESERVE_TOKENS / 2) - 0.01
    assert fhc.fh_take_token(reserve=0.0) is True


def test_ws_denial_does_not_count_against_the_rest_throttle_signal():
    """calendar.py's `_build_enrichment_for_date` snapshots
    fh_budget_denied_total() before/after a fan-out to detect whether REST
    was genuinely throttled. A WS reconnect politely yielding on its OWN
    reserve requirement must not manufacture a false 'REST was throttled'
    signal — see finnhub_client.py's module docstring."""
    fhc._fh_bucket_tokens = 1.5  # denies WS (needs 1 + reserve), not REST
    before = fhc.fh_budget_denied_total()
    assert fhc.fh_ws_reconnect_allowed() is False
    assert fhc.fh_budget_denied_total() == before, (
        "a WS self-yield must not increment the REST-throttle-detection counter"
    )


def test_a_genuine_rest_denial_still_counts():
    """Sanity check the counter isn't broken globally — an ACTUAL REST denial
    (reserve=0, bucket empty) must still increment it."""
    fhc._fh_bucket_tokens = 0.0
    before = fhc.fh_budget_denied_total()
    assert fhc._fh_take_token(reserve=0.0) is False
    assert fhc.fh_budget_denied_total() == before + 1


# ── fh_ws_reconnect_allowed: shared cooldown ─────────────────────────────────

def test_ws_reconnect_denied_during_an_active_cooldown_even_with_a_full_bucket():
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc.fh_note_429("rest")
    assert fhc.fh_ws_reconnect_allowed() is False


def test_ws_reconnect_denial_during_cooldown_does_not_spend_a_token():
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc.fh_note_429("rest")
    before = fhc._fh_bucket_tokens
    fhc.fh_ws_reconnect_allowed()
    assert fhc._fh_bucket_tokens == before


# ── fh_note_429 / fh_in_cooldown: cross-source coordination ──────────────────

def test_rest_fh_get_is_denied_after_a_ws_side_429():
    """A WS handshake 429 (realtime_stream.py calling fh_note_429('ws')) must
    engage the SAME cooldown fh_get respects — REST backs off in step with a
    WS-triggered rate-limit signal, not just the other way round."""
    assert fhc.fh_in_cooldown() is False
    fhc.fh_note_429("ws")
    assert fhc.fh_in_cooldown() is True


def test_cooldown_expires_after_the_configured_window():
    fhc.fh_note_429("ws")
    # Simulate the window having elapsed.
    fhc._fh_cooldown_until = fhc._time.monotonic() - 1.0
    assert fhc.fh_in_cooldown() is False


def test_fh_get_itself_is_shed_during_a_ws_triggered_cooldown(monkeypatch):
    """End-to-end: fh_get (the REST path) respects a cooldown that was
    engaged by the WS side, without ever making a network call."""
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None):
        calls["n"] += 1
        raise AssertionError("a REST call escaped a WS-triggered cooldown")

    monkeypatch.setattr(fhc.requests, "get", fake_get)
    fhc.fh_note_429("ws-circuit-breaker")
    result = fhc.fh_get("/stock/earnings", {"symbol": "AAPL", "limit": 4})
    assert result is None
    assert calls["n"] == 0
