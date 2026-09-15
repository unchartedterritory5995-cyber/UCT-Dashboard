"""The scope checker must refuse the exact commit that happened, and pass the ones that
should. Session 12, Workstream D.4.

⛔ THE END-TO-END TEST USES A THROWAWAY REPO, NEVER THE REAL INDEX. A test that stages
into this working tree can leave it staged when it fails, and the next commit inherits
whatever it left. The real repo is used only for READ-ONLY checks of the committed scope
declaration.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from tools import git_scope  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[1]
SCOPE = REPO / ".git-scope" / "breadth-history-reader.json"


# ── the real declaration ────────────────────────────────────────────────────

def test_the_committed_scope_is_valid_json_and_declares_both_halves():
    s = json.loads(SCOPE.read_text(encoding="utf-8"))
    assert s["branches"], "a scope with no branches enforces nothing"
    assert s["allow"], "a scope with no allow list would refuse everything"


def test_the_incident_commit_would_have_been_REFUSED():
    """⚰️ THE ACTUAL PATHS FROM 2026-09-15. A breadth commit used `git add -A` and swept
    in two joystick docs, silently normalising another programme's raw control bytes."""
    scopes = git_scope.load_scopes()
    name, bad = git_scope.violations(
        "breadth/resident-recon",
        ["api/services/breadth_daily_ohlc.py",
         "docs/feature_flags.json",
         "tests/test_breadth_resident_recon.py",
         "docs/plans/joystick/RESUME.md",
         "docs/plans/joystick/harness/2026-09-14-gate-harness-pr-body.md"],
        scopes)
    assert name == "breadth-history-reader", name
    assert bad == ["docs/plans/joystick/RESUME.md",
                   "docs/plans/joystick/harness/2026-09-14-gate-harness-pr-body.md"], bad


def test_the_same_commit_without_the_sweep_PASSES():
    """⛔ NON-VACUITY, and it is the half that matters. A checker that refuses everything
    passes the test above and is useless — it would be bypassed the same day."""
    scopes = git_scope.load_scopes()
    name, bad = git_scope.violations(
        "breadth/resident-recon",
        ["api/services/breadth_daily_ohlc.py",
         "docs/feature_flags.json",
         "tests/test_breadth_resident_recon.py"],
        scopes)
    assert name == "breadth-history-reader"
    assert bad == [], bad


def test_a_hot_path_file_is_inside_the_scope():
    """The reader's own files must not be refused — D.4 asks for this explicitly."""
    scopes = git_scope.load_scopes()
    hot = ["api/services/breadth_daily_ohlc.py", "api/services/breadth_monitor.py",
           "api/services/breadth_timing.py", "api/routers/breadth_monitor.py"]
    name, bad = git_scope.violations("breadth/sampler", hot, scopes)
    assert name == "breadth-history-reader"
    assert bad == [], f"the programme's own hot files were refused: {bad}"


def test_an_undeclared_branch_is_silent_not_refused():
    """⛔ Most branches here belong to programmes that declared nothing. Refusing those
    would make the check intolerable, and an intolerable check gets bypassed."""
    scopes = git_scope.load_scopes()
    name, bad = git_scope.violations("feat/joystick-hub",
                                     ["docs/plans/joystick/RESUME.md"], scopes)
    assert name is None and bad == []


def test_the_self_check_proves_the_refusal_can_fire():
    assert git_scope.main(["--self-check"]) == 0


# ── end to end, in a throwaway repo ─────────────────────────────────────────

def _run(args, cwd, env=None):
    import os
    e = dict(os.environ)
    if env:
        e.update(env)
    return subprocess.run([sys.executable, str(REPO / "tools" / "git_scope.py"), *args],
                          capture_output=True, encoding="utf-8", errors="replace",
                          cwd=str(cwd), env=e)


def test_end_to_end_the_checker_refuses_a_real_staged_out_of_scope_file(tmp_path, monkeypatch):
    """Stage a joystick-shaped path in a THROWAWAY repo and assert exit 1 by path."""
    monkeypatch.setattr(git_scope, "REPO", tmp_path)
    monkeypatch.setattr(git_scope, "SCOPE_DIR", tmp_path / ".git-scope")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "checkout", "-q", "-b", "breadth/demo"], cwd=tmp_path, check=True)
    (tmp_path / ".git-scope").mkdir()
    (tmp_path / ".git-scope" / "p.json").write_text(json.dumps(
        {"branches": ["breadth/"], "allow": ["tools/breadth_"]}), encoding="utf-8")
    (tmp_path / "tools").mkdir()
    (tmp_path / "tools" / "breadth_x.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "joystick.md").write_text("theirs\n", encoding="utf-8")

    subprocess.run(["git", "add", "tools/breadth_x.py"], cwd=tmp_path, check=True)
    assert git_scope.main([]) == 0, "an in-scope staged file must pass"

    subprocess.run(["git", "add", "docs/joystick.md"], cwd=tmp_path, check=True)
    assert git_scope.main([]) == 1, "an out-of-scope staged file must be refused"


def test_the_override_is_explicit_and_logged(tmp_path, monkeypatch):
    """⛔ A silent override is the same as no rule. `--no-verify` leaves no trace; this
    must leave one."""
    monkeypatch.setattr(git_scope, "REPO", tmp_path)
    monkeypatch.setattr(git_scope, "SCOPE_DIR", tmp_path / ".git-scope")
    monkeypatch.setattr(git_scope, "OVERRIDE_LOG", tmp_path / "logs" / "ov.log")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    monkeypatch.setenv(git_scope.OVERRIDE, "1")
    assert git_scope.main([]) == 0
    assert (tmp_path / "logs" / "ov.log").exists(), "the override must be recorded"
