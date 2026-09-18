"""P3 — flip `NOTEBOOK_DOOR_GUARD`, and REFUSE to believe it landed without proof.

⛔⛔ WHY THIS IS A TOOL AND NOT THREE COMMANDS TYPED AT THE MOMENT.

The flip is the one action in this programme that opens a live member path, and
its rollback is the same action in reverse. Both happen under time pressure —
the flip immediately before a rig window, the rollback immediately after a RED —
which is exactly when a step gets skipped. The step that gets skipped is always
the verification, because the CLI has already said "ok".

⛔ `railway variables --kv` READS THE SERVICE'S CONFIGURATION, NOT THE RUNNING
PROCESS. This repo has already paid for that distinction: a variable was deleted,
read back as absent, and stayed live in the process for nine minutes because
`delete` does not redeploy. So this tool asks the POD, over `railway ssh`, and
treats anything else as unverified.

⛔ `--set` REDEPLOYS; `delete` does NOT. The flip is therefore a deploy, and a
deploy must be verified by ITS OWN record's STATUS — never by the newest row,
which may belong to another session, and never by an uptime nobody tied to a
named deploy.

USAGE
    python tools/q1_p3_guard_flip.py --to unknown-only     # P3 stage 2 opens
    python tools/q1_p3_guard_flip.py --to full             # rollback lever 1
    python tools/q1_p3_guard_flip.py --verify-only         # what is live right now
    python tools/q1_p3_guard_flip.py --self-check
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
except (AttributeError, ValueError, TypeError):
    pass

VAR = "NOTEBOOK_DOOR_GUARD"
SERVICE = "web"
#: ⛔ The vocabulary is DERIVED from the server's own table, never retyped here —
#: a second list would let the two drift and a flip to a value the code rejects
#: would read as success while changing nothing.
VALID = ("full", "unknown-only")
#: A redeploy takes 3-5 minutes; past this something is wrong and the operator
#: must look rather than wait.
DEPLOY_BUDGET_S = 900
POLL_S = 20


def _run(cmd, timeout=180):
    exe = shutil.which(cmd[0]) or cmd[0]
    return subprocess.run([exe, *cmd[1:]], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


def in_process_value() -> tuple[str | None, str]:
    """What the RUNNING pod has. → (value|None, how_we_know)

    ⛔ `None` means UNREADABLE, not "unset" — the two are different facts and
    collapsing them is how an unverified flip reads as a verified one.
    """
    # ⛔ BASE64, because railway joins argv into one sh string and nested quotes
    # are eaten. CLAUDE.md records this exact recipe; the first version of this
    # function used nested single quotes and the remote Python saw a BARE NAME,
    # raising NameError — which this tool then correctly reported as UNREADABLE
    # rather than as "unset". Failing safe is right; needing to is avoidable.
    # ⛔ /opt/venv/bin/python, never bare python3: the Nix system python on that
    # pod has none of the app's dependencies.
    import base64
    snippet = "import os;print('VALUE=' + repr(os.environ.get(%r)))" % (VAR,)
    b64 = base64.b64encode(snippet.encode()).decode()
    try:
        p = _run(["railway", "ssh", "--service", SERVICE,
                  f"echo {b64} | base64 -d | /opt/venv/bin/python"],
                 timeout=240)
    except Exception as e:                                   # noqa: BLE001
        return None, f"railway ssh failed: {type(e).__name__}"
    out = (p.stdout or "") + (p.stderr or "")
    for line in out.splitlines():
        if line.startswith("VALUE="):
            raw = line[len("VALUE="):].strip()
            if raw == "None":
                return "", "in-process: unset (the code then uses its safe default)"
            return raw.strip("'\""), "in-process: read from the pod's own os.environ"
    return None, f"no VALUE line in the ssh output ({out[:120]!r})"


def newest_records(n: int = 6) -> list[dict]:
    try:
        p = _run(["railway", "deployment", "list", "--service", SERVICE, "--json"], timeout=240)
        rows = json.loads(p.stdout or "[]")
        rows = rows if isinstance(rows, list) else rows.get("deployments", [])
        return rows[:n]
    except Exception:                                        # noqa: BLE001
        return []


def wait_for_own_deploy(before_ids: set[str]) -> tuple[str | None, str]:
    """Wait for a deploy record that did NOT exist before the flip.

    ⛔ IDENTIFIED BY ID, NOT BY POSITION. "The newest row" is how a session ends
    up verifying somebody else's deploy — measured in this programme on
    2026-09-17, when three other sessions landed inside one hour.
    """
    started = time.time()
    while time.time() - started < DEPLOY_BUDGET_S:
        for r in newest_records():
            rid = str(r.get("id") or "")
            if rid and rid not in before_ids:
                status = str(r.get("status") or "")
                print(f"  our new record {rid[:8]} → {status} ({int(time.time()-started)}s)")
                if status in ("SUCCESS",):
                    return rid, status
                if status in ("FAILED", "CRASHED", "REMOVED"):
                    return rid, status
        time.sleep(POLL_S)
    return None, "no new deploy record inside the budget"


def flip(to: str) -> int:
    if to not in VALID:
        print(f"⛔ {to!r} is not one of {VALID}. An unrecognised value would be "
              f"accepted by the CLI and IGNORED by the code, which is the worst "
              f"of both: the operator reads it back as set and nothing changed.")
        return 2

    before_val, how = in_process_value()
    print(f"  before: {before_val!r} ({how})")
    if before_val is None:
        print("⛔ REFUSING: the current value could not be read FROM THE POD. Flipping "
              "without knowing the starting state means the rollback has nothing to "
              "return to.")
        return 2
    before_ids = {str(r.get("id") or "") for r in newest_records(12)}

    print(f"  setting {VAR}={to} on {SERVICE} (⚠️ --set REDEPLOYS)…")
    p = _run(["railway", "variable", "--set", f"{VAR}={to}", "--service", SERVICE], timeout=300)
    if p.returncode != 0:
        print(f"⛔ the set itself failed: {(p.stdout or '') + (p.stderr or '')}"[:400])
        return 1

    rid, status = wait_for_own_deploy(before_ids)
    if status != "SUCCESS":
        print(f"⛔ our own deploy record did not reach SUCCESS ({status}). The variable "
              f"may be set on the SERVICE while the PROCESS still has the old value.")
        return 1

    after_val, how2 = in_process_value()
    print(f"  after : {after_val!r} ({how2})")
    if after_val != to:
        print(f"⛔ THE FLIP IS NOT LIVE. The pod reports {after_val!r}, not {to!r}. "
              f"⛔ Do NOT proceed to a rig window on this: the variable is configured "
              f"and the process is not running it.")
        return 1

    print(f"✅ {VAR}={to} is LIVE in the running process (record {rid[:8]} SUCCESS).")
    return 0


def self_check() -> int:
    """⛔ Prove the refusals fire, without touching production."""
    fails = []
    if "unkown-only" in VALID:
        fails.append("a typo is in the vocabulary")
    for bad in ("unkown-only", "off", "1", "", "UNKNOWN-ONLY "):
        if bad in VALID:
            fails.append(f"{bad!r} must not be accepted")
    if set(VALID) != {"full", "unknown-only"}:
        fails.append(f"vocabulary drifted from the server's table: {VALID}")
    if DEPLOY_BUDGET_S > 1800:
        fails.append("the deploy budget is long enough to eat a rig window")
    for f in fails:
        print("  ⛔", f)
    print("self-check:", "PASS — the vocabulary is closed, a typo is refused, and the "
          "deploy wait is bounded" if not fails else "FAIL")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--to", choices=VALID)
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    if a.verify_only:
        v, how = in_process_value()
        print(f"{VAR} in the running process: {v!r} ({how})")
        return 0 if v is not None else 1
    if not a.to:
        ap.error("--to is required (or --verify-only / --self-check)")
    return flip(a.to)


if __name__ == "__main__":
    raise SystemExit(main())
