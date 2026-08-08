"""Tests for the Custom-Period Sort scan (api/services/scan_period.py)."""
from datetime import date

from api.services import scan_period as sp
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_period_")


def test_rejects_inverted_range():
    out = sp.get_period_change(20260601, 20260601)
    assert out["status"] == "error"


def test_ranks_common_stock_by_period_change(monkeypatch):
    _reset()
    # start closes vs end closes → % change per ticker.
    start = {"AAA": 100.0, "BBB": 50.0, "SPXL": 10.0, "GONE": 20.0, "WARR": 5.0}
    end = {"AAA": 150.0, "BBB": 40.0, "SPXL": 30.0, "GONE": 40.0, "WARR": 9.0}

    def _grouped(day_iso, adjusted=True):
        # Every date resolves; start date is earlier, end date later — pick by which is asked.
        return start if day_iso <= "2026-04-01" else end

    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", _grouped)
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"AAA", "BBB", "GONE"})  # SPXL/WARR not CS
    monkeypatch.setattr(sp, "_etf_symbols", lambda: {"SPXL"})

    snap = {"AAA": {"last_price": 150.0}, "BBB": {"last_price": 40.0}}  # GONE delisted → absent

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sp.massive, "_get_client", lambda: _Client())

    out = sp.get_period_change(20260401, 20260601)
    assert out["status"] == "ok"
    # AAA +50%, BBB -20%. SPXL (ETF) + WARR (not CS) + GONE (delisted) excluded.
    assert [r["sym"] for r in out["results"]] == ["AAA", "BBB"]
    assert out["results"][0]["period_change"] == 50.0
    assert out["results"][1]["period_change"] == -20.0
    assert out["results"][0]["net_change"] == 50.0
    _reset()


def test_snaps_holiday_start_date_back_to_a_trading_day(monkeypatch):
    _reset()
    seen = []

    def _grouped(day_iso, adjusted=True):
        seen.append(day_iso)
        # 2026-04-01 is "closed" (empty); step back to 2026-03-31.
        if day_iso == "2026-04-01":
            return {}
        return {"AAA": 100.0} if day_iso <= "2026-03-31" else {"AAA": 120.0}

    monkeypatch.setattr(sp.massive, "get_grouped_daily_closes", _grouped)
    monkeypatch.setattr(sp, "_common_stock_symbols", lambda: {"AAA"})
    monkeypatch.setattr(sp, "_etf_symbols", lambda: set())

    class _Client:
        def get_full_market_snapshot(self):
            return {"AAA": {"last_price": 120.0}}

    monkeypatch.setattr(sp.massive, "_get_client", lambda: _Client())

    out = sp.get_period_change(20260401, 20260601)
    assert out["status"] == "ok"
    assert out["start"] == 20260331          # snapped back off the "holiday"
    assert "2026-04-01" in seen and "2026-03-31" in seen
    _reset()


_STOCK_CHG = {
    "status": "ok",
    "results": [
        {"sym": "AAA", "period_change": 10.0},
        {"sym": "BBB", "period_change": 20.0},
        {"sym": "CCC", "period_change": -5.0},
    ],
    "start": 20260401, "end": 20260601, "as_of": "x",
}


def test_group_by_theme_ranks_by_owner_mean(monkeypatch):
    monkeypatch.setattr(sp, "get_period_change", lambda a, b: _STOCK_CHG)
    monkeypatch.setattr("api.services.theme_db.get_all_themes", lambda: {"themes": [
        {"name": "Growth", "holdings": [{"sym": "AAA", "source": "owner"}, {"sym": "BBB", "source": "owner"}]},
        {"name": "Value", "holdings": [{"sym": "CCC", "source": "owner"}, {"sym": "ENG", "source": "engine"}]},
    ]})
    out = sp.get_period_change_groups(20260401, 20260601, "theme")
    assert out["status"] == "ok" and out["group"] == "theme"
    # Growth = mean(10,20)=15 leads; Value = -5 (the engine-overlay member is excluded).
    assert [r["name"] for r in out["results"]] == ["Growth", "Value"]
    assert out["results"][0]["period_change"] == 15.0 and out["results"][0]["members"] == ["AAA", "BBB"]
    assert out["results"][1]["period_change"] == -5.0


def test_group_by_sector_ranks_and_carries_members(monkeypatch):
    monkeypatch.setattr(sp, "get_period_change", lambda a, b: _STOCK_CHG)
    monkeypatch.setattr(sp, "_sector_industry_map", lambda: {
        "AAA": {"sector": "Tech", "industry": "Software"},
        "BBB": {"sector": "Tech", "industry": "Semis"},
        "CCC": {"sector": "Energy", "industry": "Oil"},
    })
    out = sp.get_period_change_groups(20260401, 20260601, "sector")
    assert out["status"] == "ok"
    assert [r["name"] for r in out["results"]] == ["Tech", "Energy"]   # Tech mean 15 > Energy -5
    assert out["results"][0]["count"] == 2 and set(out["results"][0]["members"]) == {"AAA", "BBB"}


def test_group_rejects_bad_group():
    out = sp.get_period_change_groups(20260401, 20260601, "bogus")
    assert out["status"] == "error"
