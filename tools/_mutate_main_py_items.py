"""Mutation harness for the health-route gates and the split-sweep schedule.

⭐ THE VERDICT IS A BARE EXIT CODE. `subprocess.run` with no pipe, no capture,
no `| grep` — `lesson_mutation_harness_needs_a_control`, and the pipe that once
swallowed a non-zero status, are both in this repo's history.

⭐ CONTROL A RUNS FIRST AND ABORTS ON ZERO TESTS. A suite that collected nothing
exits 0, and every mutation below would then "die" for the wrong reason.

⭐ EVERY MUTATION IS PROVEN APPLIED — the file's sha256 must change AND the
mutated text must be present — before its verdict is taken, and the sha is
verified RESTORED afterwards.

⭐ THE OVER-GATE IS MUTATED TOO. A gate that blocks everyone is not a fix, so
one mutation ADDS `require_admin` to `/api/watchdog/status`; if that survives,
the "these stay anonymous" control is decoration.

⚠️ `__pycache__` IS PURGED BETWEEN RUNS. A same-length edit can leave a stale
`.pyc` that the next interpreter happily reuses, which reads as a mutation that
killed nothing (`lesson_python_pycache_defeats_same_length_mutation`).
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
    "tests/test_health_routes_admin_gated.py",
    "tests/test_bars_split_repair_sweep_scheduled.py",
    "tests/test_admin_guard_registered.py",
]

MAIN = "api/main.py"
WD = "api/event_loop_watchdog.py"

#: (label, path, old, new). `old` must appear EXACTLY once.
MUTATIONS = [
    # ── the gates come off, one route at a time ─────────────────────────────
    ("gate: /api/health/thread-stacks goes back to anonymous", MAIN,
     "def health_thread_stacks(_admin: dict = Depends(require_admin)):",
     "def health_thread_stacks():"),
    ("gate: /api/health/threads goes back to anonymous", MAIN,
     "def health_threads(_admin: dict = Depends(require_admin)):",
     "def health_threads():"),
    ("gate: /api/health/cache goes back to anonymous", MAIN,
     "def health_cache(_admin: dict = Depends(require_admin)):",
     "def health_cache():"),
    ("gate: /api/watchdog/stacks goes back to anonymous", WD,
     "def watchdog_stacks(_admin: dict = Depends(require_admin)):",
     "def watchdog_stacks():"),
    # ── …and the other direction: the gate spreads where it must not ────────
    ("over-gate: /api/watchdog/status is gated too", WD,
     "def watchdog_status():  # no auth",
     "def watchdog_status(_admin: dict = Depends(require_admin)):  # no auth"),

    # ── the schedule ────────────────────────────────────────────────────────
    ("schedule: the lifespan stops calling the registration", MAIN,
     "            if register_bars_split_repair_sweep(_scheduler):",
     "            if False:  # register_bars_split_repair_sweep(_scheduler)"),
    ("schedule: the fire time is hand-typed instead of derived", MAIN,
     "        trigger=CronTrigger(hour=fire_at.hour, minute=fire_at.minute, timezone=_ET),",
     "        trigger=CronTrigger(hour=2, minute=30, timezone=_ET),                     "),
    ("schedule: the kill switch stops unregistering it", MAIN,
     "    if not bars_split_repair.enabled():\n        return False",
     "    if False:\n        return False"),

    # ── the job body ────────────────────────────────────────────────────────
    ("body: the no-metadata vacuity guard is removed", MAIN,
     '    if not (os.environ.get("FMP_API_KEY") or "").strip():',
     '    if False:  # (os.environ.get("FMP_API_KEY") or "").strip()      '),
    ("body: the slice runs past the universe and double-counts", MAIN,
     "    take = min(_SPLIT_SWEEP_MAX_TICKERS, n)",
     "    take = _SPLIT_SWEEP_MAX_TICKERS         "),
    ("body: per-ticker isolation is removed", MAIN,
     "        except Exception as e:                                 # noqa: BLE001\n"
     '            log.warning("[split-sweep] %s failed: %s", ticker, e)\n'
     '            summary["failed"] += 1\n'
     "            continue",
     "        except KeyboardInterrupt as e:                         # noqa: BLE001\n"
     '            log.warning("[split-sweep] %s failed: %s", ticker, e)\n'
     '            summary["failed"] += 1\n'
     "            continue"),
    ("body: the deadline stops bounding the run", MAIN,
     "        if deadline is not None and datetime.now(_ET) >= deadline:",
     "        if False:  # deadline is not None and datetime.now(_ET)     "),
    ("body: the cursor never advances", MAIN,
     "    _split_sweep_cursor = (start + take) % n",
     "    _split_sweep_cursor = start              "),
    ("body: a split-less ticker is sent to the store anyway", MAIN,
     "        if not splits:\n            summary[\"no_splits\"] += 1\n            continue",
     "        if False:\n            summary[\"no_splits\"] += 1\n            continue"),
]


def _sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _purge_pycache() -> None:
    for sub in ("api", "tests"):
        for base, dirs, _files in os.walk(os.path.join(ROOT, sub)):
            for d in list(dirs):
                if d == "__pycache__":
                    shutil.rmtree(os.path.join(base, d), ignore_errors=True)
                    dirs.remove(d)


def _run_suite() -> int:
    """Bare exit code. NO pipe, NO capture — the verdict IS the status."""
    _purge_pycache()
    return subprocess.run(
        [sys.executable, "-m", "pytest", *SUITE, "-q", "-p", "no:randomly",
         "--no-header", "-x", "--tb=no"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


_ANSI = re.compile(r"\[[0-9;]*m")


def _collected() -> int:
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
        # Anchors are written with a bare newline; the tree is CRLF. Reading with
        # newline='' preserves the bytes (so the restore is byte-exact), which
        # means a multi-line anchor must be translated to the FILE'S ending or it
        # matches zero times and the harness aborts on its own anchor.
        eol = CRLF if CRLF in src else LF
        o = old.replace(LF, eol)
        nw = new.replace(LF, eol)
        count = src.count(o)
        if count != 1:
            print(f"\n{label}\n  ABORT: anchor appears {count}x in {rel}")
            return 2
        try:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(src.replace(o, nw))
            after = _sha(path)
            with open(path, encoding="utf-8", newline="") as f:
                present = nw in f.read()
            applied = after != before and present
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
