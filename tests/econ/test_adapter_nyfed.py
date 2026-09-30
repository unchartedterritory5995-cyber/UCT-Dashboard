"""NY Fed Markets API adapter: rates (EFFR/target range/SOFR) + ON RRP operations, from real
payloads; field absence vs NA, revision flags, client-side filtering, summing, floors,
year-chunked history, soft failures."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from api.services.econ import secrets
from api.services.econ.adapters import get_adapter, nyfed
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

FIX = Path(__file__).parent / "fixtures" / "nyfed"
NOW = 1790640000            # 2026-09-28T21:20Z


def fx(name):
    return (FIX / name).read_bytes()


def spec(sym, path, field, hs=None, **params):
    return SeriesSpec({"symbol": sym, "frequency": "D", "history_start": hs,
                       "source": {"adapter": "nyfed", "params": {"path": path, "field": field, **params}}})


EFFR_PATH = "/api/rates/unsecured/effr"
RP_PATH = "/api/rp/results/search.json"
EFFR = spec("USEFFR", EFFR_PATH, "percentRate", "2016-03-01")
UPPER = spec("USFEDFUNDSU", EFFR_PATH, "targetRateTo", "2008-12-16")
LOWER = spec("USFEDFUNDSL", EFFR_PATH, "targetRateFrom", "2008-12-16")
SOFR = spec("USSOFR", "/api/rates/secured/sofr", "percentRate", "2018-04-02")
RRP = spec("USRRP", RP_PATH, "totalAmtAccepted", "2013-09-23",
           query={"term": "overnight"}, filter={"operationType": "Reverse Repo", "term": "Overnight"},
           aggregate="primary")
RRP_TOTAL = spec("USRRP", RP_PATH, "totalAmtAccepted", "2013-09-23",
                 query={"term": "overnight"}, filter={"operationType": "Reverse Repo", "term": "Overnight"})


class Resp:
    def __init__(self, status=200, content=b"", headers=None):
        self.status_code = status
        self.content = content
        self.headers = headers or {"Content-Type": "application/json;charset=utf-8"}


class Router:
    def __init__(self, routes, default=None):
        self.routes = routes
        self.default = default
        self.sent = []

    def __call__(self, req):
        self.sent.append(req.url)
        for k, v in self.routes.items():
            if k in req.url:
                return v(req) if callable(v) else v
        if self.default is not None:
            return self.default(req) if callable(self.default) else self.default
        return Resp(404, b"")


def client(t):
    return HttpClient(transport=t, sleep=lambda s: None, host_intervals={}, default_interval=0, max_retries=0)


def adapter():
    return nyfed.NyFedAdapter(clock=lambda: NOW)


def qs(url):
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def by_sym(results):
    out = {}
    for r in results:
        for o in r.observations:
            out.setdefault(o.series_id, []).append(o)
    return out


def test_registered_keyless():
    a = get_adapter("nyfed")
    assert isinstance(a, nyfed.NyFedAdapter) and a.key_env is None


def test_latest_effr_family_shares_one_request():
    t = Router({"/effr/last/10.json": Resp(200, fx("effr_last5.json"))})
    res = adapter().fetch([EFFR, UPPER, LOWER], mode="latest", start=None, end=None, http=client(t))
    assert len(t.sent) == 1 and len(res) == 1
    b = by_sym(res)
    assert b["USEFFR"][-1].period_start == "2026-09-25" and b["USEFFR"][-1].value == 3.88
    assert b["USFEDFUNDSU"][-1].value == 4.00 and b["USFEDFUNDSL"][-1].value == 3.75
    assert res[0].request_key == \
        "nyfed:/api/rates/unsecured/effr:percentRate,targetRateFrom,targetRateTo:latest"


def test_latest_sofr():
    t = Router({"/sofr/last/10.json": Resp(200, fx("sofr_last5.json"))})
    [r] = adapter().fetch([SOFR], mode="latest", start=None, end=None, http=client(t))
    assert r.observations[-1].period_start == "2026-09-25" and r.observations[-1].value == 3.90
    assert all(o.source_published_at is None for o in r.observations)


def test_target_range_absent_before_2008_12_16_and_revision_flag():
    """Pre-range rows carry a single target in targetRateFrom and NO targetRateTo."""
    doc = fx("effr_search_2008-12-10_2008-12-22.json")
    up = nyfed.parse_rates(json.loads(doc), spec("U", EFFR_PATH, "targetRateTo"))
    assert up[0].period_start == "2008-12-16" and up[0].value == 0.25
    lo = nyfed.parse_rates(json.loads(doc), spec("L", EFFR_PATH, "targetRateFrom"))
    assert lo[0].period_start == "2008-12-10" and lo[0].value == 1.00      # point target; floor trims it
    ef = nyfed.parse_rates(json.loads(doc), spec("E", EFFR_PATH, "percentRate"))
    assert {o.period_start: o.flag for o in ef}["2008-12-19"] == "r"     # API sends "r"
    ydoc = {"refRates": [{"effectiveDate": "2026-09-25", "type": "EFFR", "percentRate": 3.9,
                          "revisionIndicator": "Y"}]}
    assert nyfed.parse_rates(ydoc, spec("E", EFFR_PATH, "percentRate"))[0].flag == "r"


def test_history_floor_trims_pre_range_lower_bound():
    t = Router({"/effr/search.json": Resp(200, fx("effr_search_2008-12-10_2008-12-22.json"))})
    [r] = adapter().fetch([LOWER], mode="history", start=date(2008, 12, 10), end=date(2008, 12, 22),
                          http=client(t))
    assert r.observations[0].period_start == "2008-12-16"


def test_effr_methodology_floor_2016_03_01():
    t = Router({"/effr/search.json": Resp(200, fx("effr_search_2016-02-25_2016-03-03.json"))})
    [r] = adapter().fetch([EFFR], mode="history", start=date(2016, 2, 25), end=date(2016, 3, 3), http=client(t))
    assert [o.period_start for o in r.observations] == ["2016-03-01", "2016-03-02", "2016-03-03"]
    unfloored = spec("USEFFR", EFFR_PATH, "percentRate", "2016-03-01", min_date="2000-07-03")
    [r] = adapter().fetch([unfloored], mode="history", start=date(2016, 2, 25), end=date(2016, 3, 3),
                          http=client(t))
    assert r.observations[0].period_start == "2016-02-25"


def test_history_is_chunked_by_calendar_year_from_the_floor():
    seen = []

    def serve(req):
        seen.append(qs(req.url))
        return Resp(200, b'{ "refRates": [] }')
    t = Router({"/effr/search.json": serve})
    with pytest.raises(MalformedPayload, match="zero rows"):
        adapter().fetch([EFFR, UPPER, LOWER], mode="history", start=None, end=None, http=client(t))
    assert seen[0] == {"startDate": "2008-12-16", "endDate": "2008-12-31"}
    assert seen[1] == {"startDate": "2009-01-01", "endDate": "2009-12-31"}
    assert seen[-1] == {"startDate": "2026-01-01", "endDate": "2026-09-28"}
    assert len(seen) == 19
    assert nyfed.year_windows(date(2025, 12, 31), date(2026, 1, 1)) == \
        [(date(2025, 12, 31), date(2025, 12, 31)), (date(2026, 1, 1), date(2026, 1, 1))]


def test_bounded_history_window_with_no_rows_is_fine():
    t = Router({"/effr/search.json": Resp(200, b'{ "refRates": [] }')})
    [r] = adapter().fetch([EFFR], mode="history", start=date(2026, 7, 4), end=date(2026, 7, 4), http=client(t))
    assert r.observations == []


def test_rrp_filters_srf_repo_ops_client_side_and_stamps_last_updated():
    """Live 2026-09-28: the server ignores operationTypes=Reverse Repo; SRF 'Repo' ops come back too."""
    t = Router({RP_PATH: Resp(200, fx("rp_results_2026-09-21_2026-09-28.json"))})
    [r] = adapter().fetch([RRP], mode="latest", start=None, end=None, http=client(t))
    q = qs(t.sent[0])
    assert q == {"term": "overnight", "startDate": "2026-09-14", "endDate": "2026-09-28"}
    got = {o.period_start: o.value for o in r.observations}
    assert got["2026-09-28"] == 851000000.0                  # RAW USD, not the SRF 1,000,000
    assert got["2026-09-21"] == 582000000.0 and len(got) == 6
    last = r.observations[-1]
    # lastUpdated "2026-09-28 13:15:38" ET -> 17:15:38Z
    assert last.source_published_at == 1790615738


def test_rrp_sums_multiple_overnight_ops_and_single_refuses():
    doc = {"repo": {"operations": [
        {"operationDate": "2014-12-22", "operationType": "Reverse Repo", "term": "Overnight",
         "auctionStatus": "Results", "totalAmtAccepted": 1000},
        {"operationDate": "2014-12-22", "operationType": "Reverse Repo", "term": "Overnight",
         "auctionStatus": "Results", "totalAmtAccepted": 500},
        {"operationDate": "2014-12-22", "operationType": "Reverse Repo", "term": "Term",
         "auctionStatus": "Results", "totalAmtAccepted": 99999},
        {"operationDate": "2014-12-23", "operationType": "Reverse Repo", "term": "Overnight",
         "auctionStatus": "Announcement", "totalAmtAccepted": 0},
    ]}}
    obs = nyfed.parse_rp(doc, RRP_TOTAL)
    assert [(o.period_start, o.value) for o in obs] == [("2014-12-22", 1500.0)]
    single = spec("USRRP", RP_PATH, "totalAmtAccepted", filter={"term": "Overnight"}, aggregate="single")
    with pytest.raises(MalformedPayload, match="aggregate=single"):
        nyfed.parse_rp(doc, single)


def test_rrp_history_start_and_real_2014_payloads():
    t = Router({RP_PATH: Resp(200, fx("rp_results_2013-09.json"))})
    [r] = adapter().fetch([RRP], mode="history", start=date(2013, 9, 1), end=date(2013, 9, 30), http=client(t))
    assert r.observations[0].period_start == "2013-09-23" and r.observations[0].value == 11809000000.0
    d = json.loads(fx("rp_results_2014-12-15_2014-12-31_overnight.json"))
    got = {o.period_start: o.value for o in nyfed.parse_rp(d, RRP)}
    assert got["2014-12-31"] == 171120000000.0
    # legacy propositions path has no term field -> the Overnight filter must drop everything
    legacy = json.loads(fx("rp_propositions_2014-12-15_2015-01-05.json"))
    assert nyfed.parse_rp(legacy, RRP) == []


def test_rrp_primary_drops_small_value_exercise_2017_05_22():
    """Two overnight RRP ops on 2017-05-22: a 21 M$ MBS small-value exercise (close 10:00) + the
    185,031 M$ ON RRP (close 13:15). primary = latest closeTime; sum would add the test."""
    doc = json.loads(fx("rp_results_2017-05-22_overnight.json"))
    [o] = nyfed.parse_rp(doc, RRP)
    assert (o.period_start, o.value) == ("2017-05-22", 185031000000.0)
    assert o.source_published_at == nyfed._et_ts("2017-05-22 13:15:54")
    [t] = nyfed.parse_rp(doc, RRP_TOTAL)
    assert t.value == 185052000000.0
    treas = spec("R", RP_PATH, "details.amtAccepted", filter={"term": "Overnight"},
                 detail_filter={"securityType": "Treasury"})
    assert nyfed.parse_rp(doc, treas)[0].value == 185031000000.0
    rate = spec("R", RP_PATH, "details.percentAwardRate", filter={"term": "Overnight"}, aggregate="single")
    with pytest.raises(MalformedPayload, match="aggregate=single"):
        nyfed.parse_rp(doc, rate)
    rate_p = spec("R", RP_PATH, "details.percentAwardRate", filter={"term": "Overnight"}, aggregate="primary")
    assert nyfed.parse_rp(doc, rate_p)[0].value == 0.75


def test_primary_treasury_sve_and_missing_close_time():
    """2020-11-18 shape: Treasury SVE (close 10:00, 103 M$, EMPTY note) + regular op (13:15, 0)."""
    ops = [{"operationDate": "2020-11-18", "operationType": "Reverse Repo", "term": "Overnight",
            "auctionStatus": "Results", "closeTime": "10:00", "note": "", "totalAmtAccepted": 103000000},
           {"operationDate": "2020-11-18", "operationType": "Reverse Repo", "term": "Overnight",
            "auctionStatus": "Results", "closeTime": "13:15", "note": "", "totalAmtAccepted": 0}]
    [o] = nyfed.parse_rp({"repo": {"operations": ops}}, RRP)
    assert o.value == 0.0
    ops[0]["closeTime"] = None
    with pytest.raises(MalformedPayload, match="closeTime"):
        nyfed.parse_rp({"repo": {"operations": ops}}, RRP)
    with pytest.raises(MalformedPayload, match="aggregate"):
        nyfed.parse_rp({"repo": {"operations": ops}}, spec("X", RP_PATH, "totalAmtAccepted", aggregate="max"))


def test_details_field_path_award_rate():
    t = Router({RP_PATH: Resp(200, fx("rp_results_2026-09-21_2026-09-28.json"))})
    rate = spec("USONRRPRATE", RP_PATH, "details.percentAwardRate", "2013-09-23",
                filter={"operationType": "Reverse Repo", "term": "Overnight"}, aggregate="primary")
    [r] = adapter().fetch([rate], mode="latest", start=None, end=None, http=client(t))
    assert r.observations[-1].value == 3.75


def test_explicit_null_is_na_not_zero():
    doc = {"refRates": [{"effectiveDate": "2026-09-25", "type": "EFFR", "percentRate": None}]}
    [o] = nyfed.parse_rates(doc, EFFR)
    assert o.value is None


@pytest.mark.parametrize("resp,exc", [
    (Resp(200, b""), MalformedPayload),
    (Resp(200, b"{}"), MalformedPayload),
    (Resp(200, b"<!DOCTYPE html><html>Access Denied</html>", {"Content-Type": "text/html"}), MalformedPayload),
    (Resp(200, b'{"refRates": [ {"effectiveDate": '), MalformedPayload),
    (Resp(200, b'{"refRates": [ {"effectiveDate": "09/25/2026", "percentRate": 1} ]}'), MalformedPayload),
    (Resp(200, b'{"refRates": [ {"effectiveDate": "2026-09-25", "percentRate": "abc"} ]}'), MalformedPayload),
    (Resp(200, b'{"refRates": []}'), MalformedPayload),          # latest answered with nothing
    (Resp(400, b""), SourceUnavailable),
    (Resp(403, b"<html>blocked</html>"), SourceUnavailable),
    (Resp(302, b"", {"Location": "https://markets.newyorkfed.org/error"}), MalformedPayload),
])
def test_soft_and_hard_failures(resp, exc):
    t = Router({}, default=resp)
    with pytest.raises(exc):
        adapter().fetch([EFFR], mode="latest", start=None, end=None, http=client(t))


def test_bad_params():
    with pytest.raises(MalformedPayload):
        adapter().fetch([spec("X", "/api/rp/results/latest.json", "totalAmtAccepted")], mode="latest",
                        start=None, end=None, http=client(Router({})))
    with pytest.raises(MalformedPayload):
        adapter().fetch([spec("X", EFFR_PATH, "percent Rate; drop")], mode="latest",
                        start=None, end=None, http=client(Router({})))


def test_request_key_is_secret_free(monkeypatch):
    monkeypatch.setenv("EIA_API_KEY", "eiaTESTkey0987654321")
    t = Router({RP_PATH: Resp(200, fx("rp_results_2026-09-21_2026-09-28.json"))})
    [r] = adapter().fetch([RRP], mode="latest", start=None, end=None, http=client(t))
    assert secrets.redact(r.request_key) == r.request_key
    assert r.request_key == "nyfed:/api/rp/results/search.json?term=overnight:totalAmtAccepted:latest"
