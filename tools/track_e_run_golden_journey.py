#!/usr/bin/env python3
"""Track E runner -- fires tests/test_golden_journey_04_05_live.py the moment
a scoped Anthropic dev/test credential exists in this environment, with no
further setup.

    python tools/track_e_run_golden_journey.py

This does exactly what GOLDEN_JOURNEY_04_05_READY_TO_RUN.md's own prepared
command does:

    ANTHROPIC_API_KEY=... INDICATOR_VISION_ENABLED=1 \\
        pytest tests/test_golden_journey_04_05_live.py -v -rs -s

plus two things a bare pytest invocation doesn't give you:

  * A pre-flight check that BOTH gates (the key, the vision flag) are set
    BEFORE spawning pytest, with a clear, specific message about which is
    missing and why -- rather than a wall of skip reasons after the fact.
  * The full pytest output written to a timestamped log file under
    tools/_track_e_runs/ (gitignored-by-convention alongside this repo's
    other tools/_*_out/ working directories), so the exact evidence survives
    the terminal scrollback for the write-up step in
    GOLDEN_JOURNEY_04_05_READY_TO_RUN.md's "Evidence-capture plan".

⛔ THIS SCRIPT NEVER PRINTS, LOGS, OR ECHOES THE KEY VALUE. It only checks
`bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())` -- exactly the same
presence check tests/test_golden_journey_04_05_live.py itself uses -- and lets
pytest's own subprocess environment carry the real value. The log file it
writes is pytest's stdout/stderr, which the test file itself never prints the
key into (confirmed by reading it in full).

What this script deliberately does NOT do: interpret the results. Per DEC-008
and this program's own discipline against silent-wrong-answer classification,
judging whether an ambiguous-prompt response was handled correctly, or which
of sma/ema the model picked, is exactly the kind of semantic judgment that
belongs to whoever reviews the run (today: the agent that invoked this
script, reasoning over the captured log), not to a script pattern-matching
pytest output.
"""

from __future__ import annotations

import datetime
import os
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
LOG_DIR = os.path.join(_HERE, "_track_e_runs")
TEST_PATH = os.path.join("tests", "test_golden_journey_04_05_live.py")


def _has_real_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def _vision_on() -> bool:
    return os.environ.get("INDICATOR_VISION_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


def preflight() -> list[str]:
    """Returns a list of blocker messages; empty means ready to run."""
    blockers = []
    if not _has_real_key():
        blockers.append(
            "ANTHROPIC_API_KEY is not set. This must be a scoped, isolated-"
            "environment-only dev/test key per DEC-008 -- never the production "
            "key, never used against member data."
        )
    if not _vision_on():
        blockers.append(
            "INDICATOR_VISION_ENABLED is not '1'. Golden Journey #5 (screenshot "
            "door) needs this set, and per DEC-008 it must be set ONLY in this "
            "same isolated environment, never globally or in production."
        )
    return blockers


def run() -> int:
    blockers = preflight()
    if blockers:
        print("TRACK E: NOT READY TO RUN.")
        for b in blockers:
            print(f"  - {b}")
        print(
            "\nOnce both are set in this process's environment, re-run this "
            "script with no arguments -- it will proceed automatically."
        )
        return 2

    os.makedirs(LOG_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = os.path.join(LOG_DIR, f"golden_journey_04_05_{stamp}.log")

    cmd = [sys.executable, "-m", "pytest", TEST_PATH, "-v", "-rs", "-s"]
    print(f"Running: {' '.join(cmd)}")
    print(f"(env: ANTHROPIC_API_KEY=<set, {len(os.environ['ANTHROPIC_API_KEY'])} chars>, "
          f"INDICATOR_VISION_ENABLED={os.environ.get('INDICATOR_VISION_ENABLED')!r})")
    proc = subprocess.run(cmd, cwd=_ROOT, capture_output=True, text=True)
    output = proc.stdout + proc.stderr

    with open(log_path, "w", encoding="utf-8") as fh:
        fh.write(output)

    print(output)
    print(f"\nFull output also saved to: {log_path}")
    print(f"pytest exit code: {proc.returncode}")
    print(
        "\nNEXT (manual, deliberately not automated by this script): review the "
        "captured evidence above, classify each case's outcome, write "
        "GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md (mirroring "
        "CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md's structure), and update "
        "VALIDATION_COVERAGE_MAP.md's plain-language/screenshot rows to '4 -- "
        "End-to-End' ONLY if every check actually passed live."
    )
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(run())
