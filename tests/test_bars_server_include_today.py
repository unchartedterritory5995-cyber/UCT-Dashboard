"""The daily serve path INCLUDES today's developing bar in the returned data.

⭐ WHY THIS EXISTS. The sealed daily history ends at the last CLOSED session
(yesterday). Today's forming daily bar used to be a separate CLIENT-side append
that landed a beat after the frame was computed — so Lightweight Charts'
shift-on-new-bar tripped and the current candle "loaded one bar to the right,
then popped left" on nearly every switch/scroll. The permanent fix makes today
part of the `/api/bars` DATA (server-side), so the client's `filteredBars`
always contains it and every framing site frames for it with no timing hack.

⚠️ EVERY CASE DRIVES THE REAL `serve_bars` HANDLER. The append lives in the
shared serve core (web pod AND the bars-serving tier), and is deliberately
restricted to the live equity/ETF DAILY path — index / breadth / delisted /
replay(`to`) and pre-market/weekend (no open session) are left untouched.
"""
import orjson
import pytest

from api.routers import bars
from api.services import massive


def _daily_resp(bars_list, ticker="AAPL", status=200):
    from fastapi.responses import ORJSONResponse
    return ORJSONResponse(
        status_code=status,
        content={"ticker": ticker.upper(), "tf": "D", "bars": bars_list},
    )


_YEST = [
    {"t": "2026-08-31", "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 100},
    {"t": "2026-09-01", "o": 10.5, "h": 12.0, "l": 10.0, "c": 11.8, "v": 120},
]
_TODAY = {"t": "2026-09-02", "o": 11.8, "h": 12.5, "l": 11.5, "c": 12.2, "v": 40}


@pytest.fixture
def today_open(monkeypatch):
    """The regular session is OPEN and today's developing bar is available."""
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: dict(_TODAY))


@pytest.fixture
def no_session(monkeypatch):
    """Pre-market / weekend / holiday — no developing daily bar exists yet."""
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: None)


def _serve(ticker="AAPL", tf="D", to="", inner=None, since_resp=None,
           monkeypatch=None):
    if inner is not None:
        monkeypatch.setattr(bars, "_get_bars_inner", inner)
    if since_resp is not None:
        monkeypatch.setattr(bars, "_get_bars_since_response", since_resp)
    return bars.serve_bars(ticker, tf=tf, bars=600, since="", to=to)


def _bars_of(resp):
    return orjson.loads(resp.body)["bars"]


def test_daily_appends_todays_developing_bar(monkeypatch, today_open):
    r = _serve(inner=lambda t, tf, n: _daily_resp(list(_YEST)),
               monkeypatch=monkeypatch)
    out = _bars_of(r)
    assert out[-1] == _TODAY, "today's developing daily bar must be the new tail"
    assert [b["t"] for b in out] == ["2026-08-31", "2026-09-01", "2026-09-02"]
    # no-store still applies (the tail is a live bar)
    assert "no-store" in r.headers.get("Cache-Control", "")


def test_since_delta_also_gets_today(monkeypatch, today_open):
    """A `since=` delta that returned no NEW sealed bars still carries today, so
    the client that already holds yesterday picks up the current session."""
    monkeypatch.setattr(bars, "_get_bars_since_response",
                        lambda t, tf, n, s: _daily_resp([]))
    r = bars.serve_bars("AAPL", tf="D", bars=600, since="20260901", to="")
    assert _bars_of(r) == [_TODAY]


def test_no_duplicate_when_tail_is_already_today(monkeypatch, today_open):
    """Same-session evolving daily (the store already holds today) → skip; the
    client's live writers own that bar and a second copy would duplicate it."""
    already = list(_YEST) + [dict(_TODAY)]
    r = _serve(inner=lambda t, tf, n: _daily_resp(already), monkeypatch=monkeypatch)
    out = _bars_of(r)
    assert out == already, "must not append a duplicate today bar"
    assert [b["t"] for b in out].count("2026-09-02") == 1


def test_pre_market_or_weekend_appends_nothing(monkeypatch, no_session):
    r = _serve(inner=lambda t, tf, n: _daily_resp(list(_YEST)),
               monkeypatch=monkeypatch)
    assert _bars_of(r) == _YEST, "no bogus bar before the session opens"


def test_intraday_is_never_touched(monkeypatch, today_open):
    """tf!='D' must not get a daily append (nor even consult the helper)."""
    from fastapi.responses import ORJSONResponse
    intraday = [{"t": 1_725_000_000, "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 9}]

    def _boom(tk):
        raise AssertionError("todays_daily_bar must not be called for intraday")
    monkeypatch.setattr(massive, "todays_daily_bar", _boom)
    monkeypatch.setattr(bars, "_get_bars_inner",
                        lambda t, tf, n: ORJSONResponse(
                            content={"ticker": t.upper(), "tf": tf, "bars": intraday}))
    r = bars.serve_bars("AAPL", tf="5", bars=600, since="", to="")
    assert _bars_of(r) == intraday


def test_replay_to_window_is_never_touched(monkeypatch, today_open):
    """The `to=` replay window is historical-by-definition; appending today would
    contaminate a pre-cutoff view. The helper must not even be consulted."""
    def _boom(tk):
        raise AssertionError("todays_daily_bar must not be called on the replay path")
    monkeypatch.setattr(massive, "todays_daily_bar", _boom)
    monkeypatch.setattr(bars, "_get_bars_to_response",
                        lambda t, tf, n, to, warm=False: _daily_resp(list(_YEST)))
    r = bars.serve_bars("AAPL", tf="D", bars=600, since="", to="2026-09-01")
    assert _bars_of(r) == _YEST


def test_index_symbol_is_never_touched(monkeypatch, today_open):
    """Index series (SPX/^IXIC…) come from a different provider path and are
    excluded — the guard checks is_index()."""
    def _boom(tk):
        raise AssertionError("todays_daily_bar must not be called for an index")
    monkeypatch.setattr(massive, "todays_daily_bar", _boom)

    def _fake_index(ticker, tf, n, since_int):
        return {"ticker": ticker, "tf": tf, "bars": list(_YEST)}
    monkeypatch.setattr(bars, "fetch_index_bars", _fake_index)
    r = bars.serve_bars("SPX", tf="D", bars=600, since="", to="")
    assert _bars_of(r) == _YEST


# ── the Massive helper itself ────────────────────────────────────────────────

class _FakeClient:
    def __init__(self, day):
        self._day = day
        self._api_key = "x"

    def _get(self, url, timeout=None):
        return {"status": "OK", "ticker": {"day": self._day}}


def _ohlcv(day, monkeypatch):
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeClient(day))
    return massive._MassiveRestClient.get_todays_daily_ohlcv(_FakeClient(day), "AAPL")


def test_helper_returns_ohlcv_when_session_open(monkeypatch):
    got = _ohlcv({"o": 11.8, "h": 12.5, "l": 11.5, "c": 12.2, "v": 40}, monkeypatch)
    assert got == {"o": 11.8, "h": 12.5, "l": 11.5, "c": 12.2, "v": 40}


def test_helper_returns_none_when_session_not_open(monkeypatch):
    # Pre-market / weekend: the provider zeroes the day aggregate.
    assert _ohlcv({"o": 0, "h": 0, "l": 0, "c": 0, "v": 0}, monkeypatch) is None


def test_todays_daily_bar_stamps_today_and_caches(monkeypatch):
    from api.services.cache import cache
    cache.invalidate("today_daily_bar_AAPL")
    calls = {"n": 0}

    def _one(self, tk):
        calls["n"] += 1
        return {"o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10}
    monkeypatch.setattr(massive._MassiveRestClient, "get_todays_daily_ohlcv", _one)
    monkeypatch.setattr(massive, "_get_client", lambda: object.__new__(massive._MassiveRestClient))
    # Not testing the calendar gate here (see the weekend/holiday tests below) —
    # force it open so this test's result never depends on which real day it runs.
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: True)
    from datetime import datetime
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()

    bar = massive.todays_daily_bar("AAPL")
    assert bar["t"] == today
    assert bar["o"] == 1.0 and bar["v"] == 10
    # second call within the TTL is served from cache (no second provider hit)
    massive.todays_daily_bar("AAPL")
    assert calls["n"] == 1, "the developing-bar snapshot must be TTL-cached per ticker"
    cache.invalidate("today_daily_bar_AAPL")


# ── the weekend/holiday gate (2026-09-04 fix) ────────────────────────────────
# 🔴 THE REGRESSION THIS EXISTS FOR: every symbol served a phantom "tomorrow"
# daily bar — Friday's OHLC verbatim, re-dated onto Saturday — because the
# provider's snapshot `day` object stayed nonzero for a while after the close
# instead of resetting to zero, and `day.o > 0` was the ONLY gate.

def test_todays_daily_bar_refuses_a_stale_nonzero_snapshot_on_a_non_trading_day(monkeypatch):
    from api.services.cache import cache
    cache.invalidate("today_daily_bar_AAPL")
    calls = {"n": 0}

    def _stale_but_nonzero(self, tk):
        calls["n"] += 1
        # Exactly the observed shape: real-looking OHLCV, just not TODAY's.
        return {"o": 353.63, "h": 356.83, "l": 337.11, "c": 337.18, "v": 8451583}
    monkeypatch.setattr(massive._MassiveRestClient, "get_todays_daily_ohlcv", _stale_but_nonzero)
    monkeypatch.setattr(massive, "_get_client", lambda: object.__new__(massive._MassiveRestClient))
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: False)

    assert massive.todays_daily_bar("AAPL") is None
    assert calls["n"] == 0, "must refuse BEFORE ever asking the provider for today's snapshot"
    cache.invalidate("today_daily_bar_AAPL")


def test_todays_daily_bar_gate_checks_weekday_and_nyse_holidays(monkeypatch):
    """The gate itself: Sat/Sun and any date in the NYSE holiday set are
    refused; an ordinary weekday is not.

    `_today_et_is_a_trading_day` does `from datetime import datetime` INSIDE
    the function body (a deliberate deferred import, to dodge a circular
    import with bars_fetch) — that re-reads the `datetime` module's `datetime`
    attribute on every call, so patching it there (not a `massive.datetime`
    that doesn't exist) is what actually freezes "now" for this test.
    """
    import datetime as _dt_mod
    import api.services.bars_fetch as bars_fetch

    real_datetime = _dt_mod.datetime

    def _frozen_datetime_class(iso_date):
        class _Frozen(real_datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.fromisoformat(iso_date).replace(tzinfo=tz)
        return _Frozen

    # Saturday 2026-09-05
    monkeypatch.setattr(_dt_mod, "datetime", _frozen_datetime_class("2026-09-05"))
    assert massive._today_et_is_a_trading_day() is False

    # Labor Day 2026-09-07 (a Monday — weekday check alone would pass it)
    assert 20260907 in bars_fetch._NYSE_HOLIDAYS_YYYYMMDD
    monkeypatch.setattr(_dt_mod, "datetime", _frozen_datetime_class("2026-09-07"))
    assert massive._today_et_is_a_trading_day() is False

    # An ordinary trading Friday
    monkeypatch.setattr(_dt_mod, "datetime", _frozen_datetime_class("2026-09-04"))
    assert massive._today_et_is_a_trading_day() is True


# ── the SESSION-OPEN gate (2026-09-11 fix) ───────────────────────────────────
# 🔴 THE REGRESSION THIS EXISTS FOR: from the charts, "yesterday's candle was
# duplicated — two candles for yesterday", seen BOTH late in the evening and again
# while scanning pre-market. One cause for both sightings: `todays_daily_bar` stamps
# the CURRENT ET date onto the provider's `day` object, which keeps the PRIOR
# session's nonzero OHLC well past the close. The 2026-09-04 fix checked the
# CALENDAR (is it a trading day) and so caught Saturday, but not 00:30 or 07:00 on
# a Thursday — the date has rolled, the session has not opened, and yesterday's bar
# gets re-dated onto today.

def _freeze_et(monkeypatch, iso_datetime):
    """Freeze ET 'now' for BOTH gate helpers. Each does a deferred
    `from datetime import datetime` inside its body, so the patch has to land on
    the datetime MODULE attribute (see the weekday/holiday test above)."""
    import datetime as _dt_mod
    real = _dt_mod.datetime

    class _Frozen(real):
        @classmethod
        def now(cls, tz=None):
            return real.fromisoformat(iso_datetime).replace(tzinfo=tz)
    monkeypatch.setattr(_dt_mod, "datetime", _Frozen)


def test_session_open_gate_is_a_clock_check_not_only_a_calendar_check(monkeypatch):
    # Thursday 2026-09-10, an ordinary trading day, at four times of day.
    for when, expected in (
        ("2026-09-10T00:30:00", False),   # date rolled, session not open  ← "last night"
        ("2026-09-10T07:00:00", False),   # pre-market                     ← "this morning"
        ("2026-09-10T09:30:00", True),    # the open, inclusive
        ("2026-09-10T20:00:00", True),    # post-market: today's settled bar is real
    ):
        _freeze_et(monkeypatch, when)
        assert massive._regular_session_has_opened_today() is expected, when


def test_the_calendar_gate_alone_would_have_passed_the_duplicate_window(monkeypatch):
    """Nails WHY the previous fix missed it: at 00:30 and 07:00 on a trading day the
    OLD gate says True. The new gate must say False at exactly those times."""
    for when in ("2026-09-10T00:30:00", "2026-09-10T07:00:00"):
        _freeze_et(monkeypatch, when)
        assert massive._today_et_is_a_trading_day() is True      # the old gate: passes
        assert massive._regular_session_has_opened_today() is False   # the new gate: refuses


def test_weekend_holiday_refusal_still_holds(monkeypatch):
    _freeze_et(monkeypatch, "2026-09-05T12:00:00")               # Saturday, mid-day
    assert massive._regular_session_has_opened_today() is False
    _freeze_et(monkeypatch, "2026-09-07T12:00:00")               # Labor Day Monday
    assert massive._regular_session_has_opened_today() is False


def test_no_phantom_bar_before_the_open_and_provider_is_never_asked(monkeypatch):
    """End to end: the stale-but-nonzero snapshot shape, at 07:00 on a trading day."""
    from api.services.cache import cache
    cache.invalidate("today_daily_bar_AAPL")
    calls = {"n": 0}

    def _yesterdays_ohlc(self, tk):
        calls["n"] += 1
        return {"o": 353.63, "h": 356.83, "l": 337.11, "c": 337.18, "v": 8451583}
    monkeypatch.setattr(massive._MassiveRestClient, "get_todays_daily_ohlcv", _yesterdays_ohlc)
    monkeypatch.setattr(massive, "_get_client", lambda: object.__new__(massive._MassiveRestClient))
    _freeze_et(monkeypatch, "2026-09-10T07:00:00")

    assert massive.todays_daily_bar("AAPL") is None
    assert calls["n"] == 0, "must refuse BEFORE asking the provider — no wasted snapshot call"
    cache.invalidate("today_daily_bar_AAPL")


def test_post_market_still_gets_todays_settled_bar(monkeypatch):
    """⛔ The fix must not cost evening scanning its candle — post-market is the
    window where the `day` object genuinely IS today's."""
    from api.services.cache import cache
    cache.invalidate("today_daily_bar_AAPL")
    monkeypatch.setattr(massive._MassiveRestClient, "get_todays_daily_ohlcv",
                        lambda self, tk: {"o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10})
    monkeypatch.setattr(massive, "_get_client", lambda: object.__new__(massive._MassiveRestClient))
    _freeze_et(monkeypatch, "2026-09-10T20:00:00")

    bar = massive.todays_daily_bar("AAPL")
    assert bar is not None and bar["t"] == "2026-09-10"
    cache.invalidate("today_daily_bar_AAPL")
