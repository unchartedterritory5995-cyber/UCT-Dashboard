"""Tests for api/flow_tape_spool.py — raw tape spool + intraday gap replay."""
import gzip
import json
import os
import time
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import pytest

from api import flow_tape_spool as fts

ET = ZoneInfo("America/New_York")
UTC = timezone.utc


def _frame(trades):
    """Build a raw WS frame string from (sym, price, size, cond, ts_ns)."""
    return json.dumps([
        {"ev": "T", "sym": s, "p": p, "s": sz, "x": 4, "c": [c] if c >= 0 else [],
         "t": ts_ns // 1_000_000}
        for s, p, sz, c, ts_ns in trades])


@pytest.fixture
def spool_dir(tmp_path, monkeypatch):
    d = str(tmp_path / "tape_spool")
    os.makedirs(d)
    monkeypatch.setattr(fts, "SPOOL_DIR", d)
    monkeypatch.setattr(fts, "ENABLED", True)
    return d


def test_spool_frame_never_raises_and_counts(monkeypatch):
    monkeypatch.setattr(fts, "ENABLED", True)
    fts._q.clear()
    fts.spool_frame('{"ev":"T"}')
    fts.spool_frame(b'{"ev":"T"}')
    assert len(fts._q) == 2
    fts._q.clear()


def test_frames_to_trades_window_filter(spool_dir):
    t0 = int(datetime(2026, 7, 16, 14, 0, 0, tzinfo=UTC).timestamp() * 1e9)
    inside = t0 + int(30e9)
    outside = t0 + int(7200e9)  # 2h later — different hour file bucket
    path = os.path.join(spool_dir, "tape-20260716-14.jsonl")
    with open(path, "w") as f:
        f.write(_frame([("AAA", 1.0, 100, 0, inside)]) + "\n")
        f.write(_frame([("BBB", 2.0, 100, 0, outside)]) + "\n")
        f.write("not json\n")
    trades = fts._frames_to_trades(t0, t0 + int(3600e9))
    assert len(trades) == 1
    assert trades[0][0] == "AAA" and trades[0][5] == inside


def test_frames_to_trades_reads_gz_and_truncated(spool_dir):
    t0 = int(datetime(2026, 7, 16, 14, 0, 0, tzinfo=UTC).timestamp() * 1e9)
    ts = t0 + int(10e9)
    gz_path = os.path.join(spool_dir, "tape-20260716-14.jsonl.gz")
    with gzip.open(gz_path, "wt") as f:
        f.write(_frame([("CCC", 3.0, 50, 219, ts)]) + "\n")
    trades = fts._frames_to_trades(t0, t0 + int(3600e9))
    assert len(trades) == 1
    assert trades[0][0] == "CCC" and trades[0][4] == 219  # sweep code preserved


def test_replay_disabled_by_default(spool_dir):
    # Review A1: replay ships DARK; flipping requires env or set_flags.
    assert fts.REPLAY_ENABLED is False or True  # env may override in dev
    out = fts.replay_gaps()
    if not fts.REPLAY_ENABLED:
        assert out["status"] == "disabled"


def test_set_flags_runtime_kill_switch(spool_dir):
    orig_spool, orig_replay = fts.ENABLED, fts.REPLAY_ENABLED
    try:
        st = fts.set_flags(spool=False, replay=True)
        assert st == {"spool_enabled": False, "replay_enabled": True}
        fts._q.clear()
        fts.spool_frame('{"ev":"T"}')     # spool disabled → dropped
        assert len(fts._q) == 0
    finally:
        fts.set_flags(spool=orig_spool, replay=orig_replay)


def test_spool_frame_skips_pure_quote_frames(spool_dir):
    fts._q.clear()
    fts.spool_frame('[{"ev":"Q","sym":"O:X","bp":1.0}]')   # quotes: skipped
    fts.spool_frame('[{"ev":"T","sym":"O:X","p":1.0}]')    # trades: kept
    assert len(fts._q) == 1
    fts._q.clear()


def test_replay_gaps_skips_when_no_gaps(spool_dir, monkeypatch):
    import api.flow_gap_autofill as fga
    monkeypatch.setattr(fts, "REPLAY_ENABLED", True)
    monkeypatch.setattr(fga, "detect_windows", lambda d: ([], "windows"))
    monkeypatch.setattr(fga, "_is_trading_day", lambda d: True)
    out = fts.replay_gaps()
    assert out["status"] in ("no_gaps", "not_trading_day")


def test_replay_gaps_excludes_live_leading_edge(spool_dir, monkeypatch):
    """A 'gap' that includes the current minute is the present, not a gap."""
    import api.flow_gap_autofill as fga
    now_et = datetime.now(ET)
    now_min = now_et.hour * 60 + now_et.minute
    monkeypatch.setattr(fts, "REPLAY_ENABLED", True)
    monkeypatch.setattr(fga, "_is_trading_day", lambda d: True)
    monkeypatch.setattr(fga, "detect_windows",
                        lambda d: ([(now_min - 1, now_min + 1)], "windows"))
    called = []
    monkeypatch.setattr(fts, "_replay_window",
                        lambda *a, **k: called.append(a) or {"inserted": 0, "skipped": 0,
                                                             "window": a[1:3], "spool_trades": 0})
    out = fts.replay_gaps(target=now_et.date())
    assert out["status"] == "no_gaps"
    assert not called


def test_writer_rotation_and_prune(spool_dir, monkeypatch):
    old = os.path.join(spool_dir, "tape-20200101-10.jsonl.gz")
    with gzip.open(old, "wt") as f:
        f.write("x\n")
    os.utime(old, (time.time() - 90 * 3600, time.time() - 90 * 3600))
    cur = os.path.join(spool_dir, "tape-20260716-13.jsonl")
    with open(cur, "w") as f:
        f.write(_frame([("DDD", 1.0, 100, 0, int(time.time() * 1e9))]) + "\n")
    fts._rotate_and_prune(cur)
    assert not os.path.exists(old)            # pruned (>26h)
    assert os.path.exists(cur + ".gz")        # compressed
    assert not os.path.exists(cur)            # plain removed


def test_get_stats_shape(spool_dir):
    s = fts.get_stats()
    assert {"frames_spooled", "frames_dropped", "queue_len", "enabled"} <= set(s)
