"""The share-offering forms in the market filings feed (2026-11-27): S-3, S-3ASR, 424B1-424B5, 424B7 and
S-8 beside the S-1 the feed already read, and `form=DILUTION`, all of them together.

No network: `_sec_get` is replaced by name. The feed files for the new forms under
tests/fixtures/research_cov/ (feed_S-3*.atom, feed_424B*.atom, feed_S-8.atom) are SYNTHETIC (invented
companies and accession numbers, in the shape of the recorded feed_S-1.atom); each file says so.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import pytest

from api.services import filings_feed as ff
from api.services.cache import cache

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "research_cov"
NEW_FORMS = ("S-3", "S-3ASR", "424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "S-8")


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv(ff.ENABLED_ENV, raising=False)
    for prefix in (ff._TICKER_PREFIX, ff._MARKET_KEY):
        for k in list(cache.keys_with_prefix(prefix)):
            cache.invalidate(k)
    ff._queued.clear()
    ff._tickers.update(by_ticker=None, by_cik=None, at=0.0)
    yield
    for prefix in (ff._TICKER_PREFIX, ff._MARKET_KEY):
        for k in list(cache.keys_with_prefix(prefix)):
            cache.invalidate(k)
    ff._queued.clear()


def _get(fail_forms=()):
    def get(url):
        if "company_tickers.json" in url:
            return (FIX / "company_tickers_subset.json").read_bytes()
        if "getcurrent" in url:
            form = url.split("type=")[1].split("&")[0].replace("+", " ")
            if form in fail_forms:
                from api.services.fundamentals_pit.sec_client import SecError
                raise SecError(url, 503, "down")
            return (FIX / ("feed_" + form.replace(" ", "_") + ".atom")).read_bytes()
        raise AssertionError(f"unrecorded url {url}")
    return get


class TestTheForms:
    def test_every_share_offering_form_is_read_and_s1_is_still_read(self):
        for form in NEW_FORMS + ("S-1",):
            assert form in ff.FEED_FORMS and form in ff.DILUTION_FORMS, form
        for form in ("8-K", "10-Q", "10-K", "4", "SCHEDULE 13D", "SCHEDULE 13G"):
            assert form in ff.FEED_FORMS and form not in ff.DILUTION_FORMS, form
        assert len(set(ff.FEED_FORMS)) == len(ff.FEED_FORMS) == 16
        assert "424B6" not in ff.FEED_FORMS and "424B8" not in ff.FEED_FORMS

    def test_the_filter_takes_one_form_or_the_group_and_nothing_else(self):
        for ok in ("DILUTION", "dilution", "S-3", "424B5", "S-8/A", "8-K"):
            assert ff.form_filter_ok(ok), ok
        for no in ("424B6", "144", "DEF 14A", "", "DILUTIONS"):
            assert not ff.form_filter_ok(no), no
        assert ff.forms_of("DILUTION") == frozenset(ff.DILUTION_FORMS)
        assert ff.forms_of("S-3/A") == frozenset({"S-3"})
        assert ff.forms_of(None) is None

    def test_a_busy_form_can_never_push_a_quiet_one_out_of_the_market_cache(self):
        # Every other form at its own cap, all newer than one old S-8: the S-8 is still kept.
        rows = [{"form": f, "accession": f"{f}-{i}", "accepted": f"2026-11-27T16:{i % 60:02d}"}
                for f in ff.FEED_FORMS if f != "S-8" for i in range(ff.MARKET_KEEP_PER_FORM + 20)]
        rows.append({"form": "S-8", "accession": "s8-old", "accepted": "2026-11-01T09:00"})
        rows.sort(key=lambda r: r["accepted"], reverse=True)
        kept = ff._cap_per_form(rows, ff.MARKET_KEEP_PER_FORM, ff.MARKET_KEEP)
        assert "s8-old" in {r["accession"] for r in kept}
        assert ff.MARKET_KEEP == ff.MARKET_KEEP_PER_FORM * len(ff.FEED_FORMS)

    def test_the_client_copy_of_the_group_is_the_server_list(self):
        src = (ROOT / "app/src/pages/terminal/panels/filingsFeedModel.js").read_text(encoding="utf-8")
        m = re.search(r"export const DILUTION_FORMS = Object\.freeze\(\[([^\]]*)\]\)", src)
        assert m, "filingsFeedModel.js lost its DILUTION_FORMS list"
        assert tuple(re.findall(r"'([^']+)'", m.group(1))) == ff.DILUTION_FORMS


class TestTheMarketRead:
    def test_one_request_per_form_and_the_group_reads_only_offerings(self, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        calls = []
        get = _get()
        monkeypatch.setattr(ff, "_sec_get", lambda u: (calls.append(u), get(u))[1])
        res = ff.poll_market()
        assert set(res["forms"].values()) == {"ok"}
        assert sum("getcurrent" in u for u in calls) == len(ff.FEED_FORMS)
        out = ff.market_feed(form="DILUTION")
        assert out["state"] == "ok"
        got = {ff.base_form(r["form"]) for r in out["rows"]}
        assert got == set(ff.DILUTION_FORMS)                       # every offering form, the S-1 included
        assert any(r["form"] == "S-3/A" for r in out["rows"])      # amendments ride with their form
        everything = {ff.base_form(r["form"]) for r in ff.market_feed()["rows"]}
        assert "8-K" in everything and "424B5" in everything
        assert [ff.base_form(r["form"]) for r in ff.market_feed(form="424B5")["rows"]] == ["424B5", "424B5"]

    def test_a_group_whose_every_form_failed_says_it_could_not_read_them(self):
        failed = {f: {"state": "unavailable"} for f in ff.DILUTION_FORMS}
        cache.set(ff._MARKET_KEY, {"rows": [], "forms": failed, "polled_at": time.time()}, 60)
        out = ff.market_feed(form="DILUTION")
        assert "could not read" in out["reason"] and "share-offering" in out["reason"]

    def test_an_empty_group_is_none_in_scope_in_plain_words(self):
        cache.set(ff._MARKET_KEY, {"rows": [{"form": "8-K", "accession": "x", "cik": 1}],
                                   "forms": {"8-K": {"state": "ok"}}, "polled_at": time.time()}, 60)
        out = ff.market_feed(form="DILUTION")
        assert out["state"] == "none_in_scope" and out["rows"] == []
        assert "share-offering (S-1, S-3, 424B or S-8)" in out["reason"]


class TestTheTickerRead:
    def test_the_group_filters_one_company_too(self):
        rows = [{"form": f, "accession": f"a{i}", "cik": 1, "accepted": f"2026-11-2{i}"}
                for i, f in enumerate(("8-K", "S-3", "424B5", "4"))]
        cache.set(ff._TICKER_PREFIX + "EXM", {"state": "ok", "cik": 1, "company": "Example", "rows": rows,
                                               "fetched_at": 0, "sym": "EXM"}, 60)
        out = ff.ticker_feed("EXM", form="DILUTION")
        assert sorted(r["form"] for r in out["rows"]) == ["424B5", "S-3"]
        cache.set(ff._TICKER_PREFIX + "EXM", {"state": "ok", "cik": 1, "company": "Example", "rows": rows[:1],
                                               "fetched_at": 0, "sym": "EXM"}, 60)
        none = ff.ticker_feed("EXM", form="DILUTION")
        assert none["state"] == "none_in_scope" and "share-offering" in none["reason"]


class TestTheRoute:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_cov as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return TestClient(app)

    def test_the_group_and_each_new_form_are_taken_and_other_forms_refused(self, client, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        monkeypatch.setattr(ff, "_schedule", lambda s: True)
        cache.set(ff._MARKET_KEY, {"rows": [], "forms": {}, "polled_at": time.time()}, 60)
        for form in ("DILUTION", "dilution", "S-3", "424B5", "S-8"):
            assert client.get(f"/api/research/filings-feed?form={form}").status_code == 200, form
        assert client.get("/api/research/filings-feed/AAPL?form=DILUTION").status_code == 200
        for form in ("424B6", "144"):
            assert client.get(f"/api/research/filings-feed?form={form}").status_code == 400, form

    def test_the_flag_ledger_counts_the_requests_a_poll_makes(self):
        note = json.loads((ROOT / "docs/feature_flags.json").read_text(encoding="utf-8"))
        flags = note.get("flags", note)
        entry = flags["FILINGS_FEED_ENABLED"]
        assert f"{len(ff.FEED_FORMS)} SEC requests per poll" in entry["note"]
