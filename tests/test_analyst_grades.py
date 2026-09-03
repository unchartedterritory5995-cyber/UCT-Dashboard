"""Tests for the composed analyst-grades service (FMP Ultimate).

D1 note: the module now calls `fmp_client`'s typed functions directly
(rather than building its own `ee._fmp_get` path string), so these tests
mock the `fmp_client` functions by name instead of dispatching on a URL
path substring.
"""
import api.services.analyst_grades as ag
from api.services import provider_errors as pe

_FRAG_TO_ATTR = {
    "grades-consensus": "get_grades_consensus",
    "price-target-consensus": "get_price_target_consensus",
    "price-target-summary": "get_price_target_summary",
    "grades-historical": "get_grades_historical",
    "grades": "get_analyst_grades",
}


class _FakeCache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = v


def _result(value):
    return pe.ProviderResult(
        value=value,
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"),
        licensing_class="R",
    )


def _routes(monkeypatch, mapping):
    """Patch every `fmp_client` function this module touches to return its
    mapped fixture list (or an empty list when unmapped, matching the
    fixture keys the old path-substring dispatcher used)."""
    for frag, attr in _FRAG_TO_ATTR.items():
        value = mapping.get(frag, [])

        def _fn(ticker, __value=value, **kw):
            return _result(__value)

        monkeypatch.setattr(ag.fmp_client, attr, _fn)
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

    def _empty(ticker, **kw):
        return _result([])

    for attr in _FRAG_TO_ATTR.values():
        monkeypatch.setattr(ag.fmp_client, attr, _empty)
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


def test_consensus_and_price_target_carry_d1_provenance_meta(monkeypatch):
    """S8 vertical slice (owner authorization, 2026-09-03): the two cards
    EstimatesTab renders through <Provenance>/<FreshnessBadge> must receive
    D1's real typed envelope, not just the flattened values -- and the
    other two legs (actions, trend) must NOT gain a `_meta` key, since
    nothing consumes it there and `_fmp_row`'s existing contract is
    untouched by design."""
    def _consensus_result(ticker, **kw):
        return pe.ProviderResult(
            value=[{"strongBuy": 1, "buy": 69, "hold": 34, "sell": 7, "strongSell": 0, "consensus": "Buy"}],
            provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_grades_consensus",
                                           source_observed_at=1735689600.0),
            licensing_class="R",
            freshness="end_of_day",
        )

    def _pt_consensus_result(ticker, **kw):
        return pe.ProviderResult(
            value=[{"targetHigh": 400, "targetLow": 253, "targetConsensus": 327, "targetMedian": 325}],
            provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_price_target_consensus"),
            licensing_class="R",
            freshness="end_of_day",
        )

    monkeypatch.setattr(ag.fmp_client, "get_grades_consensus", _consensus_result)
    monkeypatch.setattr(ag.fmp_client, "get_price_target_consensus", _pt_consensus_result)
    monkeypatch.setattr(ag.fmp_client, "get_price_target_summary", lambda t, **kw: _result([]))
    monkeypatch.setattr(ag.fmp_client, "get_analyst_grades", lambda t, **kw: _result([]))
    monkeypatch.setattr(ag.fmp_client, "get_grades_historical", lambda t, **kw: _result([]))
    monkeypatch.setattr(ag, "cache", _FakeCache())

    res = ag.get_analyst_grades("AAPL")

    con_meta = res["consensus"]["_meta"]
    assert con_meta["vendor"] == "fmp"
    assert con_meta["sourceActivity"] == "fmp_client.get_grades_consensus"
    assert con_meta["sourceObservedAt"] == 1735689600.0
    assert con_meta["freshnessClass"] == "end_of_day"
    assert con_meta["degraded"] is None

    pt_meta = res["price_target"]["_meta"]
    assert pt_meta["sourceActivity"] == "fmp_client.get_price_target_consensus"
    assert pt_meta["freshnessClass"] == "end_of_day"

    # recent_actions/trend still use the untouched _fmp_row/_fmp_rows path.
    assert res["recent_actions"] == []
    assert res["trend"] == []


def test_a_degraded_but_still_usable_consensus_row_surfaces_that_honestly(monkeypatch):
    """cached_forbidden means the vendor answered with older data it can no
    longer freshly confirm -- an honest, distinct fact from a hard miss.
    _fmp_row_with_meta must NOT collapse this to None the way a genuine
    failure is; the frontend's mapAvailability() reads this exact shape."""
    def _degraded_result(ticker, **kw):
        return pe.ProviderResult(
            value=[{"strongBuy": 1, "buy": 2, "hold": 0, "sell": 0, "strongSell": 0, "consensus": "Buy"}],
            provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_grades_consensus"),
            licensing_class="R",
            freshness="stale",
            degraded="cached_forbidden",
        )

    monkeypatch.setattr(ag.fmp_client, "get_grades_consensus", _degraded_result)
    monkeypatch.setattr(ag.fmp_client, "get_price_target_consensus", lambda t, **kw: _result([]))
    monkeypatch.setattr(ag.fmp_client, "get_price_target_summary", lambda t, **kw: _result([]))
    monkeypatch.setattr(ag.fmp_client, "get_analyst_grades", lambda t, **kw: _result([]))
    monkeypatch.setattr(ag.fmp_client, "get_grades_historical", lambda t, **kw: _result([]))
    monkeypatch.setattr(ag, "cache", _FakeCache())

    res = ag.get_analyst_grades("AAPL")
    assert res["consensus"]["total"] == 3
    assert res["consensus"]["_meta"]["degraded"] == "cached_forbidden"


def test_a_hard_miss_still_returns_no_row_and_no_meta(monkeypatch):
    """degraded WITHOUT a usable row (e.g. circuit_open) is unchanged from
    today's behavior -- a miss, same as any other failure."""
    def _circuit_open(ticker, **kw):
        return pe.ProviderResult(
            value=None,
            provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="fmp_client.get_grades_consensus"),
            licensing_class="R",
            degraded="circuit_open",
        )

    row, meta = ag._fmp_row_with_meta(_circuit_open, "AAPL")
    assert row is None
    assert meta is None


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
