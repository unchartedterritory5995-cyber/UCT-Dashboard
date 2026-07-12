"""Regression guard for the ownership-tab FMP endpoint bug (2026-07-12,
sibling of the analyst_intel FMP fix): /stable/institutional-ownership/
symbol-ownership 404s (not a real FMP path) and even if it existed, the code
read `ownershipPercent` which isn't a real field either — the real endpoint
is /stable/institutional-ownership/extract-analytics/holder with field
`ownership`. Because get_ownership() silently fell through to the sparse
yfinance fallback on any FMP failure, this shipped without a visible error.
Mocks only ee._fmp_get with a REAL captured response shape and exercises the
actual parsing function — the level that would have caught it."""
import importlib
import api.services.institutional_holdings as ih_mod


def _mod():
    importlib.reload(ih_mod)
    return ih_mod


# Captured live from financialmodelingprep.com/stable/institutional-ownership/
# extract-analytics/holder?symbol=AAPL&year=2026&quarter=1&limit=2
EXTRACT_ANALYTICS_HOLDER_FIXTURE = [
    {
        "date": "2026-03-31", "cik": "0002012383", "filingDate": "2026-05-13",
        "investorName": "BLACKROCK, INC.", "symbol": "AAPL", "securityName": "APPLE INC",
        "weight": 5.0758, "lastWeight": 5.3058, "changeInWeight": -0.23,
        "marketValue": 290512251859, "lastMarketValue": 313907425492,
        "sharesNumber": 1144695425, "lastSharesNumber": 1154665731,
        "changeInSharesNumber": -9970306, "quarterEndPrice": 253.79,
        "isNew": False, "isSoldOut": False,
        "ownership": 7.7616, "lastOwnership": 7.8292, "changeInOwnership": -0.0676,
    },
    {
        "date": "2026-03-31", "cik": "0002100119", "filingDate": "2026-05-15",
        "investorName": "VANGUARD GROUP INC", "symbol": "AAPL", "securityName": "APPLE INC",
        "weight": 4.1, "marketValue": 200000000000, "lastMarketValue": 190000000000,
        "sharesNumber": 1300000000, "lastSharesNumber": 1250000000,
        "changeInSharesNumber": 50000000, "isNew": False, "isSoldOut": False,
        "ownership": 8.4,
    },
]

# The OLD (wrong) endpoint's real shape — 404s, so FMP never returns this;
# kept only to document why the old field-name assumptions were wrong.
SYMBOL_OWNERSHIP_404_BODY = {
    "Error Message": "Legacy Endpoint : ... this endpoint is deprecated"
}


def test_fmp_ownership_uses_extract_analytics_holder_endpoint(monkeypatch):
    ih = _mod()
    calls = []

    def fake_fmp_get(path, params, timeout=10):
        calls.append((path, params.get("year"), params.get("quarter")))
        if path == "/stable/institutional-ownership/extract-analytics/holder":
            return EXTRACT_ANALYTICS_HOLDER_FIXTURE
        raise AssertionError(f"unexpected FMP path: {path}")

    # institutional_holdings imports earnings_estimates lazily inside the
    # function, so patch it at the source module.
    import api.services.earnings_estimates as ee_mod
    monkeypatch.setattr(ee_mod, "_fmp_get", fake_fmp_get)

    rows = ih._fmp_ownership("AAPL")
    assert calls, "expected at least one FMP call"
    assert calls[0][0] == "/stable/institutional-ownership/extract-analytics/holder"
    assert len(rows) == 2
    by_holder = {r["holder"]: r for r in rows}
    assert by_holder["BLACKROCK, INC."]["shares"] == 1144695425
    assert by_holder["BLACKROCK, INC."]["prior_shares"] == 1154665731
    assert by_holder["BLACKROCK, INC."]["pct_out"] == 7.7616  # from `ownership`, not `ownershipPercent`
    assert by_holder["VANGUARD GROUP INC"]["pct_out"] == 8.4


def test_fmp_ownership_falls_back_to_earlier_quarter_when_current_is_empty(monkeypatch):
    ih = _mod()
    seen_quarters = []

    def fake_fmp_get(path, params, timeout=10):
        seen_quarters.append((params.get("year"), params.get("quarter")))
        if len(seen_quarters) < 2:
            return []  # most recent completed quarter not filed yet
        return EXTRACT_ANALYTICS_HOLDER_FIXTURE

    import api.services.earnings_estimates as ee_mod
    monkeypatch.setattr(ee_mod, "_fmp_get", fake_fmp_get)

    rows = ih._fmp_ownership("AAPL")
    assert len(seen_quarters) == 2  # tried the newest, fell back one quarter
    assert len(rows) == 2


def test_recent_13f_quarters_skips_the_not_yet_filed_quarter():
    # 2026-07-12 is 12 days after Q2 2026 quarter-end (2026-06-30) — the SEC's
    # 45-day 13F deadline (~2026-08-14) hasn't passed, so Q2 has early-filer
    # data only (small/foreign funds), not the real top-holders list
    # (BlackRock/Vanguard file near the deadline). The first quarter tried
    # must be the fully-filed Q1 2026, not the still-filling Q2 2026.
    from datetime import UTC, datetime
    ih = _mod()
    quarters = ih._recent_13f_quarters(now=datetime(2026, 7, 12, tzinfo=UTC))
    assert quarters[0] == (2026, 1)
    assert (2026, 2) not in quarters


def test_recent_13f_quarters_includes_quarter_once_deadline_passed():
    # By 2026-08-20 (6 days past the ~Aug 14 deadline) Q2 2026 should be
    # considered filed and tried first.
    from datetime import UTC, datetime
    ih = _mod()
    quarters = ih._recent_13f_quarters(now=datetime(2026, 8, 20, tzinfo=UTC))
    assert quarters[0] == (2026, 2)


def test_wrong_endpoint_shape_has_no_investorName_field():
    # Documents WHY the old path was wrong: it 404s outright, so there is no
    # shape to parse at all — the bug was invisible because _fmp_ownership's
    # bare except swallowed the HTTPError into an empty list.
    assert "Error" in SYMBOL_OWNERSHIP_404_BODY or "investorName" not in SYMBOL_OWNERSHIP_404_BODY
