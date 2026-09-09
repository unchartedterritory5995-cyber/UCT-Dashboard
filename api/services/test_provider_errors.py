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


# ── D1 provenance/freshness hardening (2026-09-02) ──────────────────────────

def test_auth_error_403_is_classified_as_entitlement_denied():
    fmp = pe.make_vendor_errors("fmp", class_prefix="FMP")
    err = fmp.auth_error("rejected", status=403)
    assert err.entitlement_denied is True


def test_auth_error_401_is_classified_as_not_entitlement_denied():
    massive = pe.make_vendor_errors("massive")
    err = massive.auth_error("rejected", status=401)
    assert err.entitlement_denied is False


def test_auth_error_with_no_recognized_status_is_unknown_not_guessed():
    fmp = pe.make_vendor_errors("fmp", class_prefix="FMP")
    err = fmp.auth_error("rejected")  # no status kwarg at all
    assert err.entitlement_denied is None


def test_freshness_from_observed_age_returns_normal_when_no_timestamp_evidence():
    assert pe.freshness_from_observed_age(None, normal="real_time") == "real_time"
    assert pe.freshness_from_observed_age(None, normal="delayed_15") == "delayed_15"


def test_freshness_from_observed_age_returns_normal_when_recent():
    now = 2_000_000_000.0
    recent = now - 300  # 5 minutes old
    assert pe.freshness_from_observed_age(recent, normal="real_time", now=now) == "real_time"


def test_freshness_from_observed_age_returns_stale_past_the_threshold():
    now = 2_000_000_000.0
    old = now - pe.STALE_AFTER_SECONDS - 1
    assert pe.freshness_from_observed_age(old, normal="real_time", now=now) == "stale"
    assert pe.freshness_from_observed_age(old, normal="delayed_15", now=now) == "stale"


def test_freshness_from_observed_age_does_not_flip_at_a_normal_weekend_gap():
    """A Friday-close-to-Monday-reopen gap (under 3.5 days) must never
    read as stale -- that would be exactly the false-equivalence class
    this hardening pass exists to prevent (a closed market misread as a
    dead symbol)."""
    now = 2_000_000_000.0
    weekend_old = now - (3.5 * 86_400)
    assert pe.freshness_from_observed_age(weekend_old, normal="real_time", now=now) == "real_time"


def test_provenance_record_source_observed_at_defaults_to_none():
    prov = pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_quote")
    assert prov.source_observed_at is None


def test_provider_result_to_dict_is_json_safe_and_complete():
    prov = pe.ProvenanceRecord(
        vendor="massive", source_activity="massive.get_quote",
        fetched_at=111.0, source_observed_at=100.0, tie_break="entity_master",
    )
    result = pe.ProviderResult(
        value={"c": 230.0}, provenance=prov, licensing_class="R", freshness="real_time",
    )
    d = result.to_dict()
    assert d == {
        "value": {"c": 230.0},
        "provenance": {
            "vendor": "massive",
            "source_activity": "massive.get_quote",
            "fetched_at": 111.0,
            "tie_break": "entity_master",
            "source_observed_at": 100.0,
        },
        "licensing_class": "R",
        "freshness": "real_time",
        "degraded": None,
        "degraded_since": None,
    }
    import json
    json.dumps(d)  # must not raise -- genuinely JSON-safe


def test_freshness_none_means_unknown_and_stale_is_a_distinct_literal():
    """Both states this hardening pass formalized must never collapse into
    each other: None ("not established") and "stale" ("established as
    old") are different facts about a result."""
    prov = pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_quote")
    unknown = pe.ProviderResult(value={}, provenance=prov, licensing_class="R", freshness=None)
    stale = pe.ProviderResult(value={}, provenance=prov, licensing_class="R", freshness="stale")
    assert unknown.freshness is not stale.freshness
    assert unknown.freshness is None
    assert stale.freshness == "stale"
