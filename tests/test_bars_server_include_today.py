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
