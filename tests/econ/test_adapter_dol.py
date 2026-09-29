"""DOL claims adapter: r539cy XML (real, trimmed) + weekly news-release PDF (real, pages 1/2/4)."""
from __future__ import annotations

import copy
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs

import pytest

from api.services.econ import registry, validate
from api.services.econ.adapters import dol
from api.services.econ.adapters.base import SeriesSpec
from api.services.econ.http import HttpClient
from api.services.econ.model import MalformedPayload, SourceUnavailable

FIX = Path(__file__).parent / "fixtures" / "dol"
XML = (FIX / "r539cy_us_trim.xml").read_bytes()
PDF = (FIX / "press_092426_trim.pdf").read_bytes()
PDFTOTEXT = (FIX / "press_092426_pdftotext.txt").read_text(encoding="utf-8")
PRESS_LOC = "http://oui.doleta.gov/press/2026/092426.pdf"      # live Location (http, as served)
PDF_LM = "Thu, 24 Sep 2026 12:32:12 GMT"
EMBARGO = int(datetime(2026, 9, 24, 12, 30, tzinfo=timezone.utc).timestamp())   # 08:30 ET


def _resp(body, status=200, ctype="text/xml;charset=UTF-8", headers=None):
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


def route_ok(xml=XML, loc=PRESS_LOC, pdf=PDF, redirect_status=302, pdf_status=200):
    def route(req):
        if req.url == dol.XML_URL:
            return _resp(xml)
        if req.url == dol.REDIRECT_URL:
            return _resp(b"", status=redirect_status, ctype="text/html", headers={"Location": loc})
        if req.url.startswith("https://oui.doleta.gov/press/"):
            return _resp(pdf, status=pdf_status, ctype="application/pdf", headers={"Last-Modified": PDF_LM})
        raise AssertionError(req.url)
    return route


def _spec(**param_overrides):
    e = copy.deepcopy(registry.get("USICSA"))
    e["source"]["params"].update(param_overrides)
    return SeriesSpec(e)


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(dol, "_utcnow", lambda: datetime(2026, 9, 28, 22, 0, tzinfo=timezone.utc))



# ─────────────────────────────── XML ──────────────────────────────────────


def test_parse_xml_blanks_and_trailing_future_weeks():
    weeks = dol.parse_xml(XML)
    assert weeks[date(1967, 1, 7)]["initial"] == {"NSA": 346000.0, "SF": 166.5, "SA": 208000.0}
    fut = weeks[date(2026, 12, 26)]["initial"]
    assert fut["SA"] is None and fut["NSA"] is None and fut["SF"] == 120.1     # &#160; -> None
    obs = dol.xml_observations(weeks, "USICSA", "initial", "SA")
    assert obs[-1].period_end == "2026-08-29" and obs[-1].value == 207000.0     # future weeks dropped
    assert obs[-1].period_start == "2026-08-23"
    assert all(o.value is not None for o in obs)


def test_xml_interior_blank_is_na_not_dropped():
    bad = XML.replace(b"<weekEnded>08/15/2026</weekEnded>\n<InitialClaims>\n<NSA>173,017</NSA>\n<SF>83.6</SF>\n"
                      b"<SA>207,000</SA>", b"<weekEnded>08/15/2026</weekEnded>\n<InitialClaims>\n<NSA>173,017</NSA>\n"
                      b"<SF>83.6</SF>\n<SA>&#160;</SA>")
    assert bad != XML
    obs = {o.period_end: o.value for o in dol.xml_observations(dol.parse_xml(bad), "USICSA", "initial", "SA")}
    assert obs["2026-08-15"] is None and obs["2026-08-29"] == 207000.0


@pytest.mark.parametrize("body", [
    b"", b"<html><body>error</body></html>", b"<r539cyState></r539cyState>", b"<r539cyNational><week>",
    XML.replace(b"08/29/2026", b"08/28/2026"),                  # not a Saturday
    XML.replace(b"<NSA>171,403</NSA>", b"<NSA>17x,403</NSA>"),
])
def test_xml_malformed(body):
    with pytest.raises(MalformedPayload):
        dol.parse_xml(body)


# ─────────────────────────────── PDF text ─────────────────────────────────


def test_parse_press_pypdf_text():
    pytest.importorskip("pypdf")
    pr = dol.parse_press_text(dol.pdf_text(PDF))
    assert pr.release_date == date(2026, 9, 24) and pr.embargo_ts == EMBARGO
    assert pr.weeks == [date(2026, 9, 19), date(2026, 9, 12), date(2026, 9, 5)]
    assert pr.sa == {date(2026, 9, 19): 197000.0, date(2026, 9, 12): 198000.0, date(2026, 9, 5): 207000.0}
    assert pr.nsa[date(2026, 9, 19)] == 163811.0
    assert (pr.prose_sa, pr.prose_prev_sa, pr.prose_nsa) == (197000.0, 198000.0, 163811.0)
    dol.cross_validate_sf(pr, dol.parse_xml(XML))


def test_parse_press_pdftotext_letter_spacing_and_misaligned_change():
    pr = dol.parse_press_text(PDFTOTEXT)            # 'Initia l Cla ims', NSA Change on another line
    assert pr.weeks == [date(2026, 9, 19), date(2026, 9, 12)]     # 3rd week not trusted -> dropped
    assert pr.sa == {date(2026, 9, 19): 197000.0, date(2026, 9, 12): 198000.0}
    assert pr.nsa == {date(2026, 9, 19): 163811.0, date(2026, 9, 12): 153568.0}
    assert pr.prose_nsa == 163811.0


@pytest.mark.parametrize("old,new,match", [
    ("claims  was 197,000", "claims  was 199,000", "prose advance SA"),
    ("to \n198,000", "to \n199,000", "prior-week"),
    ("EMBARGOED UNTIL", "RELEASED AT", "embargo"),
    ("In the week ending September 19, the advance", "In the week ending September 12, the advance", "advance week"),
    ("Initial Claims (SA) 197,000", "Initial Claims (SA) 196,000", "prose advance SA"),
    ("UNEMPLOYMENT INSURANCE DATA FOR REGULAR STATE PROGRAMS  \n \nWEEK ENDING September 19  September 12",
     "UNEMPLOYMENT INSURANCE DATA FOR REGULAR STATE PROGRAMS  \n \nWEEK ENDING September 26  September 19", ""),
])
def test_press_cross_checks_fail_closed(old, new, match):
    pytest.importorskip("pypdf")
    text = dol.pdf_text(PDF)
    assert old in text, old
    with pytest.raises(MalformedPayload, match=match):
        dol.parse_press_text(text.replace(old, new))


def test_press_sf_cross_check_fails_closed():
    pytest.importorskip("pypdf")
    pr = dol.parse_press_text(dol.pdf_text(PDF))
    weeks = dol.parse_xml(XML.replace(b"<SF>83.0</SF>", b"<SF>90.0</SF>"))
    with pytest.raises(MalformedPayload, match="0.5%"):
        dol.cross_validate_sf(pr, weeks)
    weeks = dol.parse_xml(XML)
    del weeks[date(2026, 9, 19)]
    with pytest.raises(MalformedPayload, match="seasonal factor"):
        dol.cross_validate_sf(pr, weeks)


def test_text_too_short_is_malformed():
    with pytest.raises(MalformedPayload):
        dol.parse_press_text("hello")


# ─────────────────────────────── adapter ──────────────────────────────────


def test_history_xml_plus_advance_pdf():
    pytest.importorskip("pypdf")
    http, t = _client(route_ok())
    xml_res, pdf_res = dol.DolAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)
    body = parse_qs(t.requests[0].body.decode())
    assert t.requests[0].method == "POST" and body == {
        "level": ["us"], "final_yr": ["2027"], "strtdate": ["1967"], "enddate": ["2026"], "filetype": ["xml"]}
    assert t.requests[1].url == dol.REDIRECT_URL
    assert t.requests[2].url == "https://oui.doleta.gov/press/2026/092426.pdf"      # https, same path
    assert xml_res.request_key == "dol:r539cy:us:initial:SA:history:1967-2026"
    assert xml_res.source_published_at is None and xml_res.observations[0].period_end == "1967-01-07"
    assert xml_res.observations[-1].period_end == "2026-08-29"
    assert pdf_res.request_key == "dol:press:2026-09-24:initial:SA"
    assert pdf_res.source_published_at == EMBARGO and pdf_res.warnings == []
    got = [(o.period_start, o.period_end, o.value, o.flag, o.source_published_at) for o in pdf_res.observations]
    assert got == [("2026-08-30", "2026-09-05", 207000.0, "", EMBARGO),
                   ("2026-09-06", "2026-09-12", 198000.0, "", EMBARGO),
                   ("2026-09-13", "2026-09-19", 197000.0, "a", EMBARGO)]
    spec = registry.get("USICSA")
    assert validate.check_schema(spec, xml_res.observations + pdf_res.observations) == []


def test_latest_mode_years_and_window():
    pytest.importorskip("pypdf")
    http, t = _client(route_ok())
    xml_res, pdf_res = dol.DolAdapter().fetch([_spec()], mode="latest", start=None, end=None, http=http)
    body = parse_qs(t.requests[0].body.decode())
    assert body["strtdate"] == ["2025"] and body["enddate"] == ["2026"]
    assert len(xml_res.observations) == 8 and pdf_res.observations[-1].flag == "a"


def test_xml_that_caught_up_wins_over_pdf():
    pytest.importorskip("pypdf")
    caught = XML.replace(b"<weekEnded>09/05/2026</weekEnded>\n<InitialClaims>\n<NSA>&#160;</NSA>\n<SF>85.7</SF>\n"
                         b"<SA>&#160;</SA>",
                         b"<weekEnded>09/05/2026</weekEnded>\n<InitialClaims>\n<NSA>177,695</NSA>\n<SF>85.7</SF>\n"
                         b"<SA>207,000</SA>")
    assert caught != XML
    http, _ = _client(route_ok(xml=caught))
    xml_res, pdf_res = dol.DolAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)
    assert xml_res.observations[-1].period_end == "2026-09-05"
    assert [o.period_end for o in pdf_res.observations] == ["2026-09-12", "2026-09-19"]


def test_redirect_to_foreign_host_is_malformed():
    http, _ = _client(route_ok(loc="https://www.dol.gov/ui/data.pdf"))
    with pytest.raises(MalformedPayload, match="press PDF"):
        dol.DolAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)


def test_file_name_date_must_match_embargo():
    pytest.importorskip("pypdf")
    http, _ = _client(route_ok(loc="http://oui.doleta.gov/press/2026/091726.pdf"))
    with pytest.raises(MalformedPayload, match="file name"):
        dol.DolAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)


def test_redirect_outage_history_degrades_latest_raises():
    http, _ = _client(route_ok(redirect_status=503))
    results = dol.DolAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)
    assert len(results) == 1 and any("PDF unavailable" in w for w in results[0].warnings)
    http, _ = _client(route_ok(redirect_status=503))
    with pytest.raises(SourceUnavailable):
        dol.DolAdapter().fetch([_spec()], mode="latest", start=None, end=None, http=http)


def test_pdf_that_is_html_is_malformed():
    http, _ = _client(route_ok(pdf=b"<html>Not found</html>"))
    with pytest.raises(MalformedPayload, match="not a PDF"):
        dol.DolAdapter().fetch([_spec()], mode="latest", start=None, end=None, http=http)


def test_no_pdf_for_old_windows_or_press_off():
    http, t = _client(route_ok())
    [res] = dol.DolAdapter().fetch([_spec()], mode="history", start=date(1967, 1, 1), end=date(1967, 12, 31),
                                   http=http)
    assert len(t.requests) == 1 and [o.period_end for o in res.observations][:1] == ["1967-01-07"]
    http, t = _client(route_ok())
    [res] = dol.DolAdapter().fetch([_spec(press=False)], mode="latest", start=None, end=None, http=http)
    assert len(t.requests) == 1


def test_nsa_and_continued_params():
    http, _ = _client(route_ok())
    [res] = dol.DolAdapter().fetch([_spec(seasonal="NSA", measure="continued")], mode="history",
                                   start=None, end=None, http=http)
    assert res.observations[0].value == 1594000.0 and res.request_key.startswith("dol:r539cy:us:continued:NSA")
    with pytest.raises(MalformedPayload):
        dol.DolAdapter().fetch([_spec(level="state")], mode="history", start=None, end=None, http=http)


def test_pypdf_missing_is_source_unavailable(monkeypatch):
    import builtins
    real = builtins.__import__

    def fake(name, *a, **k):
        if name == "pypdf":
            raise ImportError("no pypdf")
        return real(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", fake)
    with pytest.raises(SourceUnavailable, match="pypdf"):
        dol.pdf_text(PDF)
    http, _ = _client(route_ok())
    results = dol.DolAdapter().fetch([_spec()], mode="history", start=None, end=None, http=http)
    assert len(results) == 1 and results[0].warnings


def test_registered_keyless():
    from api.services.econ import adapters
    a = adapters.get_adapter("dol")
    assert isinstance(a, dol.DolAdapter) and a.key_env is None
