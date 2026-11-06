"""The range-scan step's states, EXECUTED against synthetic repositories.

SD-1.2 B2 gates L1 on "six-state rails green". When that gate was read on 2026-09-15
the rails did not exist: the six states had been exercised BY HAND in an earlier
session and never encoded, so the only evidence they worked was a transcript. A check
that was only ever run by hand is the defect class this programme keeps finding, and
it is the one this file closes.

WHAT IS UNDER TEST IS THE SHIPPED TEXT. The `run:` body is read out of
`.github/workflows/master-deploy-gate.yml` and executed. It is never copied here — a
copy would agree with itself forever no matter what the workflow later said
(`lesson_a_second_authority_over_one_value`), which is precisely the failure the step
itself was written to avoid.

⛔ THIS FILE MUST NEVER CONTAIN THE CREDENTIAL SHAPES IT PLANTS. The needle is
assembled at runtime by concatenation — the same device `tools/secret_scrub.py` uses
on itself — because a literal here would be found by the repo's own scanner, by the
pre-commit hook, and by the very gate step this file tests, which would refuse the
push that ships the rail.
"""

from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
import sys

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "master-deploy-gate.yml"
FINDING_DOC = REPO / "docs" / "breadth" / "range-scan-finding.md"
SCANNER = REPO / "tools" / "secret_scrub.py"

# The step is located by a fragment of its NAME, so renaming or deleting it fails this
# file loudly instead of silently testing nothing.
STEP_NAME_FRAGMENT = "whole range"

ACTIONS_EXPR_RE = re.compile(r"\$\{\{\s*([^}]*?)\s*\}\}")
TEST_BEFORE_VAR = "UCT_TEST_BEFORE"

# A commit-shaped object id present in none of the repositories built here.
# ⛔ Deliberately NOT starting with 0000000: the step treats that prefix as "new ref",
# which is a DIFFERENT state, so a carelessly chosen base would exercise state 1 while
# the test claimed state 2 — a fixture that cannot distinguish is not a rail.
UNREACHABLE_SHA = "deadbeef" * 5

# Assembled, never written out. See the module docstring.
PLANTED_CREDENTIAL = "authorization" + ": " + "Bearer " + "Z" * 24
BENIGN_TEXT = "nothing sensitive here\n"

_BASH = shutil.which("bash")


# --------------------------------------------------------------------------- shipped


def _step() -> dict:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = doc["jobs"]["gate"]["steps"]
    found = [s for s in steps if STEP_NAME_FRAGMENT in (s.get("name") or "")]
    assert len(found) == 1, (
        f"expected exactly one step whose name contains {STEP_NAME_FRAGMENT!r}, "
        f"found {len(found)}: {[s.get('name') for s in steps]}"
    )
    return found[0]


def _script() -> str:
    """The shipped body, executed as-is.

    Since 2026-11-06 the body has NO Actions expressions: the `github.event.before`
    fallback was removed, because falling back to the push's own range was the gap itself.
    CONTROL: an expression added later would reach bash as a literal `${{ … }}` and could
    change the branch taken, so the run would no longer be the run CI performs.
    """
    body = _step()["run"]
    exprs = set(ACTIONS_EXPR_RE.findall(body))
    assert exprs == set(), f"unexpected GitHub expressions in the step body: {sorted(exprs)}"
    return body


# ----------------------------------------------------------------------------- rigging


def _git(root: pathlib.Path, *args: str) -> str:
    # ⛔ never `text=True` — that decodes with the locale codec (cp1252) on Windows
    # while git emits UTF-8. Same rule as tools/secret_scrub.py::_git.
    r = subprocess.run(["git", "-C", str(root), *args],
                       capture_output=True, encoding="utf-8", errors="replace")
    assert r.returncode == 0, f"git {' '.join(args)} -> {r.returncode}\n{r.stdout}{r.stderr}"
    return r.stdout


def _new_repo(root: pathlib.Path) -> pathlib.Path:
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init", "-q")
    # Fixture-only configuration: a throwaway repository must not inherit the
    # operator's identity or signing key. This is not a bypass on any real commit.
    _git(root, "config", "user.email", "rails@example.invalid")
    _git(root, "config", "user.name", "range-scan rails")
    _git(root, "config", "commit.gpgsign", "false")
    return root


def _commit(root: pathlib.Path, message: str, files: dict | None = None,
            allow_empty: bool = False) -> str:
    for name, text in (files or {}).items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")
        _git(root, "add", "--", name)
    args = ["commit", "-q", "-m", message] + (["--allow-empty"] if allow_empty else [])
    _git(root, *args)
    return _git(root, "rev-parse", "HEAD").strip()


def _set_production(root: pathlib.Path, sha: str) -> None:
    _git(root, "update-ref", "refs/remotes/origin/production", sha)


def _install_scanner(root: pathlib.Path) -> None:
    """The CLEAN/FINDING branches shell out to `python tools/secret_scrub.py`.

    Copied UNTRACKED on purpose: a tracked copy would land in the very `git diff` the
    step scans, so the fixture would be scanning the scanner — and `secret_scrub.py`
    is one of its own PATTERN_FILES, which would make that self-scan pass for the
    wrong reason.
    """
    dest = root / "tools" / "secret_scrub.py"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SCANNER, dest)


def _run(root: pathlib.Path, before: str = "") -> subprocess.CompletedProcess:
    assert _BASH, "bash is required to execute the shipped step body"
    env = dict(os.environ)
    env[TEST_BEFORE_VAR] = before
    env["GITHUB_SHA"] = _git(root, "rev-parse", "HEAD").strip()
    return subprocess.run([_BASH, "-c", _script()], cwd=str(root), env=env,
                          capture_output=True, encoding="utf-8", errors="replace")


# ------------------------------------------------------------------------- the states


def _build_no_range(root):
    _new_repo(root)
    _commit(root, "base", {"README.md": "base\n"})
    return {"before": ""}


def _build_inconclusive(root):
    """origin/production resolves to an id whose object is not in the clone."""
    _new_repo(root)
    _commit(root, "base", {"README.md": "base\n"})
    ref = root / ".git" / "refs" / "remotes" / "origin" / "production"
    ref.parent.mkdir(parents=True, exist_ok=True)
    ref.write_text(UNREACHABLE_SHA + "\n", encoding="ascii", newline="\n")
    return {"before": ""}


def _build_diff_failed(root):
    """production's commit is present but its TREE is not, so `git diff` itself errors.

    Before 2026-11-06 the failure was swallowed by a pipe into `tr`, the file list came back
    empty, and the step logged NOTHING-TO-SCAN and passed.
    """
    _new_repo(root)
    base = _commit(root, "base", {"README.md": "base\n"})
    tree = _git(root, "rev-parse", f"{base}^{{tree}}").strip()
    _set_production(root, base)
    _commit(root, "ahead", {"README.md": "changed\n"})
    obj = root / ".git" / "objects" / tree[:2] / tree[2:]
    os.chmod(obj, 0o644)   # git writes objects read-only; Windows will not unlink those
    obj.unlink()
    _install_scanner(root)
    return {"before": ""}


def _build_scanner_error(root):
    """The range resolved, but the scanner cannot run (it is absent)."""
    _new_repo(root)
    base = _commit(root, "base", {"README.md": "base\n"})
    _set_production(root, base)
    _commit(root, "benign change", {"notes.md": BENIGN_TEXT})
    return {"before": ""}


def _build_nothing_ahead(root):
    _new_repo(root)
    head = _commit(root, "base", {"README.md": "base\n"})
    _set_production(root, head)
    return {"before": ""}


def _build_nothing_to_scan(root):
    _new_repo(root)
    base = _commit(root, "base", {"README.md": "base\n"})
    _set_production(root, base)
    _commit(root, "an empty commit", allow_empty=True)
    return {"before": ""}


def _build_clean(root):
    _new_repo(root)
    base = _commit(root, "base", {"README.md": "base\n"})
    _set_production(root, base)
    _commit(root, "benign change", {"notes.md": BENIGN_TEXT})
    _install_scanner(root)
    return {"before": ""}


def _build_finding(root):
    _new_repo(root)
    base = _commit(root, "base", {"README.md": "base\n"})
    _set_production(root, base)
    _commit(root, "a change carrying a credential shape", {"leaked.md": PLANTED_CREDENTIAL + "\n"})
    _install_scanner(root)
    return {"before": ""}


STATES = {
    "NO RANGE":        (_build_no_range,        "range-scan: NO RANGE"),
    "INCONCLUSIVE":    (_build_inconclusive,    "range-scan: INCONCLUSIVE"),
    "DIFF FAILED":     (_build_diff_failed,     "range-scan: DIFF FAILED"),
    "SCANNER ERROR":   (_build_scanner_error,   "range-scan: SCANNER ERROR"),
    "NOTHING AHEAD":   (_build_nothing_ahead,   "range-scan: NOTHING AHEAD"),
    "NOTHING-TO-SCAN": (_build_nothing_to_scan, "verdict=NOTHING-TO-SCAN"),
    "CLEAN":           (_build_clean,           "range-scan: verdict=CLEAN"),
    "FINDING":         (_build_finding,         "range-scan: verdict=FINDING"),
}

# docs/breadth/range-scan-finding.md, "counts toward promotion?" — the criterion is
# `EXECUTED` AND `verdict=CLEAN`, and only CLEAN satisfies both.
COUNTS_TOWARD_PROMOTION = {"CLEAN"}

# Every state that could not prove the range clean. NOTHING AHEAD and NOTHING-TO-SCAN
# resolved their range (nothing ahead, or only deletions), so they pass.
FAILS_THE_GATE = {"NO RANGE", "INCONCLUSIVE", "DIFF FAILED", "SCANNER ERROR", "FINDING"}


def _slug(state: str) -> str:
    return state.replace(" ", "_").lower()


def _range_scan_lines(stdout: str) -> str:
    return "\n".join(ln for ln in stdout.splitlines() if ln.startswith("range-scan:"))


# ------------------------------------------------------------------------------ rails


@pytest.mark.parametrize("state", list(STATES))
def test_each_state_is_reached_and_named(tmp_path, state):
    build, expected = STATES[state]
    root = tmp_path / _slug(state)
    r = _run(root, **build(root))
    assert expected in r.stdout, f"{state}\nstdout={r.stdout!r}\nstderr={r.stderr!r}"
    # GATING since 2026-11-06: a finding FAILS, and so does every state that could not
    # compare. Only states whose range resolved may pass.
    want = 1 if state in FAILS_THE_GATE else 0
    assert r.returncode == want, f"{state} exited {r.returncode}, wanted {want}: {r.stdout!r} {r.stderr!r}"


@pytest.mark.parametrize("state", list(STATES))
def test_only_a_clean_execution_counts_toward_promotion(tmp_path, state):
    """The promotion criterion is a CONJUNCTION, and that is the load-bearing half.

    `NOTHING-TO-SCAN` prints `EXECUTED` and must NOT count: a rail that checked only
    for `EXECUTED` would bank the exact runs that compared nothing, which is the
    vacuity the INCONCLUSIVE state was invented to prevent.
    """
    build, _ = STATES[state]
    root = tmp_path / ("count_" + _slug(state))
    out = _run(root, **build(root)).stdout
    counts = ("range-scan: EXECUTED" in out) and ("verdict=CLEAN" in out)
    assert counts is (state in COUNTS_TOWARD_PROMOTION), f"{state}: {out!r}"


def test_the_fixture_can_tell_the_six_states_apart(tmp_path):
    """Non-vacuity: six builders that all produced the same line would pass every
    assertion above by coincidence (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`)."""
    seen = {}
    for state, (build, _) in STATES.items():
        root = tmp_path / ("distinct_" + _slug(state))
        seen[state] = _range_scan_lines(_run(root, **build(root)).stdout)
    assert all(seen.values()), f"a state printed no range-scan line at all: {seen}"
    assert len(set(seen.values())) == len(STATES), seen


def test_the_clean_verdict_is_not_reached_by_scanning_nothing(tmp_path):
    """CLEAN over zero files is the failure mode this whole step exists to refuse."""
    root = tmp_path / "clean_nonvacuous"
    out = _run(root, **_build_clean(root)).stdout
    assert "files=1" in out, out
    assert "verdict=CLEAN" in out, out


def test_the_planted_credential_is_one_the_scanner_actually_finds(tmp_path):
    """Control for the FINDING state at the source.

    If the needle ever stopped matching, FINDING would quietly degrade into CLEAN.
    Assert the shape against the scanner directly, and assert the CLEAN fixture's own
    file is genuinely clean — otherwise the two states could agree for a third reason.
    """
    planted = tmp_path / "planted.md"
    planted.write_text(PLANTED_CREDENTIAL + "\n", encoding="utf-8", newline="\n")
    r = subprocess.run([sys.executable, str(SCANNER), "--scan", str(planted)],
                       capture_output=True, encoding="utf-8", errors="replace")
    assert r.returncode == 1, f"the planted shape is no longer a finding: {r.stdout!r}"

    benign = tmp_path / "benign.md"
    benign.write_text(BENIGN_TEXT, encoding="utf-8", newline="\n")
    r2 = subprocess.run([sys.executable, str(SCANNER), "--scan", str(benign)],
                        capture_output=True, encoding="utf-8", errors="replace")
    assert r2.returncode == 0, f"the CLEAN fixture's file is not clean: {r2.stdout!r}"


def test_a_scanner_crash_is_not_reported_as_a_finding(tmp_path):
    """The scanner exits 1 on a finding AND on an uncaught crash. A crash must read as
    SCANNER ERROR (wrong advice otherwise: "rotate it"), never as FINDING or CLEAN."""
    root = tmp_path / "scanner_crash"
    _build_clean(root)
    (root / "tools" / "secret_scrub.py").write_text("raise SystemExit(1)\n", encoding="utf-8", newline="\n")
    r = _run(root)
    assert "range-scan: SCANNER ERROR" in r.stdout, r.stdout
    assert "verdict=FINDING" not in r.stdout and "verdict=CLEAN" not in r.stdout, r.stdout
    assert r.returncode == 1, f"exited {r.returncode}: {r.stdout!r}"


@pytest.mark.parametrize("name", ["dir with spaces/leak.md", "café/leak.md"])
def test_a_credential_in_an_awkward_path_is_found(tmp_path, name):
    """Paths with spaces or non-ASCII names used to be split or quoted, reach the scanner as
    names that do not exist, and be skipped silently: CLEAN with the secret unscanned."""
    root = tmp_path / ("awkward_" + str(abs(hash(name))))
    _new_repo(root)
    base = _commit(root, "base", {"README.md": "base\n"})
    _set_production(root, base)
    _commit(root, "a credential in an awkward path", {name: PLANTED_CREDENTIAL + "\n"})
    _install_scanner(root)
    r = _run(root)
    assert "range-scan: verdict=FINDING" in r.stdout, f"{r.stdout!r} {r.stderr!r}"
    assert r.returncode == 1


def test_many_files_are_scanned_in_chunks_and_all_counted(tmp_path):
    """More files than one chunk: every chunk must run, and a finding in the LAST chunk counts."""
    root = tmp_path / "chunks"
    _new_repo(root)
    base = _commit(root, "base", {"README.md": "base\n"})
    _set_production(root, base)
    files = {f"bulk/f{i:04d}.md": BENIGN_TEXT for i in range(905)}
    files["bulk/zz_last.md"] = PLANTED_CREDENTIAL + "\n"
    _commit(root, "many files", files)
    _install_scanner(root)
    r = _run(root)
    assert "files=906" in r.stdout, r.stdout[-400:]
    assert "range-scan: verdict=FINDING" in r.stdout, r.stdout[-400:]
    assert r.returncode == 1


def test_the_body_under_test_is_the_shipped_gating_step(tmp_path):
    """Provenance control: prove we executed the real thing, not a stub, and that it gates."""
    step = _step()
    body = step["run"]
    # GATING since 2026-11-06 (SD-1.1 A2.5 criterion met). Re-adding continue-on-error, or
    # an `if:` that can skip it, would turn it back into a scan that cannot stop anything.
    assert "continue-on-error" not in step, "the range scan gates: it must not be continue-on-error"
    assert "if" not in step, "the range scan must run on every gate"
    assert "ADVISORY" not in (step.get("name") or "")
    # The fetch is the fix for the vacuous first draft; without it every base is
    # unreachable and the step reports INCONCLUSIVE forever.
    assert "git fetch --no-tags" in body and "--depth=" in body
    assert body.rstrip().endswith("exit 1"), "the gating step's last line is the FINDING failure"
    assert len(body) > 800, f"body is {len(body)} chars — too short to be the shipped step"


def test_the_step_emits_no_state_this_file_leaves_uncovered():
    """A seventh state added to the workflow fails here rather than shipping untested."""
    body = _step()["run"]
    labels = set(re.findall(r"range-scan: ([A-Z][A-Z -]*[A-Z])", body))
    labels |= set(re.findall(r"verdict=([A-Z][A-Z-]*)", body))
    unknown = labels - set(STATES) - {"EXECUTED"}
    assert not unknown, f"the step can emit states this file does not cover: {sorted(unknown)}"


def test_the_documented_table_names_every_state_the_step_can_emit():
    """The doc's promotion table and the shipped step are one decision, not two."""
    text = FINDING_DOC.read_text(encoding="utf-8")
    missing = [s for s in STATES if s not in text]
    assert not missing, f"emitted by the step, absent from {FINDING_DOC.name}: {missing}"
