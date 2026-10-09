"""Audit wave 2 (lane A, BRKE/EE P2 #15): "upcoming" quarters are picked by the
NEW YORK date, never the server's UTC date. At 9:30 PM ET on Oct 8 the UTC date is
already Oct 9, which used to drop a quarter one evening early."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from api.services import broker_estimates as be
from api.services.research import estimates_consensus as ec

# 2026-10-09 01:30 UTC == 2026-10-08 21:30 ET (EDT)
_INSTANT = datetime(2026, 10, 9, 1, 30, tzinfo=timezone.utc)


class _FrozenDT(datetime):
    @classmethod
    def now(cls, tz=None):
        return _INSTANT.astimezone(tz) if tz else _INSTANT.replace(tzinfo=None)


def _edge_row():
    # exactly GRACE_DAYS before the ET date: still forward on Oct 8 ET, gone on Oct 9
    end = (date(2026, 10, 8) - timedelta(days=ec.GRACE_DAYS)).isoformat()
    return {"date": end, "epsAvg": 1.0, "epsLow": 0.9, "epsHigh": 1.1, "numAnalystsEps": 5,
            "revenueAvg": 1e9, "revenueLow": 9e8, "revenueHigh": 1.1e9, "numAnalystsRevenue": 4}


def test_today_et_is_the_new_york_date(monkeypatch):
    monkeypatch.setattr(ec, "datetime", _FrozenDT)
    assert ec.today_et() == date(2026, 10, 8)


def test_broker_periods_default_today_is_et(monkeypatch):
    monkeypatch.setattr(ec, "datetime", _FrozenDT)
    import time as _time
    monkeypatch.setattr(_time, "strftime", lambda fmt, *a: _INSTANT.strftime(fmt))
    ps = be.periods([_edge_row()], last_report=None)
    assert [p["period_end"] for p in ps] == [_edge_row()["date"]]


def test_ee_shape_rows_default_today_is_et(monkeypatch):
    monkeypatch.setattr(ec, "datetime", _FrozenDT)
    rows = ec.shape_rows([_edge_row()], "quarterly", last_report=None)
    assert [r["period_end"] for r in rows] == [_edge_row()["date"]]
