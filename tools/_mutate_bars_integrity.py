"""Mutation harness for the bars-integrity + alert-lookback rails.

⭐ THE VERDICT IS A BARE EXIT CODE. `subprocess.run` with no pipe, no capture, no
`| grep` — `lesson_mutation_harness_needs_a_control` and the pipe that swallowed
a non-zero status are both in this repo's history.

⭐ CONTROL A RUNS FIRST AND ABORTS ON ZERO TESTS. A suite that collected nothing
is green, and every mutation below would then "die" for the wrong reason.

⭐ EVERY MUTATION IS PROVEN APPLIED — the file's sha256 must change AND the
mutated text must be present — before its verdict is taken, and the sha is
verified RESTORED afterwards.

⚠️ `__pycache__` IS PURGED BETWEEN RUNS. A same-length edit can leave a stale
`.pyc` that the next interpreter happily reuses, which reads as a mutation that
did not kill anything.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys

LF = chr(10)
CRLF = chr(13) + chr(10)

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

SUITE = [
    "tests/test_bars_split_repair.py",
    "tests/test_bars_write_invariant.py",
    "tests/test_alert_lookback_window.py",
    "tests/test_bars_sanitize.py",
    "tests/test_bar_validation.py",
]

#: (label, path, old, new). `old` must appear EXACTLY once.
MUTATIONS = [
    ("split: the boundary window collapses to the declared date",
     "api/services/bars_sanitize.py",
     "_SPLIT_BOUNDARY_WINDOW = 7", "_SPLIT_BOUNDARY_WINDOW = 0"),
    ("split: the factor is applied one bar late",
     "api/services/bars_sanitize.py",
     "if bar_date < boundary:", "if bar_date <= boundary:"),
    ("split: the serve path stops telling the store",
     "api/services/bars_sanitize.py",
     "                _schedule_store_repair(ticker, tf)",
     "                pass  # _schedule_store_repair(ticker, tf)"),
    ("split: the repair writes nothing",
     "api/services/bars_split_repair.py",
     "    written = bars_sqlite.put_bars(ticker, tf, plan[\"rows\"], date_tf=False)",
     "    written = 0  # bars_sqlite.put_bars(ticker, tf, plan[\"rows\"])"),
    ("lookback: the shortfall is always zero",
     "api/services/ast_interpret.py",
     "    return max(0, max_lookback(ast) - have)", "    return 0"),
    ("lookback: the floor goes back to 200",
     "api/services/indicator_alert_evaluator.py",
     "BARS_MIN = 400", "BARS_MIN = 200"),
    ("lookback: the user column stops refusing",
     "api/services/alert_user_series.py",
     "        if short:\n            return [None] * len(bars)",
     "        if False:\n            return [None] * len(bars)"),
    ("invariant: the open-above-high rule is deleted",
     "api/services/bar_validation.py",
     "    if h < o:\n        reasons.append(\"H<O\")",
     "    if False:\n        reasons.append(\"H<O\")"),
    ("invariant: finiteness is no longer asked",
     "api/services/bar_validation.py",
     "        if not math.isfinite(f):", "        if False and not math.isfinite(f):"),
    ("invariant: put_bars stops consulting it",
     "api/services/bars_sqlite.py",
     "    if os.environ.get(\"BARS_WRITE_VALIDATION\", \"1\") == \"0\":\n        return list(bars), []",
     "    if True:\n        return list(bars), []"),
    ("invariant: the snapshot merge gate is removed",
     "api/services/data_sync.py",
     "                  AND s.h >= s.l AND s.h >= s.o AND s.h >= s.c",
     "                  AND s.h >= s.l                                "),
    ("precision: the store goes back to 2 decimal places",
     "api/services/bars_fetch.py", "PRICE_DP = 4", "PRICE_DP = 2"),
    ("deepfill: the pytest guard is removed",
     "api/services/bars_fetch.py",
     "    if _os.environ.get(\"PYTEST_CURRENT_TEST\"):\n        return",
     "    if False:\n        return"),
]


def _sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _purge_pycache() -> None:
    for base, dirs, _files in os.walk(os.path.join(ROOT, "api")):
        for d in list(dirs):
            if d == "__pycache__":
                shutil.rmtree(os.path.join(base, d), ignore_errors=True)
                dirs.remove(d)


def _run_suite() -> int:
    """Bare exit code. NO pipe, NO capture — the verdict is the status."""
    _purge_pycache()
    return subprocess.run(
        [sys.executable, "-m", "pytest", *SUITE, "-q", "-p", "no:randomly",
         "--no-header", "-x", "--tb=no", "-q"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


_ANSI = re.compile(r"\[[0-9;]*m")


def _collected() -> int:
    """How many tests the suite COLLECTS. Zero is the abort condition: a suite
    that collected nothing exits 0, and every mutation below would then read as
    having killed something."""
    out = subprocess.run(
        [sys.executable, "-m", "pytest", *SUITE, "--collect-only", "-q",
         "-p", "no:randomly", "--color=no"],
        cwd=ROOT, capture_output=True, text=True, errors="replace")
    return len([l for l in _ANSI.sub("", out.stdout).splitlines() if "::" in l])


def main() -> int:
    print("CONTROL A — the suite, unmutated")
    n = _collected()
    print(f"  collected: {n}")
    if n == 0:
        print("  ABORT: zero tests collected; every verdict below would be a lie")
        return 2
    rc = _run_suite()
    print(f"  exit code: {rc}")
    if rc != 0:
        print("  ABORT: the control is not green")
        return 2

    survivors = []
    for label, rel, old, new in MUTATIONS:
        path = os.path.join(ROOT, rel)
        before = _sha(path)
        with open(path, "r", encoding="utf-8", newline="") as f:
            src = f.read()
        # ANCHORS ARE WRITTEN WITH A BARE NEWLINE AND THE TREE IS CRLF.
        # Reading with newline='' preserves the bytes (so the restore is
        # byte-exact), which means a multi-line anchor must be translated to
        # the FILE'S ending or it matches zero times and the harness aborts on
        # its own anchor.
        eol = CRLF if CRLF in src else LF
        old = old.replace(LF, eol)
        new = new.replace(LF, eol)
        count = src.count(old)
        if count != 1:
            print(f"\n{label}\n  ABORT: anchor appears {count}x in {rel}")
            return 2
        try:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(src.replace(old, new))
            after = _sha(path)
            applied = after != before and new in open(
                path, encoding="utf-8", newline="").read()
            print(f"\n{label}\n  file: {rel}\n  applied: {applied}")
            if not applied:
                print("  ABORT: the mutation did not reach the file")
                return 2
            rc = _run_suite()
            print(f"  exit code: {rc}   -> {'DIED' if rc else 'SURVIVED'}")
            if rc == 0:
                survivors.append(label)
        finally:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(src)
            restored = _sha(path)
            print(f"  restored: {restored == before}")
            if restored != before:
                raise SystemExit("ABORT: the artifact was not restored")

    print(f"\n{len(MUTATIONS) - len(survivors)}/{len(MUTATIONS)} mutations died")
    for s in survivors:
        print(f"  SURVIVED: {s}")
    _purge_pycache()
    return 1 if survivors else 0


if __name__ == "__main__":
    raise SystemExit(main())
