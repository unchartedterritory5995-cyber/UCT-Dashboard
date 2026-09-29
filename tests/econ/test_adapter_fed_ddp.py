"""Fed Board adapter: release-page SDMX zips + DDP CSV packages (real trimmed payloads),
identity validation, NA markers, period grammar, transport fallback, soft failures,
conditional GET, RSS arrivals."""
from __future__ import annotations

import copy
import io
import re
import zipfile
from datetime import date
from pathlib import Path

import pytest

from api.services.econ import secrets
from api.services.econ.adapters import fed_ddp, get_adapter
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

FIX = Path(__file__).parent / "fixtures" / "fed_ddp"
PKG_H15 = "bf17364827e38702b42a58cf8eaa3f78"
PKG_H41 = "ccfdc0c8cb86be87af324da79a6f8826"
PKG_H6 = "798e2796917702a5f8423426ba7e6b42"
PKG_G17 = "809009461b1cba2fd5b4cf5557d9d663"


def fx(name: str) -> bytes:
    return (FIX / name).read_bytes()


def entry(sym, release, series, freq, units_raw, *, dataset=None, anchor="", **params):
    p = {"release": release, "series": series}
    if dataset:
        p["dataset"] = dataset
    p.update(params)
    return {"symbol": sym, "frequency": freq, "week_anchor": anchor,
            "units": {"raw": units_raw},
            "source": {"adapter": "fed_ddp", "provider_series_id": f"{release}/{dataset or release}/{series}",
                       "params": p}}


def S(*a, **k):
    return SeriesSpec(entry(*a, **k))


UST2Y = S("UST2Y", "H15", "RIFLGFCY02_N.B", "D", "Percent", dataset="H15")
UST10Y = S("UST10Y", "H15", "RIFLGFCY10_N.B", "D", "Percent", dataset="H15")
FEDBAL = S("USFEDBAL", "H41", "RESPPMA_N.WW", "W", "Millions USD", dataset="H41", anchor="WED")
M2 = S("USM2", "H6", "M2.M", "M", "Billions USD", dataset="H6_M2")
INDPRO = S("USINDPRO", "G17", "IP.B50001.S", "M", "Index 2017=100", dataset="IP_MARKET_GROUPS")


class Resp:
    def __init__(self, status=200, content=b"", headers=None):
        self.status_code = status
        self.content = content
        self.headers = headers or {}


class Router:
    """Serves by URL substring; each route is a list consumed in order (last repeats)."""

    def __init__(self, routes):
        self.routes = {k: (v if isinstance(v, list) else [v]) for k, v in routes.items()}
        self.sent = []

    def __call__(self, req):
        self.sent.append((req.url, dict(req.headers)))
        for k, q in self.routes.items():
            if k in req.url:
                r = q.pop(0) if len(q) > 1 else q[0]
                return r(req) if callable(r) else r
        return Resp(404, b"")


def client(t, **kw):
    return HttpClient(transport=t, sleep=lambda s: None, host_intervals={}, default_interval=0,
                      max_retries=0, **kw)


def zresp(rel):
    return Resp(200, fx(f"FRB_{rel}_xml_trim.zip"), {"Content-Type": "application/x-zip-compressed",
                                                     "ETag": f'"{rel}1"', "Last-Modified": "Mon, 28 Sep 2026 20:15:22 GMT"})


def csvresp(name):
    return Resp(200, fx(name), {"Content-Type": "text/csv"})


# --------------------------------------------------------------------------- registry + parsing

def test_registered_keyless():
    a = get_adapter("fed_ddp")
    assert isinstance(a, fed_ddp.FedDdpAdapter) and a.key_env is None
    assert a.default_transport == "release_xml"


def test_release_xml_history_all_cohort():
    t = Router({"/releases/h15/": zresp("h15"), "/releases/h41/": zresp("h41"),
                "/releases/h6/": zresp("h6"), "/releases/g17/": zresp("g17")})
    res = fed_ddp.FedDdpAdapter().fetch([UST2Y, UST10Y, FEDBAL, M2, INDPRO], mode="history",
                                        start=None, end=None, http=client(t))
    assert len(res) == 4                                    # one request per release file
    by = {}
    for r in res:
        for o in r.observations:
            by.setdefault(o.series_id, []).append(o)
    assert by["UST10Y"][-1].period_start == "2026-09-25" and by["UST10Y"][-1].value == 5.17
    assert by["UST2Y"][0].period_start == "1976-06-01"
    assert by["USFEDBAL"][-1].value == 6747704.0
    assert (by["USFEDBAL"][-1].period_start, by["USFEDBAL"][-1].period_end) == ("2026-09-17", "2026-09-23")
    assert by["USFEDBAL"][0].period_end == "2002-12-18"
    assert (by["USM2"][-1].period_start, by["USM2"][-1].period_end, by["USM2"][-1].value) == \
        ("2026-08-01", "2026-08-31", 23342.8)                # SDMX month-END date -> month bounds
    assert by["USM2"][0].period_start == "1959-01-01"
    assert by["USINDPRO"][-1].value == 103.0682 and by["USINDPRO"][0].period_start == "1919-01-01"
    h15 = next(r for r in res if ":H15:" in r.request_key)
    assert h15.request_key == "fed_ddp:release_xml:H15:-:RIFLGFCY02_N.B,RIFLGFCY10_N.B:..", h15.request_key
    assert h15.payload_sha256 and h15.raw_payload and h15.source_published_at is None


def test_sdmx_daily_nd_is_not_an_observation():
    """ND ("No data", the release zip's CL_OBS_STATUS) on a business-day series = a holiday:
    no period exists, so the row is DROPPED -- never a None that masks the prior day."""
    t = Router({"/releases/h15/": zresp("h15")})
    [r] = fed_ddp.FedDdpAdapter().fetch([UST10Y], mode="history", start=None, end=None, http=client(t))
    body = zipfile.ZipFile(io.BytesIO(zresp("h15").content))
    xml = body.read([n for n in body.namelist() if n.endswith("_data.xml")][0]).decode()
    seg = xml[xml.index('SERIES_NAME="RIFLGFCY10_N.B"'):]
    seg = seg[:seg.index("</kf:Series>")]
    assert 'OBS_STATUS="ND"' in seg, "fixture carries OBS_STATUS=ND rows"
    nd_days = set(re.findall(r'OBS_STATUS="ND" OBS_VALUE="-9999" TIME_PERIOD="([\d-]+)"', seg))
    assert nd_days
    got = {o.period_start for o in r.observations}
    assert not (nd_days & got)                                 # holidays carry no row at all
    assert not any(o.value is None for o in r.observations)
    assert not any(o.value == 0 or o.value == -9999 for o in r.observations)


def test_sdmx_nd_on_non_daily_series_stays_a_none_row():
    """Negative control: ND on a MONTHLY series is a stated missing period -> kept as None."""
    series = {"meta": {}, "rows": [("2026-07-31", "-9999", "ND"), ("2026-08-31", "23342.8", "A")]}
    obs = fed_ddp.to_obs(M2, series)
    assert [(o.period_start, o.value) for o in obs] == [("2026-07-01", None), ("2026-08-01", 23342.8)]


def test_sdmx_daily_na_nc_are_kept_as_none():
    """NA ("Not available") / NC ("Not calculable") are a missing value on a day that EXISTS."""
    series = {"meta": {}, "rows": [("2026-09-21", "-9999", "ND"), ("2026-09-22", "-9999", "NA"),
                                   ("2026-09-23", "-9999", "NC"), ("2026-09-24", "5.10", "A")]}
    obs = fed_ddp.to_obs(UST10Y, series)
    assert [(o.period_start, o.value) for o in obs] == [
        ("2026-09-22", None), ("2026-09-23", None), ("2026-09-24", 5.10)]


def test_history_window_and_latest_trim():
    t = Router({"/releases/h15/": zresp("h15")})
    a = fed_ddp.FedDdpAdapter()
    [r] = a.fetch([UST10Y], mode="history", start=date(2026, 9, 1), end=date(2026, 9, 18), http=client(t))
    ps = [o.period_start for o in r.observations]
    assert ps[0] >= "2026-09-01" and ps[-1] == "2026-09-18"
    [r] = a.fetch([UST10Y], mode="latest", start=None, end=None, http=client(t))
    assert len(r.observations) == fed_ddp.LATEST_N["D"] and r.observations[-1].period_start == "2026-09-25"


def test_g17_dataset_disambiguation():
    """IP.B50001.S sits in 3 G.17 datasets; params.dataset picks IP_MARKET_GROUPS; a wrong one refuses."""
    t = Router({"/releases/g17/": zresp("g17")})
    parsed = fed_ddp.parse_sdmx_zip(fx("FRB_g17_xml_trim.zip"), {"IP.B50001.S"})
    assert {k[0] for k in parsed} == {"IP_MAJOR_INDUSTRY_GROUPS", "IP_MARKET_GROUPS", "IP_SPECIAL_AGGREGATES"}
    bad = S("USINDPRO", "G17", "IP.B50001.S", "M", "Index 2017=100", dataset="NOPE")
    with pytest.raises(MalformedPayload, match="not present"):
        fed_ddp.FedDdpAdapter().fetch([bad], mode="history", start=None, end=None, http=client(t))


def test_identity_unit_multiplier_currency_fail_closed():
    t = Router({"/releases/h6/": zresp("h6"), "/releases/g17/": zresp("g17")})
    a = fed_ddp.FedDdpAdapter()
    wrong_mult = S("USM2", "H6", "M2.M", "M", "Millions USD", dataset="H6_M2")
    with pytest.raises(MalformedPayload, match="identity: multiplier"):
        a.fetch([wrong_mult], mode="history", start=None, end=None, http=client(t))
    # the G.17 annual revision (2026-11-24) re-bases IP to 2022=100: must refuse, not re-scale
    rebased = S("USINDPRO", "G17", "IP.B50001.S", "M", "Index 2022=100", dataset="IP_MARKET_GROUPS")
    with pytest.raises(MalformedPayload, match="identity: unit"):
        a.fetch([rebased], mode="history", start=None, end=None, http=client(t))
    explicit = S("USM2", "H6", "M2.M", "M", "whatever", dataset="H6_M2", unit="Currency",
                 multiplier=1e9, currency="USD")
    [r] = a.fetch([explicit], mode="latest", start=None, end=None, http=client(t))
    assert r.observations[-1].value == 23342.8


def test_expected_identity_derivation():
    e = fed_ddp.expected_identity(FEDBAL)
    assert e["multiplier"] == 1e6 and e["currency"] == "USD" and e["unit_re"].search("Currency")
    e = fed_ddp.expected_identity(UST10Y)
    assert e["multiplier"] == 1 and e["currency"] is None and e["unit_re"].search("Percent:_Per_Year")
    e = fed_ddp.expected_identity(INDPRO)
    assert e["unit_re"].search("Index:_2017_100") and not e["unit_re"].search("Index:_2022_100")


# --------------------------------------------------------------------------- DDP CSV packages

@pytest.mark.parametrize("spec,pkg,fixture,last", [
    (UST10Y, PKG_H15, "ddp_h15_cmt_lastobs5.csv", ("2026-09-25", "2026-09-25", 5.17)),
    (FEDBAL, PKG_H41, "ddp_h41_t5_lastobs5.csv", ("2026-09-17", "2026-09-23", 6747704.0)),
    (M2, PKG_H6, "ddp_h6_lastobs5.csv", ("2026-08-01", "2026-08-31", 23342.8)),
])
def test_ddp_package_seriescolumn(spec, pkg, fixture, last):
    e = copy.deepcopy(spec.raw)
    e["source"]["params"].update(transport="ddp_package", package=pkg)
    t = Router({"Output.aspx": csvresp(fixture)})
    [r] = fed_ddp.FedDdpAdapter().fetch([SeriesSpec(e)], mode="latest", start=None, end=None, http=client(t))
    o = r.observations[-1]
    assert (o.period_start, o.period_end, o.value) == last
    url = t.sent[0][0]
    assert f"series={pkg}" in url and "type=package" in url and "lastobs=" in url
    assert r.request_key.startswith(f"fed_ddp:ddp_package:{e['source']['params']['release']}:{pkg}:")


def test_ddp_package_seriesrow_g17_and_lastobs_soft_failure_retry():
    """Live 2026-09-28: G.17 package + lastobs -> 200 text/html EMPTY; full package works."""
    e = copy.deepcopy(INDPRO.raw)
    e["source"]["params"].update(transport="ddp_package", package=PKG_G17, layout="seriesrow")
    empty_html = Resp(200, b"", {"Content-Type": "text/html"})
    t = Router({"lastobs=13": empty_html, "lastobs=&": csvresp("ddp_g17_seriesrow_trim.csv")})
    [r] = fed_ddp.FedDdpAdapter().fetch([SeriesSpec(e)], mode="latest", start=None, end=None, http=client(t))
    assert len(t.sent) == 2 and "layout=seriesrow" in t.sent[1][0]
    assert r.observations[-1].period_start == "2026-08-01" and r.observations[-1].value == 103.0682
    assert len(r.observations) == 13


def test_ddp_csv_identity_dataset_mismatch():
    """Registry said H6/H6/M2.M; the package's Unique Identifier is H6/H6_M2/M2.M."""
    parsed = fed_ddp.parse_ddp_csv(fx("ddp_h6_lastobs5.csv"))
    assert parsed["M2.M"]["meta"]["uid"].strip() == "H6/H6_M2/M2.M"
    wrong = S("USM2", "H6", "M2.M", "M", "Billions USD", dataset="H6")
    with pytest.raises(MalformedPayload, match="identity"):
        fed_ddp.select_series(parsed, wrong)


def test_ddp_csv_na_markers():
    body = (b'"Series Description","x"\n"Unit:","Percent:_Per_Year"\n"Multiplier:","1"\n"Currency:","NA"\n'
            b'"Unique Identifier: ","H15/H15/RIFLGFCY10_N.B"\n"Time Period","RIFLGFCY10_N.B"\n'
            b'2026-09-21,ND\n2026-09-22,NC\n2026-09-23,NA\n2026-09-24,\n2026-09-25,5.17\n')
    obs = fed_ddp.to_obs(UST10Y, fed_ddp.select_series(fed_ddp.parse_ddp_csv(body), UST10Y))
    # daily: ND (holiday) is dropped; NC / NA / empty stay None on their (existing) day
    assert [(o.period_start, o.value) for o in obs] == [
        ("2026-09-22", None), ("2026-09-23", None), ("2026-09-24", None), ("2026-09-25", 5.17)]
    # negative control: the same cells on a MONTHLY series keep the ND row as None
    mbody = body.replace(b"RIFLGFCY10_N.B", b"M2.M").replace(b"H15/H15/", b"H6/H6_M2/").replace(
        b"Percent:_Per_Year", b"Currency").replace(b'"Currency:","NA"', b'"Currency:","USD"').replace(
        b'"Multiplier:","1"', b'"Multiplier:","1000000000"')
    mobs = fed_ddp.to_obs(M2, fed_ddp.select_series(fed_ddp.parse_ddp_csv(mbody.replace(b"2026-09-2", b"2026-0")), M2))
    assert mobs[0].value is None and len(mobs) == 5


@pytest.mark.parametrize("body,exc", [
    (b"", fed_ddp.TransportGone),
    (b"<!DOCTYPE html><html><body>Service retired</body></html>", fed_ddp.TransportGone),
    (b"garbage,only\n1,2\n", MalformedPayload),
    (b'"Series Description","x"\n"Unit:","Percent"\n', MalformedPayload),
])
def test_ddp_csv_malformed(body, exc):
    with pytest.raises(exc):
        fed_ddp.parse_ddp_csv(body)


def test_ddp_csv_non_numeric_value_malformed():
    body = fx("ddp_h15_cmt_lastobs5.csv").replace(b"5.17", b"x.17")
    parsed = fed_ddp.parse_ddp_csv(body)
    with pytest.raises(MalformedPayload, match="non-numeric"):
        fed_ddp.to_obs(UST10Y, fed_ddp.select_series(parsed, UST10Y))


def test_missing_series_in_package_malformed():
    parsed = fed_ddp.parse_ddp_csv(fx("ddp_h15_cmt_lastobs5.csv"))
    ghost = S("UST99Y", "H15", "RIFLGFCY99_N.B", "D", "Percent", dataset="H15")
    with pytest.raises(MalformedPayload, match="not present"):
        fed_ddp.select_series(parsed, ghost)


# --------------------------------------------------------------------------- SDMX malformed

def _zip(members: dict) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for k, v in members.items():
            z.writestr(k, v)
    return b.getvalue()


@pytest.mark.parametrize("body,exc", [
    (b"", fed_ddp.TransportGone),
    (b"<html><head><title>Page Not Found</title></head></html>", fed_ddp.TransportGone),
    (b"PK\x03\x04 truncated", MalformedPayload),
    (_zip({"readme.txt": "x"}), MalformedPayload),
    (_zip({"H15_data.xml": "<a><b>"}), MalformedPayload),
])
def test_sdmx_malformed(body, exc):
    with pytest.raises(exc):
        fed_ddp.parse_sdmx_zip(body, {"RIFLGFCY10_N.B"})


def test_sdmx_partial_zip_missing_series_malformed():
    t = Router({"/releases/h15/": zresp("h15")})
    ghost = S("UST99Y", "H15", "RIFLGFCY99_N.B", "D", "Percent", dataset="H15")
    with pytest.raises(MalformedPayload):
        fed_ddp.FedDdpAdapter().fetch([UST10Y, ghost], mode="latest", start=None, end=None, http=client(t))


# --------------------------------------------------------------------------- transports

def test_transport_fallback_when_release_file_gone():
    """release_xml 404 -> ddp_zip (same SDMX format from the DDP app), with a warning."""
    t = Router({"/releases/h15/": Resp(404, b"not found"), "filetype=zip": zresp("h15")})
    [r] = fed_ddp.FedDdpAdapter().fetch([UST10Y], mode="latest", start=None, end=None, http=client(t))
    assert r.observations[-1].value == 5.17
    assert r.request_key.startswith("fed_ddp:ddp_zip:H15:")
    assert any("falling back to ddp_zip" in w for w in r.warnings)


def test_ddp_package_retired_falls_back_to_release_xml():
    e = copy.deepcopy(UST10Y.raw)
    e["source"]["params"].update(transport="ddp_package", package=PKG_H15)
    retired = Resp(200, b"<!DOCTYPE html><html>The DDP has been retired</html>", {"Content-Type": "text/html"})
    t = Router({"Output.aspx": retired, "/releases/h15/": zresp("h15")})
    [r] = fed_ddp.FedDdpAdapter().fetch([SeriesSpec(e)], mode="history", start=None, end=None, http=client(t))
    assert r.request_key.startswith("fed_ddp:release_xml:H15:") and r.observations[-1].value == 5.17


def test_fallback_disabled_raises():
    e = copy.deepcopy(UST10Y.raw)
    e["source"]["params"]["fallback"] = []
    t = Router({"/releases/h15/": Resp(404, b"")})
    with pytest.raises(SourceUnavailable):
        fed_ddp.FedDdpAdapter().fetch([SeriesSpec(e)], mode="latest", start=None, end=None, http=client(t))


def test_5xx_is_source_unavailable_not_fallback():
    t = Router({"/releases/h15/": Resp(503, b"")})
    with pytest.raises(SourceUnavailable) as ei:
        fed_ddp.FedDdpAdapter().fetch([UST10Y], mode="latest", start=None, end=None, http=client(t))
    assert not isinstance(ei.value, fed_ddp.TransportGone)
    assert all("filetype=zip" not in u for u, _ in t.sent)


def test_ddp_package_needs_hash_and_unknown_transport():
    e = copy.deepcopy(UST10Y.raw)
    e["source"]["params"]["transport"] = "ddp_package"
    with pytest.raises(MalformedPayload, match="package"):
        fed_ddp.FedDdpAdapter().group([SeriesSpec(e)])
    e["source"]["params"]["transport"] = "fred"
    with pytest.raises(MalformedPayload, match="unknown fed_ddp transport"):
        fed_ddp.FedDdpAdapter().group([SeriesSpec(e)])


def test_url_construction():
    u = fed_ddp.FedDdpAdapter.url_for
    assert u("release_xml", "H41") == "https://www.federalreserve.gov/releases/h41/data/FRB_h41_xml.zip"
    assert u("ddp_zip", "H15") == "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&filetype=zip"
    p = u("ddp_package", "G17", package=PKG_G17, layout="seriesrow", lastobs=5)
    assert "rel=G17" in p and "lastobs=5" in p and "layout=seriesrow" in p and "type=package" in p


def test_request_key_never_carries_secrets(monkeypatch):
    monkeypatch.setenv("BLS_API_KEY", "blsTESTkey1234567890")
    t = Router({"/releases/h15/": zresp("h15")})
    [r] = fed_ddp.FedDdpAdapter().fetch([UST10Y], mode="latest", start=None, end=None, http=client(t))
    assert secrets.redact(r.request_key) == r.request_key and "key" not in r.request_key.lower()


# --------------------------------------------------------------------------- conditional GET

class VStore:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def put(self, k, etag, lm):
        self.d[k] = (etag, lm)


def test_latest_uses_conditional_get_history_does_not():
    vs = VStore()
    seen = []

    def serve(req):
        seen.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match") == '"h151"':
            return Resp(304, b"")
        return zresp("h15")
    t = Router({"/releases/h15/": serve})
    a, h = fed_ddp.FedDdpAdapter(), client(t, validator_store=vs)
    [r1] = a.fetch([UST10Y], mode="latest", start=None, end=None, http=h)
    [r2] = a.fetch([UST10Y], mode="latest", start=None, end=None, http=h)
    assert r1.observations and not r1.not_modified
    assert r2.not_modified and r2.observations == []
    [r3] = a.fetch([UST10Y], mode="history", start=None, end=None, http=h)
    assert r3.observations and seen == [None, '"h151"', None]


def test_bad_200_does_not_store_validators():
    """A 200 whose payload fails parsing/identity must not make the next poll a 304."""
    vs = VStore()
    seen = []
    bodies = [Resp(200, b"PK\x03\x04 truncated", {"ETag": '"bad"'}), zresp("h15")]

    def serve(req):
        seen.append(req.headers.get("If-None-Match"))
        return bodies.pop(0)
    t = Router({"/releases/h15/": serve})
    a, h = fed_ddp.FedDdpAdapter(), client(t, validator_store=vs)
    with pytest.raises(MalformedPayload):
        a.fetch([UST10Y], mode="latest", start=None, end=None, http=h)
    [r] = a.fetch([UST10Y], mode="latest", start=None, end=None, http=h)
    assert seen == [None, None] and r.observations
    assert list(vs.d.values()) == [('"h151"', "Mon, 28 Sep 2026 20:15:22 GMT")]


# --------------------------------------------------------------------------- RSS arrivals

def test_parse_feed_g17_data_items_and_html_entities():
    items = fed_ddp.parse_feed(fx("feed_g17_trim.xml"))
    data = [i for i in items if i["kind"] == "data"]
    assert data[0]["title"] == "G.17 Data for August 2026 are now available"
    assert data[0]["release"] == "G17"
    assert data[0]["published_at"] == 1789737300            # 2026-09-18T09:15:00-04:00
    assert any(i["kind"] == "notice" and "Annual Revision" in i["title"] for i in items)


def test_parse_feed_h15_is_notice_only():
    items = fed_ddp.parse_feed(fx("feed_h15_trim.xml"))
    assert items and all(i["kind"] == "notice" for i in items)


def test_arrivals_filters_and_soft_failures():
    t = Router({"/feeds/datadownload.xml": Resp(200, fx("feed_datadownload_trim.xml")),
                "/feeds/g17.xml": Resp(200, fx("feed_g17_trim.xml"))})
    a = fed_ddp.FedDdpAdapter()
    allx = a.arrivals(client(t))
    assert allx and allx == sorted(allx, key=lambda i: i["published_at"], reverse=True)
    g = a.arrivals(client(t), release="G17", kinds=("data",), since=1789000000)
    assert [i["title"] for i in g] == ["G.17 Data for August 2026 are now available"]
    for bad in (Resp(200, b""), Resp(200, b"<html>blocked</html>"), Resp(200, b"<rdf:RDF")):
        with pytest.raises(MalformedPayload):
            a.arrivals(client(Router({"/feeds/": bad})))


def test_package_links_from_choose_html():
    html = ('<a href="Output.aspx?rel=G17&amp;series=809009461b1cba2fd5b4cf5557d9d663&amp;lastobs=&amp;'
            'from=&amp;to=&amp;filetype=csv&amp;label=include&amp;layout=seriesrow&amp;type=package">')
    assert fed_ddp.package_links(html, "G17") == [{"package": PKG_G17, "layout": "seriesrow"}]


def test_period_grammar():
    assert fed_ddp.period_of("2026-08", M2) == ("2026-08-01", "2026-08-31")
    assert fed_ddp.period_of("2026-02-28", M2) == ("2026-02-01", "2026-02-28")
    assert fed_ddp.period_of("2026-09-23", FEDBAL) == ("2026-09-17", "2026-09-23")
    with pytest.raises(MalformedPayload):
        fed_ddp.period_of("2026-09-24", FEDBAL)                 # a Thursday is not a WED week-end
    with pytest.raises(MalformedPayload):
        fed_ddp.period_of("Sep 2026", M2)
    q = S("USX", "Z1", "X.Q", "Q", "Millions USD")
    assert fed_ddp.period_of("2026Q2", q) == ("2026-04-01", "2026-06-30")
    assert fed_ddp.period_of("2026-06-30", q) == ("2026-04-01", "2026-06-30")
