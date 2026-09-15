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

⛔ **K CP3 — THE MERGE ORDER IS CHECKED, NOT TRUSTED.** `UNITS` below is a hand-typed list
sitting beside `tools/sign_manifest.txt`, which states the same order. **A hand-typed
enumeration beside the source that owns it is this programme's oldest recurring defect**
(the writer-index `FOUR`, the COT router's "4 routes", the setup catalog's "24"). The
constraints are therefore DERIVED from the manifest's `#!after:` / `#!last:` directives and
checked against `UNITS` before anything is cherry-picked. A violation is **exit 2 naming the
pair** — never a warning, because an out-of-order merge is not recoverable by reading a log
afterwards.

Usage:
    python tools/merge_all.py --manifest tools/sign_manifest.txt --dry-run
    python tools/merge_all.py --manifest tools/sign_manifest.txt
    python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible
    python tools/merge_all.py --self-check
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
DOCS_REPO = HERE.parent
CODE_REPO = DOCS_REPO.parent / "s7-price-level"
OK, FAIL, REFUSED = 0, 1, 2

# ⚰️ A Windows console encodes stdout as cp1252, and this file prints box-drawing and ⛔/✅
# glyphs. Without this, `merge_all.py` raises UnicodeEncodeError on the FIRST unit it
# announces -- after the order check has passed and before anything is cherry-picked. It
# fails safe, but a merge tool that dies while narrating is a merge tool nobody trusts, and
# the traceback looks like a logic fault rather than a terminal codec.
# Same family as tools/flag_ledger_audit.py's cp1252 bug (2026-09-10), on the OUTPUT side.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001  -- a stream that cannot be reconfigured is not fatal
        pass

SETTLE_SECONDS = 150
POLL_SECONDS = 20
DEPLOY_TIMEOUT = 900

#: ⛔ DECLARED, in merge order, and keyed to the manifest by packet stem. The commit list
#: per unit is what makes "one unit at a time" mechanical rather than aspirational.
#: ⛔ The ORDER of this list is no longer taken on trust — see `check_order` (K CP3).
UNITS = [
    ("packet-c-instrument-and-claudemd-gate", ["669bde826"], False),
    ("packet-d-nav-tabs-gate", ["11b229254", "b8f107d4d", "7312b44aa"], False),
    ("packet-b-schema-resolution-gate", [], False),          # docs worktree only
    ("packet-v-multi-volume-gate", [], False),               # docs worktree only
    ("s4-cp2-build-record", ["9b204484e"], False),
    ("packet-e-ci-gap-gate", ["06d5bde92"], False),
    ("e-cp2-build-record", ["e767a7aab"], False),
    ("packet-k-two-command-signing-gate", [], False),        # docs worktree only
    ("k-cp3-build-record", [], False),                       # docs worktree only
    ("packet-t-stale-test-gate", ["7041a04a8", "76a3b98c2"], False),
    ("d3-cp2-build-record", ["af9fe21a6"], False),
    ("s2-accelerator-chord-pre-implementation-gate", ["0ef787268"], True),  # MEMBER-VISIBLE
]

_AFTER = re.compile(r"^#!after:\s*(\S+)\s*<-\s*(\S+)\s*$")
_LAST = re.compile(r"^#!last:\s*(\S+)\s*$")


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


# --------------------------------------------------------------------------- K CP3

def parse_constraints(text: str) -> list:
    """Read `#!after:` / `#!last:` directives out of the manifest.

    ⛔ These live in the manifest and NOT in this file on purpose: the manifest already
    owns the merge order, and a second copy here would be the very defect this check
    exists to catch."""
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        m = _AFTER.match(line)
        if m:
            out.append(("after", m.group(1), m.group(2)))
            continue
        m = _LAST.match(line)
        if m:
            out.append(("last", m.group(1), None))
    return out


def check_order(order: list, constraints: list) -> list:
    """Return a list of violation sentences. Empty list = every constraint satisfied.

    ⛔ A constraint naming a unit that is not in `order` is itself a VIOLATION, not a
    no-op. A rail that cannot fire is refused (`lesson_gate_that_cannot_fail`): a typo in
    a stem would otherwise silently disable the constraint it was meant to add."""
    idx = {stem: i for i, stem in enumerate(order)}
    bad = []
    for kind, a, b in constraints:
        if a not in idx:
            bad.append("constraint names %r, which is not a declared unit -- it can "
                       "never fire, so it is refused rather than skipped" % a)
            continue
        if kind == "after":
            if b not in idx:
                bad.append("constraint names %r, which is not a declared unit -- it can "
                           "never fire, so it is refused rather than skipped" % b)
                continue
            if idx[a] < idx[b]:
                bad.append("ORDER VIOLATION: %r is at position %d but must merge AFTER "
                           "%r, which is at position %d"
                           % (a, idx[a] + 1, b, idx[b] + 1))
        elif kind == "last":
            after = order[idx[a] + 1:]
            if after:
                bad.append("ORDER VIOLATION: %r must be LAST but %d unit(s) follow it: %s"
                           % (a, len(after), ", ".join(repr(x) for x in after)))
    return bad


def enforce_order(manifest: pathlib.Path, order: list, verbose=True) -> int:
    """Print what was checked, then return OK or REFUSED."""
    text = manifest.read_text(encoding="utf-8") if manifest.is_file() else ""
    constraints = parse_constraints(text)
    if verbose:
        # ⛔ NON-VACUITY: print the set size. "0 violations" over 0 constraints is not a
        # pass, and the only way to tell the two apart is to say how many were read.
        print("[merge-all] merge-order constraints read from %s: %d"
              % (manifest.name, len(constraints)))
        for kind, a, b in constraints:
            print("    %s" % ("%s after %s" % (a, b) if kind == "after"
                              else "%s is last" % a))
    bad = check_order(order, constraints)
    if bad:
        if verbose:
            print()
            for line in bad:
                print("    ⛔ %s" % line)
            print("\n[merge-all] REFUSED -- nothing was merged, nothing was pushed.")
        return REFUSED
    if verbose:
        print("[merge-all] all %d constraint(s) SATISFIED." % len(constraints))
    return OK


def _self_check() -> int:
    """⛔ clean / swapped / empty, before the real manifest is ever read."""
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-56s -> %-9s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    order = [u[0] for u in UNITS]
    real = parse_constraints((HERE / "sign_manifest.txt").read_text(encoding="utf-8"))

    show("the real manifest declares constraints (non-vacuity)", len(real) > 0, True)
    show("CLEAN: the declared order satisfies every constraint", check_order(order, real), [])

    # B/V swapped -> must refuse, and must NAME the pair
    swapped = list(order)
    i, j = swapped.index("packet-b-schema-resolution-gate"), swapped.index("packet-v-multi-volume-gate")
    swapped[i], swapped[j] = swapped[j], swapped[i]
    v = check_order(swapped, real)
    show("B/V SWAPPED: refuses", len(v) >= 1, True)
    show("...and names both units in the message",
         any("packet-v-multi-volume-gate" in m and "packet-b-schema-resolution-gate" in m
             for m in v), True)

    # member-visible unit no longer last -> must refuse
    moved = [u for u in order if u != "s2-accelerator-chord-pre-implementation-gate"]
    moved.insert(0, "s2-accelerator-chord-pre-implementation-gate")
    show("F-S2-1 NOT LAST: refuses", len(check_order(moved, real)) >= 1, True)

    # a constraint naming an unknown unit cannot fire -> refused, never skipped
    show("a constraint naming an unknown unit is REFUSED",
         len(check_order(order, [("after", "ghost-unit", "packet-c-instrument-and-claudemd-gate")])) == 1,
         True)

    # EMPTY: zero constraints -> zero violations, exit 0, and the count is printed
    show("EMPTY constraint set: ZERO rows, no violations", check_order(order, []), [])

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else FAIL


# --------------------------------------------------------------------------------------

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
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)

    if a.self_check:
        return _self_check()

    manifest = pathlib.Path(a.manifest)
    if not manifest.is_absolute():
        manifest = DOCS_REPO / a.manifest

    # ⛔ K CP3: the order is checked BEFORE a single cherry-pick is attempted. Checking it
    # afterwards would be a post-mortem, not a guard.
    rc = enforce_order(manifest, [u[0] for u in UNITS])
    if rc != OK:
        return rc
    print()

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
