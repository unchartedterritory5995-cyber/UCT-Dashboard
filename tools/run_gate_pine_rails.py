"""Run, on a pull request, the Python rails the master deploy gate's Pine runtime job runs.

    python tools/run_gate_pine_rails.py            # run them with this interpreter
    python tools/run_gate_pine_rails.py --list     # print the commands, run nothing

⚰️ WHY (2026-11-15). The master gate went red twice in one afternoon on rails that ran ONLY in
the gate, after merge: #1318 added tests/test_pine_runtime_run_telemetry.py without naming it in
a gate step (test_pine_runtime_deploy_gate's census refuses that), then an engine bump to 55 left
tests/fixtures/pine_runtime/service_smoke.json recorded at 54. Each blocked every member-facing
deploy until someone noticed. Both would have been red on the PR.

⛔ ONE AUTHORITY. The test list is READ from `.github/workflows/master-deploy-gate.yml` (every
`/tmp/prodvenv/bin/python -m pytest ...` command in the `pine-runtime` job), never retyped here:
a second copy of the list would drift from the gate and pass PRs the gate then refuses.

Exit: 0 every command passed · 1 a command failed · 2 the gate's commands could not be read
(no job, no pytest command): "nothing found" is never a pass.
"""
from __future__ import annotations

import os
import shlex
import subprocess
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE = os.path.join(ROOT, ".github", "workflows", "master-deploy-gate.yml")
JOB = "pine-runtime"
PREFIX = "/tmp/prodvenv/bin/python -m pytest "


def gate_commands(path: str | None = None) -> list[list[str]]:
    """Each pytest command of the gate's Pine runtime job, as argv for THIS interpreter."""
    doc = yaml.safe_load(open(path or GATE, encoding="utf-8"))
    steps = ((doc.get("jobs") or {}).get(JOB) or {}).get("steps") or []
    out = []
    for step in steps:
        for line in str(step.get("run") or "").splitlines():
            line = line.strip()
            if line.startswith(PREFIX):
                out.append([sys.executable, "-m", "pytest"] + shlex.split(line[len(PREFIX):]))
    return out


def main(argv: list[str]) -> int:
    cmds = gate_commands()
    if not cmds:
        print(f"[gate-pine-rails] no pytest commands found in {JOB} of {GATE}: cannot judge")
        return 2
    if "--list" in argv:
        for c in cmds:
            print(" ".join(c[1:]))
        return 0
    worst = 0
    for c in cmds:
        print("[gate-pine-rails] $", " ".join(c[1:]), flush=True)
        rc = subprocess.call(c, cwd=ROOT)
        worst = worst or (1 if rc else 0)
    return worst


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
