"""Regression guard for the FMP endpoint mix-up (price-target-summary vs
-consensus, grades-historical vs grades-news) that shipped 2026-07-11: the
old bug had the price target avg populate while low/high/firm stayed null.
Unlike test_analyst_intel.py (which mocks _fmp_price_target/_fmp_recent_actions
themselves), these tests mock only ee._fmp_get with REAL captured response
shapes and exercise the actual parsing functions — the level that would have
caught a wrong endpoint path or field-name rename."""
import importlib


def _mod():
    import api.services.analyst_intel as ai
    importlib.reload(ai)
    return ai


# Captured live from financialmodelingprep.com/stable/price-target-consensus?symbol=AAPL
PRICE_TARGET_CONSENSUS_FIXTURE = [
    {"symbol": "AAPL", "targetHigh": 400, "targetLow": 253, "targetConsensus": 327, "targetMedian": 325},
]

# Captured live from financialmodelingprep.com/stable/grades-news?symbol=AAPL&limit=3
GRADES_NEWS_FIXTURE = [
    {
        "symbol": "AAPL",
        "publishedDate": "2026-07-08T17:38:49.000Z",
        "newsURL": "https://thefly.com/ajax/news_get.php?id=4381545",
        "newsTitle": "Broadcom agreement a strategic positive for Apple, says Evercore ISI",
        "newsBaseURL": "thefly.com",
        "newsPublisher": "TheFly",
        "newGrade": "Outperform",
        "previousGrade": "Outperform",
        "gradingCompany": "Evercore ISI",
        "action": "hold",
        "priceWhenPosted": 314.738,
    },
    {
        "symbol": "AAPL",
        "publishedDate": "2026-06-25T20:11:48.000Z",
        "newsURL": "https://thefly.com/ajax/news_get.php?id=4375700",
        "newsTitle": "What You Missed On Wall Street On Thursday",
        "newsBaseURL": "thefly.com",
        "newsPublisher": "TheFly",
        "newGrade": "Neutral",
        "previousGrade": "Buy",
        "gradingCompany": "Goldman Sachs",
        "action": "initialise",
        "priceWhenPosted": 275.15,
    },
]

# The OLD (wrong) endpoints' real shapes — kept so a future accidental revert
# to either path is caught even if the fixture above is never touched.
PRICE_TARGET_SUMMARY_FIXTURE = [
    {"symbol": "AAPL", "lastMonth": 12, "lastMonthAvgPriceTarget": 327.4,
     "lastQuarter": 40, "lastQuarterAvgPriceTarget": 310.1},
]
GRADES_HISTORICAL_FIXTURE = [
    {"symbol": "AAPL", "date": "2026-07-01", "analystRatingsBuy": 30,
     "analystRatingsHold": 8, "analystRatingsSell": 1},
]


def test_fmp_price_target_uses_consensus_endpoint_and_parses_range(monkeypatch):
    ai = _mod()
    calls = []

    def fake_fmp_get(path, params, timeout=10):
        calls.append(path)
        if path == "/stable/price-target-consensus":
            return PRICE_TARGET_CONSENSUS_FIXTURE
        raise AssertionError(f"unexpected FMP path: {path}")

    monkeypatch.setattr(ai.ee, "_fmp_get", fake_fmp_get)
    pt = ai._fmp_price_target("AAPL")
    assert calls == ["/stable/price-target-consensus"]
    assert pt == {"low": 253.0, "avg": 327.0, "high": 400.0, "count": None, "updated": None}


def test_fmp_price_target_wrong_endpoint_shape_would_leave_range_null(monkeypatch):
    # Documents WHY the old endpoint was wrong: price-target-summary has no
    # low/high fields at all, so even a syntactically-valid response silently
    # produces a null range. If this ever passes with a non-null range,
    # something reintroduced summary-shaped field names into the parser.
    ai = _mod()
    monkeypatch.setattr(ai.ee, "_fmp_get", lambda path, params, timeout=10: PRICE_TARGET_SUMMARY_FIXTURE)
    row = PRICE_TARGET_SUMMARY_FIXTURE[0]
    assert row.get("targetLow") is None and row.get("targetHigh") is None


def test_fmp_recent_actions_uses_grades_news_endpoint_and_parses_firm(monkeypatch):
    ai = _mod()
    calls = []

    def fake_fmp_get(path, params, timeout=10):
        calls.append(path)
        if path == "/stable/grades-news":
            return GRADES_NEWS_FIXTURE
        raise AssertionError(f"unexpected FMP path: {path}")

    monkeypatch.setattr(ai.ee, "_fmp_get", fake_fmp_get)
    actions = ai._fmp_recent_actions("AAPL")
    assert calls == ["/stable/grades-news"]
    assert len(actions) == 2
    assert actions[0]["firm"] == "Evercore ISI"
    assert actions[0]["date"] == "2026-07-08"
    assert actions[0]["news_url"] == "https://thefly.com/ajax/news_get.php?id=4381545"
    assert actions[0]["news_publisher"] == "TheFly"
    assert actions[1]["firm"] == "Goldman Sachs"
    assert actions[1]["from_grade"] == "Buy"
    assert actions[1]["to_grade"] == "Neutral"


def test_fmp_recent_actions_has_no_price_target_key(monkeypatch):
    """grades-news's real shape (GRADES_NEWS_FIXTURE, captured live) has no
    priceTarget field at all, so r.get("priceTarget") only ever returns
    None — the key is dropped entirely rather than kept around always-null,
    which would wrongly imply the data sometimes has one."""
    ai = _mod()
    monkeypatch.setattr(ai.ee, "_fmp_get", lambda path, params, timeout=10: GRADES_NEWS_FIXTURE)
    actions = ai._fmp_recent_actions("AAPL")
    assert "price_target" not in actions[0]


def test_fmp_recent_actions_wrong_endpoint_shape_has_no_firm_field(monkeypatch):
    # grades-historical rows are aggregate counts-by-date — no gradingCompany
    # at all, so a revert to that endpoint would silently produce firm=None
    # for every row (the "Recent Rating Changes" blanks bug).
    row = GRADES_HISTORICAL_FIXTURE[0]
    assert row.get("gradingCompany") is None and row.get("action") is None


def test_get_analyst_intel_backfills_count_and_updated_from_actions(monkeypatch):
    ai = _mod()
    monkeypatch.setattr(ai, "_fmp_consensus", lambda t: {"rating": "Buy", "buy": 10, "hold": 2, "sell": 0, "strong_buy": 0, "strong_sell": 0})
    monkeypatch.setattr(ai, "_fmp_price_target", lambda t: {"low": 200.0, "avg": 250.0, "high": 300.0, "count": None, "updated": None})
    monkeypatch.setattr(ai, "_fmp_recent_actions", lambda t: [
        {"date": "2026-07-08", "firm": "Evercore ISI", "action": "hold", "from_grade": "Outperform", "to_grade": "Outperform", "price_target": None, "news_url": None, "news_publisher": None},
        {"date": "2026-06-25", "firm": "Goldman Sachs", "action": "initialise", "from_grade": "Buy", "to_grade": "Neutral", "price_target": None, "news_url": None, "news_publisher": None},
        {"date": "2026-06-08", "firm": "Evercore ISI", "action": "hold", "from_grade": "Outperform", "to_grade": "Outperform", "price_target": None, "news_url": None, "news_publisher": None},
    ])
    out = ai.get_analyst_intel("ZZDUP", current_price=240.0)
    assert out["price_target"]["count"] == 2  # 2 distinct firms across 3 rows
    assert out["price_target"]["updated"] == "2026-07-08"  # newest action date
