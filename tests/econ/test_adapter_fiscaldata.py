"""Treasury Fiscal Data adapter: real trimmed payloads (tests/econ/fixtures/fiscaldata/)."""
from __future__ import annotations

import copy
import json
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest

from api.services.econ import registry, validate
from api.services.econ.adapters import fiscaldata as fd
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

FIX = Path(__file__).parent / "fixtures" / "fiscaldata"


def _load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def _resp(body, status=200, ctype="application/json", headers=None):
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
    h = {"Content-Type": ctype}
    h.update(headers or {})
    return SimpleNamespace(status_code=status, headers=h, content=body)


class Transport:
    """Routes by a callable(url, query) -> response; records every request."""

    def __init__(self, route):
        self.route, self.requests = route, []

    def __call__(self, req):
        self.requests.append(req)
        q = parse_qs(urlsplit(req.url).query)
        return self.route(req.url, q)


def _client(route):
    t = Transport(route)
    return HttpClient(transport=t, sleep=lambda s: None, max_retries=0, default_interval=0,
                      host_intervals={}), t


def _spec(sym, **param_overrides):
    e = copy.deepcopy(registry.get(sym))
    e["source"]["params"].update(param_overrides)
    return SeriesSpec(e)


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(fd, "_utcnow", lambda: datetime(2026, 9, 28, 22, 0, tzinfo=timezone.utc))


# ─────────────────────────── debt to the penny ───────────────────────────


def test_debt_history_single_page_and_request_shape():
    http, t = _client(lambda url, q: _resp(_load("debt_recent.json")))
    [res] = fd.FiscalDataAdapter().fetch([_spec("USDEBT")], mode="history", start=None, end=None, http=http)
    obs = res.observations
    assert len(obs) == 9 and obs[-1].period_start == obs[-1].period_end == "2026-09-25"
    assert obs[-1].value == 40097178119750.91                 # Phase 0: $40.097T
    assert all(o.series_id == "USDEBT" and o.flag == "" for o in obs)
    q = parse_qs(urlsplit(t.requests[0].url).query)
    assert urlsplit(t.requests[0].url).path.endswith("/v2/accounting/od/debt_to_penny")
    assert q["page[size]"] == ["10000"] and q["page[number]"] == ["1"] and q["sort"] == ["record_date"]
    assert set(q["fields"][0].split(",")) == {"record_date", "tot_pub_debt_out_amt"}
    assert "filter" not in q                                   # history, no window -> everything
    assert res.request_key == "fiscaldata:v2/accounting/od/debt_to_penny:tot_pub_debt_out_amt:history:.."
    assert res.source_published_at is None and res.http_status == 200 and res.payload_bytes > 0
    assert validate.check_schema(registry.get("USDEBT"), obs) == []


def test_debt_paging_follows_links_next():
    pages = {"1": _load("debt_p1.json"), "2": _load("debt_p2.json")}
    http, t = _client(lambda url, q: _resp(pages[q["page[number]"][0]]))
    [res] = fd.FiscalDataAdapter().fetch([_spec("USDEBT")], mode="history", start=date(2026, 9, 15),
                                         end=None, http=http)
    assert len(t.requests) == 2 and len(res.observations) == 9
    assert [o.period_start for o in res.observations] == sorted(o.period_start for o in res.observations)
    assert parse_qs(urlsplit(t.requests[0].url).query)["filter"] == ["record_date:gte:2026-09-15"]


def test_partial_page_set_is_malformed():
    p1 = _load("debt_p1.json")
    p1["links"]["next"] = None                                  # total-count 9, only 5 delivered
    http, _ = _client(lambda url, q: _resp(p1))
    with pytest.raises(MalformedPayload, match="partial"):
        fd.FiscalDataAdapter().fetch([_spec("USDEBT")], mode="history", start=None, end=None, http=http)


def test_latest_window_and_null_marker():
    doc = _load("debt_recent.json")
    doc["data"][-1]["tot_pub_debt_out_amt"] = "null"
    http, t = _client(lambda url, q: _resp(doc))
    [res] = fd.FiscalDataAdapter().fetch([_spec("USDEBT")], mode="latest", start=None, end=None, http=http)
    q = parse_qs(urlsplit(t.requests[0].url).query)
    assert q["filter"] == ["record_date:gte:2026-09-07"]        # today - latest_days(21)
    assert res.observations[-1].value is None                   # NA, never 0
    assert res.request_key.startswith("fiscaldata:v2/accounting/od/debt_to_penny:tot_pub_debt_out_amt:latest:2026-09-07")


def test_first_rows_1993():
    http, _ = _client(lambda url, q: _resp(_load("debt_first.json")))
    [res] = fd.FiscalDataAdapter().fetch([_spec("USDEBT")], mode="history", start=None, end=date(1993, 4, 8),
                                         http=http)
    assert res.observations[0].period_start == "1993-04-01"
    assert res.observations[0].value == pytest.approx(4225873987843.44)


@pytest.mark.parametrize("resp,exc", [
    (_resp(b"<html><body>maintenance</body></html>", ctype="text/html"), MalformedPayload),
    (_resp(b"", ctype="application/json"), MalformedPayload),
    (_resp(b"{not json", ctype="application/json"), MalformedPayload),
    (_resp({"error": "Invalid Query Param", "message": "x"}), MalformedPayload),
    (_resp({"data": "nope", "meta": {}}), MalformedPayload),
    (_resp(b"", status=302, headers={"Location": "https://fiscaldata.treasury.gov/error"}), MalformedPayload),
    (_resp(b"oops", status=503), SourceUnavailable),
    (_resp(b"{}", status=404), SourceUnavailable),
])
def test_soft_failures(resp, exc):
    http, _ = _client(lambda url, q: resp)
    with pytest.raises(exc):
        fd.FiscalDataAdapter().fetch([_spec("USDEBT")], mode="history", start=None, end=None, http=http)


def test_non_numeric_value_is_malformed():
    doc = _load("debt_recent.json")
    doc["data"][0]["tot_pub_debt_out_amt"] = "12,3x"
    http, _ = _client(lambda url, q: _resp(doc))
    with pytest.raises(MalformedPayload):
        fd.FiscalDataAdapter().fetch([_spec("USDEBT")], mode="history", start=None, end=None, http=http)


# ───────────────────────────────── TGA ────────────────────────────────────


def test_tga_three_label_eras_and_splices():
    http, t = _client(lambda url, q: _resp(_load("tga_splices.json")))
    [res] = fd.FiscalDataAdapter().fetch([_spec("USTGA")], mode="history", start=None, end=None, http=http)
    got = {o.period_start: o.value for o in res.observations}
    assert got == {"2005-10-03": 5448.0,          # 'Federal Reserve Account' close_today_bal
                   "2021-09-30": 215160.0,
                   "2021-10-01": 132452.0,        # 'Treasury General Account (TGA)' close_today_bal
                   "2022-04-15": 578473.0,
                   "2022-04-18": 841253.0,        # '... Closing Balance' open_today_bal (close = "null")
                   "2026-09-25": 945290.0}        # Phase 0: 945,290 $M
    q = parse_qs(urlsplit(t.requests[0].url).query)
    assert "filter" not in q                      # NO account_type filter: drift must be visible
    assert set(q["fields"][0].split(",")) == {"record_date", "account_type", "close_today_bal", "open_today_bal"}
    assert validate.check_schema(registry.get("USTGA"), res.observations) == []


def test_tga_label_drift_is_malformed():
    doc = _load("tga_splices.json")
    for r in doc["data"]:
        if r["record_date"] == "2026-09-25" and r["account_type"].endswith("Closing Balance"):
            r["account_type"] = "TGA Closing Balance (new wording)"
    http, _ = _client(lambda url, q: _resp(doc))
    with pytest.raises(MalformedPayload, match="schema drift"):
        fd.FiscalDataAdapter().fetch([_spec("USTGA")], mode="history", start=None, end=None, http=http)


def test_tga_quirk_changing_shape_is_malformed():
    doc = _load("tga_splices.json")
    for r in doc["data"]:
        if r["record_date"] == "2026-09-25" and r["account_type"].endswith("Closing Balance"):
            r["close_today_bal"] = "1"
    http, _ = _client(lambda url, q: _resp(doc))
    with pytest.raises(MalformedPayload, match="two different values"):
        fd.FiscalDataAdapter().fetch([_spec("USTGA")], mode="history", start=None, end=None, http=http)


def test_tga_explicit_labels_param_overrides_builtin():
    spec = _spec("USTGA", labels={"Federal Reserve Account": "close_today_bal"})
    doc = _load("tga_splices.json")
    doc["data"] = [r for r in doc["data"] if r["record_date"] <= "2021-09-30"]
    doc["meta"]["total-count"] = len(doc["data"])
    http, _ = _client(lambda url, q: _resp(doc))
    [res] = fd.FiscalDataAdapter().fetch([spec], mode="history", start=None, end=None, http=http)
    assert [o.value for o in res.observations] == [5448.0, 215160.0]


# ───────────────────────────────── MTS ────────────────────────────────────


def test_mts_latest_report_month_grammar_and_sign():
    http, t = _client(lambda url, q: _resp(_load("mts_2026-08.json")))
    [res] = fd.FiscalDataAdapter().fetch([_spec("USMTSDEF")], mode="latest", start=None, end=None, http=http)
    q = parse_qs(urlsplit(t.requests[0].url).query)
    assert q["sort"] == ["-record_date"] and q["page[size]"] == ["100"] and len(t.requests) == 1
    obs = {o.period_start: o for o in res.observations}
    # report 2026-08-31 = FY2025 (Oct 2024..Sep 2025) + FY2026 (Oct 2025..Aug 2026)
    assert len(obs) == 23 and min(obs) == "2024-10-01" and max(obs) == "2026-08-01"
    aug = obs["2026-08-01"]
    assert (aug.period_end, aug.value) == ("2026-08-31", 166796952277.38)   # Phase 0: $166.8B deficit
    assert obs["2026-04-01"].value < 0                                        # April surplus -> negative
    assert obs["2025-10-01"].period_end == "2025-10-31"                       # FY2026 October -> CY2025
    assert validate.check_schema(registry.get("USMTSDEF"), res.observations) == []


def test_mts_newest_report_wins_and_sign_param():
    doc = _load("mts_hist.json")
    http, _ = _client(lambda url, q: _resp(doc))
    [res] = fd.FiscalDataAdapter().fetch([_spec("USMTSDEF", sign=-1)], mode="history",
                                         start=date(2024, 10, 1), end=date(2025, 10, 31), http=http)
    # expected: August 2025 as stated in the NEWEST report of the fixture (2025-10-31, prior-FY block)
    rows = doc["data"]
    fy = {r["classification_id"]: r["classification_desc"] for r in rows
          if r["record_date"] == "2025-10-31" and r["sequence_level_nbr"] == "1"}
    newest = [r for r in rows if r["record_date"] == "2025-10-31" and r["classification_desc"] == "August"
              and fy.get(r["parent_id"]) == "FY 2025"][0]
    got = {o.period_start: o.value for o in res.observations}
    assert got["2025-08-01"] == -float(newest["current_month_dfct_sur_amt"])
    assert "2025-10-01" in got and min(got) >= "2024-10-01"


def test_mts_month_without_fy_parent_is_malformed():
    doc = _load("mts_hist.json")
    doc["data"] = [r for r in doc["data"] if r["sequence_level_nbr"] != "1"]
    doc["meta"]["total-count"] = len(doc["data"])
    http, _ = _client(lambda url, q: _resp(doc))
    with pytest.raises(MalformedPayload, match="FY"):
        fd.FiscalDataAdapter().fetch([_spec("USMTSDEF")], mode="history", start=None, end=None, http=http)


def test_bad_sign_param():
    http, _ = _client(lambda url, q: _resp(_load("mts_hist.json")))
    with pytest.raises(MalformedPayload):
        fd.FiscalDataAdapter().fetch([_spec("USMTSDEF", sign=2)], mode="history", start=None, end=None,
                                     http=http)


# ─────────────────────────────── calendar ─────────────────────────────────


def test_release_calendar_is_utc():
    http, t = _client(lambda url, q: _resp(_load("calendar.json")))
    cal = fd.release_calendar(http)
    assert t.requests[0].url == fd.CALENDAR_URL
    dts = [e for e in cal if e["calendar_key"] == "fiscal:dts"]
    # 20:00Z before the 2026-11-01 DST end and 21:00Z after are BOTH 16:00 ET
    assert {e["sched_time"] for e in dts} == {"16:00"}
    assert {e["sched_time"] for e in cal if e["calendar_key"] == "fiscal:dtp"} == {"16:15"}
    mts = [e for e in cal if e["calendar_key"] == "fiscal:mts"]
    assert [(e["sched_date"], e["sched_time"]) for e in mts] == [("2026-11-12", "14:00"), ("2026-12-10", "14:00")]
    nov2 = [e for e in dts if e["sched_date"] == "2026-11-02"][0]
    assert nov2["at_utc"] == int(datetime(2026, 11, 2, 21, 0, tzinfo=timezone.utc).timestamp())
    assert all(e["tz"] == "America/New_York" and e["precision"] == "exact" for e in cal)
    assert any(e["calendar_key"] is None for e in cal)          # other datasets kept, unkeyed
    only = fd.release_calendar(http, dataset_ids=["015-BFS-2014Q1-13"])
    assert [e["calendar_key"] for e in only] == ["fiscal:mts", "fiscal:mts"]


def test_release_calendar_malformed():
    http, _ = _client(lambda url, q: _resp({"not": "a list"}))
    with pytest.raises(MalformedPayload):
        fd.release_calendar(http)
    http, _ = _client(lambda url, q: _resp([{"datasetId": "x", "date": "2026-13-01", "time": "20:00"}]))
    with pytest.raises(MalformedPayload):
        fd.release_calendar(http)


def test_registered_and_keyless():
    from api.services.econ import adapters
    a = adapters.get_adapter("fiscaldata")
    assert isinstance(a, fd.FiscalDataAdapter) and a.key_env is None
