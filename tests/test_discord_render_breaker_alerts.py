"""A tripped breaker reaches #render-alerts, once per dependency (step 2.4b P2.4, 03 §3.9).

A breaker opening is the clearest possible statement that an upstream is down: five consecutive
failures, or half of a twenty-call window. It is also, until now, **completely invisible** — the
breakers were built in 2.4b part 1 with no production caller at all, and even wired, an open
breaker only showed as faster failures.

The properties:
  * one alert KEY per dependency, so a flow outage and a renderer outage throttle separately;
  * `half_open` is NOT an alert — it is the system recovering, and paging on recovery is how a
    channel gets muted;
  * the message says it will repeat while the breaker stays open, because there is deliberately no
    "recovered" push (see the docstring on the rule).
"""
from __future__ import annotations

import pytest

from api.services.discord_render import breakers, observe


@pytest.fixture(autouse=True)
def _clean():
    breakers.reset_all_for_tests()
    yield
    breakers.reset_all_for_tests()


def _snapshot():
    """A healthy SLO snapshot, so nothing else in `evaluate_alerts` fires and the only thing under
    test is the breaker rule (`lesson_a_guard_that_tests_the_adjacent_thing`)."""
    empty = {"jobs": 0, "terminal": 0, "user_errors": 0, "success_rate": None,
             "final_ms": {"p50": None, "p95": None, "p99": None},
             "ack_ms": {"p50": None, "p95": None, "p99": None, "over_3s": 0},
             "failures_by_class": {}}
    return {"windows": {k: {"all": dict(empty)} for k in observe.ALERT_WINDOWS}, "stuck": 0}


def _open(name: str):
    b = breakers.breaker(name)
    for _ in range(40):
        if b.allow():
            b.record_failure()
    assert b.state == breakers.OPEN, f"{name} did not open"
    return b


def test_the_control_a_healthy_snapshot_raises_nothing():
    """⛔ NON-VACUITY. Without this, every assertion below could be passing because the rule never
    fires at all rather than because it fires correctly."""
    assert observe.evaluate_alerts(_snapshot()) == []
    assert observe.evaluate_alerts(_snapshot(), breakers=breakers.snapshot_all()) == []


def test_an_open_breaker_raises_an_alert_naming_the_dependency():
    _open("renderer")
    alerts = dict(observe.evaluate_alerts(_snapshot(), breakers=breakers.snapshot_all()))
    assert "breaker_open:renderer" in alerts
    assert "renderer" in alerts["breaker_open:renderer"]


def test_each_dependency_gets_its_own_alert_key_so_they_throttle_separately():
    """⛔ One key for 'a breaker is open' would let a long renderer outage silence the first alert
    about flow-worker going down — two different outages, two different people to wake."""
    _open("renderer")
    _open("flow")
    keys = {k for k, _ in observe.evaluate_alerts(_snapshot(), breakers=breakers.snapshot_all())}
    assert keys == {"breaker_open:renderer", "breaker_open:flow"}


def test_a_recovering_breaker_is_not_an_alert():
    """⛔ `half_open` means the cooldown elapsed and the next caller gets a probe — the system doing
    exactly what it should. Paging on that is how a channel gets muted."""
    clock = type("C", (), {"t": 1000.0, "__call__": lambda self: self.t})()
    b = breakers.Breaker("renderer", breakers.BreakerConfig(fail_threshold=2, cooldown_s=10.0), now=clock)
    for _ in range(2):
        b.allow()
        b.record_failure()
    assert b.state == breakers.OPEN
    assert observe.evaluate_alerts(_snapshot(), breakers={"renderer": b.snapshot()})
    clock.t += 11
    assert b.state == breakers.HALF_OPEN
    assert observe.evaluate_alerts(_snapshot(), breakers={"renderer": b.snapshot()}) == []


def test_the_message_says_it_will_repeat_rather_than_promising_a_recovery_note():
    """⛔ THERE IS DELIBERATELY NO 'RECOVERED' PUSH. Breaker state is per-process and this pod's
    median deployment served 8.4 minutes (C-01), so a recovery computed from in-memory previous
    state would simply never fire across a restart — the `_prev_flagged_syms` defect in CLAUDE.md,
    which produced pages nobody could act on. Instead the alert repeats on its durable cooldown
    while the breaker stays open, and SILENCE is the recovery signal. The message has to say so, or
    silence reads as 'the alerting broke'."""
    _open("flow")
    msg = dict(observe.evaluate_alerts(_snapshot(), breakers=breakers.snapshot_all()))["breaker_open:flow"]
    assert "repeat" in msg.lower() or "again" in msg.lower()


def test_the_message_carries_the_numbers_an_operator_acts_on():
    b = _open("bars")
    msg = dict(observe.evaluate_alerts(_snapshot(), breakers=breakers.snapshot_all()))["breaker_open:bars"]
    snap = b.snapshot()
    assert str(snap["trips"]) in msg or str(snap["recent_failures"]) in msg, msg
    assert "short" in msg.lower() or str(snap["short_circuits"]) in msg, (
        "the short-circuit count is how many members were refused without waiting — the member "
        "impact, which is the number that decides how urgent this is")


def test_the_rule_is_absent_when_nobody_passes_breakers():
    """Back-compatible by construction: `/renderhealth` and the Observer both call this, and a
    caller that has not been updated must not start raising KeyError in the alert path."""
    _open("renderer")
    assert observe.evaluate_alerts(_snapshot()) == []


def test_the_health_payload_carries_the_breaker_states(tmp_path):
    """The pull side. An operator asking `/renderhealth` must see the same thing the push said,
    from one source — not a second computation that can disagree with the alert."""
    from api.services.discord_render.jobs_store import JobsStore
    _open("renderer")
    store = JobsStore(str(tmp_path / "jobs.db"))
    payload = observe.health_payload(None, store, breakers=breakers.snapshot_all())
    assert payload["breakers"]["renderer"]["state"] == breakers.OPEN
    assert "breaker_open:renderer" in payload["alerts"], (
        "the pull side must name the same alert the push would send — two computations that can "
        "disagree is the second-authority defect, on the surface an operator trusts most")


def test_the_health_payload_reads_the_live_breakers_when_nobody_passes_any(tmp_path):
    """⛔ The default must be the REAL state, not empty. `/renderhealth` is called from a route that
    knows nothing about breakers; if the default were `{}` the endpoint would report a healthy path
    through a renderer outage — a proxy reading zero and being believed."""
    from api.services.discord_render.jobs_store import JobsStore
    _open("flow")
    payload = observe.health_payload(None, JobsStore(str(tmp_path / "jobs.db")))
    assert payload["breakers"]["flow"]["state"] == breakers.OPEN
    assert "breaker_open:flow" in payload["alerts"]


def test_the_observer_passes_the_live_breaker_snapshot(tmp_path):
    """⛔ THE WIRING RAIL, AND IT HAD TO BE BEHAVIOURAL. Everything above passes with an Observer
    that never feeds the rule — which is precisely how the breakers spent their first day: built,
    tested, green and unwired.

    ⚰️ The first version of this test walked `observe.py`'s AST for a `snapshot_all` call and stayed
    GREEN under the mutation that unwires the Observer — because `_live_breakers()` calls it too, so
    the name is in the file either way. That is `lesson_a_guard_that_tests_the_adjacent_thing`
    exactly: it asserted the helper exists, not that the loop uses it. This one runs the loop."""
    from api.services.discord_render.jobs_store import JobsStore
    _open("renderer")
    obs = observe.Observer(JobsStore(str(tmp_path / "jobs.db")),
                           renderer_fn=None, webhook_fn=lambda: "", post_fn=lambda *a: True)
    out = obs.run_once()
    assert "breaker_open:renderer" in out["breached"], (
        "the observer's own loop did not see the live breaker — the rule exists and nothing feeds it")
    assert "breaker_open:renderer" in out["logged"], (
        "with no webhook configured it is still an event under the same cooldown: blank means quiet "
        "in Discord, never quiet in the logs")
