"""Wisdom capture (S-A, D12) — the jobs are the §5 slots, exactly.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a capture slot moved, added or dropped relative to docs/wisdom/CONTRACTS.md §5;
2. a capture job killed by anything other than flags.capture_enabled, or a slot
   without its durable due_key or its 6 h catch-up grace;
3. a capture minute on the repo's avoid list, or a slot inside the 00:40–05:00 ET
   heavy window other than the pre-prune detections read;
4. a session-shaped slot that runs on a non-trading day, or a kill switch that does
   not stop a slot;
5. a dataset no slot captures, or a slot that captures nothing.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services.wisdom import registry
from api.services.wisdom.capture import families
from api.services.wisdom.capture import jobs as capture_jobs
from api.services.wisdom.capture.families._base import result, safe_reader
from api.services.wisdom.core import flags, store, timeutil

ET = timeutil.ET

# Transcribed from docs/wisdom/CONTRACTS.md §5 — the one place this file is allowed to restate it.
CONTRACT_SLOTS = {
    "wisdom_capture_detections": ({"kind": "cron", "hour": 0, "minute": 17}, False, capture_jobs.date_key),
    "wisdom_capture_morning": ({"kind": "cron", "hour": 5, "minute": 43}, False, capture_jobs.date_key),
    "wisdom_capture_themes": ({"kind": "cron", "hour": 6, "minute": 13}, False, capture_jobs.date_key),
    "wisdom_capture_tweets": ({"kind": "cron", "minute": 29}, False, capture_jobs.hour_key),
    "wisdom_capture_eod": ({"kind": "cron", "day_of_week": "mon-fri", "hour": 16, "minute": 52}, True,
                           capture_jobs.session_key),
    "wisdom_capture_late": ({"kind": "cron", "day_of_week": "mon-fri", "hour": 17, "minute": 34}, True,
                            capture_jobs.session_key),
}
AVOID_MINUTES = {0, 7, 11, 20, 23, 37, 41}


def test_capture_jobs_are_exactly_the_contract_slots():
    specs = {s.job_id: s for s in capture_jobs.JOBS}
    assert set(specs) == set(CONTRACT_SLOTS)
    for job_id, (trigger, trading_only, key_fn) in CONTRACT_SLOTS.items():
        spec = specs[job_id]
        assert spec.trigger == trigger, job_id
        assert spec.trading_days_only is trading_only, job_id
        assert spec.due_key is key_fn, job_id
        assert spec.enabled is flags.capture_enabled, job_id
        assert spec.catch_up_grace_s == 6 * 3600, job_id
        assert spec.expected_every_s == (3600 if job_id == "wisdom_capture_tweets" else 86400), job_id
    registered = {s.job_id for s in registry.job_specs()}
    assert set(CONTRACT_SLOTS) <= registered, "the registry does not discover the capture slots"


def test_no_capture_minute_is_on_the_avoid_list_or_in_the_heavy_window():
    for spec in capture_jobs.JOBS:
        minute = spec.trigger["minute"]
        assert minute not in AVOID_MINUTES and minute % 5 != 0, spec.job_id
        hour = spec.trigger.get("hour")
        if hour is not None and (hour, minute) >= (0, 40) and (hour, minute) < (5, 0):
            pytest.fail(f"{spec.job_id} sits in the 00:40-05:00 ET heavy window")
    detections = next(s for s in capture_jobs.JOBS if s.job_id == families.JOB_DETECTIONS)
    assert (detections.trigger["hour"], detections.trigger["minute"]) < (0, 40), "must run before patterns_prune"


def test_due_keys_have_the_contract_granularity():
    at = dt.datetime(2026, 9, 14, 16, 52, tzinfo=ET)
    assert capture_jobs.date_key(at) == "2026-09-14"
    assert capture_jobs.session_key(at) == "2026-09-14"
    assert capture_jobs.hour_key(at) == "2026-09-14T16"
    assert capture_jobs.hour_key(dt.datetime(2026, 9, 14, 20, 29, tzinfo=dt.timezone.utc)) == "2026-09-14T16"


def test_every_dataset_belongs_to_a_slot_and_every_slot_captures_something():
    assert set(families.job_ids()) == set(CONTRACT_SLOTS)
    for job_id in CONTRACT_SLOTS:
        assert families.for_job(job_id), job_id
    assert len({ds.name for ds in families.DATASETS}) == len(families.DATASETS)


class _FakeScheduler:
    def __init__(self):
        self.calls: list = []

    def add_job(self, fn, **kwargs):
        self.calls.append(kwargs)


def test_the_session_slots_fire_on_the_next_weekday_close_in_eastern_time(monkeypatch):
    monkeypatch.setattr(registry, "job_specs", lambda: list(capture_jobs.JOBS))
    sched = _FakeScheduler()
    registry.register_jobs(sched)
    triggers = {kw["id"]: kw["trigger"] for kw in sched.calls}
    saturday = dt.datetime(2026, 9, 12, 12, 0, tzinfo=ET)
    eod = triggers[families.JOB_EOD].get_next_fire_time(None, saturday)
    assert (eod.date(), eod.hour, eod.minute, str(eod.tzinfo)) == (dt.date(2026, 9, 14), 16, 52, "America/New_York")
    tweets = triggers[families.JOB_TWEETS].get_next_fire_time(None, saturday)
    assert (tweets.hour, tweets.minute) == (12, 29)


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


def _stub_slot(monkeypatch, calls):
    @safe_reader("rs", "test")
    def read(**_):
        calls.append(1)
        return result("rs", as_of="2026-09-14", source="test", rows=1, payload={"A": 1})

    ds = families.Dataset(name="rs", family="rs", job_id=families.JOB_EOD, cadence="t", as_of_rule="t", read=read)
    monkeypatch.setattr(families, "DATASETS", (ds,))
    monkeypatch.setattr(families, "_BY_NAME", {"rs": ds})
    monkeypatch.setattr("api.services.wisdom.capture.archive.put_versioned",
                        lambda key_for, data, dry_run=False, putter=None: {
                            "key": key_for(None), "sha256": "x", "bytes": len(data), "created": True})


def test_the_capture_kill_switch_stops_a_slot_and_its_control_runs_it(wisdom_db, monkeypatch):
    calls: list = []
    _stub_slot(monkeypatch, calls)
    monday = dt.datetime(2026, 9, 14, 16, 52, tzinfo=ET)
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    monkeypatch.delenv("WISDOM_CAPTURE_ENABLED", raising=False)
    off = registry.run_job(families.JOB_EOD, now=monday)
    assert off["status"] == "skipped" and "kill switch" in off["reason"] and calls == []
    monkeypatch.setenv("WISDOM_CAPTURE_ENABLED", "1")
    on = registry.run_job(families.JOB_EOD, now=monday)
    assert on["status"] == "ok" and calls == [1]


def test_a_session_slot_does_not_run_on_a_weekend(wisdom_db, monkeypatch):
    calls: list = []
    _stub_slot(monkeypatch, calls)
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    monkeypatch.setenv("WISDOM_CAPTURE_ENABLED", "1")
    out = registry.run_job(families.JOB_EOD, now=dt.datetime(2026, 9, 12, 16, 52, tzinfo=ET))
    assert out["status"] == "skipped" and out["reason"] == "not a trading day" and calls == []
