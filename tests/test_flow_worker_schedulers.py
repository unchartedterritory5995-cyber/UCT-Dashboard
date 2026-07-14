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


def test_worker_mounts_massive_stream_router():
    """The instant-tape SSE route must resolve on flow-worker post-cutover —
    the proxy forwards /api/live/massive/stream here (flow.db + tailer live
    here now); an unmounted router means members silently lose live push."""
    from fastapi import FastAPI
    from api.worker_main import _mount_flow_routers
    app = FastAPI()
    _mount_flow_routers(app)
    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/live/massive/stream" in paths


def test_flow_worker_lifespan_starts_stream_tailer(monkeypatch):
    """The massive_stream tailer must start inside the LIFESPAN (running
    loop) — start() pre-uvicorn logs 'no running loop' and silently no-ops,
    leaving /api/live/massive/stream connected-but-empty (2026-07-13 bug)."""
    import asyncio
    import api.flow_worker_main as fwm
    calls = []
    monkeypatch.setattr("api.massive_stream.start",
                        lambda: calls.append("stream"), raising=True)

    async def _run():
        async with fwm._lifespan(None):
            pass

    asyncio.run(_run())
    assert "stream" in calls
