"""D1 — tests for the shared error taxonomy and result envelope."""
import pytest

from api.services import provider_errors as pe


def test_make_vendor_errors_produces_distinct_classes_per_vendor():
    fmp = pe.make_vendor_errors("fmp", class_prefix="FMP")
    massive = pe.make_vendor_errors("massive")
    assert fmp.RateLimited is not massive.RateLimited
    assert not issubclass(fmp.RateLimited, massive.RateLimited)
    assert not issubclass(massive.RateLimited, fmp.RateLimited)
    assert fmp.RateLimited.__name__ == "FMPRateLimited"
    assert massive.RateLimited.__name__ == "MassiveRateLimited"


def test_vendor_specific_except_does_not_catch_a_different_vendor():
    fmp = pe.make_vendor_errors("fmp", class_prefix="FMP")
    massive = pe.make_vendor_errors("massive")
    with pytest.raises(pe.ProviderError):
        try:
            raise massive.rate_limited("massive throttled")
        except fmp.RateLimited:
            pytest.fail("a Massive error must never be caught by an FMP-specific except clause")


def test_generic_provider_error_catches_any_vendor_and_exposes_vendor_field():
    fmp = pe.make_vendor_errors("fmp")
    try:
        raise fmp.not_found("no data for XYZ")
    except pe.ProviderError as e:
        assert e.vendor == "fmp"
        assert isinstance(e, pe.ProviderNotFound)


def test_rate_limited_carries_retry_after():
    massive = pe.make_vendor_errors("massive")
    err = massive.rate_limited("throttled", retry_after=12.5, status=429)
    assert err.retry_after == 12.5
    assert err.status == 429
    assert err.vendor == "massive"


def test_all_five_leaf_classes_exist_and_subclass_correctly():
    fam = pe.make_vendor_errors("fmp")
    assert issubclass(fam.NotConfigured, pe.ProviderNotConfigured)
    assert issubclass(fam.AuthError, pe.ProviderAuthError)
    assert issubclass(fam.RateLimited, pe.ProviderRateLimited)
    assert issubclass(fam.Transient, pe.ProviderTransient)
    assert issubclass(fam.NotFound, pe.ProviderNotFound)
    for ctor_name, base in (
        ("not_configured", pe.ProviderNotConfigured), ("auth_error", pe.ProviderAuthError),
        ("rate_limited", pe.ProviderRateLimited), ("transient", pe.ProviderTransient),
        ("not_found", pe.ProviderNotFound),
    ):
        err = getattr(fam, ctor_name)("msg")
        assert isinstance(err, base)
        assert err.vendor == "fmp"


def test_provider_result_requires_provenance_and_licensing_class():
    prov = pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_key_metrics_ttm")
    result = pe.ProviderResult(value={"pe": 30}, provenance=prov, licensing_class="R")
    assert result.value == {"pe": 30}
    assert result.provenance.vendor == "fmp"
    assert result.freshness is None
    assert result.degraded is None


def test_degraded_states_are_distinguishable_from_each_other_and_from_none():
    prov = pe.ProvenanceRecord(vendor="massive", source_activity="massive_client.get_movers")
    genuine = pe.ProviderResult(value=[], provenance=prov, licensing_class="R")
    cached_forbidden = pe.ProviderResult(
        value=None, provenance=prov, licensing_class="R",
        degraded="cached_forbidden", degraded_since=1234567890.0,
    )
    circuit_open = pe.ProviderResult(value=None, provenance=prov, licensing_class="R", degraded="circuit_open")
    assert genuine.degraded is None
    assert cached_forbidden.degraded == "cached_forbidden"
    assert cached_forbidden.degraded_since == 1234567890.0
    assert circuit_open.degraded == "circuit_open"
    # The three are mutually distinguishable — no two collapse to the same signature.
    signatures = {genuine.degraded, cached_forbidden.degraded, circuit_open.degraded}
    assert len(signatures) == 3
