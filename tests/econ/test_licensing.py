"""licensing.production_eligible -- the clearance rail, with negative controls."""
from __future__ import annotations

import copy

import pytest

from api.services.econ import licensing as L
from api.services.econ import registry as R


def _e(cls="GREEN", clearance="cleared", approval=None, agency="U.S. Bureau of Labor Statistics",
       adapter="bls", status="enabled", url="https://data.bls.gov/", params=None):
    return {"symbol": "USTEST", "status": status,
            "source": {"agency": agency, "adapter": adapter, "dataset": "x", "official_url": url,
                       "provider_series_id": "X", "params": params or {}},
            "licensing": {"class": cls, "clearance": clearance, "approval_ref": approval}}


def test_green_cleared_is_eligible():
    assert L.production_eligible(_e()) == (True, "ok")


@pytest.mark.parametrize("entry,needle", [
    (_e(cls="RED", clearance="blocked"), "RED"),
    (_e(cls="RED", clearance="cleared"), "RED"),                      # RED even if someone marks it cleared
    (_e(cls="YELLOW", clearance="permission_pending"), "YELLOW requires permission_granted"),
    (_e(cls="YELLOW", clearance="cleared"), "YELLOW requires permission_granted"),
    (_e(cls="YELLOW", clearance="permission_granted", approval=None), "without an approval_ref"),
    (_e(cls="YELLOW", clearance="permission_granted", approval="  "), "without an approval_ref"),
    (_e(cls="GREEN", clearance="permission_pending"), "GREEN but clearance"),
    (_e(cls="GREEN", clearance="blocked"), "GREEN but clearance"),
    (_e(status="excluded"), "excluded"),
    (_e(cls="PURPLE"), "unknown licensing class"),
    (_e(clearance="sure"), "unknown clearance"),
])
def test_refusals(entry, needle):
    ok, why = L.production_eligible(entry)
    assert ok is False and needle in why, why


def test_yellow_with_written_permission_is_eligible():
    ok, why = L.production_eligible(_e(cls="YELLOW", clearance="permission_granted", approval="EMAIL-2026-10-02"))
    assert ok and "EMAIL-2026-10-02" in why


@pytest.mark.parametrize("field,value", [
    ("agency", "Federal Reserve Bank of St. Louis"),
    ("agency", "FRED"),
    ("agency", "ALFRED vintage archive"),
    ("agency", "FRED® via AlphaVantage"),
    ("adapter", "fred"),
    ("adapter", "fred_api"),
    ("adapter", "alfred"),
    ("official_url", "https://fred.stlouisfed.org/series/CPIAUCSL"),
    ("official_url", "https://api.stlouisfed.org/fred/series/observations"),
    ("provider_series_id", "FRED:CPIAUCSL"),
])
def test_fred_is_refused_regardless_of_other_fields(field, value):
    """REGRESSION RAIL: GREEN + cleared + enabled + approval ref, and still refused."""
    e = _e(cls="GREEN", clearance="permission_granted", approval="anything")
    e["source"][field] = value
    ok, why = L.production_eligible(e)
    assert ok is False and "FRED" in why and "fred.stlouisfed.org/legal" in why


def test_fred_in_params_is_refused():
    e = _e(params={"base_url": "https://api.stlouisfed.org/fred/series/observations"})
    assert L.production_eligible(e)[0] is False


def test_freddie_mac_is_not_mistaken_for_fred():
    """Control: the word rail must not catch Freddie Mac (a separate YELLOW publisher)."""
    e = _e(cls="YELLOW", clearance="permission_granted", approval="LIC-1", agency="Freddie Mac",
           adapter="freddie", url="https://www.freddiemac.com/pmms")
    assert L.is_fred_source(e) is False
    assert L.production_eligible(e)[0] is True
    assert L.is_fred_source(_e(agency="Federal Reserve Board", adapter="fed_ddp")) is False


def test_committed_registry_has_no_fred_source_and_enabled_all_eligible():
    for e in R.all():
        assert not L.is_fred_source(e), e["symbol"]
    for e in R.enabled():
        assert L.production_eligible(e)[0], e["symbol"]


def test_real_registry_entry_turned_into_fred_is_refused():
    e = copy.deepcopy(R.get("USCPI"))
    assert L.production_eligible(e)[0] is True        # control
    e["source"]["agency"] = "Federal Reserve Bank of St. Louis"
    assert L.production_eligible(e)[0] is False
