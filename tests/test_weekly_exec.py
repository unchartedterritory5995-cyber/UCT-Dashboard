"""Rail for the weekly run's constrained execution surface.

⚰️ The constraint lives here rather than in the permissions profile because a
`Bash(...)` prefix rule **cannot end mid-token** — measured against Claude Code
2.1.270, `Bash(python -m pytest tests/test_:*)` did not match a real named-file
invocation, while the rule that DOES match (`.../tests/:*`) also matches the bare
`pytest tests/` that OOM-killed this box. A rule that only works by permitting the
hazard is not a rule.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "weekly_exec.py"


def _load():
    spec = importlib.util.spec_from_file_location("weeklyexec", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


W = _load()


# ── the refusals that matter ────────────────────────────────────────────────

def test_a_bare_tests_directory_is_REFUSED(capsys):
    assert W.cmd_tests(["tests"]) == W.REFUSED
    assert "DIRECTORY" in capsys.readouterr().err


def test_the_dash_k_filter_is_REFUSED_because_it_does_not_scope(capsys):
    assert W.cmd_tests(["-k", "journal"]) == W.REFUSED
    err = capsys.readouterr().err
    assert "does not scope" in err


def test_no_arguments_is_REFUSED(capsys):
    assert W.cmd_tests([]) == W.REFUSED
    assert "never runs a directory" in capsys.readouterr().err


def test_a_path_outside_the_repo_is_REFUSED(capsys):
    assert W.cmd_tests(["../../../Windows/System32/drivers/etc/hosts"]) == W.REFUSED
    assert "outside the repository" in capsys.readouterr().err


def test_a_non_test_file_is_REFUSED(capsys):
    assert W.cmd_tests(["tools/weekly_exec.py"]) == W.REFUSED
    assert "not under" in capsys.readouterr().err


def test_a_file_outside_the_declared_roots_is_REFUSED(capsys):
    assert W.cmd_tests(["docs/test_nope.py"]) == W.REFUSED
    assert "not under" in capsys.readouterr().err


def test_a_missing_named_file_is_REFUSED(capsys):
    assert W.cmd_tests(["tests/test_does_not_exist_at_all.py"]) == W.REFUSED
    assert "does not exist" in capsys.readouterr().err


# ── the pod surface ─────────────────────────────────────────────────────────

def test_an_undeclared_pod_report_is_REFUSED(capsys):
    assert W.cmd_pod(["rm -rf /"]) == W.REFUSED
    assert "unknown report" in capsys.readouterr().err


def test_more_than_one_pod_argument_is_REFUSED(capsys):
    assert W.cmd_pod(["ticking", "extra"]) == W.REFUSED


def test_every_declared_pod_report_is_read_only_by_construction():
    """⛔ A DECLARED ALLOW-LIST, never a parameter."""
    for name, argv in W.POD_REPORTS.items():
        assert argv[0].startswith("tools/"), name
        assert argv[0].endswith(".py"), name
    assert set(W.POD_REPORTS) == {"ticking", "report", "gate-check"}


def test_the_pod_command_is_built_from_the_declared_argv_not_the_caller(monkeypatch):
    """The caller's string never reaches the pod — only the table's does."""
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = argv
        seen["env"] = kw.get("env") or {}

        class R:
            returncode = 0
        return R()

    monkeypatch.setattr(W.subprocess, "run", fake_run)
    assert W.cmd_pod(["ticking"]) == 0
    assert seen["argv"][:4] == ["railway", "ssh", "--service", "web"]
    assert seen["argv"][4] == "/opt/venv/bin/python tools/s7_price_level_report.py --ticking"
    # ⛔ MSYS_NO_PATHCONV or MSYS rewrites /opt/... into C:/Program Files/Git/opt/...
    assert seen["env"].get("MSYS_NO_PATHCONV") == "1"


# ── the happy path still works ──────────────────────────────────────────────

def test_a_named_test_file_is_accepted_and_run(monkeypatch):
    """NON-VACUITY CONTROL: without this, every assertion above passes on a guard
    that refuses absolutely everything, which is not the guard we want."""
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"] = argv

        class R:
            returncode = 0
        return R()

    monkeypatch.setattr(W.subprocess, "run", fake_run)
    rc = W.cmd_tests(["tests/test_weekly_exec.py"])
    assert rc == 0, "the guard refused a legitimately named test file"
    assert "tests/test_weekly_exec.py" in seen["argv"]
    assert "-q" in seen["argv"]


def test_two_named_files_are_both_passed_through(monkeypatch):
    seen = {}
    monkeypatch.setattr(W.subprocess, "run",
                        lambda argv, **kw: seen.update(argv=argv) or type("R", (), {"returncode": 0})())
    W.cmd_tests(["tests/test_weekly_exec.py", "tests/test_terminal_next_env_check.py"])
    assert "tests/test_weekly_exec.py" in seen["argv"]
    assert "tests/test_terminal_next_env_check.py" in seen["argv"]


def test_refused_is_two_and_is_not_a_pytest_failure_code():
    """pytest exits 1 for failures; a refusal must be distinguishable from one."""
    assert W.REFUSED == 2


def test_main_refuses_an_unknown_subcommand(capsys):
    assert W.main(["danger"]) == W.REFUSED
    assert "unknown subcommand" in capsys.readouterr().err
