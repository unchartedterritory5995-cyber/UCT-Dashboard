"""Run pytest against tests/pattern_engine and parse the summary."""
from __future__ import annotations

import os
import re
import subprocess


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def run() -> dict:
    cmd = ["python", "-m", "pytest", "tests/pattern_engine", "-q", "--no-header"]
    proc = subprocess.run(
        cmd, cwd=_REPO_ROOT,
        capture_output=True, text=True,
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    m = re.search(r"(\d+) passed", output)
    f = re.search(r"(\d+) failed", output)
    e = re.search(r"(\d+) error", output)
    passed = int(m.group(1)) if m else 0
    failed = int(f.group(1)) if f else 0
    errored = int(e.group(1)) if e else 0
    total = passed + failed + errored

    status = "PASS" if (failed == 0 and errored == 0 and passed > 0) else "FAIL"
    summary = f"{passed}/{total} passing"
    details_lines = ["```", *output.strip().splitlines()[-25:], "```"]
    details = "\n".join(details_lines)
    return {"status": status, "summary": summary, "details": details,
            "passed": passed, "failed": failed, "errored": errored}
