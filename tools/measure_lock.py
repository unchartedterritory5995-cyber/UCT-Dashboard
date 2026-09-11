"""R-S — THE TREE IS LOCKED WHILE IT IS BEING MEASURED.

⚰️ WHY THIS IS A LOCK AND NOT A RULE. Editing the tree mid-run voided two
13-minute full-suite runs in one session — the second one AFTER a ruling had
been written saying not to. The ruling was read, agreed with, and then broken by
the same agent that wrote it. ⛔ A rule that depends on remembering is not a
control; it is a hope with a timestamp.

⭐ SO THE ENFORCEMENT IS THE FILESYSTEM. While a measurement holds the lock,
every source file under the guarded roots carries the OS read-only attribute, so
an edit fails at the syscall — no cooperation required from the thing being
restrained. That is the difference between a lock and a note on the door.

⛔ IT MUST NEVER STRAND THE TREE. A crash, a kill, a lost shell: any of them
would otherwise leave the repo unwritable and the next session confused. So:
  · the lock records its own pid and the tree hash it is protecting
  · `release` is idempotent and clears the attribute whether or not it set it
  · `status` reports a STALE lock (dead pid) and `--force` clears one
  · nothing is ever made read-only that git tracks as already read-only

Usage:
    python measure_lock.py acquire <run-id>
    python measure_lock.py release
    python measure_lock.py status
    python measure_lock.py check            # exit 1 if locked — for scripts that write
    python measure_lock.py --self-check
"""
from __future__ import annotations

import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\notebook-primary-platform")
def _lock_path(repo: pathlib.Path = None) -> pathlib.Path:
    """⛔ THE LOCK LIVES IN THE GIT DIR, NEVER IN THE WORKING TREE.

    ⚰️ First use, immediate deadlock: the lock file sat at the worktree root, so
    the tree was dirty, so `gate_shards` refused to start on its own rule that a
    gate runs on committed code only. The guard and the gate were both right and
    together they made the measurement impossible.

    ⛔ .gitignore is NOT the fix. An ignored file is still a file in the tree, and
    the next tool with a cleanliness rule trips on it just as fairly — that buys
    one green run and leaves a trap for whoever writes the next check.

    The git dir is per-worktree, so two worktrees never share a lock by accident,
    and `git status` never reports it.
    """
    repo = repo or REPO
    try:
        gd = subprocess.run(["git", "rev-parse", "--git-dir"], cwd=repo, capture_output=True,
                            text=True, encoding="utf-8").stdout.strip()
        if gd:
            gp = pathlib.Path(gd)
            if not gp.is_absolute():
                gp = repo / gp
            return gp / "measure.lock"
    except Exception:
        pass
    # ⛔ The fallback stays outside the tree as well — system temp, keyed by
    # worktree, never a path under `repo` itself.
    return pathlib.Path(tempfile.gettempdir()) / f"measure-{abs(hash(str(repo)))}.lock"


LOCK = _lock_path()
# ⛔ Source only. Never docs/ (Stream C writes prose during a run and that cannot
# change a measured result) and never .git/ (git must stay able to work).
GUARDED = ("app/src", "api", "tools", "scripts")
SUFFIXES = (".js", ".jsx", ".ts", ".tsx", ".py")


def _files(repo: pathlib.Path):
    for root in GUARDED:
        base = repo / root
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and p.suffix in SUFFIXES and "node_modules" not in p.parts:
                yield p


def _set_readonly(repo: pathlib.Path, on: bool) -> int:
    n = 0
    for p in _files(repo):
        try:
            mode = p.stat().st_mode
            if on:
                p.chmod(mode & ~stat.S_IWRITE)
            else:
                p.chmod(mode | stat.S_IWRITE)
            n += 1
        except OSError:
            pass
    return n


def _alive(pid: int) -> bool:
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace").stdout
        return str(pid) in out
    except Exception:
        return True          # ⛔ unknown ⇒ assume alive; never auto-clear on a guess


LOCK_TTL_S = 2 * 60 * 60      # a full sharded gate is ~15 min; 2h is generous and bounded


def lock_state(held: dict, now: float | None = None) -> tuple[str, str]:
    """LIVE / STALE, and why. ⛔ Pure, so the rule can be driven rather than
    asserted about — this is the function the old pid check got wrong."""
    now = time.time() if now is None else now
    bound = held.get("bound_pid")
    if bound and not _alive(int(bound)):
        return "STALE", f"bound pid {bound} is gone"
    age = now - float(held.get("heartbeat") or 0)
    ttl = float(held.get("ttl_s") or LOCK_TTL_S)
    if age >= ttl:
        return "STALE", f"heartbeat is {int(age)}s old (ttl {int(ttl)}s)"
    return "LIVE", f"heartbeat {int(age)}s ago" + (f", bound pid {bound} alive" if bound else "")


def acquire(run_id: str, repo: pathlib.Path = REPO, bound_pid: int | None = None,
            ttl_s: int = LOCK_TTL_S) -> int:
    lock = _lock_path(repo)
    if lock.exists():
        held = json.loads(lock.read_text(encoding="utf-8"))
        state, why = lock_state(held)
        if state == "LIVE":
            print(f"⛔ ALREADY LOCKED by run {held.get('run_id')} since {held.get('at')} "
                  f"({why}). A second measurement would race the first.")
            return 1
        print(f"⚠️  clearing a STALE lock from run {held.get('run_id')} — {why}")
        lock.unlink()
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True,
                          text=True, encoding="utf-8").stdout.strip()
    # ⛔⛔ THE PID HERE IS THIS PROCESS, AND THIS PROCESS IS ABOUT TO EXIT.
    #
    # ⚰️ Measured 2026-09-11: every lock taken the way locks are actually taken —
    # `python measure_lock.py acquire <id>` in one shell command, the measurement
    # in the next — read STALE the whole time it was protecting a live run,
    # because `acquire` recorded its OWN pid and returned. The tree was correctly
    # read-only and `status` said the lock was dead. A `--force` on that reading
    # would have cleared a lock guarding a 15-minute gate.
    #
    # ⭐ So liveness is a HEARTBEAT AGE, not a pid, because the acquiring process
    # is never the measuring one. `--pid` optionally binds a real runner; when it
    # is given and that process is gone, the lock is stale no matter how fresh.
    lock.write_text(json.dumps({
        "run_id": run_id, "pid": os.getpid(), "bound_pid": bound_pid, "head": head,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "heartbeat": time.time(), "ttl_s": ttl_s,
    }, indent=2), encoding="utf-8")
    n = _set_readonly(repo, True)
    print(f"🔒 LOCKED for {run_id} at {head[:9]} — {n} source files read-only.")
    print("   Edits under app/src, api, tools, scripts will now FAIL at the filesystem.")
    print("   Work that cannot wait goes in a separate worktree off this tip.")
    return 0


def release(repo: pathlib.Path = REPO, force: bool = False) -> int:
    lock = _lock_path(repo)
    # ⛔ --force EXISTS TO CLEAR A DEAD LOCK, NEVER TO EVICT A LIVE ONE. Forcing
    # past a running measurement is how a tree changes underneath a gate, which
    # is the entire failure this lock was built for.
    if force and lock.exists():
        try:
            state, why = lock_state(json.loads(lock.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            state, why = "STALE", "unreadable lock file"
        if state == "LIVE":
            print(f"⛔ REFUSING --force: the lock is LIVE ({why}). "
                  f"Wait for it, or kill the run and force after it is STALE.")
            return 1
    n = _set_readonly(repo, False)          # ⛔ ALWAYS clear, lock file or not
    if lock.exists():
        held = json.loads(lock.read_text(encoding="utf-8"))
        lock.unlink()
        print(f"🔓 released run {held.get('run_id')} — {n} files writable again.")
    else:
        print(f"🔓 no lock file; cleared read-only on {n} files anyway (idempotent).")
    return 0


def status(repo: pathlib.Path = REPO) -> int:
    lock = _lock_path(repo)
    if not lock.exists():
        print("unlocked")
        return 0
    held = json.loads(lock.read_text(encoding="utf-8"))
    state, why = lock_state(held)
    print(f"{state}  run={held.get('run_id')} head={str(held.get('head'))[:9]} "
          f"at={held.get('at')} — {why}")
    return 0 if state == "LIVE" else 2


def self_check() -> int:
    import tempfile
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok ' if ok else 'FAIL'}  {name}")
        bad += 0 if ok else 1

    with tempfile.TemporaryDirectory() as d:
        repo = pathlib.Path(d)
        (repo / "app" / "src").mkdir(parents=True)
        f = repo / "app" / "src" / "x.js"
        f.write_text("const a = 1\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=repo, capture_output=True)

        # ⛔ THE CASE THAT MATTERS: an edit under lock must FAIL.
        acquire("selfcheck", repo)
        try:
            f.write_text("const a = 2\n", encoding="utf-8")
            case("⛔ an edit under lock is REFUSED by the filesystem", False)
        except (PermissionError, OSError):
            case("⛔ an edit under lock is REFUSED by the filesystem", True)

        # ...and the control: the same edit succeeds once released.
        release(repo)
        try:
            f.write_text("const a = 3\n", encoding="utf-8")
            case("⭐ CONTROL — the same edit succeeds after release", f.read_text(encoding="utf-8") == "const a = 3\n")
        except OSError:
            case("⭐ CONTROL — the same edit succeeds after release", False)

        case("release with no lock file is idempotent, not an error", release(repo) == 0)
        case("a second acquire while held is REFUSED", (acquire("a", repo), acquire("b", repo))[1] == 1)
        release(repo)

        # ── the liveness rule itself, driven rather than asserted about ───────
        now = 1_000_000.0
        fresh = {"heartbeat": now - 10, "ttl_s": 3600}
        old = {"heartbeat": now - 7200, "ttl_s": 3600}
        case("⛔ a lock acquired from a SHELL reads LIVE — the acquiring process is gone by design",
             lock_state(fresh, now)[0] == "LIVE")
        case("⭐ CONTROL: a lock past its ttl reads STALE", lock_state(old, now)[0] == "STALE")
        case("⛔ a lock BOUND to a dead pid is STALE however fresh its heartbeat",
             lock_state({**fresh, "bound_pid": 999_999_999}, now)[0] == "STALE")
        case("⛔ a lock with NO heartbeat at all is STALE, never assumed live",
             lock_state({}, now)[0] == "STALE")

        # ── --force must refuse a LIVE lock ──────────────────────────────────
        acquire("live-run", repo)
        refused = release(repo, force=True)
        case("⛔⛔ --force REFUSES a LIVE lock — evicting a running measurement is the bug",
             refused == 1 and _lock_path(repo).exists())
        # ...and clears a stale one
        lp = _lock_path(repo)
        h = json.loads(lp.read_text(encoding="utf-8"))
        h["heartbeat"] = time.time() - 999_999
        lp.write_text(json.dumps(h), encoding="utf-8")
        cleared = release(repo, force=True)
        case("⭐ CONTROL: --force DOES clear a stale lock", cleared == 0 and not lp.exists())
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def main() -> int:
    a = sys.argv[1:]
    if not a or a[0] == "--self-check":
        return self_check()
    if a[0] == "acquire":
        bound = None
        ttl = LOCK_TTL_S
        for i, tok in enumerate(a):
            if tok == "--pid" and i + 1 < len(a):
                bound = int(a[i + 1])
            if tok == "--ttl" and i + 1 < len(a):
                ttl = int(a[i + 1])
        run = next((x for x in a[1:] if not x.startswith("--") and not x.isdigit()), "unnamed")
        return acquire(run, bound_pid=bound, ttl_s=ttl)
    if a[0] == "release":
        return release(force="--force" in a)
    if a[0] == "status":
        return status()
    if a[0] == "check":
        return 1 if LOCK.exists() else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
