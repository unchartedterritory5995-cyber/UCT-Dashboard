"""The gate's compensating control, EXECUTED against synthetic remotes.

`production` has no branch protection (G6 is OWNER-PENDING). SD-1.2 B1.3 let the
cutover proceed on a workflow-side tripwire instead, and SD-1.3 C2.2 is that tripwire:
at the start of every gate run, `production` must be where the last recorded promotion
left it, or the run halts before any scan and names the SHA.

A control whose failing path has never been executed is a decoration — this repo has
paid for that several times — so the run body is read out of the SHIPPED workflow and
executed, never copied here, against a real (local, bare) origin carrying real
branches.

⚠️ WHAT THIS CANNOT PROVE: that the control is sufficient. It is DETECTIVE, not
preventive, and it only looks when master is pushed. Both limits are stated in the
workflow beside the step and in docs/breadth/deploy-gate-v2.md. Branch protection is
the preventive half and no test can stand in for it.
"""
from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "master-deploy-gate.yml"
STEP_NAME_FRAGMENT = "last promotion left it"
RECORD_PATH = "last-promotion.json"
STATE_BRANCH = "deploy-gate-state"

_BASH = shutil.which("bash")


def _step() -> dict:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = doc["jobs"]["gate"]["steps"]
    found = [s for s in steps if STEP_NAME_FRAGMENT in (s.get("name") or "")]
    assert len(found) == 1, (
        f"expected exactly one step naming {STEP_NAME_FRAGMENT!r}; "
        f"found {[s.get('name') for s in steps]}"
    )
    return found[0]


def _git(root, *args, check=True):
    r = subprocess.run(["git", "-C", str(root), *args],
                       capture_output=True, encoding="utf-8", errors="replace")
    if check:
        assert r.returncode == 0, f"git {' '.join(args)} -> {r.returncode}\n{r.stdout}{r.stderr}"
    return r.stdout.strip()


def _commit(root, msg, files=None, allow_empty=False):
    for name, text in (files or {}).items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")
        _git(root, "add", "--", name)
    args = ["commit", "-q", "-m", msg] + (["--allow-empty"] if allow_empty else [])
    _git(root, "-c", "user.email=r@example.invalid", "-c", "user.name=rail",
         "-c", "commit.gpgsign=false", *args)
    return _git(root, "rev-parse", "HEAD")


def _rig(tmp, *, production: str | None, record: str | None, foreign_author=False):
    """A bare origin + a working clone, shaped to reach one of the control's states.

    `production`: "match" | "foreign" | None (branch absent)
    `record`:     "match" | "stale" | "no-sha" | None (file absent)
    """
    origin = tmp / "origin.git"
    work = tmp / "work"
    subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True,
                   capture_output=True)
    work.mkdir()
    _git(work, "init", "-q")
    _git(work, "remote", "add", "origin", str(origin))
    _git(work, "config", "user.email", "r@example.invalid")
    _git(work, "config", "user.name", "rail")
    _git(work, "config", "commit.gpgsign", "false")

    master_sha = _commit(work, "base", {"README.md": "base\n"})
    _git(work, "push", "-q", "origin", "HEAD:refs/heads/master")

    foreign_sha = None
    if production == "match":
        _git(work, "push", "-q", "origin", f"{master_sha}:refs/heads/production")
        prod_sha = master_sha
    elif production == "foreign":
        if foreign_author:
            _git(work, "-c", "user.email=stranger@example.invalid",
                 "-c", "user.name=A Stranger", "-c", "commit.gpgsign=false",
                 "commit", "-q", "--allow-empty", "-m", "pushed straight to production")
        else:
            _commit(work, "direct push", allow_empty=True)
        foreign_sha = _git(work, "rev-parse", "HEAD")
        _git(work, "push", "-q", "origin", f"{foreign_sha}:refs/heads/production")
        _git(work, "reset", "-q", "--hard", master_sha)
        prod_sha = foreign_sha
    else:
        prod_sha = None

    if record is not None:
        body = {
            "match": '{"promoted_sha": "%s"}\n' % master_sha,
            "stale": '{"promoted_sha": "%s"}\n' % ("d" * 40),
            "no-sha": '{"ts": "2026-01-01T00:00:00Z"}\n',
        }[record]
        state = tmp / "state"
        state.mkdir()
        _git(state, "init", "-q")
        _git(state, "remote", "add", "origin", str(origin))
        _git(state, "config", "user.email", "r@example.invalid")
        _git(state, "config", "user.name", "rail")
        _git(state, "config", "commit.gpgsign", "false")
        _git(state, "checkout", "-q", "--orphan", STATE_BRANCH)
        (state / RECORD_PATH).write_text(body, encoding="utf-8", newline="\n")
        _git(state, "add", "--", RECORD_PATH)
        _git(state, "commit", "-q", "-m", "record")
        _git(state, "push", "-q", "origin", f"HEAD:refs/heads/{STATE_BRANCH}")

    return work, master_sha, prod_sha


def _run(work: pathlib.Path):
    assert _BASH, "bash is required to execute the shipped step body"
    env = dict(os.environ)
    return subprocess.run([_BASH, "-c", _step()["run"]], cwd=str(work), env=env,
                          capture_output=True, encoding="utf-8", errors="replace")


STATES = {
    "MATCH":                 (dict(production="match",  record="match"),  0, "promotion-control: MATCH"),
    "MISMATCH":              (dict(production="foreign", record="match"), 1, "promotion-control: MISMATCH"),
    "NO RECORD":             (dict(production="match",  record=None),     0, "promotion-control: NO RECORD"),
    "NO PRODUCTION BRANCH":  (dict(production=None,     record="match"),  0, "promotion-control: NO PRODUCTION BRANCH"),
    "UNREADABLE RECORD":     (dict(production="match",  record="no-sha"), 0, "promotion-control: UNREADABLE RECORD"),
}


@pytest.mark.parametrize("state", list(STATES))
def test_each_state_is_reached_and_named(tmp_path, state):
    rig, want_rc, want = STATES[state]
    work, _, _ = _rig(tmp_path, **rig)
    r = _run(work)
    assert want in r.stdout, f"{state}\nstdout={r.stdout!r}\nstderr={r.stderr!r}"
    assert r.returncode == want_rc, f"{state}: exit {r.returncode}, want {want_rc}\n{r.stdout}"


def test_only_a_real_divergence_fails_the_gate(tmp_path):
    """The whole point: exactly one state halts the run.

    A control that failed on 'no record yet' would be turned off within a day; one
    that passed on a real divergence would be decoration.
    """
    failing = []
    for state, (rig, _, _) in STATES.items():
        work, _, _ = _rig(tmp_path / state.replace(" ", "_"), **rig)
        if _run(work).returncode != 0:
            failing.append(state)
    assert failing == ["MISMATCH"], failing


def test_the_mismatch_names_the_sha_and_the_author(tmp_path):
    """A tripwire that says 'something is wrong' and not WHAT is a pager, not a control."""
    work, master_sha, foreign = _rig(tmp_path, production="foreign", record="match",
                                     foreign_author=True)
    r = _run(work)
    assert foreign[:12] in r.stdout, f"the foreign SHA is not named: {r.stdout!r}"
    assert master_sha[:12] in r.stdout, f"the recorded SHA is not named: {r.stdout!r}"
    assert "::error" in r.stdout, "a divergence must surface as a GitHub error annotation"
    assert "A Stranger" in r.stdout or "stranger@example.invalid" in r.stdout, \
        f"the author of the foreign commit is not named: {r.stdout!r}"


def test_the_control_runs_before_any_scan(tmp_path):
    """Ordering is load-bearing: C2.2 says halt BEFORE scanning, not after."""
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    names = [(s.get("name") or s.get("uses") or "") for s in doc["jobs"]["gate"]["steps"]]
    ctrl = next(i for i, n in enumerate(names) if STEP_NAME_FRAGMENT in n)
    scans = [i for i, n in enumerate(names) if "Secret scan" in n]
    assert scans, "no secret-scan steps found — this test is checking nothing"
    assert ctrl < min(scans), f"control at {ctrl}, first scan at {min(scans)}: {names}"


def test_the_body_under_test_is_the_shipped_one():
    """Provenance control — prove we executed the real step, not a stub."""
    body = _step()["run"]
    assert "ls-remote origin refs/heads/production" in body
    assert f"origin/{STATE_BRANCH}:{RECORD_PATH}" in body
    assert "exit 1" in body, "a control with no failing path is not a control"
    assert len(body) > 600, f"body is {len(body)} chars — too short to be the shipped step"


def test_the_step_emits_no_state_this_file_leaves_uncovered():
    """A sixth state added to the control fails here rather than shipping untested."""
    body = _step()["run"]
    labels = set(re.findall(r"promotion-control: ([A-Z][A-Z ]*[A-Z])", body))
    unknown = labels - set(STATES)
    assert not unknown, f"states the control can emit but this file does not cover: {sorted(unknown)}"
