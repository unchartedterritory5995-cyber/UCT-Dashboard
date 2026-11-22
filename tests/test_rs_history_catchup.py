"""Rails for the UCT RS rating history's self-heal (api/main.py `_run_rs_history_catchup`,
`_rs_history_guarded`, `_check_rs_history_current`; api/services/screener/rs_history.py
`begin_attempt` / `finish_attempt` / `last_attempt`).

⚰️ The incident (2026-11-12, Railway logs): the 04:15 ET `rs_history_nightly` started,
was killed ~10 minutes in by a deploy that swapped the web container, left no receipt,
and was never re-run, so `rs_rating_history` sat a session behind all day.

`rs_history.nightly_job` is stubbed throughout (no bars store needed); the attempt
marker and the stored sessions are REAL rows in a per-test screener.db.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime

import pytest

import api.main as m
from api.services.screener import rs_history as rh
from api.services.screener import snapshot_db

TARGET = "2026-11-11"
OLDER = "2026-11-10"
OK_RECEIPT = {"ok": True, "session": TARGET, "targets": 100, "rated": 99, "rows": 99,
              "short_history": 1, "stale": 0, "no_bars": 0, "split_guard": 0,
              "duration_ms": 10.0, "note": {"source": "nightly"}}


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    monkeypatch.setattr(m, "_rs_history_target_session", lambda now=None: TARGET)
    from api.services import chart_health_alerts
    seen = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, sev, msg, meta=None: seen.append((key, sev, msg, meta)) or True)
    lists = []
    monkeypatch.setattr(m, "_run_rs_lists", lambda: lists.append(1))
    return {"alerts": seen, "lists": lists}


def _store(session):
    rh.store_rows(session, {"AAA": {"ibd": 50, "bars": 260}}, {})


def _stub(monkeypatch, receipt=OK_RECEIPT, raises=None, gate=None):
    calls = []

    def _nightly_job(*a, **k):
        calls.append((a, k))
        if gate is not None:
            gate["entered"].set()
            gate["release"].wait(5)
        if raises is not None:
            raise raises
        return dict(receipt)

    monkeypatch.setattr(rh, "nightly_job", _nightly_job)
    return calls


def _tables():
    with snapshot_db.connect() as c:
        return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}


# --------------------------------------------------------------------------- #
# run / skip
# --------------------------------------------------------------------------- #

def test_catchup_RUNS_for_the_target_session_when_the_store_is_behind(monkeypatch, env):
    _store(OLDER)
    calls = _stub(monkeypatch)
    m._run_rs_history_catchup("retry")
    assert calls == [((TARGET,), {})], "the catch-up must rate the session it is catching up to"
    assert env["lists"] == [1], "a catch-up that stored re-runs rs_lists (it refused while behind)"
    att = rh.last_attempt()
    assert att["source"] == "retry" and att["outcome"] == "ok" and att["finished_at"] is not None
    assert att["session"] == TARGET


def test_catchup_runs_on_an_EMPTY_store_too(monkeypatch):
    calls = _stub(monkeypatch)
    m._run_rs_history_catchup("boot")
    assert len(calls) == 1


def test_catchup_SKIPS_when_the_store_is_current(monkeypatch, env):
    _store(TARGET)
    calls = _stub(monkeypatch)
    m._run_rs_history_catchup("retry")
    assert calls == [] and env["lists"] == []
    assert rh.ATTEMPTS_TABLE not in _tables(), "a current store must cost one read, no write"


def test_catchup_SKIPS_when_disabled_and_touches_nothing(monkeypatch, env):
    monkeypatch.delenv("RS_HISTORY_ENABLED")
    calls = _stub(monkeypatch)
    m._run_rs_history_catchup("boot")
    assert calls == [] and env["lists"] == [] and env["alerts"] == []
    assert _tables() == set(), "a dark pod carries no rating tables"


def test_a_catchup_that_did_not_store_does_not_rerun_the_lists_and_alerts(monkeypatch, env):
    _stub(monkeypatch, receipt={**OK_RECEIPT, "ok": False, "rated": 0, "note": {"error": "x"}})
    m._run_rs_history_catchup("retry")
    assert env["lists"] == []
    assert [a[0] for a in env["alerts"]] == [f"rs_history_short:{TARGET}"]
    assert rh.last_attempt()["outcome"] == "not_stored"


def test_a_crashing_run_closes_its_attempt_releases_the_lock_and_never_raises(monkeypatch, env):
    _stub(monkeypatch, raises=RuntimeError("boom"))
    assert m._run_rs_history_catchup("retry") is None
    att = rh.last_attempt()
    assert att["outcome"] == "crashed" and att["finished_at"] is not None
    assert not m._RS_HISTORY_RUN_LOCK.locked()
    assert any(k.startswith("rs_history_short:") for k, *_ in env["alerts"])
    calls = _stub(monkeypatch)
    m._run_rs_history_catchup("retry")
    assert len(calls) == 1, "a crash must not leave a guard that blocks the next run"


# --------------------------------------------------------------------------- #
# never two at once
# --------------------------------------------------------------------------- #

def test_the_PROCESS_lock_skips_a_second_run(monkeypatch):
    calls = _stub(monkeypatch)
    assert m._RS_HISTORY_RUN_LOCK.acquire(blocking=False)
    try:
        m._run_rs_history_catchup("retry")
        m._run_rs_history()
    finally:
        m._RS_HISTORY_RUN_LOCK.release()
    assert calls == []


def test_the_0415_job_and_a_catchup_never_run_concurrently(monkeypatch):
    """A real overlap: the catch-up is INSIDE nightly_job on a thread when the 04:15
    job fires. Exactly one call reaches the job."""
    gate = {"entered": threading.Event(), "release": threading.Event()}
    calls = _stub(monkeypatch, gate=gate)
    t = threading.Thread(target=m._run_rs_history_catchup, args=("boot",))
    t.start()
    assert gate["entered"].wait(5)
    m._run_rs_history()
    gate["release"].set()
    t.join(5)
    assert len(calls) == 1


def test_a_FRESH_unfinished_attempt_from_another_process_blocks_the_run(monkeypatch):
    calls = _stub(monkeypatch)
    held = rh.begin_attempt("nightly", now=time.time() - 60)
    assert held["claimed"] and held["id"]
    m._run_rs_history_catchup("retry")
    m._run_rs_history()
    assert calls == []
    assert rh.begin_attempt("x")["claimed"] is False


def test_a_STALE_unfinished_attempt_a_killed_run_left_is_ignored(monkeypatch):
    calls = _stub(monkeypatch)
    dead = rh.begin_attempt("nightly", now=time.time() - rh.RUNNING_STALE_S - 1)
    assert dead["claimed"]
    assert rh.last_attempt()["stale"] is True
    m._run_rs_history_catchup("retry")
    assert len(calls) == 1, "a killed run's marker must stop counting after RUNNING_STALE_S"


def test_a_killed_run_is_VISIBLE_as_started_with_no_finish_in_status():
    rh.begin_attempt("nightly")                        # ... and the container dies here
    st = rh.status()["last_attempt"]
    assert st["source"] == "nightly" and st["started_at"] and st["finished_at"] is None
    assert st["stale"] is False


def test_the_0415_job_writes_a_started_row_and_closes_it(monkeypatch):
    calls = _stub(monkeypatch)
    m._run_rs_history()
    assert calls == [((), {})], "the 04:15 path still calls nightly_job with the module's defaults"
    att = rh.last_attempt()
    assert att["source"] == "nightly" and att["outcome"] == "ok" and att["session"] == TARGET


def test_attempt_rows_are_trimmed():
    for _ in range(rh.ATTEMPTS_KEEP + 5):
        a = rh.begin_attempt("x")
        rh.finish_attempt(a["id"], "ok")
    with snapshot_db.connect() as c:
        n = c.execute(f"SELECT COUNT(*) FROM {rh.ATTEMPTS_TABLE}").fetchone()[0]
    assert n == rh.ATTEMPTS_KEEP


# --------------------------------------------------------------------------- #
# the target session
# --------------------------------------------------------------------------- #

def test_the_target_is_the_session_BEFORE_the_settled_one_until_0415_ET(monkeypatch):
    monkeypatch.undo()                                 # the real resolver
    et = m._ET
    # Thu 2026-11-12: settled = Wed 11-11; before 04:15 the store should hold Tue 11-10.
    assert m._rs_history_target_session(datetime(2026, 11, 12, 4, 0, tzinfo=et)) == "2026-11-10"
    assert m._rs_history_target_session(datetime(2026, 11, 12, 4, 15, tzinfo=et)) == "2026-11-11"
    assert m._rs_history_target_session(datetime(2026, 11, 12, 13, 0, tzinfo=et)) == "2026-11-11"
    # Saturday before 04:15: Thursday's session; after: Friday's (the cron fires daily,
    # so Saturday's 04:15 run rates Friday and Monday before 04:15 still expects Friday).
    assert m._rs_history_target_session(datetime(2026, 11, 14, 3, 0, tzinfo=et)) == "2026-11-12"
    assert m._rs_history_target_session(datetime(2026, 11, 14, 6, 0, tzinfo=et)) == "2026-11-13"
    assert m._rs_history_target_session(datetime(2026, 11, 16, 3, 0, tzinfo=et)) == "2026-11-13"


# --------------------------------------------------------------------------- #
# registration
# --------------------------------------------------------------------------- #

class _FakeSched:
    def __init__(self):
        self.jobs = {}

    def add_job(self, fn, **k):
        self.jobs[k.get("id")] = (fn, k)


def _register(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is True
    return sched


def _cron(trigger, name):
    return next(str(f) for f in trigger.fields if f.name == name)


def test_the_boot_catchup_is_SCHEDULED_never_run_inline(monkeypatch):
    calls = _stub(monkeypatch)                          # store empty: it WOULD run if called
    before = datetime.now(m._ET)
    sched = _register(monkeypatch)
    assert calls == [], "registration ran the catch-up inline and slowed the boot"
    fn, kw = sched.jobs["rs_history_catchup_boot"]
    assert fn is m._run_rs_history_catchup and kw["kwargs"] == {"source": "boot"}
    assert kw["trigger"] == "date"
    delay = (kw["run_date"] - before).total_seconds()
    assert m.RS_HISTORY_BOOT_CATCHUP_DELAY_S - 5 <= delay <= m.RS_HISTORY_BOOT_CATCHUP_DELAY_S + 5
    assert kw["max_instances"] == 1 and kw["misfire_grace_time"] >= 60


def test_the_retry_crons_are_registered_0515_to_0815_ET(monkeypatch):
    sched = _register(monkeypatch)
    fn, kw = sched.jobs["rs_history_catchup"]
    assert fn is m._run_rs_history_catchup and kw["kwargs"] == {"source": "retry"}
    assert _cron(kw["trigger"], "hour") == "5-8" and _cron(kw["trigger"], "minute") == "15"
    assert str(kw["trigger"].timezone) == "America/New_York"
    assert kw["max_instances"] == 1 and kw["coalesce"] is True
    wfn, wkw = sched.jobs["rs_history_stale_watchdog"]
    assert wfn is m._check_rs_history_current
    assert _cron(wkw["trigger"], "hour") == "9" and _cron(wkw["trigger"], "minute") == "5"


def test_the_catchup_registrations_are_UNCONDITIONAL__BY_AST():
    """Same probe as `_add_job_gate_depth` in tests/test_scan_live_sweep.py, with its
    control: the flag-gated scan sweep comes back gated."""
    from tests.test_scan_live_sweep import _add_job_gate_depth
    depth = _add_job_gate_depth()
    for jid in ("rs_history_nightly", "rs_history_catchup_boot", "rs_history_catchup",
                "rs_history_stale_watchdog"):
        assert depth.get(jid) == 0, jid
    assert depth.get("screener_scan_sweep", 0) >= 1


# --------------------------------------------------------------------------- #
# the 09:05 stale alert
# --------------------------------------------------------------------------- #

def test_the_watchdog_alerts_a_store_still_behind_and_names_the_killed_attempt(env):
    _store(OLDER)
    rh.begin_attempt("nightly", now=time.time() - rh.RUNNING_STALE_S - 1)   # killed
    m._check_rs_history_current()
    assert len(env["alerts"]) == 1
    key, sev, msg, meta = env["alerts"][0]
    assert key == f"rs_history_stale:{TARGET}" and sev == "warning"
    assert OLDER in msg and TARGET in msg and "did not store" in msg
    assert meta["last_attempt"]["finished_at"] is None and meta["last_attempt"]["stale"] is True


def test_the_watchdog_is_silent_when_current_or_disabled(monkeypatch, env):
    _store(TARGET)
    m._check_rs_history_current()
    assert env["alerts"] == []
    _store(OLDER)
    with snapshot_db.connect() as c:
        c.execute(f"DELETE FROM {rh.TABLE} WHERE session = ?", (TARGET,))
        c.commit()
    monkeypatch.delenv("RS_HISTORY_ENABLED")
    m._check_rs_history_current()
    assert env["alerts"] == []
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")       # control: the same state alerts armed
    m._check_rs_history_current()
    assert len(env["alerts"]) == 1
