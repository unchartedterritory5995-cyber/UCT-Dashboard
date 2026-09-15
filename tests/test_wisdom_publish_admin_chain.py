"""Wisdom chains (stream S-F): step isolation, the failure contract, resume, order, slots.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a failing step stopping the steps after it, or a missing module stopping them.
2. a chain with a failed step reporting success (the watchdog would never page).
3. a catch-up re-run repeating work that already succeeded for the slot.
4. a dry run being counted as done work.
5. a broken module read as "not built yet" instead of as a failure.
6. the W1 Part 7 order, the CONTRACTS §5 slots or the due keys drifting.
"""
from __future__ import annotations

import importlib.machinery
import sys
import types
from datetime import datetime, timedelta

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import flags, store, timeutil
from api.services.wisdom.publish import chain, jobs

ET = timeutil.ET
NOW = datetime(2026, 9, 14, 18, 47, tzinfo=ET)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


@pytest.fixture
def pages(monkeypatch):
    sent: list = []
    from api.services import chart_health_alerts

    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, severity, message, metadata=None: sent.append((key, severity, message)) or True)
    return sent


def _ctx(run_id="run-1", due_key="2026-09-14", dry_run=False):
    return registry.JobContext(job_id="wisdom_daily_chain", now_et=NOW, due_key=due_key, force=True,
                               dry_run=dry_run, run_id=run_id)


def _fake_module(monkeypatch, name, **attrs):
    mod = types.ModuleType(name)
    mod.__spec__ = importlib.machinery.ModuleSpec(name, None)
    for key, value in attrs.items():
        setattr(mod, key, value)
    monkeypatch.setitem(sys.modules, name, mod)
    return mod


def _steps_with_a_failure_and_a_gap(monkeypatch, calls, fail=True):
    def first(ctx):
        calls.append("first")
        return {"rows": 3}

    def boom(ctx):
        calls.append("boom")
        if fail:
            raise RuntimeError("synthetic step failure")
        return {"ok": True}

    def last(ctx):
        calls.append("last")
        return {"written": 1}

    _fake_module(monkeypatch, "wisdom_fake_capture", run_all=first)
    _fake_module(monkeypatch, "wisdom_fake_extract", run_daily=boom)
    _fake_module(monkeypatch, "wisdom_fake_publish", run_daily=last)
    return (
        chain.Step("capture", "capture", (("wisdom_fake_capture", "run_all"),)),
        chain.Step("extract", "extract", (("wisdom_fake_extract", "run_daily"),)),
        chain.Step("evals", "evals", (("api.services.wisdom.no_such_pkg.evals", "run_daily"),)),
        chain.Step("adapters", "publish", (("wisdom_fake_publish", "run_daily"),)),
    )


# ── 1. isolation ─────────────────────────────────────────────────────────────

def test_a_failing_step_and_a_missing_step_never_stop_the_rest(db, monkeypatch):
    calls: list = []
    steps = _steps_with_a_failure_and_a_gap(monkeypatch, calls)
    out = chain.run_chain("daily", _ctx(), steps)
    assert calls == ["first", "boom", "last"]
    assert [(s["step"], s["status"]) for s in out["steps"]] == [
        ("capture", "ok"), ("extract", "failed"), ("evals", "not_available"), ("adapters", "ok")]
    by_step = {s["step"]: s for s in out["steps"]}
    assert "synthetic step failure" in by_step["extract"]["reason"]
    assert "api.services.wisdom.no_such_pkg.evals.run_daily" in by_step["evals"]["reason"]
    assert out["summary"] == {"ok": 2, "failed": 1, "not_available": 1, "skipped": 0}
    with store.read() as conn:
        rows = [(r["step"], r["status"]) for r in conn.execute(
            "SELECT step, status FROM wisdom_chain_steps WHERE chain_run_id = 'run-1' ORDER BY ordinal")]
    assert rows == [(s["step"], s["status"]) for s in out["steps"]]


def test_a_module_that_exists_but_will_not_import_is_a_failure_not_a_gap(db, monkeypatch, tmp_path):
    (tmp_path / "wisdom_broken_step_mod.py").write_text("raise RuntimeError('broken at import')\n", encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    sys.modules.pop("wisdom_broken_step_mod", None)
    steps = (chain.Step("evals", "evals", (("wisdom_broken_step_mod", "run_daily"),)),)
    (step,) = chain.run_chain("daily", _ctx(), steps)["steps"]
    assert step["status"] == "failed" and "broken at import" in step["reason"]


def test_a_module_present_without_the_function_is_named_as_not_built(db, monkeypatch):
    _fake_module(monkeypatch, "wisdom_fake_sources")
    steps = (chain.Step("sources", "sources", (("wisdom_fake_sources", "run_daily"),)),)
    (step,) = chain.run_chain("daily", _ctx(), steps)["steps"]
    assert step["status"] == "not_available"
    assert "wisdom_fake_sources.run_daily (module present, no run_daily)" in step["reason"]


def test_a_step_that_reports_skipped_or_failed_is_recorded_as_such(db, monkeypatch):
    _fake_module(monkeypatch, "wisdom_fake_x",
                 a=lambda ctx: {"status": "skipped", "reason": "WISDOM_EXTRACT_ENABLED is off"},
                 b=lambda ctx: {"skipped": "holiday"},
                 c=lambda ctx: {"status": "failed", "error": "budget cap reached"})
    steps = tuple(chain.Step(n, "extract", (("wisdom_fake_x", n),)) for n in ("a", "b", "c"))
    got = [(s["status"], s["reason"]) for s in chain.run_chain("daily", _ctx(), steps)["steps"]]
    assert got == [("skipped", "WISDOM_EXTRACT_ENABLED is off"), ("skipped", "holiday"),
                   ("failed", "budget cap reached")]


def test_a_step_gated_by_its_w1_flag_is_skipped_while_the_flag_is_off(db, monkeypatch):
    voice = next(s for s in chain.WEEKLY if s.name == "voice_profile")
    monkeypatch.delenv("WISDOM_VOICE_PROFILE_ENABLED", raising=False)
    (off,) = chain.run_chain("weekly", _ctx(), (voice,))["steps"]
    assert (off["status"], off["reason"]) == ("skipped", "WISDOM_VOICE_PROFILE_ENABLED is off")
    monkeypatch.setenv("WISDOM_VOICE_PROFILE_ENABLED", "1")  # control: with the flag on it is attempted
    (on,) = chain.run_chain("weekly", _ctx(run_id="run-2"), (voice,))["steps"]
    assert on["status"] in ("not_available", "ok", "failed") and on["status"] != "skipped"


# ── 2. the failure contract through the registry ────────────────────────────

def test_the_chain_job_fails_and_pages_only_after_every_step_ran(db, monkeypatch, pages):
    calls: list = []
    steps = _steps_with_a_failure_and_a_gap(monkeypatch, calls)
    monkeypatch.setitem(chain.STEPS, "daily", steps)
    daily = next(s for s in jobs.JOBS if s.job_id == "wisdom_daily_chain")
    monkeypatch.setattr(registry, "job_specs", lambda: [daily])
    out = registry.run_job("wisdom_daily_chain", force=True, now=NOW)
    assert out["status"] == "failed" and "extract" in out["error"]
    assert calls == ["first", "boom", "last"]
    assert [k for k, _, _ in pages] == ["wisdom_job_failed:wisdom_daily_chain"]
    # control: the same chain with nothing failing is an ok run and pages nothing
    monkeypatch.setitem(chain.STEPS, "daily", steps[:1] + steps[2:])
    with store.write() as conn:
        conn.execute("UPDATE wisdom_job_claims SET status = 'failed'")
    assert registry.run_job("wisdom_daily_chain", force=True, now=NOW)["status"] == "ok"
    assert len(pages) == 1


# ── 3-4. resume and dry runs ─────────────────────────────────────────────────

def test_a_rerun_for_the_same_slot_repeats_only_what_did_not_succeed(db, monkeypatch):
    calls: list = []
    steps = _steps_with_a_failure_and_a_gap(monkeypatch, calls)
    chain.run_chain("daily", _ctx(run_id="run-1"), steps)
    calls.clear()
    steps = _steps_with_a_failure_and_a_gap(monkeypatch, calls, fail=False)
    out = chain.run_chain("daily", _ctx(run_id="run-2"), steps)
    assert calls == ["boom"]
    statuses = {s["step"]: (s["status"], s["reason"]) for s in out["steps"]}
    assert statuses["capture"] == ("skipped", "already ok for 2026-09-14 in run run-1")
    assert statuses["extract"] == ("ok", None)
    # control: a different slot runs everything again
    calls.clear()
    chain.run_chain("daily", _ctx(run_id="run-3", due_key="2026-09-15"), steps)
    assert calls == ["first", "boom", "last"]


def test_a_dry_run_is_recorded_but_never_counts_as_done(db, monkeypatch):
    calls: list = []
    steps = _steps_with_a_failure_and_a_gap(monkeypatch, calls, fail=False)
    chain.run_chain("daily", _ctx(run_id="dry", dry_run=True), steps)
    chain.run_chain("daily", _ctx(run_id="real"), steps)
    assert calls == ["first", "boom", "last", "first", "boom", "last"]
    with store.read() as conn:
        flagged = {r["chain_run_id"]: r["d"] for r in conn.execute(
            "SELECT chain_run_id, MAX(dry_run) AS d FROM wisdom_chain_steps GROUP BY chain_run_id")}
    assert flagged == {"dry": 1, "real": 0}


def test_the_daily_chain_writes_one_observation_line_per_stream(db, monkeypatch):
    steps = _steps_with_a_failure_and_a_gap(monkeypatch, [])
    out = chain.run_chain("daily", _ctx(), steps)
    lines = {e["stream"]: e["line"] for e in out["observation_log"]}
    assert set(lines) == {"capture", "extract", "evals", "publish"}
    assert lines["capture"] == "capture=ok rows=3"
    assert lines["extract"].startswith("extract=failed (RuntimeError: synthetic step failure")
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_observation_log").fetchone()[0] == 4
        last = chain.last_runs(conn)
    assert last["daily"]["chain_run_id"] == "run-1" and last["weekly"] is None
    assert [s["step"] for s in last["daily"]["steps"]] == ["capture", "extract", "evals", "adapters"]


def test_the_contradictions_step_only_counts_on_a_dry_run(db):
    out = chain.contradictions_refresh(_ctx(dry_run=True))
    assert out == {"dry_run": True, "pairs": 0}
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue").fetchone()[0] == 0
    assert chain.contradictions_refresh(_ctx())["pairs"] == 0


# ── 6. order, slots, due keys ────────────────────────────────────────────────

def test_the_chains_follow_the_w1_part_7_order():
    # ⭐ `publication_floor` appended 2026-09-14 (Wave 1.5 item 3, owner ruling R10_ITEM3_ACTION:
    # A). It runs LAST on purpose: it reads what the adapters have just produced and enqueues the
    # PRINCIPLE/MARKET_SIGNAL records the floor held back, so the owner sees them. It publishes
    # nothing and is deliberately NOT flag-gated — a floor that can be switched off is not a floor.
    # ⭐ `reconcile_stability` appended 2026-09-15 (Wave 1.5 item 2, owner ruling R2). It runs
    # immediately BEFORE publication_floor and the order is load-bearing: the floor READS the
    # stability and stability_runs the reconciler writes, so reversing them would leave the floor
    # judging yesterday's scores and blocking every record on a NULL just filled in.
    # ⭐ `rq_v11_001` joined 2026-09-15 (RQ-v11-001, owner ruling R7) between the adapters and the
    # reconciler. The tail is three steps and every adjacency in it is load-bearing:
    #   rq_v11_001 before publication_floor  — the NULL question reaches the owner's queue as a
    #                                          question, before the floor acts on the record
    #   reconcile_stability before the floor — the floor READS the stability the reconciler WRITES
    assert [s.name for s in chain.DAILY] == ["capture", "sources", "stt_alias", "extract", "evals",
                                             "retrieval", "adapters", "level_alerts", "lookalike",
                                             "rq_v11_001", "reconcile_stability", "publication_floor"]
    assert [s.name for s in chain.WEEKLY] == ["sunday_scans", "reconcile_outcomes", "vocab_candidates",
                                              "contradictions", "voice_profile", "weekly_report", "extract_audit"]
    assert [s.name for s in chain.MONTHLY] == ["recognition_packet"]
    targets = {t for steps in chain.STEPS.values() for s in steps for t in s.targets}
    assert {("api.services.wisdom.publish.adapters", "run_daily"),
            ("api.services.wisdom.publish.retrieval", "refresh"),
            ("api.services.wisdom.publish.level_alerts", "score_silently"),
            ("api.services.wisdom.publish.lookalike", "score_silently"),
            ("api.services.wisdom.sources", "run_weekly_sunday_scans")} <= targets


def test_the_catalogue_names_what_is_not_built_on_this_base():
    cat = chain.catalogue()
    capture = next(r for r in cat["daily"] if r["step"] == "capture")
    contradictions = next(r for r in cat["weekly"] if r["step"] == "contradictions")
    stt = next(r for r in cat["daily"] if r["step"] == "stt_alias")
    assert contradictions["available"] is True  # control: this module's own step resolves
    assert capture["available"] in (True, False)
    if not capture["available"]:
        assert "run_all" in capture["note"]
    assert stt["available"] is None and "extract.run_daily" in stt["note"]


_AVOID_MINUTES = {0, 7, 11, 20, 23, 37, 41}


def test_the_publish_jobs_hold_their_contract_slots_switch_and_grace():
    specs = {s.job_id: s for s in jobs.JOBS}
    assert set(specs) == {"wisdom_daily_chain", "wisdom_weekly_chain", "wisdom_monthly_packet"}
    for spec in specs.values():
        assert spec.enabled is flags.ingest_enabled
        minute = spec.trigger["minute"]
        assert minute not in _AVOID_MINUTES and minute % 5 != 0
        assert not (0 <= spec.trigger["hour"] < 5)
    assert specs["wisdom_daily_chain"].trading_days_only is True
    assert (specs["wisdom_daily_chain"].catch_up_grace_s, specs["wisdom_weekly_chain"].catch_up_grace_s) == (
        4 * 3600, 24 * 3600)
    assert not specs["wisdom_weekly_chain"].trading_days_only


def test_each_slot_fires_at_its_eastern_minute(monkeypatch):
    specs = {s.job_id: s for s in jobs.JOBS}
    monkeypatch.setattr(registry, "job_specs", lambda: list(specs.values()))

    class _Sched:
        calls: list = []

        def add_job(self, fn, **kw):
            self.calls.append(kw)

    sched = _Sched()
    registry.register_jobs(sched)
    triggers = {kw["id"]: kw["trigger"] for kw in sched.calls}
    fire = lambda job, start: triggers[job].get_next_fire_time(None, start)  # noqa: E731
    assert fire("wisdom_daily_chain", datetime(2026, 9, 14, 12, 0, tzinfo=ET)) == datetime(
        2026, 9, 14, 18, 47, tzinfo=ET)
    assert fire("wisdom_weekly_chain", datetime(2026, 9, 14, 12, 0, tzinfo=ET)) == datetime(
        2026, 9, 20, 19, 52, tzinfo=ET)
    # the first Sunday of the month only: 2026-09-06 has passed, the next is 2026-10-04
    assert fire("wisdom_monthly_packet", datetime(2026, 9, 8, 12, 0, tzinfo=ET)) == datetime(
        2026, 10, 4, 20, 22, tzinfo=ET)


def test_the_due_keys_name_the_session_the_iso_week_and_the_month():
    assert jobs.session_key(datetime(2026, 9, 14, 18, 47, tzinfo=ET)) == "2026-09-14"
    assert jobs.session_key(datetime(2026, 9, 15, 8, 0, tzinfo=ET)) == "2026-09-14"  # pre-open belongs to yesterday
    assert jobs.iso_week_key(datetime(2026, 9, 20, 19, 52, tzinfo=ET)) == "2026-W38"
    assert jobs.iso_week_key(datetime(2026, 9, 20, 19, 52, tzinfo=ET) + timedelta(days=1)) == "2026-W39"
    assert jobs.month_key(datetime(2026, 10, 4, 20, 22, tzinfo=ET)) == "2026-10"
