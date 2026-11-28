"""/api/bars-history never caches a SHALLOW store as the whole history (2026-11-28).

The worker's sealed-history answer "serves whatever depth is stored" for a symbol whose deep history is not warmed yet,
and it was stamped sealed and (with a current `d`) `immutable` for a year: the client held a short D/W/M history as the
complete one (a short chart; `historyComplete` read complete). Until the stored (symbol, tf) is KNOWN to reach the
series' start, the answer is `partial` (no-store, `X-Bars-History: partial`), and on the worker its deep backfill is
kicked (bounded, deduped). Known complete: the deep graft landed (a bar before the vendor's floor), or the stored first
bar is the listing (its date in the cached corporate-action metadata). Synthetic store; every price is invented.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from api.routers import bars as bars_router
from api.services import bars_fetch, bars_sanitize, bars_sqlite


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite._drop_local_conn()
    bars_sqlite.init_db()
    meta = {}
    monkeypatch.setattr(bars_sanitize, "_meta_cached", lambda t: meta.get(t))
    kicks = []
    monkeypatch.setattr(bars_fetch, "kick_snapshot_warm", lambda t, tf, need_before_ymd=None: kicks.append((t, tf)) or True)
    monkeypatch.delenv("WORKER_ENABLED", raising=False)
    yield meta, kicks
    bars_sqlite._drop_local_conn()


def _daily(sym, first: date, last: date = date(2026, 11, 20)):
    rows, d, i = [], first, 0
    while d <= last:
        if bars_fetch._is_trading_day_ymd(d):
            rows.append({"t": d.isoformat(), "o": 10 + i * 0.001, "h": 10.5 + i * 0.001, "l": 9.5 + i * 0.001,
                         "c": 10.2 + i * 0.001, "v": 1000})
            i += 1
        d += timedelta(days=1)
    bars_sqlite.put_bars(sym, "D", rows, date_tf=True)
    return rows


def _history(sym, tf="D", d=""):
    r = bars_router.serve_bars_history(sym, tf, 60000, "", d)
    return r, json.loads(r.body)


def _assert_partial(r, body):
    assert body.get("partial") is True, {k: body.get(k) for k in ("partial", "sealed", "count")}
    assert r.headers.get("cache-control") == "no-store", r.headers.get("cache-control")
    assert r.headers.get("x-bars-history") == "partial"


def test_a_series_pinned_to_the_vendor_floor_is_partial_never_immutable(store):
    # the un-grafted signature: the stored daily starts ON Massive's 2003-09-10 floor (a pre-2003 listing never grafted),
    # partial even when the cached listing date says the floor (the floor pin wins: a graft attempt is cheap, a year-long
    # immutable short history is not)
    meta, kicks = store
    meta["FLOOR"] = {"ipo": "2003-09-10", "splits": []}
    rows = _daily("FLOOR", date(2003, 9, 10))
    r, body = _history("FLOOR", "D", d=rows[-2]["t"])
    _assert_partial(r, body)


def test_a_shallow_post_floor_store_with_an_earlier_listing_is_partial(store):
    meta, kicks = store
    meta["SHAL"] = {"ipo": "2010-06-29", "splits": []}                   # listed 2010; the store holds 2024 on only
    _daily("SHAL", date(2024, 1, 2))
    _assert_partial(*_history("SHAL"))


def test_an_unknown_listing_is_not_known_complete(store):
    _daily("UNK", date(2018, 3, 1))                                       # post-floor, no metadata cached yet
    _assert_partial(*_history("UNK"))


def test_a_grafted_series_is_sealed_and_immutable(store):
    rows = _daily("GRAFT", date(1999, 1, 4))                              # a bar before the floor: the graft landed
    last_sealed = rows[-2]["t"] if rows[-1]["t"] >= bars_router._period_start_iso("D") else rows[-1]["t"]
    r, body = _history("GRAFT", "D", d=last_sealed)
    assert not body.get("partial") and body["sealed"] is True
    assert r.headers.get("cache-control") == "public, max-age=31536000, immutable", r.headers.get("cache-control")


def test_a_post_floor_listing_stored_from_its_listing_is_whole(store):
    meta, kicks = store
    meta["IPO"] = {"ipo": "2019-05-10", "splits": []}
    rows = _daily("IPO", date(2019, 5, 10))
    r, body = _history("IPO", "D", d=rows[-1]["t"])
    assert not body.get("partial") and body["sealed"] is True
    assert "no-store" not in (r.headers.get("cache-control") or "")


@pytest.mark.parametrize("worker", [True, False])
def test_a_partial_answer_kicks_the_backfill_on_the_worker_only(store, monkeypatch, worker):
    meta, kicks = store
    if worker:
        monkeypatch.setenv("WORKER_ENABLED", "1")
    _daily("KICK", date(2003, 9, 10))
    _assert_partial(*_history("KICK"))
    assert kicks == ([("KICK", "D")] if worker else []), kicks


def test_a_monthly_series_pinned_to_its_floor_is_partial(store):
    months = [{"t": f"{y}-{m:02d}-01", "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 1}
              for y in range(2003, 2027) for m in range(1, 13) if (y, m) >= (2003, 9) and (y, m) <= (2026, 10)]
    bars_sqlite.put_bars("MFLOOR", "M", months, date_tf=True)
    _assert_partial(*_history("MFLOOR", "M"))


def test_a_partial_answer_never_stops_the_sealed_answer_from_being_cached_once_the_deep_store_lands(store):
    # partial is no-store, so nothing pins it: when the deep warm lands the pre-2003 graft, the SAME request (same d)
    # answers sealed and immutable
    rows = _daily("LAND", date(2003, 9, 10))
    d = rows[-1]["t"]
    _assert_partial(*_history("LAND", "D", d=d))
    bars_sqlite.put_bars("LAND", "D", [{"t": "1999-01-04", "o": 5.0, "h": 5.5, "l": 4.5, "c": 5.2, "v": 1000}],
                         date_tf=True)
    r, body = _history("LAND", "D", d=d)
    assert not body.get("partial") and body["sealed"] is True
    assert r.headers.get("cache-control") == "public, max-age=31536000, immutable", r.headers.get("cache-control")


def test_stale_metadata_naming_an_earlier_listing_keeps_a_later_store_partial(store):
    # the cached listing date says 2001 (a stale or reused-ticker record) while the store starts in 2015: not proven
    meta, kicks = store
    meta["STALE"] = {"ipo": "2001-02-01", "splits": []}
    _daily("STALE", date(2015, 1, 2))
    _assert_partial(*_history("STALE"))
