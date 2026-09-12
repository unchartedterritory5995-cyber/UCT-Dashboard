"""The rig's deploy-swap guard must actually fire, and must fail CLOSED.

⛔ HARD RULE (owner, 2026-09-12): a rig run that overlaps any master push is
INCONCLUSIVE. Every master push rebuilds web, so a straddling run measures two
different pods — and the symptom does not announce itself as a deploy. On
2026-09-12 another workstream pushed five times in six minutes and the rig
reported `login http 502` on three consecutive runs, which reads exactly like a
broken product. `/api/health` was 502 in that window and 200 with a 46 s uptime
immediately afterwards.

⭐ THREE OUTCOMES, NOT TWO. An unreadable uptime is the swap case wearing a blank
face — during a swap `/api/health` itself 502s — so `None` must be INCONCLUSIVE and
never a pass. A guard that treats "could not tell" as "fine" is the shape
`lesson_a_saturated_instrument_reports_zero` names.

Mutation proof, all four run BEFORE this rail is called done:
    1. invert `up_after < up_before`      -> test_a_backward_uptime_is_a_swap RED
    2. delete the cold-start branch       -> test_a_cold_start_pod_is_inconclusive RED
    3. drop MIN_POD_AGE_S to 0            -> test_the_default_floor_is_pinned RED
    4. put the cold check BEFORE the
       younger-than-run check             -> test_the_younger_than_run_message_
                                             survives_the_cold_check RED
"""
from __future__ import annotations

import importlib.util
import os

_RIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "tools", "flow_cold_paint_rig.py")


def _rig():
    spec = importlib.util.spec_from_file_location("flow_cold_paint_rig", _RIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_a_clean_run_is_not_a_swap():
    """The control. Without this, a guard that returns True for everything would
    satisfy every other assertion in this file."""
    swapped, why = _rig()._swap_verdict(1000.0, 1030.0, 30.0)
    assert swapped is False, why
    assert why == ""


def test_a_backward_uptime_is_a_swap():
    swapped, why = _rig()._swap_verdict(2000.0, 12.0, 30.0)
    assert swapped is True
    assert "BACKWARD" in why


def test_a_pod_younger_than_the_run_is_a_swap():
    """The subtle one: uptime can go FORWARD across a swap if the run is long
    enough, so the comparison to elapsed time is what catches it."""
    swapped, why = _rig()._swap_verdict(5.0, 20.0, 60.0)
    assert swapped is True
    assert "younger" in why


def test_an_unreadable_uptime_fails_CLOSED():
    rig = _rig()
    for before, after in ((None, 100.0), (100.0, None), (None, None)):
        swapped, why = rig._swap_verdict(before, after, 10.0)
        assert swapped is True, "uptime %r/%r must be INCONCLUSIVE" % (before, after)
        assert "unreadable" in why


def test_the_summary_discards_swapped_runs_rather_than_averaging_them():
    """A source check, because the discard happens in `main()` and nothing else
    can observe it: the medians must be computed over runs that are NOT swapped."""
    with open(_RIG, encoding="utf-8") as fh:
        src = fh.read()
    assert 'not r.get("deploy_swapped") and r.get(key)' in src, (
        "main()'s summary no longer filters swapped runs out of the medians")
    assert 'discarded = [r for r in cand if r.get("deploy_swapped")]' in src, (
        "main() no longer counts the discarded runs — a silent discard is as bad "
        "as averaging them in, because nobody can tell n dropped")


# ─────────────────────────────────────────────────────────────────────────────
# MINIMUM POD AGE — a pod that is merely UNSWAPPED can still be COLD
# ─────────────────────────────────────────────────────────────────────────────
# ⚰️ Measured 2026-09-12: a run that began on a 38-second-old pod reported
# `parts served: NONE` with the page shell rendered. The deploy had just
# completed and the parts cache was empty. The same check on a 232-second-old
# pod served all six parts. The swap guard did NOT flag it, because uptime moved
# FORWARD (38 -> 83) and exceeded the run length — forward uptime proves only
# that no swap happened DURING the run.
#
# ⭐ At the open, that run reads as a MEMBER FAILURE. This is the guard that
# stops the misreading.

def test_a_cold_start_pod_is_inconclusive():
    """The real 2026-09-12 numbers: 38s old at start, 83s after, 44s elapsed."""
    swapped, why = _rig()._swap_verdict(38.0, 83.0, 44.0)
    assert swapped is True, "a 38s-old pod is COLD and must not be measured"
    assert "COLD" in why
    assert "38" in why and "120" in why, (
        "the message must name the age AND the floor, or an operator cannot tell "
        "how far short it fell: %r" % why)


def test_a_warm_pod_is_clean():
    """The control for the branch above. Without it, a guard that called every
    run cold would satisfy the cold-start test and destroy the instrument."""
    swapped, why = _rig()._swap_verdict(232.0, 256.0, 24.0)
    assert swapped is False, why


def test_the_younger_than_run_message_survives_the_cold_check():
    """ORDER IS LOAD-BEARING. (5, 20, 60) trips both branches; the specific
    'younger than the run' diagnosis must win, because a swap landing mid-run is
    a different fact from a pod that merely started cold."""
    swapped, why = _rig()._swap_verdict(5.0, 20.0, 60.0)
    assert swapped is True
    assert "younger" in why, "the broader cold-start message swallowed it: %r" % why
    assert "COLD" not in why


def test_the_floor_is_overridable_in_both_directions():
    rig = _rig()
    lenient, _ = rig._swap_verdict(38.0, 83.0, 44.0, min_pod_age=10.0)
    assert lenient is False, "an explicit lower floor must let a young pod through"
    strict, why = rig._swap_verdict(232.0, 256.0, 24.0, min_pod_age=1000.0)
    assert strict is True and "COLD" in why


def test_the_default_floor_is_pinned_at_120s():
    """Pins the LITERAL, not just the behaviour. A default that drifts silently is
    how a threshold gets 'fixed' to match whatever a failing run happened to see."""
    assert _rig().MIN_POD_AGE_S == 120.0


def test_every_branch_fails_closed():
    """No input may produce a quiet pass except a genuinely clean warm window."""
    rig = _rig()
    for args in ((None, 100.0, 10.0), (100.0, None, 10.0), (None, None, 10.0),
                 (2000.0, 12.0, 30.0), (5.0, 20.0, 60.0), (38.0, 83.0, 44.0)):
        swapped, why = rig._swap_verdict(*args)
        assert swapped is True, "%r returned a PASS" % (args,)
        assert why, "%r returned no reason" % (args,)


# ─────────────────────────────────────────────────────────────────────────────
# LOGIN PACING — the limiter must not be able to cost a measurement window
# ─────────────────────────────────────────────────────────────────────────────
# ⛔ /api/auth/login is @limiter.limit("5/minute") keyed by client IP
# (api/routers/auth.py:246). Every rig run opens a FRESH context — that IS the
# cache clear — so each run logs in once, and a naive sequence trips on the 6th
# login inside any minute.
#
# ⚰️ Measured 2026-09-12: three consecutive path-B runs returned `login http 429`
# and read exactly like a broken product. On a Monday open that costs the one
# thing that cannot be re-run.

def test_the_cap_is_below_the_servers_own_limit():
    """Pins the LITERAL. The server allows 5/minute; pacing at 5 races the
    boundary, because the window is the SERVER's and our clock, the request's
    travel time and any retry all shift where a login lands inside it."""
    rig = _rig()
    assert rig._LOGIN_MAX_PER_MIN == 4, (
        "pacing cap must stay strictly under the server's 5/minute")
    assert rig._LOGIN_WINDOW_S == 60.0


def test_a_clear_window_waits_nothing():
    """The control: without it, a pacer that always waited would satisfy every
    assertion below and silently double the runtime of every session."""
    # now=150 keeps both inside the 60s window (50s and 30s ago), so they are
    # RETAINED and still under the cap of 4.
    wait, recent = _rig()._login_wait_s([100.0, 120.0], now=150.0)
    assert wait == 0.0
    assert recent == [100.0, 120.0]


def test_a_full_window_waits_until_the_oldest_login_ages_out():
    rig = _rig()
    times = [100.0, 110.0, 120.0, 130.0]          # 4 logins, cap reached
    wait, recent = rig._login_wait_s(times, now=140.0)
    assert wait > 0, "a 5th login inside the window must wait"
    # oldest is 100.0, window 60s -> clear at 160.0, plus the 0.5s headroom
    assert abs(wait - 20.5) < 0.01, wait
    assert len(recent) == 4


def test_logins_older_than_the_window_do_not_count():
    """Otherwise the pacer would throttle forever after a long session."""
    wait, recent = _rig()._login_wait_s([1.0, 2.0, 3.0, 4.0], now=500.0)
    assert wait == 0.0
    assert recent == [], "entries outside the window must be dropped, not kept"


def test_a_429_is_reported_as_INCONCLUSIVE_not_as_an_error():
    """A rate-limited login measured nothing. Classifying it as a product error
    is the same misreading as calling a cold pod a parts failure."""
    with open(_RIG, encoding="utf-8") as fh:
        src = fh.read()
    assert src.count("RATE-LIMITED") == 2, (
        "both run paths must classify a 429 as inconclusive; found %d"
        % src.count("RATE-LIMITED"))
    assert 'if r.status == 429:' in src
    # and it must override whatever the uptime verdict said
    assert src.index('swapped, why = _swap_verdict') < src.index('if r.status == 429:')
