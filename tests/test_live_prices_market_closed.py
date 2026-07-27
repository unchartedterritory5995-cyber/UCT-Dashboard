"""`/api/live-prices` serves the last completed session while the market is closed.

Massive zeroes `day` and `lastTrade` outside trading hours and leaves only
`prevDay` populated, which made every ticker fail the "no day close AND no real
change" trust check. With all of them held back the response came back empty and
the route 503'd, so on a weekend the whole watchlist rendered Price/Vol/%Chg as
em-dashes instead of Friday's numbers.

The payloads below are the real shape captured from the Massive snapshot endpoint
on a Sunday.
"""
from __future__ import annotations

import pytest

from api.routers import live_prices as lp


def _closed_ticker(sym: str, prev: dict) -> dict:
    """A ticker exactly as Massive returns it while the market is closed."""
    return {
        "ticker": sym,
        "todaysChangePerc": 0,
        "todaysChange": 0,
        "updated": 0,
        "day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0, "vw": 0},
        "lastQuote": {"P": 0, "S": 0, "p": 0, "s": 0, "t": 0},
        "lastTrade": {"i": "", "p": 0, "s": 0, "t": 0, "x": 0},
        "min": {"av": 0, "t": 0, "n": 0, "o": 0, "h": 0, "l": 0, "c": 0, "v": 0},
        "prevDay": prev,
    }


# Friday's session for AAPL, verbatim from the live weekend response.
_AAPL_FRIDAY = {
    "o": 321.79, "h": 334.37, "l": 321.62,
    "c": 333.02, "v": 4.7489415903844e07, "vw": 331.448,
}


class _ClosedClient:
    _api_key = "k"

    def __init__(self, *tickers):
        self._tickers = list(tickers)

    def _get(self, url, timeout=None):
        return {"tickers": self._tickers, "status": "OK"}


@pytest.fixture
def session_closes(monkeypatch):
    """Stub the settled grouped-daily maps (last session, prior session).

    Defaults to empty — a test opts in by assigning into the two dicts.
    """
    last: dict[str, float] = {}
    prior: dict[str, float] = {}
    monkeypatch.setattr(lp, "_session_closes", lambda: (last, prior))
    return last, prior


# Real settled closes for 2026-07-24 (Friday) and 2026-07-23 (Thursday).
_FRI_CLOSE, _THU_CLOSE = 333.02, 321.66


def test_weekend_serves_friday_instead_of_dropping_everything(session_closes):
    last, prior = session_closes
    last["AAPL"], prior["AAPL"] = _FRI_CLOSE, _THU_CLOSE

    out = lp._fetch_snapshots(
        _ClosedClient(_closed_ticker("AAPL", _AAPL_FRIDAY)), ["AAPL"], "post_market"
    )

    assert "AAPL" in out, "weekend ticker was dropped — this is the 503 that blanked the watchlist"
    row = out["AAPL"]
    assert row["price"] == 333.02          # Friday's close, not 0
    assert row["volume"] == 47_489_415     # Friday's volume, not 0
    assert row["day_open"] == 321.79
    assert row["day_high"] == 334.37
    assert row["day_low"] == 321.62
    # Friday's real move: (333.02 - 321.66) / 321.66
    assert row["change_pct"] == pytest.approx(3.5323, abs=1e-3)
    assert row["change"] == pytest.approx(11.36, abs=1e-2)
    assert row["prev_close"] == 321.66
    assert row["market_closed"] is True


def test_no_percent_invented_when_settled_close_disagrees(session_closes):
    """The guard against the bug this fix originally shipped with.

    If the settled "last session" doesn't match the snapshot's prevDay, the two
    sources are pointing at different sessions — computing a % across them turns a
    multi-session move into a fake one-day change (a stale source once produced
    TSLA -17.7% against a real -2.1%). Price and volume still stand.
    """
    last, prior = session_closes
    last["AAPL"], prior["AAPL"] = 324.20, 318.00   # a stale, older session

    out = lp._fetch_snapshots(
        _ClosedClient(_closed_ticker("AAPL", _AAPL_FRIDAY)), ["AAPL"], "post_market"
    )
    row = out["AAPL"]
    assert row["price"] == 333.02
    assert row["volume"] == 47_489_415
    assert row["change_pct"] == 0.0        # refuses to guess
    assert row["prev_close"] == 0.0


def test_price_and_volume_survive_when_no_settled_data(session_closes):
    """Maps still warming → the move is unknown, but Friday's close still shows."""
    out = lp._fetch_snapshots(
        _ClosedClient(_closed_ticker("AAPL", _AAPL_FRIDAY)), ["AAPL"], "post_market"
    )
    row = out["AAPL"]
    assert row["price"] == 333.02
    assert row["volume"] == 47_489_415
    assert row["change_pct"] == 0.0        # honest unknown, not a fabricated move
    assert row["market_closed"] is True


def test_holiday_falls_back_even_though_clock_says_regular(session_closes):
    """_detect_session() has no holiday calendar, so a weekday holiday reads as
    'regular' while the feed is uniformly empty. A market-wide degraded read is
    itself the signal that the market is shut."""
    out = lp._fetch_snapshots(
        _ClosedClient(_closed_ticker("AAPL", _AAPL_FRIDAY)), ["AAPL"], "regular"
    )
    assert out["AAPL"]["price"] == 333.02


def test_one_bad_ticker_mid_session_is_still_held_back(session_closes):
    """The anti-flash guard must survive: a single degraded ticker alongside
    healthy ones during a live session is dropped, not replaced with a stale close."""
    healthy = {
        "ticker": "MSFT",
        "day": {"c": 390.0, "o": 385.0, "h": 391.0, "l": 384.0, "v": 1_000_000},
        "prevDay": {"c": 381.7},
        "lastTrade": {"p": 390.1},
        "todaysChangePerc": 2.1,
        "todaysChange": 8.3,
    }
    out = lp._fetch_snapshots(
        _ClosedClient(healthy, _closed_ticker("AAPL", _AAPL_FRIDAY)),
        ["MSFT", "AAPL"],
        "regular",
    )
    assert "MSFT" in out
    assert "AAPL" not in out, "a stale close leaked into a live session"


def test_premarket_volume_uses_accumulated_min_av(session_closes):
    """Pre-market volume must come from `min.av`, not the 0 `day.v`.

    The real Monday-morning payload: an active pre-market name has day.v == 0
    (the regular-session aggregate hasn't started) but min.av carries the
    accumulated pre-market volume. Reading day.v reported 0 on every poll, so the
    column kept snapping back to 0 as REST overwrote the SSE stream's value.
    """
    premarket = {
        "ticker": "NBIS",
        "day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0},   # RTH aggregate not started
        "min": {"av": 371936, "v": 2528},                   # accumulated pre-market
        "prevDay": {"c": 187.52, "o": 190, "h": 195, "l": 185, "v": 24_095_349},
        "lastTrade": {"p": 198.20},
        "todaysChangePerc": 5.87,
        "todaysChange": 11.0,
    }
    out = lp._fetch_snapshots(_ClosedClient(premarket), ["NBIS"], "pre_market")
    row = out["NBIS"]
    assert row["volume"] == 371936              # min.av, not 0
    assert row["price"] == 198.20               # pre-market last trade
    assert "market_closed" not in row           # a live pre-market row, not a stale close


def test_regular_session_volume_still_prefers_day_v(session_closes):
    """During RTH day.v is authoritative and wins over min.av (they track anyway)."""
    rth = {
        "ticker": "AAPL",
        "day": {"o": 330, "h": 335, "l": 329, "c": 333.02, "v": 40_000_000},
        "min": {"av": 39_950_000, "v": 1000},
        "prevDay": {"c": 321.66},
        "lastTrade": {"p": 333.10},
        "todaysChangePerc": 3.53,
        "todaysChange": 11.36,
    }
    out = lp._fetch_snapshots(_ClosedClient(rth), ["AAPL"], "regular")
    assert out["AAPL"]["volume"] == 40_000_000


@pytest.fixture
def no_exvol_warm(monkeypatch):
    """Silence the async aggregate warm so tests don't spawn threads/network."""
    monkeypatch.setattr(lp, "_warm_extended_volumes_async", lambda tickers: None)


_PREMARKET_NBIS = {
    "ticker": "NBIS",
    "day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0},
    "min": {"av": 436865, "v": 2528},      # over-counts vs the aggregate
    "prevDay": {"c": 187.52, "v": 24_095_349},
    "lastTrade": {"p": 198.20},
    "todaysChangePerc": 5.87,
    "todaysChange": 11.0,
}


def test_extended_volume_uses_cached_aggregate_when_warm(session_closes, no_exvol_warm):
    """A warmed aggregate total (the chart's number) replaces the min.av over-count."""
    lp.cache.set(lp._exvol_key("NBIS"), 332_241, ttl=60)
    try:
        out = lp._fetch_snapshots(_ClosedClient(_PREMARKET_NBIS), ["NBIS"], "pre_market")
        assert out["NBIS"]["volume"] == 332_241     # aggregate, not min.av's 436_865
    finally:
        lp.cache.invalidate(lp._exvol_key("NBIS"))


def test_extended_volume_placeholder_until_warm_then_schedules(session_closes, monkeypatch):
    """Before the aggregate is cached, min.av stands in AND the ticker is queued to warm."""
    lp.cache.invalidate(lp._exvol_key("NBIS"))
    warmed = {}
    monkeypatch.setattr(lp, "_warm_extended_volumes_async", lambda tickers: warmed.setdefault("t", tickers))

    out = lp._fetch_snapshots(_ClosedClient(_PREMARKET_NBIS), ["NBIS"], "pre_market")
    assert out["NBIS"]["volume"] == 436865       # min.av placeholder
    assert warmed["t"] == ["NBIS"]               # queued for the aggregate warm


def test_fetch_extended_volume_sums_hourly_bars():
    """The aggregate helper sums every bar's volume for the day."""
    class _AggClient:
        _api_key = "k"
        def _get(self, url, timeout=None):
            return {"results": [{"v": 100000}, {"v": 130000}, {"v": 102241}], "status": "OK"}

    assert lp._fetch_extended_volume(_AggClient(), "NBIS") == 332241


def test_fetch_extended_volume_none_when_no_bars():
    """No bars (market closed / no trades) → None so the caller keeps its placeholder."""
    class _EmptyClient:
        _api_key = "k"
        def _get(self, url, timeout=None):
            return {"results": [], "status": "OK"}

    assert lp._fetch_extended_volume(_EmptyClient(), "NBIS") is None


def test_zero_prev_close_is_not_served(session_closes):
    """Nothing usable in prevDay either → still omit rather than invent a 0.00 price."""
    out = lp._fetch_snapshots(
        _ClosedClient(_closed_ticker("ZZZZ", {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0})),
        ["ZZZZ"],
        "post_market",
    )
    assert out == {}
