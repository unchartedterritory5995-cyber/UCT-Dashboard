"""Tests for the IPO-in-last-1-year scan (api/services/scan_ipo.py)."""
from api.services import scan_ipo as si
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_ipo1y")
    with si._LOCK:
        si._state.update(date=None, map=None, building=False, built_at=0.0)


def test_ipo_scan_reports_computing_before_set(monkeypatch):
    _reset()
    monkeypatch.setattr(si, "_universe", lambda: [])
    monkeypatch.setattr(si._sqlite, "recent_first_trade", lambda since: {})
    out = si.get_ipo_last_1y()
    assert out["status"] == "computing"
    assert out["results"] == []
    _reset()


def test_build_ipo_set_intersects_universe(monkeypatch):
    monkeypatch.setattr(si._sqlite, "recent_first_trade",
                        lambda since: {"AAA": 20260101, "ZZZ": 20260201})
    s = si._build_ipo_set({"AAA"})   # ZZZ outside the universe → dropped
    assert s == {"AAA": 20260101}


def test_ipo_scan_returns_recent_ipos_newest_first(monkeypatch):
    _reset()
    with si._LOCK:
        si._state.update(date=si._session_date(),
                         map={"AAA": 20251001, "BBB": 20260301}, building=False)
    snap = {
        "AAA": {"last_price": 11.0, "prev_close": 10.0},
        "BBB": {"last_price": 20.0, "prev_close": 25.0},
    }

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(si.massive, "_get_client", lambda: _Client())

    out = si.get_ipo_last_1y()
    assert out["status"] == "ok"
    assert out["count"] == 2
    # Most recent IPO first: BBB (2026-03-01) then AAA (2025-10-01).
    assert [r["sym"] for r in out["results"]] == ["BBB", "AAA"]
    assert out["results"][0]["change_pct"] == -20.0
    _reset()
