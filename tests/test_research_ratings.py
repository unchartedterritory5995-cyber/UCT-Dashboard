"""Tests for the research ratings service + router."""
from api.services.research import ratings as rt
from api.services.cache import cache


class TestScoreBands:
    def test_band_descending_match(self):
        assert rt._band(55, rt._EPS_BANDS) == 98
        assert rt._band(22, rt._EPS_BANDS) == 80
        assert rt._band(-30, rt._EPS_BANDS) == 12
        assert rt._band(None, rt._EPS_BANDS) is None

    def test_value_score_prefers_peg(self):
        assert rt._value_score(0.9, 40) == 92    # cheap PEG
        assert rt._value_score(4.0, 10) == 32    # expensive PEG ignores cheap PE
        assert rt._value_score(None, 15) == 76   # falls back to fwd PE
        assert rt._value_score(None, None) is None

    def test_letter_buckets(self):
        assert rt._letter(85) == "A"
        assert rt._letter(60) == "B"
        assert rt._letter(10) == "E"


class TestComposite:
    def test_weighted_blend_skips_none(self):
        # only eps + rs present -> weighted avg of the two
        c = rt._composite(eps=80, rs=60, growth=None, value=None, smr_n=None, accdis_letter=None)
        assert c == 70  # (80*.25 + 60*.25)/(.5)
        assert rt._composite(None, None, None, None, None, None) is None

    def test_accdis_into_composite(self):
        c = rt._composite(eps=None, rs=None, growth=None, value=None, smr_n=None, accdis_letter="A")
        assert c == 85  # letter A -> 85, sole component


class TestPriceDerived:
    def test_weighted_rs_return(self):
        closes = [100.0] * 200
        closes[-1] = 130.0   # +30% on the last bar vs all refs
        rsr = rt._weighted_rs_return(closes)
        assert rsr is not None and rsr > 0
        assert rt._weighted_rs_return([1, 2, 3]) is None  # too short

    def test_accdis_ratio_up_vs_down(self):
        closes = [10 + (i % 2) for i in range(80)]   # alternating up/down
        vols = [100] * 80
        ratio = rt._accdis_ratio(closes, vols, lookback=65)
        assert ratio is not None


class TestGetRatings:
    def setup_method(self):
        cache.invalidate("research_rat::TEST")

    def test_shape_and_components(self, monkeypatch):
        monkeypatch.setattr(rt, "get_fundamentals", lambda s: {
            "earnings_growth_pct": 30.0, "revenue_growth_pct": 18.0,
            "operating_margin_pct": 28.0, "roe_pct": 35.0, "peg": 1.2, "pe_forward": 24.0,
            "debt_to_equity": 120.0, "fifty_two_week_high": 200.0,
        })
        monkeypatch.setattr(rt, "get_ownership", lambda s: {"institutional": {"pct_held": 62.0}})
        closes = [100.0] * 200
        closes[-1] = 180.0

        class _DF:
            empty = False
            def __getitem__(self, k):
                return closes if k == "Close" else [1000] * 200
        monkeypatch.setattr(rt, "fetch_history", lambda s, **k: _DF())

        out = rt.get_ratings("test")
        assert out["sym"] == "TEST"
        assert out["composite"] is not None
        comp = out["components"]
        assert comp["eps"] == 90        # 30% EPS growth band
        assert comp["smr"] in {"A", "B"}
        assert comp["sponsorship"] == "B"   # 62% institutional
        assert isinstance(out["checkup"], list) and len(out["checkup"]) == 8
        assert cache.get("research_rat::TEST") is not None


class TestRoute:
    def setup_method(self):
        cache.invalidate("research_rat::AAPL")

    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_route_shape(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_ratings", lambda sym: {
            "sym": sym.upper(), "composite": 91, "components": {}, "checkup": [], "method": "x",
        })
        r = self._client().get("/api/research/ratings/AAPL")
        assert r.status_code == 200
        assert set(r.json().keys()) == {"sym", "composite", "components", "checkup", "method"}
