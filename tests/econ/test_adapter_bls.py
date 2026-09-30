"""BLS adapter: parsing (real v1 payloads), period grammar, NA markers, truncation,
quota, soft failures, keyed-vs-keyless request construction, planning/budget, probe."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from api.services.econ import secrets
from api.services.econ.adapters import bls, get_adapter
from api.services.econ.adapters.base import as_specs
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

FIX = Path(__file__).parent / "fixtures" / "bls"
NOW = 1790600000            # 2026-09-28 (UTC)
KEY = "blsTESTkey1234567890"

COHORT = [
    ("USCPI", "CUSR0000SA0", "M", "1947-01"), ("USCPINSA", "CUUR0000SA0", "M", "1913-01"),
    ("USCORECPI", "CUSR0000SA0L1E", "M", "1957-01"), ("USCORECPINSA", "CUUR0000SA0L1E", "M", "1957-01"),
    ("USPPIFD", "WPSFD4", "M", "2009-11"), ("USECI", "CIS1010000000000Q", "Q", "2001-Q1"),
    ("USUNRATE", "LNS14000000", "M", "1948-01"), ("USNFP", "CES0000000001", "M", "1939-01"),
    ("USJOLTSO", "JTS000000000000000JOL", "M", "2000-12"),
]


def entry(sym, sid, freq="M", hs=None):
    return {"symbol": sym, "frequency": freq, "history_start": hs,
            "source": {"agency": "BLS", "provider_series_id": sid, "adapter": "bls",
                       "params": {"series_id": sid}}}


SPECS = as_specs([entry(*c) for c in COHORT])


class Resp:
    def __init__(self, status=200, content=b"", headers=None):
        self.status_code = status
        self.content = content if isinstance(content, bytes) else content.encode()
        self.headers = headers or {"Content-Type": "text/plain;charset=ISO-8859-1"}


class Transport:
    """Serves queued responses; records (url, decoded body)."""

    def __init__(self, *responses):
        self.queue = list(responses)
        self.sent = []

    def __call__(self, req):
        self.sent.append((req.url, json.loads(req.body.decode())))
        r = self.queue.pop(0)
        return r(req) if callable(r) else r


def client(t):
    return HttpClient(transport=t, sleep=lambda s: None, host_intervals={}, default_interval=0,
                      max_retries=0)


def adapter(**kw):
    return bls.BlsAdapter(clock=lambda: NOW, **kw)


def payload(series: dict, status="REQUEST_SUCCEEDED", message=None) -> bytes:
    return json.dumps({"status": status, "responseTime": 10, "message": message or [],
                       "Results": {"series": [{"seriesID": k, "data": v} for k, v in series.items()]}}).encode()


def row(year, period, value, code=None, latest=False):
    r = {"year": str(year), "period": period, "periodName": "x", "value": value,
         "footnotes": [{"code": code, "text": "preliminary"}] if code else [{}]}
    if latest:
        r["latest"] = "true"
    return r


@pytest.fixture(autouse=True)
def no_key(monkeypatch):
    monkeypatch.delenv("BLS_API_KEY", raising=False)


# --------------------------------------------------------------------------- real payloads

def test_real_v1_cohort_window_parses():
    t = Transport(Resp(200, (FIX / "v1_cohort_2017_2026.json").read_bytes()))
    res = adapter().fetch(SPECS, mode="history", start=date(2017, 1, 1), end=None, http=client(t))
    assert len(res) == 1 and len(t.sent) == 1
    r = res[0]
    assert r.adapter == "bls" and r.http_status == 200 and r.source_published_at is None
    assert r.request_key == ("bls:v1:" + ",".join(c[1] for c in COHORT) + ":2017-2026")
    by = {(o.series_id, o.period_start): o for o in r.observations}
    assert by[("USCPI", "2026-08-01")].value == 334.131
    assert by[("USCPINSA", "2026-08-01")].value == 334.980
    assert by[("USCORECPI", "2026-08-01")].value == 337.765
    assert by[("USUNRATE", "2026-08-01")].value == 4.1
    nfp = by[("USNFP", "2026-08-01")]
    assert (nfp.value, nfp.flag, nfp.period_end) == (159075.0, "p", "2026-08-31")
    assert by[("USNFP", "2026-06-01")].flag == ""
    # 2025 lapse in appropriations: '-' with footnote X -> None, never 0
    assert by[("USCPI", "2025-10-01")].value is None
    eci = by[("USECI", "2026-04-01")]
    assert (eci.period_end, eci.value) == ("2026-06-30", 0.9)
    assert not any(o.series_id == "USECI" and o.period_start[5:7] not in ("01", "04", "07", "10")
                   for o in r.observations)
    assert max(o.period_start for o in r.observations if o.series_id == "USJOLTSO") == "2026-07-01"
    assert {o.series_id for o in r.observations} == {c[0] for c in COHORT}
    assert r.payload_sha256 and r.payload_bytes == len((FIX / "v1_cohort_2017_2026.json").read_bytes())
    # v1 body: no key, no v2-only fields
    url, body = t.sent[0]
    assert url == bls.V1_URL and body == {"seriesid": [c[1] for c in COHORT],
                                          "startyear": "2017", "endyear": "2026"}


def test_real_v1_early_window_no_data_messages_are_benign():
    t = Transport(Resp(200, (FIX / "v1_cohort_1913_1916.json").read_bytes()))
    a = adapter(trim_to_history_start=False)
    res = a.fetch(SPECS, mode="history", start=date(1913, 1, 1), end=date(1916, 12, 31), http=client(t))
    obs = res[0].observations
    assert len(obs) == 48 and {o.series_id for o in obs} == {"USCPINSA"}
    assert obs[0].period_start == "1913-01-01"
    assert any("no data for CES0000000001" in w for w in res[0].warnings)


def test_real_v1_truncation_notice_is_malformed():
    """Phase 0 proof: v1 silently cut 2000-2026 to 10 years (status SUCCEEDED)."""
    t = Transport(Resp(200, (FIX / "v1_truncated_phase0.json").read_bytes()))
    specs = as_specs([entry(*c) for c in COHORT[:4]] + [entry("USUNRATE", "LNS14000000")])
    with pytest.raises(MalformedPayload, match="partial"):
        adapter().fetch(specs, mode="history", start=date(2000, 1, 1), end=date(2009, 12, 31),
                        http=client(t))


# --------------------------------------------------------------------------- grammar

@pytest.mark.parametrize("period,expect", [
    ("M01", ("2026-01-01", "2026-01-31", "M")), ("M02", ("2026-02-01", "2026-02-28", "M")),
    ("M12", ("2026-12-01", "2026-12-31", "M")), ("Q01", ("2026-01-01", "2026-03-31", "Q")),
    ("Q04", ("2026-10-01", "2026-12-31", "Q")),
    ("M13", None), ("Q05", None), ("S01", None), ("S02", None), ("S03", None), ("A01", None)])
def test_period_grammar(period, expect):
    assert bls.parse_period("2026", period) == expect


@pytest.mark.parametrize("bad", ["M00", "M14", "Q00", "Q06", "W01", "", "2026-08"])
def test_period_grammar_rejects(bad):
    with pytest.raises(ValueError):
        bls.parse_period("2026", bad)


@pytest.mark.parametrize("raw", ["-", "(NA)", "NA", "(X)", "", None, "–"])
def test_na_markers_are_none(raw):
    assert bls.parse_value(raw) is None


def test_values_and_flags():
    assert bls.parse_value("159,075") == 159075.0 and bls.parse_value(" 4.1 ") == 4.1
    for bad in ("abc", "nan", "inf", "4.1x"):
        with pytest.raises(ValueError):
            bls.parse_value(bad)
    assert bls.parse_flag([{"code": "P", "text": "preliminary"}]) == "p"
    assert bls.parse_flag([{}]) == "" and bls.parse_flag(None) == ""
    assert bls.parse_flag([{"code": "X", "text": "Data unavailable"}]) == ""


def _one(series, specs=None, start=2025, end=2026, **pl):
    specs = specs or as_specs([entry("USCPI", "CUSR0000SA0")])
    t = Transport(Resp(200, payload(series, **pl)))
    return adapter().fetch(specs, mode="history", start=date(start, 1, 1), end=date(end, 1, 1),
                           http=client(t))[0]


def test_m13_and_semiannual_skipped():
    r = _one({"CUSR0000SA0": [row(2025, "M13", "300.0"), row(2025, "S01", "299"),
                              row(2025, "M12", "(NA)"), row(2025, "M11", "301.5")]})
    assert [(o.period_start, o.value) for o in r.observations] == [("2025-11-01", 301.5),
                                                                   ("2025-12-01", None)]


@pytest.mark.parametrize("series,match", [
    ({"CUSR0000SA0": [row(2025, "Q01", "1.0")]}, "schema"),               # Q period, M series
    ({"CUSR0000SA0": [row(2025, "X07", "1.0")]}, "schema"),               # unknown code
    ({"CUSR0000SA0": [row(2019, "M01", "1.0")]}, "partial"),              # outside window
    ({"CUSR0000SA0": [row(2025, "M01", "n/a?")]}, "numeric"),
    ({"CUSR0000SA0": [], "CUUR0000SA0": []}, "identity"),                  # unrequested series
    ({}, "partial"),                                                       # silently omitted
])
def test_malformed_rows(series, match):
    with pytest.raises(MalformedPayload, match=match):
        _one(series)


def test_quarterly_series_rejects_monthly_periods():
    specs = as_specs([entry("USECI", "CIS1010000000000Q", "Q")])
    with pytest.raises(MalformedPayload, match="schema"):
        _one({"CIS1010000000000Q": [row(2025, "M01", "1.0")]}, specs=specs)


def test_invalid_series_is_a_warning_not_a_crash():
    specs = as_specs([entry("USCPI", "CUSR0000SA0"), entry("USX", "BOGUS123")])
    r = _one({"CUSR0000SA0": [row(2025, "M01", "300")]}, specs=specs,
             message=["Invalid Series for Series BOGUS123"])
    assert [o.series_id for o in r.observations] == ["USCPI"]
    assert any(w.startswith("identity:") and "BOGUS123" in w for w in r.warnings)


def test_unknown_message_surfaces_as_warning():
    r = _one({"CUSR0000SA0": []}, message=["Something new from BLS"])
    assert r.observations == [] and any("Something new" in w for w in r.warnings)


# --------------------------------------------------------------------------- soft failures

@pytest.mark.parametrize("resp,exc,match", [
    (Resp(200, b""), MalformedPayload, "empty"),
    (Resp(200, b"{}"), MalformedPayload, "empty"),
    (Resp(200, b"<!DOCTYPE html><html>Access Denied</html>"), MalformedPayload, "HTML"),
    (Resp(200, b"garbage{"), MalformedPayload, "not JSON"),
    (Resp(200, b"[1,2]"), MalformedPayload, "object"),
    (Resp(200, json.dumps({"status": "WHAT", "message": []}).encode()), MalformedPayload, "unknown status"),
    (Resp(200, json.dumps({"status": "REQUEST_SUCCEEDED", "message": []}).encode()), MalformedPayload,
     "Results"),
])
def test_soft_failures(resp, exc, match):
    t = Transport(resp)
    with pytest.raises(exc, match=match):
        adapter().fetch(SPECS[:1], mode="latest", start=None, end=None, http=client(t))


@pytest.mark.parametrize("status,reason", [(403, "http_403"), (302, "redirect"), (404, "http_404")])
def test_http_errors_are_source_unavailable(status, reason):
    t = Transport(Resp(status, b"", {"Location": "https://www.bls.gov/error.htm"}))
    with pytest.raises(bls.BlsUnavailable) as ei:
        adapter().fetch(SPECS[:1], mode="latest", start=None, end=None, http=client(t))
    assert ei.value.reason == reason and isinstance(ei.value, SourceUnavailable)


@pytest.mark.parametrize("msg", [
    "Request could not be serviced, as the daily threshold for total number of requests "
    "allocated to the user has been reached.",
    "The daily threshold for total number of requests allocated to the user with registration "
    "key has been reached.",
])
def test_quota_is_distinguishable(msg, monkeypatch):
    monkeypatch.setenv("BLS_API_KEY", KEY)
    t = Transport(Resp(200, json.dumps({"status": "REQUEST_NOT_PROCESSED", "message": [msg],
                                        "Results": {}}).encode()))
    with pytest.raises(bls.BlsQuotaExhausted) as ei:
        adapter().fetch(SPECS[:1], mode="latest", start=None, end=None, http=client(t))
    e = ei.value
    assert isinstance(e, SourceUnavailable) and e.reason == "quota" and str(e).startswith("quota:")
    assert e.not_before > NOW and e.not_before - NOW < 2 * 86400
    assert KEY not in str(e) and KEY not in secrets.safe_exc(e)


def test_not_processed_key_rejected(monkeypatch):
    monkeypatch.setenv("BLS_API_KEY", KEY)
    t = Transport(Resp(200, json.dumps({"status": "REQUEST_NOT_PROCESSED",
                                        "message": ["The key provided by the User is invalid."]}).encode()))
    with pytest.raises(bls.BlsUnavailable) as ei:
        adapter().fetch(SPECS[:1], mode="latest", start=None, end=None, http=client(t))
    assert ei.value.reason == "key_rejected" and KEY not in str(ei.value)


# --------------------------------------------------------------------------- keyed vs keyless

def _empty_for(req):
    body = json.loads(req.body.decode())
    return Resp(200, payload({s: [] for s in body["seriesid"]}))


def test_keyed_request_construction(monkeypatch):
    monkeypatch.setenv("BLS_API_KEY", KEY)
    t = Transport(*[_empty_for] * 6)
    a = adapter(trim_to_history_start=False)
    res = a.fetch(SPECS, mode="history", start=date(1913, 1, 1), end=None, http=client(t))
    assert len(res) == 6 == len(t.sent) == a.queries_sent          # 114 years / 20
    for (url, body), r in zip(t.sent, res):
        assert url == bls.V2_URL
        assert body["registrationkey"] == KEY and body["catalog"] is False
        assert body["calculations"] is False and body["annualaverage"] is False
        assert "latest" not in body
        assert int(body["endyear"]) - int(body["startyear"]) + 1 <= 20
        assert r.request_key.startswith("bls:v2:") and KEY not in r.request_key
        assert secrets.redact(r.request_key) == r.request_key
        assert KEY.encode() not in (r.raw_payload or b"")
    assert [(b["startyear"], b["endyear"]) for _, b in t.sent][0] == ("1913", "1926")
    assert t.sent[-1][1]["endyear"] == "2026"


def test_keyless_windows_are_ten_years():
    t = Transport(*[_empty_for] * 12)
    a = adapter(trim_to_history_start=False)
    a.fetch(SPECS, mode="history", start=None, end=None, http=client(t))
    spans = [(int(b["startyear"]), int(b["endyear"])) for _, b in t.sent]
    assert len(spans) == 12 and all(u - l + 1 <= 10 for l, u in spans)
    assert spans[0][0] == 1913 and spans[-1] == (2017, 2026)
    assert all(spans[i][1] + 1 == spans[i + 1][0] for i in range(len(spans) - 1))   # contiguous
    assert all(url == bls.V1_URL and "registrationkey" not in b for url, b in t.sent)


def test_latest_mode_is_one_query_two_years():
    t = Transport(_empty_for)
    adapter().fetch(SPECS, mode="latest", start=None, end=None, http=client(t))
    assert len(t.sent) == 1 and (t.sent[0][1]["startyear"], t.sent[0][1]["endyear"]) == ("2025", "2026")


# --------------------------------------------------------------------------- planning / budget

def test_estimate_queries_budget():
    assert bls.estimate_queries(SPECS, date(1913, 1, 1), None, False) == 12
    assert bls.estimate_queries(SPECS, date(1913, 1, 1), None, True) == 6
    assert bls.estimate_queries(SPECS, None, None, False, mode="latest") == 1
    thirty = as_specs([entry(f"USX{i}", f"CUSR{i:07d}") for i in range(30)])
    assert bls.estimate_queries(thirty, date(2017, 1, 1), date(2026, 1, 1), False) == 2   # 25 + 5
    assert bls.estimate_queries(thirty, date(2017, 1, 1), date(2026, 1, 1), True) == 1    # 50
    assert adapter().estimate_queries(SPECS, date(2017, 1, 1), None) == 1


def test_history_start_trims_windows_and_payload():
    qs = bls.plan_queries(SPECS, mode="history", keyed=False, today=date(2026, 9, 28))
    first = qs[0]
    assert (first.start_year, first.end_year) == (1913, 1916) and first.series_ids == ("CUUR0000SA0",)
    last = qs[-1]
    assert len(last.series_ids) == 9
    assert bls.year_windows(1913, 2026, 10)[0] == (1913, 1916)
    assert bls.year_windows(2026, 2025, 10) == []


def test_series_id_params_contract():
    assert bls.series_id_of(as_specs([{"symbol": "USA", "source": {"params": {"seriesid": "abc"}}}])[0]) == "ABC"
    assert bls.series_id_of(as_specs([{"symbol": "USA", "source": {"provider_series_id": "X1"}}])[0]) == "X1"
    with pytest.raises(ValueError):
        bls.series_id_of(as_specs([{"symbol": "USA", "source": {}}])[0])


# --------------------------------------------------------------------------- probe

def test_probe_keyless_uses_real_payload():
    # the fixture spans 2017-2026; a probe asks 2025-2026, so serve a filtered copy
    doc = json.loads((FIX / "v1_cohort_2017_2026.json").read_bytes())
    for s in doc["Results"]["series"]:
        s["data"] = [r for r in s["data"] if int(r["year"]) >= 2025]
    t = Transport(Resp(200, json.dumps(doc).encode()))
    out = adapter().latest_period_probe(SPECS, client(t))
    assert out == {"USCPI": "2026-08-01", "USCPINSA": "2026-08-01", "USCORECPI": "2026-08-01",
                   "USCORECPINSA": "2026-08-01", "USPPIFD": "2026-08-01", "USECI": "2026-04-01",
                   "USUNRATE": "2026-08-01", "USNFP": "2026-08-01", "USJOLTSO": "2026-07-01"}
    assert len(t.sent) == 1 and t.sent[0][1]["startyear"] == "2025"


def test_probe_keyed_latest_true(monkeypatch):
    monkeypatch.setenv("BLS_API_KEY", KEY)
    specs = as_specs([entry("USCPI", "CUSR0000SA0"), entry("USECI", "CIS1010000000000Q", "Q")])
    t = Transport(Resp(200, payload({"CUSR0000SA0": [row(2026, "M08", "334.131", latest=True)],
                                     "CIS1010000000000Q": [row(2026, "Q02", "0.9", latest=True)]})))
    out = adapter().latest_period_probe(specs, client(t))
    assert out == {"USCPI": "2026-08-01", "USECI": "2026-04-01"}
    body = t.sent[0][1]
    assert body["latest"] is True and "startyear" not in body and body["registrationkey"] == KEY


def test_probe_latest_marker_disagreement_is_malformed():
    t = Transport(Resp(200, payload({"CUSR0000SA0": [row(2026, "M08", "334.1"),
                                                     row(2026, "M07", "333.9", latest=True)]})))
    with pytest.raises(MalformedPayload, match="latest marker"):
        adapter().latest_period_probe(as_specs([entry("USCPI", "CUSR0000SA0")]), client(t))


def test_registered_and_contract():
    a = get_adapter("bls")
    assert isinstance(a, bls.BlsAdapter) and a.key_env == "BLS_API_KEY"
    assert a.max_series_per_request == 50 and bls.LIMITS["v1"].series_per_query == 25
