"""Every breadth-family series the site charts is reachable from Discord /chart.

🔴 THE MEASUREMENT THIS CLOSES (2026-10-19). /chart reached the 45 UCT symbols and
nothing else. `/chart US:NETHL` answered "'US:NETHL' is not a ticker" (the Discord
ticker pattern refuses a colon), and `/chart NAMO` went down the stock path and drew
the candle stand-in with "Gap", "$Vol 0" and a 52-week high of -138.2%. The Breadth
Library's US / NYSE / Nasdaq rows and the whole market-indicator registry (McClellan,
exchange A/D, Zweig, sentiment, volatility, COT) were unreachable.

Owner ruling: every one is typed as "UCT" + a short code with no colon. These rails
pin the names, the translation at the two data doors, and that publication still
belongs to each series' own authority.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TICKER_RE = re.compile(r"^[A-Z0-9.^-]{1,12}$")


def _all():
    from api.services import discord_breadth_names as dbn
    return dbn._candidates()


def test_every_name_fits_a_discord_ticker_and_starts_with_UCT():
    names = list(_all())
    assert len(names) > 300, "the catalogue is the whole breadth family, not the 45"
    assert all(TICKER_RE.match(n) and n.startswith("UCT") for n in names)


def test_no_name_is_a_real_ticker():
    """A Discord name that is also a listed stock would chart breadth for a member who meant the stock."""
    real = set(json.loads(Path("api/data/cap_universe.json").read_text()))
    assert "AAPL" in real                                   # the list really is tickers
    # ETFs too: UCTX was the Exposure Rating's name until 2026-10-19, and it is a listed
    # fund (Corgi UCTT 2x Daily ETF), which cap_universe does not carry.
    etfs = {line.split(",", 1)[0].strip() for line in
            Path("tests/fixtures/finviz_etf_sample.csv").read_text(encoding="utf-8").splitlines()[1:]}
    assert "UCTX" in etfs and "SPYQ" in etfs                # the list really is ETFs
    assert sorted(set(_all()) & (real | etfs)) == []


def test_the_exposure_rating_is_UCTEXP_and_UCTX_is_the_fund():
    from api.services import breadth_symbols as bs
    from api.services import discord_breadth_names as dbn
    assert bs.SYMBOLS["UCTEXP"]["metric"] == "uct_exposure"
    assert not bs.is_breadth_symbol("UCTX")                 # a member asking for UCTX gets the fund
    assert dbn.lookup("UCTX") is None and dbn.lookup("UCTEXP").symbol == "UCTEXP"


def test_the_45_shipped_symbols_keep_their_names():
    from api.services import breadth_symbols as bs
    c = _all()
    for sym in bs.SYMBOLS:
        assert c[sym].symbol == sym and c[sym].kind == "breadth"


@pytest.mark.parametrize("name,symbol,kind", [
    ("UCTUSA50", "US:A50", "breadth"),
    ("UCTNQA50", "NASDAQ:A50", "breadth"),
    ("UCTNYA200", "NYSE:A200", "breadth"),
    ("UCTUSNETHL", "US:NETHL", "breadth"),
    ("UCTNQNETHL", "NASDAQ:NETHL", "breadth"),
    ("UCTNAMO", "NASDAQ:MCO", "indicator"),
    ("UCTNASI", "NASDAQ:MCS", "indicator"),
    ("UCTNYMO", "NYSE:MCO", "indicator"),
    ("UCTNYSI", "NYSE:MCS", "indicator"),
    ("UCTUSMCO", "US:MCO", "indicator"),
    ("UCTUSZBT", "US:ZBT", "indicator"),
    ("UCTNAAIM", "SENT:NAAIM", "indicator"),
    ("UCTAAIIBULL", "AAII:BULLS", "indicator"),
    ("UCTVIX9D", "CBOE:VIX9D", "indicator"),
    ("UCTESCOMM", "COT:ES:COMM", "indicator"),
    ("UCTSR3LARGE", "COT:SR3:LARGE", "indicator"),
])
def test_names_map_to_the_sites_own_symbols(name, symbol, kind):
    e = _all()[name]
    assert (e.symbol, e.kind) == (symbol, kind)


def test_publication_belongs_to_each_series_own_authority(monkeypatch):
    """A flag that hides US:A50 on the site hides UCTUSA50 in Discord too."""
    from api.services import discord_breadth_names as dbn
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    assert dbn.lookup("UCTUSA50") is None
    assert dbn.lookup("UCTA50") is not None                 # the shipped 45 never depend on a flag
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us")
    assert dbn.lookup("UCTUSA50").symbol == "US:A50"
    assert dbn.site_symbol("uctusa50") == "US:A50"
    assert dbn.lookup("NVDA") is None and dbn.site_symbol("") is None


@pytest.fixture()
def everything_published(monkeypatch):
    from api.services import discord_breadth_names as dbn
    monkeypatch.setattr(dbn, "_published", lambda e: True)


def test_a_search_finds_a_family_by_word(everything_published):
    from api.services import discord_breadth_names as dbn
    nasdaq = [e.name for e in dbn.choices("nasdaq 50", 10)]
    assert "UCTNQA50" in nasdaq
    assert [e.name for e in dbn.choices("UCTNQA5", 10)][:2] == ["UCTNQA5", "UCTNQA50"]
    assert {e.name for e in dbn.choices("mcclellan", 25)} >= {"UCTNAMO", "UCTNASI", "UCTNYMO", "UCTNYSI"}


@pytest.mark.parametrize("typed", ["UCTNYMO UC", "UCTNYMO UCTNQNETHL", "UCTA50 UCTNH", "UCTA20,UCTNH"])
def test_a_typed_set_gets_no_choice(everything_published, typed):
    """Measured live 2026-10-19: Discord sends the first 10 characters ("UCTNYMO UC"), the
    word search matched UCTNYMO, and Enter would have charted one name of three."""
    from api.routers import discord_interactions as rt
    from api.services import discord_breadth_names as dbn
    assert dbn.choices(typed, 24) == []
    assert rt.breadth_choices(typed) == []


def test_a_word_search_after_UCT_still_works(everything_published):
    from api.services import discord_breadth_names as dbn
    assert "UCTNQA50" in [e.name for e in dbn.choices("UCT NASDAQ", 24)]


def test_breadth_adjust_charts_a_market_indicator_as_breadth(everything_published):
    """NAMO used to draw as a stock: candles, Gap, $Vol 0."""
    from api.routers import discord_interactions as rt
    from api.services import discord_interactions as di
    req, prefs = rt.breadth_adjust(di.ChartRequest("UCTNAMO", "60"), {"stats": True})
    assert req.daily_only and req.tf == "D"
    assert req.breadth_name == "Nasdaq · McClellan Oscillator"
    assert req.display == "UCTNAMO · Nasdaq · McClellan Oscillator"
    assert prefs["stats"] is False and prefs["style"] == "line"


def test_a_typed_weekly_series_opens_on_the_weekly_chart(everything_published):
    """UCTESCOMM on a daily chart read "+0 (+0.00%)": COT is held between weekly reports."""
    from api.routers import discord_interactions as rt
    from api.services import discord_interactions as di
    assert rt.weekly_first(di.ChartRequest("UCTESCOMM", "D")).tf == "W"
    assert rt.weekly_first(di.ChartRequest("UCTNAAIM", "D")).tf == "W"
    assert rt.weekly_first(di.ChartRequest("UCTNAMO", "D")).tf == "D"     # a daily series stays daily
    assert rt.weekly_first(di.ChartRequest("NVDA", "60")).tf == "60"
    # the D button under a chart still means D: breadth_adjust never forces weekly
    req, _ = rt.breadth_adjust(di.ChartRequest("UCTESCOMM", "D"), {})
    assert req.tf == "D"


def test_the_stand_in_reads_the_sites_own_symbol(everything_published, monkeypatch):
    from api.routers import bars as bars_router
    from api.routers import discord_interactions as rt
    seen = []

    class _Resp:
        status_code = 200
        body = json.dumps({"bars": [{"t": "2026-10-16", "c": -28.3}]}).encode()

    monkeypatch.setattr(bars_router, "serve_bars", lambda t, *a: (seen.append(t), _Resp())[1])
    assert rt.fetch_bars("UCTNAMO", "D", 300)[0]["c"] == -28.3
    rt.fetch_bars("NVDA", "D", 300)
    assert seen == ["NASDAQ:MCO", "NVDA"]


@pytest.fixture()
def client(monkeypatch):
    from api.routers import render_panels as rp
    monkeypatch.setenv("CHART_RENDER_TOKEN", "rail-token")
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS", raising=False)
    rp._RL_BUCKETS.pop("breadth-bars", None)
    app = FastAPI()
    app.include_router(rp.router)
    return TestClient(app, raise_server_exceptions=False)


def test_the_door_serves_a_market_indicator_and_a_library_row(client, everything_published, monkeypatch):
    from api.services import breadth_symbols as bs
    from api.services.market_indicators import series as ms
    calls = []
    monkeypatch.setattr(ms, "build_bars", lambda s, tf="D", bars=0: (calls.append(("mi", s, tf, bars)), {"bars": [{"c": 1}]})[1])
    monkeypatch.setattr(bs, "build_breadth_bars", lambda s, tf="D", bars=0: (calls.append(("bs", s, tf, bars)), {"bars": [{"c": 2}]})[1])
    assert client.get("/api/r/breadth-bars/UCTNAMO?token=rail-token&bars=5000").json()["bars"][0]["c"] == 1
    assert client.get("/api/r/breadth-bars/UCTNQA50?token=rail-token&tf=W").json()["bars"][0]["c"] == 2
    assert client.get("/api/r/breadth-bars/UCTA50?token=rail-token").status_code == 200
    assert calls == [("mi", "NASDAQ:MCO", "D", 5000), ("bs", "NASDAQ:A50", "W", 600), ("bs", "UCTA50", "D", 600)]


def test_the_door_still_refuses_a_stock(client, everything_published):
    assert client.get("/api/r/breadth-bars/AAPL?token=rail-token").status_code == 404
    assert client.get("/api/r/breadth-bars/UCTNAMO").status_code == 403
