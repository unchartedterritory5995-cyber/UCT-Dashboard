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

    def _yf_ok(self):
        return {
            "info": {"heldPercentInstitutions": 0.6, "shortPercentOfFloat": 0.01},
            "inst": None,
        }

    def test_shape_and_cache(self, monkeypatch):
        monkeypatch.setattr(own, "_fetch_yf", lambda sym: self._yf_ok())
        monkeypatch.setattr(own, "get_insider_activity", lambda sym: [
            {"name": "CEO", "title": "CEO", "type": "buy", "shares": 1000, "amount": 250000, "date": "2026-05-01"},
        ])
        out = own.get_ownership("test")
        assert out["sym"] == "TEST"
        assert out["institutional"]["pct_held"] == 60.0
        assert out["short"]["short_pct_float"] == 1.0
        assert out["insider"][0]["type"] == "buy"
        assert cache.get("research_own::TEST") is not None

    def _captured_ttl(self, monkeypatch, *, fetch_yf, insider, thirteen_f=lambda s: None):
        seen = {}
        real_set = cache.set

        def spy(key, value, ttl=None):
            if key == "research_own::TEST":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        monkeypatch.setattr(own, "_fetch_yf", fetch_yf)
        monkeypatch.setattr(own, "get_insider_activity", insider)
        monkeypatch.setattr(own, "_thirteen_f", thirteen_f)
        monkeypatch.setattr(cache, "set", spy)
        out = own.get_ownership("test")
        return out, seen.get("ttl")

    def test_a_complete_fetch_is_cached_for_the_full_12h_ttl(self, monkeypatch):
        out, ttl = self._captured_ttl(
            monkeypatch, fetch_yf=lambda s: self._yf_ok(), insider=lambda s: [],
        )
        assert out["institutional"]["pct_held"] == 60.0
        assert ttl == own._CACHE_TTL

    def test_yfinance_fetch_failure_shortens_the_ttl_not_12h(self, monkeypatch):
        """THE regression this guards: a yfinance pool timeout used to still
        cache the (institutional=blank, short=blank) result for the full 12h."""
        out, ttl = self._captured_ttl(
            monkeypatch, fetch_yf=lambda s: {}, insider=lambda s: [
                {"name": "CEO", "type": "buy", "shares": 500, "date": "2026-05-01"},
            ],
        )
        # the insider leg that DID resolve is still served
        assert out["insider"]
        assert out["institutional"]["pct_held"] is None
        assert ttl == own._FAIL_TTL
        assert ttl < own._CACHE_TTL

    def test_insider_activity_failure_also_shortens_the_ttl(self, monkeypatch):
        def _boom(s):
            raise RuntimeError("finnhub down")
        out, ttl = self._captured_ttl(
            monkeypatch, fetch_yf=lambda s: self._yf_ok(), insider=_boom,
        )
        assert out["institutional"]["pct_held"] == 60.0   # good leg still served
        assert out["insider"] == []
        assert ttl == own._FAIL_TTL

    def test_a_ticker_with_genuinely_no_13f_filing_is_not_a_failure(self, monkeypatch):
        """13F absence is normal for most non-mega-caps -- must still get the
        full 12h TTL, not be treated the same as a provider failure."""
        out, ttl = self._captured_ttl(
            monkeypatch, fetch_yf=lambda s: self._yf_ok(), insider=lambda s: [],
            thirteen_f=lambda s: None,
        )
        assert out["thirteen_f"] is None
        assert ttl == own._CACHE_TTL


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
