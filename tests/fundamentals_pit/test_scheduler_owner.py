"""The fundamentals V5 pipeline is OWNED BY THE WORKER, once, and never overlaps.

Measured 2026-09-25: the registration hook lived in api/main.py (the WEB pod, no
store) and the worker never ran it, so the scheduler ran nowhere. These rails pin
the corrected ownership and its single-instance guarantees."""
import pathlib
import re
import threading
import time

import pytest

from api.services.fundamentals_pit import schedule as SCH

ROOT = pathlib.Path(__file__).resolve().parents[2]


class FakeScheduler:
    def __init__(self):
        self.jobs, self.started = {}, False

    def add_job(self, fn, trigger, id, **kw):
        self.jobs[id] = fn

    def start(self):
        self.started = True

    def shutdown(self, wait=False):
        self.started = False


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    SCH._reset_for_tests()
    monkeypatch.delenv(SCH.FLAG, raising=False)
    root = tmp_path / "v5prod"
    (root / "live").mkdir(parents=True)
    (root / "live" / "live.db").write_bytes(b"")
    monkeypatch.setenv("FUNDAMENTALS_PIT_V5_ROOT", str(root))
    yield
    SCH._reset_for_tests()


def test_only_the_worker_entrypoint_starts_the_jobs():
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    worker = (ROOT / "api" / "worker_main.py").read_text(encoding="utf-8")
    code = lambda s: "\n".join(l for l in s.splitlines() if not l.lstrip().startswith("#"))
    assert "register_fundamentals_pit_jobs" not in code(main)
    assert "start_worker_scheduler" not in code(main)
    assert "start_worker_scheduler()" in code(worker)
    callers = [p for p in (ROOT / "api").rglob("*.py")
               if re.search(r"\b(start_worker_scheduler|register_fundamentals_pit_jobs)\(", code(p.read_text(encoding="utf-8")))
               and p.name != "schedule.py"]
    assert [p.relative_to(ROOT).as_posix() for p in callers] == ["api/worker_main.py"]


def test_dark_without_the_flag():
    made = []
    assert SCH.start_worker_scheduler(scheduler_factory=lambda: made.append(1) or FakeScheduler()) == []
    assert made == []


def test_dark_without_the_live_store(monkeypatch, tmp_path):
    monkeypatch.setenv(SCH.FLAG, "1")
    monkeypatch.setenv("FUNDAMENTALS_PIT_V5_ROOT", str(tmp_path / "absent"))
    assert SCH.start_worker_scheduler(scheduler_factory=FakeScheduler) == []


def test_the_legacy_v4_jobs_can_no_longer_be_scheduled():
    """jobs.tick / daily_beta / weekly_reconcile write the V4 store and overwrite V4 artifacts in place."""
    assert not hasattr(SCH, "register_fundamentals_pit_jobs")
    s = FakeScheduler()
    assert SCH.register_v5_jobs(s) == list(SCH.JOB_IDS)
    assert all(fn.__name__.startswith("fundamentals_v5_") for fn in s.jobs.values())


def test_starts_once_with_all_three_jobs(monkeypatch, tmp_path):
    monkeypatch.setenv(SCH.FLAG, "1")
    s = FakeScheduler()
    ids = SCH.start_worker_scheduler(scheduler_factory=lambda: s, lock_path=str(tmp_path / "lock"))
    assert ids == list(SCH.JOB_IDS) and s.started and sorted(s.jobs) == sorted(SCH.JOB_IDS)
    # a second start in the SAME process is a no-op, never a second scheduler
    made = []
    assert SCH.start_worker_scheduler(scheduler_factory=lambda: made.append(1) or FakeScheduler(),
                                      lock_path=str(tmp_path / "lock")) == list(SCH.JOB_IDS)
    assert made == []


def test_a_second_process_on_the_volume_starts_nothing(monkeypatch, tmp_path):
    """Another holder of the volume lock (a second replica / an overlapping deploy)."""
    monkeypatch.setenv(SCH.FLAG, "1")
    lock = str(tmp_path / "lock")
    other = SCH._try_lock(lock)                      # "the other process"
    assert other is not None
    try:
        made = []
        assert SCH.start_worker_scheduler(scheduler_factory=lambda: made.append(1) or FakeScheduler(),
                                          lock_path=lock) == []
        assert made == []
    finally:
        other.close()


def test_the_jobs_never_run_concurrently(monkeypatch, tmp_path):
    """cycle, daily and sweep must never overlap on the live store."""
    from api.services.fundamentals_pit import v5_pipeline as PL, v5_publish as PUB
    monkeypatch.setenv(SCH.FLAG, "1")
    active, overlap = [0], [False]

    def slow(*a, **k):
        active[0] += 1
        if active[0] > 1:
            overlap[0] = True
        time.sleep(0.05)
        active[0] -= 1

    monkeypatch.setattr(PL, "run_batch", lambda kind, **kw: slow() or {"state": "NO_CHANGE"})
    monkeypatch.setattr(PUB, "R2Target", lambda: object())
    s = FakeScheduler()
    SCH.register_v5_jobs(s)
    threads = [threading.Thread(target=s.jobs[i]) for i in SCH.JOB_IDS for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert overlap[0] is False
