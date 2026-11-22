"""W-S — intraday deep history reaches the provider and comes back (2026-11-11).

Synthetic stores and fake providers only; every price is an invented number.

Contracts guarded here:
  D1  A deep payload is validated against the bar BEFORE it, not today's close: for any
      price path whose bar-to-bar moves are ordinary, the provider's deep answer is
      accepted whatever the total move from its first bar to today is.
  D2  "History complete" vouches only for requests at or under the depth that was
      actually fetched, and the recorded depth never shrinks.
  D3  A `to=` window shorter than asked fetches the stretch before its oldest row (once
      per TTL), and while that fetch runs the stored part is served (`filling`), never
      an empty answer.
"""
from __future__ import annotations

import datetime as _dt
import random
import threading
import time
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.services import bars_fetch, bars_sqlite
from api.services.cache import cache

ET = ZoneInfo("America/New_York")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _et(y, m, d, hh, mm):
    return int(_dt.datetime(y, m, d, hh, mm, tzinfo=ET).timestamp())


def _walk(n, p0, p1, start_t, step_s=900, seed=0):
    """`n` ascending bars from ~p0 to ~p1 (geometric drift + small noise)."""
    rng = random.Random(seed)
    out, px = [], p0
    drift = (p1 / p0) ** (1.0 / max(n - 1, 1))
    for i in range(n):
        o = px
        px = max(0.01, px * drift * (1 + rng.uniform(-0.004, 0.004)))
        c = px
        out.append({"t": start_t + i * step_s, "o": round(o, 4), "h": round(max(o, c) * 1.001, 4),
                    "l": round(min(o, c) * 0.999, 4), "c": round(c, 4), "v": 1000})
    return out


@pytest.fixture
def only_massive(monkeypatch):
    from api.services import source_circuit_breaker as scb
    monkeypatch.setattr(scb, "is_ok", lambda s: True)
    monkeypatch.setattr(scb, "record_attempt", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_fmp", lambda *a: [])
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_yfinance", lambda *a: [])
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda *a, **k: None)
    monkeypatch.setattr(bars_fetch, "_is_intraday_stale", lambda raw: False)
    return monkeypatch


# ── D1 ────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(12))
def test_deep_payload_is_accepted_whatever_the_total_move(store, only_massive, seed):
    """Property: total move from the payload's first bar to today ∈ [0.1x, 10x]."""
    rng = random.Random(seed)
    ratio = 10 ** rng.uniform(-1, 1)
    n = 600
    start = _et(2024, 1, 2, 9, 30)
    payload = _walk(n, 50.0, 50.0 * ratio, start, seed=seed)
    # the store holds only the RECENT end (newer than all but the last few payload bars)
    bars_sqlite.put_bars("DEEP", "15", payload[-5:])
    only_massive.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: list(payload))
    out = bars_fetch._fetch_intraday("DEEP", "15", n)
    assert len(out) == n, f"ratio={ratio:.2f}: deep payload rejected"


def test_the_old_latest_close_seed_rejected_a_doubled_stock(store, only_massive):
    """The failure the seed fix removes, stated directly (documents the root cause)."""
    payload = _walk(600, 50.0, 500.0, _et(2024, 1, 2, 9, 30), seed=3)   # a 10-bagger
    latest = payload[-1]["c"]
    assert bars_fetch._payload_passes_validation(payload, latest) is False
    assert bars_fetch._payload_passes_validation(payload, None) is True


def _stored_tail_and_deep(ticker, stored_px, deep_from_px, deep_to_px, overlap_px=None, n=600, seed=0):
    """A store holding the recent 40 bars at `stored_px`, and a deep payload of `n` bars
    ending at the same timestamps (its last 40 bars overlap the store) at `overlap_px`
    (default: the store's own values, i.e. agreeing)."""
    start = _et(2024, 1, 2, 9, 30)
    payload = _walk(n, deep_from_px, deep_to_px, start, seed=seed)
    stored = [dict(b, o=stored_px, h=stored_px, l=stored_px, c=stored_px) for b in payload[-40:]]
    bars_sqlite.put_bars(ticker, "15", stored)
    if overlap_px is None:
        for i in range(1, 41):
            payload[-i] = dict(stored[-i])
    else:
        for i in range(1, 41):
            payload[-i] = dict(payload[-i], o=overlap_px, h=overlap_px, l=overlap_px, c=overlap_px)
    return payload, stored


def test_a_genuine_10x_run_over_months_is_accepted(store, only_massive):
    payload, _ = _stored_tail_and_deep("RUN", 100.0, 10.0, 100.0)
    only_massive.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: list(payload))
    assert len(bars_fetch._fetch_intraday("RUN", "15", 600)) == 600


def test_a_reused_symbol_payload_is_rejected_and_not_stored(store, only_massive):
    """Another company under the same ticker: deep bars around 5 while the store (and the
    overlap the provider returns for it) trade around 100 — refused, the store untouched."""
    payload, stored = _stored_tail_and_deep("REUSE", 100.0, 5.0, 5.2, overlap_px=5.1)
    only_massive.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: list(payload))
    assert bars_fetch._fetch_intraday("REUSE", "15", 600) == []
    assert bars_fetch._deepfill_once("REUSE", "15", 600) == 0
    assert [r[4] for r in bars_sqlite.get_bars("REUSE", "15", 1000)] == [b["c"] for b in stored]


def test_an_unadjusted_split_payload_is_rejected_and_not_stored(store, only_massive):
    """The store is split-adjusted (~50); the provider answers unadjusted (~100) over the
    same recent bars: a different basis, wholesale. Refused even though the 2x step sits
    inside the 50% gate bar-to-bar."""
    payload, stored = _stored_tail_and_deep("SPLT2", 50.0, 90.0, 100.0, overlap_px=100.0)
    only_massive.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: list(payload))
    assert bars_fetch._fetch_intraday("SPLT2", "15", 600) == []
    assert bars_fetch._deepfill_once("SPLT2", "15", 600) == 0
    assert [r[4] for r in bars_sqlite.get_bars("SPLT2", "15", 1000)] == [b["c"] for b in stored]


def test_a_split_adjusted_payload_over_stale_pre_split_rows_is_accepted_and_corrects_them(store, only_massive):
    """After a 2:1 split the store holds OLD pre-split rows (~100) and the newest sessions
    post-split (~50) — split heal only logs. A split-adjusted deep payload (~50 throughout)
    must be accepted and must leave every stored row on the new basis."""
    day = 86400
    t_new = _et(2026, 11, 9, 9, 30)
    post = [{"t": t_new + d * day + k * 900, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0, "v": 1}
            for d in (0, 1) for k in range(26)]                        # Mon 11-09 + Tue 11-10
    t_old = _et(2026, 10, 26, 9, 30)
    pre = [{"t": t_old + d * day + k * 900, "o": 100.0, "h": 100.0, "l": 100.0, "c": 100.0, "v": 1}
           for d in range(5) for k in range(26)]                       # the week of 10-26, pre-split basis
    bars_sqlite.put_bars("SPLA", "15", pre + post)
    deep0 = _walk(400, 48.0, 50.0, _et(2026, 9, 1, 9, 30), seed=7)   # older history, adjusted
    payload = sorted({b["t"]: b for b in deep0 + [dict(b, c=50.0, o=50.0, h=50.0, l=50.0) for b in pre] + post}.values(),
                     key=lambda b: b["t"])
    only_massive.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: list(payload))
    bars_fetch._set_intraday_source(None)
    out = bars_fetch._fetch_intraday("SPLA", "15", len(payload))
    assert len(out) == len(payload)
    bars_fetch._put_fetched_intraday("SPLA", "15", out)
    stored = {int(r[0]): r[4] for r in bars_sqlite.get_bars("SPLA", "15", 100000)}
    assert all(stored[b["t"]] == 50.0 for b in pre)                    # stale pre-split rows corrected
    assert len(stored) == len(payload)


def test_a_deep_payload_far_from_todays_anchor_is_rejected_without_overlap(store, only_massive):
    """Nothing stored overlaps, but the payload's NEWEST bar is nowhere near the stored
    close: the backward chain has no valid starting point."""
    bars_sqlite.put_bars("ANCH", "15", [{"t": _et(2026, 11, 10, 15, 45), "o": 100, "h": 100, "l": 100, "c": 100, "v": 1}])
    payload = _walk(600, 5.0, 5.0, _et(2024, 1, 2, 9, 30), seed=4)
    only_massive.setattr(bars_fetch, "_fetch_intraday_massive", lambda *a: list(payload))
    assert bars_fetch._fetch_intraday("ANCH", "15", 600) == []


# ── D2 ────────────────────────────────────────────────────────────────────────

def test_history_complete_is_depth_aware_and_never_shrinks():
    t = "HCDEPTH"
    cache.delete_prefix(f"histfull_{t}_")
    bars_fetch._set_intraday_source("massive")
    try:
        bars_fetch._mark_history_complete(t, "15", 3000)
        assert bars_fetch._history_complete(t, "15", 1199)
        assert bars_fetch._history_complete(t, "15", 3000)
        assert not bars_fetch._history_complete(t, "15", 30000)   # the scroll-back ask
        bars_fetch._mark_history_complete(t, "15", 1000)          # shallower: no shrink
        assert bars_fetch._history_complete(t, "15", 3000)
        bars_fetch._mark_history_complete(t, "15", 30000)
        assert bars_fetch._history_complete(t, "15", 30000)
        assert bars_fetch._history_complete(t, "15")              # depth-less caller
    finally:
        bars_fetch._set_intraday_source(None)
        cache.delete_prefix(f"histfull_{t}_")


def test_a_legacy_true_marker_no_longer_vouches_for_a_sized_request():
    cache.set("histfull_HCLEG_5", True, ttl=60)
    try:
        assert not bars_fetch._history_complete("HCLEG", "5", 30000)
        assert bars_fetch._history_complete("HCLEG", "5")
    finally:
        cache.delete_prefix("histfull_HCLEG_")


# ── D3 ────────────────────────────────────────────────────────────────────────

def _rth_day(y, m, d, px=10.0):
    return [{"t": _et(y, m, d, 9, 30) + k * 900, "o": px, "h": px, "l": px, "c": px, "v": 1}
            for k in range(26)]


def _days(start: _dt.date, n):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += _dt.timedelta(days=1)
    return out


def _body(resp):
    return orjson.loads(resp.body)


def test_short_to_window_fetches_before_its_oldest_row_then_stops_asking(store, monkeypatch):
    days = _days(_dt.date(2026, 6, 1), 60)
    stored_days, provider_days = days[-3:], days[:-3]
    bars_sqlite.put_bars("SHRT", "15", [b for d in stored_days for b in _rth_day(d.year, d.month, d.day)])
    calls = []

    def fake_range(t, tf, f, to, raise_errors=False):
        calls.append((f, to))
        return [b for d in provider_days if f <= d.isoformat() <= to
                for b in _rth_day(d.year, d.month, d.day)]
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", fake_range)
    to = stored_days[-1].isoformat()
    cache.delete_prefix("towin_SHRT_")
    r = bars_fetch._get_bars_to_response("SHRT", "15", 1000, to)
    rows = _body(r)["bars"]
    assert len(calls) == 1 and calls[0][1] == stored_days[0].isoformat()   # before the oldest row
    assert len(rows) > 3 * 26 and rows[-1]["t"] == _rth_day(*stored_days[-1].timetuple()[:3])[-1]["t"]
    assert all(a["t"] < b["t"] for a, b in zip(rows, rows[1:]))
    # the window has been answered: asking again reads the store, no provider call
    bars_fetch._get_bars_to_response("SHRT", "15", 1000, to)
    assert len(calls) == 1
    cache.delete_prefix("towin_SHRT_")


def test_a_window_whose_write_failed_is_not_marked_covered_and_is_retried(store, monkeypatch, caplog):
    """Coverage is vouched for only by a STORED answer: a put_bars failure leaves the window
    un-marked (and logged), so the next ask fetches it again instead of reading as covered
    for _TO_WINDOW_TTL."""
    import logging
    days = _days(_dt.date(2026, 6, 1), 40)
    bars_sqlite.put_bars("WFAIL", "15", [b for d in days[-3:] for b in _rth_day(d.year, d.month, d.day)])
    calls = []

    def fake_range(t, tf, f, to, raise_errors=False):
        calls.append(to)
        return [b for d in days[:-3] if f <= d.isoformat() <= to for b in _rth_day(d.year, d.month, d.day)]
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", fake_range)
    real_put = bars_sqlite.put_bars

    def failing_put(*a, **k):
        raise RuntimeError("disk I/O error")
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", failing_put)
    to = days[-1].isoformat()
    cache.delete_prefix("towin_WFAIL_")
    with caplog.at_level(logging.WARNING):
        bars_fetch._get_bars_to_response("WFAIL", "15", 1000, to)
    assert len(calls) == 1 and "to= window write failed" in caplog.text
    assert cache.get(f"towin_WFAIL_15_{to}_{bars_fetch._depth_tier(1000)}") is None
    monkeypatch.setattr(bars_fetch._sqlite, "put_bars", real_put)
    body = _body(bars_fetch._get_bars_to_response("WFAIL", "15", 1000, to))
    assert len(calls) == 2 and len(body["bars"]) > 3 * 26                 # retried, and now stored
    assert cache.get(f"towin_WFAIL_15_{to}_{bars_fetch._depth_tier(1000)}") == 1
    cache.delete_prefix("towin_WFAIL_")


def test_a_short_window_still_landing_serves_what_is_stored_never_empty(store, monkeypatch):
    days = _days(_dt.date(2026, 6, 1), 30)
    bars_sqlite.put_bars("FILL", "15", [b for d in days[-2:] for b in _rth_day(d.year, d.month, d.day)])
    gate = threading.Event()

    def slow_range(t, tf, f, to, raise_errors=False):
        gate.wait(5)
        return [b for d in days[:-2] for b in _rth_day(d.year, d.month, d.day)]
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range", slow_range)
    monkeypatch.setattr(bars_fetch, "_TO_SHORT_WAIT_SECONDS", 0.1)
    cache.delete_prefix("towin_FILL_")
    r = bars_fetch._get_bars_to_response("FILL", "15", 1000, days[-1].isoformat())
    body = _body(r)
    assert r.status_code == 200 and body.get("filling") is True
    assert len(body["bars"]) == 2 * 26 and r.headers.get("retry-after") == "3"
    gate.set()
    for _ in range(50):                                   # the job lands, then the re-ask is full
        time.sleep(0.05)
        if cache.get(f"towin_FILL_15_{days[-1].isoformat()}_{bars_fetch._depth_tier(1000)}"):
            break
    body2 = _body(bars_fetch._get_bars_to_response("FILL", "15", 1000, days[-1].isoformat()))
    assert not body2.get("filling") and len(body2["bars"]) == 30 * 26
    cache.delete_prefix("towin_FILL_")


def test_a_covered_window_never_calls_the_provider(store, monkeypatch):
    days = _days(_dt.date(2026, 3, 2), 50)
    bars_sqlite.put_bars("FULL", "15", [b for d in days for b in _rth_day(d.year, d.month, d.day)])
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range",
                        lambda *a, **k: pytest.fail("covered window must not fetch"))
    body = _body(bars_fetch._get_bars_to_response("FULL", "15", 1000, days[-1].isoformat()))
    assert len(body["bars"]) == 1000 and not body.get("filling")
