"""Tests for the FMP 13F institutional-ownership enrichment on the research Ownership tab."""
import datetime
import api.services.research.ownership as om


def test_recent_quarters_newest_first():
    qs = om._recent_quarters(datetime.date(2026, 6, 29))   # Q2 2026
    assert qs == [(2026, 2), (2026, 1), (2025, 4), (2025, 3)]


def test_thirteen_f_composes_from_newest_filed_quarter(monkeypatch):
    summary_2026q1 = {
        "investorsHolding": 6339, "investorsHoldingChange": -17,
        "ownershipPercent": 63.4605, "ownershipPercentChange": -0.9558,
        "totalInvested": 2376850490064, "totalInvestedChange": -203674085659,
        "newPositions": 204, "increasedPositions": 2574,
        "reducedPositions": 3085, "closedPositions": 233, "putCallRatio": 0.8082,
    }
    holders = [
        {"investorName": "VANGUARD GROUP INC", "sharesNumber": 1426283914,
         "changeInSharesNumber": 26856752, "changeInSharesNumberPercentage": 1.92,
         "ownership": 9.67, "marketValue": 387749544852, "isNew": False, "isSoldOut": False},
        {"investorName": "NEWCOMER LP", "sharesNumber": 1000, "changeInSharesNumber": 1000,
         "ownership": 0.01, "marketValue": 271860, "isNew": True, "isSoldOut": False},
    ]

    def fake_fmp(path, params, timeout=10):
        if "positions-summary" in path:
            return [summary_2026q1] if params["quarter"] == 1 else []   # Q2 empty, Q1 has data
        if "extract-analytics/holder" in path:
            assert params["quarter"] == 1 and params["year"] == 2026     # same quarter as summary
            return holders
        return None

    monkeypatch.setattr(om.ee, "_fmp_get", fake_fmp)
    monkeypatch.setattr(om.datetime, "date", _FixedDate)   # pin today → Q2 2026

    tf = om._thirteen_f("AAPL")
    assert tf["quarter"] == "2026Q1"
    assert tf["summary"]["ownership_pct"] == 63.4605
    assert tf["summary"]["ownership_change"] == -0.9558
    assert tf["summary"]["new_positions"] == 204
    assert tf["summary"]["closed_positions"] == 233
    assert len(tf["holders"]) == 2
    assert tf["holders"][0]["name"] == "VANGUARD GROUP INC"
    assert tf["holders"][0]["change_shares"] == 26856752
    assert tf["holders"][1]["is_new"] is True


def test_thirteen_f_none_when_no_filing(monkeypatch):
    monkeypatch.setattr(om.ee, "_fmp_get", lambda path, params, timeout=10: [])
    assert om._thirteen_f("ZZ") is None


class _FixedDate(datetime.date):
    @classmethod
    def today(cls):
        return datetime.date(2026, 6, 29)
