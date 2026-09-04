"""Tests for the Analyst Ratings tab's backend (2026-09-03, dedicated
Analyst Ratings slice, owner-authorized product-home split):
api.services.research.analyst_ratings.get_analyst_ratings + its router.

This is the thin wrapper around analyst_grades.get_analyst_grades() -- the
canonical composer, tested in tests/test_analyst_grades.py and
tests/test_analyst_grades_entity.py. These tests are about the WRAPPER's
own contract: always a dict, entity always present, correct pass-through.
"""
from unittest import mock

from api.services.research import analyst_ratings as ar


def test_blank_symbol_returns_the_empty_shape_without_calling_anything():
    with mock.patch("api.services.research.analyst_ratings.resolve_entity") as re_mock, \
         mock.patch("api.services.research.analyst_ratings.get_analyst_grades") as gag_mock:
        out = ar.get_analyst_ratings("")
    re_mock.assert_not_called()
    gag_mock.assert_not_called()
    assert out == {"sym": "", "entity": None, "consensus": None,
                   "price_target": None, "recent_actions": {"items": [], "_meta": None}}


def test_no_analyst_coverage_still_carries_a_resolved_entity():
    """get_analyst_grades() legitimately returns None for a ticker with no
    analyst coverage at all -- entity resolution must NOT be lost just
    because the composer itself has nothing to hand back."""
    with mock.patch("api.services.research.analyst_ratings.resolve_entity",
                    return_value=({"status": "resolved", "entityId": "em_1"}, "ZZZ")), \
         mock.patch("api.services.research.analyst_ratings.get_analyst_grades",
                    return_value=None):
        out = ar.get_analyst_ratings("zzz")
    assert out["sym"] == "ZZZ"
    assert out["entity"] == {"status": "resolved", "entityId": "em_1"}
    assert out["consensus"] is None
    assert out["price_target"] is None
    assert out["recent_actions"] == {"items": [], "_meta": None}


def test_full_payload_passes_through(monkeypatch):
    grades = {
        "symbol": "AAPL",
        "entity": {"status": "resolved", "entityId": "em_aapl"},
        "consensus": {"label": "Buy", "total": 10, "_meta": {"vendor": "fmp"}},
        "price_target": {"consensus": 250.0, "_meta": {"vendor": "fmp"}},
        "recent_actions": {"items": [{"date": "2026-09-01", "company": "Evercore ISI",
                                      "action": "upgrade", "from_grade": "Hold", "to_grade": "Buy"}],
                           "_meta": {"vendor": "fmp"}},
        "trend": [{"date": "2026-08-01", "buy": 20}],
    }
    with mock.patch("api.services.research.analyst_ratings.resolve_entity",
                    return_value=({"status": "resolved", "entityId": "em_aapl"}, "AAPL")), \
         mock.patch("api.services.research.analyst_ratings.get_analyst_grades",
                    return_value=grades):
        out = ar.get_analyst_ratings("aapl")
    assert out["sym"] == "AAPL"
    assert out["entity"] == {"status": "resolved", "entityId": "em_aapl"}
    assert out["consensus"]["label"] == "Buy"
    assert out["price_target"]["consensus"] == 250.0
    assert out["recent_actions"]["items"][0]["company"] == "Evercore ISI"
    # `trend` is deliberately NOT part of the wrapper's contract (readiness
    # review §5/§16: the historical-bucket shape doesn't answer "have price
    # targets moved" and isn't wired to the first-slice UI).
    assert "trend" not in out


def test_an_entity_the_composer_resolved_wins_over_the_wrappers_own_call():
    """get_analyst_grades() already resolved entity internally (for its own
    D1 vendor-symbol routing) -- reuse that rather than a third resolution,
    but the wrapper's own call is still what covers the no-coverage case."""
    grades = {"symbol": "AAPL", "entity": {"status": "resolved", "entityId": "em_from_composer"},
              "consensus": {"label": "Buy"}, "price_target": None,
              "recent_actions": {"items": [], "_meta": None}}
    with mock.patch("api.services.research.analyst_ratings.resolve_entity",
                    return_value=({"status": "not_found", "entityId": None}, "AAPL")), \
         mock.patch("api.services.research.analyst_ratings.get_analyst_grades",
                    return_value=grades):
        out = ar.get_analyst_ratings("aapl")
    assert out["entity"] == {"status": "resolved", "entityId": "em_from_composer"}


class TestRoute:
    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_route_shape(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_analyst_ratings", lambda sym: {
            "sym": sym.upper(), "entity": {"status": "resolved", "entityId": "em_1"},
            "consensus": None, "price_target": None,
            "recent_actions": {"items": [], "_meta": None},
        })
        r = self._client().get("/api/research/analyst-ratings/AAPL")
        assert r.status_code == 200
        assert set(r.json().keys()) == {"sym", "entity", "consensus", "price_target", "recent_actions"}

    def test_route_degrades_safely_on_an_exception(self, monkeypatch):
        import api.routers.research as research_router

        def _boom(sym):
            raise RuntimeError("boom")
        monkeypatch.setattr(research_router, "get_analyst_ratings", _boom)
        r = self._client().get("/api/research/analyst-ratings/AAPL")
        assert r.status_code == 200
        body = r.json()
        assert body["sym"] == "AAPL"
        assert body["recent_actions"] == {"items": [], "_meta": None}
