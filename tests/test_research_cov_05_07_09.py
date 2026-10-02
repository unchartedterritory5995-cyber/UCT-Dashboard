"""COV-05 People / COV-07 Estimate history / COV-09 Filings feed (roadmap RM-L19).

RECORDED fixtures, no network. Everything under tests/fixtures/research_cov/ was
recorded 2026-10-02 from the live sources this code reads:
  * fmp_*.json        -- FMP /stable/key-executives (AAPL, MSFT),
                         /stable/governance-executive-compensation (AAPL, trimmed to
                         its newest two fiscal years), /stable/analyst-estimates
                         (AAPL, period=quarter, limit=12). API key never recorded.
  * feed_*.atom       -- EDGAR browse-edgar?action=getcurrent, one per form, read
                         through fundamentals_pit/sec_client (CRLF -> LF only).
  * submissions_AAPL_trimmed.json -- data.sec.gov submissions, newest 80 filings.
  * company_tickers_subset.json   -- sec.gov/files/company_tickers.json, only the
                         CIKs the feeds above name, plus AAPL.
Form 4 documents come from the existing tests/fixtures/edgar_ownership/ set.
`_sec_get` and the FMP typed functions are replaced by name; a test that reached
the network would fail on the missing key / refused socket, not pass quietly.
"""
from __future__ import annotations

import inspect
import json
import sqlite3
from datetime import date
from pathlib import Path

import pytest

from api.services import edgar_ownership as eo
from api.services import estimate_history as eh
from api.services import filings_feed as ff
from api.services import research_people as rp
from api.services.cache import cache

FIX = Path(__file__).parent / "fixtures" / "research_cov"
EO_FIX = Path(__file__).parent / "fixtures" / "edgar_ownership"


def _j(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def _t(name):
    return (FIX / name).read_text(encoding="utf-8")


class _Res:
    """The two attributes the services read off a ProviderResult."""

    def __init__(self, value, degraded=None):
        self.value, self.degraded = value, degraded


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for env in (rp.ENABLED_ENV, eh.ENABLED_ENV, ff.ENABLED_ENV, "EDGAR_OWNERSHIP_ENABLED"):
        monkeypatch.delenv(env, raising=False)
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    for prefix in (rp._CACHE_PREFIX, ff._TICKER_PREFIX, ff._MARKET_KEY, eo._CACHE_PREFIX):
        for k in list(cache.keys_with_prefix(prefix)):
            cache.invalidate(k)
    ff._queued.clear()
    ff._tickers.update(by_ticker=None, by_cik=None, at=0.0)
    yield
    for prefix in (rp._CACHE_PREFIX, ff._TICKER_PREFIX, ff._MARKET_KEY, eo._CACHE_PREFIX):
        for k in list(cache.keys_with_prefix(prefix)):
            cache.invalidate(k)
    ff._queued.clear()


# ══ COV-05 People ═══════════════════════════════════════════════════════════

def _fake_fmp(monkeypatch, execs=None, comp=None, execs_exc=None):
    from api.services import fmp_client

    def ke(sym, timeout=None):
        if execs_exc:
            raise execs_exc
        return _Res(execs if execs is not None else _j("fmp_key_executives_AAPL.json"))

    def ec(sym, timeout=None):
        return _Res(comp if comp is not None else _j("fmp_exec_comp_AAPL.json"))

    monkeypatch.setattr(fmp_client, "get_key_executives", ke)
    monkeypatch.setattr(fmp_client, "get_executive_compensation", ec)


def _form4_snapshot(state="ok"):
    docs = [("form4_aapl_0001140361-26-020298.xml", "0001140361-26-020298", "2026-05-08"),
            ("form4_aapl_0001140361-26-037584.xml", "0001140361-26-037584", "2026-09-10"),
            ("form4_aapl_0001140361-26-035362.xml", "0001140361-26-035362", "2026-08-20")]
    roles = []
    for f, acc, d in docs:
        roles += eo.form4_owner_roles(eo.parse_form4((EO_FIX / f).read_bytes(), accession=acc, filing_date=d))
    return {"state": state, "since": "2026-04-02", "filings_unread": [], "owner_roles": eo.merge_owner_roles(roles)}


class TestFormFourRoles:
    def test_every_owner_is_a_role_row_whatever_the_transaction_codes(self):
        doc = eo.parse_form4((EO_FIX / "form4_bgde_0000912282-26-001310.xml").read_bytes(),
                             accession="0000912282-26-001310", filing_date="2026-09-01")
        roles = eo.form4_owner_roles(doc)
        assert len(roles) == 5                         # five reporting owners, code J (not P/S)
        assert eo.form4_rows(doc) == []                # the P/S view would have shown nothing
        assert all(r["accession"] == "0000912282-26-001310" and r["url"] for r in roles)
        assert all(r["role"] for r in roles)           # never blank: "Not stated in the filing"

    def test_a_director_reads_as_director(self):
        doc = eo.parse_form4((EO_FIX / "form4_aapl_0001140361-26-020298.xml").read_bytes(),
                             accession="0001140361-26-020298", filing_date="2026-05-08")
        (r,) = eo.form4_owner_roles(doc)
        assert r["name"] == "LEVINSON ARTHUR D" and r["is_director"] and "Director" in r["role"]

    def test_merge_keeps_the_newest_filing_per_owner(self):
        a = {"name": "X", "cik": "1", "role": "Director", "filing_date": "2026-01-01", "accession": "a"}
        b = {"name": "X", "cik": "1", "role": "CEO", "filing_date": "2026-06-01", "accession": "b"}
        assert eo.merge_owner_roles([a, b]) == [b]
        assert eo.merge_owner_roles([b, a]) == [b]

    def test_the_fetch_carries_owner_roles(self, monkeypatch):
        sub = (Path(__file__).parent / "fixtures" / "edgar_ownership" / "submissions_aapl_trimmed.json").read_bytes()
        docs = {p.name: p.read_bytes() for p in EO_FIX.glob("form4_aapl_*.xml")}

        def get(url):
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
        assert "owner_roles" in res.value and isinstance(res.value["owner_roles"], list)


class TestPeopleShape:
    def test_null_since_and_null_pay_are_unavailable_with_a_reason(self):
        rows = rp.shape_executives(_j("fmp_key_executives_AAPL.json"), as_of="2026-10-02")
        assert len(rows) == 18
        perica = next(r for r in rows if r["name"] == "Adrian Perica")
        assert perica["since"] is None and "took the title" in perica["unavailable"]["since"]
        assert perica["pay"] is None and "no pay" in perica["unavailable"]["pay"]
        cook = next(r for r in rows if r["name"] == "Timothy D. Cook")
        assert cook["pay"] == 16759518 and cook["pay_note"] == "year not stated by FMP"
        assert all(r["source"] == rp.SRC_EXECS and r["as_of"] == "2026-10-02" for r in rows)

    def test_compensation_is_the_newest_year_deduplicated_and_cited(self):
        out = rp.shape_compensation(_j("fmp_exec_comp_AAPL.json"))
        assert out["year"] == 2025
        names = [r["name_and_position"] for r in out["rows"]]
        assert len(names) == len(set(names)) == 6
        assert names[0].startswith("Tim Cook")             # sorted by total, largest first
        assert all(r["url"].startswith("https://www.sec.gov/") and r["filing_date"] for r in out["rows"])

    @pytest.mark.parametrize("execname,other,ok", [
        ("Timothy D. Cook", "Tim Cook Chief Executive Officer", True),
        ("Timothy D. Cook", "COOK TIMOTHY D", True),
        ("Katherine L. Adams", "Kate Adams Senior Vice President, General Counsel", True),
        ("Kevan Parekh", "Luca Maestri Former Senior Vice President, Chief Financial Officer", False),
        ("Sabih Khan", "Kevan Parekh Senior Vice President", False),
        ("Madonna", "Madonna Director", False),            # one name is never matched
    ])
    def test_same_person(self, execname, other, ok):
        assert rp.same_person(execname, other) is ok


class TestPeoplePayload:
    def test_links_comp_and_insider_role_onto_executives(self, monkeypatch):
        _fake_fmp(monkeypatch)
        out = rp.people("aapl", snapshot_fn=lambda s: _form4_snapshot())
        assert out["ticker"] == "AAPL"
        cook = next(r for r in out["executives"]["rows"] if r["name"] == "Timothy D. Cook")
        assert cook["comp_total"] == 74294811 and cook["comp_year"] == 2025
        roles = out["insider_roles"]
        assert roles["state"] == "ok" and roles["rows"] and all(r["source"] == rp.SRC_EDGAR for r in roles["rows"])
        assert any(r["insider_role"] for r in out["executives"]["rows"]) or roles["rows"]

    def test_an_fmp_failure_is_unavailable_with_its_reason_never_empty(self, monkeypatch):
        from api.services import fmp_client
        _fake_fmp(monkeypatch, execs_exc=fmp_client._ERR.transient("boom"))
        out = rp.people("AAPL", snapshot_fn=lambda s: {"state": "pending"})
        ex = out["executives"]
        assert ex["state"] == "unavailable" and ex["rows"] is None and "FMP could not be read" in ex["reason"]
        assert out["compensation"]["state"] == "ok"        # one half failing does not blank the other

    def test_a_failure_is_cached_short_and_a_success_long(self, monkeypatch):
        from api.services import fmp_client
        seen = []
        monkeypatch.setattr(rp.cache, "set", lambda k, v, ttl: seen.append(ttl))
        _fake_fmp(monkeypatch, execs_exc=fmp_client._ERR.transient("boom"))
        rp.people("AAPL", snapshot_fn=lambda s: {"state": "pending"})
        _fake_fmp(monkeypatch)
        rp.people("MSFT", snapshot_fn=lambda s: {"state": "pending"})
        assert seen == [rp._TTL_FAIL, rp._TTL_OK]

    def test_edgar_off_says_so_rather_than_pending_forever(self, monkeypatch):
        _fake_fmp(monkeypatch)
        out = rp.people("AAPL", snapshot_fn=lambda s: {"state": "pending"})
        r = out["insider_roles"]
        assert r["state"] == "unavailable" and "EDGAR_OWNERSHIP_ENABLED" in r["reason"] and r["rows"] is None

    def test_a_snapshot_from_before_role_capture_is_not_read_as_none(self, monkeypatch):
        _fake_fmp(monkeypatch)
        out = rp.people("AAPL", snapshot_fn=lambda s: {"state": "ok", "rows": []})
        assert out["insider_roles"]["state"] == "unavailable"

    def test_the_request_path_never_calls_sec(self, monkeypatch):
        _fake_fmp(monkeypatch)
        monkeypatch.setattr(eo, "_sec_get", lambda url: pytest.fail("SEC on the request path"))
        monkeypatch.setenv("EDGAR_OWNERSHIP_ENABLED", "0")
        rp.people("AAPL")           # real form4_snapshot: cache-only


# ══ COV-07 Estimate history ═════════════════════════════════════════════════

def _est_fetch(mult=1.0):
    rows = _j("fmp_analyst_estimates_quarter_AAPL.json")
    for r in rows:
        r["epsAvg"] = r["epsAvg"] * mult
    return lambda sym: ("ok", rows, None)


class TestEstimateHistory:
    def test_no_snapshot_is_collecting_with_a_reason_and_registers_the_symbol(self):
        out = eh.history("AAPL", today=date(2026, 10, 2))
        assert out["state"] == "collecting" and out["covers_from"] is None and "no snapshot yet" in out["reason"]
        assert "AAPL" in eh.tracked()

    def test_one_snapshot_is_collecting_per_period_not_a_flat_revision(self):
        eh.snapshot_symbol("AAPL", "2026-10-01", fetch=_est_fetch())
        out = eh.history("AAPL", today=date(2026, 10, 2))
        assert out["covers_from"] == "2026-10-01" and out["snapshot_days"] == 1
        assert out["periods"] and all(p["state"] == "collecting" and p["n"] == 1 for p in out["periods"])
        assert all("eps_change" not in p for p in out["periods"])

    def test_two_snapshots_render_the_revision(self):
        eh.snapshot_symbol("AAPL", "2026-10-01", fetch=_est_fetch())
        eh.snapshot_symbol("AAPL", "2026-10-02", fetch=_est_fetch(1.10))
        out = eh.history("AAPL", today=date(2026, 10, 2))
        p = out["periods"][0]
        assert p["state"] == "revisions" and p["n"] == 2
        assert p["eps_change"]["pct"] == pytest.approx(10.0, abs=0.01)
        assert p["rev_change"]["pct"] == pytest.approx(0.0)
        assert all(pt["source"] == eh.SOURCE and pt["snap_date"] for pt in p["points"])

    def test_upcoming_periods_only_oldest_first_capped(self):
        eh.snapshot_symbol("AAPL", "2026-10-01", fetch=_est_fetch())
        out = eh.history("AAPL", today=date(2026, 10, 2))
        ends = [p["period_end"] for p in out["periods"]]
        assert ends == sorted(ends) and len(ends) == eh.MAX_PERIODS
        assert ends[0] >= "2026-06-29"                      # 95-day lookback from 2026-10-02

    def test_a_failed_read_is_a_named_gap(self):
        eh.snapshot_symbol("AAPL", "2026-10-01", fetch=_est_fetch())
        eh.snapshot_symbol("AAPL", "2026-10-02", fetch=lambda s: ("error", None, "FMPTransient: boom"))
        out = eh.history("AAPL", today=date(2026, 10, 2))
        assert out["failed_days"] == [{"snap_date": "2026-10-02", "status": "error", "detail": "FMPTransient: boom"}]

    def test_run_daily_is_flag_gated_idempotent_and_paced(self, monkeypatch):
        assert eh.run_daily(seed=False) == {"skipped": "flag off"}
        monkeypatch.setenv(eh.ENABLED_ENV, "1")
        eh.track("AAPL", "test")
        eh.track("MSFT", "test")
        sleeps, calls = [], []

        def fetch(sym):
            calls.append(sym)
            return _est_fetch()(sym)

        r1 = eh.run_daily(today=date(2026, 10, 2), fetch=fetch, sleep=sleeps.append, seed=False)
        r2 = eh.run_daily(today=date(2026, 10, 2), fetch=fetch, sleep=sleeps.append, seed=False)
        assert r1["ok"] == 2 and r2["skipped_done"] == 2 and calls == ["AAPL", "MSFT"]
        assert sleeps == [eh.PACE_S, eh.PACE_S]

    def test_the_universe_is_capped(self, monkeypatch):
        monkeypatch.setattr(eh, "MAX_SYMBOLS", 1)
        assert eh.track("AAPL", "t") is True and eh.track("MSFT", "t") is False
        out = eh.history("MSFT", today=date(2026, 10, 2))
        assert out["tracked"] is False and "universe is full" in out["reason"]

    def test_no_table_holds_an_owner_and_a_name(self, tmp_path):
        eh.tracked()
        cols = {}
        with sqlite3.connect(eh.db_path()) as c:
            for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                cols[t] = {r[1] for r in c.execute(f"PRAGMA table_info({t})")}
        assert cols and not any({"user_id", "owner_id"} & v for v in cols.values())


# ══ COV-09 Filings feed ═════════════════════════════════════════════════════

def _feed_get(fail_forms=()):
    def get(url):
        if "company_tickers.json" in url:
            return json.dumps(_j("company_tickers_subset.json")).encode()
        if "submissions/CIK0000320193" in url:
            return json.dumps(_j("submissions_AAPL_trimmed.json")).encode()
        if "getcurrent" in url:
            form = url.split("type=")[1].split("&")[0].replace("+", " ")
            if form in fail_forms:
                from api.services.fundamentals_pit.sec_client import SecError
                raise SecError(url, 503, "down")
            return _t("feed_" + form.replace(" ", "_") + ".atom").encode()
        raise AssertionError(f"unrecorded url {url}")
    return get


class TestFeedParsing:
    def test_8k_rows_carry_item_codes_and_cite_their_accession(self):
        rows = ff.parse_feed(_t("feed_8-K.atom"))
        assert rows and all(r["accession"] and r["url"].startswith("https://www.sec.gov/Archives/") for r in rows)
        first = next(r for r in rows if r["accession"] == "0001493152-26-045615")
        assert [i["code"] for i in first["items"]] == ["3.03", "5.02", "5.03", "5.07", "9.01"]
        assert first["company"] == "Outdoor Holding Co" and first["filed"] == "2026-10-02"
        assert first["source"] == ff.SOURCE_FEED

    def test_form4_is_one_row_per_accession_keyed_on_the_issuer(self):
        rows = ff.parse_feed(_t("feed_4.atom"))
        accs = [r["accession"] for r in rows]
        assert len(accs) == len(set(accs))
        assert any(r.get("filed_by") for r in rows)          # the reporting owner is named
        assert all(r["items"] is None for r in rows)          # item codes are an 8-K thing

    def test_13g_subject_is_kept_and_a_lone_filer_entry_says_so(self):
        rows = ff.parse_feed(_t("feed_SCHEDULE_13G.atom"))
        assert rows
        assert all(("subject_note" in r) or r.get("company") for r in rows)
        assert any("subject_note" in r for r in rows) or any(r.get("filed_by") for r in rows)

    def test_out_of_scope_forms_are_dropped(self):
        atom = _t("feed_8-K.atom").replace("<title>8-K - ", "<title>425 - ")
        assert all(r["form"] != "425" for r in ff.parse_feed(atom))

    def test_submissions_rows_keep_8k_items_and_filter_forms(self):
        rows = ff.parse_submissions(_j("submissions_AAPL_trimmed.json"), cik=320193, ticker="AAPL")
        forms = {ff.base_form(r["form"]) for r in rows}
        assert forms <= set(ff.FEED_FORMS) and "8-K" in forms and "4" in forms
        assert "144" not in {r["form"] for r in rows}
        k = next(r for r in rows if r["form"] == "8-K" and r["items"])
        assert all(i["label"] for i in k["items"]) and k["source"] == ff.SOURCE_SUBMISSIONS


class TestFeedMarket:
    def test_dark_poll_does_nothing(self, monkeypatch):
        monkeypatch.setattr(ff, "_sec_get", lambda u: pytest.fail("SEC while dark"))
        assert ff.poll_market() == {"skipped": "flag off"}

    def test_never_polled_is_pending_not_empty(self):
        out = ff.market_feed()
        assert out["state"] == "pending" and out["rows"] is None and "not been polled" in out["reason"]

    def test_poll_then_read_maps_tickers_and_filters_by_form(self, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        calls = []
        get = _feed_get()
        monkeypatch.setattr(ff, "_sec_get", lambda u: (calls.append(u), get(u))[1])
        res = ff.poll_market()
        assert set(res["forms"].values()) == {"ok"}
        assert sum("getcurrent" in u for u in calls) == len(ff.FEED_FORMS)   # bounded: one per form
        out = ff.market_feed(form="8-K")
        assert out["state"] == "ok" and out["rows"] and all(ff.base_form(r["form"]) == "8-K" for r in out["rows"])
        assert any(r["ticker"] for r in ff.market_feed()["rows"])

    def test_a_failed_form_is_named_and_the_rest_still_served(self, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        monkeypatch.setattr(ff, "_sec_get", _feed_get(fail_forms=("S-1",)))
        ff.poll_market()
        out = ff.market_feed()
        assert out["state"] == "ok" and "S-1" in out["partial"]

    def test_an_old_poll_is_stale_with_its_age(self, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        monkeypatch.setattr(ff, "_sec_get", _feed_get())
        ff.poll_market()
        out = ff.market_feed(now=cache.get(ff._MARKET_KEY)["polled_at"] + 3600)
        assert out["state"] == "stale" and "60 minutes ago" in out["reason"]


class TestFeedTicker:
    def test_miss_is_pending_and_queues_one_read_without_calling_sec(self, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        queued = []
        monkeypatch.setattr(ff, "_schedule", lambda s: queued.append(s) or True)
        monkeypatch.setattr(ff, "_sec_get", lambda u: pytest.fail("SEC on the request path"))
        out = ff.ticker_feed("aapl")
        assert out["state"] == "pending" and out["rows"] is None and queued == ["AAPL"]

    def test_refresh_then_read_cites_every_row_and_merges_newer_feed_rows(self, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        monkeypatch.setattr(ff, "_sec_get", _feed_get())
        snap = ff._refresh("AAPL")
        assert snap["state"] == "ok" and snap["cik"] == 320193
        newer = {"form": "8-K", "company": "Apple Inc.", "cik": 320193, "ticker": "AAPL",
                 "accession": "0000320193-26-999999", "filed": "2026-10-02", "accepted": "2026-10-02T16:05:00-04:00",
                 "url": ff.index_url(320193, "0000320193-26-999999"), "source": ff.SOURCE_FEED,
                 "items": ff.items_of(["2.02"])}
        cache.set(ff._MARKET_KEY, {"rows": [newer], "forms": {}, "polled_at": 0}, 60)
        out = ff.ticker_feed("AAPL")
        assert out["state"] == "ok" and out["merged_from_feed"] == 1
        assert out["rows"][0]["accession"] == "0000320193-26-999999"
        assert all(r["accession"] and r["url"] and r["source"] for r in out["rows"])

    def test_unknown_symbol_is_not_found_with_the_partial_file_reason(self, monkeypatch):
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        monkeypatch.setattr(ff, "_sec_get", _feed_get())
        ff._refresh("ZZZZ")
        out = ff.ticker_feed("ZZZZ")
        assert out["state"] == "not_found" and "partial" in out["reason"] and out["rows"] is None

    def test_sec_down_is_unavailable(self, monkeypatch):
        from api.services.fundamentals_pit.sec_client import SecError

        def down(url):
            raise SecError(url, 503, "down")
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        monkeypatch.setattr(ff, "_sec_get", down)
        ff._refresh("AAPL")
        out = ff.ticker_feed("AAPL")
        assert out["state"] == "unavailable" and out["rows"] is None

    def test_schedule_refuses_while_dark(self):
        assert ff._schedule("AAPL") is False

    def test_the_only_sec_path_is_sec_client(self):
        src = inspect.getsource(ff)
        assert "sec_client.get_bytes" in src
        for banned in ("requests.get", "urllib.request.urlopen", "httpx."):
            assert banned not in src


# ══ Routes ══════════════════════════════════════════════════════════════════

class TestRoutes:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_cov as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    @pytest.mark.parametrize("path", ["/api/research/people/AAPL", "/api/research/estimate-history/AAPL",
                                      "/api/research/filings-feed/AAPL", "/api/research/filings-feed"])
    def test_dark_by_default_is_a_404(self, client, path):
        _, c = client
        assert c.get(path).status_code == 404

    def test_each_flag_arms_only_its_own_routes(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv(eh.ENABLED_ENV, "1")
        assert c.get("/api/research/estimate-history/AAPL").status_code == 200
        assert c.get("/api/research/people/AAPL").status_code == 404
        assert c.get("/api/research/filings-feed").status_code == 404

    def test_armed_people_route(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv(rp.ENABLED_ENV, "1")
        _fake_fmp(monkeypatch)
        body = c.get("/api/research/people/aapl").json()
        assert body["ticker"] == "AAPL" and body["executives"]["rows"]

    def test_armed_feed_routes_and_form_validation(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        monkeypatch.setattr(ff, "_schedule", lambda s: True)
        assert c.get("/api/research/filings-feed").json()["state"] == "pending"
        assert c.get("/api/research/filings-feed/AAPL?form=8-K").json()["state"] == "pending"
        assert c.get("/api/research/filings-feed?form=DEF%2014A").status_code == 400
        assert c.get("/api/research/filings-feed/NV%3BDA").status_code == 400

    def test_every_handler_is_sync(self, client):
        route, _ = client
        for fn in (route.research_people_route, route.estimate_history_route,
                   route.filings_feed_ticker_route, route.filings_feed_market_route):
            assert not inspect.iscoroutinefunction(fn)

    def test_the_auth_payload_reads_the_same_switches(self, monkeypatch):
        from api.routers import auth
        assert auth._research_cov_flags() == {"research_people_enabled": False,
                                              "estimate_history_enabled": False, "filings_feed_enabled": False}
        monkeypatch.setenv(rp.ENABLED_ENV, "1")
        monkeypatch.setenv(ff.ENABLED_ENV, "1")
        assert auth._research_cov_flags() == {"research_people_enabled": True,
                                              "estimate_history_enabled": False, "filings_feed_enabled": True}
