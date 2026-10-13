"""The deep page pre-warm runs only when the render page reads THIS pod's bars store.

2026-10-13: with the bars tier fully ramped (BARS_ORIGIN_URL set, BARS_PROXY_ENABLED=1,
BARS_PROXY_PCT=100) every real /api/bars read goes to bars-api, so warming web's store
with a 5,000-bar pull bought the page nothing and cost the hot-warm cycle 5-19 s per chart.
These rails pin both sides: skipped when routed, kept whenever the page reads locally.
"""
from __future__ import annotations

import pytest

from api.services import discord_chart_prefs as p
from api.services import discord_interactions as di
from api.services.render_gate import MEMBER

PNG = b"\x89PNG\r\n\x1a\n"
_PROXY_ENV = ("BARS_ORIGIN_URL", "BARS_PROXY_ENABLED", "BARS_PROXY_PCT")


def _daily(n=30):
    return [{"t": f"2026-08-{(i % 28) + 1:02d}", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}
            for i in range(n)]


def _run(sym, tf="D", compare=(), house=True):
    asked = []

    def bars_fn(tkr, t, n):
        asked.append((tkr, t, n))
        return _daily()

    req = di.ChartRequest(sym, tf, compare=compare) if compare else di.ChartRequest(sym, tf)
    out = di.produce_chart(req, p.render_options(dict(p.DEFAULTS), tf), dict(p.DEFAULTS), compare,
                           cls=MEMBER, bars_fn=bars_fn, render_fn=lambda *a, **k: PNG,
                           house_fn=(lambda *a, **k: PNG + b"h") if house else None)
    return out, asked


def _deep_asks(asked, sym):
    return [a for a in asked if a[0] == sym and a[2] >= di.PAGE_BARS]


@pytest.fixture
def routed(monkeypatch):
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://bars-api.internal:8080")
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")


@pytest.fixture
def local(monkeypatch):
    for k in _PROXY_ENV:
        monkeypatch.delenv(k, raising=False)


def test_routed_page_skips_the_deep_prewarm_and_still_delivers(routed):
    out, asked = _run("NVDA")
    assert out[0] == "ok" and out[1].startswith(PNG)
    assert _deep_asks(asked, "NVDA") == [], asked          # the 5,000-bar pull is gone
    assert asked == [("NVDA", "D", di.bars_to_request("D"))], asked  # only the daily/stats read


def test_local_page_keeps_the_deep_prewarm(local):
    _, asked = _run("NVDA")
    assert _deep_asks(asked, "NVDA"), asked


def test_a_partial_ramp_keeps_the_prewarm(routed, monkeypatch):
    monkeypatch.setenv("BARS_PROXY_PCT", "50")             # a per-request draw: page may read here
    _, asked = _run("NVDA")
    assert _deep_asks(asked, "NVDA"), asked


def test_breadth_and_indicator_symbols_stay_warmed_when_routed(routed):
    # get_bars keeps these local even at 100 %, so the page reads web's store for them
    assert di.page_bars_read_here("UCTA50") is True
    assert di.page_bars_read_here("NVDA") is False


def test_routed_compare_symbols_are_not_prewarmed(routed):
    _, asked = _run("NVDA", compare=("SPY", "QQQ"))
    assert [a for a in asked if a[0] in ("SPY", "QQQ")] == [], asked


def test_intraday_fallback_fetches_its_own_bars_when_the_warm_was_skipped(routed):
    # house misses -> the stand-in needs the timeframe's bars; with no warm it asks for them
    out, asked = _run("NVDA", tf="15", house=False)
    assert out[0] == "ok", out
    assert ("NVDA", "15", di.bars_to_request("15")) in asked, asked


def test_an_error_answers_read_here(routed, monkeypatch):
    from api.routers import bars as bars_router

    def boom(*a, **k):
        raise RuntimeError("x")
    monkeypatch.setattr(bars_router, "_bars_proxy_should_route", boom)
    assert di.page_bars_read_here("NVDA") is True          # fail to the old behaviour
