"""R30/R34/OI-45 — the durable stall record, and the page that can actually reach a human.

⚰️ THE DEFECT THESE RAILS EXIST FOR. `observe._loop_alerts` has fired at
`max_ms >= LOOP_STALL_ALERT_MS` since it was written, is unit-tested, and is mutation-covered.
It has NEVER been able to fire in production: its only evaluator is `observe.Observer`, built in
`commands.start()`, which `api/main.py` calls only inside `if _render_v2.enabled():` — and V2 is
dark on every production pod (OI-45). Three stalls over the threshold on 2026-09-15 paged nobody.

⛔ So the load-bearing test here is `test_a_stall_pages_with_V2_DARK`: it asserts the emission
happens with `DISCORD_RENDER_V2_ENABLED` unset. Re-gating the page behind `_render_v2.enabled()`
must turn it RED, because that is exactly the bug being closed.
"""
from __future__ import annotations

import json

import pytest

from api.services.discord_render import observe, stall_record


@pytest.fixture(autouse=True)
def _sandbox(tmp_path, monkeypatch):
    """⛔ Both paths resolve through their OWN env var with a /data default, so a test MUST pin
    them or it writes into the shared root — which on this box is the owner's live C:\\data."""
    monkeypatch.setenv(stall_record.RECORD_PATH_ENV, str(tmp_path / "stall-record.jsonl"))
    monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)
    stall_record._reset_for_tests()
    yield
    stall_record._reset_for_tests()


class _Spy:
    def __init__(self):
        self.calls = []

    def emit(self, key, severity, message, metadata=None):
        self.calls.append({"key": key, "severity": severity, "message": message,
                           "metadata": metadata or {}})
        return True


@pytest.fixture
def spy(monkeypatch):
    s = _Spy()
    import api.services.chart_health_alerts as cha
    monkeypatch.setattr(cha, "emit", s.emit)
    return s


# ── the tiers (pure, no filesystem) ─────────────────────────────────────────

def test_tier1_pages_at_any_uptime():
    """⛔ NOT a backstop above the boot range: the largest stall measured (20,446 ms) was at
    uptime 670-893 s, BELOW the floor. Tier 1 is the working path for that class."""
    d = stall_record.page_decision(20446.0, uptime_s=700.0, last_page_at=0.0, now=10_000.0)
    assert d["page"] is True and d["tier"] == 1


def test_a_block_just_past_the_ack_budget_pages_at_low_uptime():
    """⛔⛔ R51, AND THE CASE THAT BOUGHT IT. On 2026-09-17 a 3,572.1 ms block at uptime 281 s
    scored tier=null and paged nobody, under a 5,000 ms tier 1. Discord closes an interaction
    at 3,000 ms, so that block was a CERTAIN member-visible failure that no rule could report.
    Tier 1 is now the ack budget itself: at or past it, at any uptime, it pages."""
    d = stall_record.page_decision(3100.0, uptime_s=10.0, last_page_at=0.0, now=10_000.0)
    assert d["page"] is True and d["tier"] == 1, (
        "a block past the 3 s ack budget must page at any uptime")


def test_a_block_just_under_the_ack_budget_is_recorded_and_not_paged():
    """⛔ THE NON-VACUITY HALF OF R51. Without it the rule above passes just as well if
    everything pages, and a tier that fires on every blocked second is muted within a week.
    2,900 ms is under the budget: the interaction still lands, so it is evidence, not an alarm.
    """
    d = stall_record.page_decision(2900.0, uptime_s=10.0, last_page_at=0.0, now=10_000.0)
    assert d["record"] is True, "a near-budget block is still evidence and must be recorded"
    assert d["page"] is False, "below the ack budget must not page at low uptime"


def test_tier1_is_exactly_the_discord_ack_budget():
    """⛔ The number has a REASON, and the reason is checkable. If someone moves tier 1 without
    moving the ack budget it is guarding, these stop agreeing and this says so by name."""
    assert observe.LOOP_STALL_PAGE_ALWAYS_MS == 3000.0, (
        "R51: tier 1 IS the Discord ack budget; raising it needs a directive citing the fix")


def test_tier2_pages_only_past_the_uptime_floor():
    below = stall_record.page_decision(1200.0, uptime_s=500.0, last_page_at=0.0, now=10_000.0)
    above = stall_record.page_decision(1200.0, uptime_s=901.0, last_page_at=0.0, now=10_000.0)
    assert below["page"] is False and below["record"] is True, "below the floor: recorded, never paged"
    assert above["page"] is True and above["tier"] == 2


def test_a_small_stall_is_neither_recorded_nor_paged():
    """⛔ NON-VACUITY. Without this the tier rules pass just as well if everything fires."""
    d = stall_record.page_decision(200.0, uptime_s=5000.0, last_page_at=0.0, now=10_000.0)
    assert d["record"] is False and d["page"] is False


def test_the_cooldown_suppresses_a_second_page():
    now = 10_000.0
    d = stall_record.page_decision(9000.0, uptime_s=50.0,
                                   last_page_at=now - 60.0, now=now)
    assert d["page"] is False and "cooldown" in d["reason"]


# ── the durable half (the part in-memory state cannot do) ───────────────────

def test_the_record_survives_a_process_restart(spy):
    """⛔⛔ THE POINT OF THE WHOLE DESIGN. `web` restarts ~20x/day, so an in-memory ring can
    carry neither a frequency nor a cooldown. Simulated restart = reset module state, re-read."""
    stall_record.note(7000.0, uptime_s=100.0, commit="aaaaaaaaaaaa")
    stall_record._reset_for_tests()                      # the "restart"
    snap = stall_record.snapshot()
    assert snap["total_recorded"] == 1, "the record did not survive the restart"
    assert snap["recent"][0]["ms"] == 7000.0
    assert snap["lifetime_count"] == 0, "in-memory counters SHOULD reset; the file is the durable half"


def test_the_cooldown_survives_a_process_restart(spy):
    """A fresh pod must inherit the cooldown, or ~20 pods/day each page immediately."""
    stall_record.note(9000.0, uptime_s=50.0)
    assert len(spy.calls) == 1
    stall_record._reset_for_tests()                      # the "restart"
    stall_record.note(9000.0, uptime_s=50.0)
    assert len(spy.calls) == 1, "a restarted pod re-paged: the cooldown is not durable"


def test_below_floor_stalls_are_counted_not_paged(spy):
    stall_record.note(1200.0, uptime_s=100.0)
    snap = stall_record.snapshot()
    assert spy.calls == [], "a below-floor stall paged"
    assert snap["below_floor_count"] == 1, "the per-boot cost evidence was not counted"
    assert snap["total_recorded"] == 1, "a below-floor stall must still be RECORDED"


# ── OI-45: the page reaches a human on a V2-dark pod ────────────────────────

def test_a_stall_pages_with_V2_DARK(spy, monkeypatch):
    """⛔⛔ THE LOAD-BEARING ONE. This is the whole of OI-45."""
    monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)
    out = stall_record.note(9000.0, uptime_s=50.0)
    assert out["paged"] is True, "no page on a V2-dark pod — OI-45 is not closed"
    assert len(spy.calls) == 1


def test_the_severity_is_critical(spy):
    """⛔ `chart_health_alerts._should_page_discord` returns False for anything but "critical".
    A test asserting only that emit() was CALLED passes while the owner hears nothing."""
    stall_record.note(9000.0, uptime_s=50.0)
    assert spy.calls[0]["severity"] == "critical"
    assert spy.calls[0]["key"] == "loop_stalled"


def test_the_page_names_the_measurement(spy):
    stall_record.note(9000.0, uptime_s=50.0)
    msg = spy.calls[0]["message"]
    assert "9000" in msg and "3,000 ms" in msg
    assert spy.calls[0]["metadata"]["tier"] == 1


# ── it must never break the loop, and never write a credential ──────────────

def test_an_unwritable_path_does_not_raise(monkeypatch, spy, tmp_path):
    """The probe measures the loop; it must never be what breaks it.

    ⛔ And the failure must leave a TRACE. A swallowed error that records nothing is the
    'swallowed error becomes a confident finding' defect: the health payload would report an
    empty record, which reads exactly like a pod that never stalled."""
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    # a path UNDER a regular file: mkdir raises NotADirectoryError, no platform-specific chars
    monkeypatch.setenv(stall_record.RECORD_PATH_ENV, str(blocker / "sub" / "x.jsonl"))
    out = stall_record.note(9000.0, uptime_s=50.0)      # must not raise
    assert out["recorded"] is True, "note() reports what it attempted"
    assert stall_record.snapshot()["last_error"], "the write failure was swallowed without a trace"


def test_the_record_carries_no_credential_shaped_value(spy, tmp_path):
    stall_record.note(9000.0, uptime_s=50.0, commit="abcdef123456")
    text = (tmp_path / "stall-record.jsonl").read_text(encoding="utf-8")
    for bad in ("token=", "Bearer ", "/webhooks/"):
        assert bad not in text
    assert json.loads(text.splitlines()[0])["commit"] == "abcdef123456"


# ── the threshold has ONE home ──────────────────────────────────────────────

def test_the_thresholds_come_from_observe_not_a_copy():
    """⛔ N2. A second literal here would be the second-authority-over-one-value defect, and it
    would silently break `mutation_harness_adapters`, which mutates the constant at its real home."""
    import inspect
    src = inspect.getsource(stall_record)
    # ⛔ DERIVED, NEVER TYPED. This read `"5000.0" not in src` — a literal beside the constant
    # it guards, so R51's move to 3,000 ms would have left the rail hunting a number that no
    # longer exists and passing for the wrong reason. Same class as the flip gate's
    # `says="only 1/15"` and SMOKE-3.5's "three" over a list of four (D-15).
    for name, value in (("LOOP_STALL_ALERT_MS", observe.LOOP_STALL_ALERT_MS),
                        ("LOOP_STALL_PAGE_ALWAYS_MS", observe.LOOP_STALL_PAGE_ALWAYS_MS)):
        assert str(value) not in src, f"{name} was copied into stall_record"
    assert stall_record._thresholds()[0] == observe.LOOP_STALL_ALERT_MS
    assert stall_record._thresholds()[1] == observe.LOOP_STALL_PAGE_ALWAYS_MS


def test_the_health_payload_carries_the_record_beside_the_window():
    """The window answers 'is it stalling now'; the record answers 'how often, how big, when'.
    Both, never one instead of the other."""
    snap = observe._live_stall_record()
    assert "lifetime_max_ms" in snap and "recent" in snap
