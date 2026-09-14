"""The event-loop stall probe (step 2.4b P2.9; C-02).

`web` is one process with one event loop. When it blocks, Discord's 3-second acknowledgement and
the renderer's page load fail together — they co-occurred **37× more often than chance**, which is
the fact the whole V2 architecture is shaped around. And it was **completely unmeasured**:
`/api/health` returns 200 with a rising uptime straight through a blocked loop, and every alert rule
reads the durable jobs table, which cannot see a stall that happens before a job row exists.

The properties:
  * it measures the OVERSHOOT of a sleep, which is by definition time the loop could not come back;
  * it reports `max` and `p95` and deliberately not the mean — a loop blocked for four seconds once
    has failed a member completely, and a minute's average renders that as 40 ms;
  * `samples: 0` is a DISTINCT answer from a healthy loop, or a probe that never ran reads as fine.
"""
from __future__ import annotations

import asyncio

import pytest

from api.services.discord_render import loopwatch, observe


@pytest.fixture(autouse=True)
def _clean():
    loopwatch.stop()
    yield
    loopwatch.stop()


# ── the measurement ─────────────────────────────────────────────────────────

def test_the_overshoot_of_a_sleep_is_what_gets_recorded():
    """A fake clock, so the assertion is about the arithmetic and not about this machine's mood."""
    ticks = iter([100.0, 100.5,        # asked 0.5, took 0.5 -> 0 ms
                  101.0, 102.7])       # asked 0.5, took 1.7 -> 1200 ms
    w = loopwatch.LoopWatch(interval_s=0.5, clock=lambda: next(ticks),
                            sleep=lambda s: asyncio.sleep(0))
    asyncio.run(_two_readings(w))
    assert w.samples[0] == pytest.approx(0.0, abs=1e-6)
    assert w.samples[1] == pytest.approx(1200.0, abs=1e-6), "float subtraction, not a rounding rule"


async def _two_readings(w):
    task = asyncio.ensure_future(w._run())
    for _ in range(40):
        await asyncio.sleep(0)
        if len(w.samples) >= 2:
            break
    w._stop = True
    task.cancel()


def test_a_clock_that_runs_backwards_is_clamped_and_still_counted():
    """⛔ CLAMPED, NOT DISCARDED. Dropping the reading would quietly shrink the denominator, and the
    sample count is the only thing that tells an operator the probe was alive at all."""
    w = loopwatch.LoopWatch()
    w.record(-40.0)
    assert w.samples == [0.0] and w.snapshot()["samples"] == 1


def test_the_window_is_bounded():
    w = loopwatch.LoopWatch(window=10)
    for i in range(50):
        w.record(float(i))
    assert len(w.samples) == 10 and w.samples[-1] == 49.0


def test_the_snapshot_reports_the_worst_reading_not_the_average():
    """⛔ THE ONE THAT MATTERS. A loop fine 99% of the time and blocked for 4 s once has failed one
    member completely; a mean over the window renders that as healthy."""
    w = loopwatch.LoopWatch()
    for _ in range(99):
        w.record(1.0)
    w.record(4000.0)
    snap = w.snapshot()
    assert snap["max_ms"] == 4000.0
    assert snap["p95_ms"] == 1.0, "p95 is calm — which is exactly why max is reported beside it"
    assert snap["stalls"] == 1
    assert "mean" not in snap and "avg" not in snap


def test_a_probe_that_never_ran_is_not_reported_as_healthy():
    """⛔ `samples: 0` with `max_ms: None`. A cheerful `max_ms: 0` for a probe that is not running is
    the proxy-reading-zero defect — a health check answering a question next to the one asked."""
    snap = loopwatch.LoopWatch().snapshot()
    assert snap["samples"] == 0 and snap["max_ms"] is None and snap["running"] is False
    assert snap["stalls"] is None, "None, not 0: we did not look, rather than looked and saw none"


def test_the_kill_switch_defaults_on(monkeypatch):
    monkeypatch.delenv(loopwatch.ENV, raising=False)
    assert loopwatch.enabled() is True, "there is nothing to protect by leaving a measurement off"
    for off in ("0", "false", "OFF", " no "):
        monkeypatch.setenv(loopwatch.ENV, off)
        assert loopwatch.enabled() is False


def test_it_really_measures_a_real_blocked_loop():
    """⛔ THE END-TO-END ONE. Everything above is arithmetic on a fake clock; this blocks the actual
    loop with `time.sleep` — the shape of every defect C-02 describes — and asserts the probe sees
    it. Without this the module could be perfect and measuring nothing."""
    import time

    async def scenario():
        w = loopwatch.LoopWatch(interval_s=0.02).start()
        await asyncio.sleep(0.1)
        clean = w.snapshot()["max_ms"]
        time.sleep(0.4)                        # ⛔ SYNC sleep: the loop cannot run anything
        await asyncio.sleep(0.05)
        w.stop()
        return clean, w.snapshot()
    clean, snap = asyncio.run(scenario())
    assert clean is not None and clean < 200, f"the control: an idle loop was already stalling ({clean} ms)"
    assert snap["max_ms"] > 300, f"a 400 ms block was not seen (max {snap['max_ms']} ms)"
    assert snap["stalls"] >= 1


# ── the alert ───────────────────────────────────────────────────────────────

def test_a_stall_past_the_threshold_pages():
    key, msg = observe._loop_alerts({"samples": 120, "max_ms": 1400.0, "stalls": 3})[0]
    assert key == "loop_stalled"
    assert "1400" in msg and "3,000" in msg, "the message names the measurement and what it costs"


def test_a_quiet_loop_and_an_unrun_probe_both_page_nobody():
    assert observe._loop_alerts({"samples": 120, "max_ms": 12.0, "stalls": 0}) == []
    assert observe._loop_alerts({"samples": 0, "max_ms": None, "stalls": None}) == []
    assert observe._loop_alerts(None) == []
    assert observe._loop_alerts({}) == []


def test_the_threshold_is_a_fraction_of_the_discord_budget():
    assert observe.LOOP_STALL_ALERT_MS <= 1500, (
        "Discord closes an interaction at 3,000 ms; a threshold near that fires only once the "
        "member has already lost the reply")


def test_starting_it_off_the_loop_reports_not_running_rather_than_raising():
    """⛔ `commands.start` runs in `to_thread`, so a naive `ensure_future` there attaches to nothing.
    It must not raise into the lifespan (the whole V2 boot is wrapped in a non-fatal `except`, so a
    raise here would be swallowed and V2 would look healthy) and must not claim to be running."""
    w = loopwatch.LoopWatch().start()
    assert w.snapshot()["running"] is False and w._task is None


def test_the_lifespan_starts_it_on_the_loop_and_not_in_the_worker_thread():
    """⛔ THE WIRING RAIL, and it has to read WHERE the call is. `_render_v2.start` is dispatched
    with `to_thread`; a `loopwatch.start()` inside THAT function would measure nothing forever while
    every test here passed."""
    import ast
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert "_v2_loopwatch.start()" in src, "the lifespan never starts the probe"
    commands_src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "services" /
                    "discord_render" / "commands.py").read_text(encoding="utf-8")
    tree = ast.parse(commands_src)
    started_in_thread = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                         and isinstance(n.func, ast.Attribute) and n.func.attr == "start"
                         and isinstance(n.func.value, ast.Name) and n.func.value.id == "loopwatch"]
    assert not started_in_thread, (
        "commands.py starts the loop watch, but commands.start runs in to_thread — there is no "
        "running loop there and the probe would attach to nothing")


def test_the_health_payload_and_the_observer_both_carry_the_loop_reading(tmp_path):
    """⛔ THE WIRING RAIL, behavioural. The rule can be perfect and fed by nobody — which is how
    every other unwired module in this programme started."""
    from api.services.discord_render.jobs_store import JobsStore
    store = JobsStore(str(tmp_path / "jobs.db"))
    assert "loop" in observe.health_payload(None, store)["slo"]

    w = loopwatch.LoopWatch()
    for _ in range(10):
        w.record(4000.0)
    loopwatch._WATCH = w
    try:
        out = observe.Observer(store, renderer_fn=None, webhook_fn=lambda: "",
                               post_fn=lambda *a: True).run_once()
        assert "loop_stalled" in out["breached"], "the observer's loop does not read the probe"
        assert observe.health_payload(None, store)["slo"]["loop"]["max_ms"] == 4000.0
    finally:
        loopwatch._WATCH = None
