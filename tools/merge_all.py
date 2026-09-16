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
import json
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
DOCS_REPO = HERE.parent
CODE_REPO = DOCS_REPO.parent / "s7-price-level"
OK, FAIL, REFUSED, UNSIGNABLE = 0, 1, 2, 3

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
#: One `git fetch origin master` per run (K CP5). Module state, deliberately: the run is
#: a single process from first unit to last, and a per-unit fetch of a ref nothing else
#: is pushing buys nothing but 31 network round trips.
_FETCHED = False

#: ⛔ DECLARED, in merge order, and keyed to the manifest by packet stem. The commit list
#: per unit is what makes "one unit at a time" mechanical rather than aspirational.
#: ⛔ The ORDER of this list is no longer taken on trust — see `check_order` (K CP3).
UNITS = [
    # ⭐ Disjoint from every other unit (0 file intersections, proven 2026-09-15), so it
    # carries no merges-after and can lead. Its block signs delivered code only; the
    # packet stays CLOSED-AS-FINDING and the shape rail is still refused (F-A-1).
    ("packet-a-absent-bound-gate", ["18dd13683", "31e28c6e3"], False),
    ("packet-c-instrument-and-claudemd-gate", ["669bde826"], False),
    ("packet-d-nav-tabs-gate", ["11b229254", "b8f107d4d", "7312b44aa"], False),
    ("packet-b-schema-resolution-gate", [], False),          # docs worktree only
    ("packet-v-multi-volume-gate", [], False),               # docs worktree only
    ("s4-cp2-build-record", ["9b204484e"], False),
    ("packet-e-ci-gap-gate", ["06d5bde92"], False),
    ("e-cp2-build-record", ["e767a7aab"], False),
    ("e-cp4-build-record", ["b70a874ed"], False),
    ("e-cp5-build-record", ["c619ac82c"], False),
    ("e-cp6-build-record", ["0d7c55fb1"], False),
    ("e-cp7-build-record", ["dbc494828"], False),
    ("e-cp8-build-record", ["f2251d398"], False),
    ("e-cp9-build-record", ["0b92750fa"], False),
    ("e-cp10-build-record", ["9ef64fd69"], False),
    ("e-cp11-build-record", ["e825a4df4"], False),
    ("e-cp12-build-record", ["8ed462844"], False),
    ("e-cp13-build-record", ["38aa2d9ad"], False),
    ("e-cp14-build-record", ["c47d96c16"], False),
    ("e-cp15-build-record", ["b2b864bf7"], False),
    ("e-cp16-build-record", ["792d1595e"], False),
    ("e-cp17-build-record", ["e9cce57bc"], False),
    ("e-cp18-build-record", ["62dcf2a01"], False),
    ("e-cp19-build-record", ["3196206e7"], False),
    ("e-cp20-build-record", ["c89dd6b81"], False),
    ("e-cp21-build-record", ["aba219779"], False),
    ("e-cp22-build-record", ["03ebbd7f7"], False),
    ("e-cp23-build-record", ["953142d0b"], False),
    ("e-cp24-build-record", ["9fa4ee150"], False),
    ("e-cp25-build-record", [], False),                     # docs worktree only
    ("t2-cp1-build-record", ["4ad1108d1"], False),
    ("packet-k-two-command-signing-gate", [], False),        # docs worktree only
    ("k-cp3-build-record", [], False),                       # docs worktree only
    ("k-cp4-build-record", [], False),                       # docs worktree only
    ("k-cp5-build-record", [], False),                       # docs worktree only
    ("k-cp6-build-record", [], False),                       # docs worktree only
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


def approval_state(packet: pathlib.Path):
    """(state, reason) from sign_gate's THREE-STATE reader. ⛔ Never a regex.

    ⚰️⚰️ **K CP4 — THE PREVIOUS VERSION OF THIS FUNCTION DERIVED `True` FROM AN
    EXCEPTION.** It called `target_span()` and treated `SystemExit` as *signed*. That
    exception has TWO causes — every block filled, and **no block at all** — so a
    document carrying no approval block whatsoever returned `True` and would have merged
    with nothing approving it. `packet-a-absent-bound-gate.md` and
    `entity-master-pre-implementation-gate.md` are both in exactly that state on disk.

    ⭐ An absence is not evidence. A reader of a signature must never answer SIGNED
    because it failed to find something (`lesson_gate_that_cannot_fail`, in the one tool
    where a false SIGNED is unrecoverable).
    """
    sg = _sign_gate()
    return sg.read_approval(packet.read_text(encoding="utf-8"))


def _cannot_be_signed(state: str, reason: str) -> bool:
    """A STRUCTURAL fault: the document could not be signed even if the owner tried.

    ⭐ This is deliberately narrower than "not SIGNED". Before signing day EVERY unit
    reads UNSIGNED, and refusing the whole dry run on that would destroy the preview the
    owner needs — the very thing the *"a dry run that stops at row 1 is not a preview"*
    comment below protects. A document with NO BLOCK or a MALFORMED one is different in
    kind: no signature can ever land on it, so previewing its merge is meaningless.
    """
    return state == "MALFORMED" or (state == "UNSIGNED" and "no approval block" in reason)


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

    # ── K CP5: the deploy wait ──────────────────────────────────────────────────────
    # ⛔ THE OLD PREDICATE IS THE CONTROL. A real `railway deployment list` payload, one
    # SUCCESS (the deployment currently serving) and the rest REMOVED, with OUR commit
    # nowhere in it: the string test says "go", the row lookup says "not there yet".
    live_shape = json.dumps({"deployments": [
        {"status": "SUCCESS", "meta": {"commitHash": "aaaaaaaaaaaa"}},
        {"status": "REMOVED", "meta": {"commitHash": "bbbbbbbbbbbb"}},
    ]})
    show("the OLD predicate fires on somebody else's SUCCESS",
         '"SUCCESS"' in live_shape, True)
    show("...and the row lookup does NOT find our commit",
         _deployment_for_sha(live_shape, "cccccccccccc"), None)
    show("it DOES find ours when it is there (non-vacuity)",
         (_deployment_for_sha(live_shape, "aaaaaaaaaaaa") or {}).get("status"), "SUCCESS")
    show("a short sha matches the full commitHash",
         (_deployment_for_sha(live_shape, "aaaaaaaaa") or {}).get("status"), "SUCCESS")
    show("a BUILDING row is found and is not SUCCESS",
         (_deployment_for_sha(json.dumps([{"status": "BUILDING",
                                           "meta": {"commitHash": "dddddddddddd"}}]),
                              "dddddddddddd") or {}).get("status"), "BUILDING")
    show("unreadable JSON is NOT FOUND, never a pass",
         _deployment_for_sha("<html>502</html>", "aaaaaaaaaaaa"), None)
    show("a row with no commitHash never matches an empty sha",
         _deployment_for_sha(json.dumps([{"status": "SUCCESS", "meta": {}}]), ""), None)

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


def merged_into_master(commits, dry):
    """Which of `commits` are ALREADY on origin/master — read from MASTER, not the manifest.

    ⚰️⚰️ **K CP5 — THIS SCRIPT COULD NOT BE RUN TWICE.** There was no check of any kind:
    a second run cherry-picked unit 1's commit again. Measured 2026-09-15 in a throwaway
    repo, on a commit already in the branch:

        git cherry-pick <already-applied>  ->  exit 1
        "The previous cherry-pick is now empty, possibly due to conflict resolution."
        …and it leaves .git/CHERRY_PICK_HEAD behind, so the NEXT run fails the same way
        before it starts.

    So an interrupted merge session — and one is likely, see `wait_for_deploy` below —
    left 36 units half-merged with no way forward but hand-editing `UNITS`.

    ⛔ **MASTER IS THE AUTHORITY ON WHAT IS MERGED.** Not the manifest, not a local
    branch, not a file this tool wrote: `git merge-base --is-ancestor <c> origin/master`,
    after an explicit fetch. Measured both directions in that same repo — a merged commit
    exits 0, an unmerged one exits 1 — because a check that only ever answers one way
    cannot tell a resume from a fresh start.
    """
    global _FETCHED
    if dry:
        print("    $ git fetch origin master && git merge-base --is-ancestor <c> "
              "origin/master   # per commit")
    # ⛔ ONE fetch per RUN, not per unit — but never zero: reading a stale
    # origin/master would report a merged unit as unmerged and re-merge it.
    if not _FETCHED:
        rc, out = run(["git", "fetch", "origin", "master"], CODE_REPO, False)
        if rc != 0:
            return None, "could not fetch origin/master: %s" % out.strip()[:200]
        _FETCHED = True
    done = []
    for c in commits:
        rc, _ = run(["git", "merge-base", "--is-ancestor", c, "origin/master"],
                    CODE_REPO, False)
        if rc == 0:
            done.append(c)
    return done, ""


def wait_for_deploy(sha, dry) -> bool:
    """⛔ A PUSH IS NOT CLEAR UNTIL **ITS OWN** WEB DEPLOY REACHES SUCCESS.

    ⚰️⚰️ **K CP5 — THE OLD WAIT COULD NOT BLOCK.** It was `'"SUCCESS"' in out` over the
    raw JSON of `railway deployment list`, and that list is HISTORY. Measured live,
    2026-09-15 16:2x ET, with no deploy of ours anywhere in it:

        rows returned: 20   statuses: {'SUCCESS': 1, 'REMOVED': 19}
        merge_all predicate  '"SUCCESS"' in out  ->  True

    The one SUCCESS is the deployment currently SERVING — the PREVIOUS one. So the wait
    returned on its first poll every time and the whole guarantee collapsed to
    `sleep(150)`, while a real build measured **~186 s** the same afternoon.

    ⭐ **AND THE CONSEQUENCE IS NOT A MEMBER OUTAGE — IT IS AN ABORTED SESSION.** The
    Layer-0 pre-push guard REFUSES while the latest deployment is not SUCCESS or is
    younger than its 150 s settle, so unit 2's push would be refused, `merge_all` would
    stop, and (before the check above) could not be resumed. The docstring at the top of
    this file promises the wait is *"on the DEPLOY, not on the check"*; this is what makes
    that sentence true.

    ⛔ The deployment is identified by OUR commit hash. "Some deployment succeeded" is
    the assertion that could not fail.
    """
    if dry:
        print("    $ railway deployment list --service web --json   "
              "# poll until the deployment for %s reaches SUCCESS, then +%ds settled"
              % (sha[:9] or "the commit this push creates", SETTLE_SECONDS))
        return True
    if not sha:
        print("    ⛔ the pushed commit is UNREADABLE, so its deploy cannot be "
              "identified. STOPPED — waiting for 'some' deploy is the defect K CP5 "
              "removed.")
        return False
    deadline = time.time() + DEPLOY_TIMEOUT
    seen = None
    while time.time() < deadline:
        rc, out = run(["railway", "deployment", "list", "--service", "web", "--json"],
                      CODE_REPO, False)
        row = _deployment_for_sha(out, sha) if rc == 0 else None
        if rc == 0 and row is not None:
            status = row.get("status")
            if status != seen:
                print("    … %s is %s" % (sha[:9], status))
                seen = status
            if status == "SUCCESS":
                time.sleep(SETTLE_SECONDS)
                return True
            if status in ("FAILED", "CRASHED", "REMOVED"):
                print("    ⛔ the deploy for %s ended %s" % (sha[:9], status))
                return False
        time.sleep(POLL_SECONDS)
    print("    ⛔ %ds passed and the deploy for %s never reached a terminal status. "
          "UNREADABLE is not SUCCESS." % (DEPLOY_TIMEOUT, sha[:9]))
    return False


def _deployment_for_sha(out, sha):
    """The deployment row whose commit is `sha`, or None. ⛔ None means NOT FOUND, which
    is not the same as 'not finished' — the caller keeps polling rather than deciding."""
    try:
        rows = json.loads(out)
    except ValueError:
        return None
    if isinstance(rows, dict):
        rows = rows.get("deployments") or []
    for r in rows:
        if not isinstance(r, dict):
            continue
        ch = (r.get("meta") or {}).get("commitHash") or ""
        if ch and (ch.startswith(sha) or sha.startswith(ch)):
            return r
    return None


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
        state, reason = approval_state(packet)
        if _cannot_be_signed(state, reason):
            # ⛔ STRUCTURAL: no signature can ever land on this document. Refused in
            # BOTH modes, because previewing the merge of an unsignable packet is not a
            # preview of anything. Exit 3 so it is distinguishable from an ordinary
            # refusal (2) and a failure (1).
            print("    ⛔ %s — %s" % (state, reason))
            print("    ⛔ UNSIGNABLE AS IT STANDS: %s" % stem)
            print("    ⛔ STOPPED — nothing after this was attempted.")
            return UNSIGNABLE
        if state != "SIGNED":
            if not a.dry_run:
                print("    ⛔ %s (%s). Run sign_all.py first. STOPPED — nothing after "
                      "this was attempted." % (state, reason))
                return UNSIGNABLE
            # ⭐ A DRY RUN THAT STOPS AT ROW 1 IS NOT A PREVIEW. The owner needs the
            # WHOLE sequence to read before trusting it, so dry-run reports the block
            # and keeps printing — loudly, so it can never be mistaken for signed.
            print("    ⚠️  WOULD STOP HERE: %s — %s (dry run continues)" % (state, reason))
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
        # ⛔ K CP5 — ASK MASTER FIRST. This is what makes the script resumable, and it is
        # a READ, so it runs in dry-run too: a preview that cannot tell you what is
        # already done is not a preview of the run you are about to do.
        done, why = merged_into_master(commits, a.dry_run)
        if done is None:
            print("    ⛔ %s — STOPPED. Merged-state UNREADABLE is not 'not merged'; "
                  "guessing here re-merges a unit." % why)
            return FAIL
        if done and len(done) == len(commits):
            print("    ✅ ALREADY MERGED (all %d commit(s) are ancestors of "
                  "origin/master) — skipping." % len(commits))
            continue
        if done:
            # ⛔ PART of a unit on master is not a state this tool may paper over: the
            # remaining cherry-picks could be clean, or could be the half that conflicts.
            print("    ⛔ PARTIALLY MERGED — %d of %d commits are already on master: %s"
                  % (len(done), len(commits), ", ".join(done)))
            print("    ⛔ STOPPED. Finish or revert this unit by hand; a tool that "
                  "chooses for you here is choosing what lands on production.")
            return REFUSED
        for c in commits:
            rc, out = run(["git", "cherry-pick", c], CODE_REPO, a.dry_run)
            if rc != 0:
                print("    ⛔ cherry-pick failed: %s\n%s" % (c, out))
                # ⚰️ A failed cherry-pick leaves .git/CHERRY_PICK_HEAD behind and the
                # NEXT run dies on it before it reaches this unit. Say so, rather than
                # leaving the owner to discover it at the start of the resume.
                print("    ⛔ the code worktree is mid-cherry-pick. Resolve it, or "
                      "`git -C %s cherry-pick --abort`, before re-running." % CODE_REPO)
                return FAIL
        # ⛔ The sha is read AFTER the cherry-picks, because that is the commit the deploy
        # will carry. In dry-run no cherry-pick happened, so HEAD is somebody else's
        # commit — report the absence rather than a sha that would be wrong.
        rc, out = run(["git", "rev-parse", "HEAD"], CODE_REPO, False)
        sha = "" if a.dry_run else (out.strip() if rc == 0 else "")
        rc, out = run(["git", "push", "origin", "HEAD:master"], CODE_REPO, a.dry_run)
        if rc != 0:
            print("    ⛔ push refused (Layer-0 guard or remote): \n%s" % out)
            return FAIL
        if not wait_for_deploy(sha, a.dry_run):
            print("    ⛔ web deploy did not reach SUCCESS. STOPPED.")
            return FAIL
        print("    ✅ merged and deployed")

    if a.dry_run:
        print()
        print("[merge-all] DRY RUN — nothing merged, nothing pushed.")
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
