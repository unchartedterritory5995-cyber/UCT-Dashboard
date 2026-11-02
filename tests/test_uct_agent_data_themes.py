"""MD-1 kind `themes` (agent-md, Sprint 1 PR 4a).

Pins the one property that matters most: this kind NEVER builds the theme overlay (a cold build is about 22
Massive calls). It reads the shared overlay cache, then the member route's last complete overlay, else answers
"warming" with provider_calls 0. Also pins the time semantics: a UCT apply time is never as_of, and is never
worded as live.
"""
from __future__ import annotations

import pathlib
from datetime import datetime, timezone

import pytest

from api.routers import theme_performance as route
from api.services import bars_fetch
from api.services import theme_performance as svc
from api.services.cache import cache
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import themes as th

_ROOT = pathlib.Path(__file__).resolve().parents[1]
LATEST = 20261030                                   # Fri 2026-10-30, fixed


def _payload(generated="2026-10-30T21:30:00+00:00", live="2026-11-02T15:04:05+00:00", missing_1y=False):
    def t(name, d1, y1=5.0):
        gr = {"1d": d1, "1w": 2.0, "1m": 3.0, "3m": 4.0, "ytd": 6.0}
        if not missing_1y:
            gr["1y"] = y1
        return {"name": name, "ticker": name[:4].upper(), "sector": "Technology", "group_return": gr,
                "holdings": [{"sym": "A"}, {"sym": "B"}]}
    p = {"themes": [t("Semis", 2.5), t("Solar", -1.2), t("Cyber", 0.4)], "status": "ok", "generated_at": generated}
    if live:
        p["live_as_of"] = live
    return p


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    gw._reset_for_test(None)
    boom = lambda *a, **k: (_ for _ in ()).throw(AssertionError("built the theme overlay"))  # noqa: E731
    monkeypatch.setattr(svc, "build_theme_performance", boom)
    monkeypatch.setattr(svc, "get_theme_performance", boom)
    monkeypatch.setattr(svc, "trigger_recompute", boom)
    monkeypatch.setattr(route, "serve_theme_performance", boom)
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd",
                        lambda now=None: LATEST if now is None or int(now.strftime("%Y%m%d")) >= LATEST else 20261029)
    cache.invalidate(svc._OVERLAID_KEY)
    route._THEME_STALE.forget(route._THEME_KEY)
    yield
    cache.invalidate(svc._OVERLAID_KEY)
    route._THEME_STALE.forget(route._THEME_KEY)
    gw._reset_for_test(None)


def _read(params=None, turn="t1"):
    return gw.read("themes", params or {}, user_id=1, turn_id=turn)


def _moving(monkeypatch, moving):
    monkeypatch.setattr(svc, "prices_moving", lambda now=None: moving)


def test_no_overlay_anywhere_is_warming_with_zero_calls_and_no_build(monkeypatch):
    _moving(monkeypatch, True)
    out = _read()
    assert env.validate_envelope(out) == []
    assert out["status"] == "unavailable" and out["provider_calls"] == 0 and th.NOTE_WARMING in out["notes"]


def test_reads_the_shared_overlay_cache_and_ranks_leaders_and_laggards(monkeypatch):
    _moving(monkeypatch, False)
    cache.set(svc._OVERLAID_KEY, _payload(), ttl=60)
    out = _read({"period": "1d", "limit": 2})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["provider_calls"] == 0
    assert [r["name"] for r in out["data"]["themes"]] == ["Semis", "Cyber"]
    assert set(out["data"]["themes"][0]) == set(th.THEME_FIELDS)
    lag = _read({"period": "1d", "order": "laggards", "limit": 1}, turn="t2")
    assert lag["data"]["themes"][0]["name"] == "Solar"


def test_falls_back_to_the_routes_last_complete_overlay_within_its_bound(monkeypatch):
    _moving(monkeypatch, False)
    route._THEME_STALE.remember(route._THEME_KEY, (_payload(), True))
    out = _read()
    assert out["status"] == "ok" and out["provider_calls"] == 0


def test_an_overlay_older_than_the_routes_bound_is_not_served(monkeypatch):
    _moving(monkeypatch, True)
    route._THEME_STALE.remember(route._THEME_KEY, (_payload(), True),
                                at=datetime.now(timezone.utc).timestamp() - route.THEME_STALE_MAX_AGE - 5)
    out = _read()
    assert out["status"] == "unavailable" and th.NOTE_WARMING in out["notes"]


def test_while_prices_move_as_of_is_null_and_the_apply_time_is_never_live(monkeypatch):
    _moving(monkeypatch, True)
    cache.set(svc._OVERLAID_KEY, _payload(), ttl=60)
    out = _read()
    assert env.validate_envelope(out) == []
    assert out["as_of"] is None and out["data"]["live_applied_at"] == "2026-11-02T15:04:05Z"
    assert th.NOTE_LIVE_APPLIED.format(at="2026-11-02T15:04:05Z") in out["notes"]
    assert out["freshness"] == "periodic"


def test_when_prices_are_not_moving_as_of_is_the_last_session_close(monkeypatch):
    _moving(monkeypatch, False)
    cache.set(svc._OVERLAID_KEY, _payload(), ttl=60)
    out = _read()
    assert out["as_of"] == "2026-10-30T20:00:00Z" and th.NOTE_CLOSED in out["notes"]   # 16:00 EDT


def test_a_base_from_before_the_last_session_is_stale(monkeypatch):
    _moving(monkeypatch, False)
    cache.set(svc._OVERLAID_KEY, _payload(generated="2026-10-29T21:30:00+00:00"), ttl=60)
    out = _read()
    assert out["stale"] is True and any("before the last completed session (2026-10-30)" in n for n in out["notes"])
    cache.set(svc._OVERLAID_KEY, _payload(), ttl=60)
    assert _read(turn="t2")["stale"] is False


def test_a_period_some_themes_lack_is_partial_with_coverage(monkeypatch):
    _moving(monkeypatch, False)
    p = _payload(missing_1y=True)
    p["themes"][0]["group_return"]["1y"] = 9.0
    cache.set(svc._OVERLAID_KEY, p, ttl=60)
    out = _read({"period": "1y"})
    assert out["status"] == "partial"
    assert out["coverage"] == {"evaluated": 3, "answered": 1, "dropped": 0, "not_computable": 2}


@pytest.mark.parametrize("params", [{"period": "2y"}, {"order": "best"}, {"limit": 0}, {"limit": True}])
def test_bad_params_are_refused_before_admission(monkeypatch, params):
    _moving(monkeypatch, False)
    assert _read(params)["status"] == "refused"


def test_limit_is_capped(monkeypatch):
    _moving(monkeypatch, False)
    p = _payload()
    p["themes"] = p["themes"] * 20
    cache.set(svc._OVERLAID_KEY, p, ttl=60)
    assert len(_read({"limit": 500})["data"]["themes"]) == th.MAX_LIMIT


def test_the_build_guards_are_live():
    with pytest.raises(AssertionError):
        svc.build_theme_performance()
    with pytest.raises(AssertionError):
        route.serve_theme_performance()


def test_the_contract_doc_states_the_themes_rules():
    doc = (_ROOT / "docs/agent/program/contracts/MD-1-market-data.md").read_text(encoding="utf-8")
    assert "### 4.3 `themes` (v1.3) and relative volume" in doc
    for s in (th.NOTE_WARMING, th.NOTE_LIVE_APPLIED, th.NOTE_CLOSED, "Relative volume is not an MD-1 kind"):
        assert s in doc, s
    assert "| `volume.surge` |" not in doc
