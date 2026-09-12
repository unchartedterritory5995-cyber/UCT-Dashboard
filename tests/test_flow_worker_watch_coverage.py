"""Rail: a change flow-worker RUNS must actually redeploy flow-worker.

See `tools/flow_worker_watch_coverage.py` for the trap. In short: flow-worker
watches ~21 specific `api/*.py` files, its import closure reaches 162 api
modules, and a change to the other ~141 deploys nothing while the suite stays
green. Measured 2026-09-11: flow-worker was SKIPPED on 14 of the last 14 master
pushes, including both that touched `api/`.

⛔ THE DECISION LOGIC IS TESTED ON SYNTHETIC INPUT, SEPARATELY FROM THE GIT
PLUMBING. A rail whose only assertion runs over `git diff` passes vacuously the
moment the diff comes back empty — which is exactly how `rule12Paths.test.js`
shipped twice with a broken invocation (rule 14). Here the pure `verdict()` is
exercised directly and always means something; the live-diff case is a separate
test that says out loud when it had nothing to judge.
"""
from __future__ import annotations

import os

import pytest

from tools import flow_worker_watch_coverage as wc


@pytest.fixture(scope="module")
def root():
    return wc.repo_root()


# ── the decision, on synthetic input ──────────────────────────────────────

REACH = {"api/flow_db.py", "api/services/flow_aggregate.py", "api/flow_summary.py"}
WATCH = {"api/flow_db.py", "railway.json", "requirements.txt"}


def test_a_stranded_change_fails():
    ok, bad = wc.verdict({"api/services/flow_aggregate.py"}, REACH, WATCH)
    assert ok is False
    assert bad == {"api/services/flow_aggregate.py"}


def test_a_stranded_change_riding_with_a_watched_file_passes():
    """The conventional fix: touch the header in the same commit."""
    ok, bad = wc.verdict({"api/services/flow_aggregate.py", "api/flow_db.py"},
                         REACH, WATCH)
    assert ok is True
    assert bad == {"api/services/flow_aggregate.py"}   # reported, not fatal


def test_a_change_flow_worker_never_runs_is_not_its_problem():
    ok, bad = wc.verdict({"app/src/pages/OptionsFlow.jsx", "docs/x.md"}, REACH, WATCH)
    assert (ok, bad) == (True, set())


def test_an_empty_diff_is_not_a_violation():
    assert wc.verdict(set(), REACH, WATCH) == (True, set())


# ── the inputs the decision runs on, against the real repo ────────────────

def test_the_watch_list_parses_and_is_not_silently_empty(root):
    """NON-VACUITY. An empty or mis-parsed list makes every diff look covered —
    the rail would pass for everything and read as protection."""
    mods = wc.watched_modules(root)
    assert len(mods) >= 15, mods
    assert {"flow_db", "flow_router", "flow_worker_main"} <= mods
    paths = wc.watched_paths(root)
    assert "api/flow_db.py" in paths and "railway.json" in paths


def test_the_reachable_set_is_computed_and_reaches_known_modules(root):
    """NON-VACUITY the other way: an empty closure makes every diff look
    irrelevant, which fails in the flattering direction."""
    reach = wc.reachable_paths(root)
    assert len(reach) >= 100, len(reach)
    assert "api/flow_db.py" in reach
    assert "api/flow_router.py" in reach
    # the module that motivated this rail — flow-worker runs it, never watches it
    assert "api/services/flow_aggregate.py" in reach


def test_the_known_trap_is_still_a_trap(root):
    """CONTROL WITH TEETH. If someone widens the dashboard list and syncs the
    header, this goes red and the rail should be re-scoped — a rail that cannot
    tell you it is obsolete is worse than none."""
    reach, watch = wc.reachable_paths(root), wc.watched_paths(root)
    stranded = wc.offenders(reach, reach, watch)
    assert "api/services/flow_aggregate.py" in stranded
    assert len(stranded) > 50, (
        "flow-worker's watch list now covers most of its closure — re-scope this "
        "rail, and re-read the tape-gap trade before celebrating (%d stranded)"
        % len(stranded))


# ── the live diff ─────────────────────────────────────────────────────────

def test_this_branch_does_not_strand_a_change_flow_worker_runs(root):
    changed = set(wc.changed_files(root))
    if not changed:
        pytest.skip("no diff against origin/master — nothing to judge "
                    "(this is the on-master case, not a pass)")
    ok, bad = wc.verdict(changed, wc.reachable_paths(root), wc.watched_paths(root))
    assert ok, (
        "this branch changes files flow-worker RUNS but does not trigger its "
        "deploy, so it would ship inert: %s. Touch a watched file in the same "
        "commit (the api/flow_worker_main.py header is the conventional trigger)."
        % sorted(bad))
