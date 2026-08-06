"""What the live endpoint decides to KEEP.

Four conditions gate a sample into the intraday store, and each exists because
keeping the wrong one poisons the session path rather than merely wasting a row:

  session_live  a holiday or a pre-open snapshot is not a session
  anchored      the basis is cached per day, so requiring it means every sample
                in a path shares one — the line cannot step mid-session
  not degraded  a degraded read measured a different population
  not superseded once the collector has written, the day has a real answer
"""
from __future__ import annotations

import pytest


@pytest.fixture
def router(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_INTRADAY_DB", str(tmp_path / "intraday.db"))
    from api.routers import breadth_monitor as rt
    from api.services import breadth_intraday as bi
    from api.services import breadth_live as live
    from api.services import breadth_monitor as svc

    monkeypatch.setattr(bi, "_schema_ready", False)
    monkeypatch.setattr(bi, "MIN_SAMPLE_SECONDS", 0)
    monkeypatch.setattr(svc, "get_history", lambda days=90: [
        {"date": "2026-08-04", "universe_count": 2720, "pct_above_50sma": 66.3,
         "up_4pct_today": 573, "down_4pct_today": 62, "adv_decline": 1218,
         "adv_decline_cum": 5000, "qqq_close": 723.85, "spy_close": 771.33,
         "avg_10d_cpc": 0.82, "naaim": 79.7},
    ])
    monkeypatch.setattr(live, "NOT_LIVE", ("naaim",))
    return rt, bi


def _payload(**over):
    base = {
        "ok": True, "provisional": True,
        "as_of": "2026-08-05T13:44:00-04:00",
        "session_date": "2026-08-05", "session_live": True,
        "anchored": True, "degraded": False,
        "metrics": {"pct_above_50sma": 65.3, "up_4pct_today": 163,
                    "down_4pct_today": 61, "adv_decline": -370,
                    "universe_count": 2701, "new_52w_highs": 133},
    }
    base.update(over)
    return base


def _call(router, monkeypatch, **over):
    rt, bi = router
    from api.services import breadth_live as live
    monkeypatch.setattr(live, "compute_live", lambda force=False: _payload(**over))
    return rt.get_breadth_live(), bi


def test_a_live_sample_is_kept_and_comes_back_as_a_path(router, monkeypatch):
    out, bi = _call(router, monkeypatch)
    assert bi.session_path("2026-08-05")["pct_above_50sma"][0][1] == 65.3
    assert out["path"]["pct_above_50sma"]
    assert out["open"]["pct_above_50sma"] == 65.3


def test_the_stored_score_is_the_derived_one_not_a_raw_metric(router, monkeypatch):
    """`breadth_score` only exists once the row has been derived. Recording the
    raw metrics would leave the headline number with no path at all."""
    out, bi = _call(router, monkeypatch)
    assert out["row"]["breadth_score"] is not None
    assert bi.session_path("2026-08-05")["breadth_score"][0][1] == out["row"]["breadth_score"]


@pytest.mark.parametrize("over,why", [
    ({"session_live": False}, "not a session — holiday or pre-open"),
    ({"anchored": False}, "no basis, so the path could step mid-session"),
    ({"degraded": True}, "measured a different population"),
])
def test_a_sample_that_would_poison_the_path_is_not_kept(router, monkeypatch, over, why):
    _, bi = _call(router, monkeypatch, **over)
    assert bi.session_path("2026-08-05") == {}, why


def test_nothing_is_kept_once_the_collector_has_written_the_day(router, monkeypatch):
    from api.services import breadth_monitor as svc
    monkeypatch.setattr(svc, "get_history", lambda days=90: [
        {"date": "2026-08-05", "universe_count": 2739, "pct_above_50sma": 64.5},
    ])
    out, bi = _call(router, monkeypatch)
    assert out["superseded"] is True
    assert bi.session_path("2026-08-05") == {}


def test_a_broken_store_still_serves_the_live_read(router, monkeypatch):
    _, bi = router
    monkeypatch.setattr(bi, "record", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("disk full")))
    out, _ = _call(router, monkeypatch)
    assert out["ok"] is True
    assert out["metrics"]["pct_above_50sma"] == 65.3
    assert out["path"] == {} and out["open"] == {}


def test_carried_fields_are_separated_from_the_live_ones(router, monkeypatch):
    out, _ = _call(router, monkeypatch)
    assert out["carried"] == {"naaim": 79.7}
    assert out["carried_from"] == "2026-08-04"
    assert "naaim" not in out["metrics"]
