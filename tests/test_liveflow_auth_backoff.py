"""A provider auth rejection must not be retried like a network blip.

Observed on prod 2026-08-29, on the pod that serves members:

    [liveflow] connecting to https://api.bullflow.io/v1/streaming/alerts
    [liveflow] connection error: SSE handshake failed HTTP 403:
        b'{"error":"API subscription inactive"}' (next attempt in 30.0s)

…every 30 seconds, forever. 403 means a human has to change something upstream;
no number of retries can fix it. The cost is a request + a log line per cycle
plus a `/live-flow` page stuck on "Connecting to stream…" rather than saying
what is actually wrong.

It must still retry — a renewed subscription should recover without a redeploy —
just on a lazy cadence. These tests pin the CLASSIFICATION (which statuses are
terminal) and the CONSEQUENCE (terminal ones do not reuse the fast backoff).
"""
from __future__ import annotations

import inspect

from api import liveflow_worker as lw


def test_auth_statuses_are_classified_as_terminal():
    """401/402/403 are 'your account cannot do this', not 'try again shortly'."""
    assert set(lw._TERMINAL_AUTH_STATUSES) == {401, 402, 403}


def test_the_slow_cadence_is_far_slower_than_the_transient_one():
    """Otherwise the fix is cosmetic — it would still hammer the provider."""
    assert lw.LIVEFLOW_AUTH_RETRY_SEC > lw.RECONNECT_MAX_SEC * 10, (
        f"auth retry {lw.LIVEFLOW_AUTH_RETRY_SEC}s is not meaningfully slower "
        f"than the transient cap {lw.RECONNECT_MAX_SEC}s"
    )


def test_auth_error_is_its_own_class_not_a_string_match():
    """The status code is the fact; matching on log text would rot silently."""
    assert issubclass(lw.LiveflowAuthError, RuntimeError)
    src = inspect.getsource(lw.run_forever)
    assert "except LiveflowAuthError" in src, (
        "run_forever does not branch on the auth class — a 403 would fall through "
        "to the 30s transient path, which is the bug this file exists to pin"
    )
    assert "subscription inactive" not in src, (
        "run_forever appears to string-match the provider's message; classify on "
        "the status code at the response instead"
    )


def test_the_handshake_raises_the_auth_class_for_a_403_and_not_for_a_500():
    """Reads the real handshake source: 403 must take the terminal branch, 500 must not.

    The discriminating half matters — a change that raised LiveflowAuthError for
    EVERY non-200 would pass a naive "403 is terminal" check while quietly
    parking the worker for 15 minutes on an ordinary provider blip.
    """
    src = inspect.getsource(lw._consume_stream)
    assert "_TERMINAL_AUTH_STATUSES" in src, (
        "the handshake does not consult the terminal-status set"
    )
    assert "raise LiveflowAuthError" in src and "raise RuntimeError" in src, (
        "the handshake must raise the auth class for terminal statuses and a "
        "plain RuntimeError otherwise — both branches have to exist, or every "
        "transient failure gets the 15-minute cadence"
    )


def test_status_exposes_auth_blocked_so_the_ui_can_be_honest():
    """A page that says 'Connecting…' forever is lying to the member."""
    assert "auth_blocked" in lw._status, (
        "no auth_blocked flag — /live-flow cannot distinguish 'subscription "
        "inactive' from 'still connecting'"
    )
    assert lw._status["auth_blocked"] is False, "must default to not-blocked"


def test_a_successful_connect_clears_the_blocked_flag():
    """Otherwise a renewed subscription still shows as broken forever."""
    src = inspect.getsource(lw._consume_stream)
    connected_at = src.index('_status["connected"] = True')
    cleared_at = src.index('_status["auth_blocked"] = False')
    assert cleared_at > connected_at, (
        "auth_blocked is not cleared on a successful connect — the flag would "
        "latch and outlive the problem"
    )


def test_the_auth_branch_does_not_poison_the_transient_backoff():
    """After an auth block, an ordinary blip must still retry fast.

    Reusing `backoff` across the two paths would leave the transient reconnect
    stuck at the 15-minute cadence — a slow, invisible degradation of the live
    feed's recovery time.
    """
    src = inspect.getsource(lw.run_forever)
    # ⚠️ `run_forever` has EARLIER `except Exception` blocks (init_db, rehydrate),
    # so search for the transient handler AFTER the auth branch — slicing to the
    # first match yielded an EMPTY string, which made every "not in" assertion
    # below pass vacuously.
    start = src.index("except LiveflowAuthError")
    auth_branch = src[start:src.index("except Exception", start)]
    assert auth_branch.strip(), "failed to isolate the auth branch"
    assert "backoff" not in auth_branch.replace("# Do NOT touch `backoff`", ""), (
        "the auth branch mutates the shared transient backoff"
    )
    assert "continue" in auth_branch, (
        "the auth branch must skip the transient sleep, not fall through to it"
    )
