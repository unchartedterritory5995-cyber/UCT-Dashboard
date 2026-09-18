"""R63(b) — `api.services.discord_render.cold_path_instrument`.

⛔ Every test pins the RECORD PATH to a tmp_path file via monkeypatch env — never the
`/data` default. A test that forgot this would write into the owner's live `C:\\data`
on this box, which is exactly the incident class `conftest.py`'s shared-root tripwire
exists to catch; these tests avoid it structurally rather than relying on the tripwire
to save them.
"""
import json
import threading

import pytest

from api.services.discord_render import cold_path_instrument as ci


@pytest.fixture(autouse=True)
def _record_path(tmp_path, monkeypatch):
    p = tmp_path / "cold-path-calls.jsonl"
    monkeypatch.setenv(ci.RECORD_PATH_ENV, str(p))
    ci._reset_for_tests()
    yield p


# ─────────────────────────────────────────────────────────────── basic recording

def test_a_successful_call_is_recorded_with_the_right_fields(_record_path):
    with ci.observe_cold_call("cap_universe.symbols"):
        pass
    lines = _record_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    rec = json.loads(lines[0])
    assert rec["name"] == "cap_universe.symbols"
    assert rec["ok"] is True
    assert "duration_ms" in rec and rec["duration_ms"] >= 0
    assert "at_start" in rec and "at_end" in rec


def test_a_raising_call_is_STILL_recorded_and_the_exception_still_propagates(_record_path):
    """⛔ A loader that fails slowly is exactly what R63(d) needs to see, maybe more than a
    successful one — recording must not be skipped on the exception path, and the caller's
    own exception must not be swallowed by the instrument wrapping it."""
    with pytest.raises(RuntimeError):
        with ci.observe_cold_call("bad"):
            raise RuntimeError("boom")
    lines = _record_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    rec = json.loads(lines[0])
    assert rec["ok"] is False


def test_is_loop_thread_is_true_on_the_main_thread():
    with ci.observe_cold_call("x"):
        pass
    lines = ci.record_path().read_text(encoding="utf-8").splitlines()
    assert json.loads(lines[0])["is_loop_thread"] is True


def test_is_loop_thread_is_false_on_a_background_thread():
    def _worker():
        with ci.observe_cold_call("x"):
            pass
    t = threading.Thread(target=_worker)
    t.start()
    t.join(timeout=2.0)
    lines = ci.record_path().read_text(encoding="utf-8").splitlines()
    assert json.loads(lines[0])["is_loop_thread"] is False


def test_the_record_is_bounded(monkeypatch, _record_path):
    monkeypatch.setattr(ci, "MAX_RECORDS", 5)
    for i in range(9):
        with ci.observe_cold_call("x%d" % i):
            pass
    lines = _record_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 5
    names = [json.loads(x)["name"] for x in lines]
    assert names == ["x4", "x5", "x6", "x7", "x8"], "the OLDEST records should be dropped first"


def test_an_append_failure_never_raises_into_the_wrapped_calls_own_result(monkeypatch):
    """⛔ Observability must never be what breaks the cold path it is watching."""
    def _boom(entry):
        raise OSError("disk full")
    monkeypatch.setattr(ci, "_append", _boom)
    with ci.observe_cold_call("x"):
        result = 42
    assert result == 42        # the wrapped block's own work is entirely unaffected


def test_snapshot_reports_recent_records_and_total_count(_record_path):
    for i in range(3):
        with ci.observe_cold_call("x%d" % i):
            pass
    snap = ci.snapshot()
    assert snap["total_recorded"] == 3
    assert len(snap["recent"]) == 3


def test_snapshot_on_a_file_that_does_not_exist_yet_reports_zero_not_an_error():
    snap = ci.snapshot()
    assert snap["total_recorded"] == 0
    assert snap["recent"] == []


# ───────────────────────────────────────────────────────────── the join, pure

def _call(name, start, end):
    return {"name": name, "at_start": start, "at_end": end, "duration_ms": 1.0,
            "thread": "t", "is_loop_thread": True, "ok": True}


def _stall(at, ms=3000.0):
    return {"at": at, "ms": ms, "uptime_s": 10.0, "tier": 1, "paged": True, "commit": "abc"}


def test_a_stall_inside_a_calls_window_is_joined_to_it():
    calls = [_call("flow_source", "2026-09-17T12:00:00Z", "2026-09-17T12:00:05Z")]
    stalls = [_stall("2026-09-17T12:00:02Z")]
    out = ci.join_with_stall_record(calls, stalls)
    assert len(out) == 1
    assert len(out[0]["joined_calls"]) == 1
    assert out[0]["joined_calls"][0]["name"] == "flow_source"


def test_a_stall_outside_every_calls_window_is_NOT_dropped_it_is_reported_UNJOINED():
    """⭐ THE FINDING ITSELF. A settled-pod stall with no cold-path cause is exactly what
    R63(d)'s acceptance needs to see and name — dropping it would look like clean evidence
    for the wrong reason (nothing to report, rather than nothing correlated)."""
    calls = [_call("flow_source", "2026-09-17T12:00:00Z", "2026-09-17T12:00:05Z")]
    stalls = [_stall("2026-09-17T15:00:00Z")]
    out = ci.join_with_stall_record(calls, stalls)
    assert len(out) == 1
    assert out[0]["joined_calls"] == []
    assert out[0]["at"] == "2026-09-17T15:00:00Z", "the unjoined stall itself must survive"


def test_every_stall_is_present_in_the_output_joined_or_not():
    calls = []
    stalls = [_stall("2026-09-17T12:00:00Z"), _stall("2026-09-17T13:00:00Z")]
    out = ci.join_with_stall_record(calls, stalls)
    assert len(out) == 2, "the join must never drop a stall, even with zero cold calls to join"


def test_pad_seconds_covers_boundary_rounding():
    calls = [_call("x", "2026-09-17T12:00:00Z", "2026-09-17T12:00:00Z")]  # 0-duration, rounds
    stall_just_before = _stall("2026-09-17T11:59:59Z")
    out = ci.join_with_stall_record(calls, [stall_just_before], pad_seconds=2.0)
    assert len(out[0]["joined_calls"]) == 1, "a 1s-before stall should join with a 2s pad"


def test_an_unparsable_stall_timestamp_is_reported_not_silently_skipped():
    out = ci.join_with_stall_record([], [{"at": "not-a-timestamp", "ms": 1}])
    assert len(out) == 1
    assert out[0]["joined_calls"] == []
    assert "join_error" in out[0]
