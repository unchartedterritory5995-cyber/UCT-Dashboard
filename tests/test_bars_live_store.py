"""Universe live bars on the serving tier (2026-10-14): a covered series is fresh by
construction and served from SQLite at once; uncovered behaves exactly as before."""
import pytest

from api.services import bars_fetch, bars_live_store as bls, bars_sqlite


@pytest.fixture
def live(monkeypatch, tmp_path):
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setattr(bars_sqlite, "put_bars_many", lambda tf, by: sum(len(v) for v in by.values()))
    bls._reset_for_tests()
    yield bls
    bls._reset_for_tests()


def _push(epoch=1_000_000_000_000, ffb=1_000_000_200_000, rows=()):
    return bls.ingest({"epoch_ms": epoch, "first_full_bucket_ms": ffb,
                       "watermark_ms": ffb, "rows": list(rows)})


def test_nothing_is_covered_with_the_flag_off(monkeypatch):
    monkeypatch.delenv("BARS_LIVE_COVERAGE_ENABLED", raising=False)
    bls._reset_for_tests()
    bls._covered5.add("AAA")
    _push()
    assert bls.covered("AAA", "5") is False
    assert bars_fetch._needs_fresh(1, "5", "AAA") is True


def test_5m_is_covered_only_after_backfill_and_while_the_stream_is_alive(live, monkeypatch):
    _push()
    assert live.covered("AAA", "5") is False          # not backfilled yet
    live._covered5.add("AAA")
    assert live.covered("AAA", "5") is True
    assert bars_fetch._needs_fresh(1, "5", "AAA") is False
    monkeypatch.setattr(live, "STREAM_ALIVE_S", -1)   # the feed went quiet
    assert live.covered("AAA", "5") is False


def test_a_new_socket_voids_every_ticker_coverage(live):
    _push(epoch=1)
    live._covered5.add("AAA")
    _push(epoch=2)
    assert live.covered("AAA", "5") is False


def test_the_stream_never_writes_a_bucket_it_did_not_see_from_its_first_minute(live):
    ffb = 1_000_000_200_000
    out = _push(ffb=ffb, rows=[["AAA", ffb // 1000 - 300, 1, 1, 1, 1, 10],
                               ["AAA", ffb // 1000, 1, 2, 1, 2, 20]])
    assert out["accepted"] == 1


def test_daily_rows_come_from_the_snapshot_day_bar_and_skip_unprinted_tickers():
    rows = bls.daily_rows_from_snapshot([
        {"ticker": "BRK.B", "day": {"o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}},
        {"ticker": "PRE", "day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0}},
    ], 20261014)
    assert rows == [("BRK-B", 20261014, 1.0, 2.0, 0.5, 1.5, 100)]


def test_daily_is_covered_while_the_poll_is_alive(live, monkeypatch):
    monkeypatch.setattr(live, "_daily_contiguous", lambda s: True)
    live._daily_seen.add("AAA")
    assert live.covered("AAA", "D") is False
    live._state["daily_last_ok_mono"] = live._now_mono()
    assert live.covered("AAA", "D") is True
    assert bars_fetch._needs_fresh(20261014, "D", "AAA") is False


def test_a_deep_request_never_rides_the_thin_history_shortcut(live):
    live._history5_complete.add("AAA")
    assert live.history_complete("AAA", "5") is True
    assert 5000 > live.LIVE_HISTORY_MAX_BARS


def test_daily_is_not_covered_when_yesterday_is_missing(live, monkeypatch):
    live._daily_seen.add("AAA")
    live._state["daily_last_ok_mono"] = live._now_mono()

    class _C:
        def execute(self, *a):
            class _R:
                def fetchone(self_):
                    return (20261001,)   # last stored daily bar is two weeks old
            return _R()
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: _C())
    assert live.covered("AAA", "D") is False


def test_prev_session_skips_weekends_and_holidays():
    from datetime import datetime
    assert bls._prev_session_ymd(datetime(2026, 10, 12, 12, tzinfo=bls._ET)) == 20261009  # Mon -> Fri
    assert bls._prev_session_ymd(datetime(2026, 11, 27, 12, tzinfo=bls._ET)) == 20261125  # day after Thanksgiving


def test_end_to_end_a_pushed_bucket_lands_and_a_covered_read_is_served_from_sqlite(monkeypatch, tmp_path):
    """Real SQLite: the web push lands in the store, and a covered tf=5 read is
    answered from SQLite without touching any provider."""
    import time as _t
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite._drop_local_conn()
    bars_sqlite.init_db()
    bls._reset_for_tests()
    now_b = int(_t.time()) // 300 * 300
    hist = [{"t": now_b - 300 * i, "o": 10, "h": 11, "l": 9, "c": 10, "v": 100} for i in range(1, 400)]
    bars_sqlite.put_bars("AAA", "5", hist)

    def _no_provider(*a, **k):
        raise AssertionError("a covered read must not reach a provider")
    monkeypatch.setattr(bars_fetch, "_fetch_intraday", _no_provider)
    monkeypatch.setattr(bars_fetch, "_delta_intraday", _no_provider)

    ffb = (now_b - 600) * 1000
    out = bls.ingest({"epoch_ms": ffb - 1, "first_full_bucket_ms": ffb, "watermark_ms": now_b * 1000,
                      "rows": [["AAA", now_b, 10, 12, 9, 11.5, 777]]})
    assert out["accepted"] == 1
    bls._covered5.add("AAA")
    bars_fetch.cache.delete_prefix("bars_AAA_5_")
    resp = bars_fetch._get_bars_inner("AAA", "5", 240)
    assert bars_fetch.get_serve_layer() == "sqlite"
    import json as _j
    body = _j.loads(resp.body)
    assert body["bars"][-1]["v"] == 777 and body["bars"][-1]["h"] == 12
    bars_sqlite._drop_local_conn()
    bls._reset_for_tests()
