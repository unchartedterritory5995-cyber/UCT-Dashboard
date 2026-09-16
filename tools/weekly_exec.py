"""The constrained execution surface for the LAYER 2 weekly autonomous run.

⛔⛔ **WHY THIS FILE EXISTS: A PERMISSION PREFIX CANNOT END MID-TOKEN.**

Measured 2026-09-14 against Claude Code 2.1.270. `Bash(...)` rules match a command
prefix at **whole-token boundaries**, so two of the constraints the weekly profile is
supposed to enforce are simply inexpressible there:

  * `Bash(python -m pytest tests/test_:*)` does **NOT** match
    `python -m pytest tests/test_terminal_next_env_check.py` — verified, it was DENIED.
    The only rule that matches is `Bash(python -m pytest tests/:*)`, and that one also
    matches the bare `python -m pytest tests/`, which is the unscoped run that reached
    18 GB and was OOM-killed. **The rule that works is the rule that permits the hazard.**
  * `Bash(railway ssh --service web "/opt/venv/bin/python tools/s7_price_level_report.py:*)`
    ends inside a quoted argument, so it cannot match either. The only rule that matches is
    `Bash(railway ssh --service web:*)` — which is an unrestricted shell on the production pod.

⭐ So the constraint moves from the profile into CODE, where it can be tested and
mutation-proved. The profile allows exactly this file and DENIES the raw forms.

Two subcommands, one job each:

  weekly_exec.py tests <file> [<file> ...]   named test FILES, never a directory
  weekly_exec.py pod <report>                one DECLARED read-only pod report
  weekly_exec.py health                      GET /api/health with a browser agent
  weekly_exec.py memory [ceiling]            percent physical memory used; 1 = at/over
  weekly_exec.py et                         the real ET; exit 1 = push window CLOSED

Exit codes: whatever the child returns, except **2 = REFUSED by this guard**, which is
never confusable with a test failure (pytest uses 1 for failures, 2 for interrupted —
so a refusal prints `REFUSED:` on stderr and the caller is told to read that, not guess).
"""
from __future__ import annotations

import datetime as dt
import os
import pathlib
import shutil
import subprocess
import sys

# ⛔ The refusal text is the only thing a caller sees when this guard fires; a
# Windows console that is not UTF-8 turns a non-ASCII character into a replacement
# glyph, so the messages are ASCII by policy and the stream is reconfigured as a
# belt-and-braces second line. Caught by the first headless probe, 2026-09-14.
try:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001 - an old or wrapped stream; the ASCII policy still holds
    pass

REPO = pathlib.Path(__file__).resolve().parents[1]

#: ⛔ DECLARED, never a parameter. Each is read-only by construction: both tools open
#: stores and print. An endpoint that took an arbitrary argv would be a remote shell.
POD_REPORTS = {
    "ticking":    ["tools/s7_price_level_report.py", "--ticking"],
    "report":     ["tools/s7_price_level_report.py"],
    "gate-check": ["tools/terminal_next_gate_check.py"],
}

#: Test files may only live here. A path outside these roots is refused.
TEST_ROOTS = ("tests", "api")

#: The only URL this guard will fetch.
HEALTH_URL = "https://uctintelligence.com/api/health"

REFUSED = 2


def _refuse(why: str) -> int:
    print("REFUSED: %s" % why, file=sys.stderr)
    return REFUSED


def cmd_tests(args: list[str]) -> int:
    if not args:
        return _refuse("name at least one test file; this guard never runs a directory")
    files = []
    for a in args:
        if a.startswith("-"):
            # ⛔ -k DOES NOT SCOPE. It selects which tests EXECUTE; every test in the
            # tree is still COLLECTED, and collection is where the memory goes
            # (--collect-only alone reached 6.6 GB). Flags are refused outright.
            return _refuse("flags are not accepted (%r) - name files; -k does not scope" % a)
        p = (REPO / a).resolve()
        try:
            rel = p.relative_to(REPO)
        except ValueError:
            return _refuse("%s is outside the repository" % a)
        if p.is_dir():
            return _refuse("%s is a DIRECTORY - an unscoped run reached 18 GB and was OOM-killed" % a)
        if rel.parts[0] not in TEST_ROOTS:
            return _refuse("%s is not under %s" % (a, "/".join(TEST_ROOTS)))
        if not p.name.startswith("test_") or p.suffix != ".py":
            return _refuse("%s is not a test_*.py file" % a)
        if not p.is_file():
            return _refuse("%s does not exist" % a)
        files.append(str(rel).replace("\\", "/"))
    env = dict(os.environ, PYTHONUTF8="1")
    r = subprocess.run([sys.executable, "-m", "pytest", "-q"] + files, cwd=str(REPO), env=env)
    return r.returncode


def cmd_pod(args: list[str]) -> int:
    if len(args) != 1:
        return _refuse("exactly one report name; known: %s" % sorted(POD_REPORTS))
    argv = POD_REPORTS.get(args[0])
    if argv is None:
        return _refuse("unknown report %r; known: %s" % (args[0], sorted(POD_REPORTS)))
    inner = "/opt/venv/bin/python " + " ".join(argv)
    # A .cmd shim on Windows; the bare name will not resolve from subprocess without
    # a shell. Found by the weekly run itself, 2026-09-14 - and it is the SAME defect
    # CLAUDE.md's rule-14 table already records for deploy_watch.py v1, while
    # flag_ledger_audit.py one directory over had already learned it. One tool knowing
    # a lesson does not teach the next one.
    exe = shutil.which("railway")
    if exe is None:
        # UNREADABLE, not "the pod said no" - a missing CLI is not a pod answer.
        return _refuse("the `railway` CLI is not on PATH - cannot read the pod")
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    r = subprocess.run([exe, "ssh", "--service", "web", inner],
                       cwd=str(REPO), env=env)
    return r.returncode


def cmd_health(args: list[str]) -> int:
    """GET /api/health with a browser agent, and print it.

    The agent is load-bearing: Cloudflare answers a default agent with `error code:
    1010`, which reads as "the site is down" and is not. Same trap the monitor hit.
    """
    if args:
        return _refuse("health takes no arguments")
    import urllib.request
    req = urllib.request.Request(
        HEALTH_URL,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) terminal-next-weekly"})
    try:
        body = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    except Exception as e:                                   # noqa: BLE001
        # UNREADABLE is not "unhealthy" - say which one happened.
        print("UNREADABLE: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 1
    print(body.strip())
    return 0


def cmd_memory(args: list[str]) -> int:
    """Percent of physical memory in use, for section 1's memory gate.

    WHY THIS EXISTS: the gate is declared "CHECKED FIRST OF ALL" and the narrow profile
    denies `systeminfo`, with no allow-listed substitute - so every run either skipped it
    silently or stopped on it. The weekly run itself reported that on 2026-09-14, and it
    is the F-L2-1 shape one layer down: a check that CANNOT RUN looks identical to one
    that PASSED.

    Exit 0 under the ceiling, 1 at or over it, REFUSED if it cannot be measured - three
    states, because "I could not read the memory" is not "there is memory".
    """
    ceiling = 70.0
    if args:
        try:
            ceiling = float(args[0])
        except ValueError:
            return _refuse("ceiling must be a number, got %r" % args[0])
    used = None
    try:
        import ctypes

        class _MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = _MS()
        m.dwLength = ctypes.sizeof(_MS)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
            used = float(m.dwMemoryLoad)
    except Exception:                                    # noqa: BLE001
        pass
    if used is None:
        try:
            info = {}
            for line in open("/proc/meminfo"):
                k, v = line.split(":", 1)
                info[k] = float(v.strip().split()[0])
            tot, avail = info["MemTotal"], info.get("MemAvailable", info.get("MemFree", 0))
            used = 100.0 * (tot - avail) / tot
        except Exception:                                # noqa: BLE001
            return _refuse("cannot read physical memory on this platform")
    print("MEMORY %.1f%% used (ceiling %.0f%%)" % (used, ceiling))
    return 0 if used < ceiling else 1


def push_window_closed(et) -> bool:
    """Is the master-push window closed at this ET datetime?

    Mon-Fri 09:00-16:00 ET. Pure, so it can be tested at a named instant instead of
    whenever the suite happens to run - the bug this whole subcommand exists for was a
    time READING, and a rail that reads the same clock proves nothing.
    """
    return et.weekday() < 5 and 9 <= et.hour < 16


def cmd_et(args: list[str]) -> int:
    """The Eastern time, and whether the master-push window is open.

    WHY THIS EXISTS, and it cost a broken rule to learn: on this box
    `TZ=America/New_York date` in Git Bash IGNORES TZ and prints UTC labelled GMT. Read
    at 18:49 it looks like 18:49 ET; the true ET was 14:49. Acting on that reading, three
    commits were pushed to master at 14:26 ET - inside the 09:00-16:00 window they were
    explicitly being held out of. flow-worker was SKIPPED so no tape was lost, but the
    rule was broken by arithmetic, not by judgement.

    A clock that is wrong by four hours and CONFIDENT is worse than no clock. This is the
    one authority; never hand-roll the conversion again.
    """
    if args:
        return _refuse("et takes no arguments")
    try:
        from zoneinfo import ZoneInfo
    except ImportError:                                  # noqa: BLE001
        return _refuse("zoneinfo unavailable - cannot resolve ET, and guessing is the bug")
    now = dt.datetime.now(dt.timezone.utc)
    et = now.astimezone(ZoneInfo("America/New_York"))
    closed = push_window_closed(et)
    print("UTC %s | ET %s | master-push window: %s"
          % (now.strftime("%Y-%m-%d %H:%M"), et.strftime("%Y-%m-%d %H:%M %Z %a"),
             "CLOSED (Mon-Fri 09:00-16:00 ET)" if closed else "open"))
    return 1 if closed else 0


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "pytest" in sys.modules and argv is None:
        a = []
    if not a:
        print(__doc__.strip().splitlines()[0])
        print("usage: weekly_exec.py tests <file> [...] | pod <report> | health | memory")
        return REFUSED
    sub, rest = a[0], a[1:]
    if sub == "tests":
        return cmd_tests(rest)
    if sub == "pod":
        return cmd_pod(rest)
    if sub == "health":
        return cmd_health(rest)
    if sub == "memory":
        return cmd_memory(rest)
    if sub == "et":
        return cmd_et(rest)
    return _refuse("unknown subcommand %r" % sub)


if __name__ == "__main__":
    raise SystemExit(main())
