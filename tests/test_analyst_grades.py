"""Tests for the composed analyst-grades service (FMP Ultimate)."""
import api.services.analyst_grades as ag


class _FakeCache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = v


def _routes(monkeypatch, mapping):
    """Patch ee._fmp_get to dispatch by path substring → fixture list."""
    def fake(path, params, timeout=10):
        for frag, payload in mapping.items():
            if frag in path:
                return payload
        return None
    monkeypatch.setattr(ag.ee, "_fmp_get", fake)
    monkeypatch.setattr(ag, "cache", _FakeCache())


def test_full_payload_composes(monkeypatch):
    _routes(monkeypatch, {
        "grades-consensus": [{"symbol": "AAPL", "strongBuy": 1, "buy": 69, "hold": 34,
                              "sell": 7, "strongSell": 0, "consensus": "Buy"}],
        "price-target-consensus": [{"targetHigh": 400, "targetLow": 253,
                                    "targetConsensus": 327, "targetMedian": 325}],
        "price-target-summary": [{"lastMonthCount": 4, "lastMonthAvgPriceTarget": 337.5,
                                  "lastQuarterCount": 14, "lastQuarterAvgPriceTarget": 326.86,
                                  "lastYearCount": 60, "lastYearAvgPriceTarget": 299.43}],
        "grades-historical": [{"date": "2026-06-01", "analystRatingsStrongBuy": 7,
                               "analystRatingsBuy": 23, "analystRatingsHold": 15,
                               "analystRatingsSell": 2, "analystRatingsStrongSell": 2}],
        "grades": [
            {"date": "2026-06-25", "gradingCompany": "Evercore ISI Group",
             "previousGrade": "Outperform", "newGrade": "Outperform", "action": "maintain"},
            {"date": "2026-06-22", "gradingCompany": "KGI Securities",
             "previousGrade": "Outperform", "newGrade": "Hold", "action": "downgrade"},
        ],
    })
    res = ag.get_analyst_grades("aapl")
    assert res["symbol"] == "AAPL"
    assert res["consensus"]["total"] == 1 + 69 + 34 + 7 + 0
    assert res["consensus"]["label"] == "Buy"
    assert res["price_target"]["consensus"] == 327
    assert res["price_target"]["last_month"]["avg"] == 337.5
    # newest-first, capped; downgrade preserved with grade transition
    assert res["recent_actions"][1] == {
        "date": "2026-06-22", "company": "KGI Securities",
        "action": "downgrade", "from_grade": "Outperform", "to_grade": "Hold"}
    assert res["trend"][0]["hold"] == 15


def test_partial_sources_null_only_their_slice(monkeypatch):
    # Only consensus resolves; price-target + grades empty → payload still returned.
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 2, "buy": 5, "hold": 3, "sell": 0,
                              "strongSell": 0, "consensus": "Strong Buy"}],
    })
    res = ag.get_analyst_grades("ZZ")
    assert res is not None
    assert res["consensus"]["label"] == "Strong Buy"
    assert res["price_target"] is None
    assert res["recent_actions"] == []
    assert res["trend"] == []


def test_all_empty_returns_none_and_caches_miss(monkeypatch):
    cache = _FakeCache()
    monkeypatch.setattr(ag.ee, "_fmp_get", lambda path, params, timeout=10: [])
    monkeypatch.setattr(ag, "cache", cache)
    assert ag.get_analyst_grades("NADA") is None
    assert cache.get("analyst_grades_NADA") == {"_miss": True}


def test_zero_count_consensus_is_dropped(monkeypatch):
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 0, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Hold"}],
        "price-target-consensus": [{"targetConsensus": 100}],
    })
    res = ag.get_analyst_grades("ZZ")
    assert res["consensus"] is None          # all-zero buckets → no consensus
    assert res["price_target"]["consensus"] == 100


def test_the_four_legs_run_CONCURRENTLY_not_one_after_another(monkeypatch):
    """Pinned with a barrier, not a stopwatch.

    Sequentially the four provider legs cost ~3.25s end-to-end while each is
    only ~0.8s — over the 2-3s budget this panel is held to. A timing assertion
    would be flaky on a loaded box; a barrier is exact: all four legs must be in
    flight AT THE SAME TIME for it to release. Run one after another, the first
    leg waits for three that have not started, and this fails on timeout.
    """
    import threading

    barrier = threading.Barrier(4, timeout=5)

    def _leg(result):
        def fn(_ticker):
            barrier.wait()          # raises BrokenBarrierError if run serially
            return result
        return fn

    monkeypatch.setattr(ag, "cache", _FakeCache())
    monkeypatch.setattr(ag, "_consensus", _leg({"label": "Buy"}))
    monkeypatch.setattr(ag, "_price_target", _leg({"median": 100.0}))
    monkeypatch.setattr(ag, "_recent_actions", _leg([{"firm": "X"}]))
    monkeypatch.setattr(ag, "_trend", _leg([{"month": "2026-08"}]))

    out = ag.get_analyst_grades("DIS")

    assert out is not None
    assert out["consensus"] == {"label": "Buy"}
    assert out["recent_actions"] == [{"firm": "X"}]
