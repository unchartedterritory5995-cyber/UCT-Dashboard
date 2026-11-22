"""Stall captures that survive a restart (api/event_loop_watchdog.py, 2026-11-16).

What must stay true:
  * a stall SHORTER than the probe interval is still captured when WATCHDOG_CAPTURE_MS is below
    it, and the miss accounting (the only input to the kill decision) does not change;
  * at the default threshold (3000 ms, above a short stall) nothing new happens;
  * each capture is also written compactly to WATCHDOG_CAPTURE_DIR and read back newest first,
    with the event loop's own thread named and in full;
  * WATCHDOG_CAPTURE_PERSIST=0 writes nothing; old day files go, other files stay;
  * none of it can raise into the watchdog.
"""
import asyncio
import json
import os
import threading
import time

import pytest

from api import event_loop_watchdog as w


@pytest.fixture(autouse=True)
def _clean(tmp_path, monkeypatch):
    monkeypatch.setenv("WATCHDOG_CAPTURE_DIR", str(tmp_path / "stalls"))
    for name in ("WATCHDOG_CAPTURE_MS", "WATCHDOG_CAPTURE_PERSIST", "WATCHDOG_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("WATCHDOG_OBSERVE", "1")   # measure, never kill
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    w._reset_for_tests()
    yield
    w._reset_for_tests()


@pytest.fixture
def running_loop():
    loop = asyncio.new_event_loop()
    ready = threading.Event()

    def _run():
        asyncio.set_event_loop(loop)
        loop.call_soon(ready.set)
        loop.run_forever()

    t = threading.Thread(target=_run, name="test-loop", daemon=True)
    t.start()
    ready.wait(timeout=5)
    try:
        yield loop
    finally:
        loop.call_soon_threadsafe(loop.stop)
        t.join(timeout=5)
        loop.close()


def _wait_for(pred, seconds=5.0):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(0.02)
    return False


def _stall_after_next_probe(loop, monkeypatch, hold_s):
    """Block the loop so that a probe is DEFINITELY queued behind the block for `hold_s`.

    The block waits (on the loop, blocking it) until the watchdog schedules its next probe, then
    holds a further `hold_s`. Without that handshake the probe's lag would depend on where in the
    probe cycle the block happened to start."""
    scheduled = threading.Event()
    original = loop.call_soon_threadsafe

    def spy(callback, *args, **kwargs):
        if callback is w._probe_ran:
            scheduled.set()
        return original(callback, *args, **kwargs)

    monkeypatch.setattr(loop, "call_soon_threadsafe", spy)

    async def stalled_on_purpose():
        scheduled.clear()
        scheduled.wait(timeout=5)
        time.sleep(hold_s)

    return asyncio.run_coroutine_threadsafe(stalled_on_purpose(), loop)


def test_a_stall_shorter_than_the_interval_is_captured_and_no_miss_is_counted(running_loop, monkeypatch):
    monkeypatch.setenv("WATCHDOG_CHECK_SEC", "1.0")
    monkeypatch.setenv("WATCHDOG_CAPTURE_MS", "100")
    decisions = []
    monkeypatch.setattr(w, "should_kill", lambda *a: decisions.append(a) or False)
    assert w.start_watchdog(loop=running_loop) is True
    assert _wait_for(lambda: w.get_status()["checks"] >= 1)

    _stall_after_next_probe(running_loop, monkeypatch, 0.4).result(timeout=10)
    assert _wait_for(lambda: len(w._stall_stacks) == 1)
    cap = w._stall_stacks[0]
    assert 100 <= cap["lag_ms"] < 1000
    loop_threads = [t for t in cap["threads"] if t["loop"]]
    assert len(loop_threads) == 1 and loop_threads[0]["name"] == "test-loop"
    assert "stalled_on_purpose" in loop_threads[0]["stack"]       # caught in the act
    assert cap["loop_thread_id"] == loop_threads[0]["thread_id"]
    assert decisions == []          # a 0.4 s stall inside a 1 s interval is not a miss: kill input unchanged


def test_at_the_default_threshold_a_short_stall_is_not_captured(running_loop, monkeypatch):
    monkeypatch.setenv("WATCHDOG_CHECK_SEC", "1.0")
    assert w.start_watchdog(loop=running_loop) is True
    assert _wait_for(lambda: w.get_status()["checks"] >= 1)
    _stall_after_next_probe(running_loop, monkeypatch, 0.4).result(timeout=10)
    time.sleep(0.3)
    assert w._stall_stacks == [] and w.stored_captures(1) == []


def test_the_capture_is_stored_compactly_and_read_back(running_loop, monkeypatch, tmp_path):
    monkeypatch.setenv("WATCHDOG_CHECK_SEC", "1.0")
    monkeypatch.setenv("WATCHDOG_CAPTURE_MS", "100")
    parked = threading.Event()
    idle = [threading.Thread(target=parked.wait, name="idle-%d" % i, daemon=True) for i in range(3)]
    for t in idle:
        t.start()
    try:
        assert w.start_watchdog(loop=running_loop) is True
        assert _wait_for(lambda: w.get_status()["checks"] >= 1)
        _stall_after_next_probe(running_loop, monkeypatch, 0.4).result(timeout=10)
        assert _wait_for(lambda: len(w.stored_captures(1)) == 1)
    finally:
        parked.set()
    rec = w.stored_captures(1)[0]
    assert rec["loop"]["name"] == "test-loop"
    assert any("stalled_on_purpose" in f for f in rec["loop"]["stack"])
    idle_rows = [g for g in rec["threads"] if any(n.startswith("idle-") for n in g["names"])]
    assert len(idle_rows) == 1 and idle_rows[0]["count"] == 3        # identical stacks are one row
    assert all(":" in f and " " in f for g in rec["threads"] for f in g["stack"])
    assert not any("event-loop-watchdog" in n for g in rec["threads"] for n in g["names"])
    files = os.listdir(tmp_path / "stalls")
    assert files == [time.strftime("%Y-%m-%d", time.gmtime(rec["at"])) + ".jsonl"]
    line = (tmp_path / "stalls" / files[0]).read_text(encoding="utf-8")
    assert line.count("\n") == 1 and len(line) < 60_000


def test_the_admin_read_adds_stored_captures_only_when_asked(monkeypatch):
    w.write_capture({"at": time.time(), "lag_ms": 1500.0, "pid": 1, "loop": {}, "threads": []})
    assert set(w.watchdog_stacks(stored_hours=0, _admin={})) == {"captures"}   # the old shape
    body = w.watchdog_stacks(stored_hours=2, _admin={})
    assert len(body["stored"]) == 1 and body["stored"][0]["lag_ms"] == 1500.0


def test_persist_off_writes_nothing_but_still_captures_in_memory(monkeypatch, tmp_path):
    monkeypatch.setenv("WATCHDOG_CAPTURE_PERSIST", "0")
    w._capture_stall_stacks(1234.0)
    time.sleep(0.3)
    assert len(w._stall_stacks) == 1
    assert not (tmp_path / "stalls").exists()
    monkeypatch.setenv("WATCHDOG_CAPTURE_PERSIST", "1")               # the control
    w._capture_stall_stacks(2345.0)
    assert _wait_for(lambda: len(w.stored_captures(1)) == 1)


def test_retention_drops_old_day_files_and_nothing_else(tmp_path):
    d = tmp_path / "stalls"
    d.mkdir()
    for name in ("2026-11-01.jsonl", "2026-11-15.jsonl", "notes.txt", "2026-11-01-extra.jsonl"):
        (d / name).write_text("x\n", encoding="utf-8")
    at = time.mktime((2026, 11, 16, 12, 0, 0, 0, 0, 0)) - time.timezone
    w.write_capture({"at": at, "lag_ms": 2000.0, "pid": 1, "loop": {}, "threads": []})
    assert sorted(os.listdir(d)) == ["2026-11-01-extra.jsonl", "2026-11-15.jsonl", "2026-11-16.jsonl", "notes.txt"]


def test_the_reader_skips_torn_lines_and_honours_the_window(tmp_path):
    now = time.time()
    d = tmp_path / "stalls"
    d.mkdir()
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    rows = [{"at": now - 7200, "lag_ms": 1.0}, {"at": now - 60, "lag_ms": 2.0}, {"at": now - 30, "lag_ms": 3.0}]
    text = "".join(json.dumps(r) + "\n" for r in rows) + '{"at": %f, "lag' % now
    (d / (day + ".jsonl")).write_text(text, encoding="utf-8")
    got = w.stored_captures(1, now=now)
    assert [r["lag_ms"] for r in got] == [3.0, 2.0]
    assert [r["lag_ms"] for r in w.stored_captures(1, limit=1, now=now)] == [3.0]


def test_nothing_raises_into_the_watchdog(monkeypatch, tmp_path):
    blocker = tmp_path / "a-file"
    blocker.write_text("not a directory", encoding="utf-8")
    monkeypatch.setenv("WATCHDOG_CAPTURE_DIR", str(blocker / "stalls"))
    w._capture_stall_stacks(1000.0)          # the writer fails on its own thread
    time.sleep(0.3)
    assert len(w._stall_stacks) == 1
    assert w.stored_captures(24) == []
