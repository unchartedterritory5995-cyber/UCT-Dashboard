"""Watch a Railway deployment until it reports SUCCESS on an expected commit.

⛔ WHY THIS EXISTS AS A COMMITTED SCRIPT. On 2026-09-10 an ad-hoc watcher polled the joystick
Increment 2 deploy for twenty minutes, failed EVERY probe with FileNotFoundError, and **exited 0**.
`subprocess.run(["railway", ...])` without shell resolution cannot find `railway` on Windows — it is
a `.cmd`/`.exe` shim on PATH, not an executable file the raw exec finds. The loop printed one error
per iteration and then ran to completion, so its exit status was indistinguishable from "the
condition was met". The deploy was only confirmed because a human ran the query in the foreground.

Three defects, three fixes, each of which the rail can see fail:

  1. RESOLVE THE SHIM. `shutil.which("railway")` gives the real path; we exec THAT. Never
     `shell=True` — that would fix the symptom by handing an interpolated string to a shell.
  2. ESCALATE, DON'T ACCUMULATE. N consecutive probe errors raises. A watcher that logs errors
     forever and exits 0 is a monitor that reports success-shaped silence
     (`lesson_a_swallowed_error_becomes_a_confident_finding`).
  3. ARMED IS A MEASUREMENT, NOT AN ANNOUNCEMENT. `arm()` returns only once a probe has come back
     with parseable data. Until then the caller has no watcher and must not say it has one.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time

MAX_CONSECUTIVE_ERRORS = 3
PROBE_TIMEOUT_S = 90


class RailwayNotFound(RuntimeError):
    """`railway` is not on PATH. A watcher that cannot probe is not a watcher."""


class ProbeFailed(RuntimeError):
    """One probe failed. Raised per-attempt; the loop decides whether it is fatal."""


class WatchAbandoned(RuntimeError):
    """Too many consecutive probe failures. NEVER return normally from this condition."""


def resolve_railway(which=shutil.which) -> str:
    """The resolved absolute path to the CLI, or raise. This is the whole 2026-09-10 defect."""
    exe = which("railway")
    if not exe:
        raise RailwayNotFound(
            "`railway` is not on PATH. shutil.which found nothing, so every probe would raise "
            "FileNotFoundError and the watch would report nothing while looking healthy."
        )
    return exe


def probe(exe: str, run=subprocess.run) -> dict:
    """One real query. Returns {service: {"status", "commit", "created"}} or raises ProbeFailed."""
    try:
        r = run([exe, "status", "--json"], capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=PROBE_TIMEOUT_S)
    except Exception as e:                                    # noqa: BLE001 - reported, never swallowed
        raise ProbeFailed(f"{type(e).__name__}: {e}") from e
    if r.returncode != 0:
        raise ProbeFailed(f"exit {r.returncode}: {(r.stderr or '').strip()[:200]}")
    return parse_status(r.stdout)


def parse_status(stdout: str) -> dict:
    """Parse `railway status --json`. Empty or unparseable output is a FAILURE, not an empty result."""
    if not (stdout or "").strip():
        raise ProbeFailed("empty stdout — a silent CLI is not a healthy one")
    try:
        d = json.loads(stdout)
    except json.JSONDecodeError as e:
        raise ProbeFailed(f"unparseable JSON: {e}") from e
    out = {}
    for env in (d.get("environments") or {}).get("edges") or []:
        node = env.get("node") or {}
        if node.get("name") != "production":
            continue
        for svc in (node.get("serviceInstances") or {}).get("edges") or []:
            n = svc.get("node") or {}
            dep = n.get("latestDeployment") or {}
            meta = dep.get("meta") or {}
            out[n.get("serviceName")] = {
                "status": dep.get("status"),
                "commit": meta.get("commitHash"),
                "created": dep.get("createdAt"),
            }
    if not out:
        raise ProbeFailed("no production services in the payload — shape changed or wrong project")
    return out


def arm(exe: str | None = None, probe_fn=probe) -> tuple[str, dict]:
    """Take the FIRST reading before anyone claims a watcher exists. Raises if it cannot."""
    exe = exe or resolve_railway()
    return exe, probe_fn(exe)


def watch(service: str, expect_commits, exe: str | None = None, probe_fn=probe,
          sleep=time.sleep, interval_s: int = 30, max_polls: int = 40,
          max_consecutive_errors: int = MAX_CONSECUTIVE_ERRORS, log=print) -> dict:
    """Poll until `service` is SUCCESS on one of `expect_commits`. Raise on anything else."""
    exe, first = arm(exe, probe_fn)
    log(f"armed: probe returned {len(first)} production services")
    consecutive = 0
    reading = first
    for i in range(max_polls):
        if i:
            try:
                reading = probe_fn(exe)
            except ProbeFailed as e:
                consecutive += 1
                log(f"probe error {consecutive}/{max_consecutive_errors}: {e}")
                if consecutive >= max_consecutive_errors:
                    raise WatchAbandoned(
                        f"{consecutive} consecutive probe failures; last: {e}. "
                        "Refusing to keep polling blind."
                    )
                sleep(interval_s)
                continue
            consecutive = 0
        row = reading.get(service) or {}
        status, commit = row.get("status"), (row.get("commit") or "")
        log(f"{service}={status} {commit[:9]}")
        if status == "SUCCESS" and any(commit.startswith(c) for c in expect_commits):
            return reading
        if status in ("FAILED", "CRASHED"):
            raise WatchAbandoned(f"{service} deployment {status} on {commit[:9]}")
        sleep(interval_s)
    raise WatchAbandoned(f"{service} did not reach SUCCESS on {expect_commits} within {max_polls} polls")
