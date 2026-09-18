"""D-14 A5/C1 — the loop + boot-window poller that outlives a Claude Code session.

⛔ WHY A SCHEDULED TASK AND NOT A BACKGROUND SHELL. A poller started from inside a
session dies with the session, so the overnight boot windows — the evidence OI-44/D7
needs across >= 10 pods — are exactly the ones never captured. This runs from Windows
Task Scheduler as the logged-in user.

⛔ A GAP IS NOT A ZERO. Every failed probe writes an explicit `gap` record. A silent
absence would read as "no stall", which is the defect this programme keeps paying for.

⛔ `shutil.which`, never a bare name. A scheduled task's PATH is not the shell's, and
`subprocess` cannot resolve a `.cmd` shim on Windows without it — that is the
`deploy_watch.py` failure (forty FileNotFoundErrors, then exit 0).

Single invocation runs until `--minutes` elapses, holding a lock so the 5-minute
"restart if dead" trigger cannot start a second copy.

R49 (D-20) — DETERMINISTIC ROLLBACK WATCHDOG, opt-in via `--rollback-phase`.
=============================================================================
With `--rollback-phase` UNSET (the default, and everything the overnight poller has
always done), this script's behaviour is byte-for-byte what it was before R49 — pure
observation, no Railway writes, ever. Passing `--rollback-phase {canary,member}` arms
the watchdog for that phase, per R49's own text:

  canary phase (R39 monitors R38's flip) -- a trigger UNSETS `DISCORD_RENDER_V2_ENABLED`
  member phase (R41 monitors R40's flip) -- a trigger NARROWS `DISCORD_RENDER_V2_CHANNELS`
    back to '1549129739048853544' (the admin-only #render-smoke channel)

Two trigger classes:
  1. A TIER-1-CLASS STALL observed on the live pod (`stall_record.lifetime_max_ms >=
     TIER1_ROLLBACK_MS`). ⛔ `TIER1_ROLLBACK_MS` is a LOCAL constant, deliberately NOT
     imported from `api.services.discord_render.observe.LOOP_STALL_PAGE_ALWAYS_MS` —
     this script's whole design is "measure the LIVE pod over the wire, never trust the
     local checkout", and R71's own investigation today found this worktree's checkout
     can genuinely differ from what is deployed. The two numbers are meant to agree
     (both 5000.0 ms, R34 tier 1 — "pages at ANY uptime") and should be kept in sync BY
     EYE, never by import.
  2. BLINDNESS — 3 consecutive unreadable polls. During CANARY phase this pages only
     (R49's own text: "during the CANARY phase it is a page only"). During MEMBER phase
     it IS ITSELF a rollback trigger (an auto-rollback that can no longer see is worse
     than useless during member exposure).

NEVER A RE-FLIP, NEVER A SECOND CHANGE. A durable, on-disk latch (`.rollback_fired.json`,
one per OUT_DIR, i.e. one per running instrument set) is written the MOMENT a rollback is
decided, before the Railway call is attempted — so even a mid-action crash-and-restart of
this script (the "5-minute restart if dead" trigger) can never fire a second rollback.
Clearing the latch is a deliberate, manual, owner action; this script never clears its own.

WHY THE ROLLBACK USES A REAL RESTART, NOT `--skip-deploys`. Both `DISCORD_RENDER_V2_ENABLED`
and `DISCORD_RENDER_V2_CHANNELS` are read via a bare `os.environ.get(...)` per call
(`commands.py:49,75`) -- there is no in-process caching to invalidate. But an environment
variable cannot be injected into an ALREADY-RUNNING process from outside; the value only
reaches `os.environ` on the next process start. So `--skip-deploys` would silently do
nothing to the pod already serving traffic, and the "in-process read confirming it" R49
requires would read the OLD value. The action therefore follows this repo's own documented
procedure ("railway variables --set — measured BOTH ways", CLAUDE.md): set the variable,
watch `/api/health` uptime for a NEW boot (up to ~3 min), fall back to an explicit
`railway redeploy` if none appears, THEN read the value back in-process over SSH.
⚠️ KNOWN, ACCEPTED COST: this means every rollback deliberately trades a brief
boot-window degradation (R62-F3-attempt-2026-09-18.md measured this at up to ~20 min,
peaking past 60-110s on the screener sweep) for getting OFF a broken V2 path. That trade
is correct — continuing to serve a proven-bad path to real members is the worse outcome —
but it is why the rollback is a LATCHED, ONE-SHOT action and not a retry loop: firing it
twice would pay that cost twice for no additional safety.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT_DIR = ROOT / "docs" / "discord-render" / "evidence" / "d14-monitor"
LOCK = OUT_DIR / ".poller.lock"
LOCK_STALE_S = 600
ROLLBACK_LATCH = OUT_DIR / ".rollback_fired.json"
D14_LOG = ROOT / "docs" / "discord-render" / "D14-LOG.md"

#: R34 tier 1 threshold, MIRRORED (never imported) from
#: `api/services/discord_render/observe.py::LOOP_STALL_PAGE_ALWAYS_MS`. See the module
#: docstring for why this script never imports from the local checkout.
TIER1_ROLLBACK_MS = 5000.0

#: Consecutive unreadable polls before the blindness rule fires. R49: "the blindness
#: rule fires on the third gap, not the second."
BLINDNESS_GAP_COUNT = 3

#: The one channel a member-phase rollback narrows back to (R41) — the admin-only
#: #render-smoke channel this whole programme's canary work already lives in.
CANARY_ONLY_CHANNEL = "1549129739048853544"

#: Phase -> the single env change R49 is allowed to make. Never more than one entry is
#: ever touched per rollback call, and `do_rollback` refuses an unknown phase outright
#: rather than guessing which of the two to apply.
PHASE_ROLLBACK = {
    "canary": {"op": "delete", "var": "DISCORD_RENDER_V2_ENABLED", "value": None},
    "member": {"op": "set", "var": "DISCORD_RENDER_V2_CHANNELS", "value": CANARY_ONLY_CHANNEL},
}

PROBE = r'''
import os, json, datetime, urllib.request
port = os.environ.get("PORT", "8080"); sec = os.environ.get("PUSH_SECRET", "")
def g(p, auth=False):
    h = {"Authorization": "Bearer " + sec} if auth else {}
    with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%s%s" % (port, p), headers=h), timeout=25) as r:
        return json.loads(r.read().decode())
o = {"t": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
try:
    o["uptime_s"] = g("/api/health").get("uptime_seconds")
    d = g("/api/discord/render-health", True)
    o["loop"] = d.get("loop")
    # ⛔⛔ THE KEY IS `token_slots`, NOT `token_slot_counts`. The name here was TYPED against a
    # payload that did not exist yet, and it matches nothing `observe.health_payload` emits — so
    # after OI-47 is merged this probe would STILL have recorded `token_slots: null`, for a
    # second, unrelated reason, and the null would have read as "commit B is not live". A key
    # nobody derived is a kill switch nobody can see (the invented-env-flag class, in a reader).
    o["stall_record"] = d.get("stall_record")
    o["token_slots"] = d.get("token_slots")
    o["sha"] = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "?")[:12]
except Exception as e:
    o["err"] = repr(e)[:120]
print(json.dumps(o))
'''

#: Remote probe for R49's "in-process read confirming it" step. Reads the two V2 flags
#: DIRECTLY from the running pod's own os.environ, over the same railway ssh channel the
#: health probe already uses — never inferred from `railway variables --kv`, which shows
#: what the SERVICE is configured with, not what the RUNNING process has (this repo's own
#: standing caution, "railway variables --set — measured BOTH ways").
CONFIRM_PROBE = r'''
import os, json
print(json.dumps({
    "DISCORD_RENDER_V2_ENABLED": os.environ.get("DISCORD_RENDER_V2_ENABLED"),
    "DISCORD_RENDER_V2_CHANNELS": os.environ.get("DISCORD_RENDER_V2_CHANNELS"),
}))
'''

#: Remote probe for the "critical page through chart_health_alerts" step of a trigger.
#: %(key)s / %(severity)s / %(message)s are filled by _remote_page() -- json.dumps'd
#: Python literals, never raw string interpolation, so a message containing a quote or
#: newline cannot break out of the embedded script.
PAGE_PROBE = r'''
import sys
sys.path.insert(0, "/app")
from api.services import chart_health_alerts
ok = chart_health_alerts.emit(%(key)s, %(severity)s, %(message)s, %(metadata)s)
print("PAGE_OK" if ok else "PAGE_FAILED")
'''


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write(rec: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "loop-boot-windows.jsonl", "a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rec) + "\n")


def _lock_held() -> bool:
    """True if another copy is alive. A stale lock (older than LOCK_STALE_S) is ours to take."""
    if not LOCK.exists():
        return False
    try:
        age = time.time() - LOCK.stat().st_mtime
    except OSError:
        return False
    return age < LOCK_STALE_S


def poll_once(railway: str) -> dict:
    payload = base64.b64encode(PROBE.encode()).decode()
    cmd = [railway, "ssh", "--service", "web",
           "echo %s | base64 -d > /tmp/d14m.py && /opt/venv/bin/python /tmp/d14m.py" % payload]
    try:
        # ⛔⛔ cwd=ROOT IS LOAD-BEARING, NOT TIDINESS. The Railway CLI resolves its linked
        # project FROM THE WORKING DIRECTORY. A scheduled task has no working directory, so it
        # runs in C:\Windows\System32 and every call answers "No linked project found" -- rc=1,
        # no JSON, a `gap` every poll, while the file keeps growing and the task reads healthy.
        # Measured 2026-09-16: 8 gaps / 7 successes, the successes coming from a DIFFERENT
        # poller that happened to still be alive in a repo cwd. Pin it here rather than in the
        # task definition, so the fix travels with the script -- R49's rollback call depends on
        # the same resolution and would otherwise be handless in production.
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180,
                           encoding="utf-8", errors="replace", cwd=str(ROOT))
    except Exception as e:  # noqa: BLE001 — a probe failure is a RECORD, never a crash
        return {"t": _now(), "gap": "probe_exception", "detail": repr(e)[:120]}
    for line in (p.stdout or "").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return {"t": _now(), "gap": "probe_no_json", "rc": p.returncode}


# ─── R49: pure, unit-testable decision functions ────────────────────────────────────
# Every function below takes plain data in and returns plain data out. None of them
# touch Railway, the filesystem, or the network — that is what makes the mutation
# proof possible (a self-check can drive them with synthetic input and never risk
# production, exactly as R49's own text requires: "a synthetic breach at the
# monitor's INPUT (never production)").

def evaluate_stall_trigger(rec: dict) -> tuple[bool, str | None]:
    """Does THIS ONE poll record show a tier-1-class stall on the live pod?

    A poll with no readable `stall_record` (a gap, or a pre-OI-47 null payload) is NOT
    a trigger here — blindness is handled separately, by counting CONSECUTIVE gaps
    across polls, not by treating one unreadable poll as a stall.
    """
    sr = rec.get("stall_record")
    if not isinstance(sr, dict):
        return False, None
    max_ms = sr.get("lifetime_max_ms")
    if not isinstance(max_ms, (int, float)):
        return False, None
    if max_ms >= TIER1_ROLLBACK_MS:
        return True, f"tier1_stall lifetime_max_ms={max_ms}"
    return False, None


def is_gap(rec: dict) -> bool:
    """A record counts toward the blindness rule iff it carries an explicit `gap` key —
    the same "a gap is not a zero" discipline the rest of this file already applies."""
    return "gap" in rec


def count_consecutive_gaps(records: list[dict]) -> int:
    """The blindness counter, computed the same way the live loop accumulates it: reset
    to 0 on any non-gap record, +1 on each gap. Exposed as a pure function over a list so
    a mutation that deletes the increment (or the reset) is directly provable."""
    n = 0
    for rec in records:
        n = n + 1 if is_gap(rec) else 0
    return n


def should_act_on_blindness(consecutive_gaps: int, phase: str) -> str:
    """'rollback' | 'page' | 'none'. R49's own text: 3 consecutive unreadable polls is a
    rollback trigger during MEMBER phase, and a page only during CANARY phase."""
    if consecutive_gaps < BLINDNESS_GAP_COUNT:
        return "none"
    return "rollback" if phase == "member" else "page"


def variable_cmd(railway: str, phase: str) -> list[str]:
    """The EXACT Railway CLI command for this phase's rollback — a pure function so a
    mutation swapping the variable name or the value is directly provable without ever
    invoking subprocess."""
    action = PHASE_ROLLBACK.get(phase)
    if action is None:
        raise ValueError(f"unknown rollback phase: {phase!r}")
    # ⛔ Verified against `railway variable {set,delete} --help` (v4.35+) directly, not
    # assumed: `delete` takes a bare positional <KEY> and no `--yes`/`--force` flag exists
    # at all — a prior draft of this function invented one, which would have made every
    # canary-phase rollback fail on an unrecognized-flag parse error at the one moment it
    # mattered most. `set` takes KEY=VALUE positionally, same as this repo's own prior
    # working example (OI-13 step 6, this session).
    if action["op"] == "delete":
        return [railway, "variable", "delete", "--service", "web", action["var"]]
    return [railway, "variable", "set", "--service", "web",
            f"{action['var']}={action['value']}"]


# ─── R49: the live action (never called by --self-check) ───────────────────────────

def rollback_latched() -> bool:
    return ROLLBACK_LATCH.exists()


def _write_latch(payload: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ROLLBACK_LATCH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _confirm_probe(railway: str) -> dict:
    payload = base64.b64encode(CONFIRM_PROBE.encode()).decode()
    cmd = [railway, "ssh", "--service", "web",
           "echo %s | base64 -d > /tmp/d14c.py && /opt/venv/bin/python /tmp/d14c.py" % payload]
    rc = None
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60,
                           encoding="utf-8", errors="replace", cwd=str(ROOT))
        rc = p.returncode
        for line in (p.stdout or "").splitlines():
            line = line.strip()
            if line.startswith("{"):
                return json.loads(line)
    except Exception as e:  # noqa: BLE001
        return {"confirm_error": repr(e)[:200]}
    return {"confirm_error": "no_json", "rc": rc}


def _remote_page(railway: str, key: str, severity: str, message: str, metadata: dict) -> str:
    script = PAGE_PROBE % {
        "key": json.dumps(key), "severity": json.dumps(severity),
        "message": json.dumps(message), "metadata": json.dumps(metadata),
    }
    payload = base64.b64encode(script.encode()).decode()
    cmd = [railway, "ssh", "--service", "web",
           "echo %s | base64 -d > /tmp/d14p.py && /opt/venv/bin/python /tmp/d14p.py" % payload]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60,
                           encoding="utf-8", errors="replace", cwd=str(ROOT))
        out = (p.stdout or "").strip()
        return out if out else f"page_no_output rc={p.returncode}"
    except Exception as e:  # noqa: BLE001
        return f"page_exception {e!r}"[:200]


def _wait_for_new_boot(railway: str, baseline_uptime_s: float | None, max_wait_s: float = 180.0) -> bool:
    """Poll /api/health for a fresh (small) uptime — the "verify the BOOT, not the CLI"
    procedure this repo's own CLAUDE.md prescribes for every `railway variable` write.
    Returns True once a boot smaller than the baseline (or than 60s outright) is seen."""
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        rec = poll_once(railway)
        up = rec.get("uptime_s")
        if isinstance(up, (int, float)):
            if up < 60.0 or (baseline_uptime_s is not None and up < baseline_uptime_s):
                return True
        time.sleep(15.0)
    return False


def _append_log_entry(text: str) -> None:
    """Best-effort D14-LOG.md append, matching the file's own established fenced-entry
    shape. Never allowed to raise into the caller — the rollback and the page are the
    safety-critical parts; a docs-formatting failure must not block them."""
    try:
        data = D14_LOG.read_bytes().decode("utf-8").replace("\r\n", "\n")
        stripped = data.rstrip("\n")
        if not stripped.endswith("```"):
            return
        entry = (
            "\n" + _now() + " | R49 AUTO-ROLLBACK FIRED\n"
            + "=" * 80 + "\n" + text.strip() + "\n" + "=" * 80 + "\n```\n"
        )
        new_text = stripped + entry
        with open(D14_LOG, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(new_text)
    except Exception:  # noqa: BLE001 — best-effort, never fatal
        pass


def do_rollback(railway: str, phase: str, reason: str) -> dict:
    """The one, latched, non-repeatable rollback action. Returns a result dict that is
    ALSO what gets written into the latch file, so the latch is both the guard and the
    record of what happened."""
    if rollback_latched():
        return {"skipped": "already_latched"}
    if phase not in PHASE_ROLLBACK:
        raise ValueError(f"unknown rollback phase: {phase!r}")

    result = {"t": _now(), "phase": phase, "reason": reason, "status": "attempting"}
    _write_latch(result)  # ⛔ LATCH FIRST — see module docstring: never a second change.

    baseline = poll_once(railway).get("uptime_s")
    cmd = variable_cmd(railway, phase)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60,
                           encoding="utf-8", errors="replace", cwd=str(ROOT))
        result["cli_rc"] = p.returncode
        result["cli_stderr"] = (p.stderr or "")[:300]
    except Exception as e:  # noqa: BLE001
        result["status"] = "cli_exception"
        result["detail"] = repr(e)[:200]
        _write_latch(result)
        return result

    booted = _wait_for_new_boot(railway, baseline)
    if not booted:
        try:
            subprocess.run([railway, "redeploy", "--service", "web", "--yes"],
                           capture_output=True, text=True, timeout=60,
                           encoding="utf-8", errors="replace", cwd=str(ROOT))
            booted = _wait_for_new_boot(railway, baseline, max_wait_s=180.0)
        except Exception as e:  # noqa: BLE001
            result["redeploy_exception"] = repr(e)[:200]
    result["new_boot_observed"] = booted

    confirm = _confirm_probe(railway)
    result["confirm"] = confirm
    action = PHASE_ROLLBACK[phase]
    expected = action["value"]
    actual = confirm.get(action["var"]) if isinstance(confirm, dict) else None
    result["confirmed"] = (actual == expected) if action["op"] == "set" else (
        actual is None or str(actual).strip().lower() in ("", "0", "false", "off", "no")
    )

    page_msg = (f"R49 AUTO-ROLLBACK ({phase}): {reason}. "
                f"{action['var']} {'deleted' if action['op'] == 'delete' else 'set to ' + str(expected)}. "
                f"in-process confirmed={result['confirmed']}.")
    result["page"] = _remote_page(railway, "r49_auto_rollback", "critical", page_msg,
                                  {"phase": phase, "reason": reason})

    result["status"] = "done"
    _write_latch(result)
    _append_log_entry(
        f"Phase: {phase}\nReason: {reason}\n"
        f"Action: {action['op']} {action['var']}"
        + (f" = {expected}" if action['op'] == 'set' else "")
        + f"\nNew boot observed: {booted}\nIn-process confirmed: {result['confirmed']}\n"
        f"Page result: {result['page']}\n"
        "Never re-fires — latched at docs/discord-render/evidence/d14-monitor/.rollback_fired.json."
    )
    return result


def _self_check_pure() -> tuple[int, int]:
    """The synthetic-input half of R49's rails — pure functions only, touches nothing
    live. Returns (failed, declared)."""
    bad = 0
    declared = 0

    declared += 1
    ok, reason = evaluate_stall_trigger({"stall_record": {"lifetime_max_ms": 6000.0}})
    if not (ok and reason and "tier1_stall" in reason):
        print("  FAIL evaluate_stall_trigger did not fire on a 6000ms tier-1 record")
        bad += 1
    else:
        print("  ok   evaluate_stall_trigger fires on a >=5000ms record")

    declared += 1
    ok2, _ = evaluate_stall_trigger({"stall_record": {"lifetime_max_ms": 100.0}})
    if ok2:
        print("  FAIL evaluate_stall_trigger fired on a 100ms (non-tier-1) record")
        bad += 1
    else:
        print("  ok   evaluate_stall_trigger does not fire under threshold")

    declared += 1
    ok3, _ = evaluate_stall_trigger({"gap": "probe_no_json"})
    if ok3:
        print("  FAIL evaluate_stall_trigger fired on a gap record (should be false)")
        bad += 1
    else:
        print("  ok   evaluate_stall_trigger never treats a gap as a stall")

    declared += 1
    canary_cmd = variable_cmd("railway", "canary")
    if "DISCORD_RENDER_V2_ENABLED" not in canary_cmd:
        print("  FAIL canary rollback command does not name DISCORD_RENDER_V2_ENABLED")
        bad += 1
    else:
        print("  ok   canary rollback targets DISCORD_RENDER_V2_ENABLED")

    declared += 1
    member_cmd = variable_cmd("railway", "member")
    joined = " ".join(member_cmd)
    if "DISCORD_RENDER_V2_CHANNELS" not in joined or CANARY_ONLY_CHANNEL not in joined:
        print("  FAIL member rollback command does not set DISCORD_RENDER_V2_CHANNELS to the canary channel")
        bad += 1
    else:
        print("  ok   member rollback narrows DISCORD_RENDER_V2_CHANNELS to the canary-only channel")

    declared += 1
    three_gaps = count_consecutive_gaps([{"gap": "a"}, {"gap": "b"}, {"gap": "c"}])
    if three_gaps != 3:
        print(f"  FAIL count_consecutive_gaps([gap,gap,gap]) = {three_gaps}, expected 3")
        bad += 1
    else:
        print("  ok   count_consecutive_gaps counts three consecutive gaps as 3")

    declared += 1
    reset_count = count_consecutive_gaps([{"gap": "a"}, {"gap": "b"}, {"uptime_s": 1.0}, {"gap": "c"}])
    if reset_count != 1:
        print(f"  FAIL a success record did not reset the gap counter (got {reset_count}, expected 1)")
        bad += 1
    else:
        print("  ok   a non-gap record resets the consecutive-gap counter")

    declared += 1
    action_2 = should_act_on_blindness(2, "member")
    action_3_member = should_act_on_blindness(3, "member")
    action_3_canary = should_act_on_blindness(3, "canary")
    if action_2 != "none" or action_3_member != "rollback" or action_3_canary != "page":
        print(f"  FAIL blindness rule shape wrong: n=2 -> {action_2!r}, "
              f"n=3 member -> {action_3_member!r}, n=3 canary -> {action_3_canary!r}")
        bad += 1
    else:
        print("  ok   blindness fires on the THIRD gap (not the second), rollback only in member phase")

    return bad, declared


def self_check() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rec = poll_once("definitely-not-a-real-binary-xyz")
    ok_gap = "gap" in rec
    LOCK.write_text(_now(), encoding="utf-8")
    ok_lock = _lock_held()
    LOCK.unlink(missing_ok=True)
    ok_free = not _lock_held()
    print("self-check gap_on_failure=%s lock_holds=%s lock_releases=%s" % (ok_gap, ok_lock, ok_free))

    pure_bad, pure_declared = _self_check_pure()

    total_declared = 3 + pure_declared
    total_bad = (3 - sum([ok_gap, ok_lock, ok_free])) + pure_bad
    print("TOTALS d14_monitor --self-check %s declared=%d evaluated=%d failed=%d"
          % ("PASS" if not total_bad else "FAIL", total_declared, total_declared, total_bad))
    return 0 if not total_bad else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=360.0)
    ap.add_argument("--interval", type=float, default=90.0)
    ap.add_argument("--self-check", action="store_true",
                    help="prove the gap record, the lock, and R49's pure decision functions, without touching production")
    ap.add_argument("--rollback-phase", choices=("canary", "member"), default=None,
                    help="R49: arm the auto-rollback watchdog for this phase. Omit for pure observation (the default, unchanged since before R49).")
    a = ap.parse_args()

    if a.self_check:
        return self_check()

    if _lock_held():
        print("another poller holds the lock; exiting without a second copy")
        return 0

    railway = shutil.which("railway") or shutil.which("railway.cmd")
    if not railway:
        _write({"t": _now(), "gap": "railway_cli_not_on_path"})
        print("railway CLI not resolvable")
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + a.minutes * 60.0
    _write({"t": _now(), "event": "poller_started", "pid": os.getpid(),
            "interval_s": a.interval, "rollback_phase": a.rollback_phase})

    consecutive_gaps = 0
    while time.time() < deadline:
        LOCK.write_text(_now(), encoding="utf-8")
        rec = poll_once(railway)
        _write(rec)

        if a.rollback_phase and not rollback_latched():
            consecutive_gaps = consecutive_gaps + 1 if is_gap(rec) else 0

            triggered, reason = evaluate_stall_trigger(rec)
            if triggered:
                result = do_rollback(railway, a.rollback_phase, reason)
                _write({"t": _now(), "event": "rollback_fired", "reason": reason, "result": result})
            else:
                action = should_act_on_blindness(consecutive_gaps, a.rollback_phase)
                if action == "rollback":
                    reason = f"blind: {consecutive_gaps} consecutive unreadable polls"
                    result = do_rollback(railway, a.rollback_phase, reason)
                    _write({"t": _now(), "event": "rollback_fired", "reason": reason, "result": result})
                elif action == "page":
                    msg = (f"R49 blindness page ({a.rollback_phase}): "
                           f"{consecutive_gaps} consecutive unreadable polls, no rollback in canary phase.")
                    page_result = _remote_page(railway, "r49_blindness", "critical", msg,
                                               {"phase": a.rollback_phase, "consecutive_gaps": consecutive_gaps})
                    _write({"t": _now(), "event": "blindness_page", "consecutive_gaps": consecutive_gaps,
                            "result": page_result})

        time.sleep(a.interval)
    _write({"t": _now(), "event": "poller_window_ended"})
    LOCK.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
