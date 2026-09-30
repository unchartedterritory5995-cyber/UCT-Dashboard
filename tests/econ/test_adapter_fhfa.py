"""FHFA HPI adapter: real hpi_master.csv rows (trimmed: USA monthly PO + a division + USA quarterly)."""
from __future__ import annotations

import copy
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from api.services.econ import registry, validate
from api.services.econ.adapters import fhfa
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

CSV = (Path(__file__).parent / "fixtures" / "fhfa" / "hpi_master_trim.csv").read_bytes()


def _resp(body, status=200, ctype="text/csv; charset=utf-8"):
    return SimpleNamespace(status_code=status, headers={"Content-Type": ctype}, content=body)


def _client(resp):
    reqs = []

    def t(req):
        reqs.append(req)
        return resp
    return HttpClient(transport=t, sleep=lambda s: None, max_retries=0, default_interval=0,
                      host_intervals={}), reqs


def _spec(**param_overrides):
    e = copy.deepcopy(registry.get("USFHFAHPI"))
    e["source"]["params"].update(param_overrides)
    return SeriesSpec(e)


def test_history_usa_purchase_only_monthly_sa():
    http, reqs = _client(_resp(CSV))
    [res] = fhfa.FhfaAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)
    obs = res.observations
    assert reqs[0].url == "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"
    assert len(obs) == 60                                   # 24 + 36 USA monthly rows in the fixture
    assert (obs[0].period_start, obs[0].period_end, obs[0].value) == ("1991-01-01", "1991-01-31", 100.0)
    assert (obs[-1].period_start, obs[-1].period_end, obs[-1].value) == ("2026-06-01", "2026-06-30", 442.53)
    assert res.source_published_at is None and res.request_key.startswith("fhfa:hpi_master.csv:")
    assert "place_id=USA" in res.request_key and ":index_sa:history:" in res.request_key
    assert validate.check_schema(registry.get("USFHFAHPI"), obs) == []


def test_nsa_column_and_latest_window():
    http, _ = _client(_resp(CSV))
    [res] = fhfa.FhfaAdapter().fetch([_spec(column="index_nsa", latest_n=3)], mode="latest", start=None,
                                     end=None, http=http)
    assert [(o.period_start, o.value) for o in res.observations][-1] == ("2026-06-01", 452.26)
    assert len(res.observations) == 3
    [res] = fhfa.FhfaAdapter().fetch([_spec()], mode="history", start=date(2026, 5, 1), end=date(2026, 5, 31),
                                     http=http)
    assert [o.period_start for o in res.observations] == ["2026-05-01"]


def test_blank_is_na():
    body = CSV.replace(b"USA,2026,6,452.26,442.53", b"USA,2026,6,452.26,")
    assert body != CSV
    http, _ = _client(_resp(body))
    [res] = fhfa.FhfaAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)
    assert res.observations[-1].value is None


def test_filter_matching_nothing_is_malformed():
    http, _ = _client(_resp(CSV))
    f = dict(registry.get("USFHFAHPI")["source"]["params"]["filter"], place_id="US")
    with pytest.raises(MalformedPayload, match="matched no rows"):
        fhfa.FhfaAdapter().fetch([_spec(filter=f)], mode="history", start=None, end=None, http=http)


@pytest.mark.parametrize("body,ctype", [
    (b"<!DOCTYPE html><html>Access denied</html>", "text/html"),
    (b"<!DOCTYPE html><html>Access denied</html>", "text/csv"),
    (b"", "text/csv"),
    (b"hpi_type,hpi_flavor\ntraditional,purchase-only\n", "text/csv"),                      # columns missing
    (CSV.replace(b"USA,2026,6,452.26,442.53", b"USA,2026,5,452.26,442.53"), "text/csv"),    # duplicate period
    (CSV.replace(b"USA,2026,6,452.26,442.53", b"USA,2026,13,452.26,442.53"), "text/csv"),   # bad month
    (CSV.replace(b"USA,2026,6,452.26,442.53", b"USA,2026,6,452.26,4x2.53"), "text/csv"),    # non-numeric
])
def test_malformed(body, ctype):
    http, _ = _client(_resp(body, ctype=ctype))
    with pytest.raises(MalformedPayload):
        fhfa.FhfaAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)


def test_http_error_and_bad_file_param():
    http, _ = _client(_resp(b"", status=503))
    with pytest.raises(SourceUnavailable):
        fhfa.FhfaAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)
    with pytest.raises(MalformedPayload):
        fhfa.FhfaAdapter().fetch([_spec(file="http://example.com/hpi.csv")], mode="history", start=None,
                                 end=None, http=http)


def test_quarterly_grammar_via_parse_master():
    obs = fhfa.parse_master(CSV, symbol="X", flt={"hpi_flavor": "purchase-only", "frequency": "quarterly",
                                                  "place_id": "USA"}, column="index_sa", frequency="Q")
    assert obs and all(o.period_start[5:7] in ("01", "04", "07", "10") for o in obs)
