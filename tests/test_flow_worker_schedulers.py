"""flow-worker's scheduler must carry every flow.db-owning job at cutover:
gap-fill + backup (already there), PLUS the T+1 flat-files archive ingest and
the nightly expired-contract prune — both previously registered only in web's
scheduler, where they'd write to web's frozen copy post-flip."""
from unittest import mock


def _quiet_existing(monkeypatch):
    monkeypatch.setattr("api.flow_gap_autofill.startup_check", lambda: None)
    monkeypatch.setattr("api.flow_gap_autofill.register_jobs", lambda s: False)
    monkeypatch.setattr("api.flow_backup.register_jobs", lambda s: False)
    monkeypatch.setattr("api.flow_backup.startup_integrity_check",
                        lambda: {"ok": True})


def test_flow_worker_registers_flatfiles(monkeypatch):
    from api import flow_worker_main
    _quiet_existing(monkeypatch)
    calls = []
    monkeypatch.setattr("api.massive_flatfiles_worker.register_jobs",
                        lambda s: calls.append("flatfiles") or True,
                        raising=True)
    sched = flow_worker_main._start_flow_schedulers()
    assert "flatfiles" in calls
    if sched is not None and getattr(sched, "running", False):
        sched.shutdown(wait=False)


def test_flow_worker_registers_nightly_prune(monkeypatch):
    from api import flow_worker_main
    _quiet_existing(monkeypatch)
    monkeypatch.setattr("api.massive_flatfiles_worker.register_jobs",
                        lambda s: False, raising=True)
    sched = flow_worker_main._start_flow_schedulers()
    assert sched is not None
    assert sched.get_job("flow_nightly_prune") is not None
    if getattr(sched, "running", False):
        sched.shutdown(wait=False)
