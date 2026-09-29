"""TERM-045 -- SEC EDGAR Form 4 / 13F ownership (api/services/edgar_ownership.py).

Fixtures under tests/fixtures/edgar_ownership/ are REAL SEC documents recorded
2026-09-29 through the repo's own fair-access client (sec_client, declared
User-Agent). The only edits: CRLF -> LF, and every <reportingOwnerAddress> block
removed from the Form 4s (the parser never reads it). The submissions document
is AAPL's, trimmed to its newest 80 filings. No test here touches the network:
`_sec_get` and `_resolve_cik` are replaced by name.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from api.services import edgar_ownership as eo
from api.services import provider_errors as pe
from api.services.cache import cache
from api.services.fundamentals_pit.sec_client import SecError

FIX = Path(__file__).parent / "fixtures" / "edgar_ownership"
AAPL_CIK = "0000320193"
TODAY = date(2026, 9, 29)          # the day the fixtures were recorded


def _b(name: str) -> bytes:
    return (FIX / name).read_bytes()


F4_SALES_GIFT = "form4_aapl_0001140361-26-020298.xml"     # S, S, G + a holding
F4_ONE_SALE = "form4_aapl_0001140361-26-037584.xml"       # S
F4_GRANT = "form4_aapl_0001140361-26-035362.xml"          # A (award)
F4A_BUY = "form4a_cfnd_0001104659-26-111497.xml"          # 4/A: P, J; flags as 0/1
F4_JOINT = "form4_bgde_0000912282-26-001310.xml"          # five reporting owners, J
INFOTABLE = "13f_infotable_brk_0001193125-26-352200.xml"
SUBMISSIONS = "submissions_aapl_trimmed.json"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("EDGAR_OWNERSHIP_ENABLED", raising=False)
    for k in list(cache.keys_with_prefix(eo._CACHE_PREFIX)):
        cache.invalidate(k)
    eo._queued.clear()
    yield
    for k in list(cache.keys_with_prefix(eo._CACHE_PREFIX)):
        cache.invalidate(k)
    eo._queued.clear()


# ── Form 4 parser ───────────────────────────────────────────────────────────

class TestParseForm4:
    def test_sales_and_gift_verbatim(self):
        doc = eo.parse_form4(_b(F4_SALES_GIFT), accession="0001140361-26-020298", filing_date="2026-05-08")
        assert doc["form"] == "4"
        assert doc["issuer"] == {"cik": AAPL_CIK, "name": "Apple Inc.", "symbol": "AAPL"}
        assert [o["name"] for o in doc["owners"]] == ["LEVINSON ARTHUR D"]
        assert doc["owners"][0]["is_director"] is True
        codes = [t["code"] for t in doc["transactions"]]
        assert codes == ["S", "S", "G"]             # the <nonDerivativeHolding> is not a transaction
        first = doc["transactions"][0]
        assert first["shares"] == 149527.0
        assert first["price"] == 284.57             # a footnote beside the value does not hide it
        assert first["acquired_disposed"] == "D"
        assert first["owned_after"] == 3920049.0
        assert first["date"] == "2026-05-06"

    def test_rows_keep_only_open_market_P_and_S(self):
        doc = eo.parse_form4(_b(F4_SALES_GIFT), accession="0001140361-26-020298", filing_date="2026-05-08")
        rows = eo.form4_rows(doc)
        assert len(rows) == 2                       # the gift (G) is not a sale
        r = rows[0]
        assert r["type"] == "sell"
        assert r["shares"] == 149527
        assert r["price"] == 284.57
        assert r["amount"] == round(149527 * 284.57, 2)
        assert r["accession"] == "0001140361-26-020298"
        assert r["form"] == "4"
        assert r["title"] == "Director"
        assert r["url"] == ("https://www.sec.gov/Archives/edgar/data/320193/"
                            "000114036126020298/0001140361-26-020298-index.htm")

    def test_amended_buy_with_numeric_flags(self):
        doc = eo.parse_form4(_b(F4A_BUY), accession="0001104659-26-111497", filing_date="2026-09-28")
        assert doc["form"] == "4/A"
        o = doc["owners"][0]
        assert o["is_officer"] is True and o["is_director"] is False   # "1"/"0", not "true"/"false"
        rows = eo.form4_rows(doc)
        assert [(r["type"], r["shares"], r["price"]) for r in rows] == [("buy", 5000, 4.81)]
        assert rows[0]["title"] == "Chief Investment Officer"
        assert rows[0]["form"] == "4/A"

    def test_award_is_not_an_open_market_row(self):
        doc = eo.parse_form4(_b(F4_GRANT), accession="0001140361-26-035362", filing_date="2026-09-01")
        assert eo.form4_rows(doc) == []

    def test_joint_filing_names_every_owner(self):
        doc = eo.parse_form4(_b(F4_JOINT), accession="0000912282-26-001310", filing_date="2026-09-28")
        assert len(doc["owners"]) == 5
        assert eo._owner_title(doc["owners"][0]) == "10% Owner, SEE REMARKS"
        # a P row forged onto the joint filing carries all five names
        doc["transactions"] = [{"code": "P", "acquired_disposed": "A", "shares": 10.0, "price": 1.0,
                                "date": "2026-09-25"}]
        row = eo.form4_rows(doc)[0]
        assert row["name"].count(";") == 4

    def test_a_price_given_only_as_a_footnote_is_unknown_not_zero(self):
        raw = _b(F4_ONE_SALE).decode()
        assert "<value>" in raw.split("<transactionPricePerShare>")[1].split("</transactionPricePerShare>")[0]
        head, rest = raw.split("<transactionPricePerShare>", 1)
        body, tail = rest.split("</transactionPricePerShare>", 1)
        stripped = head + "<transactionPricePerShare>" + '<footnoteId id="F1"/>' + "</transactionPricePerShare>" + tail
        doc = eo.parse_form4(stripped.encode(), accession="x", filing_date="2026-09-24")
        rows = eo.form4_rows(doc)
        assert len(rows) == 1
        assert rows[0]["price"] is None and rows[0]["amount"] is None

    def test_a_row_without_acquired_or_disposed_is_excluded(self):
        assert eo.classify_form4_txn({"code": "P", "acquired_disposed": None}) is None
        assert eo.classify_form4_txn({"code": "S", "acquired_disposed": ""}) is None
        assert eo.classify_form4_txn({"code": "P", "acquired_disposed": "A"}) == "buy"
        assert eo.classify_form4_txn({"code": "S", "acquired_disposed": "D"}) == "sell"
        assert eo.classify_form4_txn({"code": "M", "acquired_disposed": "A"}) is None

    def test_not_a_form4_raises(self):
        with pytest.raises(eo.ParseError):
            eo.parse_form4(_b(INFOTABLE), accession="x")
        with pytest.raises(eo.ParseError):
            eo.parse_form4(b"<html>rate limited</html", accession="x")
        with pytest.raises(eo.ParseError):
            eo.parse_form4(b"<ownershipDocument><documentType>3</documentType></ownershipDocument>",
                           accession="x")

    def test_raw_document_strips_the_stylesheet_directory(self):
        assert eo._raw_document("xslF345X06/form4.xml") == "form4.xml"
        assert eo._raw_document("wk-form4_1.xml") == "wk-form4_1.xml"
        assert eo._raw_document("0000950103-03-001.txt") is None
        assert eo._raw_document(None) is None


# ── submissions listing ─────────────────────────────────────────────────────

class TestListing:
    def test_window_and_order(self):
        sub = json.loads(_b(SUBMISSIONS))
        listing = eo.list_form4_filings(sub, since="2026-04-02")
        dates = [f["filing_date"] for f in listing["filings"]]
        assert len(dates) == 19
        assert dates == sorted(dates, reverse=True)
        assert all(d >= "2026-04-02" for d in dates)
        assert listing["index_short"] is False

    def test_index_short_when_older_pages_exist_inside_the_window(self):
        sub = json.loads(_b(SUBMISSIONS))
        sub["filings"]["files"] = [{"name": "CIK0000320193-submissions-001.json"}]
        assert eo.list_form4_filings(sub, since="2025-01-01")["index_short"] is True
        assert eo.list_form4_filings(sub, since="2026-04-02")["index_short"] is False


# ── fetch (network replaced by name) ────────────────────────────────────────

def _fake_sec(mapping: dict[str, str]):
    calls = []

    def fake(url: str) -> bytes:
        calls.append(url)
        if url.endswith(f"CIK{AAPL_CIK}.json"):
            return _b(SUBMISSIONS)
        for acc, fixture in mapping.items():
            if acc.replace("-", "") in url:
                return _b(fixture)
        raise SecError(url, 404, "not found")
    fake.calls = calls
    return fake


class TestFetch:
    def test_every_listed_filing_read_is_ok(self, monkeypatch):
        sub = json.loads(_b(SUBMISSIONS))
        listing = eo.list_form4_filings(sub, since="2026-04-02")["filings"]
        fake = _fake_sec({f["accession"]: F4_ONE_SALE for f in listing})
        monkeypatch.setattr(eo, "_sec_get", fake)
        monkeypatch.setattr(eo, "_resolve_cik", lambda s: AAPL_CIK)
        res = eo.fetch_form4_activity("aapl", today=TODAY)
        assert isinstance(res, pe.ProviderResult)
        assert res.licensing_class == "A"
        assert res.provenance.vendor == "sec_edgar"
        assert res.provenance.source_observed_at is not None
        assert res.freshness is None
        v = res.value
        assert v["filings_listed"] == 19 and v["filings_read"] == 19 and v["filings_unread"] == []
        assert len(v["rows"]) == 19
        assert len(fake.calls) == 20            # 1 submissions + 19 documents, nothing else
        assert eo.snapshot_from_result(res)["state"] == "ok"

    def test_unread_filings_are_named_and_make_it_partial(self, monkeypatch):
        fake = _fake_sec({"0001140361-26-020298": F4_SALES_GIFT, "0001140361-26-037584": F4_ONE_SALE})
        monkeypatch.setattr(eo, "_sec_get", fake)
        monkeypatch.setattr(eo, "_resolve_cik", lambda s: AAPL_CIK)
        snap = eo.snapshot_from_result(eo.fetch_form4_activity("AAPL", today=TODAY))
        assert snap["state"] == "partial"
        assert snap["filings_read"] == 2
        unread = {u["accession"] for u in snap["filings_unread"]}
        assert len(unread) == 17 and "0001140361-26-037020" in unread
        assert all(u["reason"] == "sec_404" for u in snap["filings_unread"])
        assert len(snap["rows"]) == 3            # 1 sale + 2 sales, newest first
        assert snap["rows"][0]["date"] >= snap["rows"][-1]["date"]

    def test_a_filing_about_another_issuer_is_not_this_issuers_insider(self, monkeypatch):
        fake = _fake_sec({"0001140361-26-037584": F4A_BUY})   # CFND's Form 4 under AAPL's index
        monkeypatch.setattr(eo, "_sec_get", fake)
        monkeypatch.setattr(eo, "_resolve_cik", lambda s: AAPL_CIK)
        v = eo.fetch_form4_activity("AAPL", today=TODAY).value
        assert v["other_issuer_filings"] == 1 and v["rows"] == []

    def test_time_budget_names_what_was_not_read(self, monkeypatch):
        monkeypatch.setattr(eo, "_sec_get", _fake_sec({}))
        monkeypatch.setattr(eo, "_resolve_cik", lambda s: AAPL_CIK)
        v = eo.fetch_form4_activity("AAPL", today=TODAY, budget_s=-1).value
        assert v["filings_read"] == 0
        assert {u["reason"] for u in v["filings_unread"]} == {"time_budget"}

    def test_no_filer_is_not_found(self, monkeypatch):
        monkeypatch.setattr(eo, "_resolve_cik", lambda s: None)
        monkeypatch.setattr(eo, "_sec_get", lambda url: pytest.fail("must not reach SEC"))
        with pytest.raises(pe.ProviderNotFound):
            eo.fetch_form4_activity("ZZZZ", today=TODAY)
        assert eo._refresh("ZZZZ")["state"] == "not_found"

    def test_sec_down_is_unavailable_not_empty(self, monkeypatch):
        def down(url):
            raise SecError(url, 503, "unavailable")
        monkeypatch.setattr(eo, "_resolve_cik", lambda s: AAPL_CIK)
        monkeypatch.setattr(eo, "_sec_get", down)
        with pytest.raises(pe.ProviderTransient):
            eo.fetch_form4_activity("AAPL", today=TODAY)
        snap = eo._refresh("AAPL")
        assert snap["state"] == "unavailable"
        assert eo.display_rows(snap) is None
        assert cache.get(eo._key("AAPL"))["state"] == "unavailable"


# ── unknown is never zero ───────────────────────────────────────────────────

class TestUnknownIsNeverZero:
    @pytest.mark.parametrize("state", ["pending", "not_found", "unavailable"])
    def test_unread_states_have_no_rows(self, state):
        assert eo.display_rows({"state": state, "rows": []}) is None

    def test_a_complete_empty_read_is_a_real_zero(self):
        assert eo.display_rows({"state": "ok", "rows": []}) == []

    def test_overlay_while_pending(self, monkeypatch):
        monkeypatch.setenv("EDGAR_OWNERSHIP_ENABLED", "1")
        monkeypatch.setattr(eo, "_schedule", lambda sym: True)
        payload = {"sym": "AAPL", "insider": [{"name": "X", "date": "2026-09-01"}], "short": {}}
        out = eo.overlay_insider(payload, "AAPL")
        assert out["insider"] is None
        assert out["insider_source"]["state"] == "pending"
        assert out["insider_source"]["compare"] is None
        assert payload["insider"] == [{"name": "X", "date": "2026-09-01"}]   # cached payload untouched

    def test_request_path_never_touches_the_network(self, monkeypatch):
        monkeypatch.setenv("EDGAR_OWNERSHIP_ENABLED", "1")
        scheduled = []
        monkeypatch.setattr(eo, "_schedule", lambda sym: scheduled.append(sym) or True)
        monkeypatch.setattr(eo, "_sec_get", lambda url: pytest.fail("request path reached SEC"))
        monkeypatch.setattr(eo, "_resolve_cik", lambda s: pytest.fail("request path resolved a CIK"))
        snap = eo.form4_snapshot("aapl")
        assert snap["state"] == "pending" and scheduled == ["AAPL"]


class TestCompare:
    def test_names_not_percentages(self):
        edgar = [{"name": "COOK TIMOTHY D", "date": "2026-09-20"},
                 {"name": "O'BRIEN DEIRDRE", "date": "2026-09-10"},
                 {"name": "OLD NAME", "date": "2026-01-01"}]
        inc = [{"name": "Cook Timothy D.", "date": "2026-09-20"},
               {"name": "Adams Katherine", "date": "2026-08-01"}]
        c = eo.compare_by_name(edgar, inc)
        assert c["both"] == ["COOK TIMOTHY D"]
        assert c["edgar_only"] == ["O BRIEN DEIRDRE"]          # OLD NAME is before the incumbent's span
        assert c["incumbent_only"] == ["ADAMS KATHERINE"]
        assert c["compared_from"] == "2026-08-01"


# ── the flag and the route ──────────────────────────────────────────────────

class TestFlag:
    def test_default_off(self):
        assert eo.is_enabled() is False

    def test_off_schedules_nothing(self, monkeypatch):
        before = eo._executor
        assert eo._schedule("AAPL") is False
        assert eo._executor is before and not eo._queued


class TestRoute:
    BASE = {"sym": "AAPL", "entity": None, "institutional": {"pct_held": None, "holders": []},
            "short": {}, "share_counts": {}, "insider": [{"name": "Cook Timothy D", "type": "sell",
                                                          "date": "2026-09-20"}],
            "thirteen_f": None}

    def _client(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_ownership", lambda sym: dict(self.BASE))
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_flag_off_is_byte_identical(self, monkeypatch):
        monkeypatch.setattr(eo, "form4_snapshot", lambda s: pytest.fail("flag off reached EDGAR"))
        r = self._client(monkeypatch).get("/api/research/ownership/AAPL")
        assert r.status_code == 200
        assert r.json() == self.BASE
        assert "insider_source" not in r.json()

    def test_flag_on_serves_edgar_rows_with_accessions(self, monkeypatch):
        monkeypatch.setenv("EDGAR_OWNERSHIP_ENABLED", "1")
        doc = eo.parse_form4(_b(F4_SALES_GIFT), accession="0001140361-26-020298", filing_date="2026-05-08")
        rows = eo.form4_rows(doc)
        cache.set(eo._key("AAPL"), {"state": "ok", "rows": rows, "window_days": 180, "filings_listed": 1,
                                    "filings_read": 1, "filings_unread": [], "truncated_at_cap": False,
                                    "index_short": False, "licensing_class": "A"}, 60)
        r = self._client(monkeypatch).get("/api/research/ownership/AAPL")
        body = r.json()
        assert [x["accession"] for x in body["insider"]] == ["0001140361-26-020298"] * 2
        src = body["insider_source"]
        assert src["state"] == "ok" and src["vendor"] == "sec_edgar" and src["licensing_class"] == "A"
        assert src["compare"]["incumbent_only"] == ["COOK TIMOTHY D"]
        assert {k: v for k, v in body.items() if k not in ("insider", "insider_source")} == \
            {k: v for k, v in self.BASE.items() if k != "insider"}


# ── Form 13F information table ──────────────────────────────────────────────

class TestThirteenF:
    def test_parse_namespaced_table(self):
        rows = eo.parse_13f_information_table(_b(INFOTABLE), accession="0001193125-26-352200",
                                              filed_date="2026-08-14")
        assert len(rows) == 89
        ally = rows[0]
        assert ally["issuer"] == "ALLY FINL INC" and ally["cusip"] == "02005N100"
        assert ally["shares"] == 12561737.0 and ally["shares_type"] == "SH"
        assert ally["value_reported"] == 577211815.0 and ally["value_usd"] == 577211815.0
        assert ally["voting"] == {"sole": 12561737.0, "shared": 0.0, "none": 0.0}

    def test_value_unit_follows_the_filing_date_and_is_never_guessed(self):
        old = eo.parse_13f_information_table(_b(INFOTABLE), accession="a", filed_date="2022-11-14")
        assert old[0]["value_usd"] == 577211815.0 * 1000
        unknown = eo.parse_13f_information_table(_b(INFOTABLE), accession="a", filed_date=None)
        assert all(r["value_usd"] is None for r in unknown)

    def test_aggregate_sums_one_security_across_manager_rows(self):
        rows = eo.parse_13f_information_table(_b(INFOTABLE), accession="acc", filed_date="2026-08-14")
        ally_rows = [r for r in rows if r["cusip"] == "02005N100"]
        assert len(ally_rows) > 1
        agg = {p["cusip"]: p for p in eo.aggregate_13f_positions(rows)}
        assert agg["02005N100"]["shares"] == sum(r["shares"] for r in ally_rows)
        assert agg["02005N100"]["rows"] == len(ally_rows)

    def test_a_missing_value_poisons_the_sum_rather_than_shrinking_it(self):
        rows = [{"cusip": "X", "title_of_class": "COM", "shares": 10.0, "value_usd": 5.0},
                {"cusip": "X", "title_of_class": "COM", "shares": 10.0, "value_usd": None},
                {"cusip": "X", "title_of_class": "COM", "shares": 99.0, "value_usd": 1.0, "put_call": "Put"}]
        (p,) = eo.aggregate_13f_positions(rows)
        assert p["shares"] == 20.0 and p["value_usd"] is None

    def test_holder_row_has_unknown_changes(self):
        h = eo.to_thirteen_f_holder("BERKSHIRE HATHAWAY INC", {"shares": 1.0, "value_usd": 2.0, "accession": "a"})
        assert h["change_shares"] is None and h["is_new"] is None and h["accession"] == "a"
