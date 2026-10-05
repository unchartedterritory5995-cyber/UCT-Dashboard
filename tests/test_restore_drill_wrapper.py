"""The weekly restore-drill wrapper fails LOUD and SAFE when its checkout is missing.

Wave 14 lane OPS. On 2026-10-04 the scheduled drill's checkout did not exist, the old wrapper's
`cd /d` failed silently, Python ran from C:\\Windows\\System32 and the run logged `DRILL exit=2`
-- the code an honest INCONCLUSIVE drill also returns. These rails prove the replacement:

  * the guard refuses a missing / incomplete / non-root / off-ref checkout, with exit 4;
  * a refusal writes a FAIL report `nb_soak.parse_drill` reads as FAIL (not "no drill report");
  * the alert goes through the soak's own `send`, and a failed send is said, not swallowed;
  * the real `.cmd` (Windows only) aborts with 4 on a missing checkout WITHOUT running the
    drill, and runs it (exit passed through) on a good one.

Every checkout here is a temp directory. The real `notebook-soak-ref` is never touched.
"""
from __future__ import annotations

import datetime as dt
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import restore_drill_guard as guard  # noqa: E402
import nb_soak  # noqa: E402

CMD = REPO / "tools" / "restore_drill_weekly.cmd"
GIT = shutil.which("git")
needs_git = pytest.mark.skipif(GIT is None, reason="git not on PATH")
needs_windows = pytest.mark.skipif(os.name != "nt", reason="the wrapper is a Windows batch file")

STUB_DRILL = (
    "import sys\n"
    "print('STUB DRILL RAN', sys.argv[1:])\n"
    "sys.exit(int(__import__('os').environ.get('STUB_RC', '0')))\n"
)


def _git(cwd: Path, *args: str) -> str:
    r = subprocess.run([GIT, "-C", str(cwd), *args], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def make_checkout(root: Path, on_ref: bool = True) -> Path:
    """A throwaway git checkout holding a stub drill, with `origin/master` as a local ref."""
    repo = root / "soak-ref"
    (repo / "tools").mkdir(parents=True)
    (repo / "tools" / "authdb_restore_drill.py").write_text(STUB_DRILL, encoding="utf-8")
    _git(repo, "init", "-q")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base")
    _git(repo, "update-ref", "refs/remotes/origin/master", "HEAD")
    if not on_ref:
        (repo / "x.txt").write_text("feature", encoding="utf-8")
        _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
        _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "feature")
    return repo


# ── the guard's checks ──────────────────────────────────────────────────────────────────────

def test_a_missing_checkout_is_refused(tmp_path):
    why = guard.check(tmp_path / "notebook-soak-ref", "origin/master")
    assert why and why.startswith("checkout missing")


def test_a_checkout_without_the_drill_is_refused(tmp_path):
    (tmp_path / "empty").mkdir()
    why = guard.check(tmp_path / "empty", "origin/master")
    assert why and why.startswith("checkout incomplete")


@needs_git
def test_a_directory_inside_another_repo_is_not_a_checkout_root(tmp_path):
    repo = make_checkout(tmp_path)
    inner = repo / "nested"
    (inner / "tools").mkdir(parents=True)
    (inner / "tools" / "authdb_restore_drill.py").write_text("", encoding="utf-8")
    why = guard.check(inner, "origin/master")
    assert why and why.startswith("not a checkout root")


@needs_git
def test_a_checkout_off_the_expected_ref_is_refused(tmp_path):
    repo = make_checkout(tmp_path, on_ref=False)
    why = guard.check(repo, "origin/master")
    assert why and why.startswith("wrong ref")


@needs_git
def test_a_good_checkout_passes_CONTROL(tmp_path):
    """Control: without it every refusal above could be a guard that refuses everything."""
    repo = make_checkout(tmp_path)
    assert guard.check(repo, "origin/master") is None
    assert guard.main(["--repo", str(repo), "--drills", str(tmp_path / "d")]) == 0
    assert not (tmp_path / "d").exists(), "a pass must write no report"


# ── the failure half ────────────────────────────────────────────────────────────────────────

def test_a_refusal_writes_a_report_the_soak_reads_as_FAIL(tmp_path):
    sent = []
    now = dt.datetime(2026, 10, 4, 14, 0, 1, tzinfo=dt.timezone.utc)
    rc = guard.fail("checkout missing: X", tmp_path / "drills", now=now,
                    send=lambda items, hook: sent.append(items))
    assert rc == guard.EXIT_PREFLIGHT == 4
    report = (tmp_path / "drills" / "drill-2026-10-04-preflight.md").read_text(encoding="utf-8")
    parsed = nb_soak.parse_drill(report)
    assert parsed == {"result": "FAIL", "at": now}
    assert sent and "checkout missing: X" in sent[0][0][1]


def test_a_failed_alert_is_said_not_swallowed(tmp_path, capsys):
    def boom(items, hook):
        raise OSError("no network")
    assert guard.fail("why", tmp_path, send=boom) == 4
    assert "ALERT NOT sent: OSError: no network" in capsys.readouterr().out


def test_RD_NO_ALERT_suppresses_the_send_and_says_so(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RD_NO_ALERT", "1")
    called = []
    assert guard.fail("why", tmp_path, send=lambda *a: called.append(a)) == 4
    assert not called
    assert "ALERT suppressed (RD_NO_ALERT=1)" in capsys.readouterr().out


# ── the real wrapper, end to end (Windows) ──────────────────────────────────────────────────

def run_wrapper(tmp_path: Path, repo: Path, **extra) -> tuple[int, str]:
    observe = tmp_path / "observe"
    observe.mkdir(exist_ok=True)
    env = {**os.environ, "RD_REPO": str(repo), "RD_OBSERVE": str(observe),
           "RD_PY": sys.executable, "RD_NO_ALERT": "1", **extra}
    r = subprocess.run(["cmd", "/c", str(CMD)], env=env, capture_output=True, text=True,
                       timeout=120)
    log = (observe / "restore_drill.run.log").read_text(encoding="utf-8", errors="replace")
    return r.returncode, log


@needs_windows
def test_the_wrapper_ABORTS_on_a_missing_checkout_and_never_runs_the_drill(tmp_path):
    rc, log = run_wrapper(tmp_path, tmp_path / "notebook-soak-ref")
    assert rc == 4, log
    assert "PREFLIGHT FAIL: checkout missing" in log
    assert "DRILL exit=4" in log
    assert "STUB DRILL RAN" not in log and "System32" not in log
    reports = list((tmp_path / "observe" / "soak-drills").glob("drill-*-preflight.md"))
    assert len(reports) == 1 and nb_soak.parse_drill(reports[0].read_text("utf-8"))["result"] == "FAIL"


@needs_windows
@needs_git
def test_the_wrapper_ABORTS_on_a_checkout_off_the_ref(tmp_path):
    rc, log = run_wrapper(tmp_path, make_checkout(tmp_path, on_ref=False))
    assert rc == 4, log
    assert "PREFLIGHT FAIL: wrong ref" in log and "STUB DRILL RAN" not in log


@needs_windows
@needs_git
def test_the_wrapper_RUNS_the_drill_on_a_good_checkout_and_passes_its_exit_CONTROL(tmp_path):
    repo = make_checkout(tmp_path)
    rc, log = run_wrapper(tmp_path, repo, STUB_RC="2")
    assert "PREFLIGHT OK" in log and "STUB DRILL RAN" in log, log
    assert rc == 2 and "DRILL exit=2" in log
    assert "--report" in log and "soak-drills" in log


@needs_windows
def test_the_wrapper_file_is_CRLF_on_disk():
    """cmd.exe mis-parses labels and goto in an LF-only batch file."""
    b = CMD.read_bytes()
    assert b.count(b"\n") == b.count(b"\r\n") > 0
