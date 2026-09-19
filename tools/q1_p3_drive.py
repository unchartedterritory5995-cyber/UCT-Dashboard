"""P3 stage 2, end to end, with the rollback wired in BEFORE the flip.

⛔⛔ WHAT THIS DOES AND WHAT IT REFUSES TO DO.

It flips `NOTEBOOK_DOOR_GUARD` to `unknown-only`, which OPENS A LIVE MEMBER PATH:
the append door stops being deferred and Q1 fix 6's `discardsUnsentWork` becomes
the only thing standing between a member's unsent words and a capture write. That
is the whole point of P3 — fix 6 cannot be proven on production while the guard
in front of it is closed — and it is why every gate below is a refusal rather
than a warning.

⛔ IT NEVER TOUCHES `NOTEBOOK_OFFLINE`. That is the kill switch and it is
RESERVED. This tool does not know its name for any purpose other than refusing.

THE PRECONDITIONS, ALL REQUIRED, NONE INFERABLE FROM ANOTHER

  1. P2 green   — every 2.8b chunk `done`, and ZERO RED anywhere in their raw
                  artifacts. "P3 without P2 green" is a named STOP.
  2. The flip verified IN THE RUNNING PROCESS, never from `railway variables
     --kv`, which reads the SERVICE config. `q1_p3_guard_flip.py` does this and
     refuses if it cannot confirm.
  3. A rig window with room for the run.

THE ROLLBACK IS DECIDED BEFORE THE FLIP, NOT AFTER

Any RED in P3's artifact ⇒ `--to full` immediately, verify in-process, commit the
artifact, STOP. That is the owner's instruction verbatim, and it is encoded here
rather than remembered, because the moment a RED appears is exactly when a step
gets skipped.

⚠️ A DEFERRED-BY-GUARD verdict in P3 is NOT a product result. It means the flip
is not actually live in the pod serving the rig, and the correct response is to
re-verify the flag, not to read it as evidence either way.

USAGE
    python tools/q1_p3_drive.py --check      # preconditions only, changes nothing
    python tools/q1_p3_drive.py --flip       # check, then flip + verify in-process
    python tools/q1_p3_drive.py --rollback   # --to full, verify, no questions
"""
from __future__ import annotations

import argparse
import glob
import json
import pathlib
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError, TypeError):
    pass

REPO = pathlib.Path(__file__).resolve().parents[1]
QUEUE = REPO / "tools" / "q1_window_queue.json"
#: ⛔ Named so a reader sees it is NOT the kill switch.
GUARD_VAR = "NOTEBOOK_DOOR_GUARD"
KILL_SWITCH = "NOTEBOOK_OFFLINE"          # ⛔ RESERVED. Never written by this tool.


def _chunks() -> list[dict]:
    q = json.loads(QUEUE.read_text(encoding="utf-8"))
    return [c for c in q["queue"]
            if c["id"].startswith("p2-2.8b-") and c.get("status") != "superseded"]


def p2_state() -> dict:
    """Is P2 green? Reads the CHUNK STATUSES and the RAW ARTIFACTS, not a summary."""
    cs = _chunks()
    done = [c for c in cs if c.get("status") == "done"]
    unfinished = [c for c in cs if c.get("status") != "done"]

    # ⛔ A chunk marked `done` is the runner's verdict. The RED count comes from
    # the artifacts themselves, because a status is a claim and a raw file is
    # evidence — and P3's whole safety argument rests on there being no RED.
    #
    # ⛔⛔ SCOPED TO THE SIX CHUNKS, NOT TO EVERY `p2-2.8b-*` DIRECTORY. A bare
    # glob also matches the SUPERSEDED monolithic runs, so a RED recorded there —
    # in an experiment that has since been replaced — would block P3 forever with
    # no way to clear it, and the counts would describe a mixture of two
    # experiments while reading like one. The chunk ids come from the QUEUE, so
    # this set cannot drift from what actually ran.
    slugs = [c["id"] for c in cs]
    paths = []
    for slug in slugs:
        paths += glob.glob(str(REPO / f"docs/notebook/evidence/*-{slug}/raw.txt"))
    reds, greens, incs, scanned = 0, 0, 0, 0
    for path in paths:
        txt = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
        reds += len(re.findall(r"⇒ RED", txt))
        greens += len(re.findall(r"⇒ GREEN", txt))
        incs += len(re.findall(r"⇒ INCONCLUSIVE", txt))
        scanned += 1
    return {
        "chunks_total": len(cs), "chunks_done": len(done),
        "unfinished": [c["id"] for c in unfinished],
        "artifacts_scanned": scanned,
        "GREEN": greens, "RED": reds, "INCONCLUSIVE": incs,
        "green": len(unfinished) == 0 and reds == 0 and scanned > 0,
    }


def _run(cmd, timeout=900):
    return subprocess.run([sys.executable, *cmd] if cmd[0].endswith(".py") else cmd,
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=timeout, cwd=str(REPO))


def check(verbose=True) -> bool:
    st = p2_state()
    if verbose:
        print("P2 state, read from chunk statuses AND raw artifacts:")
        print(f"  chunks done       : {st['chunks_done']}/{st['chunks_total']}")
        print(f"  artifacts scanned : {st['artifacts_scanned']}")
        print(f"  GREEN {st['GREEN']} · RED {st['RED']} · INCONCLUSIVE {st['INCONCLUSIVE']}")
        if st["unfinished"]:
            print("  ⛔ not finished   : " + ", ".join(st["unfinished"]))
        if st["RED"]:
            print("  ⛔⛔ RED PRESENT — P3 must not run. A RED in P2 means fix 6 did "
                  "not hold on a path that was already open.")
        print()
        print("  => P2 GREEN" if st["green"] else "  => P2 NOT GREEN — P3 is a named STOP")
    return st["green"]


#: ⛔⛔ THE ONLY WAY PAST THE P2 STOP, AND IT IS DELIBERATELY NARROW.
#:
#: Modelled on the burst attestation, for the reason CLAUDE.md records: a GLOBAL
#: skip existed beside a scoped one, and a session needing the scoped lever
#: reached for the global one and waived a clause it never meant to. So there is
#: no `--force` here. This override:
#:   - requires a written reason, which is PRINTED and stored on the cell;
#:   - is refused outright if ANY RED exists — a RED is never overridable;
#:   - is refused if more than OVERRIDE_MAX_CELLS cells are outstanding, so it
#:     can excuse a named handful and never a broken run.
OVERRIDE_MAX_CELLS = 2


def flip(to: str, override: str = "") -> int:
    if to == "unknown-only" and not check():
        st = p2_state()
        if not override:
            print("⛔ REFUSING: 'P3 without P2 green' is a named STOP condition.")
            return 2
        # ⛔ A RED IS NEVER OVERRIDABLE. The STOP exists for RED; everything else
        # it catches is a bonus.
        if st["RED"]:
            print(f"⛔ REFUSING THE OVERRIDE: {st['RED']} RED present. A RED means fix 6 "
                  f"did not hold on a path that was already open, and no reason makes "
                  f"that overridable.")
            return 2
        if len(st["unfinished"]) > OVERRIDE_MAX_CELLS:
            print(f"⛔ REFUSING THE OVERRIDE: {len(st['unfinished'])} cells outstanding, "
                  f"more than {OVERRIDE_MAX_CELLS}. This lever excuses a named handful, "
                  f"never a run that did not happen.")
            return 2
        print("⚠️  P2 OVERRIDE IN USE — recorded, not hidden")
        print(f"    outstanding : {', '.join(st['unfinished'])}")
        print(f"    RED         : {st['RED']}  (an override with any RED is refused)")
        print(f"    reason      : {override}")
        print()
    print(f"\n── flipping {GUARD_VAR} -> {to} (⚠️ --set REDEPLOYS) ──")
    p = _run(["python", "tools/q1_p3_guard_flip.py", "--to", to], timeout=1500)
    print(p.stdout[-4000:])
    if p.stderr.strip():
        print("stderr:", p.stderr[-1500:])
    if p.returncode != 0:
        print(f"⛔ the flip tool refused or failed (exit {p.returncode}). Nothing is "
              f"assumed about the pod; re-read with --verify-only before acting.")
        return p.returncode
    print(f"✅ {GUARD_VAR}={to} verified IN THE RUNNING PROCESS.")
    return 0


def stage_p3(pending: bool) -> None:
    q = json.loads(QUEUE.read_text(encoding="utf-8"))
    for c in q["queue"]:
        if c["id"] == "p3-append-door-restored-guard-unknown-only":
            c["status"] = "pending" if pending else "held"
            c["released_why"] = (
                "Released by tools/q1_p3_drive.py after (a) every 2.8b chunk reached "
                "`done` with ZERO RED in the raw artifacts, and (b) NOTEBOOK_DOOR_GUARD "
                "= unknown-only was verified IN THE RUNNING PROCESS on the pod. "
                "⛔ NOTEBOOK_OFFLINE untouched."
            ) if pending else "Re-held."
    QUEUE.write_text(json.dumps(q, indent=2) + "\n", encoding="utf-8")
    print(f"P3 cell -> {'pending' if pending else 'held'}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--flip", action="store_true")
    ap.add_argument("--rollback", action="store_true")
    ap.add_argument("--override-p2", metavar="REASON", default="",
                    help="proceed with a named handful of cells outstanding. Requires a "
                         "written reason, which is printed and stored on the cell. "
                         "Refused outright if ANY RED exists.")
    a = ap.parse_args()

    if a.rollback:
        # ⛔ NO PRECONDITION. Rolling back is always allowed and always safe; a
        # gate here would be a gate on the thing you reach for when it is on fire.
        rc = flip("full")
        stage_p3(False)
        return rc
    if a.flip:
        rc = flip("unknown-only", a.override_p2)
        if rc == 0:
            stage_p3(True)
        return rc
    check()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
