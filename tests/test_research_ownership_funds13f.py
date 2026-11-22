"""The Form 13F holder rows on the research ownership answer (the OWN panel's Funds (13F) block).

Every field the FMP holder row carries is passed on from the row the read already fetched (no
further vendor call): the filer's SEC id, the filing date and the quarter end, last quarter's
shares / value / percent of shares, the position's weight in the filer's portfolio, and the
summary's total shares held. A field the vendor left out is None, never 0. The holders read asks
for `_TF_MAX_HOLDERS` rows in ONE call, and the answer says how many it asked for.

Every fund name, id and figure here is INVENTED; the row's FIELD NAMES are those of the live
capture checked into `test_institutional_holdings_fmp_shapes.py`.
"""
import datetime

import api.services.research.ownership as om
from api.services import provider_errors as pe
from api.services.cache import cache


def _result(value, *, degraded=None):
    return pe.ProviderResult(
        value=value,
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"),
        licensing_class="R",
        freshness="historical",
        degraded=degraded,
    )


class _FixedDate(datetime.date):
    @classmethod
    def today(cls):
        return datetime.date(2031, 11, 20)


SUMMARY = {
    "investorsHolding": 412, "investorsHoldingChange": 9,
    "ownershipPercent": 41.5, "ownershipPercentChange": 1.25,
    "totalInvested": 8_400_000_000, "totalInvestedChange": 310_000_000,
    "newPositions": 31, "increasedPositions": 150, "reducedPositions": 120, "closedPositions": 18,
    "putCallRatio": 0.62, "numberOf13Fshares": 96_500_000, "numberOf13FsharesChange": -1_250_000,
}

FULL_ROW = {
    "date": "2031-09-30", "cik": "0009990001", "filingDate": "2031-11-12",
    "investorName": "HARROWGATE CAPITAL LLC", "symbol": "QZXW", "securityName": "QUIZZICAL WIDGETS INC",
    "weight": 2.5, "lastWeight": 2.1, "changeInWeight": 0.4,
    "marketValue": 410_000_000, "lastMarketValue": 300_000_000,
    "sharesNumber": 4_100_000, "lastSharesNumber": 3_600_000,
    "changeInSharesNumber": 500_000, "changeInSharesNumberPercentage": 13.89,
    "quarterEndPrice": 100.0, "isNew": False, "isSoldOut": False,
    "ownership": 4.25, "lastOwnership": 3.73, "changeInOwnership": 0.52,
}

# Only what the panel had before this change: the newer fields are simply absent.
SPARSE_ROW = {"investorName": "QUILLSTONE PARTNERS", "sharesNumber": 1000, "isNew": True}


def _thirteen_f(monkeypatch, holders, *, summary=SUMMARY, seen=None):
    def fake_summary(ticker, *, year, quarter):
        return _result([summary] if (year, quarter) == (2031, 3) else [])

    def fake_holders(ticker, *, year, quarter, limit=12):
        if seen is not None:
            seen.append({"year": year, "quarter": quarter, "limit": limit})
        return _result(holders)

    monkeypatch.setattr(om.fmp_client, "get_institutional_ownership_summary", fake_summary)
    monkeypatch.setattr(om.fmp_client, "get_institutional_ownership_holders", fake_holders)
    monkeypatch.setattr(om.datetime, "date", _FixedDate)
    cache.invalidate(om._TF_QUARTER_HINT_KEY)
    return om._thirteen_f("QZXW")


def test_every_holder_field_is_passed_on(monkeypatch):
    tf = _thirteen_f(monkeypatch, [FULL_ROW])
    assert tf["quarter"] == "2031Q3"
    h = tf["holders"][0]
    assert h == {
        "name": "HARROWGATE CAPITAL LLC", "cik": "0009990001",
        "shares": 4_100_000, "prior_shares": 3_600_000,
        "change_shares": 500_000, "change_pct": 13.89,
        "ownership": 4.25, "prior_ownership": 3.73, "change_ownership": 0.52,
        "market_value": 410_000_000, "prior_market_value": 300_000_000,
        "weight": 2.5, "prior_weight": 2.1, "change_weight": 0.4,
        "quarter_end_price": 100.0, "quarter_end": "2031-09-30", "filing_date": "2031-11-12",
        "is_new": False, "is_sold_out": False,
    }


def test_a_field_the_vendor_left_out_is_none_never_zero(monkeypatch):
    tf = _thirteen_f(monkeypatch, [SPARSE_ROW])
    h = tf["holders"][0]
    assert h["shares"] == 1000 and h["is_new"] is True
    for key in ("cik", "prior_shares", "change_shares", "change_pct", "ownership", "prior_ownership",
                "change_ownership", "market_value", "prior_market_value", "weight", "prior_weight",
                "change_weight", "quarter_end_price", "quarter_end", "filing_date"):
        assert h[key] is None, key


def test_a_date_that_is_not_a_date_is_none_and_a_timestamp_keeps_its_day(monkeypatch):
    rows = [dict(FULL_ROW, date="not a date", filingDate="2031-11-12T16:05:00", cik="   ")]
    h = _thirteen_f(monkeypatch, rows)["holders"][0]
    assert h["quarter_end"] is None
    assert h["filing_date"] == "2031-11-12"
    assert h["cik"] is None


def test_the_holders_read_is_one_call_for_the_cap_and_the_answer_says_the_cap(monkeypatch):
    seen = []
    rows = [dict(FULL_ROW, investorName=f"INVENTED FILER {i}") for i in range(om._TF_MAX_HOLDERS + 5)]
    tf = _thirteen_f(monkeypatch, rows, seen=seen)
    assert seen == [{"year": 2031, "quarter": 3, "limit": om._TF_MAX_HOLDERS}]
    assert om._TF_MAX_HOLDERS == 50
    assert len(tf["holders"]) == om._TF_MAX_HOLDERS
    assert tf["holders_limit"] == om._TF_MAX_HOLDERS


def test_the_summary_carries_the_total_shares_held(monkeypatch):
    s = _thirteen_f(monkeypatch, [FULL_ROW])["summary"]
    assert s["total_shares"] == 96_500_000
    assert s["total_shares_change"] == -1_250_000
    assert s["investors_holding"] == 412 and s["closed_positions"] == 18 and s["put_call_ratio"] == 0.62


def test_a_summary_without_total_shares_says_none(monkeypatch):
    bare = {k: v for k, v in SUMMARY.items() if not k.startswith("numberOf13F")}
    s = _thirteen_f(monkeypatch, [FULL_ROW], summary=bare)["summary"]
    assert s["total_shares"] is None and s["total_shares_change"] is None


def test_the_route_answers_the_new_fields_as_the_service_built_them(monkeypatch):
    """The route passes the service's answer through: a minimal app over the research router."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import api.routers.research as research_router

    tf = _thirteen_f(monkeypatch, [FULL_ROW, SPARSE_ROW])
    monkeypatch.setattr(research_router, "get_ownership", lambda sym: {
        "sym": sym.upper(), "institutional": {"state": "ok", "pct_held": 41.5}, "short": {"state": "not_held"},
        "insider": [], "thirteen_f": {k: v for k, v in tf.items() if k != "_meta"},
    })
    monkeypatch.setattr(research_router.edgar_ownership, "is_enabled", lambda: False)
    app = FastAPI()
    app.include_router(research_router.router)
    body = TestClient(app).get("/api/research/ownership/QZXW").json()
    rows = body["thirteen_f"]["holders"]
    assert rows[0]["filing_date"] == "2031-11-12" and rows[0]["weight"] == 2.5 and rows[0]["cik"] == "0009990001"
    assert rows[1]["prior_shares"] is None and rows[1]["weight"] is None
    assert body["thirteen_f"]["holders_limit"] == 50
    assert body["thirteen_f"]["summary"]["total_shares"] == 96_500_000
