"""A HANG IS NOT A KILL, AND A TIMEOUT STOPS THE WHOLE TREE (tools/mutation_check.py `--timeout`, e96 2026-11-25).

An outer `timeout` that killed only the harness once left the rail's vitest child running on the MUTATED code (7 GB)
with the mutated file still on disk. The harness now bounds each rail run itself and, on timeout, stops the rail's
whole process tree. These rails prove it with a rail that hangs only under the mutation and starts a GRANDCHILD
(a separate process, as a test runner's worker is): after the harness returns, that grandchild must be gone, the
file must be back byte for byte, and the run must say TIMED OUT, never "failed as required".
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "mutation_check.py"

IMPL = "VALUE = 'right'\n"
# The rail: green when the implementation is right; under the mutation it starts a grandchild that records its pid
# and sleeps, then sleeps itself: a hang with a live descendant.
HANG_RAIL = """import subprocess, sys, time
from pathlib import Path
here = Path(__file__).parent
if "'wrong'" not in (here / 'impl.py').read_text(encoding='utf-8'):
    sys.exit(0)
pidfile = here / 'grandchild.pid'
subprocess.Popen([sys.executable, '-c',
    'import os, sys, time; open(sys.argv[1], "w").write(str(os.getpid())); time.sleep(300)', str(pidfile)])
for _ in range(200):
    if pidfile.exists() and pidfile.read_text().strip():
        break
    time.sleep(0.05)
time.sleep(300)
"""


def _alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        try:
            code = ctypes.c_ulong()
            k32.GetExitCodeProcess(h, ctypes.byref(code))
            return code.value == 259                    # STILL_ACTIVE
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _project(tmp_path):
    (tmp_path / "impl.py").write_text(IMPL, encoding="utf-8")
    (tmp_path / "hang_rail.py").write_text(HANG_RAIL, encoding="utf-8")
    return tmp_path / "impl.py", tmp_path / "hang_rail.py"


def test_a_timed_out_rail_leaves_no_live_child_and_the_file_comes_back(tmp_path):
    impl, rail = _project(tmp_path)
    before = impl.read_bytes()
    t0 = time.time()
    r = subprocess.run([sys.executable, str(TOOL), "--file", str(impl), "--replace", "'right'", "--with", "'wrong'",
                        "--test", f'"{sys.executable}" "{rail}"', "--timeout", "4"],
                       capture_output=True, text=True, timeout=180)
    took = time.time() - t0
    assert r.returncode == 1, r.stdout + r.stderr
    assert "THE RAIL TIMED OUT after 4 s -- a hang is not a kill" in r.stdout
    assert "rail failed as required" not in r.stdout          # a hang is never reported as a kill
    assert "rail green again after restore" in r.stdout        # restored: the rail answers at once again
    assert impl.read_bytes() == before
    assert took < 120, took
    pid = int((tmp_path / "grandchild.pid").read_text().strip())
    deadline = time.time() + 15
    while _alive(pid) and time.time() < deadline:
        time.sleep(0.2)
    assert not _alive(pid), f"the rail's grandchild {pid} outlived the harness's timeout"


def test_CONTROL_a_rail_that_answers_in_time_is_judged_as_before(tmp_path):
    impl, _ = _project(tmp_path)
    quick = tmp_path / "quick_rail.py"
    quick.write_text("import sys\nfrom pathlib import Path\n"
                     "sys.exit(1 if \"'wrong'\" in (Path(__file__).parent / 'impl.py').read_text() else 0)\n",
                     encoding="utf-8")
    r = subprocess.run([sys.executable, str(TOOL), "--file", str(impl), "--replace", "'right'", "--with", "'wrong'",
                        "--test", f'"{sys.executable}" "{quick}"', "--timeout", "60"],
                       capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "rail failed as required" in r.stdout and "TIMED OUT" not in r.stdout
