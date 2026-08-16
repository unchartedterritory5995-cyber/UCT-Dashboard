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

from datetime import date, timedelta

import pytest

# DERIVED, NEVER TYPED. These were literal dates, and
# `breadth_intraday.RETENTION_DAYS = 7`: eleven days after they were written,
# `record()` stored the sample and `_maybe_prune()` deleted it in the SAME
# call, so the session path came back empty. Worse, `_last_prune` is a module
# global with a 1h guard, so only the FIRST test in the process paid the
# prune — one order-dependent red that named a missing metric key rather than
# an expired fixture. Same class as the calendar's
# `test_month_unknown_hour_lands_in_tbd`.
SESSION = date.today().isoformat()
PREV = (date.today() - timedelta(days=1)).isoformat()

from tests.authclients import PAID_MEMBER, authorize


@pytest.fixture
def router(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_INTRADAY_DB", str(tmp_path / "intraday.db"))
    from api.routers import breadth_monitor as rt
    from api.services import breadth_intraday as bi
    from api.services import breadth_live as live
    from api.services import breadth_monitor as svc

    monkeypatch.setattr(bi, "_schema_ready", False)
    # `_last_prune` is a module global with a 1h guard, so without this the
    # retention sweep runs for exactly one test per process and which one is
    # decided by collection order.
    monkeypatch.setattr(bi, "_last_prune", 0.0)
    monkeypatch.setattr(bi, "MIN_SAMPLE_SECONDS", 0)
    monkeypatch.setattr(svc, "get_history", lambda days=90: [
        {"date": PREV, "universe_count": 2720, "pct_above_50sma": 66.3,
         "up_4pct_today": 573, "down_4pct_today": 62, "adv_decline": 1218,
         "adv_decline_cum": 5000, "qqq_close": 723.85, "spy_close": 771.33,
         "avg_10d_cpc": 0.82, "naaim": 79.7},
    ])
    monkeypatch.setattr(live, "NOT_LIVE", ("naaim",))
    return rt, bi


def _payload(**over):
    base = {
        "ok": True, "provisional": True,
        "as_of": f"{SESSION}T13:44:00-04:00",
        "session_date": SESSION, "session_live": True,
        "anchored": True, "degraded": False,
        # Carries enough scoring weight to produce a headline. Since 2026-08-07
        # `breadth_score` renormalizes over PRESENT inputs and withholds below
        # 60 of 100 points rather than extrapolating from a fraction of the
        # evidence — and a real live row carries ~70 before any carried field.
        "metrics": {"pct_above_50sma": 65.3, "up_4pct_today": 163,
                    "down_4pct_today": 61, "adv_decline": -370,
                    "universe_count": 2701, "new_52w_highs": 133,
                    "magna_up": 880, "magna_down": 320, "stage2_count": 410,
                    "vix": 15.4},
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
    assert bi.session_path(SESSION)["pct_above_50sma"][0][1] == 65.3
    assert out["path"]["pct_above_50sma"]
    assert out["open"]["pct_above_50sma"] == 65.3


def test_the_stored_score_is_the_derived_one_not_a_raw_metric(router, monkeypatch):
    """`breadth_score` only exists once the row has been derived. Recording the
    raw metrics would leave the headline number with no path at all."""
    out, bi = _call(router, monkeypatch)
    assert out["row"]["breadth_score"] is not None
    assert bi.session_path(SESSION)["breadth_score"][0][1] == out["row"]["breadth_score"]


@pytest.mark.parametrize("over,why", [
    ({"session_live": False}, "not a session — holiday or pre-open"),
    ({"anchored": False}, "no basis, so the path could step mid-session"),
    ({"degraded": True}, "measured a different population"),
])
def test_a_sample_that_would_poison_the_path_is_not_kept(router, monkeypatch, over, why):
    _, bi = _call(router, monkeypatch, **over)
    assert bi.session_path(SESSION) == {}, why


def test_nothing_is_kept_once_the_collector_has_written_the_day(router, monkeypatch):
    from api.services import breadth_monitor as svc
    monkeypatch.setattr(svc, "get_history", lambda days=90: [
        {"date": SESSION, "universe_count": 2739, "pct_above_50sma": 64.5},
    ])
    out, bi = _call(router, monkeypatch)
    assert out["superseded"] is True
    assert bi.session_path(SESSION) == {}


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
    assert out["carried_from"] == PREV
    assert "naaim" not in out["metrics"]


# ── the drill endpoint ────────────────────────────────────────────────────────

def _drill(router, monkeypatch, out):
    rt, _ = router
    from api.services import breadth_live as live
    monkeypatch.setattr(live, "live_drill", lambda k: out)
    return rt.get_live_drill("up_4pct_today")


def test_live_drill_endpoint_returns_the_recorded_item_envelope(router, monkeypatch):
    body = _drill(router, monkeypatch, {
        "ok": True, "items": [{"t": "AAA", "pct": 5.1, "c": 10.0}],
        "reason": None, "as_of": "2026-08-07T11:00:00-04:00"})
    assert body["items"][0]["t"] == "AAA"
    assert body["as_of"]


# A dead click must not surface an error page.
def test_live_drill_endpoint_is_ok_with_an_empty_list_when_unavailable(router, monkeypatch):
    body = _drill(router, monkeypatch, {
        "ok": False, "items": [], "reason": "no live read cached", "as_of": None})
    assert body["items"] == [] and body["reason"]


# `/{date_str}/drill/{metric_key}` matches "live" as a date perfectly well, so
# whichever is registered FIRST wins. Declared out of order this route is
# unreachable and every live click 404s — assert by RESOLUTION, not by reading
# the source order.
def test_the_live_drill_route_is_not_shadowed_by_the_dated_one(router, monkeypatch):
    rt, _ = router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.services import breadth_live as live
    monkeypatch.setattr(live, "live_drill", lambda k: {
        "ok": True, "items": [{"t": "AAA"}], "reason": None, "as_of": "x"})
    app = FastAPI()
    app.include_router(rt.router)
    # This measures ROUTE RESOLUTION, and since the 2026-08-09 auth sweep the
    # drill routes are `require_paid` — an anonymous 401 arrives before the
    # router ever decides which of the two paths matched, so the question this
    # test asks would be unanswerable. The identity is installed, never the
    # gate, so the real `require_paid` still runs on the resolved route.
    authorize(app, PAID_MEMBER)
    r = TestClient(app).get("/api/breadth-monitor/live/drill/up_4pct_today")
    assert r.status_code == 200, "the dated drill route swallowed 'live' as a date"
    assert r.json()["items"][0]["t"] == "AAA"


# ⛔ The 60s poll is the Dashboard's busiest request on a single-process pod.
# Inlining the lists would multiply it by the universe. Assert on the KEY SET so
# a future author cannot quietly re-bloat it.
def test_the_live_payload_never_carries_drill_lists(router, monkeypatch):
    out, _ = _call(router, monkeypatch)
    row = out.get("row") or {}
    assert not [k for k in row if k.endswith("_list")]
    assert not [k for k in out if k.endswith("_list")]
    assert "members" not in out
