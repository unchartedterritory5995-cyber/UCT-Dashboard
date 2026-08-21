"""The gate watch fires exactly once per trigger per day, and only on facts.

The wire publishes the levels (gate_levels in wire_data.exposure); the
watcher only compares the cached live price against them. No levels, cold
price cache, or outside RTH -> silent no-op, never a guess.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import exposure_gate_watch as gw
from api.services.cache import cache as app_cache
from api.routers import live_prices as lp

_ET = ZoneInfo("America/New_York")
RTH = datetime(2026, 8, 21, 14, 30, tzinfo=_ET)      # Friday 2:30 PM ET
PRE = datetime(2026, 8, 21, 9, 5, tzinfo=_ET)        # before the open

LEVELS = {"symbol": "QQQ", "release": 732.90, "s2": 707.53}


@pytest.fixture
def alerts(monkeypatch):
    fired = []
    monkeypatch.setattr(
        "api.services.alerts.add_alert",
        lambda *a, **k: fired.append((a, k)) or {"ok": True},
    )
    # fresh dedup + wire state each test
    app_cache.invalidate("wire_data")
    for kind in ("release", "s2"):
        app_cache.invalidate(f"exposure_gate_fired_2026-08-21_{kind}")
    return fired


def _seed(levels=LEVELS, price=720.0):
    app_cache.set("wire_data", {"exposure": {"score": 55, "gate_levels": levels}}, ttl=3600)
    if price is not None:
        lp.cache.set(lp._px_key("QQQ"), {"price": price}, ttl=60)
    else:
        lp.cache.invalidate(lp._px_key("QQQ"))


def test_above_release_fires_once_and_only_once(alerts):
    _seed(price=733.50)
    r1 = gw.check_once(now=RTH)
    r2 = gw.check_once(now=RTH)
    assert r1["fired"] == ["release"]
    assert r2["fired"] == []          # dedup: one alert per trigger per day
    assert len(alerts) == 1
    (args, _kw) = alerts[0]
    assert args[0] == "exposure_gate"
    assert "close" in args[2].lower()  # copy is close-honest


def test_below_s2_fires_the_danger_alert(alerts):
    _seed(price=706.90)
    r = gw.check_once(now=RTH)
    assert r["fired"] == ["s2"]
    assert "25%" in alerts[0][0][2]


def test_between_levels_fires_nothing(alerts):
    _seed(price=720.0)
    assert gw.check_once(now=RTH)["fired"] == []
    assert alerts == []


def test_no_gate_levels_is_a_silent_noop(alerts):
    _seed(levels=None, price=733.50)
    assert gw.check_once(now=RTH)["skipped"] == "no gate levels"
    assert alerts == []


def test_outside_rth_never_fires_even_above_release(alerts):
    """A stale pre-open cache price must not false-fire."""
    _seed(price=733.50)
    assert gw.check_once(now=PRE)["skipped"] == "outside RTH"
    assert alerts == []


def test_cold_price_cache_skips_the_tick(alerts):
    _seed(price=None)
    assert gw.check_once(now=RTH)["skipped"] == "price cache cold"
    assert alerts == []
