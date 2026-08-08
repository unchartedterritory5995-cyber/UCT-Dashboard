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
