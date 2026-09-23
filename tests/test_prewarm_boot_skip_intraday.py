"""The boot pass must not re-fetch intraday bars it already holds.

⛔ THE SKIP EXISTED AND INTRADAY WAS NEVER GIVEN IT. `_boot_can_skip` was scoped to
("D","W","M"), so intraday boot jobs fell through to `_needs_fresh`, whose intraday
branch re-fetches anything older than ~300 s during the 04:00-20:00 ET window. On a
DAYTIME deploy that is ~19,000 intraday jobs (`ticker_list`x60/30/15 + 2,500x5m +
1,500x1m) all issuing a provider call.

⚠️ BE PRECISE ABOUT WHAT THAT COSTS, because the first version of this note was
overstated. Those are NOT pure no-ops: during RTH they are genuine deltas returning
the last few minutes of bars. And OUTSIDE the data window an existing 30 h gate
already skipped them, so this changes nothing overnight. What it actually buys is
that a series whose stored bars already cover the last COMPLETED session is not
re-bought at BOOT — the steady 5-min refresh loop owns the hot set's freshness and
picks those symbols up within minutes anyway.

⭐ WHERE IT MATTERS MOST IS THE TAIL. A boot-only reference-tail symbol nobody is
viewing must not have its last ten minutes re-bought on every deploy; "boot-only"
means it is ALLOWED to be behind, and the repair at selection time is what makes it
current. `bars.db` is on the persistent volume and is installed from the R2 snapshot
on a fresh pod, so the history itself always survives the restart.

⭐ THIS IS ALSO WHAT MAKES BROAD TAIL COVERAGE AFFORDABLE. Without it, a shallow
reference-tail pass costs ~20.7k provider calls on every single deploy. With it, a
same-session redeploy costs ~0 and the steady state is ONE call per symbol per
SESSION.
"""
from __future__ import annotations

import datetime as _dt

import pytest

from api.services import bars_prewarm as bp


ET = "America/New_York"


def _ts(y, m, d, hh, mm):
    from zoneinfo import ZoneInfo
    return int(_dt.datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(ET)).timestamp())


@pytest.fixture(autouse=True)
def skip_enabled(monkeypatch):
    monkeypatch.setenv("PREWARM_BOOT_SKIP_SETTLED", "1")
    yield


def test_a_5m_series_holding_the_last_completed_session_is_skipped(monkeypatch):
    """⭐ THE WHOLE POINT. A deploy must not re-buy bars we already own."""
    monkeypatch.setattr(bp, "_expected_session", lambda: 20260923)
    from api.services import bars_fetch
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd",
                        lambda now=None: 20260923)
    assert bp._boot_can_skip(_ts(2026, 9, 23, 10, 0), "5") is True


def test_a_5m_series_missing_a_whole_session_is_still_fetched(monkeypatch):
    """⛔ NEVER OVER-SKIP. A genuinely stale tail must re-fetch, or this re-creates
    the frozen store the prewarmer exists to prevent."""
    from api.services import bars_fetch
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd",
                        lambda now=None: 20260923)
    assert bp._boot_can_skip(_ts(2026, 9, 21, 15, 55), "5") is False


def test_every_intraday_timeframe_participates(monkeypatch):
    from api.services import bars_fetch
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd",
                        lambda now=None: 20260923)
    fresh = _ts(2026, 9, 23, 10, 0)
    for tf in ("1", "5", "15", "30", "60"):
        assert bp._boot_can_skip(fresh, tf) is True, f"tf={tf} still re-fetches"


def test_an_absent_series_is_never_skipped():
    """A symbol we hold nothing for must always be fetched — that is the cold
    population this whole pass exists to perform."""
    for tf in ("1", "5", "15", "30", "60", "D"):
        assert bp._boot_can_skip(None, tf) is False


def test_daily_behaviour_is_unchanged(monkeypatch):
    """⚠️ D/W/M must keep the semantics they already shipped with."""
    monkeypatch.setattr(bp, "_in_active_data_window", lambda: False)
    monkeypatch.setattr(bp, "_expected_session", lambda: 20260923)
    assert bp._boot_can_skip(20260923, "D") is True
    assert bp._boot_can_skip(20260921, "D") is False


def test_the_kill_switch_still_disables_everything(monkeypatch):
    """⛔ One switch turns the whole optimisation off, intraday included."""
    monkeypatch.setenv("PREWARM_BOOT_SKIP_SETTLED", "0")
    assert bp._boot_can_skip(_ts(2026, 9, 23, 10, 0), "5") is False


def test_a_broken_freshness_lookup_fails_OPEN_not_closed(monkeypatch):
    """⛔⛔ Under-skipping costs a redundant fetch; over-skipping freezes the store.
    An exception must choose the cheap mistake."""
    from api.services import bars_fetch
    def boom(*a, **k):
        raise RuntimeError("clock unavailable")
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", boom)
    assert bp._boot_can_skip(_ts(2026, 9, 23, 10, 0), "5") is False
