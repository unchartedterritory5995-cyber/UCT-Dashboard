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

#: Every state a deploy record can SETTLE in. ⛔ Anything not named here is
#: read as "still building" and polled until the budget runs out, so a missing
#: terminal state costs a whole window AND reports the wrong cause.
#: ⚰️ SKIPPED was missing until 2026-09-18, when it turned up in 3 of the last
#: 40 `web` records — it is not rare, and it is the most dangerous one to miss
#: (see SKIPPED_MEANS below).
TERMINAL_STATUSES = ("SUCCESS", "FAILED", "CRASHED", "REMOVED", "SKIPPED")

#: ⛔⛔ SKIPPED IS NOT A MILD FAILURE. Railway creates the record and declines to
#: deploy, so THE RUNNING PROCESS NEVER RESTARTED and is still serving the old
#: value — while `railway variables --kv` reads back the NEW one. That is the
#: service/process split this whole tool exists to refuse to guess at, arriving
#: through a status rather than through a delete.
SKIPPED_MEANS = (
    "SKIPPED means Railway did NOT deploy: the variable is set on the SERVICE and "
    "the RUNNING process still has the old value. --kv will disagree with the pod. "
    "Force one with `railway redeploy --service web --yes`, then verify in-process."
)


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


def deployed_commit() -> str:
    """The commit the newest non-SKIPPED record carries, or "".

    ⛔ SKIPPED rows are excluded: they are pushes Railway declined to build, so
    they say nothing about what the pod is RUNNING.
    """
    for r in newest_records(12):
        if str(r.get("status") or "").upper() == "SKIPPED":
            continue
        return str(((r.get("meta") or {}).get("commitHash") or ""))[:9]
    return ""


def wait_for_own_deploy(before_ids: set[str], base_commit: str = "") -> tuple[str | None, str]:
    """Wait for a deploy record that did NOT exist before the flip.

    ⛔ IDENTIFIED BY ID, NOT BY POSITION. "The newest row" is how a session ends
    up verifying somebody else's deploy — measured in this programme on
    2026-09-17, when three other sessions landed inside one hour.
    """
    started = time.time()
    while time.time() - started < DEPLOY_BUDGET_S:
        for r in newest_records():
            rid = str(r.get("id") or "")
            if not rid or rid in before_ids:
                continue
            status = str(r.get("status") or "").upper()
            commit = str(((r.get("meta") or {}).get("commitHash") or ""))[:9]
            # ⛔ A SKIPPED row is a push Railway declined to build. A variable-set
            # redeploy is never skipped, so this row is NOT ours — it belongs to
            # whoever pushed docs while we were waiting.
            if status == "SKIPPED":
                print(f"  ignoring {rid[:8]} SKIPPED (commit {commit or "?"}) — "
                      f"a push someone else made; not our redeploy")
                continue
            # ⛔⛔ IDENTITY IS THE COMMIT, NOT THE FACT THAT THE ROW IS NEW.
            # `--set` redeploys the commit already running, so ours carries
            # `base_commit`. A different commit is a different session's build.
            if base_commit and commit and commit != base_commit:
                print(f"  ignoring {rid[:8]} {status} commit {commit} — not ours "
                      f"(we redeployed {base_commit})")
                continue
            print(f"  our new record {rid[:8]} → {status} ({int(time.time()-started)}s)")
            if status in TERMINAL_STATUSES:
                return rid, status
        time.sleep(POLL_S)
    # ⛔ FAIL LOUD. Never fall back to "the newest new row" — accepting a foreign
    # record is how an unverified flip reports SUCCESS and opens a live path.
    return None, ("no deploy record carrying our commit (%s) inside the budget"
                  % (base_commit or "unknown"))


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
    # ⛔ Captured BEFORE the set, so the record we wait for can be told apart from
    # another session's push by the commit it carries, not merely by being new.
    base_commit = deployed_commit()
    print(f"  currently deployed commit: {base_commit or '(unreadable)'}")

    print(f"  setting {VAR}={to} on {SERVICE} (⚠️ --set REDEPLOYS)…")
    p = _run(["railway", "variable", "--set", f"{VAR}={to}", "--service", SERVICE], timeout=300)
    if p.returncode != 0:
        print(f"⛔ the set itself failed: {(p.stdout or '') + (p.stderr or '')}"[:400])
        return 1

    rid, status = wait_for_own_deploy(before_ids, base_commit)
    if status != "SUCCESS":
        print(f"⛔ our own deploy record did not reach SUCCESS ({status}). The variable "
              f"may be set on the SERVICE while the PROCESS still has the old value.")
        if status == "SKIPPED":
            # ⛔ Say WHICH failure this is. "did not reach SUCCESS" is true of a
            # crash and of a no-op alike, and the operator response is different.
            print("   " + SKIPPED_MEANS)
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
    # ⛔ The regression that prompted this: a terminal state the poller does not
    # name is polled until the budget expires and then blamed on Railway.
    for must in ("SUCCESS", "FAILED", "CRASHED", "REMOVED", "SKIPPED"):
        if must not in TERMINAL_STATUSES:
            fails.append(f"{must} is not enumerated as terminal — a deploy in that "
                         f"state would be polled until the budget ran out")
    if "SKIPPED" not in SKIPPED_MEANS or "process" not in SKIPPED_MEANS.lower():
        fails.append("SKIPPED_MEANS must say what SKIPPED does to the RUNNING process")
    # ⛔ The identity regression: "a record that did not exist before" is a
    # timestamp, not an identity, and another session pushing mid-wait supplies
    # one. Our record is the redeploy of the commit already running.
    import inspect as _inspect
    _src = _inspect.getsource(wait_for_own_deploy)
    # ⛔ Assert the COMPARISON, not the token. The first version of this rail
    # checked only that the string "base_commit" appeared, and `base_commit` is
    # also in the signature and the timeout message — so replacing the guard with
    # `if False:` left the rail GREEN. A rail that cannot catch the mutation it
    # was written for is not a rail (lesson_a_fixture_that_cannot_distinguish...).
    if "commit != base_commit" not in _src:
        fails.append("wait_for_own_deploy no longer COMPARES the commit — it would "
                     "accept another session's deploy as ours")
    if '== "SKIPPED"' not in _src:
        fails.append("wait_for_own_deploy no longer skips SKIPPED rows — a foreign "
                     "docs push would be read as our redeploy")
    if "no deploy record carrying our commit" not in _src:
        fails.append("the timeout no longer fails loud about WHOSE record was missing")
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
