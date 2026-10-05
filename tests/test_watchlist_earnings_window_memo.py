"""S8 (terminal backend fixes, 2026-10-05): MOVE walked the earnings window on every
request. `watchlist_intelligence._earnings_facts` now memoizes it per (ET day, window),
reuses it only while the same lookup is in place, and retries a partial window sooner."""
import datetime

import pytest

from api.services import calendar_alerts as ca
from api.services import watchlist_intelligence as wi


@pytest.fixture
def calendar(monkeypatch):
    wi._EARNINGS_WINDOW_MEMO.clear()
    today = wi._today_et()
    state = {"calls": 0, "ok": True}

    def _lookup(d_str):
        state["calls"] += 1
        return ({"AAA"} if d_str == today.isoformat() else set()), state["ok"]

    monkeypatch.setattr(ca, "_get_reporters_for_date_with_status", _lookup)
    yield state
    wi._EARNINGS_WINDOW_MEMO.clear()


def test_a_second_request_reuses_the_window(calendar):
    first, _ = wi._earnings_facts(["AAA"])
    walked = calendar["calls"]
    assert walked > 0 and "AAA" in first
    second, failed = wi._earnings_facts(["AAA", "BBB"])
    assert calendar["calls"] == walked, "the window was walked again inside its TTL"
    assert set(second) == {"AAA"} and failed is False


def test_a_swapped_lookup_is_never_answered_from_the_old_walk(calendar, monkeypatch):
    wi._earnings_facts(["AAA"])
    monkeypatch.setattr(ca, "_get_reporters_for_date_with_status", lambda d: ({"ZZZ"}, True))
    facts, _ = wi._earnings_facts(["AAA", "ZZZ"])
    assert set(facts) == {"ZZZ"}


def test_a_partial_window_is_retried_after_the_short_ttl(calendar, monkeypatch):
    calendar["ok"] = False
    _, failed = wi._earnings_facts(["AAA"])
    assert failed is True
    walked = calendar["calls"]
    real = wi._EARNINGS_WINDOW_MEMO.copy()
    later = {k: (v[0] - wi._EARNINGS_WINDOW_TTL_PARTIAL_S - 1,) + v[1:] for k, v in real.items()}
    wi._EARNINGS_WINDOW_MEMO.update(later)
    calendar["ok"] = True
    _, failed = wi._earnings_facts(["AAA"])
    assert calendar["calls"] > walked and failed is False


def test_the_cached_window_is_a_copy(calendar):
    wi._earnings_facts(["AAA"])
    key = next(iter(wi._EARNINGS_WINDOW_MEMO))
    wi._EARNINGS_WINDOW_MEMO[key][1]["AAA"] = "1999-01-01"   # a caller mutating its answer...
    out, _ = wi._earnings_window(datetime.date.fromisoformat(key[0]), key[1], ca.collect_earnings_window)
    # ...can only reach the memo through the stored dict, never through a returned one
    out["AAA"] = "2000-01-01"
    again, _ = wi._earnings_window(datetime.date.fromisoformat(key[0]), key[1], ca.collect_earnings_window)
    assert again["AAA"] != "2000-01-01"
