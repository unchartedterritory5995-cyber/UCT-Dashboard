"""K CP18 — an EXCLUSIVE lock over the merge checkout, so two sessions never cherry-pick or
sign into the same manifest at once.

⛔⛔ TWO SESSIONS SHARING ONE MERGE CHECKOUT IS EXACTLY THE COLLISION THIS PROGRAMME'S OWN
LAYER-0 GUARD EXISTS TO CATCH AT THE PUSH LAYER — and nothing caught it one layer earlier, at
the CHECKOUT layer. Measured 2026-09-17/18: a concurrent session shared `_merge-master` with
this one and independently signed and merged rows 3-6 while K CP13-16 were being built.
Nothing was corrupted THIS time — both sessions' work happened to be compatible — but nothing
would have caught it if it were not. Signing is the last act before a pick (K CP10), so a
second signer racing the first is the same collision as a second cherry-picker.

⭐ Same shape as this repo's own gate-box lock: atomic file creation (`O_CREAT | O_EXCL`,
which is wholly successful or wholly fails — no window where two callers both believe they
hold it), the file records WHO holds it and WHEN, a dead holder is reclaimed and the reclaim
is RECORDED (never silent), and a corrupt lock file reads as HELD, never as absent — an
absence is not evidence a lock can safely be created over.

⛔ NO TTL. A lock that expires on a timer is a lock two sessions can both hold across the
boundary. The only safe expiry is "the holding process is provably dead," checked live.

⛔ THE LOCK LIVES OUTSIDE EVERY REPO AND OUTSIDE /data — a fact two worktrees of the SAME
repo, or two DIFFERENT checkouts entirely, must both see, and it must survive neither
worktree being the "right" place to put it.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess

ACQUIRED, RECLAIMED, HELD = "ACQUIRED", "RECLAIMED", "HELD"


def lock_path() -> pathlib.Path:
    programdata = os.environ.get("PROGRAMDATA")
    d = pathlib.Path(programdata) / "uct" if programdata else pathlib.Path("/var/tmp/uct")
    d.mkdir(parents=True, exist_ok=True)
    return d / "merge-checkout.lock"


def _pid_alive(pid) -> bool:
    """⛔ UNREADABLE FAILS CLOSED — TREATED AS ALIVE. A process check this function
    cannot perform is not evidence the process is dead; refusing to reclaim is the safe
    direction, a wrongly-reclaimed live lock is not."""
    if not isinstance(pid, int):
        return True
    if os.name == "nt":
        try:
            out = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"],
                                 capture_output=True, text=True, timeout=10)
            return str(pid) in (out.stdout or "")
        except Exception:  # noqa: BLE001
            return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return True


def acquire(session: str, checkout: str, et: str, pid: "int | None" = None):
    """(state, detail). ACQUIRED/RECLAIMED both mean the caller now holds it; HELD means it
    does not (a corrupt lock file is folded into HELD, never treated as absent). Never
    raises — every path is a return."""
    pid = pid if pid is not None else os.getpid()
    p = lock_path()
    payload = {"pid": pid, "session": session, "et": et, "checkout": checkout}
    try:
        fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        return ACQUIRED, "lock created: %s" % payload
    except FileExistsError:
        pass
    try:
        held = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        # ⛔⛔ CORRUPT READS AS HELD, NEVER AS ABSENT — collapsed into the SAME state a
        # caller already has to handle, not a fourth state nobody checks for. A lock
        # file this reader cannot parse must never be treated as "nobody holds it,"
        # which is exactly the failure direction that would let a second session in.
        return HELD, "lock file at %s is unreadable/CORRUPT -- refusing as HELD, never absent" % p
    if _pid_alive(held.get("pid")):
        return HELD, ("held by pid=%s session=%s since %s (checkout %s)"
                      % (held.get("pid"), held.get("session"), held.get("et"),
                         held.get("checkout")))
    old = dict(held)
    p.write_text(json.dumps(payload), encoding="utf-8")
    return RECLAIMED, "reclaimed from dead pid=%s (was: %s) -> now: %s" % (old.get("pid"), old, payload)


def release(pid: "int | None" = None):
    """(ok, detail). Releases ONLY a lock this exact pid holds -- never another's."""
    pid = pid if pid is not None else os.getpid()
    p = lock_path()
    if not p.is_file():
        return True, "no lock file -- nothing to release"
    try:
        held = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return False, "corrupt lock file -- refusing to touch it blind"
    if held.get("pid") != pid:
        return False, ("held by a DIFFERENT pid (%s, session %s) -- refusing to release "
                       "someone else's lock" % (held.get("pid"), held.get("session")))
    p.unlink()
    return True, "released"


def _self_check() -> int:
    import shutil, tempfile, time
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-58s -> %-11s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    real_env = os.environ.get("PROGRAMDATA")
    box = pathlib.Path(tempfile.mkdtemp(prefix="lock-self-"))
    os.environ["PROGRAMDATA"] = str(box)
    try:
        st, detail = acquire("s1", "C:/checkout", "ET now")
        show("1. no lock -> runs (ACQUIRED)", st, ACQUIRED)

        st2, detail2 = acquire("s2", "C:/checkout", "ET now", pid=os.getpid())
        show("2. a LIVE holder (this process's own pid, so it reads alive) -> HELD", st2, HELD)
        show("   ...and names the holder", "session=s1" in detail2, True)

        ok_r, _d = release(os.getpid())
        show("release by the SAME pid -> succeeds", ok_r, True)

        # dead-pid reclaim: fabricate a lock naming a pid that cannot be alive
        lp = lock_path()
        lp.write_text(json.dumps({"pid": 999999999, "session": "ghost", "et": "long ago",
                                  "checkout": "C:/gone"}), encoding="utf-8")
        st3, detail3 = acquire("s3", "C:/checkout", "ET now")
        show("3. dead holder -> RECLAIMED, and it is recorded", (st3, "ghost" in detail3), (RECLAIMED, True))
        release(os.getpid())

        # corrupt lock -> HELD, never absent
        lp.write_text("{not json", encoding="utf-8")
        st4, _d4 = acquire("s4", "C:/checkout", "ET now")
        show("4. corrupt lock file -> HELD, never treated as absent", st4, HELD)
        lp.unlink()

        # six racers: exactly one wins, and the winner ACQUIRED (did not reclaim).
        # ⛔ ALL SIX use THIS process's own real, genuinely-alive pid -- a fake pid
        # (e.g. 10000) reads as DEAD via tasklist, so every "loser" would RECLAIM
        # instead of seeing HELD, and the first draft of this control did exactly
        # that: 0 HELD where 5 were expected, caught by running it.
        me = os.getpid()
        results = []
        for i in range(6):
            results.append(acquire("racer-%d" % i, "C:/checkout", "ET now", pid=me))
        acquired = [r for r in results if r[0] == ACQUIRED]
        held_n = [r for r in results if r[0] == HELD]
        show("5. six racers (one real pid) -> exactly one ACQUIRED", len(acquired), 1)
        show("   ...and it did not RECLAIM (nobody was there to reclaim from)",
             acquired[0][0], ACQUIRED)
        show("   ...the other five all read HELD (the pid IS alive)", len(held_n), 5)
        release(me)

        # release refuses another pid's lock
        acquire("s5", "C:/checkout", "ET now", pid=55555)
        ok_wrong, detail_wrong = release(pid=66666)
        show("6. release with the WRONG pid -> refused", ok_wrong, False)
        show("   ...naming whose lock it actually is", "session s5" in detail_wrong, True)
        release(pid=55555)
    finally:
        if real_env is None:
            os.environ.pop("PROGRAMDATA", None)
        else:
            os.environ["PROGRAMDATA"] = real_env
        shutil.rmtree(box, ignore_errors=True)

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    raise SystemExit(_self_check() if "--self-check" in sys.argv else
                     print("usage: merge_lock.py --self-check") or 2)
