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


def test_daily_is_covered_while_the_poll_is_alive(live):
    live._daily_seen.add("AAA")
    assert live.covered("AAA", "D") is False
    live._state["daily_last_ok_mono"] = live._now_mono()
    assert live.covered("AAA", "D") is True
    assert bars_fetch._needs_fresh(20261014, "D", "AAA") is False


def test_a_deep_request_never_rides_the_thin_history_shortcut(live):
    live._history5_complete.add("AAA")
    assert live.history_complete("AAA", "5") is True
    assert 5000 > live.LIVE_HISTORY_MAX_BARS
