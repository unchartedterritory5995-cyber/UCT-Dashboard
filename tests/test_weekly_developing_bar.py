"""The developing WEEKLY bar (2026-09-25).

Measured on production that Friday night: AMD's weekly bar for the week of 9/21 closed 615.52
with a high of 616.69 while its own daily bars closed 630.63 and peaked at 639.00; MSFT, TSLA
and AAPL likewise held a single early-week session; NVDA's weekly chart read $224.58 while its
daily read $225.07. Two causes, one rail each:

1. `_needs_fresh('W')` compared the week's FRIDAY key with the latest session, so from Monday
   to Thursday the developing week looked fresh and was never refreshed.
2. Even refreshed, it is refreshed stale-while-revalidate, so a chart's ONE first paint (and
   the Discord renderer's screenshot) could still carry the stale week. The serve chokepoint
   now rebuilds the developing week from the stored daily bars when they are further along.
"""
from __future__ import annotations

import pytest

from api.services import bars_fetch as bf


@pytest.fixture(autouse=True)
def _plain_sanitize(monkeypatch):
    from api.services import bars_sanitize
    monkeypatch.setattr(bars_sanitize, "sanitize_daily_bars", lambda t, bars, tf: bars)


def _daily(rows):
    return lambda ticker, tf, n: [r for r in rows] if tf == "D" else []


# ── 1. freshness ──────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("latest", [20260921, 20260922, 20260923, 20260924, 20260925])
def test_the_developing_week_is_due_for_refresh_every_day_of_its_week(monkeypatch, latest):
    monkeypatch.setattr(bf, "_last_weekday_yyyymmdd", lambda: latest)
    assert bf._needs_fresh(20260925, "W") is True, "the week's own Friday-keyed bar must refresh mid-week"
    assert bf._needs_fresh(20260918, "W") is True, "last week's bar means this week's is missing"


def test_a_bar_keyed_after_the_latest_sessions_week_is_not_refetched(monkeypatch):
    monkeypatch.setattr(bf, "_last_weekday_yyyymmdd", lambda: 20260923)
    assert bf._needs_fresh(20261002, "W") is False


def test_daily_and_monthly_keep_their_rule(monkeypatch):
    monkeypatch.setattr(bf, "_last_weekday_yyyymmdd", lambda: 20260923)
    assert bf._needs_fresh(20260923, "D") is True and bf._needs_fresh(20260924, "D") is False
    assert bf._needs_fresh(20260901, "M") is True


def test_the_week_key_is_the_resamplers_friday():
    for ymd in (20260921, 20260923, 20260925, 20260927):
        assert bf._week_key_yyyymmdd(ymd) == 20260925
    assert bf._week_key_yyyymmdd(20261228) == 20270101          # ISO week 53 → its calendar Friday
    assert bf._resample_weekly_iso([{"t": "2026-09-23", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])[0]["t"] == "2026-09-25"


# ── 2. the first paint ────────────────────────────────────────────────────────────────────

# the week of 9/21 as AMD's daily store had it (Mon..Fri), and the frozen weekly row
AMD_DAILY = [(20260918, 590.0, 598.0, 585.0, 592.0, 30_000_000),
             (20260921, 583.88, 600.0, 582.27, 598.0, 20_000_000),
             (20260922, 598.0, 616.69, 596.0, 615.52, 24_494_354),
             (20260923, 615.0, 625.0, 610.0, 622.0, 18_000_000),
             (20260924, 622.0, 634.0, 618.0, 632.0, 19_000_000),
             (20260925, 634.535, 639.0, 625.52, 630.63, 17_632_359)]
AMD_WEEKLY = [(20260918, 570.0, 598.0, 560.0, 592.0, 150_000_000),
              (20260925, 583.88, 616.69, 582.27, 615.52, 44_494_354)]


def test_the_developing_week_is_rebuilt_from_the_daily_store_when_it_is_further_along(monkeypatch):
    monkeypatch.setattr(bf._sqlite, "get_bars", _daily(AMD_DAILY))
    out = bf._fmt_sqlite_bars(AMD_WEEKLY, "W", "AMD")
    wk = out[-1]
    assert wk["t"] == "2026-09-25"
    assert (wk["o"], wk["h"], wk["l"], wk["c"]) == (583.88, 639.0, 582.27, 630.63)
    assert wk["v"] == 20_000_000 + 24_494_354 + 18_000_000 + 19_000_000 + 17_632_359
    assert out[-2] == {"t": "2026-09-18", "o": 570.0, "h": 598.0, "l": 560.0, "c": 592.0, "v": 150_000_000}, (
        "a sealed week is never rewritten from a partial daily window")


def test_a_weekly_bar_ahead_of_the_daily_store_is_kept(monkeypatch):
    """The weekly delta writes only W rows from fresh provider dailies, so W can lead D."""
    ahead = AMD_WEEKLY[:-1] + [(20260925, 583.88, 639.0, 582.27, 630.63, 200_000_000)]
    monkeypatch.setattr(bf._sqlite, "get_bars", _daily(AMD_DAILY))
    assert bf._fmt_sqlite_bars(ahead, "W", "AMD")[-1]["v"] == 200_000_000


def test_a_week_the_weekly_store_has_not_seen_yet_is_appended(monkeypatch):
    monkeypatch.setattr(bf._sqlite, "get_bars", _daily(AMD_DAILY[:2]))          # Fri 9/18 + Mon 9/21
    out = bf._fmt_sqlite_bars(AMD_WEEKLY[:1], "W", "AMD")
    assert [b["t"] for b in out] == ["2026-09-18", "2026-09-25"]
    assert out[-1]["c"] == 598.0


def test_no_ticker_means_no_lookup_and_a_failed_lookup_changes_nothing(monkeypatch):
    def boom(*a):
        raise RuntimeError("db locked")
    monkeypatch.setattr(bf._sqlite, "get_bars", boom)
    assert bf._fmt_sqlite_bars(AMD_WEEKLY, "W")[-1]["c"] == 615.52                # bg paths pass no ticker
    assert bf._fmt_sqlite_bars(AMD_WEEKLY, "W", "AMD")[-1]["c"] == 615.52


def test_daily_and_monthly_serving_is_untouched(monkeypatch):
    calls = []
    monkeypatch.setattr(bf._sqlite, "get_bars", lambda *a: calls.append(a) or [])
    bf._fmt_sqlite_bars(AMD_DAILY, "D", "AMD")
    bf._fmt_sqlite_bars([(20260901, 1.0, 2.0, 0.5, 1.5, 10)], "M", "AMD")
    assert calls == [], "only the weekly serve reads the daily store"
