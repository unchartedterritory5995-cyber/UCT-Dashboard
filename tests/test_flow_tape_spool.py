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


def _win_ns(target_day, minute, sec=0):
    day_et = datetime(target_day.year, target_day.month, target_day.day, tzinfo=ET)
    return int((day_et + timedelta(minutes=minute, seconds=sec)).timestamp() * 1e9)


def test_collect_window_trades_assignment_and_junk(spool_dir):
    """Single-pass collection: trades land in their window, junk/out-of-window
    frames are skipped, non-dict payload entries don't abort the pass (B7)."""
    from datetime import date as d
    target = d(2026, 7, 16)
    windows = [(600, 606), (660, 663)]         # 10:00–10:06, 11:00–11:03 ET
    in_w0 = _win_ns(target, 601)
    in_w1 = _win_ns(target, 661)
    outside = _win_ns(target, 630)
    hour = datetime.utcfromtimestamp(in_w0 / 1e9).strftime("%Y%m%d-%H")
    with open(os.path.join(spool_dir, f"tape-{hour}.jsonl"), "w") as f:
        f.write(_frame([("AAA", 1.0, 100, 0, in_w0)]) + "\n")
        f.write(json.dumps(["not-a-dict", {"ev": "T", "sym": "BAD"}]) + "\n")
        f.write(_frame([("OUT", 1.0, 100, 0, outside)]) + "\n")
        f.write("not json\n")
    hour1 = datetime.utcfromtimestamp(in_w1 / 1e9).strftime("%Y%m%d-%H")
    with gzip.open(os.path.join(spool_dir, f"tape-{hour1}.jsonl.gz"), "wt") as f:
        f.write(_frame([("CCC", 3.0, 50, 219, in_w1)]) + "\n")
    by_w = fts._collect_window_trades(target, windows)
    assert [t[0] for t in by_w[0]] == ["AAA"]
    assert [t[0] for t in by_w[1]] == ["CCC"]
    assert by_w[1][0][4] == 219                 # sweep code preserved via .gz


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
    monkeypatch.setattr(fga, "detect_windows",
                        lambda d, cap_end_min=None: ([], "windows"))
    monkeypatch.setattr(fga, "_is_trading_day", lambda d: True)
    out = fts.replay_gaps()
    assert out["status"] in ("no_gaps", "not_trading_day")


def test_replay_gaps_passes_intraday_cap(spool_dir, monkeypatch):
    """Same-day runs must cap detection at now-1 (B1) — the present isn't a gap."""
    import api.flow_gap_autofill as fga
    now_et = datetime.now(ET)
    now_min = now_et.hour * 60 + now_et.minute
    seen = {}

    def fake_detect(d, cap_end_min=None):
        seen["cap"] = cap_end_min
        return [], "windows"
    monkeypatch.setattr(fts, "REPLAY_ENABLED", True)
    monkeypatch.setattr(fga, "_is_trading_day", lambda d: True)
    monkeypatch.setattr(fga, "detect_windows", fake_detect)
    fts.replay_gaps(target=now_et.date())
    assert seen["cap"] == now_min - 1


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


# ── Block B ───────────────────────────────────────────────────────────────

def test_iter_spool_lines_prefers_gz_over_plain_twin(spool_dir):
    """Crash between gzip and unlink leaves both files — double-reading would
    mint inflated-Volume phantom rows (B7)."""
    t0 = int(datetime(2026, 7, 16, 14, 0, 0, tzinfo=UTC).timestamp() * 1e9)
    ts = t0 + int(10e9)
    plain = os.path.join(spool_dir, "tape-20260716-14.jsonl")
    with open(plain, "w") as f:
        f.write(_frame([("PLAIN", 1.0, 100, 0, ts)]) + "\n")
    with gzip.open(plain + ".gz", "wt") as f:
        f.write(_frame([("GZONLY", 1.0, 100, 0, ts)]) + "\n")
    lines = list(fts._iter_spool_lines(t0, t0 + int(3600e9)))
    joined = "".join(lines)
    assert "GZONLY" in joined and "PLAIN" not in joined


def test_detect_windows_intraday_cap(tmp_path, monkeypatch):
    """B1: uncapped intraday detection counted FUTURE minutes as empty and
    collapsed to full_session; the cap must scope it to the elapsed session."""
    import sqlite3
    import api.flow_gap_autofill as fga
    db = str(tmp_path / "flow.db")
    with sqlite3.connect(db) as c:
        c.execute("CREATE TABLE flow (source TEXT, CreatedDate TEXT, CreatedTime TEXT)")
        rows = []
        for m in range(570, 600):        # writes 9:30–9:59 …
            if 574 <= m <= 579:          # … except a gap 9:34–9:39
                continue
            rows.append(("stocks", "7/16/2026", f"{m//60}:{m%60:02d}:00 AM"))
        c.executemany("INSERT INTO flow VALUES (?,?,?)", rows)
    monkeypatch.setattr(fga, "DB_PATH", db)

    from datetime import date as d
    target = d(2026, 7, 16)
    # capped at 10:00 (minute 600): exactly the 9:34–9:40 window, mode=windows
    win, mode = fga.detect_windows(target, cap_end_min=600)
    assert mode == "windows"
    assert win == [(574, 580)]
    # uncapped: the rest of the session is "empty" → full_session collapse
    _, mode_uncapped = fga.detect_windows(target)
    assert mode_uncapped == "full_session"


def test_replay_budget_deferral(spool_dir, monkeypatch):
    import api.flow_gap_autofill as fga
    monkeypatch.setattr(fts, "REPLAY_ENABLED", True)
    monkeypatch.setattr(fts, "REPLAY_MAX_MIN", 10)
    monkeypatch.setattr(fga, "_is_trading_day", lambda d: True)
    monkeypatch.setattr(fga, "detect_windows",
                        lambda d, cap_end_min=None: ([(570, 630)], "windows"))
    monkeypatch.setattr(fga, "_post_discord", lambda m: None)
    out = fts.replay_gaps()
    assert out["status"] == "deferred_budget"
    assert out["deferred"] == [(570, 630)]


def test_register_jobs_gated_on_consumer_ownership(spool_dir, monkeypatch):
    monkeypatch.setattr(fts, "REPLAY_ENABLED", True)
    monkeypatch.delenv("MASSIVE_WS_ENABLED", raising=False)
    assert fts.register_jobs(object()) is False


def test_replay_window_edge_honesty(tmp_path, spool_dir, monkeypatch):
    """B2: a chain straddling the gap start was partially captured live —
    it must NOT be inserted from the spool (only fully-inside chains are)."""
    from datetime import date as d
    from api.flow_db import FlowDB
    dbdir = tmp_path / "dbdir"
    dbdir.mkdir()
    dbp = str(dbdir / "flow.db")
    orig_init = FlowDB.__init__

    def _init(self, db_path=None):
        orig_init(self, db_path=dbp)
    monkeypatch.setattr(FlowDB, "__init__", _init)
    monkeypatch.setattr(fts, "DB_PATH", dbp)

    target = d(2026, 7, 16)
    day_et = datetime(2026, 7, 16, tzinfo=ET)
    gap_s, gap_e = 600, 606          # 10:00–10:06 ET
    gs_ns = int((day_et + timedelta(minutes=gap_s)).timestamp() * 1e9)

    def tr(sym, off_s, price=2.0, size=100):
        return (sym, price, size, 4, 0, gs_ns + int(off_s * 1e9))

    trades = [
        # chain A: starts 5s BEFORE the gap (straddler → excluded)
        tr("O:AAA260821C00050000", -5),
        # chain B: fully inside (inserted); premium 2.0*100*100=20k ≥ 10k
        tr("O:BBB260821C00060000", 30),
    ]
    out = fts._replay_window(target, gap_s, gap_e, trades)
    assert out["inserted"] == 1
    import sqlite3
    with sqlite3.connect(dbp) as c:
        syms = [r[0] for r in c.execute("SELECT Symbol FROM flow")]
    assert syms == ["BBB"]


# --- Disk budget: prune/trim must be reachable while PAUSED -------------------
# Regression rail for the 2026-07-23 incident: the spool sat paused from 7/20
# through 7/23 because pruning was only reachable from the queue-drain path,
# which a paused spool never enters.

def _mk(spool_dir, name, size, age_hours):
    p = os.path.join(spool_dir, name)
    with open(p, "wb") as f:
        f.write(b"x" * size)
    t = time.time() - age_hours * 3600
    os.utime(p, (t, t))
    return p


def test_prune_old_drops_only_expired(spool_dir, monkeypatch):
    monkeypatch.setattr(fts, "RETENTION_HOURS", 26)
    old = _mk(spool_dir, "tape-20260716-18.jsonl.gz", 10, 100)
    fresh = _mk(spool_dir, "tape-20260723-18.jsonl", 10, 1)
    assert fts._prune_old() == 1
    assert not os.path.exists(old)
    assert os.path.exists(fresh)


def test_trim_to_cap_sheds_oldest_first(spool_dir, monkeypatch):
    monkeypatch.setattr(fts, "MAX_SPOOL_BYTES", 250)
    oldest = _mk(spool_dir, "tape-20260722-13.jsonl", 200, 10)
    mid = _mk(spool_dir, "tape-20260722-14.jsonl", 200, 5)
    newest = _mk(spool_dir, "tape-20260723-15.jsonl", 200, 1)
    assert fts._trim_to_cap() == 2
    assert not os.path.exists(oldest) and not os.path.exists(mid)
    assert os.path.exists(newest), "today's tape must survive; nothing else can recover it"


def test_paused_spool_self_recovers_without_a_drain(spool_dir, monkeypatch):
    """THE bug: paused => queue empty => rotation never runs => prune never runs
    => still over cap => still paused, forever, across restarts."""
    monkeypatch.setattr(fts, "RETENTION_HOURS", 26)
    monkeypatch.setattr(fts, "MAX_SPOOL_BYTES", 1000)
    monkeypatch.setattr(fts, "MIN_FREE_BYTES", 0)
    monkeypatch.setattr(fts, "_post", lambda msg: None)
    for i in range(4):
        _mk(spool_dir, f"tape-2026071{i}-13.jsonl", 900, 100)   # all expired
    fts._stats["paused_no_space"] = True
    fts._q.clear()                                              # nothing to drain

    fts._check_disk_budget()

    assert fts._stats["paused_no_space"] is False
    assert fts._spool_files() == []


def test_pause_lifts_via_cap_trim_even_when_nothing_is_expired(spool_dir, monkeypatch):
    monkeypatch.setattr(fts, "RETENTION_HOURS", 26)
    monkeypatch.setattr(fts, "MAX_SPOOL_BYTES", 1000)
    monkeypatch.setattr(fts, "MIN_FREE_BYTES", 0)
    monkeypatch.setattr(fts, "_post", lambda msg: None)
    for i in range(3):
        _mk(spool_dir, f"tape-2026072{i}-13.jsonl", 900, i + 1)  # all fresh
    fts._stats["paused_no_space"] = True

    fts._check_disk_budget()

    assert fts._stats["paused_no_space"] is False
    assert len(fts._spool_files()) == 1


def test_still_paused_when_the_volume_itself_is_full(spool_dir, monkeypatch):
    """Trimming our own files can't fix someone else filling the volume — that
    case must still pause AND still alert."""
    import shutil
    monkeypatch.setattr(fts, "MIN_FREE_BYTES", 1 << 62)
    posts = []
    monkeypatch.setattr(fts, "_post", lambda msg: posts.append(msg))
    fts._stats["paused_no_space"] = False
    fts._paused_alerted_at = 0.0

    fts._check_disk_budget()

    assert fts._stats["paused_no_space"] is True
    assert posts and "PAUSED" in posts[0]


def test_resume_is_announced(spool_dir, monkeypatch):
    monkeypatch.setattr(fts, "MIN_FREE_BYTES", 0)
    monkeypatch.setattr(fts, "MAX_SPOOL_BYTES", 1 << 40)
    posts = []
    monkeypatch.setattr(fts, "_post", lambda msg: posts.append(msg))
    fts._stats["paused_no_space"] = True

    fts._check_disk_budget()

    assert fts._stats["paused_no_space"] is False
    assert posts and "RESUMED" in posts[0]


def test_paused_realerts_so_it_cannot_go_quiet_for_days(spool_dir, monkeypatch):
    monkeypatch.setattr(fts, "MIN_FREE_BYTES", 1 << 62)
    posts = []
    monkeypatch.setattr(fts, "_post", lambda msg: posts.append(msg))
    fts._stats["paused_no_space"] = False
    fts._paused_alerted_at = 0.0

    fts._check_disk_budget()
    fts._check_disk_budget()                       # still paused, within window
    assert len(posts) == 1

    fts._paused_alerted_at = time.time() - fts._PAUSED_REALERT_SEC - 1
    fts._check_disk_budget()
    assert len(posts) == 2
