"""The Sunday gate must PRINT its verdict under Task Scheduler's cp1252 stdout.

⚰️ 2026-09-20 17:05 CT: `nb_gate.py` wrote `wave-q1-gate-verdict.md`, then died at
`print(body)` with `UnicodeEncodeError: 'charmap' codec can't encode characters`
(`C:\\Users\\Patrick\\uct-q1-observe\\gate.run.log`), so the scheduled task read
Last Result 1 on the one run of the week that decides keep-or-revert. The wrapper
now sets PYTHONIOENCODING - a LOCAL fix. The repo copy must not depend on it, so
the gate carries the same guarded `reconfigure` block `tools/window_check.py` and
`tools/nb_soak.py` already carry.

These rails run the real `nb_gate.main()` in a CHILD process whose stdout is a
FILE (what Task Scheduler gives it) with the encoding variables removed, over a
fixture log whose verdict body carries U+26A0 (a SKIPPED row's warning line).

⛔ NON-VACUITY FIRST: a control proves the child environment really is cp1252 -
the same bare `print` WITHOUT the gate fails with the charmap error. Without that
control, a box whose locale happens to be UTF-8 would pass the rail over a
condition it never reproduced.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
NL = chr(10)
DASH = chr(8212)
WARN = "\u26a0"

# The two child environments. "stripped" is the brief's shape and the real Task
# Scheduler condition, but it only reproduces cp1252 where the LOCALE is cp1252
# (this Windows box). "forced" names cp1252 explicitly, so the same rail means the
# same thing on any platform.
ENVS = ("stripped", "forced-cp1252")

_RUN_GATE = ("import sys; sys.path.insert(0, sys.argv[1]); import nb_gate; "
             "sys.exit(nb_gate.main())")
_BARE_PRINT = "print('\\u26a0 bare print, no gate')"


def _fixture_log(path: pathlib.Path) -> pathlib.Path:
    """The live log's 9-column header, one OK row and one SKIPPED row - the
    SKIPPED row is what puts the U+26A0 warning line into the verdict body."""
    path.write_text(NL.join([
        "# Wave Q1 observation log (fixture)",
        "",
        "| at (ET) | latest opt-in (UTC) | opt-in (windowed) | config-served (members) "
        "| blocked-baseline | sync-conflict notes | outbox (rig only, layer off) "
        "| console errors (rig) | flag |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-09-26 20:00 ET | 2026-09-27 00:00:53 | 10 | 0/0 " + DASH
        + " no member reported | 0 | 3 | 0 | 0 | OK |",
        "| 2026-09-26 22:00 ET | " + DASH + " | " + DASH + " | " + DASH + " | "
        + DASH + " | " + DASH + " | " + DASH + " | 0 | **SKIPPED** " + DASH
        + " production unreachable (HTTP 5xx) |",
        "",
    ]) + NL, encoding="utf-8")
    return path


def _env(tmp_path: pathlib.Path, kind: str) -> dict:
    env = {k: v for k, v in os.environ.items()
           if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
    if kind == "forced-cp1252":
        env["PYTHONIOENCODING"] = "cp1252"
    env["NB_OBSERVE_LOG"] = str(_fixture_log(tmp_path / "obs.md"))
    env["NB_GATE_VERDICT"] = str(tmp_path / "verdict.md")
    # No resume doc and no sweep tool: trigger 3 reads n/a and the DO-NOT-BUILD
    # line reads DID NOT RUN, both in well under a second. The gate is read-only
    # against both, so pointing them at nothing changes no verdict logic.
    env["NB_RESUME_DOC"] = str(tmp_path / "no-resume.md")
    env["NB_GATE_REPO"] = str(tmp_path / "no-repo")
    return env


def _child(code: str, env: dict, tmp_path: pathlib.Path, *args: str):
    out = tmp_path / "stdout.bin"
    with open(out, "wb") as fh:          # a FILE, as Task Scheduler's >> gives it
        proc = subprocess.run([sys.executable, "-c", code, *args], env=env,
                              stdout=fh, stderr=subprocess.PIPE, timeout=300)
    return proc, out.read_bytes()


def _skip_if_locale_is_utf8(kind: str) -> None:
    if kind == "stripped" and sys.platform != "win32":
        pytest.skip("the stripped env reproduces cp1252 only where the locale is "
                    "cp1252; the forced-cp1252 case carries this rail on this platform")


@pytest.mark.parametrize("kind", ENVS)
def test_CONTROL_the_child_environment_really_is_cp1252(kind, tmp_path):
    """Without this, the rail below could pass on a condition it never built."""
    _skip_if_locale_is_utf8(kind)
    proc, _ = _child(_BARE_PRINT, _env(tmp_path, kind), tmp_path)
    err = proc.stderr.decode("utf-8", "replace")
    assert proc.returncode != 0 and "charmap" in err, (
        "the child printed U+26A0 to a redirected stdout without error, so this "
        f"environment is not the Task Scheduler condition (rc={proc.returncode}): {err[-400:]}")


@pytest.mark.parametrize("kind", ENVS)
def test_the_gate_prints_its_verdict_under_a_cp1252_stdout(kind, tmp_path):
    _skip_if_locale_is_utf8(kind)
    env = _env(tmp_path, kind)
    proc, out = _child(_RUN_GATE, env, tmp_path, str(TOOLS))
    err = proc.stderr.decode("utf-8", "replace")
    assert proc.returncode == 0, f"the gate exited {proc.returncode}: {err[-800:]}"
    assert "Traceback" not in err, err[-800:]
    text = out.decode("utf-8")
    # ⭐ The glyph that crashed 2026-09-20, in what was PRINTED - not only in the
    # file the gate wrote before it printed.
    assert WARN in text, "the printed verdict lost its U+26A0 warning line"
    assert "VERDICT:" in text and "SKIPPED row(s)" in text
    written = pathlib.Path(env["NB_GATE_VERDICT"]).read_text(encoding="utf-8")
    assert WARN in written
    # The printed body IS the written body (the gate prints what it wrote).
    assert written.strip() in text.replace("\r\n", "\n")
