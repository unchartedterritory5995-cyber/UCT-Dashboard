"""BEA adapter: NIPA flat files (keyless) + BEA API GetData (keyed).

Fixtures (tests/econ/fixtures/bea/):
  NipaDataQ_trim.txt / NipaDataM_trim.txt  REAL flat-file lines (2026-08-26 release,
      fetched 2026-09-29) for the cohort codes, full history, + a few distractor codes
  SeriesRegister_trim.txt                  REAL SeriesRegister.txt lines
  api_*_synth.json                         SYNTHESISED BEA API shapes (no key available)
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from api.services.econ import adapters, registry
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.adapters.bea import BeaAdapter, parse_period, parse_value
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

from .test_secrets import KEYS, assert_no_leak

FX = Path(__file__).parent / "fixtures" / "bea"
Q = (FX / "NipaDataQ_trim.txt").read_bytes()
M = (FX / "NipaDataM_trim.txt").read_bytes()
LM = "Wed, 26 Aug 2026 12:30:03 GMT"
LM_TS = 1787747403          # 2026-08-26T12:30:03Z
TODAY = date(2026, 9, 28)


def entry(symbol, table, line, code, freq):
    return {"symbol": symbol, "frequency": freq,
            "source": {"adapter": "bea", "provider_series_id": f"NIPA {table} L{line} ({code})",
                       "params": {"dataset": "NIPA", "table": table, "line": line,
                                  "series_code": code, "frequency": freq}}}


RGDP = SeriesSpec(entry("USRGDP", "T10106", 1, "A191RX", "Q"))
RGDPQA = SeriesSpec(entry("USRGDPQA", "T10101", 1, "A191RL", "Q"))
GDP = SeriesSpec(entry("USGDP", "T10105", 1, "A191RC", "Q"))
PCEPI = SeriesSpec(entry("USPCEPI", "T20804", 1, "DPCERG", "M"))
CORE = SeriesSpec(entry("USCOREPCE", "T20804", 25, "DPCCRG", "M"))


class FakeResp:
    def __init__(self, status=200, headers=None, content=b""):
        self.status_code, self.headers, self.content = status, headers or {}, content


class Transport:
    """Serves by URL substring; records every request."""

    def __init__(self, routes):
        self.routes = routes          # [(substring, FakeResp | callable(req) | list)]
        self.requests = []

    def __call__(self, req):
        self.requests.append(req)
        for sub, resp in self.routes:
            if sub in req.url:
                if isinstance(resp, list):
                    return resp.pop(0) if len(resp) > 1 else resp[0]
                return resp(req) if callable(resp) else resp
        raise AssertionError(f"unrouted {req!r}")


class DictValidators:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def put(self, k, etag, lm):
        self.d[k] = (etag, lm)


def client(routes, store=None):
    t = Transport(routes)
    return HttpClient(transport=t, sleep=lambda s: None, default_interval=0, max_retries=2,
                      validator_store=store), t


def flat_routes(q=Q, m=M, headers=None):
    h = {"Last-Modified": LM, "ETag": '"abc"', **(headers or {})}
    return [("NipaDataQ.txt", FakeResp(200, h, q)), ("NipaDataM.txt", FakeResp(200, h, m))]


@pytest.fixture
def keyless(monkeypatch):
    monkeypatch.delenv("BEA_API_KEY", raising=False)
    return BeaAdapter(today=lambda: TODAY)


@pytest.fixture
def keyed(monkeypatch):
    for k, v in KEYS.items():
        monkeypatch.setenv(k, v)
    return BeaAdapter(today=lambda: TODAY)


def by(results):
    out = {}
    for r in results:
        for o in r.observations:
            out.setdefault(o.series_id, []).append(o)
    return out


# --------------------------------------------------------------------------- grammar

def test_period_grammar():
    assert parse_period("2026Q2", "Q") == (date(2026, 4, 1), date(2026, 6, 30))
    assert parse_period("1947Q1", "Q") == (date(1947, 1, 1), date(1947, 3, 31))
    assert parse_period("2026M07", "M") == (date(2026, 7, 1), date(2026, 7, 31))
    assert parse_period("2024M02", "M") == (date(2024, 2, 1), date(2024, 2, 29))
    assert parse_period("2025", "A") == (date(2025, 1, 1), date(2025, 12, 31))
    for bad, f in [("2026Q5", "Q"), ("2026M13", "M"), ("2026-07", "M"), ("2026Q2", "M"), ("x", "A")]:
        with pytest.raises(ValueError):
            parse_period(bad, f)


def test_value_grammar_and_na_markers():
    assert parse_value('"24,269,613"') == 24269613.0
    assert parse_value("-0.6") == -0.6 and parse_value("1.5") == 1.5
    for na in ("(NA)", "---", "(D)", "", "n.a.", "...", None):
        assert parse_value(na) is None
    with pytest.raises(ValueError):
        parse_value("abc")


# --------------------------------------------------------------------------- keyless

def test_keyless_history_quarterly_real_fixture(keyless):
    http, t = client(flat_routes())
    res = keyless.fetch([RGDP, RGDPQA, GDP], mode="history", start=None, end=None, http=http)
    assert len(res) == 1 and len(t.requests) == 1               # ONE file for all Q series
    r = res[0]
    assert t.requests[0].url == "https://apps.bea.gov/national/Release/TXT/NipaDataQ.txt"
    assert "If-None-Match" not in t.requests[0].headers         # history is never conditional
    assert r.request_key == "bea:flat:NipaDataQ.txt:A191RC,A191RL,A191RX"
    assert r.source_published_at == LM_TS and r.http_status == 200 and r.warnings == []
    s = by(res)
    assert len(s["USRGDP"]) == 318 and len(s["USGDP"]) == 318 and len(s["USRGDPQA"]) == 317
    assert s["USRGDP"][0].period_start == "1947-01-01" and s["USRGDP"][0].period_end == "1947-03-31"
    assert s["USRGDPQA"][0].period_start == "1947-04-01"
    last = s["USRGDP"][-1]
    assert (last.period_start, last.period_end, last.value) == ("2026-04-01", "2026-06-30", 24269613.0)
    assert s["USRGDPQA"][-1].value == 1.5
    assert s["USGDP"][-1].value == 32486066.0                  # MILLIONS (DefaultScale -6)
    assert all(o.flag == "" for o in r.observations)
    assert {o.series_id for o in r.observations} == {"USRGDP", "USRGDPQA", "USGDP"}  # no distractors


def test_keyless_monthly_real_fixture(keyless):
    http, t = client(flat_routes())
    res = keyless.fetch([PCEPI, CORE], mode="history", start=None, end=None, http=http)
    s = by(res)
    assert t.requests[0].url.endswith("NipaDataM.txt")
    assert len(s["USPCEPI"]) == 811 and s["USPCEPI"][0].period_start == "1959-01-01"
    assert (s["USPCEPI"][-1].period_start, s["USPCEPI"][-1].period_end, s["USPCEPI"][-1].value) == \
        ("2026-07-01", "2026-07-31", 131.659)
    assert s["USCOREPCE"][-1].value == 130.658


def test_mixed_frequencies_one_request_per_file(keyless):
    http, t = client(flat_routes())
    res = keyless.fetch([RGDP, PCEPI], mode="history", start=None, end=None, http=http)
    assert len(res) == 2 and len(t.requests) == 2
    assert sorted(r.request_key for r in res) == ["bea:flat:NipaDataM.txt:DPCERG",
                                                  "bea:flat:NipaDataQ.txt:A191RX"]


def test_latest_mode_window_and_range_filter(keyless):
    http, _ = client(flat_routes())
    (r,) = keyless.fetch([RGDP], mode="latest", start=None, end=None, http=http)
    assert len(r.observations) == 12 and r.observations[-1].period_start == "2026-04-01"
    http, _ = client(flat_routes())
    (r,) = keyless.fetch([RGDP], mode="history", start=date(2025, 5, 1), end=date(2025, 12, 31), http=http)
    assert [o.period_start for o in r.observations] == ["2025-04-01", "2025-07-01", "2025-10-01"]


def test_conditional_get_latest_and_304(keyless):
    store = DictValidators()
    routes = [("NipaDataQ.txt", [FakeResp(200, {"Last-Modified": LM, "ETag": '"abc"'}, Q),
                                 FakeResp(304, {}, b"")])]
    http, t = client(routes, store)
    (r1,) = keyless.fetch([RGDP], mode="latest", start=None, end=None, http=http)
    assert r1.observations and store.get("bea:flat:NipaDataQ.txt:A191RX") == ('"abc"', LM)
    (r2,) = keyless.fetch([RGDP], mode="latest", start=None, end=None, http=http)
    assert t.requests[1].headers["If-None-Match"] == '"abc"'
    assert t.requests[1].headers["If-Modified-Since"] == LM
    assert r2.not_modified and r2.observations == []
    # a DIFFERENT batch has its own conditional key -> never inherits the 304
    assert "bea:flat:NipaDataQ.txt:A191RC,A191RX" not in store.d


def test_validators_not_committed_when_payload_bad(keyless):
    store = DictValidators()
    http, _ = client([("NipaDataQ.txt", FakeResp(200, {"ETag": '"x"', "Last-Modified": LM},
                                                 b"%SeriesCode,Period,Value\nA191RX,2026Q2,garbage\n"))], store)
    with pytest.raises(MalformedPayload):
        keyless.fetch([RGDP], mode="latest", start=None, end=None, http=http)
    assert store.d == {}


def test_na_markers_become_none_never_zero(keyless):
    body = b'%SeriesCode,Period,Value\nA191RX,2026Q1,"(NA)"\nA191RX,2026Q2,---\nA191RX,2025Q4,"24,055,749"\n'
    http, _ = client([("NipaDataQ.txt", FakeResp(200, {}, body))])
    (r,) = keyless.fetch([RGDP], mode="history", start=None, end=None, http=http)
    vals = {o.period_start: o.value for o in r.observations}
    assert vals == {"2025-10-01": 24055749.0, "2026-01-01": None, "2026-04-01": None}
    assert r.source_published_at is None                   # no Last-Modified -> none claimed


def test_future_periods_dropped(keyless):
    body = b'%SeriesCode,Period,Value\nA191RX,2026Q2,"1"\nA191RX,2026Q4,"2"\n'
    http, _ = client([("NipaDataQ.txt", FakeResp(200, {}, body))])
    (r,) = keyless.fetch([RGDP], mode="history", start=None, end=None, http=http)
    assert [o.period_start for o in r.observations] == ["2026-04-01"]


@pytest.mark.parametrize("body,exc", [
    (b"", MalformedPayload),                                                   # empty 200
    (b"   \n", MalformedPayload),
    (b"<!DOCTYPE html><html><body>Service Unavailable</body></html>", MalformedPayload),
    (b"SeriesCode;Period;Value\nA191RX;2026Q2;1\n", MalformedPayload),         # wrong header
    (b"%SeriesCode,Period,Value\nA191RX,2026-06,1\n", MalformedPayload),       # bad period
    (b"%SeriesCode,Period,Value\nA001RC,2026Q2,1\n", MalformedPayload),        # requested code absent
])
def test_malformed_flat_payloads(keyless, body, exc):
    http, _ = client([("NipaDataQ.txt", FakeResp(200, {}, body))])
    with pytest.raises(exc):
        keyless.fetch([RGDP], mode="history", start=None, end=None, http=http)


def test_partial_batch_warns_not_silent(keyless):
    body = b'%SeriesCode,Period,Value\nA191RX,2026Q2,"24,269,613"\n'
    http, _ = client([("NipaDataQ.txt", FakeResp(200, {}, body))])
    (r,) = keyless.fetch([RGDP, GDP], mode="history", start=None, end=None, http=http)
    assert [o.series_id for o in r.observations] == ["USRGDP"]
    assert any("A191RC" in w and "USGDP" in w for w in r.warnings)


def test_transport_failures(keyless):
    http, _ = client([("NipaDataQ.txt", FakeResp(503, {}, b"down"))])
    with pytest.raises(SourceUnavailable):
        keyless.fetch([RGDP], mode="history", start=None, end=None, http=http)
    http, _ = client([("NipaDataQ.txt", FakeResp(302, {"Location": "https://apps.bea.gov/error.htm"}))])
    with pytest.raises(SourceUnavailable):
        keyless.fetch([RGDP], mode="history", start=None, end=None, http=http)
    http, _ = client([("NipaDataQ.txt", FakeResp(404, {}, b"nope"))])
    with pytest.raises(SourceUnavailable):
        keyless.fetch([RGDP], mode="history", start=None, end=None, http=http)


# --------------------------------------------------------------------------- keyed

API_OK = (FX / "api_T10106_Q_synth.json").read_bytes()


def _q(req):
    return {k: v[0] for k, v in parse_qs(urlsplit(req.url).query, keep_blank_values=True).items()}


def test_keyed_request_construction_and_parse(keyed):
    http, t = client([("apps.bea.gov/api/data", FakeResp(200, {}, API_OK))])
    (r,) = keyed.fetch([RGDP], mode="history", start=None, end=None, http=http)
    q = _q(t.requests[0])
    assert q["UserID"] == KEYS["BEA_API_KEY"] and q["method"] == "GetData"
    assert (q["DataSetName"], q["TableName"], q["Frequency"], q["Year"], q["ResultFormat"]) == \
        ("NIPA", "T10106", "Q", "ALL", "JSON")
    assert r.request_key == "bea:api:NIPA:T10106:Q:ALL"
    assert_no_leak(r.request_key + repr(r.warnings) + repr(t.requests[0]))
    assert [(o.period_start, o.value) for o in r.observations] == [
        ("2025-07-01", 24026834.0), ("2025-10-01", 24055749.0),
        ("2026-01-01", 24180419.0), ("2026-04-01", 24269613.0)]           # A006RX distractor excluded
    assert r.source_published_at is None


def test_keyed_latest_years(keyed):
    http, t = client([("apps.bea.gov/api/data", FakeResp(200, {}, API_OK))])
    (r,) = keyed.fetch([RGDP], mode="latest", start=None, end=None, http=http)
    assert _q(t.requests[0])["Year"] == "2024,2025,2026"
    assert r.request_key == "bea:api:NIPA:T10106:Q:2024,2025,2026"


def test_keyed_groups_by_table(keyed):
    http, t = client([("apps.bea.gov/api/data", FakeResp(200, {}, API_OK))])
    with pytest.raises(MalformedPayload):       # T10101 payload stub lacks A191RL -> none found
        keyed.fetch([RGDP, RGDPQA], mode="history", start=None, end=None, http=http)
    assert sorted(_q(r)["TableName"] for r in t.requests) == ["T10101", "T10106"]


def test_keyed_empty_200_is_key_failure_not_no_data(keyed):
    http, _ = client([("apps.bea.gov/api/data", FakeResp(200, {}, b""))])
    with pytest.raises(SourceUnavailable) as ei:
        keyed.fetch([RGDP], mode="history", start=None, end=None, http=http)
    assert "key" in str(ei.value)
    assert_no_leak(str(ei.value))


def test_keyed_error_objects(keyed):
    http, _ = client([("apps.bea.gov/api/data", FakeResp(200, {}, (FX / "api_error_userid_synth.json").read_bytes()))])
    with pytest.raises(SourceUnavailable):
        keyed.fetch([RGDP], mode="history", start=None, end=None, http=http)
    http, _ = client([("apps.bea.gov/api/data", FakeResp(200, {}, (FX / "api_error_param_synth.json").read_bytes()))])
    with pytest.raises(MalformedPayload):
        keyed.fetch([RGDP], mode="history", start=None, end=None, http=http)
    for body in (b"<html>oops</html>", b"{not json", b'{"BEAAPI": {"Results": {}}}', b"[1,2]"):
        http, _ = client([("apps.bea.gov/api/data", FakeResp(200, {}, body))])
        with pytest.raises(MalformedPayload):
            keyed.fetch([RGDP], mode="history", start=None, end=None, http=http)


def test_keyed_429_retry_after_then_ok(keyed):
    sleeps = []
    t = Transport([("apps.bea.gov/api/data", [FakeResp(429, {"Retry-After": "7"}, b""),
                                              FakeResp(200, {}, API_OK)])])
    http = HttpClient(transport=t, sleep=sleeps.append, default_interval=0, max_retries=2)
    (r,) = keyed.fetch([RGDP], mode="history", start=None, end=None, http=http)
    assert 7.0 in sleeps and len(r.observations) == 4


def test_keyed_identity_and_scale_drift(keyed):
    doc = json.loads(API_OK)
    for row in doc["BEAAPI"]["Results"]["Data"]:
        if row["SeriesCode"] == "A191RX":
            row["LineNumber"] = "2"
    http, _ = client([("apps.bea.gov/api/data", FakeResp(200, {}, json.dumps(doc).encode()))])
    with pytest.raises(MalformedPayload, match="line"):
        keyed.fetch([RGDP], mode="history", start=None, end=None, http=http)
    e = entry("USRGDP", "T10106", 1, "A191RX", "Q")
    e["source"]["params"]["unit_mult"] = 9                       # registry expects billions
    http, _ = client([("apps.bea.gov/api/data", FakeResp(200, {}, API_OK))])
    with pytest.raises(MalformedPayload, match="UNIT_MULT"):
        keyed.fetch([SeriesSpec(e)], mode="history", start=None, end=None, http=http)
    e["source"]["params"]["unit_mult"] = 6
    http, _ = client([("apps.bea.gov/api/data", FakeResp(200, {}, API_OK))])
    (r,) = keyed.fetch([SeriesSpec(e)], mode="history", start=None, end=None, http=http)
    assert len(r.observations) == 4


# --------------------------------------------------------------------------- registry / register

def test_registry_cohort_specs_are_consumable(keyless):
    for sym in ("USGDP", "USRGDP", "USRGDPQA", "USPCEPI", "USCOREPCE"):
        s = SeriesSpec(registry.get(sym))
        assert s.adapter == "bea"
        p = keyless._p(s)
        assert p["code"] and p["table"] and p["freq"] in ("Q", "M")


def test_series_register_confirms_identity_and_scale():
    reg = BeaAdapter.parse_register((FX / "SeriesRegister_trim.txt").read_bytes())
    assert ("T10106", "1") in reg["A191RX"]["tables"] and reg["A191RX"]["scale"] == -6
    assert ("T10105", "1") in reg["A191RC"]["tables"] and reg["A191RC"]["scale"] == -6
    assert ("T10101", "1") in reg["A191RL"]["tables"] and reg["A191RL"]["scale"] == 0
    assert ("T20804", "1") in reg["DPCERG"]["tables"] and ("T20804", "25") in reg["DPCCRG"]["tables"]
    with pytest.raises(MalformedPayload):
        BeaAdapter.parse_register(b"<html></html>")


def test_adapter_is_registered():
    assert isinstance(adapters.get_adapter("bea"), BeaAdapter)
    assert BeaAdapter.key_env == "BEA_API_KEY"


def test_bad_params_refused(keyless):
    http, _ = client(flat_routes())
    e = entry("USX", "T1", 1, "", "Q")
    with pytest.raises(MalformedPayload):
        keyless.fetch([SeriesSpec(e)], mode="history", start=None, end=None, http=http)
    e = entry("USX", "T1", 1, "A191RX", "W")
    with pytest.raises(MalformedPayload):
        keyless.fetch([SeriesSpec(e)], mode="history", start=None, end=None, http=http)
