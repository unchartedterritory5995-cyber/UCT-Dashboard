import inspect

import pytest

from api.services import breadth_monitor as bm
from api.services.breadth_monitor import _score_breakdown, _compute_breadth_score

FULL_ROW = {
    "pct_above_50sma": 65, "ratio_5day": 1.5, "magna_up": 70, "magna_down": 30,
    "hi_ratio": 5.0, "cboe_putcall": 0.85, "aaii_spread": -30, "vix": 18,
    "stage2_count": 1250, "universe_count": 5000, "adv_decline": 900,
}


def test_breakdown_total_matches_the_score_function():
    total, _ = _score_breakdown(FULL_ROW)
    assert total == _compute_breadth_score(FULL_ROW)


def test_points_renormalize_to_the_reported_total():
    total, comps = _score_breakdown(FULL_ROW)
    have = sum(c["weight"] for c in comps if c["present"])
    earned = sum(c["points"] for c in comps if c["present"])
    assert round(min(100, max(0, earned / have * 100)), 1) == total


def test_a_missing_input_is_dropped_from_both_sides_not_scored_zero():
    row = dict(FULL_ROW)
    row["cboe_putcall"] = None
    total, comps = _score_breakdown(row)
    pc = next(c for c in comps if c["key"] == "cboe_putcall")
    assert pc["present"] is False
    assert pc["points"] == 0
    # Renormalization means dropping a maxed component must NOT lower the score
    # the way scoring it zero would have.
    assert total == _compute_breadth_score(row)
    have = sum(c["weight"] for c in comps if c["present"])
    assert have == 100 - pc["weight"]


def test_returns_none_below_the_minimum_available_weight():
    total, comps = _score_breakdown({"vix": 18})
    assert total is None
    assert sum(c["weight"] for c in comps if c["present"]) < 60


def test_every_component_reports_its_ceiling():
    _, comps = _score_breakdown(FULL_ROW)
    for c in comps:
        assert c["max_points"] == c["weight"]
        assert c["points"] <= c["max_points"] + 1e-9


# ── the window the endpoint reads ───────────────────────────────────────────
#
# 🔴 `score_components` called `get_history(400)`. `get_history` caches five
# minutes PER `days` value and startup warms only `days=90`, while the Views tab
# legitimately produces 90/180/365 — so 400 was a fourth window nothing warms
# and no other surface shares. Every five minutes the first Attribution render
# paid a cold ~415-row fetch plus a full derivation pass, on a single-process
# pod, with no single-flight guard. (CLAUDE.md records this same function
# spiking 28s when it was uncached.)

@pytest.fixture
def recorded_history(monkeypatch):
    """Capture the `days` `score_components` asks for, and serve two sessions."""
    asked = []

    def fake_get_history(days):
        asked.append(days)
        return [dict(FULL_ROW, date="2026-08-28"), dict(FULL_ROW, date="2026-08-27")]

    monkeypatch.setattr(bm, "get_history", fake_get_history)
    return asked


def test_score_components_reads_the_window_the_caller_asked_for(recorded_history):
    out = bm.score_components("2026-08-28", days=365)
    assert recorded_history == [365], "the client's window was ignored"
    assert out["ok"] is True
    assert out["prev"]["date"] == "2026-08-27"


def test_score_components_defaults_to_the_window_startup_actually_warms(recorded_history):
    bm.score_components("2026-08-28")
    assert recorded_history == [90]


def test_an_unrecorded_date_is_still_a_refusal_not_an_error(recorded_history):
    out = bm.score_components("1999-01-01", days=180)
    assert out["ok"] is False
    assert "no stored session" in out["reason"]
    assert recorded_history == [180]


def _bounds(q):
    """ge/le off a FastAPI Query, wherever the installed pydantic keeps them."""
    out = {}
    for meta in (getattr(q, "metadata", None) or []):
        for k in ("ge", "le"):
            v = getattr(meta, k, None)
            if v is not None:
                out[k] = v
    for k in ("ge", "le"):
        v = getattr(q, k, None)
        if v is not None:
            out[k] = v
    return out


def test_days_is_bounded_exactly_like_the_sibling_endpoint():
    """Derived from the sibling, not retyped: `days` selects a `get_history`
    cache entry and `/api/breadth-monitor` is what warms it, so the two must
    accept the same range or the sharing is accidental."""
    from api.routers import breadth_monitor as router

    sibling = inspect.signature(router.get_breadth_history).parameters["days"].default
    mine = inspect.signature(router.get_breadth_score_components).parameters["days"].default

    assert _bounds(sibling), "the probe read no bounds off the sibling — it proves nothing"
    assert (mine.default, _bounds(mine)) == (sibling.default, _bounds(sibling))


def test_the_route_hands_days_through_to_the_service(monkeypatch):
    """The wire, not the components: routing computed but never applied is a
    failure this repo keeps rediscovering."""
    from api.routers import breadth_monitor as router

    seen = {}
    monkeypatch.setattr(
        router.svc, "score_components",
        lambda date, days=90: seen.update(date=date, days=days) or {"ok": True},
    )
    router.get_breadth_score_components("2026-08-28", days=180, _user={})
    assert seen == {"date": "2026-08-28", "days": 180}
