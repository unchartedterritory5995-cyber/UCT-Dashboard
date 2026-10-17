"""`get_full_market_snapshot` carries the provider's last-trade time.

The screener's pre-market sweep writes a row only for a symbol that traded TODAY
in pre-market. Without `lastTrade.t` it cannot tell a 08:41 print from
yesterday's close, and every untraded name would read 0.0% as if measured.
"""
from api.services import massive

_T = 1792152000000000000   # ns since epoch


def _client():
    c = massive._MassiveRestClient.__new__(massive._MassiveRestClient)
    c._api_key = "test"
    return c


def _snap(monkeypatch, payload):
    c = _client()
    monkeypatch.setattr(c, "_get", lambda url: payload)
    return c.get_full_market_snapshot()


def _payload():
    return {"tickers": [
        {"ticker": "AAA",
         "day": {"o": 10.0, "h": 12.0, "l": 9.5, "c": 11.0, "v": 500_000},
         "prevDay": {"c": 10.0, "v": 900_000},
         "lastTrade": {"p": 10.5, "t": _T}},
        {"ticker": "BBB",
         "day": {"o": 20.0, "h": 21.0, "l": 19.0, "c": 20.5, "v": 100},
         "prevDay": {"c": 20.0, "v": 200}},
    ]}


def test_last_trade_ns_is_the_provider_int_or_None(monkeypatch):
    out = _snap(monkeypatch, _payload())
    assert out["AAA"]["last_trade_ns"] == _T
    assert isinstance(out["AAA"]["last_trade_ns"], int)
    assert out["BBB"]["last_trade_ns"] is None


def test_every_pre_existing_key_is_unchanged(monkeypatch):
    out = _snap(monkeypatch, _payload())
    a, b = out["AAA"], out["BBB"]
    new = {"last_trade_ns", "day_close", "min_close", "min_t_ms"}
    assert {k: a[k] for k in a if k not in new} == {
        "last_price": 10.5, "prev_close": 10.0, "today_vol": 500_000,
        "prev_vol": 900_000, "day_open": 10.0, "day_high": 12.0, "day_low": 9.5}
    assert {k: b[k] for k in b if k not in new} == {
        "last_price": 20.5, "prev_close": 20.0, "today_vol": 100,
        "prev_vol": 200, "day_open": 20.0, "day_high": 21.0, "day_low": 19.0}


def test_an_invalid_time_is_None_not_a_number(monkeypatch):
    for bad in (0, -5, "n/a", None, float("inf"), float("nan")):
        p = _payload()
        p["tickers"][0]["lastTrade"]["t"] = bad
        assert _snap(monkeypatch, p)["AAA"]["last_trade_ns"] is None, bad


def test_the_close_and_the_minute_bar_are_carried_for_the_screener(monkeypatch):
    """2026-10-17: `day_close` is the regular-session close the screener shows after
    16:00; the minute bar is the after-hours price when `lastTrade` is pinned to the
    closing print. Absent or 0 reads as None, never a price."""
    p = _payload()
    p["tickers"][0]["min"] = {"c": 11.2, "t": 1792170000000}
    out = _snap(monkeypatch, p)
    assert out["AAA"]["day_close"] == 11.0
    assert out["AAA"]["min_close"] == 11.2 and out["AAA"]["min_t_ms"] == 1792170000000
    assert out["BBB"]["min_close"] is None and out["BBB"]["min_t_ms"] is None
    p["tickers"][1]["day"]["c"] = 0
    assert _snap(monkeypatch, p)["BBB"]["day_close"] is None
