"""get_earnings_intel's price_target leg falls back to FMP when Finnhub can't
supply it.

Root cause (already diagnosed, not re-derived here): Finnhub's
`/stock/price-target` 403s plan-forbidden on this account — not transient,
simply unavailable on the current tier. Live basket check 2026-08-05: 19/20
symbols came back with a null price_target. FMP's `stable/price-target-
consensus` IS live on this plan (analyst_grades.py already calls it for a
different surface) and covers the same range data, so this is a wiring fix,
not a new integration.

Requirements this file locks in:
  1. Finnhub stays primary; FMP only fires when Finnhub yielded nothing.
  2. The emitted dict keeps the SAME field names/semantics as the Finnhub
     shape ({targetHigh, targetLow, targetMean, targetMedian, lastUpdated}).
     FMP has no analog for targetMean (its `targetConsensus` is a DIFFERENT
     statistic) or lastUpdated — those stay None, never fabricated.
  3. The partial-cache TTL logic (a6012522) must still hold: a price target
     newly supplied by FMP means that leg is no longer missing (full 6h TTL
     when the other two legs are also present); a symbol where FMP ALSO
     fails still gets the short failure TTL.
  4. The FMP call is a different provider — it must never touch Finnhub's
     token bucket (`_fh_take_token`) or cooldown (`_fh_cooldown_until`).
  5. The FMP call is bounded (never an unbounded call on the shared
     request-path threadpool) and never raises out of this call site.
  6. Absent vs a genuine 0.0 are distinguished in both directions.

D1 note: the FMP leg now routes through the shared `fmp_client` adapter.
Rather than mocking a raw HTTP layer, these tests mock the two `fmp_client`
typed functions this path touches directly
(`get_price_target_consensus` / `get_grades_consensus`) — `_fmp_rows`
(earnings_estimates.py's thin wrapper) is left REAL so its own
exception-catching/None-on-failure contract is actually exercised.
Per-call timeout bounding (old requirement 5) now lives inside `fmp_client`
itself (its own bounded `_DEFAULT_TIMEOUT`, verified independently in
test_fmp_client.py) rather than being threaded through from this call site.
"""
from unittest.mock import patch, MagicMock

import pytest

from api.services import earnings_estimates as ee
from api.services import finnhub_client as fhc
from api.services.cache import cache

SYM = "PTFALL"
KEY = f"earnings_intel_{SYM}"

_EARNINGS = [
    {"period": "2026-06-30", "actual": 8.17, "estimate": 6.25,
     "surprisePercent": 30.7, "quarter": 2, "year": 2026},
]
_REC = [{"period": "2026-08-01", "strongBuy": 5, "buy": 10, "hold": 3, "sell": 1, "strongSell": 0}]
_FH_PT_FULL = {"targetHigh": 500.0, "targetLow": 300.0, "targetMean": 420.0,
               "targetMedian": 415.0, "lastUpdated": "2026-08-01"}
# Real captured shape of financialmodelingprep.com/stable/price-target-consensus
# (mirrors PRICE_TARGET_CONSENSUS_FIXTURE in test_analyst_intel_fmp_shapes.py) —
# note there is NO field literally named "mean".
_FMP_PT_CONSENSUS = [
    {"symbol": SYM, "targetHigh": 480.0, "targetLow": 320.0,
     "targetConsensus": 410.0, "targetMedian": 405.0},
]


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else []

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"{self.status_code} error")

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = ee._time.monotonic()
    cache.invalidate(KEY)
    yield
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = ee._time.monotonic()
    cache.invalidate(KEY)


def _fh_responder(*, earnings_ok=True, rec_ok=True, pt_ok=True):
    """Fake for ee.requests.get — drives the real _fh_get/_fh_take_token path
    (unlike mocking _fh_get directly) so token-bucket accounting is real."""
    def fake_get(url, params=None, timeout=None):
        assert "financialmodelingprep.com" not in url, "Finnhub responder hit an FMP URL"
        if "/stock/earnings" in url:
            return _Resp(200, _EARNINGS) if earnings_ok else _Resp(500)
        if "recommendation" in url:
            return _Resp(200, _REC) if rec_ok else _Resp(500)
        if "price-target" in url:
            return _Resp(200, _FH_PT_FULL) if pt_ok else _Resp(500)
        return _Resp(500)
    return fake_get


def _fmp_result(value):
    from api.services import provider_errors as pe
    return pe.ProviderResult(
        value=value,
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"),
        licensing_class="R",
    )


def _fmp_not_found(ticker):
    raise ee.fmp_client.FMPNotFound("no data", vendor="fmp")


def _fmp_value_or_not_found(value):
    """A fmp_client-shaped fn: returns `value` wrapped as a ProviderResult,
    or raises FMPNotFound when `value` is falsy — the two states `_fmp_rows`
    both collapse to None, mirroring the retired `_fmp_get`'s "None on any
    failure" contract this file was originally written against."""
    def _fn(ticker):
        if not value:
            raise ee.fmp_client.FMPNotFound("no data", vendor="fmp")
        return _fmp_result(value)
    return _fn


def _mock_price_target(monkeypatch, value):
    monkeypatch.setattr(ee.fmp_client, "get_price_target_consensus", _fmp_value_or_not_found(value))


def _mock_consensus_rejects(monkeypatch):
    """The consensus leg (FMP-primary per Task 5) isn't this file's concern —
    make it fail cleanly so get_earnings_intel falls back to Finnhub for that
    leg without a real network call."""
    monkeypatch.setattr(ee.fmp_client, "get_grades_consensus", _fmp_not_found)


def _captured_ttl(monkeypatch):
    """Run get_earnings_intel and return (result, ttl_it_cached_with)."""
    seen = {}
    real_set = cache.set

    def spy(key, value, ttl=None, **kw):
        if key == KEY:
            seen["ttl"] = ttl
            seen["value"] = value
        return real_set(key, value, ttl, **kw) if ttl is not None else real_set(key, value, **kw)

    monkeypatch.setattr(cache, "set", spy)
    result = ee.get_earnings_intel(SYM)
    return result, seen.get("ttl")


# ── Requirement 1: Finnhub stays primary ────────────────────────────────────

def test_finnhub_success_short_circuits_fmp(monkeypatch):
    """When Finnhub supplies a full price target, FMP's price-target-consensus
    leg is never called at all. (The consensus leg is FMP-primary as of P2
    Task 5 and legitimately fires its own `stable/grades-consensus` call
    regardless of the price-target outcome — this test only locks in the
    price-target leg's own Finnhub-primary/FMP-fallback ordering.)"""
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=True))
    _mock_consensus_rejects(monkeypatch)
    pt_spy = MagicMock(side_effect=_fmp_not_found)
    monkeypatch.setattr(ee.fmp_client, "get_price_target_consensus", pt_spy)

    result = ee.get_earnings_intel(SYM)

    assert pt_spy.call_count == 0
    assert result["price_target"] == {
        "targetHigh": 500.0, "targetLow": 300.0, "targetMean": 420.0,
        "targetMedian": 415.0, "lastUpdated": "2026-08-01",
    }


# ── Requirement 2: fallback fires, keeps the SAME shape, never fabricates ──

def test_finnhub_yields_nothing_falls_back_to_fmp_consensus_endpoint(monkeypatch):
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    pt_spy = MagicMock(side_effect=_fmp_value_or_not_found(_FMP_PT_CONSENSUS))
    monkeypatch.setattr(ee.fmp_client, "get_price_target_consensus", pt_spy)

    result = ee.get_earnings_intel(SYM)

    assert pt_spy.call_count == 1
    assert pt_spy.call_args.args[0] == SYM

    pt = result["price_target"]
    assert pt is not None
    assert pt["targetHigh"] == 480.0
    assert pt["targetLow"] == 320.0
    assert pt["targetMedian"] == 405.0


def test_fmp_fallback_never_fabricates_target_mean_from_consensus_field(monkeypatch):
    """FMP's `targetConsensus` (410.0 in the fixture) is a DIFFERENT statistic
    from Finnhub's `targetMean` — it must never be smuggled in under that
    name. lastUpdated is likewise unavailable from this FMP endpoint."""
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, _FMP_PT_CONSENSUS)
    result = ee.get_earnings_intel(SYM)
    pt = result["price_target"]
    assert pt["targetMean"] is None
    assert pt["targetMean"] != 410.0  # the targetConsensus value, explicitly rejected
    assert pt["lastUpdated"] is None


def test_fmp_fallback_keeps_all_five_keys_of_the_finnhub_shape(monkeypatch):
    """Downstream consumers (OverviewTab.jsx, voice_market_tools.py) key off
    these exact field names — the fallback must never change the shape."""
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, _FMP_PT_CONSENSUS)
    result = ee.get_earnings_intel(SYM)
    assert set(result["price_target"].keys()) == {
        "targetHigh", "targetLow", "targetMean", "targetMedian", "lastUpdated",
    }


# ── Requirement 6: absent vs a genuine 0.0, both directions ────────────────

def test_fmp_fallback_preserves_a_genuine_zero_target(monkeypatch):
    row = [{"symbol": SYM, "targetHigh": 0.0, "targetLow": 0.0, "targetMedian": 50.0}]
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, row)
    result = ee.get_earnings_intel(SYM)
    pt = result["price_target"]
    # a real 0.0 must survive as 0.0, not collapse to None
    assert pt["targetHigh"] is not None
    assert pt["targetHigh"] == 0.0
    assert pt["targetLow"] == 0.0


def test_fmp_fallback_treats_an_absent_field_as_none_not_zero(monkeypatch):
    row = [{"symbol": SYM, "targetHigh": 480.0, "targetMedian": 405.0}]  # targetLow absent
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, row)
    result = ee.get_earnings_intel(SYM)
    pt = result["price_target"]
    assert pt["targetLow"] is None
    assert pt["targetLow"] != 0  # Number(null) === 0 trap — assert BOTH directions


def test_fmp_fallback_returns_none_when_row_has_no_usable_numeric_field(monkeypatch):
    """An FMP row that resolves but carries no numeric target data must not
    become a fake all-None dict — it has to stay None so `partial` still
    treats the leg as genuinely missing."""
    row = [{"symbol": SYM}]
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, row)
    result = ee.get_earnings_intel(SYM)
    assert result["price_target"] is None


# ── Requirement 3: partial-cache TTL logic still reflects reality ──────────

def test_price_target_filled_by_fmp_is_no_longer_partial_gets_full_ttl(monkeypatch):
    """beat_history + consensus resolve via Finnhub; price_target resolves via
    the FMP fallback. That leg is no longer missing, so the FULL 6h TTL
    applies, same as if Finnhub itself had answered it."""
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, _FMP_PT_CONSENSUS)
    result, ttl = _captured_ttl(monkeypatch)
    assert len(result["beat_history"]) == 1
    assert result["consensus"] is not None
    assert result["price_target"] is not None
    assert ttl == ee._CACHE_TTL
    assert ttl > ee._INTEL_FAIL_TTL


def test_price_target_still_missing_when_fmp_also_fails_keeps_short_ttl(monkeypatch):
    """The other two legs still resolve, but BOTH Finnhub and FMP fail the
    price-target leg — it must still be treated as missing (short TTL), not
    silently promoted to 'complete' just because a fallback was attempted."""
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, None)
    result, ttl = _captured_ttl(monkeypatch)
    assert len(result["beat_history"]) == 1
    assert result["consensus"] is not None
    assert result["price_target"] is None
    assert ttl == ee._INTEL_FAIL_TTL
    assert ttl < ee._CACHE_TTL


def test_all_legs_failing_including_fmp_still_negative_caches(monkeypatch):
    """The pre-existing 429-storm damper (all-three-fail -> negative cache ->
    return None) must survive the fallback wiring end-to-end, with a REAL
    (non-empty) FMP_API_KEY in play rather than relying on the key being unset."""
    monkeypatch.setattr(
        ee.requests, "get",
        _fh_responder(earnings_ok=False, rec_ok=False, pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, None)
    result, ttl = _captured_ttl(monkeypatch)
    assert result is None
    assert ttl == ee._INTEL_FAIL_TTL


# ── Requirement 4: FMP is a different provider — never routed through the
#    Finnhub token bucket or cooldown ─────────────────────────────────────

def test_fmp_fallback_succeeds_despite_an_active_finnhub_cooldown(monkeypatch):
    """Simulate a live 20s Finnhub cooldown (as set by a real 429 in _fh_get)
    — every _fh_get call sheds instantly, so beat_history/consensus/the
    Finnhub price-target leg all come back empty. If the FMP call were
    gated by the SAME cooldown it would also come back empty; it must not be."""
    fhc._fh_cooldown_until = ee._time.monotonic() + 100.0  # far in the future
    calls = []

    def fh_should_not_fire(url, params=None, timeout=None):
        if "financialmodelingprep.com" in url:
            # get_earnings_intel's beat_history leg (earnings_history_fmp.
            # fmp_beat_history, out of this file's migration scope) still
            # resolves the legacy `ee._fmp_get` at call time and legitimately
            # probes FMP here — not a Finnhub call, so not what this guard
            # is watching for.
            return _Resp(200, [])
        calls.append(url)
        raise AssertionError("a Finnhub HTTP call escaped the active cooldown")

    monkeypatch.setattr(ee.requests, "get", fh_should_not_fire)
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, _FMP_PT_CONSENSUS)

    result = ee.get_earnings_intel(SYM)

    assert calls == []  # confirms the cooldown really did shed every Finnhub call
    assert result["beat_history"] == []
    assert result["consensus"] is None
    assert result["price_target"] is not None
    assert result["price_target"]["targetHigh"] == 480.0


def test_fmp_fallback_succeeds_despite_an_exhausted_finnhub_token_bucket(monkeypatch):
    """Same idea with the PROACTIVE token bucket instead of the reactive
    cooldown: drain it to zero so every _fh_get call is shed by
    _fh_take_token, and confirm the FMP fallback is unaffected."""
    fhc._fh_bucket_tokens = 0.0
    fhc._fh_bucket_updated = ee._time.monotonic()
    calls = []

    def fh_should_not_fire(url, params=None, timeout=None):
        if "financialmodelingprep.com" in url:
            # See the matching comment in the cooldown test above.
            return _Resp(200, [])
        calls.append(url)
        raise AssertionError("a Finnhub HTTP call escaped the exhausted token bucket")

    monkeypatch.setattr(ee.requests, "get", fh_should_not_fire)
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, _FMP_PT_CONSENSUS)

    result = ee.get_earnings_intel(SYM)

    assert calls == []
    assert result["price_target"] is not None
    assert result["price_target"]["targetMedian"] == 405.0


def test_fmp_call_never_consumes_a_finnhub_bucket_token(monkeypatch):
    """End-to-end token accounting: 3 real Finnhub HTTP legs are attempted
    (earnings, recommendation, price-target — the last one empty), and the
    FMP fallback runs on top. Exactly 3 tokens should be spent, not 4."""
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=False))
    _mock_consensus_rejects(monkeypatch)
    _mock_price_target(monkeypatch, _FMP_PT_CONSENSUS)

    before = fhc._fh_bucket_tokens
    ee.get_earnings_intel(SYM)
    after = fhc._fh_bucket_tokens

    assert abs((before - after) - 3.0) < 0.05


# ── Requirement 5: the FMP call is bounded and never raises out of this
#    call site (bounding itself now lives inside fmp_client — see module
#    docstring) ───────────────────────────────────────────────────────────

def test_fmp_price_target_fallback_never_raises_even_if_fmp_client_does(monkeypatch):
    """Per-call timeout bounding now lives inside `fmp_client` itself (its
    own bounded `_DEFAULT_TIMEOUT`, verified independently in
    test_fmp_client.py) rather than being threaded through from this call
    site. What this call site still owns is never letting a raised
    ProviderError escape — `_fmp_rows` catches everything and returns None."""
    def boom(ticker):
        raise ee.fmp_client.FMPTransient("simulated timeout", vendor="fmp")

    monkeypatch.setattr(ee.fmp_client, "get_price_target_consensus", boom)
    assert ee._fmp_price_target_fallback(SYM) is None
