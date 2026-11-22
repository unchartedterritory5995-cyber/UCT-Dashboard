"""Daily history is stamped by the NYSE calendar, not by a lagging store (2026-11-19).

The browser's `d` is the newest sealed bar of its /api/bars tail, which holds yesterday's bar once the
session closes. The worker's deep store can lag a day after a restart; the endpoint must still treat the
calendar's day as THE current URL (immutable), and the pre-warm sweep must warm that same URL.
"""
import datetime as _dt
import json

import pytest

from api.routers import bars as B
from api.services import history_prewarm as HP

ET = _dt.timezone(_dt.timedelta(hours=-5))


def _at(monkeypatch, y, m, d, hh=2, mm=20):
    fixed = _dt.datetime(y, m, d, hh, mm, tzinfo=ET)

    class _Clock(_dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed

    monkeypatch.setattr(B, "datetime", _Clock)


@pytest.mark.parametrize("today, want", [
    ((2026, 11, 19), "2026-11-18"),   # a Thursday: Wednesday
    ((2026, 11, 23), "2026-11-20"),   # a Monday: the Friday before
    ((2026, 11, 27), "2026-11-25"),   # the day after Thanksgiving (11-26 closed)
])
def test_the_last_sealed_day_is_the_previous_session(monkeypatch, today, want):
    _at(monkeypatch, *today)
    assert B.calendar_last_sealed_day() == want


def _serve(monkeypatch, last_stored, d, tf="D"):
    rows = [{"t": t, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for t in ("2026-11-13", "2026-11-14", last_stored)]
    monkeypatch.setattr(B._bars_fetch._sqlite, "get_bars", lambda sym, tf, n: ["x"])
    monkeypatch.setattr(B, "_fmt_sqlite_bars", lambda r, tf, sym: [dict(b) for b in rows])
    resp = B.serve_bars_history("ZZZT", tf=tf, bars=12500, d=d)
    return resp.headers.get("Cache-Control"), json.loads(resp.body)


def test_the_calendar_day_is_immutable_even_when_the_store_lags(monkeypatch):
    _at(monkeypatch, 2026, 11, 19)                       # browsers ask d=2026-11-18
    cc, body = _serve(monkeypatch, "2026-11-17", "2026-11-18")
    assert cc == "public, max-age=31536000, immutable"
    assert body["last_sealed"] == "2026-11-17"           # the content is what is stored; the tail covers 11-18


def test_an_old_or_future_d_stays_short(monkeypatch):
    _at(monkeypatch, 2026, 11, 19)
    assert _serve(monkeypatch, "2026-11-17", "2026-11-16")[0].startswith("public, max-age=3600")   # older
    assert _serve(monkeypatch, "2026-11-17", "2026-11-19")[0].startswith("public, max-age=3600")   # not sealed yet
    assert _serve(monkeypatch, "2026-11-18", "2026-11-18")[0] == "public, max-age=31536000, immutable"  # the old rule


def test_the_sweep_stamps_daily_by_the_calendar_without_a_read(monkeypatch):
    _at(monkeypatch, 2026, 11, 19)

    class _NoCalls:
        def get(self, *a, **k):
            raise AssertionError("the daily boundary must not be read from the (lagging) store")

    assert HP._market_last_sealed(_NoCalls(), "D") == "2026-11-18"
