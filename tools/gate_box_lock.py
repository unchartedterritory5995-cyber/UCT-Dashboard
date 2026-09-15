#!/usr/bin/env python
"""IS THIS BOX FREE TO MEASURE? — a machine-wide advisory lock for gate-shaped runs.

⛔⛔ THIS IS NOT `tools/measure_lock.py`, AND THE TWO MUST NEVER BE CONFUSED.
Owner ruling R2, 2026-09-14 — a second tool, not a mode on that one, and that one is not
touched:

| | `measure_lock.py` (Notebook's R-S) | `gate_box_lock.py` (this file) |
|---|---|---|
| answers | *is this TREE safe to edit?* | *is this BOX free to measure?* |
| scope | one worktree | the whole machine |
| lives in | the git dir, per-worktree | `%PROGRAMDATA%\\uct\\`, one per host |
| enforces by | the OS read-only attribute — real | **advisory only**, see below |
| stale when | bound pid dead **or** heartbeat TTL | **bound pid dead. ONLY.** |

⛔ **ADVISORY, AND SAYING SO IS NOT A DISCLAIMER — IT IS THE CONTRACT.** `measure_lock` can
enforce because it restrains *edits to files it can name*, and the filesystem will do that for it.
This lock restrains *starting a process*, and there is no syscall to hang that on. So what it
actually does is: `scripts/gate_shards.py` **asks before it starts, and refuses its own start**.
That is a QUEUE, not a mutex. Calling it a mutex is how the next person gets surprised.

⛔ **NO TTL, DELIBERATELY, AND THIS IS WHERE IT DIVERGES FROM `measure_lock` ON PURPOSE.**
Owner ruling R1: *"Do not treat 'pid alive but idle' as stale — that is exactly a Live-session-in-
waiting."* A device session parked on a BrowserStack mirror, or an operator who stepped away
between shards, holds a box that is genuinely not free. A heartbeat TTL would declare that idle
holder stale and hand the box to a second gate, which is precisely the collision this exists to
stop. **Liveness of the holding pid is the ONLY staleness test here.**

⛔ **IT COVERS ONLY RUNS THAT GO THROUGH `gate_shards.py`.** Everything else on this box —
another workstream's `npx vitest`, a bare `npm test` — is invisible to it until that entry point
adopts it. `docs/plans/joystick/harness/2026-09-14-gate-lock-adoption.md` lists who would have to
change. ⭐ The **sampler** is what covers the rest, by catching an intruder after the fact; the
lock and the sampler are complementary and neither replaces the other (owner ruling R1: the lock
is *in addition*, not instead).

USAGE
    python tools/gate_box_lock.py status
    python tools/gate_box_lock.py acquire <run-id>
    python tools/gate_box_lock.py release
    python tools/gate_box_lock.py --self-check

BYPASS — `UCT_SKIP_GATE_BOX_LOCK="<reason>"`, the `UCT_SKIP_PREPUSH_GUARD` shape.
⛔⛔ **A BYPASS NEVER BUYS A CLEAR VERDICT** (owner ruling R3). It lets you RUN; it does not let
you PRETEND. The bypassed run is still sampled, still lands `INCONCLUSIVE-CONTENDED` if the holder
is alive, and the reason is written into the manifest and to a reviewable log. An empty or
whitespace-only reason is **ignored**, i.e. the run is refused exactly as if no bypass were set —
an override with no stated reason is indistinguishable from a typo.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import pathlib
import socket
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

BYPASS_ENV = "UCT_SKIP_GATE_BOX_LOCK"
BYPASS_LOG = REPO / "logs" / "gate-box-lock-bypass.log"
LOCK_ENV = "UCT_GATE_BOX_LOCK"          # tests point this at a tmpdir


def lock_path() -> pathlib.Path:
    """The one lock file for this machine.

    ⛔ WHY `%PROGRAMDATA%` AND NOT THE THREE OBVIOUS ALTERNATIVES:

    * **Not the git dir.** That is `measure_lock`'s home and it is correct there — but it is
      per-worktree, and its own docstring says *"two worktrees never share a lock by accident."*
      That is exactly the property this lock must NOT have.
    * **Not the working tree.** `gate_shards.py` refuses to start on a dirty tree, so a lock file
      inside the tree deadlocks the thing it is protecting. `measure_lock` shipped that way once
      and had to move. ⛔ `.gitignore` is not the fix — an ignored file is still a file in the
      tree, and the next tool with a cleanliness rule trips on it just as fairly.
    * **Not `%TEMP%`.** It is per-user AND subject to disk-cleanup sweeps. A lock that can be
      deleted underneath a live holder does not fail loudly; it silently stops working, and the
      next collision looks like the lock was never there.
    * **Not anything under `/data`.** `C:\\data` is real on this box and holds live owner data.

    `%PROGRAMDATA%` is machine-wide (not per-user), persistent, outside every repository, and
    outside `C:\\data`. ⚠️ On a non-Windows host it falls back to `/var/tmp`, which is the closest
    equivalent that survives a reboot — `/tmp` does not.
    """
    override = os.environ.get(LOCK_ENV)
    if override:
        return pathlib.Path(override)
    base = os.environ.get("ProgramData") or os.environ.get("PROGRAMDATA")
    if base:
        return pathlib.Path(base) / "uct" / "gate-box.lock"
    return pathlib.Path("/var/tmp") / "uct" / "gate-box.lock"


class LockHeld(Exception):
    """Raised when a LIVE holder has the box. Carries the holder record for the message."""

    def __init__(self, holder: dict):
        self.holder = holder
        super().__init__(describe(holder))


def describe(holder: dict) -> str:
    """One line naming pid, command line and started_at — never just a pid.

    ⛔ A count or a bare pid is not a diagnosis. The operational question when you find a held
    lock is *"whose run am I about to wait for, and can I ask them?"*, and only the command line
    and the start time answer it.
    """
    return (f"pid {holder.get('pid')} since {holder.get('started_at')} "
            f"[{holder.get('workstream') or 'workstream unknown'}] "
            f"{(holder.get('command_line') or '')[:160]}")


# ── liveness ──────────────────────────────────────────────────────────────────────────────────

def _alive(pid: int) -> bool:
    """Is that pid running? ⛔ UNKNOWN MEANS ALIVE — never auto-clear on a guess.

    ⚠️ The CSV form with `/NH` is deliberate. `tasklist /FI "PID eq N"` prints a human header even
    when nothing matches, so the obvious `str(pid) in output` test can match digits inside that
    header and report a dead process as alive — or, worse, the reverse on a localised console.
    This parses rows and compares the pid FIELD.
    """
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {int(pid)}", "/NH", "/FO", "CSV"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        ).stdout
    except Exception:
        return True                      # cannot tell ⇒ assume alive
    for line in out.splitlines():
        parts = [p.strip().strip('"') for p in line.split('","')]
        if len(parts) >= 2 and parts[1].strip('"').isdigit() and int(parts[1].strip('"')) == int(pid):
            return True
    return False


# ── the record ────────────────────────────────────────────────────────────────────────────────

def _workstream(worktree: pathlib.Path) -> str | None:
    """Best-effort: the worktree directory name, which on this box IS the workstream."""
    try:
        name = worktree.name
        return name or None
    except Exception:
        return None


def _self_record(run_id: str, worktree: pathlib.Path | None = None) -> dict:
    wt = worktree or REPO
    return {
        "pid": os.getpid(),
        "run_id": run_id,
        "command_line": " ".join(sys.argv)[:500],
        "worktree": str(wt),
        "workstream": _workstream(wt),
        "started_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "hostname": socket.gethostname(),
    }


def read_holder(path: pathlib.Path | None = None) -> dict | None:
    p = path or lock_path()
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        # ⛔ A CORRUPT LOCK IS A HELD LOCK, not a free box. A truncated write (a kill mid-create)
        # must not read as "nobody is here" — that is the flattering direction.
        return {"pid": None, "command_line": "<unreadable lock file>", "started_at": None,
                "workstream": None, "corrupt": True}


def _bypass_reason() -> str | None:
    """The reason, or None. ⛔ Whitespace is not a reason."""
    raw = os.environ.get(BYPASS_ENV)
    if raw is None:
        return None
    reason = raw.strip()
    return reason or None


# ── acquire / release ─────────────────────────────────────────────────────────────────────────

def acquire(run_id: str, *, path: pathlib.Path | None = None,
            worktree: pathlib.Path | None = None) -> dict:
    """Take the box, or raise `LockHeld`. Returns the record that goes into the manifest.

    ⛔ ATOMIC CREATE, NEVER CHECK-THEN-WRITE. `O_CREAT | O_EXCL` is one syscall that either creates
    the file or fails because somebody else already did. A `if not exists: write` has a window
    between the two halves, and two gates starting in the same second is *precisely* the event
    this lock exists for — the race is not hypothetical here, it is the use case.
    """
    p = path or lock_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    record = _self_record(run_id, worktree)
    reclaimed: dict | None = None

    for attempt in (1, 2):
        try:
            fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            holder = read_holder(p)
            if holder is None:                      # vanished between the two calls — retry
                continue
            pid = holder.get("pid")
            if pid is not None and not _alive(int(pid)):
                # ⭐ STALE, AND THE RECLAIM IS RECORDED RATHER THAN SILENT. A crashed gate that
                # leaves a lock behind is a fact worth seeing in the next manifest: it is how you
                # learn a run died without anybody noticing.
                reclaimed = dict(holder)
                try:
                    p.unlink()
                except OSError:
                    pass
                if attempt == 1:
                    continue                        # one retry; if we lose the race, we are held
            bypass = _bypass_reason()
            if bypass:
                # ⛔⛔ R3: THE OVERRIDE LETS YOU RUN, IT DOES NOT LET YOU PRETEND. We do NOT take
                # the lock — the holder keeps it — and the caller is told it is running over a
                # live holder so the manifest and the sampler can both say so.
                _log_bypass(bypass, holder, record)
                return {"acquired": False, "bypass": True, "bypass_reason": bypass,
                        "overrode": holder, "reclaimed": reclaimed, "path": str(p),
                        "holder": holder, "self": record}
            raise LockHeld(holder)
        else:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(record, fh, indent=2)
            return {"acquired": True, "bypass": False, "bypass_reason": None,
                    "overrode": None, "reclaimed": reclaimed, "path": str(p),
                    "holder": record, "self": record}

    holder = read_holder(p) or {}
    if _bypass_reason():
        _log_bypass(_bypass_reason(), holder, record)
        return {"acquired": False, "bypass": True, "bypass_reason": _bypass_reason(),
                "overrode": holder, "reclaimed": reclaimed, "path": str(p),
                "holder": holder, "self": record}
    raise LockHeld(holder)


def _log_bypass(reason: str, holder: dict, record: dict) -> None:
    """⛔ REVIEWABLE, like `UCT_SKIP_PREPUSH_GUARD`. A bypass that leaves no trace is the
    `--no-verify` shape this repo has already ruled against."""
    try:
        BYPASS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with BYPASS_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "at": _dt.datetime.now().isoformat(timespec="seconds"),
                "reason": reason,
                "by": {k: record.get(k) for k in ("pid", "run_id", "worktree", "workstream")},
                "overrode": {k: holder.get(k) for k in ("pid", "started_at", "workstream",
                                                        "command_line")},
            }) + "\n")
    except OSError:
        pass                                        # never fail a run because a log could not write


def release(*, path: pathlib.Path | None = None, pid: int | None = None) -> bool:
    """Idempotent, and it only ever removes OUR OWN lock.

    ⛔ IT MUST NEVER DELETE SOMEBODY ELSE'S. A release that clears whatever it finds turns one
    crashed run into a silent free-for-all — and the bypass path never took the lock at all, so a
    blind release there would drop a live holder's lock on the floor.
    """
    p = path or lock_path()
    me = os.getpid() if pid is None else pid
    holder = read_holder(p)
    if holder is None:
        return False
    if holder.get("pid") != me:
        return False
    try:
        p.unlink()
        return True
    except OSError:
        return False


def status(*, path: pathlib.Path | None = None) -> dict:
    p = path or lock_path()
    holder = read_holder(p)
    if holder is None:
        return {"state": "FREE", "path": str(p), "holder": None}
    pid = holder.get("pid")
    live = True if pid is None else _alive(int(pid))
    return {"state": "HELD" if live else "STALE", "path": str(p), "holder": holder, "live": live}


# ── self-check ────────────────────────────────────────────────────────────────────────────────

def self_check() -> int:
    """Prove each answer is reachable, on a throwaway lock — never the real one."""
    import tempfile
    ok = True
    scratch = pathlib.Path(tempfile.mkdtemp(prefix="gate-box-lock-"))
    tmp = scratch / "t.lock"
    # ⛔ THE SELF-CHECK MUST NOT WRITE TO THE REAL BYPASS LOG. It exercises the bypass path, and
    # that path logs — so every rehearsal was appending real-looking rows to the very file an
    # operator is meant to audit. A log salted with drills is a log nobody reads.
    global BYPASS_LOG
    _real_log, BYPASS_LOG = BYPASS_LOG, scratch / "bypass.log"

    def check(label, cond):
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'ok  ' if cond else 'FAIL'} {label}")

    check("a free box acquires", acquire("a", path=tmp)["acquired"])
    check("status reads HELD", status(path=tmp)["state"] == "HELD")

    # a LIVE holder (this process) refuses a second acquire
    try:
        acquire("b", path=tmp)
        check("a live holder refuses a second acquire", False)
    except LockHeld as e:
        check("a live holder refuses a second acquire", "pid" in str(e))

    # bypass with a reason runs over it, WITHOUT taking the lock
    os.environ[BYPASS_ENV] = "self-check"
    r = acquire("c", path=tmp)
    check("bypass with a reason runs over a live holder", r["bypass"] and not r["acquired"])
    check("bypass does NOT steal the lock", read_holder(tmp).get("run_id") == "a")
    # ⛔ CONTROL: a blank reason is not a reason
    os.environ[BYPASS_ENV] = "   "
    try:
        acquire("d", path=tmp)
        check("a blank bypass reason is ignored", False)
    except LockHeld:
        check("a blank bypass reason is ignored", True)
    os.environ.pop(BYPASS_ENV, None)

    check("release removes our own lock", release(path=tmp))
    check("release is idempotent", release(path=tmp) is False)
    check("status reads FREE again", status(path=tmp)["state"] == "FREE")

    # a DEAD holder is reclaimed, and the reclaim is recorded
    dead = dict(_self_record("dead"), pid=999_999)
    tmp.write_text(json.dumps(dead), encoding="utf-8")
    r = acquire("e", path=tmp)
    check("a dead holder is reclaimed", r["acquired"])
    check("the reclaim is RECORDED, not silent", (r.get("reclaimed") or {}).get("run_id") == "dead")
    release(path=tmp)

    # ⛔ CONTROL: a corrupt lock is HELD, not free
    tmp.write_text("{not json", encoding="utf-8")
    check("a corrupt lock reads as held, never as a free box",
          (read_holder(tmp) or {}).get("corrupt") is True)
    tmp.unlink(missing_ok=True)

    BYPASS_LOG = _real_log
    print("\nself-check: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd = argv[0]
    if cmd == "--self-check":
        return self_check()
    if cmd == "status":
        s = status()
        print(f"  {s['state']}  {s['path']}")
        if s["holder"]:
            print("  " + describe(s["holder"]))
        return 0
    if cmd == "acquire":
        run_id = argv[1] if len(argv) > 1 else "manual"
        try:
            r = acquire(run_id)
        except LockHeld as e:
            print(f"  HELD — {e}")
            return 1
        print(f"  ACQUIRED  {r['path']}")
        if r.get("reclaimed"):
            print(f"  (reclaimed a stale lock: {describe(r['reclaimed'])})")
        return 0
    if cmd == "release":
        print("  released" if release() else "  nothing of ours to release")
        return 0
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
