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


def test_sanitized_ref_close_distinguishes_missing_from_insufficient(monkeypatch):
    from api.services import bars_fetch
    # 100 clean bars → close 30 sessions back = bars[-31].
    monkeypatch.setattr(sg._sqlite, "get_bars",
                        lambda t, tf, n: ([("x",)] * 100 if t == "HAS" else
                                          [("x",)] * 8 if t == "SHORT" else []))
    monkeypatch.setattr(bars_fetch, "_fmt_sqlite_bars",
                        lambda rows, tf, ticker: [{"c": float(i)} for i in range(len(rows))])
    assert sg._sanitized_ref_close("HAS", 30) == 69.0     # bars[-31] of 0..99
    assert sg._sanitized_ref_close("MISS", 30) is None    # not tracked in bars.db
    assert sg._sanitized_ref_close("SHORT", 30) is False  # tracked but too little clean history


def test_build_reference_verifies_movers_and_filters(monkeypatch):
    monkeypatch.setattr(sg._sqlite, "nth_recent_trading_date", lambda n, before: 20260401)
    grouped = {"GOOD": 100.0, "SPXL": 100.0, "THIN": 100.0, "ZVZZT": 100.0,
               "SPCX": 22.0, "OBSC": 50.0}
    monkeypatch.setattr(sg.massive, "get_grouped_daily_closes",
                        lambda iso, adjusted=True: grouped)
    snap = {
        "GOOD": _row(150.0, 148.0),                                   # liquid mover
        "SPXL": _row(300.0, 295.0),                                   # ETF
        "THIN": {"last_price": 150.0, "prev_close": 148.0, "prev_vol": 10},  # illiquid
        "ZVZZT": _row(200.0, 195.0),                                  # Polygon test ticker
        "SPCX": _row(133.0, 130.0),                                   # recycled → sanitize=False
        "OBSC": _row(90.0, 88.0),                                     # not tracked → grouped kept
    }

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sg, "_etf_symbols", lambda: {"SPXL"})
    monkeypatch.setattr(sg, "_sanitized_ref_close",
                        lambda t, n: {"GOOD": 149.0, "SPCX": False, "OBSC": None}.get(t, None))

    built = sg._build_reference(30)
    assert built["liquid"] == 3                       # GOOD, SPCX, OBSC (ETF/illiquid/test excluded)
    # GOOD → chart-true 149; SPCX dropped (reuse); OBSC → grouped fallback 50.
    assert built["map"] == {"GOOD": 149.0, "OBSC": 50.0}


def test_ranks_by_change_and_keeps_top_5pct(monkeypatch):
    # 40-name liquid universe → top 5% = 2. The verified reference is set directly.
    _reset()
    ref = {f"S{i:02d}": 100.0 for i in range(40)}
    with sg._ref_lock:
        sg._state("30d").update(date=sg._session_date(), map=ref, building=False, universe=40)
    snap = {sym: _row(100.0 * (1 + (i + 1) / 100.0), 100.0) for i, sym in enumerate(ref)}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())

    out = sg.get_top_gainers_30d()
    assert out["status"] == "ok"
    assert out["count"] == 2                                  # ceil(40 * 0.05)
    assert [r["sym"] for r in out["results"]] == ["S39", "S38"]
    assert out["results"][0]["change_nd"] == 40.0            # (140-100)/100
    assert out["results"][0]["ref_close"] == 100.0
    _reset()


def test_maps_class_share_symbology(monkeypatch):
    """Reference is app-form (BRK-B); the snapshot is provider-form (BRK.B)."""
    _reset()
    with sg._ref_lock:
        sg._state("60d").update(date=sg._session_date(), map={"BRK-B": 100.0},
                                building=False, universe=1)
    snap = {"BRK.B": _row(150.0, 148.0)}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sg.massive, "to_polygon_symbol", lambda s: s.replace("-", "."))

    out = sg.get_top_gainers_60d()
    assert [r["sym"] for r in out["results"]] == ["BRK-B"]
    assert out["results"][0]["change_nd"] == 50.0
    _reset()
