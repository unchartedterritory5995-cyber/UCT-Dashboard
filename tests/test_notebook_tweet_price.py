"""Import a tweet -- price at post. Bars are seeded through a monkeypatched get_bars_before."""
from __future__ import annotations

import threading
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
    post = et(2026, 11, 5, 11, 0)
    bars["D"] = [(20261105, 95, 110, 90, 100.0, 1)]
    assert tp.still_comparable("NVDA", post, 1000.0) is False
    assert tp.still_comparable("NVDA", post, 105.0) is True


def test_a_three_for_two_split_is_caught(bars):
    post = et(2026, 11, 5, 11, 0)
    bars["D"] = [(20261105, 66, 70, 64, 66.0, 1)]    # restated from a 100-ish session
    assert tp.still_comparable("NVDA", post, 100.0, "posted", None) is False


def test_a_big_real_day_stays_comparable(bars):
    post = et(2026, 11, 5, 15, 0)
    bars["D"] = [(20261105, 70, 130, 65, 125.0, 1)]
    assert tp.still_comparable("NVDA", post, 120.0, "posted", None) is True


def test_an_extended_hours_price_may_sit_outside_the_regular_range(bars):
    post = et(2026, 11, 5, 7, 0)
    bars["D"] = [(20261105, 100, 110, 100, 105.0, 1)]
    assert tp.still_comparable("NVDA", post, 92.0, "premarket", None) is True
    assert tp.still_comparable("NVDA", post, 80.0, "premarket", None) is False


def test_a_close_is_checked_against_its_own_session(bars):
    post = et(2026, 11, 6, 8, 0)
    bars["D"] = [(20261105, 95, 105, 95, 100.0, 1), (20261106, 60, 70, 55, 62.0, 1)]
    assert tp.still_comparable("NVDA", post, 100.0, "close", "2026-11-05") is True


def test_todays_session_is_always_comparable(bars):
    post = et(2026, 11, 7, 11, 0)     # the fixture's clock is this day
    bars["D"] = [(20261107, 10, 11, 9, 10.0, 1)]
    assert tp.still_comparable("NVDA", post, 500.0, "posted", None) is True


def test_a_missing_session_bar_does_not_borrow_an_older_one(bars):
    post = et(2026, 11, 6, 11, 0)
    bars["D"] = [(20261105, 10, 11, 9, 10.0, 1)]
    assert tp.still_comparable("NVDA", post, 500.0, "posted", None) is True


def test_a_saturday_bar_never_becomes_a_close(bars):
    bars["D"] = [(20261106, 1, 1, 1, 610.15, 1), (20261107, 1, 1, 1, 610.09, 1)]
    p = tp.price_at_post("META", et(2026, 11, 9, 11, 0))
    assert p == tp.PricePoint("META", 610.15, "close", "2026-11-06")


def test_still_comparable_true_without_daily_bar(bars):
    assert tp.still_comparable("NVDA", et(2026, 11, 6, 11, 0), 1000.0) is True


# ── a ticker nobody has charted lately: the first read serves stale bars and refreshes behind it ──

RECENT_RTH = et(2026, 11, 6, 13, 0)   # 23 h before the fixture's clock


def _refresh_after(monkeypatch, reads_until_fresh):
    got = []

    def fetch(symbol, tf, count):
        got.append(tf)
        return [row(RECENT_RTH - 300, 33.0)] if len(got) >= reads_until_fresh else []

    monkeypatch.setattr(tp, "_fetch_bars", fetch)
    monkeypatch.setattr(tp.time, "sleep", lambda s: None)
    return got


def test_a_recent_post_waits_for_its_ticker_to_refresh(bars, monkeypatch):
    got = _refresh_after(monkeypatch, 3)
    p = tp.price_at_post("AAPL", RECENT_RTH, wait_until=tp.time.monotonic() + 5)
    assert p == tp.PricePoint("AAPL", 33.0, "posted", None)
    assert len(got) == 3


def test_without_a_wait_one_read_decides(bars, monkeypatch):
    got = _refresh_after(monkeypatch, 3)
    bars["D"] = [(20260905, 1, 1, 1, 66.0, 1)]
    p = tp.price_at_post("AAPL", RECENT_RTH)
    assert p is None or p.label == "close"
    assert len(got) == 1


def test_a_spent_budget_reads_only_the_store(bars, monkeypatch):
    got = _refresh_after(monkeypatch, 3)
    bars["D"] = [(20261105, 1, 1, 1, 66.0, 1)]
    p = tp.price_at_post("AAPL", RECENT_RTH, wait_until=tp.time.monotonic() - 1)
    assert p == tp.PricePoint("AAPL", 66.0, "close", "2026-11-05")
    assert got == []


def test_a_stuck_read_is_abandoned_at_the_limit(bars, monkeypatch):
    release = threading.Event()
    monkeypatch.setattr(tp, "_fetch_bars", lambda *a: release.wait(5) and [])
    bars["D"] = [(20261105, 1, 1, 1, 66.0, 1)]
    started = tp.time.monotonic()
    try:
        p = tp.price_at_post("AAPL", RECENT_RTH, wait_until=started + 0.2)
        elapsed = tp.time.monotonic() - started
    finally:
        release.set()
    assert elapsed < 2
    assert p == tp.PricePoint("AAPL", 66.0, "close", "2026-11-05")


def test_a_stuck_refresh_start_is_abandoned_at_the_limit(monkeypatch):
    release = threading.Event()
    monkeypatch.setattr(tp, "_fetch_bars", lambda *a: release.wait(5) and [])
    started = tp.time.monotonic()
    try:
        tp.start_refresh("AAPL", started + 0.2)
        elapsed = tp.time.monotonic() - started
    finally:
        release.set()
    assert elapsed < 2


@pytest.mark.parametrize("posted_at", [
    et(2026, 11, 6, 23, 0),     # overnight: no bar exists to wait for
    et(2026, 11, 7, 11, 0),     # Saturday
    et(2026, 11, 5, 13, 0),     # older than a day
])
def test_no_wait_where_no_refresh_can_help(bars, monkeypatch, posted_at):
    got = _refresh_after(monkeypatch, 3)
    tp.price_at_post("AAPL", posted_at, wait_until=tp.time.monotonic() + 5)
    assert len(got) == 1
