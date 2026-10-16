"""The Focus list's per-row price line: /api/screener/sparks and its service."""
import inspect

import pytest

from api.services.screener import sparks


@pytest.fixture(autouse=True)
def _fresh_cache():
    sparks._CACHE.clear()
    yield
    sparks._CACHE.clear()


def _bars(monkeypatch, table):
    from api.services import bars_sqlite
    calls = []

    def fake(ticker, tf, n):
        calls.append((ticker, tf, n))
        return table.get(ticker, [])
    monkeypatch.setattr(bars_sqlite, "get_bars", fake)
    return calls


def test_a_series_is_the_newest_sessions_oldest_first_with_its_date(monkeypatch):
    calls = _bars(monkeypatch, {"AAA": [(20261014, 1, 1, 1, 10.0, 5), (20261015, 1, 1, 1, 11.5, 5)]})
    got = sparks.closes_for(["AAA"])
    assert got == {"AAA": {"c": [10.0, 11.5], "asof": 20261015}}
    assert calls == [("AAA", "D", sparks.SESSIONS)]


def test_unusable_closes_are_dropped_and_a_missing_symbol_is_empty(monkeypatch):
    _bars(monkeypatch, {"AAA": [(1, 0, 0, 0, None, 0), (2, 0, 0, 0, float("nan"), 0),
                                (3, 0, 0, 0, -1.0, 0), (4, 0, 0, 0, 7.0, 0)]})
    got = sparks.closes_for(["AAA", "ZZZ"])
    assert got["AAA"] == {"c": [7.0], "asof": 4}
    assert got["ZZZ"] == {"c": [], "asof": None}


def test_one_unreadable_symbol_never_fails_the_batch(monkeypatch):
    from api.services import bars_sqlite

    def fake(ticker, tf, n):
        if ticker == "BAD":
            raise RuntimeError("locked")
        return [(1, 0, 0, 0, 5.0, 0), (2, 0, 0, 0, 6.0, 0)]
    monkeypatch.setattr(bars_sqlite, "get_bars", fake)
    got = sparks.closes_for(["BAD", "OK"])
    assert got["BAD"] == {"c": [], "asof": None} and got["OK"]["c"] == [5.0, 6.0]


def test_a_second_ask_within_the_ttl_reads_nothing(monkeypatch):
    calls = _bars(monkeypatch, {"AAA": [(1, 0, 0, 0, 5.0, 0)]})
    sparks.closes_for(["AAA"])
    sparks.closes_for(["AAA"])
    assert len(calls) == 1


def test_CONTROL_an_expired_entry_is_read_again(monkeypatch):
    calls = _bars(monkeypatch, {"AAA": [(1, 0, 0, 0, 5.0, 0)]})
    sparks.closes_for(["AAA"])
    sparks._CACHE["AAA"] = (0.0, sparks._CACHE["AAA"][1])
    sparks.closes_for(["AAA"])
    assert len(calls) == 2


def test_the_ticker_list_is_cleaned_deduped_and_capped():
    raw = " aapl,AAPL,,msft ," + ",".join(f"T{i}" for i in range(100))
    got = sparks.parse_tickers(raw)
    assert got[:2] == ["AAPL", "MSFT"] and len(got) == sparks.MAX_TICKERS
    assert sparks.parse_tickers("") == []
    assert sparks.parse_tickers("X" * 13) == []


def test_the_route_carries_the_paid_gate():
    from api.routers import screener as r
    sig = inspect.signature(r.screener_sparks)
    dep = sig.parameters["user"].default
    assert getattr(dep, "dependency", None) is r.require_paid
