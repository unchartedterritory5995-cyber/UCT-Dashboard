"""MD-1 kind `bars.daily` (agent-md, Sprint 1 PR 2).

No network, no real bars.db: the store read and the session calendar are stubbed at their seams. Pins:
completed sessions only (today's developing bar never appears), point-in-time `to`, `as_of` = the newest
bar's own session close (early closes included), `stale` against the 1-session budget, zero provider calls,
and no side effect (no fetch, deep-fill, metadata warm or cache write).
"""
from __future__ import annotations

from datetime import datetime

import pytest

from api.services import bars_fetch, bars_sanitize, bars_sqlite
from api.services.cache import cache
from api.services.uct_agent.marketdata import bars_daily as bd
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

# a full week of sessions; 2025-11-27 is Thanksgiving (no row), 2025-11-28 an early close
SESSIONS = [20251121, 20251124, 20251125, 20251126, 20251128, 20251201, 20251202]


def _row(ymd, c=100.0):
    return (ymd, c - 1, c + 1, c - 2, c, 1_000_000)


class _Store:
    def __init__(self, ymds):
        self.rows = [_row(d, 100.0 + i) for i, d in enumerate(ymds)]
        self.calls = []

    def get_bars_before(self, ticker, tf, max_bars, to_key):
        self.calls.append((ticker, tf, max_bars, to_key))
        return [r for r in self.rows if r[0] <= to_key][-max_bars:]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(gw.registry().names()))  # every kind on
    gw._reset_for_test(None)
    # nothing in this kind may reach a provider, start a job or write a cache
    boom = lambda *a, **k: (_ for _ in ()).throw(AssertionError("side effect"))  # noqa: E731
    for name in ("_get_bars_inner", "fetch_with_validation", "_fetch_daily", "_maybe_kick_deepfill",
                 "_kick_cold_fetch", "kick_snapshot_warm", "warm_bars_async", "_record_intraday_request"):
        monkeypatch.setattr(bars_fetch, name, boom)
    monkeypatch.setattr(bars_sanitize, "_warm_meta", boom)
    monkeypatch.setattr(cache, "set", boom)
    yield
    gw._reset_for_test(None)


def _setup(monkeypatch, ymds=SESSIONS, latest=20251202):
    store = _Store(ymds)
    monkeypatch.setattr(bars_sqlite, "get_bars_before", store.get_bars_before)

    def last_closed(now=None):
        if now is None:
            return latest
        # end-of-day cutoff: that date if it is a session in the fixture calendar, else the prior one
        ymd = int(now.strftime("%Y%m%d"))
        return max(d for d in SESSIONS + [latest] if d <= ymd)
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", last_closed)
    return store


def _read(params, turn="t1"):
    return gw.read("bars.daily", params, user_id=1, turn_id=turn)


def test_registers_historical_one_symbol():
    d = {x["kind"]: x for x in gw.describe()}["bars.daily"]
    assert d["freshness"] == "historical" and d["max_symbols"] == 1 and d["owner"] == "agent-md"


def test_completed_sessions_with_as_of_at_the_newest_session_close(monkeypatch):
    store = _setup(monkeypatch)
    out = _read({"symbol": "aapl", "bars": 5})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "historical" and out["stale"] is False
    assert out["provider_calls"] == 0 and out["source"] == "uct-bars"
    assert store.calls == [("AAPL", "D", 5, 20251202)]
    assert [b["date"] for b in out["data"]["bars"]] == ["2025-11-25", "2025-11-26", "2025-11-28",
                                                        "2025-12-01", "2025-12-02"]
    assert out["data"]["through"] == "2025-12-02"
    assert out["as_of"] == "2025-12-02T21:00:00Z"          # 16:00 ET (EST) close
    assert bd.NOTE_COMPLETED in out["notes"]
    b = out["data"]["bars"][-1]
    assert set(b) == {"date", "open", "high", "low", "close", "volume"} and b["volume"] == 1_000_000


def test_todays_developing_bar_is_never_returned(monkeypatch):
    """The store may already hold a row for today (the developing bar); the window ends at the last
    CLOSED session, so it is excluded — even if a store read were to return it."""
    store = _setup(monkeypatch, ymds=SESSIONS + [20251203], latest=20251202)
    store.get_bars_before = lambda t, tf, n, k: store.rows[-n:]     # a read that ignores the cutoff
    monkeypatch.setattr(bars_sqlite, "get_bars_before", store.get_bars_before)
    out = _read({"symbol": "AAPL", "bars": 3})
    assert [b["date"] for b in out["data"]["bars"]][-1] == "2025-12-02"
    assert "2025-12-03" not in [b["date"] for b in out["data"]["bars"]]


def test_early_close_session_uses_its_own_close_time(monkeypatch):
    from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
    assert 20251128 in NYSE_EARLY_CLOSES_YYYYMMDD                  # control: the fixture date is an early close
    _setup(monkeypatch)
    out = _read({"symbol": "AAPL", "bars": 3, "to": "2025-11-28"})
    assert out["data"]["through"] == "2025-11-28" and out["as_of"] == "2025-11-28T18:00:00Z"   # 13:00 ET


def test_point_in_time_to_on_a_holiday_lands_on_the_prior_session(monkeypatch):
    store = _setup(monkeypatch)
    out = _read({"symbol": "AAPL", "bars": 2, "to": "2025-11-27"})   # Thanksgiving
    assert store.calls[-1][3] == 20251126
    assert out["data"]["through"] == "2025-11-26" and out["stale"] is False
    assert out["data"]["latest_completed_session"] == "2025-11-26"
    assert any("point-in-time" in n for n in out["notes"])


def test_a_store_behind_the_newest_session_is_stale_with_a_note(monkeypatch):
    _setup(monkeypatch, ymds=SESSIONS[:-2], latest=20251202)
    out = _read({"symbol": "AAPL", "bars": 3})
    assert env.validate_envelope(out) == []
    assert out["stale"] is True and out["data"]["through"] == "2025-11-28"
    assert any("newest completed session is 2025-12-02" in n for n in out["notes"])


def test_fewer_bars_than_asked_is_partial_with_a_note(monkeypatch):
    _setup(monkeypatch)
    out = _read({"symbol": "NEWIPO", "bars": 400})
    assert env.validate_envelope(out) == [] and out["status"] == "partial"
    assert any("7 of 400 requested bars" in n for n in out["notes"])


def test_bars_is_capped(monkeypatch):
    store = _setup(monkeypatch)
    _read({"symbol": "AAPL", "bars": 10_000})
    assert store.calls[-1][2] == bd.MAX_BARS


def test_a_symbol_the_store_does_not_hold_is_unavailable_and_never_fetched(monkeypatch):
    _setup(monkeypatch, ymds=[])
    out = _read({"symbol": "ZZZZ"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "unavailable" and out["provider_calls"] == 0 and "ZZZZ" in out["notes"][0]


BAD = [{}, {"symbol": "bad sym"}, {"symbol": "AAPL", "bars": 0}, {"symbol": "AAPL", "bars": "10"},
       {"symbol": "AAPL", "bars": True}, {"symbol": "AAPL", "to": "11/27/2025"}, {"symbol": "AAPL", "to": "2025-02-30"}]


@pytest.mark.parametrize("params", BAD)
def test_bad_params_are_refused_before_admission_without_a_store_read(monkeypatch, params):
    store = _setup(monkeypatch)
    out = _read(params)
    assert env.validate_envelope(out) == [] and out["status"] == "refused" and store.calls == []


@pytest.mark.parametrize("params", BAD)
def test_a_direct_adapter_call_cannot_bypass_the_check(monkeypatch, params):
    store = _setup(monkeypatch)
    out = bd.read_bars_daily(params, {})
    assert env.validate_envelope(out) == [] and out["status"] == "unavailable" and store.calls == []


def test_malformed_requests_spend_no_turn_budget(monkeypatch):
    _setup(monkeypatch)
    for _ in range(gw.MAX_READS_PER_TURN + 2):
        assert _read({"symbol": "AAPL", "bars": -1}, turn="same")["status"] == "refused"
    assert _read({"symbol": "AAPL", "bars": 3}, turn="same")["status"] == "ok"


def test_dark_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv(gw.DATA_ENV)
    store = _setup(monkeypatch)
    assert _read({"symbol": "AAPL"})["status"] == "refused" and store.calls == []


def test_the_side_effect_guards_are_live():
    """Non-vacuity: the guards installed by the fixture actually fire."""
    with pytest.raises(AssertionError):
        bars_fetch._maybe_kick_deepfill("AAPL", "D", 10)
    with pytest.raises(AssertionError):
        cache.set("x", 1, ttl=1)


def test_session_calendar_is_the_products_own():
    """Control on the un-stubbed helper: a Saturday cutoff resolves to Friday's session."""
    from zoneinfo import ZoneInfo
    sat = datetime(2025, 11, 22, 23, 59, tzinfo=ZoneInfo("America/New_York"))
    assert bars_fetch._last_closed_session_yyyymmdd(now=sat) == 20251121
