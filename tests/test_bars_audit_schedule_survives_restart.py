"""The hourly and daily bars sweeps carry on from the last COMPLETED run after a boot (2026-11-14).

Measured on production: `_loop` started both clocks at 0, so every boot ran the 5-minute check, the
hourly priority sweep AND the 24-hour universe sweep (3,640 tickers, 12.2 M bars read and checked
in Python on 4 threads) back to back. Six minutes after a release the whole web pod stalled for
~30 s (every web request 3-16 s). The run counter stood at 29,822.

What this file holds `_loop` to, driving ONE real pass of it against a temporary audit_runs table:
  * a sweep completed within its interval is not run again at boot;
  * a sweep that is due, never ran, or was killed midway (no finished_at) IS run, as before;
  * no table at all (a fresh volume) runs everything, as before;
  * the scope the loop reads is the scope the real sweep records (`audit_universe` writes it).
"""
import sqlite3
import time
import types

import pytest

from api.services import bars_audit
from api.services import bars_continuous_audit as bca


@pytest.fixture
def one_pass(tmp_path, monkeypatch):
    """`_loop` for one pass: the three checks record that they ran, the first sleep stops it."""
    db = str(tmp_path / "auth.db")
    monkeypatch.setattr(bars_audit, "_DB_PATH", db)
    monkeypatch.setattr(bars_audit, "_AUDIT_DIR", str(tmp_path / "audits"))
    ran = []
    monkeypatch.setattr(bca, "_run_5min_check", lambda: ran.append("5min"))
    monkeypatch.setattr(bca, "_run_priority_sweep", lambda: ran.append("priority"))
    monkeypatch.setattr(bca, "_run_universe_sweep", lambda: ran.append("universe"))
    # ⭐ 2026-11-25: replace the MODULE'S `time`, never `time.sleep` itself. `bca.time` IS the process-wide `time`
    # module, so patching its `sleep` stopped the loop whenever ANY thread slept during the pass (a leftover
    # background thread from another test): nothing ran at all, `[] == [...]` (merge-queue run 45527068948).
    monkeypatch.setattr(bca, "time", types.SimpleNamespace(time=time.time, sleep=lambda s: bca._running.clear()))

    def run():
        bca._running.set()
        bca._loop()
        return ran
    yield db, run
    bca._running.clear()


def _runs(db, *rows):
    bars_audit._init_audit_runs_table()
    with sqlite3.connect(db) as c:
        for scope, started_ago_s, finished in rows:
            started = int(time.time()) - started_ago_s
            c.execute("INSERT INTO audit_runs (started_at, finished_at, scope) VALUES (?, ?, ?)",
                      (started, started + 60 if finished else None, scope))


def test_a_fresh_volume_runs_all_three_as_before(one_pass):
    _db, run = one_pass
    assert run() == ["5min", "priority", "universe"]


def test_sweeps_completed_within_their_interval_are_not_run_again_at_boot(one_pass):
    db, run = one_pass
    _runs(db, (bca.PRIORITY_SCOPE, 10 * 60, True), (bca.UNIVERSE_SCOPE, 2 * 3600, True))
    assert run() == ["5min"]


def test_a_daily_sweep_older_than_a_day_is_run(one_pass):
    db, run = one_pass
    _runs(db, (bca.PRIORITY_SCOPE, 10 * 60, True), (bca.UNIVERSE_SCOPE, 25 * 3600, True))
    assert run() == ["5min", "universe"]


def test_an_hourly_sweep_older_than_an_hour_is_run(one_pass):
    db, run = one_pass
    _runs(db, (bca.PRIORITY_SCOPE, 2 * 3600, True), (bca.UNIVERSE_SCOPE, 2 * 3600, True))
    assert run() == ["5min", "priority"]


def test_a_sweep_a_release_killed_midway_still_counts_as_not_done(one_pass):
    db, run = one_pass
    _runs(db,
          (bca.PRIORITY_SCOPE, 10 * 60, True),
          (bca.UNIVERSE_SCOPE, 30 * 3600, True),     # the last COMPLETED one is a day and more old
          (bca.UNIVERSE_SCOPE, 15 * 60, False))      # this boot's predecessor started one and died
    assert run() == ["5min", "universe"]


def test_the_newest_completed_run_is_the_one_that_counts(one_pass):
    db, run = one_pass
    _runs(db,
          (bca.PRIORITY_SCOPE, 3 * 3600, True), (bca.PRIORITY_SCOPE, 10 * 60, True),
          (bca.UNIVERSE_SCOPE, 50 * 3600, True), (bca.UNIVERSE_SCOPE, 2 * 3600, True))
    assert run() == ["5min"]


def test_another_scopes_runs_do_not_count(one_pass):
    db, run = one_pass
    _runs(db, ("universe", 60, True), ("continuous-priority-x", 60, True))
    assert run() == ["5min", "priority", "universe"]


def test_an_unreadable_table_runs_all_three_as_before(one_pass, tmp_path, monkeypatch):
    _db, run = one_pass
    monkeypatch.setattr(bars_audit, "_DB_PATH", str(tmp_path / "no-such-dir" / "auth.db"))
    assert run() == ["5min", "priority", "universe"]


def test_the_scope_read_is_the_scope_the_real_sweep_records(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_audit, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bars_audit, "_AUDIT_DIR", str(tmp_path / "audits"))
    monkeypatch.setattr(bars_audit, "audit_ticker", lambda t, tfs, bcs: {"ticker": t, "bars_scanned": 1, "issues_found": 0, "issues": []})
    assert bca._last_completed(bca.UNIVERSE_SCOPE) == 0
    before = int(time.time())
    bars_audit.audit_universe(["AAA", "BBB"], scope=bca.UNIVERSE_SCOPE)
    assert bca._last_completed(bca.UNIVERSE_SCOPE) >= before
    assert bca._last_completed(bca.PRIORITY_SCOPE) == 0
    bars_audit.audit_universe(["AAA"], scope=bca.PRIORITY_SCOPE)
    assert bca._last_completed(bca.PRIORITY_SCOPE) >= before


def test_the_sweeps_record_themselves_under_the_scopes_the_loop_reads(monkeypatch):
    seen = []
    monkeypatch.setattr(bars_audit, "audit_universe", lambda tickers, scope=None, **k: seen.append(scope))
    from api import main as api_main
    monkeypatch.setattr(api_main, "_resolve_priority_tickers", lambda: ["AAA"])
    bca._run_priority_sweep()
    bca._run_universe_sweep()
    assert seen == [bca.PRIORITY_SCOPE, bca.UNIVERSE_SCOPE]


def test_another_threads_sleep_before_the_first_pass_does_not_stop_the_loop(one_pass, monkeypatch):
    """The flake, made deterministic: the real `time.sleep` is called (as another thread would) after the loop is
    armed and before its first check. Patching `bca.time.sleep` turned that into a stop, and nothing ran: `[]`."""
    db, run = one_pass
    _runs(db, (bca.PRIORITY_SCOPE, 2 * 3600, True), (bca.UNIVERSE_SCOPE, 2 * 3600, True))
    real_last = bca._last_completed
    monkeypatch.setattr(bca, "_last_completed", lambda scope: (time.sleep(0), real_last(scope))[1])
    assert run() == ["5min", "priority"]
