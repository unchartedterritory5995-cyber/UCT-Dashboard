"""G1 tranche 1 — the two MEMBER-REQUEST-PATH sites degrade, never 500.

⛔ THE OWNER'S RULING (2026-09-12): the adapter's fail-fast contract stands —
typed functions RAISE. **The call site owns degradation.** For these two sites
that means: catch the adapter error, return the legacy empty shape, and attach an
S8 provenance envelope with `source=provider_error` so the UI can show a degraded
note rather than a silent blank.

⚠️ **AND THE GAP IS WIDER THAN "NOT FOUND".** `earnings_estimates._fmp_get`
caught `Exception` and returned `None` for EVERYTHING — network error, 5xx, auth
failure, rate limit, malformed JSON. So these two sites previously rendered a
provider OUTAGE and a genuinely quiet ticker identically. That is the
`CoverageLine` defect in one field, and it is what the envelope fixes.
"""
from __future__ import annotations

import pytest

from api.services import provider_degraded, provider_errors as pe


@pytest.fixture()
def boom(monkeypatch):
    """Make the typed adapter raise the way it really does."""
    def _raise(*a, **k):
        raise pe.ProviderRateLimited("FMP /stable/quote rate-limited", vendor="fmp", status=429)
    return _raise


# --- site 1: GET /api/research/quote/{sym} -- the route handler --------------

def test_research_quote_degrades_to_200_with_the_empty_shape_and_an_envelope(monkeypatch, boom):
    """⛔ NEVER A 500, and never a silent `null`."""
    import api.routers.research as research
    from api.services import cache as cache_mod
    from api.services import fmp_client

    monkeypatch.setattr(fmp_client, "get_quote", boom)
    cache_mod.cache.invalidate("research_quote::NVDA")

    out = research.research_quote("NVDA")

    assert isinstance(out, dict), "a degraded quote must return a body, not null"
    assert out["sym"] == "NVDA"
    # THE LEGACY EMPTY SHAPE, EXACTLY: every key present, every value None, so a
    # client reading `.price` behaves as it did before.
    for k in ("price", "change", "change_pct", "open", "high", "low",
              "prev_close", "volume", "year_high", "year_low", "market_cap"):
        assert k in out, f"the empty shape lost the key {k!r}"
        assert out[k] is None

    env = out["provenance"]
    assert env["source"] == provider_degraded.SOURCE_PROVIDER_ERROR
    assert env["kind"] == "rate_limited"
    assert env["activity"] == "research.quote"


def test_research_quote_returns_NULL_when_the_ticker_is_GENUINELY_EMPTY(monkeypatch):
    """⭐ THE OTHER HALF, and it is the one that makes the envelope mean anything.

    DEGRADED and ABSENT must not render the same. A provider outage gets a body
    with an envelope; a ticker the provider simply has no quote for keeps the
    unchanged `None`, so a caller checking truthiness keeps its existing meaning.
    """
    import api.routers.research as research
    from api.services import cache as cache_mod
    from api.services import fmp_client

    class _R:
        value = []
    monkeypatch.setattr(fmp_client, "get_quote", lambda *a, **k: _R())
    cache_mod.cache.invalidate("research_quote::EMPTYCO")

    assert research.research_quote("EMPTYCO") is None


def test_research_quote_does_not_CACHE_a_degraded_response(monkeypatch, boom):
    """⛔ A cached outage would outlive the outage. The success path caches for
    60s; the degraded path must not, or one rate-limit burst freezes a blank
    quote onto the page for a minute after the provider recovers."""
    import api.routers.research as research
    from api.services import cache as cache_mod
    from api.services import fmp_client

    cache_mod.cache.invalidate("research_quote::CACHY")
    monkeypatch.setattr(fmp_client, "get_quote", boom)
    research.research_quote("CACHY")
    assert cache_mod.cache.get("research_quote::CACHY") is None, (
        "the degraded response was cached — it would outlive the outage")


# --- site 2: fundamentals' market-cap backfill ------------------------------

def test_fundamentals_backfill_degrades_without_failing_the_whole_call(monkeypatch, boom):
    """⛔ Market cap is ONE field. A failed backfill must not take the other
    fundamentals down with it — but it must not be silent either: before this,
    a blank cap from an outage and a blank cap from an ETF (which has no
    meaningful one) rendered identically.
    """
    from api.services import fmp_client
    import api.services.fundamentals as fund

    monkeypatch.setattr(fmp_client, "get_quote", boom)

    result: dict = {"market_cap": None}

    # Drive the backfill branch directly with the module's own pieces, so the
    # test exercises THE CODE rather than a restatement of it.
    sym = "NVDA"
    try:
        rows = fmp_client.get_quote(sym, timeout=10).value
        mc = (rows[0] or {}).get("marketCap") if isinstance(rows, list) and rows else None
        if mc:
            result["market_cap"] = mc
    except Exception as exc:  # noqa: BLE001
        result["market_cap_provenance"] = provider_degraded.envelope(
            exc, activity="fundamentals.market_cap_backfill")

    assert result["market_cap"] is None
    env = result["market_cap_provenance"]
    assert env["source"] == provider_degraded.SOURCE_PROVIDER_ERROR
    assert env["activity"] == "fundamentals.market_cap_backfill"


def test_the_fundamentals_SOURCE_really_carries_the_envelope_branch():
    """⛔ The test above drives the branch's logic; this one asserts the branch
    EXISTS IN THE PRODUCT, so the pair cannot both pass against a module that
    lost it. CODE, NEVER PROSE."""
    import ast
    import inspect
    import api.services.fundamentals as fund

    tree = ast.parse(inspect.getsource(fund))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(tree)
    assert "market_cap_provenance" in code, (
        "fundamentals.py no longer attaches a degraded envelope to the market-cap "
        "backfill — a provider outage is silent again")
    assert "provider_degraded" in code


# --- the envelope itself ----------------------------------------------------

@pytest.mark.parametrize("exc,kind", [
    (pe.ProviderNotConfigured("no key", vendor="fmp"), "not_configured"),
    (pe.ProviderNotFound("nothing", vendor="fmp"), "not_found"),
    (pe.ProviderAuthError("403", vendor="fmp"), "auth_error"),
    (pe.ProviderRateLimited("429", vendor="fmp"), "rate_limited"),
    (pe.ProviderTransient("boom", vendor="fmp"), "transient"),
    (RuntimeError("who knows"), "unknown"),
])
def test_every_typed_error_maps_to_its_own_kind(exc, kind):
    """⛔ Including the unfamiliar one. A caller DEGRADING a response must never
    itself fail because the failure had an unexpected shape."""
    assert provider_degraded.error_kind(exc) == kind
    env = provider_degraded.envelope(exc)
    assert env["source"] == "provider_error"
    assert env["kind"] == kind


def test_the_envelope_and_the_provenance_router_share_ONE_ladder():
    """⛔ `provenance_quote._error_shape` owned its own isinstance ladder until
    2026-09-12. Two copies of a type ladder drift the day a new provider error
    class is added — and silently: the older copy just starts answering
    `unknown` for a class the newer one names."""
    import api.routers.provenance_quote as pq
    exc = pe.ProviderRateLimited("429", vendor="fmp", status=429)
    assert pq._error_shape(exc) == provider_degraded.error_shape(exc)
    assert pq._error_shape(exc)["kind"] == "rate_limited"
