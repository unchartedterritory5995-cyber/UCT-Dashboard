"""COV-05 / FT-076 board and biographies (dark: RESEARCH_PEOPLE_BOARD_ENABLED).

Recorded fixtures only (tests/fixtures/edgar_ownership: AAPL submissions + Form 4s, recorded
from EDGAR). Board = directors declared on Form 4 from the cached snapshot; biographies = a
link to the newest DEF 14A, read from the same submissions document. No SEC or FMP call.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from api.services import edgar_ownership as eo
from api.services import research_people as rp
from api.services.cache import cache

from .test_research_cov_05_07_09 import _fake_fmp, _form4_snapshot

EO_FIX = Path(__file__).parent / "fixtures" / "edgar_ownership"
SUB = json.loads((EO_FIX / "submissions_aapl_trimmed.json").read_text(encoding="utf-8"))
PROXY_URL = "https://www.sec.gov/Archives/edgar/data/320193/000130817926000008/aapl014016-def14a.htm"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for env in (rp.ENABLED_ENV, rp.BOARD_ENV, "EDGAR_OWNERSHIP_ENABLED"):
        monkeypatch.delenv(env, raising=False)
    for prefix in (rp._CACHE_PREFIX, eo._CACHE_PREFIX):
        for k in list(cache.keys_with_prefix(prefix)):
            cache.invalidate(k)
    yield
    for prefix in (rp._CACHE_PREFIX, eo._CACHE_PREFIX):
        for k in list(cache.keys_with_prefix(prefix)):
            cache.invalidate(k)


def _snap(**extra):
    s = _form4_snapshot()
    s.update(extra)
    return s


def test_latest_proxy_is_the_newest_def_14a_never_the_additional_materials():
    p = eo.latest_proxy_filing(SUB, "320193")
    assert p["form"] == "DEF 14A" and p["accession"] == "0001308179-26-000008"
    assert p["filing_date"] == "2026-01-08" and p["url"] == PROXY_URL
    assert p["index_url"].endswith("0001308179-26-000008-index.htm")
    assert eo.latest_proxy_filing({"filings": {"recent": {"form": ["4"], "accessionNumber": ["x"],
                                                           "filingDate": ["2026-01-01"]}}}, 1) is None


def test_the_form4_fetch_carries_the_proxy_from_the_same_submissions_read(monkeypatch):
    sub = (EO_FIX / "submissions_aapl_trimmed.json").read_bytes()
    docs = {p.name: p.read_bytes() for p in EO_FIX.glob("form4_aapl_*.xml")}
    asked = []

    def get(url):
        asked.append(url)
        if "submissions" in url:
            return sub
        for name, body in docs.items():
            if name.split("_")[-1].replace(".xml", "").replace("-", "") in url:
                return body
        from api.services.fundamentals_pit.sec_client import SecError
        raise SecError(url, 404, "not recorded")

    monkeypatch.setattr(eo, "_sec_get", get)
    monkeypatch.setattr(eo, "_resolve_cik", lambda s: "320193")
    res = eo.fetch_form4_activity("AAPL", today=date(2026, 9, 29))
    assert res.value["latest_proxy"]["url"] == PROXY_URL
    assert not any("def14a" in u for u in asked)                     # a link, never a download


def test_dark_means_no_board_key(monkeypatch):
    _fake_fmp(monkeypatch)
    out = rp.people("AAPL", snapshot_fn=lambda s: _snap(latest_proxy=eo.latest_proxy_filing(SUB, 320193)))
    assert "board" not in out


def test_armed_lists_only_declared_directors_and_links_the_proxy(monkeypatch):
    monkeypatch.setenv(rp.BOARD_ENV, "1")
    _fake_fmp(monkeypatch)
    calls = []

    def snap(s):
        calls.append(s)
        return _snap(latest_proxy=eo.latest_proxy_filing(SUB, 320193))

    out = rp.people("aapl", snapshot_fn=snap)
    b = out["board"]
    roles = out["insider_roles"]["rows"]
    assert b["state"] == "ok" and b["source"] == rp.SRC_BOARD
    want = sorted(r["name"] for r in roles if r["is_director"])
    assert want and sorted(r["name"] for r in b["rows"]) == want
    assert all(r["accession"] and r["url"] for r in b["rows"])
    assert "a director who filed none is not listed" in b["scope"]
    assert b["bios"] == {"state": "ok", "source": rp.SRC_PROXY, **eo.latest_proxy_filing(SUB, 320193)}
    assert calls == ["AAPL"]                                          # one snapshot read for both


def test_no_director_in_window_says_so(monkeypatch):
    monkeypatch.setenv(rp.BOARD_ENV, "1")
    _fake_fmp(monkeypatch)
    s = _snap(latest_proxy=None)
    s["owner_roles"] = [dict(r, is_director=False) for r in s["owner_roles"]]
    b = rp.people("AAPL", snapshot_fn=lambda _s: s)["board"]
    assert b["state"] == "none_in_window" and b["rows"] is None and "declared a director" in b["reason"]
    assert b["bios"]["state"] == "not_found"


def test_a_snapshot_from_before_proxy_capture_is_unavailable_not_none(monkeypatch):
    monkeypatch.setenv(rp.BOARD_ENV, "1")
    _fake_fmp(monkeypatch)
    b = rp.people("AAPL", snapshot_fn=lambda s: _snap())["board"]       # no latest_proxy key
    assert b["bios"]["state"] == "unavailable" and "predates proxy capture" in b["bios"]["reason"]


def test_an_unread_edgar_is_a_named_gap_in_both_halves(monkeypatch):
    monkeypatch.setenv(rp.BOARD_ENV, "1")
    _fake_fmp(monkeypatch)
    b = rp.people("AAPL", snapshot_fn=lambda s: {"state": "pending"})["board"]
    assert b["rows"] is None and b["state"] == "unavailable" and b["reason"]
    assert b["bios"]["state"] == "unavailable" and b["bios"]["reason"]


def test_the_request_path_never_calls_sec(monkeypatch):
    monkeypatch.setenv(rp.BOARD_ENV, "1")
    _fake_fmp(monkeypatch)
    monkeypatch.setattr(eo, "_sec_get", lambda url: pytest.fail("SEC on the request path"))
    out = rp.people("AAPL")                                           # real form4_snapshot: cache-only
    assert "board" in out
