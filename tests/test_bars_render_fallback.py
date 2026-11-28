"""An answer field orjson cannot encode never costs the whole answer (review of #2949).

Since #2949 an /api/bars answer is serialized ONCE, at the end of `_serve_bars_impl`. A bad
value an augment step added used to fail inside that step's own `try` (it re-rendered per
step) and the answer went out without it; with one render at the end it surfaced in the
outer try and the chart got the OUTER-CRASH 503. Contracts:

  F1  A bad top-level FIELD is dropped, named in the log with the step that added it; every
      other field (the contract included) and the bars are served, 200.
  F2  Bad BARS (a step appended an unencodable bar) drop that STEP: the answer before it is
      served, 200, and the log names the step.
  F3  A serve branch whose own payload cannot be encoded answers the transient 503 the serve
      core's crash path answers, never OUTER-CRASH.
  F4  The ETH 60m answer (rendered in `_serve_eth_hourly`) falls back the same way.

Synthetic stores only; every price is an invented number.
"""
from __future__ import annotations

import datetime as _dt
import logging

import orjson
import pytest

from api.routers import bars as bars_router
from api.services import bars_fetch, bars_sqlite, massive
from api.services.bars_payload import PayloadResponse
from api.services.cache import cache


class _Unencodable:
    """orjson raises on it (no default= hook on the bars encoder)."""


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    monkeypatch.setattr(bars_fetch, "_needs_fresh", lambda *a, **k: False)
    monkeypatch.setattr(bars_fetch, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday", lambda *a, **k: False)
    monkeypatch.setattr(bars_router, "_tail_retry_after_s", lambda: 3)
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: None)
    cache.clear()
    yield
    cache.clear()
    bars_sqlite.bump_db_epoch()


def _seed_daily(ticker, n=300):
    d, rows = _dt.date(2025, 1, 2), []
    while len(rows) < n:
        if bars_fetch._is_trading_day_ymd(d):
            rows.append({"t": d.isoformat(), "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.25, "v": 1000})
        d += _dt.timedelta(days=1)
    bars_sqlite.put_bars(ticker, "D", rows, date_tf=True)
    return rows


def _seed_15m(ticker, sessions=8):
    out, d = [], _dt.date(2026, 11, 2)
    et = _dt.timezone(_dt.timedelta(hours=-5))
    while sessions:
        if bars_fetch._is_trading_day_ymd(d):
            t0 = int(_dt.datetime(d.year, d.month, d.day, 4, 0, tzinfo=et).timestamp())
            out += [{"t": t0 + k * 900, "o": 5.0, "h": 5.1, "l": 4.9, "c": 5.05, "v": 10} for k in range(64)]
            sessions -= 1
        d += _dt.timedelta(days=1)
    bars_sqlite.put_bars(ticker, "15", out, date_tf=False)


def _bad_close_state(monkeypatch):
    real = bars_router._augment_with_bar_close_state

    def bad(resp, tf):
        out = real(resp, tf)
        p = dict(out.payload)
        p["newest_bar_is_forming"] = _Unencodable()
        return PayloadResponse(content=p, status_code=out.status_code)
    monkeypatch.setattr(bars_router, "_augment_with_bar_close_state", bad)


def test_F1_a_bad_field_is_dropped_and_named_the_rest_is_served(store, monkeypatch, caplog):
    _seed_daily("ZZFB")
    _bad_close_state(monkeypatch)
    with caplog.at_level(logging.ERROR):
        r = bars_router.serve_bars("ZZFB", "D", 300, "", "", 0)
    assert r.status_code == 200
    body = orjson.loads(r.body)
    assert "newest_bar_is_forming" not in body and len(body["bars"]) == 300
    assert "series_rev" in body or "contract" in body            # the later contract step stands
    assert "'newest_bar_is_forming' (added by 'bar_close_state')" in caplog.text
    assert "OUTER-CRASH" not in caplog.text
    assert r.headers["cache-control"] == "no-store, must-revalidate"
    assert r.headers["content-length"] == str(len(r.body))


def test_F2_a_bad_bar_drops_the_step_that_appended_it(store, monkeypatch, caplog):
    rows = _seed_daily("ZZBB")
    monkeypatch.setattr(massive, "todays_daily_bar",
                        lambda tk: {"t": "2099-01-02", "o": _Unencodable(), "h": 1, "l": 1, "c": 1, "v": 1})
    with caplog.at_level(logging.ERROR):
        r = bars_router.serve_bars("ZZBB", "D", 300, "", "", 0)
    assert r.status_code == 200
    body = orjson.loads(r.body)
    assert body["bars"][-1]["t"] == rows[-1]["t"]                # served without today's bar
    assert "step 'daily_today'" in caplog.text or "falling back to step 'daily_today'" in caplog.text
    assert "OUTER-CRASH" not in caplog.text


def test_F3_an_unencodable_serve_payload_answers_the_transient_503(store, monkeypatch, caplog):
    monkeypatch.setattr(bars_router, "_get_bars_inner", lambda t, tf, n: PayloadResponse(
        content={"ticker": t, "tf": tf, "bars": [{"t": "2026-01-02", "c": _Unencodable()}]}))
    with caplog.at_level(logging.ERROR):
        r = bars_router.serve_bars("ZZSB", "D", 300, "", "", 0)
    assert r.status_code == 503 and orjson.loads(r.body)["error"] == "transient"
    assert r.headers.get("retry-after") == "5"
    assert "answer not encodable ZZSB" in caplog.text and "OUTER-CRASH" not in caplog.text


def test_F4_the_eth_hourly_answer_falls_back_too(store, monkeypatch, caplog):
    _seed_15m("ZZEB")
    _bad_close_state(monkeypatch)
    with caplog.at_level(logging.ERROR):
        r = bars_router.serve_bars("ZZEB", "60", 50, "", "", 0, "eth")
    assert r.status_code == 200
    body = orjson.loads(r.body)
    assert body["tf"] == "60" and body["bars"] and "newest_bar_is_forming" not in body
    # (the 15m input already carried the bad field, so the first 60m stage is named)
    assert "answer not encodable ZZEB" in caplog.text and "'newest_bar_is_forming'" in caplog.text
    assert "OUTER-CRASH" not in caplog.text


def test_CONTROL_a_clean_answer_renders_once_with_every_step(store):
    _seed_daily("ZZOK")
    r = bars_router.serve_bars("ZZOK", "D", 300, "", "", 0)
    body = orjson.loads(r.body)
    assert r.status_code == 200 and "newest_bar_is_forming" in body
