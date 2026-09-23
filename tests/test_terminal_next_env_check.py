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


def test_a_cherry_picked_commit_under_a_new_sha_passes_not_a_false_positive(repo):
    """PACKET-F / F-ENVCHECK-1 — the false-STOP this packet exists to fix.

    HEAD carries a commit whose PATCH already exists on the publish ref, under a
    DIFFERENT sha — exactly the shape this programme's own `_merge-master` cherry-pick
    pipeline produces every week. Pure ancestry cannot see this (proved below as a
    control, mirroring `test_the_old_origin_branch_rule_would_have_failed_this_exact_tree`);
    `check_tree` must fall through to a patch-id comparison and PASS instead of FAIL.
    """
    (repo / "f").write_text("cherry-source", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "authored on feat/x, lands on master by cherry-pick")

    # ⭐ CONTROL — prove the false-positive precondition: pure ancestry says "not an ancestor".
    # This is exactly the exit code the OLD (pre-packet) code treated as a bare FAIL.
    rc = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", "HEAD", "origin/master"],
        capture_output=True,
    ).returncode
    assert rc == 1, "fixture no longer reproduces a non-ancestor HEAD — test is vacuous"

    # Simulate the `_merge-master` worktree: same tree, same parent, different sha/message —
    # i.e. the same patch, already applied on the publish ref under another commit id.
    tree = _git(repo, "rev-parse", "HEAD^{tree}")
    parent = _git(repo, "rev-parse", "HEAD^")
    cherry_sha = _git(repo, "commit-tree", tree, "-p", parent,
                       "-m", "same patch, cherry-picked onto master under a new sha")
    _git(repo, "update-ref", "refs/remotes/origin/master", cherry_sha)

    state, _, _, detail = ec.check_tree(repo, declared=DECLARED)
    assert state == ec.PASS, detail


def test_a_genuinely_unpublished_commit_alongside_a_cherry_picked_one_still_fails(repo):
    """The fix must not become a rail that can never fail (`lesson_a_guard_repeated_is_a_guard_unproved`
    / a gate that cannot fail): a REAL unpublished commit sitting on top of an already
    cherry-picked one must still be named and FAIL, distinguished from the false positive above."""
    (repo / "f").write_text("cherry-source", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "authored on feat/x, lands on master by cherry-pick")
    tree = _git(repo, "rev-parse", "HEAD^{tree}")
    parent = _git(repo, "rev-parse", "HEAD^")
    cherry_sha = _git(repo, "commit-tree", tree, "-p", parent,
                       "-m", "same patch, cherry-picked onto master under a new sha")
    _git(repo, "update-ref", "refs/remotes/origin/master", cherry_sha)

    # a SECOND commit that has never landed anywhere, not even as an equivalent patch
    (repo / "f").write_text("genuinely-new", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "not on master anywhere")

    state, _, _, detail = ec.check_tree(repo, declared=DECLARED)
    assert state == ec.FAIL, detail
    assert "not on master anywhere" in detail


def test_git_cherry_erroring_is_UNREADABLE_not_a_silent_FAIL(repo, monkeypatch):
    """`git cherry` failing must read the same as every other broken measurement in this
    tool — UNREADABLE — never silently reinterpreted as FAIL."""
    (repo / "f").write_text("3", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "not yet on master")

    real_git = ec._git

    def _boom(cwd, *args):
        if args and args[0] == "cherry":
            return 129, "fatal: forced failure for the test"
        return real_git(cwd, *args)

    monkeypatch.setattr(ec, "_git", _boom)
    state, _, _, detail = ec.check_tree(repo, declared=DECLARED)
    assert state == ec.UNREADABLE, detail
    assert "cherry" in detail.lower()


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
