"""Tests for the Top-Gainers scans (api/services/scan_gainers.py)."""
from api.services import scan_gainers as sg
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_gainers")
    with sg._ref_lock:
        sg._ref_states.clear()


def test_reports_computing_until_reference_ready(monkeypatch):
    _reset()
    monkeypatch.setattr(sg, "_universe", lambda: [])
    monkeypatch.setattr(sg, "_etf_symbols", lambda: set())
    monkeypatch.setattr(sg._sqlite, "close_n_sessions_back", lambda *a, **k: {})
    out = sg.get_top_gainers_30d()
    assert out["status"] == "computing"
    assert out["results"] == []
    _reset()


def test_build_reference_intersects_non_etf_universe(monkeypatch):
    monkeypatch.setattr(sg._sqlite, "close_n_sessions_back",
                        lambda n, before: {"AAA": 10.0, "BBB": 20.0, "ZZZ": 5.0})
    ref = sg._build_reference(30, {"AAA", "BBB"})   # ZZZ outside the universe → dropped
    assert ref == {"AAA": 10.0, "BBB": 20.0}


def test_ranks_by_n_day_change_and_keeps_top_5pct(monkeypatch):
    # 40 stocks → top 5% = 2 names. Each ref close is 100; live price sets the gain.
    _reset()
    ref = {f"S{i:02d}": 100.0 for i in range(40)}
    with sg._ref_lock:
        sg._state("30d").update(date=sg._session_date(), map=ref, building=False)
    # S39 up 40%, S38 up 39%, … S00 up 1%. Descending, so the top 2 are S39, S38.
    snap = {sym: {"last_price": 100.0 * (1 + (i + 1) / 100.0), "prev_close": 100.0}
            for i, sym in enumerate(ref)}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())

    out = sg.get_top_gainers_30d()
    assert out["status"] == "ok"
    assert out["count"] == 2                                  # ceil(40 * 0.05) = 2
    assert [r["sym"] for r in out["results"]] == ["S39", "S38"]
    assert out["results"][0]["change_nd"] == 40.0            # (140-100)/100
    _reset()


def test_excludes_etfs_from_reference(monkeypatch):
    # The reference build subtracts the ETF set from the universe before ranking.
    seen = {}

    def _fake_close(n, before):
        return {"AAA": 10.0, "SNXX": 5.0}

    monkeypatch.setattr(sg._sqlite, "close_n_sessions_back", _fake_close)
    monkeypatch.setattr(sg, "_universe", lambda: ["AAA", "SNXX"])
    monkeypatch.setattr(sg, "_etf_symbols", lambda: {"SNXX"})

    # Drive the background build synchronously by calling _build_reference with the
    # ETF-pruned universe the way _ensure_reference's job does.
    uni = set(sg._universe()) - sg._etf_symbols()
    assert uni == {"AAA"}
    ref = sg._build_reference(30, uni)
    assert ref == {"AAA": 10.0}   # SNXX (ETF) excluded


def test_maps_class_share_symbology(monkeypatch):
    """Universe is app-form (BRK-B); snapshot is provider-form (BRK.B)."""
    _reset()
    with sg._ref_lock:
        sg._state("60d").update(date=sg._session_date(), map={"BRK-B": 100.0}, building=False)
    snap = {"BRK.B": {"last_price": 150.0, "prev_close": 140.0}}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sg.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sg.massive, "to_polygon_symbol", lambda s: s.replace("-", "."))

    out = sg.get_top_gainers_60d()
    assert [r["sym"] for r in out["results"]] == ["BRK-B"]
    assert out["results"][0]["change_nd"] == 50.0
    _reset()
