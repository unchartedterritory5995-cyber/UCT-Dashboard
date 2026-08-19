"""The heartbeat that was blind for the first ~3 hours of every worker deploy.

🔴 WRITTEN AFTER 2026-08-18. Discord paged `🔴 Bars store STILL stale —
prewarmer never started` every 30 minutes while the prewarmer was, at that exact
moment, running flat out — measured on the live pod: `iterations: 0`,
`started_ts: null`, no phase at all, and the log streaming
`[prewarm] Progress 13000/25482`.

⭐ THE HEARTBEAT ONLY EXISTED IN THE STEADY LOOP. `_beat()` was called at the top
of `while True:`, and that loop is entered only AFTER the boot pass — 25,482 jobs,
measured at ~140 jobs/min => ~3 hours. The watchdog's first verdict lands at
600s + 900s ~= 25 min. So for ~2.5h after EVERY deploy the one signal that means
"warming is dead" was indistinguishable from "warming is starting".

⛔ AND THE ALERT'S REMEDY INVERTED THE FIX: "a worker redeploy revives it" —
a redeploy RESTARTS the 3-hour boot pass from zero, so obeying the alert
guarantees the next alert. Eight worker deploys on 2026-08-18 meant the boot pass
never once completed and the steady loop never ran at all.
"""
import importlib

import pytest

pw = importlib.import_module("api.services.bars_prewarm")
wm = importlib.import_module("api.worker_main")


@pytest.fixture(autouse=True)
def _clean_state():
    """The heartbeat is a module global; without this the first test's beats
    make every later `alive` assertion pass vacuously."""
    before = dict(pw._PREWARM_STATE)
    pw._reset_prewarm_state()
    yield
    pw._PREWARM_STATE.clear()
    pw._PREWARM_STATE.update(before)


# --------------------------------------------------------------------------- #
# liveness during the boot pass
# --------------------------------------------------------------------------- #

def test_THE_CONTROL_an_unstarted_prewarmer_is_not_alive():
    """⛔ Without this, a `_beat()` moved to import time would make every
    assertion below pass while proving nothing (`lesson_gate_that_cannot_fail`)."""
    hb = pw.prewarm_heartbeat()
    assert hb["alive"] is False
    assert hb["age_seconds"] is None
    assert hb["phase"] is None


def test_the_boot_pass_is_ALIVE_WHILE_IT_RUNS_not_only_after():
    """🔴 THE REGRESSION. The observation is taken from INSIDE the pass, at the
    same moment the watchdog would have taken it — not after the loop returns,
    which is the reading that was always fine."""
    seen = []

    def _results():
        for _ in range(6):
            # What the watchdog samples, sampled mid-pass.
            seen.append(pw.prewarm_heartbeat())
            yield ("warmed", "SPY", "D")

    pw._run_boot_pass(_results(), total=6, fast_path_size=2)

    assert seen, "the boot pass consumed nothing"
    # The FIRST job already sees a live prewarmer — no 3-hour blind window.
    assert seen[0]["alive"] is True, (
        "the prewarmer was working and its own heartbeat said it had never started"
    )
    assert all(h["alive"] for h in seen)


def test_the_heartbeat_NAMES_the_phase_it_is_in():
    """⭐ 'alive' alone cannot separate 'starting up' from 'steady state', and an
    operator needs that to know whether a redeploy helps or hurts."""
    phases = []

    def _results():
        for _ in range(3):
            phases.append(pw.prewarm_heartbeat()["phase"])
            yield ("skipped", "SPY", "D")

    pw._run_boot_pass(_results(), total=3, fast_path_size=1)
    assert phases == ["boot", "boot", "boot"]
    assert pw.prewarm_heartbeat()["phase"] == "steady"


def test_the_heartbeat_carries_boot_PROGRESS():
    """Without a denominator an operator cannot tell a slow pass from a hung one
    — the distinction `project_research_calendar_redesign` paid for twice."""
    progress = []

    def _results():
        for _ in range(4):
            hb = pw.prewarm_heartbeat()
            progress.append((hb["boot_done"], hb["boot_total"]))
            yield ("warmed", "SPY", "D")

    pw._run_boot_pass(_results(), total=4, fast_path_size=1)
    assert [p[1] for p in progress] == [4, 4, 4, 4], "the total is not published"
    assert [p[0] for p in progress] == [0, 1, 2, 3], "progress does not advance"
    assert pw.prewarm_heartbeat()["boot_done"] == 4


def test_the_boot_pass_still_returns_its_tally():
    """The counts the log line prints must survive the extraction."""
    rs = [("warmed", "A", "D"), ("skipped", "B", "D"), ("failed", "C", "D")]
    assert pw._run_boot_pass(iter(rs), total=3, fast_path_size=1) == (1, 1)


def test_the_wire_is_load_bearing():
    """⭐ REDS WHEN THE WIRE IS CUT while both halves stay correct: if the boot
    pass is inlined again, `_run_boot_pass` still passes every test above and the
    heartbeat still works — only this fails."""
    import inspect
    src = inspect.getsource(pw.run_prewarmer_forever)
    assert "_run_boot_pass(" in src, "the boot pass no longer beats"


# --------------------------------------------------------------------------- #
# the alert text — the half that told the operator to make it worse
# --------------------------------------------------------------------------- #

_STALE = {"stale": True, "days_behind": 7,
          "newest_session": 20260811, "expected_session": 20260818}


def test_a_BOOTING_prewarmer_is_never_called_dead():
    hb = {"alive": True, "phase": "boot", "boot_done": 13000, "boot_total": 25482}
    msg = wm._bars_alert_text("stale", hb, _STALE)
    assert "never started" not in msg
    assert "Warming has stopped" not in msg


def test_the_alert_does_not_tell_an_operator_to_REDEPLOY_INTO_a_boot_pass():
    """⛔ THE ADVICE WAS THE BUG. A redeploy restarts the 3-hour pass from zero,
    so the remedy printed on the alert manufactured the next alert."""
    hb = {"alive": True, "phase": "boot", "boot_done": 13000, "boot_total": 25482}
    msg = wm._bars_alert_text("stale", hb, _STALE)
    assert "redeploy revives it" not in msg
    assert "13000/25482" in msg, "an operator cannot see the pass advancing"
    assert "restart" in msg.lower(), "the alert must warn a redeploy costs progress"


def test_THE_CONTROL_a_genuinely_dead_prewarmer_still_says_redeploy():
    """⛔ Without this the fix above could be 'never mention redeploy', which
    would mute the one case where a redeploy IS the answer."""
    hb = {"alive": False, "phase": None, "age_seconds": None}
    msg = wm._bars_alert_text("stale", hb, _STALE)
    assert "never started" in msg
    assert "redeploy revives it" in msg


def test_a_stale_store_is_STILL_reported_while_the_boot_pass_repairs_it():
    """⛔ The fix must not become 'stay quiet during boot'. The store really was
    7 days behind; silence would re-create the blind spot the watchdog exists
    to close."""
    hb = {"alive": True, "phase": "boot", "boot_done": 10, "boot_total": 25482}
    msg = wm._bars_alert_text("stale", hb, _STALE)
    assert "7d behind" in msg
    assert "20260811" in msg and "20260818" in msg


# --------------------------------------------------------------------------- #
# the boot pass must not re-fetch a settled universe
# --------------------------------------------------------------------------- #

def test_a_settled_daily_bar_is_NOT_refetched_outside_the_data_window(monkeypatch):
    """⭐ WHY THE PASS TAKES 3 HOURS. `_needs_fresh` answers `last_ts <= today`
    for D/W/M — deliberately True when the stored bar IS today's, so an evolving
    session close keeps updating. Correct intraday; but overnight that bar can no
    longer change, and the boot pass has a COLD in-memory cache, so nothing
    absorbs ~12,000 guaranteed no-op vendor fetches.

    The steady loop already refuses to scan outside `in_active_data_window()` for
    exactly this reason — this reuses THAT authority rather than inventing a
    second one."""
    monkeypatch.setattr(pw, "_in_active_data_window", lambda: False)
    monkeypatch.setattr(pw, "_expected_session", lambda: 20260818)
    assert pw._boot_can_skip(20260818, "D") is True
    assert pw._boot_can_skip(20260818, "W") is True
    assert pw._boot_can_skip(20260818, "M") is True


def test_THE_CONTROL_during_the_session_todays_bar_is_still_refetched(monkeypatch):
    """⛔ The evolving-close bug (2026-06-15 'daily not recognizing today') is
    exactly what a naive version of this skip would bring back."""
    monkeypatch.setattr(pw, "_in_active_data_window", lambda: True)
    monkeypatch.setattr(pw, "_expected_session", lambda: 20260818)
    assert pw._boot_can_skip(20260818, "D") is False


def test_a_BEHIND_daily_bar_is_never_skipped(monkeypatch):
    """The 7-day freeze must still be repaired by the boot pass."""
    monkeypatch.setattr(pw, "_in_active_data_window", lambda: False)
    monkeypatch.setattr(pw, "_expected_session", lambda: 20260818)
    assert pw._boot_can_skip(20260811, "D") is False
    assert pw._boot_can_skip(None, "D") is False


def test_intraday_is_left_entirely_to_the_existing_gate(monkeypatch):
    """⛔ Scope. Intraday freshness has its own market-hours-aware rules in
    `_needs_fresh`; a second opinion here is the repeated defect this repo names
    'a second authority over one value'."""
    monkeypatch.setattr(pw, "_in_active_data_window", lambda: False)
    monkeypatch.setattr(pw, "_expected_session", lambda: 20260818)
    for tf in ("1", "5", "15", "30", "60"):
        assert pw._boot_can_skip(20260818, tf) is False


def test_the_skip_has_a_kill_switch(monkeypatch):
    monkeypatch.setenv("PREWARM_BOOT_SKIP_SETTLED", "0")
    monkeypatch.setattr(pw, "_in_active_data_window", lambda: False)
    monkeypatch.setattr(pw, "_expected_session", lambda: 20260818)
    assert pw._boot_can_skip(20260818, "D") is False


# --------------------------------------------------------------------------- #
# a SWITCHED-OFF prewarmer is a third thing, and no redeploy fixes it
# --------------------------------------------------------------------------- #

def test_a_disabled_prewarmer_is_NOT_reported_as_alive(monkeypatch):
    """⛔ The phase must not be allowed to fake liveness. If "disabled" beat like
    every other phase, the watchdog would grade a prewarmer that does nothing as
    healthy — the exact blind spot this whole file exists to close."""
    monkeypatch.delenv("BARS_PREWARM_ENABLED", raising=False)
    pw.run_prewarmer_forever()          # returns immediately at the enable gate
    hb = pw.prewarm_heartbeat()
    assert hb["phase"] == "disabled"
    assert hb["alive"] is False


def test_the_alert_names_the_SWITCH_instead_of_prescribing_a_redeploy():
    """⛔ Same defect class as the boot-pass advice: a remedy that cannot work
    sends an operator round a loop. A flag-off prewarmer needs the flag, and
    every redeploy in the world will not supply it."""
    hb = {"alive": False, "phase": "disabled", "age_seconds": None}
    msg = wm._bars_alert_text("stale", hb, _STALE)
    assert "BARS_PREWARM_ENABLED" in msg
    assert "redeploy revives it" not in msg


def test_THE_CONTROL_a_dead_but_ENABLED_prewarmer_still_says_redeploy():
    """⛔ Proves the branch above is selecting on the phase, not muting the
    redeploy advice outright."""
    hb = {"alive": False, "phase": "steady", "age_seconds": 4000}
    msg = wm._bars_alert_text("stale", hb, _STALE)
    assert "redeploy revives it" in msg
    assert "BARS_PREWARM_ENABLED" not in msg


def test_the_lifecycle_is_enumerated_in_ONE_place_and_validated():
    """⛔ The alert branches on these strings. A typo'd phase would silently take
    the wrong branch and print the wrong remedy — the exact defect this file was
    changed to fix, reintroduced one layer down. Derive the set, never retype it.
    """
    import inspect
    assert set(pw._PHASES) == {"boot", "steady", "disabled"}

    with pytest.raises(ValueError):
        pw._set_phase("bootting")

    # every phase the alert text branches on must be a real one
    alert_src = inspect.getsource(wm._bars_alert_text)
    for phase in ("boot", "disabled"):
        assert f'"{phase}"' in alert_src
        assert phase in pw._PHASES
