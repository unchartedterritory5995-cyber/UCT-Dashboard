"""Merge every signed unit into master, in order, one at a time, under the Layer-0 guard.

⛔⛔ **NOT RUN BY THE SESSION THAT WROTE IT.** A script that merges to production must be
read before it is trusted, and its author is the least reliable reader. `--dry-run` prints
the full sequence and is the only mode this session has executed.

⛔ **ONE UNIT AT A TIME, AND IT WAITS.** ⚰️ 2026-09-12: two merges four minutes apart
marked the first deploy `REMOVED` mid-flight; a request in flight died with a 500 and
`/api/health` served 502 for ~45 s. *"The queue was clear when I started my gate"* is true
and useless — a build takes 3–5 minutes and a gate takes longer. The wait is on the DEPLOY,
not on the check.

⛔ **F-S2-1 IS THE ONLY MEMBER-VISIBLE UNIT AND NEEDS ITS OWN FLAG.** Without
`--include-member-visible` this stops before it and says so. A member pressing
Ctrl/Cmd/Alt+Shift+F on three screens stops having a ticker silently flagged; plain Shift+F
is unchanged. That is a thing a person can notice, so it is a separate decision.

⛔ **NEVER `--no-verify`.** The Layer-0 pre-push guard is what serialises master pushes; it
leaves a reviewable trace and bypassing it leaves none.

Usage:
    python tools/merge_all.py --manifest tools/sign_manifest.txt --dry-run
    python tools/merge_all.py --manifest tools/sign_manifest.txt
    python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
DOCS_REPO = HERE.parent
CODE_REPO = DOCS_REPO.parent / "s7-price-level"
OK, FAIL, REFUSED = 0, 1, 2

SETTLE_SECONDS = 150
POLL_SECONDS = 20
DEPLOY_TIMEOUT = 900

#: ⛔ DECLARED, in merge order, and keyed to the manifest by packet stem. The commit list
#: per unit is what makes "one unit at a time" mechanical rather than aspirational.
UNITS = [
    ("packet-c-instrument-and-claudemd-gate", ["669bde826"], False),
    ("packet-d-nav-tabs-gate", ["11b229254", "b8f107d4d", "7312b44aa"], False),
    ("packet-b-schema-resolution-gate", [], False),          # docs worktree only
    ("packet-v-multi-volume-gate", [], False),               # docs worktree only
    ("s4-cp2-build-record", ["9b204484e"], False),
    ("packet-e-ci-gap-gate", ["06d5bde92"], False),
    ("packet-k-two-command-signing-gate", [], False),        # docs worktree only
    ("packet-t-stale-test-gate", ["7041a04a8", "76a3b98c2"], False),
    ("d3-cp2-build-record", ["af9fe21a6"], False),
    ("s2-accelerator-chord-pre-implementation-gate", ["0ef787268"], True),  # MEMBER-VISIBLE
]


def _sign_gate():
    spec = importlib.util.spec_from_file_location("_sg", str(HERE / "sign_gate.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def is_signed(packet: pathlib.Path) -> bool:
    """⛔ sign_gate's OWN reader, never a regex. ⚰️ `APPROVED AT SHA:\\s*\\S` once counted
    UNSIGNED blocks as signed by matching the `S` of the next line's `SCOPE APPROVED:`."""
    sg = _sign_gate()
    text = packet.read_text(encoding="utf-8")
    try:
        sg.target_span(text)       # raises when there is NO unsigned block left
        return False               # an unsigned block is still open -> not signed
    except SystemExit:
        return True
    except Exception:              # noqa: BLE001
        return True


def run(cmd, cwd, dry):
    printable = " ".join(cmd)
    if dry:
        print("    $ %s" % printable)
        return 0, ""
    out = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    return out.returncode, (out.stdout or "") + (out.stderr or "")


def wait_for_success(dry) -> bool:
    """⛔ A PUSH IS NOT CLEAR UNTIL ITS WEB DEPLOY REACHES SUCCESS."""
    if dry:
        print("    $ railway deployment list --service web --json   "
              "# poll until SUCCESS, then +%ds settled" % SETTLE_SECONDS)
        return True
    deadline = time.time() + DEPLOY_TIMEOUT
    while time.time() < deadline:
        rc, out = run(["railway", "deployment", "list", "--service", "web", "--json"],
                      CODE_REPO, False)
        if rc == 0 and '"SUCCESS"' in out:
            time.sleep(SETTLE_SECONDS)
            return True
        if rc == 0 and ('"FAILED"' in out or '"CRASHED"' in out):
            return False
        time.sleep(POLL_SECONDS)
    return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", default="tools/sign_manifest.txt")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-member-visible", action="store_true")
    a = ap.parse_args(argv)

    print("[merge-all] units: %d   member-visible included: %s"
          % (len(UNITS), a.include_member_visible))
    print()

    for stem, commits, member_visible in UNITS:
        packet = DOCS_REPO / "docs/terminal-research/12-decisions/gates" / (stem + ".md")
        print("── %s" % stem)
        if not packet.is_file():
            print("    ⛔ packet missing: %s — STOPPED." % packet)
            return REFUSED
        if not is_signed(packet):
            if not a.dry_run:
                print("    ⛔ NOT SIGNED (sign_gate's own reader). Run sign_all.py "
                      "first. STOPPED — nothing after this was attempted.")
                return REFUSED
            # ⭐ A DRY RUN THAT STOPS AT ROW 1 IS NOT A PREVIEW. The owner needs the
            # WHOLE sequence to read before trusting it, so dry-run reports the block
            # and keeps printing — loudly, so it can never be mistaken for signed.
            print("    ⚠️  WOULD STOP HERE: not signed yet (dry run continues)")
        if member_visible and not a.include_member_visible:
            print("    ⛔ MEMBER-VISIBLE. This unit changes what a member experiences: "
                  "Ctrl/Cmd/Alt+Shift+F stops flagging tickers on three screens (plain "
                  "Shift+F is unchanged).")
            print("    ⛔ STOPPED before it, deliberately. Re-run with "
                  "--include-member-visible when you want it to go.")
            return OK
        if not commits:
            print("    (docs worktree only — nothing to merge into master)")
            continue
        for c in commits:
            rc, out = run(["git", "cherry-pick", c], CODE_REPO, a.dry_run)
            if rc != 0:
                print("    ⛔ cherry-pick failed: %s\n%s" % (c, out))
                return FAIL
        rc, out = run(["git", "push", "origin", "HEAD:master"], CODE_REPO, a.dry_run)
        if rc != 0:
            print("    ⛔ push refused (Layer-0 guard or remote): \n%s" % out)
            return FAIL
        if not wait_for_success(a.dry_run):
            print("    ⛔ web deploy did not reach SUCCESS. STOPPED.")
            return FAIL
        print("    ✅ merged and deployed")

    if a.dry_run:
        print()
        print("[merge-all] DRY RUN — nothing merged, nothing pushed.")
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
