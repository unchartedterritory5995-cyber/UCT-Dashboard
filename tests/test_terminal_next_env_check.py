"""Rail for environment check 1 of the weekly autonomous run.

⚰️ **THE BUG THIS EXISTS TO KILL.** The weekly prompt's check 1 read *"both worktrees on their
branches, clean, and matching origin"*, and the obvious reading of "matching origin" is
`origin/<branch>`. But `feat/s7-price-level` **publishes to master**, so `origin/s7-price-level`
is a stale ref it outruns forever — measured 2026-09-13 at **ahead 99** with **zero** commits
actually unpublished. Under the old reading the Saturday run would FULL-STOP every week on a
perfectly clean tree, and §1 says a failed check is a stop, not a warning.

⭐ `test_the_old_origin_branch_rule_would_have_failed_this_exact_tree` is the control: it builds
the real shape and asserts the two rules **disagree**. Without it this file would pass just as
happily against the broken rule, which is the fixture-that-cannot-distinguish defect.
"""
from __future__ import annotations

import importlib.util
import pathlib
import subprocess

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "terminal_next_env_check.py"


def _load():
    spec = importlib.util.spec_from_file_location("envcheck1", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


ec = _load()


def _git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo)] + list(args), capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    assert r.returncode == 0, "git %s failed: %s" % (" ".join(args), r.stderr)
    return (r.stdout or "").strip()


@pytest.fixture()
def repo(tmp_path):
    """A repo shaped like `feat/s7-price-level`: a branch that PUBLISHES TO MASTER.

    `origin/master` contains HEAD; `origin/<branch>` is deliberately left behind, exactly as the
    push-to-master idiom leaves it.
    """
    r = tmp_path / "r"
    r.mkdir()
    _git(r, "init", "-q", "-b", "feat/x")
    _git(r, "config", "user.email", "x@y.z")
    _git(r, "config", "user.name", "x")
    (r / "f").write_text("1", encoding="utf-8")
    _git(r, "add", "-A")
    _git(r, "commit", "-q", "-m", "base")
    # the stale per-branch ref: pushed once, long ago
    _git(r, "update-ref", "refs/remotes/origin/feat/x", "HEAD")
    (r / "f").write_text("2", encoding="utf-8")
    _git(r, "add", "-A")
    _git(r, "commit", "-q", "-m", "published to master, never to the branch ref")
    _git(r, "update-ref", "refs/remotes/origin/master", "HEAD")
    return r


DECLARED = {"feat/x": "origin/master"}


def test_a_fully_published_push_to_master_tree_passes(repo):
    state, branch, ref, detail = ec.check_tree(repo, declared=DECLARED)
    assert state == ec.PASS, detail
    assert ref == "origin/master"
    assert branch == "feat/x"


def test_an_unpushed_local_commit_fails_and_NAMES_it(repo):
    (repo / "f").write_text("3", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "not yet on master")
    state, _, _, detail = ec.check_tree(repo, declared=DECLARED)
    assert state == ec.FAIL, detail
    # ⛔ names, not a count — a rail that reports "1 unpublished commit" sends nobody anywhere.
    assert "not yet on master" in detail


def test_the_old_origin_branch_rule_would_have_failed_this_exact_tree(repo):
    """THE CONTROL. If this ever passes, the fixture stopped reproducing the bug."""
    behind = ec.check_tree(repo, declared={"feat/x": "origin/feat/x"})[0]
    assert behind == ec.FAIL, "fixture no longer reproduces the stale-branch-ref shape"
    assert ec.check_tree(repo, declared=DECLARED)[0] == ec.PASS
    # and the disagreement is the whole point
    assert behind != ec.check_tree(repo, declared=DECLARED)[0]


def test_a_dirty_tree_fails(repo):
    (repo / "f").write_text("dirty", encoding="utf-8")
    state, _, _, detail = ec.check_tree(repo, declared=DECLARED)
    assert state == ec.FAIL
    assert "DIRTY" in detail


def test_an_undeclared_branch_is_UNREADABLE_not_a_failure(repo):
    state, _, _, detail = ec.check_tree(repo, declared={})
    assert state == ec.UNREADABLE, detail
    assert "UNDECLARED" in detail


def test_an_unresolvable_publish_ref_is_UNREADABLE_not_a_failure(repo):
    """⛔ The third state earns its keep here.

    `merge-base --is-ancestor` exits non-zero for "no" AND for "I could not tell", so a check that
    only looked at the exit code would report a missing ref as UNPUBLISHED WORK — a broken
    measurement wearing the costume of a real finding.
    """
    state, _, _, detail = ec.check_tree(repo, declared={"feat/x": "origin/does-not-exist"})
    assert state == ec.UNREADABLE, detail
    assert "does not resolve" in detail


def test_the_three_states_are_distinct_values():
    assert len({ec.PASS, ec.FAIL, ec.UNREADABLE}) == 3


def test_the_declared_map_covers_both_programme_trees():
    for branch in ("feat/s7-price-level", "terminal-research"):
        assert branch in ec.PUBLISH_REF, branch
    assert ec.PUBLISH_REF["feat/s7-price-level"] == "origin/master"
    # ⭐ the docs tree does NOT publish to master, and a blanket origin/master rule would
    # have failed it every week in the opposite direction.
    assert ec.PUBLISH_REF["terminal-research"] == "origin/terminal-research"


def test_the_self_check_passes():
    assert ec.main(["--self-check"]) == ec.PASS
