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


def test_the_daily_child_report_updates_the_parent_state(live):
    live.apply_daily_report(("ok", 3, ["AAA", "BBB"]))
    assert live.daily_alive() and {"AAA", "BBB"} <= live._daily_seen
    assert live._state["daily_rows_written"] == 3
    live.apply_daily_report(("err", 0, "boom"))   # an error never marks the poll alive anew
    assert live._state["daily_polls"] == 1


def test_the_daily_poll_writes_only_moved_bars_and_reports_every_ticker(live, monkeypatch):
    from api.services import massive_adapter

    class _R:
        value = {"tickers": [{"ticker": "AAA", "day": {"o": 1, "h": 2, "l": 1, "c": 2, "v": 9}},
                             {"ticker": "PRE", "day": {}}]}
    monkeypatch.setattr(massive_adapter, "get", lambda *a, **k: _R())
    last = {}
    n1, seen = live._daily_poll_once(last)
    n2, _ = live._daily_poll_once(last)
    assert (n1, n2) == (1, 0) and seen == {"AAA", "PRE"}


# ── reconnect continuity (2026-10-14 evening) ────────────────────────────────

B = 1_791_990_000          # a 5m boundary (unix s)


def _epoch(epoch, ffb_s, seq=1, rows=(), minutes=(), wm_ms=None):
    return bls.ingest({"epoch_ms": epoch, "seq": seq, "first_full_bucket_ms": ffb_s * 1000,
                       "watermark_ms": wm_ms, "rows": list(rows), "minutes": list(minutes)})


def test_a_new_epoch_that_missed_its_start_asks_for_a_resync_and_covers_nothing(live):
    out = _epoch(5, B + 300, seq=7)
    assert out.get("resync") is True and out["accepted"] == 0
    assert live._state["epoch_ms"] is None
    assert live.stream_alive() is False


def test_a_reconnect_remembers_where_each_covered_ticker_stopped(live):
    _epoch(1, B, wm_ms=(B + 900 + 120) * 1000)       # old feed reached minute B+1020
    live._covered5.update({"AAA", "BBB"})
    _epoch(2, B + 1500)
    assert live._covered5 == set()
    assert live._gap_from == {"AAA": B + 900, "BBB": B + 900}


def test_back_to_back_reconnects_keep_the_EARLIEST_stop(live):
    _epoch(1, B, wm_ms=(B + 600) * 1000)
    live._covered5.add("AAA")
    _epoch(2, B + 1200, wm_ms=(B + 1500) * 1000)    # AAA not repaired before the next drop
    _epoch(3, B + 1800)
    assert live._gap_from["AAA"] == B + 600


def _fake_fetch(monkeypatch, five=(), one=(), fail=False):
    calls = []

    def _f(sym, mult, frm, to):
        calls.append((sym, mult, str(frm), str(to)))
        if fail:
            raise RuntimeError("provider down")
        return list(five if mult == 5 else one)
    monkeypatch.setattr(bls, "_fetch", _f)
    return calls


def _capture_writes(monkeypatch):
    written = []
    monkeypatch.setattr(bars_sqlite, "put_bars_many",
                        lambda tf, by: written.extend((s, b["t"], b) for s, bs in by.items() for b in bs) or
                        sum(len(v) for v in by.values()))
    monkeypatch.setattr(bars_sqlite, "put_bars",
                        lambda s, tf, bars: written.extend((s, b["t"], b) for b in bars))
    return written


def test_a_gap_repair_is_one_small_refetch_and_a_minute_merge(live, monkeypatch):
    ffb = B + 1500
    b0 = ffb - 300
    _epoch(1, B, wm_ms=(B + 600 + 60) * 1000)
    live._covered5.add("AAA")
    _epoch(2, ffb, minutes=[["AAA", b0 + 180, 10, 13, 9, 12, 70]])   # the stream's minutes
    calls = _fake_fetch(monkeypatch,
                        five=[{"t": B + 600, "o": 1, "h": 2, "l": 1, "c": 2, "v": 5},
                              {"t": B + 900, "o": 2, "h": 3, "l": 2, "c": 3, "v": 6},
                              {"t": b0, "o": 9, "h": 9, "l": 9, "c": 9, "v": 999}],   # partial: must NOT land
                        one=[{"t": b0, "o": 10, "h": 11, "l": 10, "c": 11, "v": 30},
                             {"t": b0 + 60, "o": 11, "h": 12, "l": 10, "c": 11, "v": 20},
                             {"t": b0 + 180, "o": 99, "h": 99, "l": 99, "c": 99, "v": 1}])  # stream wins
    written = _capture_writes(monkeypatch)
    assert live._backfill_one("AAA", 2, ffb) is True
    assert [c[1] for c in calls] == [5, 1]
    assert calls[0][2] == str((B + 600) * 1000) and calls[0][3] == str(b0 * 1000 - 1)
    ts = [w[1] for w in written]
    assert ts.count(b0) == 1 and B + 600 in ts and B + 900 in ts
    row = [w[2] for w in written if w[1] == b0][0]
    assert (row["o"], row["h"], row["l"], row["c"], row["v"]) == (10, 13, 9, 12, 120)
    assert "AAA" in live._covered5 and "AAA" not in live._gap_from
    assert live._state["backfill_gap_repairs"] == 1


def test_a_reconnect_inside_the_same_bucket_needs_only_the_minute_call(live, monkeypatch):
    ffb = B + 600
    _epoch(1, B, wm_ms=(B + 300 + 120) * 1000)       # stopped inside bucket B+300 = the new b0
    live._covered5.add("AAA")
    _epoch(2, ffb)
    calls = _fake_fetch(monkeypatch, one=[{"t": B + 300, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    _capture_writes(monkeypatch)
    assert live._backfill_one("AAA", 2, ffb) is True
    assert [c[1] for c in calls] == [1]


def test_a_never_covered_ticker_gets_the_full_history(live, monkeypatch):
    _epoch(1, B + 600)
    calls = _fake_fetch(monkeypatch)
    _capture_writes(monkeypatch)
    assert live._backfill_one("NEW", 1, B + 600) is True
    assert calls[0][1] == 5 and "-" in calls[0][2]                 # a date range, not a timestamp
    assert "NEW" in live._history5_complete and live._state["backfill_full"] == 1


def test_a_provider_error_never_marks_a_ticker_covered(live, monkeypatch):
    _epoch(1, B + 600)
    _fake_fetch(monkeypatch, fail=True)
    _capture_writes(monkeypatch)
    with pytest.raises(RuntimeError):
        live._backfill_one("AAA", 1, B + 600)
    assert "AAA" not in live._covered5


def test_stream_minutes_after_the_repair_keep_the_boundary_bucket_current(live, monkeypatch):
    ffb = B + 600
    b0 = ffb - 300
    _epoch(1, ffb)
    _fake_fetch(monkeypatch, one=[{"t": b0, "o": 5, "h": 6, "l": 4, "c": 5, "v": 10}])
    written = _capture_writes(monkeypatch)
    live._backfill_one("AAA", 1, ffb)
    written.clear()
    _epoch(1, ffb, seq=2, minutes=[["AAA", b0 + 240, 5, 8, 5, 7, 3]])
    row = [w[2] for w in written if w[1] == b0][-1]
    assert (row["o"], row["h"], row["c"], row["v"]) == (5, 8, 7, 13)


def test_a_stream_minute_racing_the_repair_is_not_lost(live, monkeypatch):
    ffb = B + 600
    b0 = ffb - 300
    _epoch(1, ffb)
    written = _capture_writes(monkeypatch)
    real_b0_row = live.b0_row

    def _late_minute(sym, b):   # a push lands between the snapshot and the coverage flip
        row = real_b0_row(sym, b)
        live._b0_stream.setdefault(sym, {})[b0 + 240] = (5, 9, 5, 9, 4)
        live._b0_ver[sym] = live._b0_ver.get(sym, 0) + 1
        monkeypatch.setattr(live, "b0_row", real_b0_row)
        return row
    monkeypatch.setattr(live, "b0_row", _late_minute)
    _fake_fetch(monkeypatch, one=[{"t": b0, "o": 5, "h": 6, "l": 4, "c": 5, "v": 10}])
    live._backfill_one("AAA", 1, ffb)
    row = [w[2] for w in written if w[1] == b0][-1]
    assert (row["h"], row["c"], row["v"]) == (9, 9, 14)


def test_a_read_of_an_uncovered_ticker_jumps_the_repair_queue(live):
    _epoch(1, B + 600)
    live._urgent.clear()
    assert live.covered("ZZZ", "5") is False
    assert live._next_todo(["AAA", "BBB"], [0]) == "ZZZ"
    assert live._next_todo(["AAA", "BBB"], [0]) == "AAA"
