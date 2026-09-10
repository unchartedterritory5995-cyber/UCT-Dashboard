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
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\notebook-primary-platform")
LOCK = REPO / ".measure.lock"
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


def acquire(run_id: str, repo: pathlib.Path = REPO) -> int:
    lock = repo / ".measure.lock"
    if lock.exists():
        held = json.loads(lock.read_text(encoding="utf-8"))
        if _alive(held.get("pid", -1)):
            print(f"⛔ ALREADY LOCKED by run {held.get('run_id')} (pid {held.get('pid')}) "
                  f"since {held.get('at')}. A second measurement would race the first.")
            return 1
        print(f"⚠️  clearing a STALE lock from dead pid {held.get('pid')}")
        lock.unlink()
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True,
                          text=True, encoding="utf-8").stdout.strip()
    lock.write_text(json.dumps({
        "run_id": run_id, "pid": os.getpid(), "head": head,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, indent=2), encoding="utf-8")
    n = _set_readonly(repo, True)
    print(f"🔒 LOCKED for {run_id} at {head[:9]} — {n} source files read-only.")
    print("   Edits under app/src, api, tools, scripts will now FAIL at the filesystem.")
    print("   Work that cannot wait goes in a separate worktree off this tip.")
    return 0


def release(repo: pathlib.Path = REPO, force: bool = False) -> int:
    lock = repo / ".measure.lock"
    n = _set_readonly(repo, False)          # ⛔ ALWAYS clear, lock file or not
    if lock.exists():
        held = json.loads(lock.read_text(encoding="utf-8"))
        lock.unlink()
        print(f"🔓 released run {held.get('run_id')} — {n} files writable again.")
    else:
        print(f"🔓 no lock file; cleared read-only on {n} files anyway (idempotent).")
    return 0


def status(repo: pathlib.Path = REPO) -> int:
    lock = repo / ".measure.lock"
    if not lock.exists():
        print("unlocked")
        return 0
    held = json.loads(lock.read_text(encoding="utf-8"))
    alive = _alive(held.get("pid", -1))
    print(f"{'LOCKED' if alive else 'STALE'}  run={held.get('run_id')} pid={held.get('pid')} "
          f"head={str(held.get('head'))[:9]} at={held.get('at')}")
    return 0 if alive else 2


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
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def main() -> int:
    a = sys.argv[1:]
    if not a or a[0] == "--self-check":
        return self_check()
    if a[0] == "acquire":
        return acquire(a[1] if len(a) > 1 else "unnamed")
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
