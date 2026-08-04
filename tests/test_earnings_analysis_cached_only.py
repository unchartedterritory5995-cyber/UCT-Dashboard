from unittest.mock import patch

from fastapi.testclient import TestClient


def _client():
    from api.main import app
    return TestClient(app)


def test_cached_only_returns_the_cached_analysis_without_firing_the_llm():
    from api.routers import earnings as er
    from api.services.cache import cache
    cache.set("earnings_analysis_v2_TST",
              {"sym": "TST", "analysis_headline": "Beat and raised"}, ttl=60)
    with patch.object(er, "_generate_earnings_analysis") as ga, \
         patch.object(er, "_generate_earnings_preview") as gp:
        r = _client().get("/api/earnings-analysis/TST?cached_only=1")
    body = r.json()
    assert body["cached"] is True and body["analysis_headline"] == "Beat and raised"
    ga.assert_not_called()
    gp.assert_not_called()
    cache.invalidate("earnings_analysis_v2_TST")


def test_cached_only_falls_back_to_the_preview_key():
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_TST")
    cache.set("earnings_preview_v2_TST",
              {"sym": "TST", "preview_text": "Watch guidance."}, ttl=60)
    body = _client().get("/api/earnings-analysis/TST?cached_only=1").json()
    assert body["cached"] is True and body["preview_text"] == "Watch guidance."
    cache.invalidate("earnings_preview_v2_TST")


def test_cached_only_miss_returns_the_empty_shape_and_touches_nothing():
    from api.routers import earnings as er
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_ZZZ")
    cache.invalidate("earnings_preview_v2_ZZZ")
    with patch.object(er, "_generate_earnings_analysis") as ga, \
         patch.object(er, "_generate_earnings_preview") as gp, \
         patch.object(er, "get_earnings") as ge:
        body = _client().get("/api/earnings-analysis/ZZZ?cached_only=1").json()
    assert body["cached"] is False
    assert body["analysis_bullets"] == [] and body["preview_bullets"] == []
    assert body["news"] == [] and body["analysis_headline"] is None
    ga.assert_not_called()
    gp.assert_not_called()
    ge.assert_not_called()          # not even the row lookup — this path is FREE


def test_default_call_is_unchanged_and_still_generates():
    from api.routers import earnings as er
    with patch.object(er, "get_earnings", return_value={}), \
         patch.object(er, "_generate_earnings_preview",
                      return_value={"sym": "ZZZ", "preview_text": "x"}) as gp:
        r = _client().get("/api/earnings-analysis/ZZZ")
    assert r.status_code == 200
    gp.assert_called_once()
