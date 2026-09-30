"""EIA adapter: keyless dnav pages (real, trimmed) + keyed API v2 (synthesised per EIA docs)."""
from __future__ import annotations

import copy
import json
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest

from api.services.econ import registry, secrets, validate
from api.services.econ.adapters import eia
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

FIX = Path(__file__).parent / "fixtures" / "eia"
CRUDE_HTML = (FIX / "leaf_WCESTUS1.html").read_bytes()
GAS_HTML = (FIX / "leaf_EMM_EPMR_PTE_NUS_DPG.html").read_bytes()
V2 = json.loads((FIX / "v2_wstk_WCESTUS1_synth.json").read_text(encoding="utf-8"))
NOKEY = (FIX / "v2_403_api_key_missing.json").read_bytes()
KEY = "TESTKEY0123456789abcdef"
CRUDE_LM = "Wed, 23 Sep 2026 15:48:49 GMT"     # live hist_xls Last-Modified (WPSR 2026-09-23)
GAS_LM = "Tue, 22 Sep 2026 13:26:28 GMT"


def _resp(body, status=200, ctype="text/html; charset=utf-8", headers=None):
    if isinstance(body, (dict, list)):
        body, ctype = json.dumps(body).encode(), "application/json"
    h = {"Content-Type": ctype}
    h.update(headers or {})
    return SimpleNamespace(status_code=status, headers=h, content=body)


class Transport:
    def __init__(self, route):
        self.route, self.requests = route, []

    def __call__(self, req):
        self.requests.append(req)
        return self.route(req)


def _client(route):
    t = Transport(route)
    return HttpClient(transport=t, sleep=lambda s: None, max_retries=0, default_interval=0,
                      host_intervals={}), t


def _spec(sym, **param_overrides):
    e = copy.deepcopy(registry.get(sym))
    e["source"]["params"].update(param_overrides)
    return SeriesSpec(e)


def _spec_seriesid(sym):
    """The registry's entry with its v2_route removed: exercises the /v2/seriesid fallback route."""
    e = copy.deepcopy(registry.get(sym))
    e["source"]["params"].pop("v2_route", None)
    return SeriesSpec(e)


def _keyless_route(page, lm=CRUDE_LM, probe_status=206):
    def route(req):
        if "LeafHandler.ashx" in req.url:
            return _resp(page)
        if "/hist_xls/" in req.url:
            return _resp(b"\xd0", status=probe_status, ctype="application/vnd.ms-excel",
                         headers={"Last-Modified": lm} if lm else {})
        raise AssertionError(req.url)
    return route


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    monkeypatch.delenv("EIA_API_KEY", raising=False)


# ─────────────────────────────── keyless ──────────────────────────────────


def test_keyless_crude_history_friday_weeks_and_release_time():
    http, t = _client(_keyless_route(CRUDE_HTML))
    [res] = eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)
    obs = res.observations
    # 1982-Aug row has blank week-1/2 cells, 1982-Sep only week 4 (early-history gaps are real)
    assert [o.period_end for o in obs] == ["1982-08-20", "1982-08-27", "1982-09-24", "1982-10-01",
                                          "1982-10-08", "1982-10-15", "1982-10-22", "1982-10-29",
                                          "2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24",
                                          "2026-07-31", "2026-08-07", "2026-08-14", "2026-08-21",
                                          "2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"]
    last = obs[-1]
    assert (last.period_start, last.period_end, last.value) == ("2026-09-12", "2026-09-18", 426398.0)
    assert obs[0].value == 338764.0
    q = parse_qs(urlsplit(t.requests[0].url).query)
    assert q == {"n": ["PET"], "s": ["WCESTUS1"], "f": ["W"]}
    assert t.requests[1].headers.get("Range") == "bytes=0-0"
    assert t.requests[1].url == "https://www.eia.gov/dnav/pet/hist_xls/WCESTUS1w.xls"
    assert res.source_published_at == int(datetime(2026, 9, 23, 15, 48, 49, tzinfo=timezone.utc).timestamp())
    assert res.request_key == "eia:dnav:PET.WCESTUS1.W:history:.." and res.warnings == []
    assert validate.check_schema(registry.get("USCRUDEINV"), obs) == []


def test_keyless_gasoline_monday_na_markers():
    http, _ = _client(_keyless_route(GAS_HTML, lm=GAS_LM))
    [res] = eia.EiaAdapter().fetch([_spec("USGASPRICE")], mode="history", start=None, end=None, http=http)
    obs = {o.period_end: o for o in res.observations}
    assert obs["1990-12-10"].value is None and obs["1991-01-14"].value is None    # '--' -> NA, never 0
    assert obs["1990-08-20"].value == 1.191
    last = res.observations[-1]
    assert (last.period_start, last.period_end, last.value) == ("2026-09-15", "2026-09-21", 4.478)
    assert date.fromisoformat(last.period_end).weekday() == 0
    assert res.source_published_at == int(datetime(2026, 9, 22, 13, 26, 28, tzinfo=timezone.utc).timestamp())
    assert validate.check_schema(registry.get("USGASPRICE"), res.observations) == []


def test_probe_lm_not_on_release_date_is_not_used():
    http, _ = _client(_keyless_route(GAS_HTML, lm="Mon, 21 Sep 2026 21:00:00 GMT"))
    [res] = eia.EiaAdapter().fetch([_spec("USGASPRICE")], mode="history", start=None, end=None, http=http)
    assert res.source_published_at is None and any("Release Date" in w for w in res.warnings)


@pytest.mark.parametrize("status,lm", [(500, CRUDE_LM), (404, CRUDE_LM), (206, None)])
def test_probe_failure_is_a_warning_not_a_failure(status, lm):
    http, _ = _client(_keyless_route(CRUDE_HTML, lm=lm, probe_status=status))
    [res] = eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)
    assert res.source_published_at is None and res.warnings and res.observations


def test_latest_mode_and_window():
    http, _ = _client(_keyless_route(CRUDE_HTML))
    [res] = eia.EiaAdapter().fetch([_spec("USCRUDEINV", latest_n=2)], mode="latest", start=None, end=None,
                                   http=http)
    assert [o.period_end for o in res.observations] == ["2026-09-11", "2026-09-18"]
    [res] = eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=date(2026, 9, 1),
                                   end=date(2026, 9, 12), http=http)
    assert [o.period_end for o in res.observations] == ["2026-09-04", "2026-09-11"]


def test_identity_guard_wrong_series_page():
    http, _ = _client(_keyless_route(CRUDE_HTML))
    with pytest.raises(MalformedPayload, match="identity"):
        eia.EiaAdapter().fetch([_spec("USGASPRICE")], mode="history", start=None, end=None, http=http)


@pytest.mark.parametrize("body", [
    b"<html><body><h1>Series not found</h1></body></html>",
    b"",
    CRUDE_HTML.replace(b"09/18&nbsp;", b"09/17&nbsp;"),             # not a Friday
    CRUDE_HTML.replace(b"426,398&nbsp;", b"426,39x&nbsp;"),         # non-numeric
    CRUDE_HTML.replace(b"09/18&nbsp;", b"10/18&nbsp;"),             # date outside its month row
])
def test_malformed_pages(body):
    http, _ = _client(_keyless_route(body))
    with pytest.raises(MalformedPayload):
        eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)


def test_leaf_http_error_is_source_unavailable():
    http, _ = _client(lambda req: _resp(b"err", status=503))
    with pytest.raises(SourceUnavailable):
        eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)


def test_parse_leaf_release_dates():
    obs, rel, nxt = eia.parse_leaf(CRUDE_HTML.decode(), symbol="X", code="WCESTUS1", freq="W", anchor="FRI")
    assert (rel, nxt) == (date(2026, 9, 23), date(2026, 9, 30))


# ─────────────────────────────── keyed (v2) ───────────────────────────────


def test_keyed_data_route_request_construction(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", KEY)
    http, t = _client(lambda req: _resp(V2))
    spec = _spec("USCRUDEINV", v2_route="petroleum/stoc/wstk")
    [res] = eia.EiaAdapter().fetch([spec], mode="history", start=None, end=None, http=http)
    u = urlsplit(t.requests[0].url)
    q = parse_qs(u.query)
    assert u.netloc == "api.eia.gov" and u.path == "/v2/petroleum/stoc/wstk/data/"
    assert q["api_key"] == [KEY] and q["facets[series][]"] == ["WCESTUS1"] and q["frequency"] == ["weekly"]
    assert q["data[0]"] == ["value"] and q["sort[0][direction]"] == ["desc"] and q["length"] == ["5000"]
    assert KEY not in res.request_key and secrets.redact(res.request_key) == res.request_key
    assert res.request_key == "eia:v2:petroleum/stoc/wstk:PET.WCESTUS1.W:history:.."
    assert [(o.period_end, o.value) for o in res.observations] == [
        ("2026-09-04", 424069.0), ("2026-09-11", 423429.0), ("2026-09-18", 426398.0)]
    assert res.source_published_at is None


def test_keyed_paging_by_offset(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", KEY)
    monkeypatch.setattr(eia, "V2_PAGE", 2)
    rows = V2["response"]["data"]

    def route(req):
        off = int(parse_qs(urlsplit(req.url).query)["offset"][0])
        doc = copy.deepcopy(V2)
        doc["response"]["data"] = rows[off:off + 2]
        return _resp(doc)
    http, t = _client(route)
    [res] = eia.EiaAdapter().fetch([_spec("USCRUDEINV", v2_route="petroleum/stoc/wstk")], mode="history",
                                   start=None, end=None, http=http)
    assert len(t.requests) == 2 and len(res.observations) == 3


def test_keyed_seriesid_route_and_partial(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", KEY)
    doc = copy.deepcopy(V2)
    http, t = _client(lambda req: _resp(doc))
    [res] = eia.EiaAdapter().fetch([_spec_seriesid("USCRUDEINV")], mode="history", start=date(2026, 9, 1), end=None,
                                   http=http)
    u = urlsplit(t.requests[0].url)
    assert u.path == "/v2/seriesid/PET.WCESTUS1.W" and parse_qs(u.query)["start"] == ["2026-09-01"]
    assert len(res.observations) == 3 and res.request_key.startswith("eia:v2:seriesid:")
    doc["response"]["total"] = "2295"
    with pytest.raises(MalformedPayload, match="partial"):
        eia.EiaAdapter().fetch([_spec_seriesid("USCRUDEINV")], mode="history", start=None, end=None, http=http)


def test_keyed_403_key_missing_is_source_unavailable_and_redacted(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", KEY)
    http, _ = _client(lambda req: _resp(NOKEY, status=403, ctype="application/json"))
    with pytest.raises(SourceUnavailable, match="key") as ei:
        eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)
    assert KEY not in str(ei.value)


def test_keyed_identity_and_anchor(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", KEY)
    doc = copy.deepcopy(V2)
    doc["response"]["data"][0]["series"] = "WGTSTUS1"
    http, _ = _client(lambda req: _resp(doc))
    with pytest.raises(MalformedPayload, match="identity"):
        eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)
    doc = copy.deepcopy(V2)
    doc["response"]["data"][0]["period"] = "2026-09-17"
    http, _ = _client(lambda req: _resp(doc))
    with pytest.raises(MalformedPayload, match="not a FRI"):
        eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)


def test_keyed_empty_and_html(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", KEY)
    for body in (b"", b"<html>oops</html>"):
        http, _ = _client(lambda req, b=body: _resp(b, ctype="text/html"))
        with pytest.raises(MalformedPayload):
            eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="history", start=None, end=None, http=http)


def test_keyless_request_never_carries_a_key():
    http, t = _client(_keyless_route(CRUDE_HTML))
    eia.EiaAdapter().fetch([_spec("USCRUDEINV")], mode="latest", start=None, end=None, http=http)
    assert all("api_key" not in r.url for r in t.requests)


def test_bad_series_id():
    http, _ = _client(_keyless_route(CRUDE_HTML))
    with pytest.raises(MalformedPayload):
        eia.EiaAdapter().fetch([_spec("USCRUDEINV", series_id="WCESTUS1")], mode="history", start=None,
                               end=None, http=http)
