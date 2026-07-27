"""Tests for tools/check_deploy_window.py — the server-side market-hours guard.

The local pre-push hook cannot see a GitHub web-UI commit, so this guard is the
only thing that evaluates the freeze rule for that path. It therefore has to be
right about three things the hook already gets right: the window boundaries, ET
DST, and which files redeploy the flow-worker.
"""

from datetime import datetime, timezone

import pytest

from tools.check_deploy_window import (
    Undetermined,
    classify,
    load_watched_files,
)

WATCHED = {"api/massive_ws_worker.py", "api/flow_db.py", "railway.json"}
UNWATCHED = ["app/src/pages/Dashboard.jsx"]


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


# --- Window boundaries (EDT = UTC-4) ---------------------------------------
# Mon 2026-07-27. 13:14Z = 09:14 ET, one minute before the freeze opens.
@pytest.mark.parametrize(
    "utc, expect",
    [
        ("2026-07-27T13:14:00", "ok"),    # 09:14 ET — before the window
        ("2026-07-27T13:15:00", "web"),   # 09:15 ET — window opens
        ("2026-07-27T20:19:00", "web"),   # 16:19 ET — last minute inside
        ("2026-07-27T20:20:00", "ok"),    # 16:20 ET — window closes
    ],
)
def test_freeze_window_boundaries(utc, expect):
    assert classify(_utc(utc), UNWATCHED, WATCHED).severity == expect


@pytest.mark.parametrize("day", ["2026-07-25", "2026-07-26"])  # Sat, Sun
def test_weekend_is_never_frozen(day):
    v = classify(_utc(f"{day}T17:00:00"), ["api/massive_ws_worker.py"], WATCHED)
    assert v.ok


def test_dst_is_resolved_not_hardcoded():
    """The same wall-clock ET minute maps to a DIFFERENT UTC hour in winter.

    A hardcoded UTC-4 would misjudge every EST-season commit by an hour --
    enough to call a 9:20 AM ET January deploy compliant.
    """
    # Winter (EST = UTC-5): 14:20Z is 09:20 ET, inside the freeze.
    assert classify(_utc("2026-01-14T14:20:00"), UNWATCHED, WATCHED).severity == "web"
    # The same UTC instant in summer (EDT = UTC-4) is 10:20 ET — also inside,
    # so pin the discriminating pair: 13:20Z is 08:20 EST (outside) in winter
    # but 09:20 EDT (inside) in summer.
    assert classify(_utc("2026-01-14T13:20:00"), UNWATCHED, WATCHED).ok
    assert classify(_utc("2026-07-14T13:20:00"), UNWATCHED, WATCHED).severity == "web"


def test_flow_files_escalate_severity():
    v = classify(
        _utc("2026-07-27T15:00:00"),  # 11:00 ET, mid-session
        ["app/src/pages/Dashboard.jsx", "api/massive_ws_worker.py"],
        WATCHED,
    )
    assert v.severity == "flow"
    assert v.flow_touched == ["api/massive_ws_worker.py"]


def test_unwatched_files_mid_session_are_web_severity_not_flow():
    v = classify(_utc("2026-07-27T15:00:00"), UNWATCHED, WATCHED)
    assert v.severity == "web"
    assert v.flow_touched == []


# --- The watched-file list must never silently parse to nothing ------------
def test_watched_list_parses_from_the_real_hook():
    watched = load_watched_files()
    assert "api/massive_ws_worker.py" in watched
    assert "api/flow_worker_main.py" in watched
    assert len(watched) > 10


def test_unparseable_hook_is_undetermined_not_empty(tmp_path):
    """A drifted hook format must NOT degrade to 'no flow files watched'.

    An empty set would make every flow-touching push look clean — the guard
    would pass exactly when it matters most.
    """
    broken = tmp_path / "pre-push"
    broken.write_text("#!/bin/sh\necho hi\n", encoding="utf-8")
    with pytest.raises(Undetermined):
        load_watched_files(broken)


def test_hook_present_but_missing_the_worker_path_is_undetermined(tmp_path):
    broken = tmp_path / "pre-push"
    broken.write_text('FLOW_WATCHED="api/some_other.py"\n', encoding="utf-8")
    with pytest.raises(Undetermined):
        load_watched_files(broken)


# --- Regression rail: the real commits this guard was built for ------------
# (sha, author epoch, touched a flow-watched file, expected severity)
REAL_COMMITS = [
    ("fc180a3a", 1784649946, True, "flow"),   # Tue 2026-07-21 12:05 ET
    ("ab2e94ac", 1784740379, True, "flow"),   # Wed 2026-07-22 13:12 ET
    ("fb25f3de", 1784907923, True, "flow"),   # Fri 2026-07-24 11:45 ET
    ("3ca426c5", 1784857332, True, "ok"),     # Thu 2026-07-23 21:42 ET
    ("bf1a4384", 1785002196, True, "ok"),     # Sat 2026-07-25 13:56 ET
    ("216f9803", 1785189049, True, "ok"),     # Mon 2026-07-27 17:50 ET
    ("19015905", 1784390599, True, "ok"),     # Sat 2026-07-18 12:03 ET
]


@pytest.mark.parametrize("sha, epoch, touches_flow, expect", REAL_COMMITS)
def test_real_history_is_classified_correctly(sha, epoch, touches_flow, expect):
    """Replays actual master commits. Three of these really did gap the tape.

    Epochs are the commits' own author timestamps, so this is history, not a
    hand-converted approximation.
    """
    files = ["api/massive_ws_worker.py"] if touches_flow else UNWATCHED
    when = datetime.fromtimestamp(epoch, tz=timezone.utc)
    assert classify(when, files, WATCHED).severity == expect, sha
