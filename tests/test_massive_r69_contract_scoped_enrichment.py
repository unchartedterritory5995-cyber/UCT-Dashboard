"""R69 (D-21): the /flow card's OI+mark enrichment used to walk the WHOLE
options chain (fetch_chain_price_oi, up to 40 pages / 10,000 contracts) to
read ~10-20 known contract keys out of it on every card render.

fetch_price_oi_for_contracts() replaces that call site with the already-
production per-contract snapshot mechanism (_fetch_contract_fields_blocking,
built 2026-07-20 for schwab_router.py), scoped to just the contracts the
caller actually asks about, with a <=60s per-contract cache (R69's own rail:
"a mark older than 60s is never served as live").
"""
import time

import pytest

from api import massive_oi_snapshots as mos


@pytest.fixture(autouse=True)
def _clear_fields_cache():
    mos._FIELDS_CACHE.clear()
    yield
    mos._FIELDS_CACHE.clear()


def _fields(oi=10, mid=1.0, last=1.0):
    return {"oi": oi, "mid": mid, "last": last, "underlying": None,
            "iv": None, "delta": None, "gamma": None, "theta": None}


def test_resolves_oi_and_price_for_the_requested_contracts_only(monkeypatch):
    calls = []

    def _fake(underlying, occ):
        calls.append((underlying, occ))
        return _fields(oi=1234, mid=2.5)

    monkeypatch.setattr(mos, "_fetch_contract_fields_blocking", _fake)

    def _boom(ticker):
        raise AssertionError("must not walk the full chain")

    monkeypatch.setattr(mos, "_fetch_chain_blocking", _boom)

    contracts = [
        {"cp": "C", "strike": 192.5, "exp": "8/7/2026"},
        {"cp": "PUT", "strike": 100.0, "exp": "12/18/2026"},
    ]
    result = mos.fetch_price_oi_for_contracts("QCOM", contracts)

    assert len(calls) == 2
    assert set(result.keys()) == {
        ("C", 192.5, "8/7/2026"),
        ("P", 100.0, "12/18/2026"),
    }
    for v in result.values():
        assert v == {"oi": 1234, "price": 2.5}


def test_price_falls_back_to_last_when_no_midpoint(monkeypatch):
    monkeypatch.setattr(
        mos, "_fetch_contract_fields_blocking",
        lambda u, o: {"oi": 42, "mid": None, "last": 7.5, "underlying": None,
                      "iv": None, "delta": None, "gamma": None, "theta": None},
    )

    result = mos.fetch_price_oi_for_contracts(
        "QCOM", [{"cp": "C", "strike": 50.0, "exp": "1/16/2027"}]
    )
    assert result[("C", 50.0, "1/16/2027")]["price"] == 7.5


def test_a_contract_the_endpoint_cannot_resolve_is_simply_absent(monkeypatch):
    monkeypatch.setattr(mos, "_fetch_contract_fields_blocking", lambda u, o: None)

    result = mos.fetch_price_oi_for_contracts(
        "QCOM", [{"cp": "C", "strike": 999.0, "exp": "8/7/2026"}]
    )
    assert result == {}


def test_empty_contract_list_returns_empty_without_any_network_call(monkeypatch):
    def _boom(u, o):
        raise AssertionError("must not be called for an empty contract list")

    monkeypatch.setattr(mos, "_fetch_contract_fields_blocking", _boom)

    assert mos.fetch_price_oi_for_contracts("QCOM", []) == {}


def test_cache_hit_within_ttl_avoids_a_second_fetch(monkeypatch):
    calls = []

    def _fake(underlying, occ):
        calls.append((underlying, occ))
        return _fields()

    monkeypatch.setattr(mos, "_fetch_contract_fields_blocking", _fake)

    contracts = [{"cp": "C", "strike": 10.0, "exp": "1/1/2027"}]
    mos.fetch_price_oi_for_contracts("AAPL", contracts)
    mos.fetch_price_oi_for_contracts("AAPL", contracts)

    assert len(calls) == 1, "a second call inside the TTL window must reuse the cache"


def test_cache_expires_past_the_ttl(monkeypatch):
    calls = []

    def _fake(underlying, occ):
        calls.append((underlying, occ))
        return _fields()

    monkeypatch.setattr(mos, "_fetch_contract_fields_blocking", _fake)
    monkeypatch.setattr(mos, "FIELDS_CACHE_TTL_SEC", 0.01)

    contracts = [{"cp": "C", "strike": 10.0, "exp": "1/1/2027"}]
    mos.fetch_price_oi_for_contracts("AAPL", contracts)
    time.sleep(0.05)
    mos.fetch_price_oi_for_contracts("AAPL", contracts)

    assert len(calls) == 2, "a mark older than the TTL must never be served as live"


def test_returned_key_format_matches_the_enrich_lookup_shape(monkeypatch):
    """live_massive_router._enrich() looks up (cp_letter, float_strike,
    canon_mdy(exp)) against this function's return value — the key format
    must match exactly, including leading-zero and lowercase-cp input."""
    monkeypatch.setattr(
        mos, "_fetch_contract_fields_blocking",
        lambda u, o: _fields(oi=5, mid=1.0),
    )
    result = mos.fetch_price_oi_for_contracts(
        "QCOM", [{"cp": "call", "strike": "192.50", "exp": "08/07/2026"}]
    )
    assert ("C", 192.5, "8/7/2026") in result


def test_lowercase_underlying_symbol_still_resolves(monkeypatch):
    """_fetch_fields_all_async uppercases `sym` internally when building its
    output keys; a lowercase sym here must not silently mismatch that and
    return nothing."""
    monkeypatch.setattr(
        mos, "_fetch_contract_fields_blocking",
        lambda u, o: _fields(oi=7, mid=3.0),
    )
    result = mos.fetch_price_oi_for_contracts(
        "qcom", [{"cp": "C", "strike": 10.0, "exp": "1/1/2027"}]
    )
    assert result == {("C", 10.0, "1/1/2027"): {"oi": 7, "price": 3.0}}
