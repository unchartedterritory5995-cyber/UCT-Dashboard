"""Import a tweet -- price at post. Bars are seeded through a monkeypatched get_bars_before."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services.journal_two import tweet_price as tp

ET = ZoneInfo("America/New_York")


def et(y, m, d, hh, mm=0, ss=0) -> int:
    return int(datetime(y, m, d, hh, mm, ss, tzinfo=ET).timestamp())


@pytest.fixture
def bars(monkeypatch):
    """store[(tf)] = list of (ts,o,h,l,c,v); the fake honours the real <= to_key contract."""
    store: dict[str, list[tuple]] = {}
    calls = []
    fetches = []

    def fake_get_bars_before(symbol, tf, n, to_key):
        calls.append((symbol, tf, n, to_key))
        rows = sorted(r for r in store.get(tf, []) if r[0] <= to_key)
        return rows[-n:]

    monkeypatch.setattr(tp.bars_sqlite, "get_bars_before", fake_get_bars_before)

    def fake_fetch(symbol, tf, count):
        fetches.append((symbol, tf, count))
        return []

    monkeypatch.setattr(tp, "_fetch_bars", fake_fetch)
    monkeypatch.setattr(tp.time, "time", lambda: float(et(2026, 11, 7, 12)))
    store["calls"] = calls
    store["fetches"] = fetches
    return store


def row(ts, c):
    return (ts, c, c, c, c, 100)


def test_regular_session_label_posted(bars):
    post = et(2026, 11, 6, 10, 0, 30)
    bars["1"] = [row(et(2026, 11, 6, 10, 0) - 60, 101.5)]  # the 09:59 bar closed at 10:00:00
    p = tp.price_at_post("NVDA", post)
    assert p == tp.PricePoint("NVDA", 101.5, "posted", None)


def test_bar_must_close_before_the_post(bars):
    post = et(2026, 11, 6, 10, 2, 0)
    bars["5"] = [row(et(2026, 11, 6, 9, 55), 50.0), row(et(2026, 11, 6, 10, 0), 99.0)]
    p = tp.price_at_post("NVDA", post)
    # the 10:00 bar is still open at 10:02, so the 09:55 bar is used
    assert p is not None and p.price == 50.0 and p.label == "posted"
    assert any(c[3] == post - 300 for c in bars["calls"])


def test_premarket_label(bars):
    post = et(2026, 11, 6, 8, 15)
    bars["1"] = [row(et(2026, 11, 6, 8, 13), 12.25)]
    assert tp.price_at_post("AAPL", post).label == "premarket"


def test_after_hours_label(bars):
    post = et(2026, 11, 6, 17, 30)
    bars["1"] = [row(et(2026, 11, 6, 17, 20), 12.25)]
    assert tp.price_at_post("AAPL", post).label == "after_hours"


def test_stale_bar_falls_back_to_close(bars):
    post = et(2026, 11, 6, 11, 0)
    bars["1"] = [row(post - 31 * 60, 70.0)]
    bars["D"] = [(20261105, 1, 1, 1, 66.0, 1), (20261106, 1, 1, 1, 71.0, 1)]
    p = tp.price_at_post("AAPL", post)
    # 11:00 on Friday: Friday's session has not closed, Thursday's is the latest
    assert p == tp.PricePoint("AAPL", 66.0, "close", "2026-11-05")


def test_post_after_close_uses_that_days_close(bars):
    post = et(2026, 11, 6, 18, 0)
    bars["D"] = [(20261105, 1, 1, 1, 66.0, 1), (20261106, 1, 1, 1, 71.0, 1)]
    p = tp.price_at_post("AAPL", post)
    assert p == tp.PricePoint("AAPL", 71.0, "close", "2026-11-06")


def test_saturday_post_is_friday_close(bars):
    post = et(2026, 11, 7, 9, 0)
    bars["D"] = [(20261105, 1, 1, 1, 66.0, 1), (20261106, 1, 1, 1, 71.0, 1)]
    p = tp.price_at_post("AAPL", post)
    assert p.label == "close" and p.session_date == "2026-11-06" and p.price == 71.0


def test_very_old_daily_bar_is_not_used(bars):
    post = et(2026, 11, 7, 9, 0)
    bars["D"] = [(20260901, 1, 1, 1, 66.0, 1)]
    assert tp.price_at_post("AAPL", post) is None


def test_no_bars_returns_none(bars):
    assert tp.price_at_post("AAPL", et(2026, 11, 6, 11, 0)) is None


def test_one_fetch_on_local_miss_for_recent_post(bars, monkeypatch):
    got = []

    def fetch(symbol, tf, count):
        got.append((symbol, tf))
        return [row(et(2026, 11, 6, 10, 55), 33.0)]

    monkeypatch.setattr(tp, "_fetch_bars", fetch)
    p = tp.price_at_post("AAPL", et(2026, 11, 6, 11, 0))
    assert p == tp.PricePoint("AAPL", 33.0, "posted", None)
    assert len(got) == 1


def test_no_fetch_for_a_post_over_60_days_old(bars, monkeypatch):
    monkeypatch.setattr(tp, "_fetch_bars", lambda *a: pytest.fail("fetched"))
    assert tp.price_at_post("AAPL", et(2026, 8, 1, 11, 0)) is None


def test_any_exception_returns_none(bars, monkeypatch):
    def boom(*a):
        raise RuntimeError("db gone")

    monkeypatch.setattr(tp.bars_sqlite, "get_bars_before", boom)
    assert tp.price_at_post("AAPL", et(2026, 11, 6, 11, 0)) is None


def test_choose_symbol_prefers_note_ticker_when_mentioned():
    assert tp.choose_symbol("brk.b", ["NVDA", "BRK-B"], "$NVDA and $BRK.B") == "BRK-B"
    assert tp.choose_symbol("nvda", ["AAPL", "NVDA"], "$AAPL then $NVDA") == "NVDA"


def test_choose_symbol_first_cashtag_in_text_order():
    assert tp.choose_symbol(None, ["AAPL", "NVDA"], "up $NVDA, down $AAPL") == "NVDA"
    # note ticker not mentioned in the post: fall back to text order
    assert tp.choose_symbol("TSLA", ["AAPL", "NVDA"], "up $NVDA, down $AAPL") == "NVDA"


def test_choose_symbol_none_without_cashtag():
    assert tp.choose_symbol(None, [], "market is wild today") is None
    assert tp.choose_symbol("AAPL", [], "market is wild today") is None
    assert tp.choose_symbol(None, ["NVDA"], "NVDA is wild today") is None


def test_still_comparable_false_after_split(bars):
    post = et(2026, 11, 6, 11, 0)
    bars["D"] = [(20261106, 1, 1, 1, 100.0, 1)]
    assert tp.still_comparable("NVDA", post, 1000.0) is False
    assert tp.still_comparable("NVDA", post, 110.0) is True


def test_still_comparable_true_without_daily_bar(bars):
    assert tp.still_comparable("NVDA", et(2026, 11, 6, 11, 0), 1000.0) is True
