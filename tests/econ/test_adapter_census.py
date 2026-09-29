"""Census adapter: econ_export CSV (keyless) + EITS API (keyed).

Fixtures (tests/econ/fixtures/census/):
  export_<PROGRAM>_<cat>_<dt>.csv  REAL census.gov/econ_export CSVs fetched 2026-09-29
                                   (full history; trailing NA placeholders included)
  missing_key.html                 REAL api.census.gov missing-key page (Phase 0 proof)
  eits_marts_synth.json            SYNTHESISED EITS JSON (no key available locally)
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import pytest

from api.services.econ import adapters, registry
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.adapters.census import CensusAdapter, parse_period, parse_value
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

from .test_secrets import KEYS, assert_no_leak

FX = Path(__file__).parent / "fixtures" / "census"
TODAY = date(2026, 9, 28)


def fx(name):
    return (FX / name).read_bytes()


def entry(symbol, program, cat, dt, seasonal="SA", history_start="1992-01", **extra):
    params = {"program": program, "category": cat, "data_type": dt, "seasonal": seasonal, **extra}
    return {"symbol": symbol, "frequency": "M", "history_start": history_start,
            "source": {"adapter": "census", "provider_series_id": f"{program}/{cat}/{dt}",
                       "params": params}}


RETAIL = SeriesSpec(entry("USRETAIL", "marts", "44X72", "SM", recent_flags=["a", "p"]))
STARTS = SeriesSpec(entry("USHOUST", "resconst", "ASTARTS", "TOTAL", history_start="1959-01"))
DURG = SeriesSpec(entry("USDURGOODS", "m3", "MDM", "NO", history_start="1992-02", advance_program="advm3"))
TRADE = SeriesSpec(entry("USTRADEBAL", "ftd", "BOPGS", "BAL"))


class FakeResp:
    def __init__(self, status=200, headers=None, content=b""):
        self.status_code, self.headers, self.content = status, headers or {}, content


class Transport:
    def __init__(self, route):
        self.route = route            # callable(req) -> FakeResp
        self.requests = []

    def __call__(self, req):
        self.requests.append(req)
        return self.route(req)


def q(req):
    return parse_qsl(urlsplit(req.url).query, keep_blank_values=True)


def export_route(req):
    params = dict(q(req))
    name = f"export_{params['program']}_{params['categories[]']}_{params['dataType']}.csv"
    return FakeResp(200, {"Content-Type": "text/csv;charset=UTF-8",
                          "Last-Modified": "Tue, 29 Sep 2026 01:51:32 GMT"}, fx(name))


def client(route):
    t = Transport(route)
    return HttpClient(transport=t, sleep=lambda s: None, default_interval=0, max_retries=1), t


@pytest.fixture
def keyless(monkeypatch):
    monkeypatch.delenv("CENSUS_API_KEY", raising=False)
    return CensusAdapter(today=lambda: TODAY)


@pytest.fixture
def keyed(monkeypatch):
    for k, v in KEYS.items():
        monkeypatch.setenv(k, v)
    return CensusAdapter(today=lambda: TODAY)


# --------------------------------------------------------------------------- grammar

def test_period_and_value_grammar():
    assert parse_period("Aug-2026") == (date(2026, 8, 1), date(2026, 8, 31))
    assert parse_period("Feb-2024") == (date(2024, 2, 1), date(2024, 2, 29))
    assert parse_period("2026-08") == (date(2026, 8, 1), date(2026, 8, 31))
    for bad in ("Q3-2026", "Foo-2026", "2026M08", ""):
        with pytest.raises(ValueError):
            parse_period(bad)
    assert parse_value("737763") == 737763.0 and parse_value("-88,576") == -88576.0
    for na in ("NA", "(S)", "(NA)", "(X)", "(D)", "(Z)", "", None):
        assert parse_value(na) is None
    with pytest.raises(ValueError):
        parse_value("n/a?")


# --------------------------------------------------------------------------- keyless

def test_keyless_request_construction(keyless):
    http, t = client(export_route)
    (r,) = keyless.fetch([RETAIL], mode="history", start=None, end=None, http=http)
    req = t.requests[0]
    assert req.url.startswith("https://www.census.gov/econ_export/?")
    p = q(req)
    d = dict(p)
    assert (d["program"], d["categories[]"], d["dataType"], d["geoLevel"]) == ("MARTS", "44X72", "SM", "US")
    assert (d["startYear"], d["endYear"], d["format"]) == ("1992", "2026", "csv")
    assert d["adjusted"] == "1"
    # unchecked boxes are OMITTED: notAdjusted=0 / errorData=0 would switch the export
    assert "notAdjusted" not in d and "errorData" not in d
    assert r.request_key == "census:export:MARTS:44X72:SM:SA:1992-2026"
    assert r.source_published_at is None and not r.not_modified


def test_keyless_nsa_request(keyless):
    e = entry("USX", "marts", "44X72", "SM", seasonal="NSA")
    http, t = client(lambda req: FakeResp(200, {}, fx("export_MARTS_44X72_SM.csv").replace(
        b"Seasonally Adjusted Sales", b"Not Seasonally Adjusted Sales")))
    keyless.fetch([SeriesSpec(e)], mode="history", start=None, end=None, http=http)
    d = dict(q(t.requests[0]))
    assert d["notAdjusted"] == "1" and "adjusted" not in d


def test_retail_real_fixture_flags_and_trim(keyless):
    http, _ = client(export_route)
    (r,) = keyless.fetch([RETAIL], mode="history", start=None, end=None, http=http)
    obs = r.observations
    assert len(obs) == 416 and obs[0].period_start == "1992-01-01" and obs[0].value == 159177.0
    assert (obs[-1].period_start, obs[-1].period_end, obs[-1].value, obs[-1].flag) == \
        ("2026-08-01", "2026-08-31", 737763.0, "a")
    assert (obs[-2].value, obs[-2].flag) == (729538.0, "p") and obs[-3].flag == ""
    assert all(o.value is not None for o in obs)                 # trailing Sep-Dec NA dropped
    assert all(o.period_start <= "2026-09-28" for o in obs)


def test_starts_real_fixture(keyless):
    http, _ = client(export_route)
    (r,) = keyless.fetch([STARTS], mode="history", start=None, end=None, http=http)
    assert len(r.observations) == 812 and r.observations[0].period_start == "1959-01-01"
    assert r.observations[-1].value == 1275.0 and r.observations[-1].flag == ""


def test_trade_balance_negative_and_leading_na_dropped(keyless):
    http, _ = client(export_route)
    (r,) = keyless.fetch([TRADE], mode="history", start=None, end=None, http=http)
    assert r.observations[0].period_start == "1994-01-01"         # 1992-93 are NA in the export
    assert r.observations[-1].period_start == "2026-07-01" and r.observations[-1].value == -88576.0
    assert all(o.value < 0 for o in r.observations[-24:])


def test_durable_goods_advance_overlay(keyless):
    http, t = client(export_route)
    (r,) = keyless.fetch([DURG], mode="history", start=None, end=None, http=http)
    progs = [dict(q(x))["program"] for x in t.requests]
    assert progs == ["M3", "M3ADV"]
    assert dict(q(t.requests[1]))["startYear"] == "2026"
    obs = {o.period_start: o for o in r.observations}
    assert obs["2026-07-01"].value == 339392.0 and obs["2026-07-01"].flag == ""   # full M3 wins
    assert obs["2026-08-01"].value == 338604.0 and obs["2026-08-01"].flag == "a"  # advance-only month
    assert r.observations[0].period_start == "1992-02-01"
    assert r.request_key == ("census:export:M3:MDM:NO:SA:1992-2026+"
                             "census:export:M3ADV:MDM:NO:SA:2026-2026")


def test_latest_mode_and_range(keyless):
    http, t = client(export_route)
    (r,) = keyless.fetch([STARTS], mode="latest", start=None, end=None, http=http)
    d = dict(q(t.requests[0]))
    assert (d["startYear"], d["endYear"]) == ("2024", "2026")
    http, _ = client(export_route)
    (r,) = keyless.fetch([STARTS], mode="history", start=date(2026, 3, 1), end=date(2026, 5, 31), http=http)
    assert [o.period_start for o in r.observations] == ["2026-03-01", "2026-04-01", "2026-05-01"]


def test_interior_na_is_none(keyless):
    body = fx("export_MARTS_44X72_SM.csv").replace(b"Jun-2026,732898", b"Jun-2026,NA")
    http, _ = client(lambda req: FakeResp(200, {}, body))
    (r,) = keyless.fetch([RETAIL], mode="history", start=None, end=None, http=http)
    v = {o.period_start: o.value for o in r.observations}
    assert v["2026-06-01"] is None and v["2026-07-01"] == 729538.0


@pytest.mark.parametrize("mutate", [
    lambda b: b.replace(b"Seasonally Adjusted Sales", b"Not Seasonally Adjusted Sales"),   # wrong SA
    lambda b: b.replace(b"Seasonally Adjusted Sales", b"Seasonally Adjusted CV of Sales"),  # CV series
    lambda b: b.replace(b"Period,Value", b"Month,Amount"),
    lambda b: b.replace(b"U.S. Census Bureau", b"Somebody Else"),
    lambda b: b.replace(b"Jan-1992,159177", b"Jan-1992,abc"),
    lambda b: b.replace(b"Jan-1992,159177", b"Month13-1992,159177"),
    lambda b: b"",
    lambda b: b"<!DOCTYPE html><html><body>Access denied</body></html>",
    lambda b: b.split(b"Period,Value")[0] + b"Period,Value\nSep-2026,NA\n",               # all NA
])
def test_malformed_exports(keyless, mutate):
    body = mutate(fx("export_MARTS_44X72_SM.csv"))
    http, _ = client(lambda req: FakeResp(200, {}, body))
    with pytest.raises(MalformedPayload):
        keyless.fetch([RETAIL], mode="history", start=None, end=None, http=http)


def test_keyless_transport_failures(keyless):
    for resp in (FakeResp(503, {}, b""), FakeResp(403, {}, b"blocked"),
                 FakeResp(302, {"Location": "https://www.census.gov/error"}, b"")):
        http, t = client(lambda req, resp=resp: resp)
        with pytest.raises(SourceUnavailable):
            keyless.fetch([RETAIL], mode="history", start=None, end=None, http=http)


# --------------------------------------------------------------------------- keyed

EITS = fx("eits_marts_synth.json")


def test_keyed_request_construction_and_parse(keyed):
    http, t = client(lambda req: FakeResp(200, {"Content-Type": "application/json"}, EITS))
    (r,) = keyed.fetch([RETAIL], mode="latest", start=None, end=None, http=http)
    req = t.requests[0]
    assert req.url.startswith("https://api.census.gov/data/timeseries/eits/marts?")
    d = dict(q(req))
    assert d["key"] == KEYS["CENSUS_API_KEY"] and d["time"] == "from 2024" and d["for"] == "us:*"
    assert (d["category_code"], d["data_type_code"], d["seasonally_adj"]) == ("44X72", "SM", "yes")
    assert r.request_key == "census:eits:marts:44X72:SM:SA:2024-2026"
    assert_no_leak(r.request_key + repr(r.warnings) + repr(req))
    # error_data row + NSA row ignored; leading (S) placeholder trimmed; flags by position
    assert [(o.period_start, o.value, o.flag) for o in r.observations] == [
        ("2026-05-01", 731415.0, ""), ("2026-06-01", 732898.0, ""),
        ("2026-07-01", 729538.0, "p"), ("2026-08-01", 737763.0, "a")]


def test_keyed_parse_api_suppressed_is_none():
    p = {"category": "44X72", "data_type": "SM", "seasonal": "SA"}
    rows = dict((ps, v) for ps, _, v in CensusAdapter.parse_api(EITS, p))
    assert rows["2026-04-01"] is None and rows["2026-08-01"] == 737763.0


def test_keyed_missing_key_redirect_is_source_unavailable_never_followed(keyed):
    resp = FakeResp(302, {"Location": "https://api.census.gov/data/missing_key.html",
                          "X-DataWebAPI-KeyError": "1"}, b"")
    http, t = client(lambda req: resp)
    with pytest.raises(SourceUnavailable) as ei:
        keyed.fetch([RETAIL], mode="history", start=None, end=None, http=http)
    assert len(t.requests) == 1 and t.requests[0].allow_redirects is False
    assert "key" in str(ei.value)
    assert_no_leak(str(ei.value))


@pytest.mark.parametrize("resp", [
    FakeResp(204, {}, b""),
    FakeResp(200, {}, b""),
    FakeResp(200, {}, fx("missing_key.html")),                       # HTML instead of JSON
    FakeResp(200, {}, b"{not json"),
    FakeResp(200, {}, b'{"a": 1}'),
    FakeResp(200, {}, b'[["cell_value","time"],["1","2026-08"]]'),   # missing columns
    FakeResp(400, {}, b"error: unknown variable 'nope'"),
    FakeResp(200, {}, json.dumps([["cell_value", "data_type_code", "time_slot_id", "error_data",
                                   "category_code", "seasonally_adj", "time"],
                                  ["1", "SM", "0", "no", "OTHER", "yes", "2026-08"]]).encode()),
])
def test_keyed_malformed(keyed, resp):
    http, _ = client(lambda req: resp)
    with pytest.raises(MalformedPayload):
        keyed.fetch([RETAIL], mode="history", start=None, end=None, http=http)


def test_keyed_advance_overlay_uses_advm3(keyed):
    hdr = ["cell_value", "data_type_code", "time_slot_id", "error_data", "category_code",
           "seasonally_adj", "time"]

    def route(req):
        prog = urlsplit(req.url).path.rsplit("/", 1)[-1]
        rows = {"m3": [["339392", "NO", "0", "no", "MDM", "yes", "2026-07"]],
                "advm3": [["338662", "NO", "0", "no", "MDM", "yes", "2026-07"],
                          ["338604", "NO", "0", "no", "MDM", "yes", "2026-08"]]}[prog]
        return FakeResp(200, {}, json.dumps([hdr] + rows).encode())
    http, t = client(route)
    (r,) = keyed.fetch([DURG], mode="latest", start=None, end=None, http=http)
    assert [urlsplit(x.url).path for x in t.requests] == ["/data/timeseries/eits/m3",
                                                          "/data/timeseries/eits/advm3"]
    assert [(o.period_start, o.value, o.flag) for o in r.observations] == [
        ("2026-07-01", 339392.0, ""), ("2026-08-01", 338604.0, "a")]


# --------------------------------------------------------------------------- registry

def test_registry_cohort_specs_are_consumable(keyless):
    for sym in ("USRETAIL", "USHOUST", "USDURGOODS", "USTRADEBAL"):
        s = SeriesSpec(registry.get(sym))
        assert s.adapter == "census"
        p = keyless._p(s)
        assert p["program"] and p["category"] and p["data_type"] and p["seasonal"] == "SA"


def test_adapter_is_registered_and_bad_params_refused(keyless):
    assert isinstance(adapters.get_adapter("census"), CensusAdapter)
    http, _ = client(export_route)
    with pytest.raises(MalformedPayload):
        keyless.fetch([SeriesSpec(entry("USX", "marts", "", "SM"))], mode="history",
                      start=None, end=None, http=http)
    with pytest.raises(MalformedPayload):
        keyless.fetch([SeriesSpec(entry("USX", "marts", "44X72", "SM", seasonal="SAAR"))],
                      mode="history", start=None, end=None, http=http)
