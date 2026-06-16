"""Tests for the research ownership service + router."""
import pandas as pd

from api.services.research import ownership as own
from api.services.cache import cache


class TestShort:
    def test_short_normalization(self):
        info = {
            "sharesShort": 50_000_000, "shortPercentOfFloat": 0.0073, "shortRatio": 1.8,
            "floatShares": 6_800_000_000, "sharesOutstanding": 15_000_000_000,
            "sharesShortPriorMonth": 48_000_000,
        }
        s = own._short(info)
        assert s["shares_short"] == 50_000_000
        assert s["short_pct_float"] == 0.73  # 0.0073 -> 0.73%
        assert s["days_to_cover"] == 1.8
        assert s["float_shares"] == 6_800_000_000

    def test_short_empty(self):
        s = own._short({})
        assert s["shares_short"] is None


class TestInstitutional:
    def test_pct_held_and_top_holders(self):
        df = pd.DataFrame({
            "Date Reported": pd.to_datetime(["2026-03-31", "2026-03-31"]),
            "Holder": ["Vanguard", "BlackRock"],
            "pctHeld": [0.085, 0.065],
            "Shares": [1.3e9, 1.0e9],
            "Value": [3.3e11, 2.5e11],
        })
        out = own._institutional(df, {"heldPercentInstitutions": 0.61})
        assert out["pct_held"] == 61.0
        assert out["holders"][0]["holder"] == "Vanguard"
        assert out["holders"][0]["pct_out"] == 8.5
        assert out["holders"][0]["date"] == "2026-03-31"

    def test_no_holders(self):
        out = own._institutional(None, {"heldPercentInstitutions": 0.5})
        assert out["pct_held"] == 50.0
        assert out["holders"] == []


class TestGetOwnership:
    def setup_method(self):
        cache.invalidate("research_own::TEST")

    def test_shape_and_cache(self, monkeypatch):
        monkeypatch.setattr(own, "_fetch_yf", lambda sym: {
            "info": {"heldPercentInstitutions": 0.6, "shortPercentOfFloat": 0.01},
            "inst": None,
        })
        monkeypatch.setattr(own, "get_insider_activity", lambda sym: [
            {"name": "CEO", "title": "CEO", "type": "buy", "shares": 1000, "amount": 250000, "date": "2026-05-01"},
        ])
        out = own.get_ownership("test")
        assert out["sym"] == "TEST"
        assert out["institutional"]["pct_held"] == 60.0
        assert out["short"]["short_pct_float"] == 1.0
        assert out["insider"][0]["type"] == "buy"
        assert cache.get("research_own::TEST") is not None


class TestRoute:
    def setup_method(self):
        cache.invalidate("research_own::AAPL")

    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_route_shape(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_ownership", lambda sym: {
            "sym": sym.upper(), "institutional": {"pct_held": None, "holders": []}, "short": {}, "insider": [],
        })
        r = self._client().get("/api/research/ownership/AAPL")
        assert r.status_code == 200
        assert set(r.json().keys()) == {"sym", "institutional", "short", "insider"}
