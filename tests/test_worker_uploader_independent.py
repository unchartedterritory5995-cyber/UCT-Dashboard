"""The daily full snapshot must never hold up the incremental deltas.

2026-11-09: the full base takes hours on a 40 GB bars.db, and the uploader ran
it in the same loop as the deltas. A master merge restarts the worker, so on a
busy day every base was killed before it finished and no delta shipped at all
for 29 hours.
"""
import datetime as dt
import threading
import time
from zoneinfo import ZoneInfo

import pytest

from api import worker_main
from api.services import data_sync


class Rig:
    def __init__(self, monkeypatch, marker="2000-01-01", delta_enabled=True):
        self.stopping = False
        self.release_base = threading.Event()
        self.base_entered = threading.Event()
        self.delta_shipped = threading.Event()
        self.base_calls = []
        self.delta_calls = 0
        self.markers = []
        self.base_result = "1794300000"
        monkeypatch.setattr(data_sync, "DELTA_ENABLED", delta_enabled)
        monkeypatch.setattr(data_sync, "credentials_ok", self.credentials_ok)
        monkeypatch.setattr(data_sync, "get_last_base_day", lambda: marker)
        monkeypatch.setattr(data_sync, "set_last_base_day", self.markers.append)
        monkeypatch.setattr(data_sync, "snapshot_interval_seconds", lambda: 0.001)
        monkeypatch.setattr(data_sync, "upload_snapshot", self.upload_snapshot)
        monkeypatch.setattr(data_sync, "upload_delta", self.upload_delta)
        monkeypatch.setattr(
            worker_main,
            "_uploader_state",
            {
                "last_attempt_at": None,
                "last_outcome": None,
                "base_started_at": None,
                "base_last_outcome": None,
            },
        )

    def credentials_ok(self):
        if self.stopping:
            raise SystemExit
        return True

    def upload_snapshot(self, force=False):
        self.base_calls.append(force)
        self.base_entered.set()
        assert self.release_base.wait(5)
        if self.stopping:
            raise SystemExit
        if isinstance(self.base_result, Exception):
            raise self.base_result
        return self.base_result

    def upload_delta(self):
        if self.stopping:
            raise SystemExit
        self.delta_calls += 1
        self.delta_shipped.set()
        return "1794300001"

    def stop(self):
        self.stopping = True
        self.release_base.set()


@pytest.fixture
def rig(monkeypatch):
    made = []

    def build(**kw):
        made.append(Rig(monkeypatch, **kw))
        return made[-1]

    yield build
    for r in made:
        r.stop()
    time.sleep(0.05)


def _wait_for(check, seconds=3):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if check():
            return True
        time.sleep(0.005)
    return False


def _et_today():
    return dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def test_deltas_ship_while_the_base_is_still_building(rig):
    r = rig()
    worker_main._start_uploader()
    assert r.base_entered.wait(3), "the due base never started"
    assert r.delta_shipped.wait(3), "a delta waited on the running base"
    assert not r.markers, "the base was marked shipped before it finished"
    assert _wait_for(lambda: r.delta_calls >= 3), "deltas stopped repeating"


def test_a_finished_base_is_marked_and_not_rebuilt_that_day(rig):
    r = rig()
    r.release_base.set()
    worker_main._start_uploader()
    assert _wait_for(lambda: r.markers == [_et_today()])
    seen = r.delta_calls
    assert _wait_for(lambda: r.delta_calls > seen + 3)
    assert r.base_calls == [True], "the base ran more than once in a day"


@pytest.mark.parametrize(
    "result", [None, data_sync.SNAPSHOT_UNCHANGED, RuntimeError("r2 down")]
)
def test_a_failed_base_retries_and_never_stops_deltas(rig, result):
    r = rig()
    r.base_result = result
    r.release_base.set()
    worker_main._start_uploader()
    assert _wait_for(lambda: len(r.base_calls) >= 3), "the base did not retry"
    assert r.delta_shipped.wait(3)
    assert not r.markers, "a base that did not ship was marked shipped"


def test_a_base_already_shipped_today_is_not_rebuilt(rig):
    r = rig(marker=_et_today())
    worker_main._start_uploader()
    assert _wait_for(lambda: r.delta_calls >= 3)
    assert not r.base_calls


def test_the_delta_outcome_is_not_overwritten_by_the_base(rig):
    r = rig()
    worker_main._start_uploader()
    assert r.base_entered.wait(3)
    assert _wait_for(lambda: worker_main._uploader_state["last_outcome"] == "delta")
    assert worker_main._uploader_state["base_started_at"] is not None
    r.release_base.set()
    assert _wait_for(lambda: worker_main._uploader_state["base_last_outcome"] == "base")
    assert worker_main._uploader_state["base_started_at"] is None
    assert worker_main._uploader_state["last_outcome"] == "delta"


def test_without_delta_mode_there_is_one_loop_and_no_forced_base(rig):
    r = rig(delta_enabled=False)
    r.release_base.set()
    worker_main._start_uploader()
    assert _wait_for(lambda: len(r.base_calls) >= 2)
    assert set(r.base_calls) == {False}
    assert r.delta_calls == 0


def _hold_deltas(monkeypatch, r, result="1794300001"):
    release = threading.Event()

    def held():
        if r.stopping:
            raise SystemExit
        r.delta_calls += 1
        r.delta_shipped.set()
        release.wait(5)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(data_sync, "upload_delta", held)
    return release


def test_the_base_waits_for_the_first_delta_of_the_boot(rig, monkeypatch):
    r = rig()
    release = _hold_deltas(monkeypatch, r)
    worker_main._start_uploader()
    assert r.delta_shipped.wait(3)
    assert not r.base_entered.wait(0.2), "the base started beside the first delta"
    release.set()
    assert r.base_entered.wait(3), "the base never started after the delta"


def test_a_failed_first_delta_still_lets_the_base_run(rig, monkeypatch):
    r = rig()
    release = _hold_deltas(monkeypatch, r, result=RuntimeError("r2 down"))
    release.set()
    worker_main._start_uploader()
    assert r.base_entered.wait(3), "a failed delta blocked the base"


def test_a_stuck_first_delta_cannot_block_the_base_forever(rig, monkeypatch):
    monkeypatch.setattr(worker_main, "BASE_WAITS_FOR_DELTA_SECONDS", 0.05)
    r = rig()
    release = _hold_deltas(monkeypatch, r)
    worker_main._start_uploader()
    assert r.base_entered.wait(3), "a stuck delta blocked the base"
    release.set()


def test_health_reports_the_running_base(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(
        worker_main,
        "_uploader_state",
        {
            "last_attempt_at": None,
            "last_outcome": None,
            "base_started_at": 1794300000,
            "base_last_outcome": "no_data",
        },
    )
    body = TestClient(worker_main._build_app()).get("/internal/health").json()
    assert body["base_upload_started_at"] == 1794300000
    assert body["base_upload_last_outcome"] == "no_data"
