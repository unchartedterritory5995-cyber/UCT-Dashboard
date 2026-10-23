"""The nightly backup jobs must tolerate a busy executor at fire time.

APScheduler's default misfire_grace_time is 1 second: if the thread pool is busy at
02:30/02:45/03:05 ET the run is dropped with no error and that night has no backup.
Each nightly backup registers with a one-hour grace and coalescing (2026-10-22).
"""
from __future__ import annotations


class _FakeScheduler:
    def __init__(self):
        self.jobs = {}

    def add_job(self, func, trigger=None, **kw):
        self.jobs[kw.get("id")] = kw


def _assert_grace(kw):
    assert kw.get("misfire_grace_time") == 3600
    assert kw.get("coalesce") is True
    assert kw.get("max_instances") == 1


def test_flow_db_backup_has_grace(monkeypatch):
    from api import flow_backup
    monkeypatch.setattr(flow_backup, "ENABLED", True)
    s = _FakeScheduler()
    assert flow_backup.register_jobs(s)
    _assert_grace(s.jobs["flow_db_backup"])


def test_j2_attachments_backup_has_grace(monkeypatch):
    from api import j2_attachments_backup
    monkeypatch.setattr(j2_attachments_backup, "_enabled", lambda: True)
    s = _FakeScheduler()
    assert j2_attachments_backup.register_jobs(s)
    _assert_grace(s.jobs["j2_attachments_backup"])


def test_store_backup_nightly_has_grace(monkeypatch):
    from api.services import store_backup
    monkeypatch.setattr(store_backup, "is_enabled", lambda: True)
    s = _FakeScheduler()
    assert store_backup.register_jobs(s)
    _assert_grace(s.jobs["store_backup_nightly"])
