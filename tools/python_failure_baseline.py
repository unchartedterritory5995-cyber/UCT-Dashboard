"""Record — and later re-check — the pre-existing Python test failures.

Two modes:

  sweep    run every test file in batches by EXPLICIT PATH and write a baseline
  check    re-run a named subset and compare against the recorded baseline

⛔ NEVER `pytest tests/` AND NEVER `-k`. Collection alone over the whole tree has
reached 6.6 GB here and a full run reached 18 GB before the OOM killer took it;
`-k` filters AFTER collection, so it contains nothing. Batches of explicit paths,
sequential, with free memory checked before each one, is the only safe shape.

⭐ THREE EXIT CODES in `check`, because they are three different facts:
    0  the red set matches the baseline
    1  it changed — a baseline failure started PASSING (update the baseline) or a
       NEW failure appeared (someone broke something)
    2  INCONCLUSIVE — a batch could not run at all. Never a pass.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(REPO, "docs", "test-baseline", "python-failures.json")
MIN_FREE_GB = 3.0


class _MEMSTATUS(ctypes.Structure):
    _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


def free_gb() -> float:
    """Free physical memory. ctypes, because psutil is not installed here and a
    PowerShell call per batch would cost more than the measurement is worth."""
    try:
        m = _MEMSTATUS()
        m.dwLength = ctypes.sizeof(_MEMSTATUS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return round(m.ullAvailPhys / (1024 ** 3), 2)
    except Exception:
        return -1.0


def test_files() -> list[str]:
    out = []
    for root in ("tests", "api"):
        base = os.path.join(REPO, root)
        for dirpath, _d, files in os.walk(base):
            for f in files:
                if f.startswith("test_") and f.endswith(".py"):
                    out.append(os.path.relpath(os.path.join(dirpath, f), REPO).replace(os.sep, "/"))
    return sorted(out)


def parse_junit(path: str) -> dict:
    """Failures and errors from one batch, with their class and message."""
    res = {"failures": [], "counts": {}}
    try:
        root = ET.parse(path).getroot()
    except Exception as e:
        res["parse_error"] = str(e)[:120]
        return res
    suites = [root] if root.tag == "testsuite" else list(root)
    tot = fail = err = skip = 0
    for s in suites:
        tot += int(s.get("tests") or 0)
        fail += int(s.get("failures") or 0)
        err += int(s.get("errors") or 0)
        skip += int(s.get("skipped") or 0)
        for tc in s.iter("testcase"):
            for kind in ("failure", "error"):
                node = tc.find(kind)
                if node is not None:
                    msg = (node.get("message") or "").strip().replace("\n", " ")
                    res["failures"].append({
                        "file": tc.get("classname", "").replace(".", "/") + ".py",
                        "test": tc.get("name"),
                        "classname": tc.get("classname"),
                        "kind": kind,
                        "message": msg[:300],
                    })
    res["counts"] = {"tests": tot, "failures": fail, "errors": err, "skipped": skip}
    return res


def run_batch(files: list[str], xml: str, timeout_s: int = 900) -> tuple[int, str]:
    cmd = [sys.executable, "-m", "pytest", *files, "-q", "-p", "no:cacheprovider",
           "--timeout=120", "--junitxml=" + xml]
    try:
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True,
                           timeout=timeout_s, encoding="utf-8", errors="replace")
        return p.returncode, (p.stdout or "")[-800:]
    except subprocess.TimeoutExpired:
        return -9, "BATCH TIMEOUT after %ss" % timeout_s


def sweep(batch_size: int, out_dir: str, limit: int | None = None) -> int:
    os.makedirs(out_dir, exist_ok=True)
    files = test_files()
    if limit:
        files = files[:limit]
    batches = [files[i:i + batch_size] for i in range(0, len(files), batch_size)]
    started = time.time()
    summary = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "batch_size": batch_size,
               "total_files": len(files), "batches": len(batches),
               "failures": [], "unrunnable": [], "counts":
                   {"tests": 0, "failures": 0, "errors": 0, "skipped": 0},
               "min_free_gb": free_gb(), "batch_log": []}
    prog = os.path.join(out_dir, "progress.json")

    def flush():
        summary["elapsed_s"] = round(time.time() - started)
        with open(prog, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=1)

    for i, b in enumerate(batches, 1):
        fg = free_gb()
        summary["min_free_gb"] = min(summary["min_free_gb"], fg)
        if 0 < fg < MIN_FREE_GB:
            summary["unrunnable"].append({"batch": i, "files": b,
                                          "reason": "PAUSED: free memory %.2f GB < %.1f GB"
                                                    % (fg, MIN_FREE_GB)})
            flush()
            print("PAUSE: free memory %.2f GB below floor - stopping sweep" % fg, flush=True)
            break
        xml = os.path.join(out_dir, "batch-%03d.xml" % i)
        rc, tail = run_batch(b, xml)
        if rc in (2, 3, -9) or not os.path.exists(xml):
            # crash, interrupt or timeout -> split once and retry each half
            half = max(1, len(b) // 2)
            for j, sub in enumerate((b[:half], b[half:]), 1):
                if not sub:
                    continue
                x2 = os.path.join(out_dir, "batch-%03d-%d.xml" % (i, j))
                rc2, tail2 = run_batch(sub, x2)
                if rc2 in (2, 3, -9) or not os.path.exists(x2):
                    summary["unrunnable"].append(
                        {"batch": "%d.%d" % (i, j), "files": sub,
                         "reason": "rc=%s %s" % (rc2, tail2[-200:])})
                else:
                    r = parse_junit(x2)
                    summary["failures"].extend(r["failures"])
                    for k, v in r["counts"].items():
                        summary["counts"][k] += v
        else:
            r = parse_junit(xml)
            summary["failures"].extend(r["failures"])
            for k, v in r["counts"].items():
                summary["counts"][k] += v
        summary["batch_log"].append({"batch": i, "rc": rc, "free_gb": fg, "n": len(b)})
        print("batch %3d/%d rc=%-3s free=%.2fGB fails=%d"
              % (i, len(batches), rc, fg, len(summary["failures"])), flush=True)
        flush()
    flush()
    print("SWEEP DONE in %ss - %d failing/erroring tests, %d unrunnable groups"
          % (summary["elapsed_s"], len(summary["failures"]), len(summary["unrunnable"])),
          flush=True)
    return 0


def check(files: list[str], out_dir: str) -> int:
    """Re-run a named subset and compare its red set to the baseline."""
    if not os.path.exists(BASELINE):
        print("INCONCLUSIVE: no baseline at %s" % BASELINE)
        return 2
    with open(BASELINE, encoding="utf-8") as fh:
        base = json.load(fh)
    os.makedirs(out_dir, exist_ok=True)
    xml = os.path.join(out_dir, "check.xml")
    rc, tail = run_batch(files, xml)
    if rc in (2, 3, -9) or not os.path.exists(xml):
        print("INCONCLUSIVE: the subset could not run (rc=%s)\n%s" % (rc, tail[-300:]))
        return 2
    got = {"%s::%s" % (f["classname"], f["test"]) for f in parse_junit(xml)["failures"]}
    want = {k for k in base.get("ids", []) if any(k.startswith(f.replace("/", ".").rstrip(".py"))
                                                  for f in files)} or set(base.get("ids", []))
    want = {w for w in want if any(os.path.basename(f)[:-3] in w for f in files)}
    started_passing = sorted(want - got)
    newly_red = sorted(got - want)
    if not started_passing and not newly_red:
        print("OK: red set matches the baseline (%d)" % len(got))
        return 0
    for t in started_passing:
        print("  NOW PASSING (baseline needs updating): %s" % t)
    for t in newly_red:
        print("  NEW FAILURE: %s" % t)
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("sweep", "check"))
    ap.add_argument("--batch-size", type=int, default=20)
    ap.add_argument("--out", default=os.path.join(REPO, "scratchpad-pytest-baseline"))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--files", nargs="*", default=None)
    a = ap.parse_args()
    if a.mode == "sweep":
        return sweep(a.batch_size, a.out, a.limit)
    if not a.files:
        print("INCONCLUSIVE: check needs --files")
        return 2
    return check(a.files, a.out)


if __name__ == "__main__":
    raise SystemExit(main())
