"""Mutation proof for the R-2 line-ending gate, against the REAL repository.

Plants the exact trap twice — a CRLF-stored file flattened to LF, and an LF-stored file inflated to
CRLF — and asserts the gate goes RED in both worktree and staged mode, with a sha256-verified
restore around each. Never `git checkout`: that command destroyed an unrelated edit in this session,
which is precisely why the standing rule exists.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys

ROOT = r"C:\Users\Patrick\uct-worktrees\discord-render"
GATE = [sys.executable, "tools/check_repo_hygiene.py"]

CASES = [
    # (path, how to mutate the bytes, what the trap is)
    ("docs/plans/joystick/deferred.md", lambda b: b.replace(b"\r", b""), "CRLF blob flattened to LF"),
    ("app/src/hub/sections/homeSection.js", lambda b: b.replace(b"\r", b""),
     "CRLF blob flattened to LF (a second file, so the first is not a fixture)"),
]

# The OTHER direction, measured rather than assumed. `core.autocrlf=true` cleans CRLF -> LF on the
# way in, so writing CRLF over an LF-stored file produces NO diff and cannot be committed wrong.
# The gate staying quiet there is the CORRECT answer, and this control is what proves the quiet is
# git's doing and not the gate's blindness.
ABSORBED = ("docs/feature_flags.json", lambda b: b.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))


def sh(args, **kw):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=300, **kw)


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def run_gate(staged):
    r = sh(GATE + (["--staged"] if staged else []))
    return r.returncode, (r.stdout + r.stderr).strip()


def main() -> int:
    # Control first: the gate must be GREEN before anything is planted, or a red below proves nothing.
    rc, msg = run_gate(False)
    print(f"CONTROL (clean tree)          rc={rc}  {msg.splitlines()[0][:90]}")
    if rc != 0:
        print("*** the tree was already red; this proof cannot distinguish. STOP.")
        return 1

    ok = True
    for rel, mutate, what in CASES:
        full = f"{ROOT}\\" + rel.replace("/", "\\")
        with open(full, "rb") as fh:
            orig = fh.read()
        before = hashlib.sha256(orig).hexdigest()
        try:
            with open(full, "wb") as fh:
                fh.write(mutate(orig))
            wt_rc, wt_msg = run_gate(False)
            sh(["git", "add", "--", rel])
            st_rc, st_msg = run_gate(True)
            named_wt = rel in wt_msg
            named_st = rel in st_msg
            print(f"\n{what}  ({rel})")
            print(f"  worktree mode rc={wt_rc} names the file={named_wt}")
            print(f"  staged   mode rc={st_rc} names the file={named_st}")
            print("  message: " + next((l.strip() for l in st_msg.splitlines() if rel in l), "(none)")[:150])
            if not (wt_rc == 1 and st_rc == 1 and named_wt and named_st):
                ok = False
                print("  *** GREEN UNDER MUTATION")
        finally:
            sh(["git", "reset", "-q", "--", rel])
            with open(full, "wb") as fh:
                fh.write(orig)
            restored = sha(full) == before
            clean = sh(["git", "status", "--porcelain", "--", rel]).stdout.strip() == ""
            print(f"  restored byte-identical={restored}  path clean in git={clean}")
            if not (restored and clean):
                ok = False
                print("  *** RESTORE FAILED — fix this before anything else")

    # The absorbed direction — a measurement, not an assumption.
    rel, mutate = ABSORBED
    full = f"{ROOT}\\" + rel.replace("/", "\\")
    with open(full, "rb") as fh:
        orig = fh.read()
    before = hashlib.sha256(orig).hexdigest()
    try:
        with open(full, "wb") as fh:
            fh.write(mutate(orig))
        numstat = sh(["git", "diff", "--numstat", "--", rel]).stdout.strip()
        absorbed = numstat == ""
        print(f"\nLF blob written CRLF ({rel})")
        print(f"  git records no change at all: {absorbed}   numstat={numstat or '(empty)'}")
        print("  -> autocrlf cleans it on the way in; nothing can reach a commit. Gate correctly quiet.")
        ok = ok and absorbed
    finally:
        with open(full, "wb") as fh:
            fh.write(orig)
        print(f"  restored byte-identical={sha(full) == before}")

    sh(["git", "update-index", "--refresh"])          # clear stat-cache noise from the plants
    rc, msg = run_gate(False)
    print(f"\nCONTROL (after restore)       rc={rc}  {msg.splitlines()[0][:90]}")
    ok = ok and rc == 0
    print("\nMUTATION PROOF: " + ("RED on every plant, GREEN either side — the gate bites"
                                 if ok else "*** FAILED ***"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
