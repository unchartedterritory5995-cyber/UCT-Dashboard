"""Tests for the Top-Gainers scans (api/services/scan_gainers.py)."""
from api.services import scan_gainers as sg
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_gainers")
    with sg._ref_lock:
        sg._ref_states.clear()


# A snapshot row that clears the liquidity floor (price × prev_vol ≥ $1M) at $10+.
def _row(last, prev):
    return {"last_price": last, "prev_close": prev, "prev_vol": 1_000_000, "today_vol": 1_000_000}


def test_reports_computing_until_reference_ready(monkeypatch):
    _reset()
    monkeypatch.setattr(sg._sqlite, "nth_recent_trading_date", lambda n, before: None)
    out = sg.get_top_gainers_30d()
    assert out["status"] == "computing"
    assert out["results"] == []
    _reset()


def test_build_reference_uses_grouped_daily_for_the_nth_session_date(monkeypatch):
    seen = {}

    def _fake_nth(n, before):
        seen["n"] = n
        return 20260401

    def _fake_grouped(day_iso, adjusted=True):
        seen["iso"] = day_iso
        seen["adjusted"] = adjusted
        return {"AAA": 10.0, "BBB": 20.0}

    monkeypatch.setattr(sg._sqlite, "nth_recent_trading_date", _fake_nth)
    monkeypatch.setattr(sg.massive, "get_grouped_daily_closes", _fake_grouped)
    ref = sg._build_reference(30)
    assert seen["n"] == 30
    assert seen["iso"] == "2026-04-01"    # YYYYMMDD → ISO for the grouped endpoint
    assert seen["adjusted"] is True       # split-adjusted closes
    assert ref == {"AAA": 10.0, "BBB": 20.0}


def test_ranks_by_n_day_change_and_keeps_top_5pct(monkeypatch):
    # 40 stocks → top 5% = 2 names. Each ref close is 100; live price sets the gain.
    _reset()
    ref = {f"S{i:02d}": 100.0 for i in range(40)}
    with sg._ref_lock:
        sg._state("30d").update(date=sg._session_date(), map=ref, building=False)
    # S39 up 40%, S38 up 39%, … S00 up 1%. Descending, so the top 2 are S39, S38.
    snap = {sym: _row(100.0 * (1 + (i + 1) / 100.0), 100.0) for i, sym in enumerate(ref)}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sg, "_etf_symbols", lambda: set())

    out = sg.get_top_gainers_30d()
    assert out["status"] == "ok"
    assert out["count"] == 2                                  # ceil(40 * 0.05) = 2
    assert [r["sym"] for r in out["results"]] == ["S39", "S38"]
    assert out["results"][0]["change_nd"] == 40.0            # (140-100)/100
    assert out["results"][0]["ref_close"] == 100.0           # exposed for the live column
    _reset()


def test_excludes_etfs_and_illiquid_and_reuse_artifacts(monkeypatch):
    _reset()
    ref = {"GOOD": 100.0, "SPXL": 100.0, "THIN": 100.0, "RMIX": 1.0}
    with sg._ref_lock:
        sg._state("60d").update(date=sg._session_date(), map=ref, building=False)
    snap = {
        "GOOD": _row(150.0, 148.0),                                   # +50%, liquid → kept
        "SPXL": _row(300.0, 295.0),                                   # ETF → dropped
        "THIN": {"last_price": 150.0, "prev_close": 148.0, "prev_vol": 10},  # $1.5K dvol → dropped
        "RMIX": _row(62.0, 61.0),                                     # +6100% vs 1.0 ref → artifact
    }

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sg, "_etf_symbols", lambda: {"SPXL"})

    out = sg.get_top_gainers_60d()
    assert [r["sym"] for r in out["results"]] == ["GOOD"]     # only the real, liquid mover
    _reset()


def test_maps_class_share_symbology(monkeypatch):
    """Grouped/snapshot are provider-form (BRK.B); results + the ETF check use app-form."""
    _reset()
    with sg._ref_lock:
        sg._state("60d").update(date=sg._session_date(), map={"BRK.B": 100.0}, building=False)
    snap = {"BRK.B": _row(150.0, 148.0)}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sg, "_etf_symbols", lambda: set())

    out = sg.get_top_gainers_60d()
    assert [r["sym"] for r in out["results"]] == ["BRK-B"]    # provider→app form on output
    assert out["results"][0]["change_nd"] == 50.0
    _reset()
