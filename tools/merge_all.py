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
# ⛔⛔ K CP7 — THE CODE REPO IS AN ARGUMENT, NOT A PLACE YOU STAND.
# ⚰️ Measured 2026-09-15: `merge_all.py --dry-run` printed a BYTE-IDENTICAL refusal from the
# feat worktree and from the master checkout `_merge-master`, because this path is resolved
# from `__file__` and the current working directory is never read. So the runbook sentence
# "the first line of each sitting is `cd <the master checkout>`" was INERT — the owner would
# have stood in the right worktree while every cherry-pick landed in the wrong one.
# ⛔ Worse, the refusal's own remedy named the FEAT worktree, so following it would have put
# `feat/s7-price-level` — the branch this programme's unpushed work and its in-flight CI run
# live on — onto master. A remedy that destroys the checkout it is run from is not a remedy.
# ⭐ `DEFAULT_CODE_REPO` keeps the old behaviour byte-for-byte when `--code-repo` is absent;
# the flag is the ONE authority when it is present, and every message names the repo actually
# used rather than the one this line happens to spell.
DEFAULT_CODE_REPO = DOCS_REPO.parent / "s7-price-level"
CODE_REPO = DEFAULT_CODE_REPO
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
    # F-SIGN-4: this row sat LAST and its commit is chronologically #14; E CP5 and E CP6
    # edit the same workflow file at #15 and #16, so the declared order CONFLICTED on
    # unit 11. Measured by replaying the sequence onto a throwaway, not by reading it.
    ("t2-cp1-build-record", ["4ad1108d1"], False),
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
    ("e-cp25-build-record", ["ce615a2eb", "8c39c4c28"], False),
    ("e-cp30-build-record", ["e02dca955"], False),           # F-CI-29
    ("e-cp31-build-record", ["16027f239", "4feaeb86f"], False),  # split attempt 1 + revert
    ("e-cp26-build-record", ["8a8ebe0ab"], False),
    ("e-cp32-build-record", ["4274e26cc"], False),           # F-CI-32
    ("e-cp33-build-record", ["240bb3305"], False),           # F-CI-36
    ("e-cp27-build-record", ["5a58d91cf"], False),
    ("e-cp28-build-record", ["304ac481c"], False),
    ("e-cp29-build-record", ["e703af0a8"], False),
    ("packet-k-two-command-signing-gate", [], False),        # docs worktree only
    ("k-cp3-build-record", [], False),                       # docs worktree only
    ("k-cp4-build-record", [], False),                       # docs worktree only
    ("k-cp5-build-record", [], False),                       # docs worktree only
    ("k-cp6-build-record", [], False),                       # docs worktree only
    ("k-cp7-build-record", [], False),                       # docs worktree only
    ("k-cp8-build-record", [], False),                       # docs worktree only
    ("k-cp9-build-record", [], False),                       # docs worktree only
    ("k-cp10-build-record", [], False),                      # docs worktree only
    ("k-cp11-build-record", [], False),                      # docs worktree only
    ("packet-t-stale-test-gate", ["7041a04a8"], False),
    ("d3-cp2-build-record", ["af9fe21a6"], False),
    ("s2-accelerator-chord-pre-implementation-gate", ["0ef787268"], True),  # MEMBER-VISIBLE
    # F-SIGN-5: `76a3b98c2` MODIFIES a file that F-S2-1 CREATES, so it cannot merge in
    # packet-t's position — the pick fails modify/delete. It carries zero member-visible
    # files (derived), which is what makes it legal after the redefined `#!last:`.
    ("t-cp2-build-record", ["76a3b98c2"], False),
    # ⛔ E CP34 LAST, ON PURPOSE. It adds `master` to the workflow's push triggers, and a
    # push event runs the workflow AS IT STANDS AT THE PUSHED COMMIT — so only this row's
    # own push triggers a master run. Placed first it would have queued one run per merge.
    ("e-cp34-build-record", ["4c4ba1cb1"], False),
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


RESOLUTIONS = DOCS_REPO / "docs/terminal-research/resolutions"
_RES_FIELD = re.compile(r"^(row|path|unit commit|master pre-image|unit   pre-image|"
                        r"unit pre-image|resolved blob|content)\s+(\S+)\s*$", re.M)
CORRUPT_RESOLUTION = 6


def read_resolutions(folder=None):
    """Every recorded resolution, parsed. (list, corrupt) — corrupt is never skipped.

    ⛔ A resolution whose recorded `resolved blob` does not hash-match its content file is
    CORRUPT, not absent. Silently ignoring it would apply nothing and read as "no resolution
    recorded", which is the one state that must never be confusable with a tampered one.
    """
    d = pathlib.Path(folder) if folder else RESOLUTIONS
    out, corrupt = [], []
    if not d.is_dir():
        return out, corrupt
    for md in sorted(d.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        f = {k.replace("unit   ", "unit ").strip(): v for k, v in _RES_FIELD.findall(text)}
        need = ("row", "path", "master pre-image", "unit pre-image", "resolved blob", "content")
        if not all(k in f for k in need):
            corrupt.append((md.name, "missing field(s): %s"
                            % ", ".join(k for k in need if k not in f)))
            continue
        blob = md.parent / f["content"]
        if not blob.is_file():
            corrupt.append((md.name, "content file missing: %s" % f["content"]))
            continue
        rc, got = run(["git", "hash-object", str(blob)], DOCS_REPO, False)
        got = got.strip()
        if rc != 0 or got != f["resolved blob"]:
            corrupt.append((md.name, "resolved blob %s but content hashes to %s"
                            % (f["resolved blob"][:12], got[:12])))
            continue
        f["_file"] = md
        f["_blob_path"] = blob
        out.append(f)
    return out, corrupt


def _blob_hash(repo, rev, path):
    rc, out = run(["git", "rev-parse", "%s:%s" % (rev, path)], repo, False)
    return out.strip() if rc == 0 else None


def resolution_for(stem, path, base_rev, unit_sha, repo, resolutions):
    """The recorded resolution for this (row, path), or (None, why).

    ⛔ BOTH pre-images must match EXACTLY. That is the whole mechanism: it distinguishes
    "master moved" from "master moved THIS FILE", and only the second invalidates the proof.
    """
    cands = [r for r in resolutions if r["row"] == stem and r["path"] == path]
    if not cands:
        return None, "no recorded resolution for %s :: %s" % (stem, path)
    m_now = _blob_hash(repo, base_rev, path)
    u_now = _blob_hash(repo, unit_sha, path)
    for r in cands:
        if r["master pre-image"] == m_now and r["unit pre-image"] == u_now:
            return r, ""
    r = cands[0]
    return None, ("pre-images differ — master %s recorded vs %s actual; unit %s recorded vs "
                  "%s actual" % (r["master pre-image"][:12], (m_now or "?")[:12],
                                 r["unit pre-image"][:12], (u_now or "?")[:12]))


def _manifest_row(stem, manifest=None):
    """(path, checkpoints, fingerprint) for a stem, DERIVED from the manifest."""
    man = pathlib.Path(manifest) if manifest else (DOCS_REPO / "tools/sign_manifest.txt")
    for line in man.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 3 and pathlib.Path(parts[0]).stem == stem:
            return parts[0], parts[1], parts[2]
    return None, None, None


def sign_one(packet, stem, manifest=None, by=None, on=None):
    """K CP10 — sign exactly this row, now. (ok, detail).

    ⛔ THE DELEGATION IS CHECKED PER UNIT, not once per run. A run that starts under a valid
    delegation and continues for four hours can outlive it; the authority is a file and the
    file can change.
    ⛔ The scope is DERIVED from the manifest's checkpoint cell, never typed — the same cell
    `sign_all` uses, so the two cannot disagree about what a row authorises.
    """
    sa = _load_sibling("sign_all")
    dstate, ddetail = sa.delegation_state()
    if dstate != "OK":
        return False, "NO DELEGATION (%s): %s" % (dstate, ddetail)
    # ⚰️ THE MANIFEST SUPPLIES THE SCOPE, NOT THE TARGET. The first version of this function
    # looked the row up and then signed `path` — the manifest's copy — ignoring the `packet`
    # it was handed. A fixture therefore stayed UNSIGNED while the REAL packet was signed,
    # outside any merge. Caught by the control, which is the only reason it was visible: the
    # run reported success either way.
    row_path, cps_cell, _fp = _manifest_row(stem, manifest)
    if not row_path:
        return False, "no manifest row for %s" % stem
    path = str(packet)
    cps = [c.strip() for c in (cps_cell or "").split(",") if c.strip()]
    if not cps:
        return False, "the manifest row for %s names no checkpoint" % stem
    scope = "%s ONLY — the checkpoint(s) named here and nothing else in the packet." % ", ".join(cps)
    on = on or _et_today()
    by = by or DELEGATED_BY
    scope_dir = DOCS_REPO / ".scopes"
    scope_dir.mkdir(exist_ok=True)
    sf = scope_dir / (pathlib.Path(path).stem + ".scope.txt")
    sf.write_text(scope + "\n", encoding="utf-8")
    r = subprocess.run([sys.executable, str(HERE / "sign_gate.py"), path,
                        "--by", by, "--on", on, "--scope-file", str(sf)],
                       cwd=str(DOCS_REPO), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        return False, "sign_gate exit %d: %s" % (r.returncode,
                                                 ((r.stdout or "") + (r.stderr or "")).strip()[:200])
    return True, "scope %s" % ", ".join(cps)


def _load_sibling(name):
    spec = importlib.util.spec_from_file_location(name, str(HERE / (name + ".py")))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _et_today():
    """The ET date from the authority, never `date.today()` (this box is CT)."""
    r = subprocess.run([sys.executable, str(CODE_REPO / "tools/weekly_exec.py"), "et"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"ET (\d{4}-\d{2}-\d{2})", r.stdout or "")
    if m:
        return m.group(1)
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%d")   # pragma: no cover - fallback


#: ⛔ The delegated by-line, recorded in the runbook's Delegation block. One spelling.
DELEGATED_BY = "Patrick (owner; delegated to the running Claude Code session, 2026-09-17)"


def replay(base="origin/master", units=None, repo=None, verbose=True):
    """K CP9 — PERFORM the merge on a throwaway and report the FIRST strand.

    ⛔⛔ WHETHER AN ORDERED MERGE CAN RUN IS ANSWERED BY RUNNING IT. F-SIGN-4 was a
    declared order that satisfied 36 of 36 constraints and stranded at unit 11 on a
    content conflict; F-SIGN-5 was a second one that stranded at commit 44 on a
    modify/delete. Neither is visible to a constraint graph, because a constraint graph
    describes RELATIVE ORDER and a cherry-pick cares about CONTENT.

    Returns (ok, text). The throwaway clone is always removed, including on a strand.
    """
    import shutil
    import tempfile
    repo = repo or CODE_REPO
    rows = units if units is not None else UNITS
    seq = [(stem, c) for stem, commits, _mv in rows for c in commits]
    if not seq:
        return True, "[merge-all] replay: ZERO units carry commits — nothing to replay."

    box = pathlib.Path(tempfile.mkdtemp(prefix="merge-replay-"))
    try:
        clone = box / "replay"
        rc, out = run(["git", "clone", "-q", "--no-hardlinks", "--shared", str(repo),
                       str(clone)], box, False)
        if rc != 0:
            return False, ("[merge-all] ⛔ replay UNREADABLE — could not clone %s: %s"
                           % (repo, out.strip()[:160]))
        run(["git", "config", "user.email", "replay@local"], clone, False)
        run(["git", "config", "user.name", "merge-replay"], clone, False)
        # ⛔⛔ RESOLVE THE BASE IN THE **SOURCE** REPO, THEN CHECK OUT THE SHA.
        # ⚰️ 2026-09-17: `git clone --shared <local repo>` makes the clone's `origin` the LOCAL
        # repo, so `origin/master` inside the clone resolves to that repo's LOCAL `master`
        # BRANCH — which here sat at 57113d1ac, **370 commits behind** the real
        # `origin/master` (d9455a6d6). Every "replay CLEAN" this tool had ever printed was
        # therefore measured against a 370-commit-stale base and predicted nothing about the
        # merge that would actually run. Re-measured against the true tip, the same sequence
        # STRANDS at #41 on `tests/conftest.py`.
        # ⭐ The name `origin/master` meant two different things on the two sides of a clone,
        # and the instrument never said which one it used. `--shared` means the object is
        # already reachable, so resolving first and checking out the SHA is both correct and
        # cheap.
        rc, resolved = run(["git", "rev-parse", base], repo, False)
        resolved = resolved.strip()
        if rc != 0 or not resolved:
            return False, ("[merge-all] ⛔ replay UNREADABLE — %r does not resolve in %s"
                           % (base, repo))
        rc, out = run(["git", "checkout", "-q", "-B", "merge-replay", resolved], clone, False)
        if rc != 0:
            return False, ("[merge-all] ⛔ replay UNREADABLE — %s (%s) is not checkoutable in "
                           "the clone: %s" % (base, resolved[:9], out.strip()[:160]))
        resolutions, corrupt = read_resolutions()
        if corrupt:
            return False, ("[merge-all] ⛔ REFUSED-CORRUPT-RESOLUTION: %s"
                           % "; ".join("%s (%s)" % c for c in corrupt))
        applied = []
        for i, (stem, sha) in enumerate(seq, 1):
            rc, out = run(["git", "cherry-pick", sha], clone, False)
            if rc != 0:
                _, st = run(["git", "diff", "--name-only", "--diff-filter=U"], clone, False)
                files = [l for l in st.split() if l.strip()]
                if not files:   # modify/delete leaves no UU entry
                    _, st2 = run(["git", "status", "--porcelain"], clone, False)
                    files = [l[3:] for l in st2.splitlines() if l[:2] in ("DU", "UD", "AU", "UA")]
                # ⛔ K CP11 — a recorded resolution, keyed by BOTH pre-images, or a stop.
                fixed, why = [], ""
                for path in files:
                    r, w = resolution_for(stem, path, resolved, sha, repo, resolutions)
                    if r is None:
                        why = w
                        break
                    fixed.append((path, r))
                if fixed and len(fixed) == len(files):
                    for path, r in fixed:
                        (clone / path).write_bytes(r["_blob_path"].read_bytes())
                        run(["git", "add", path], clone, False)
                        applied.append((stem, path, r["_file"].name))
                    rc2, out2 = run(["git", "-c", "core.editor=true", "cherry-pick",
                                     "--continue"], clone, False)
                    if rc2 == 0:
                        continue
                    why = "cherry-pick --continue failed: %s" % out2.strip()[:120]
                run(["git", "cherry-pick", "--abort"], clone, False)
                label = "STRAND-UNRESOLVED" if why and "no recorded" not in why else "STRAND"
                return False, ("[merge-all] ⛔ %s at #%d  %s  %s — conflicting: %s%s"
                               % (label, i, stem, sha, ", ".join(files) or "(unnamed)",
                                  ("\n              " + why) if why else ""))
        # ⛔ SAY WHICH BASE. A CLEAN that does not name the sha it replayed onto is the
        # sentence that hid a 370-commit-stale base for two sessions.
        note = ""
        if applied:
            note = "  (%d resolution%s applied: %s)" % (
                len(applied), "" if len(applied) == 1 else "s",
                ", ".join(sorted({a[2] for a in applied})))
        return True, ("[merge-all] replay CLEAN %d of %d  onto %s (%s)%s"
                      % (len(seq), len(seq), base, resolved[:9], note))
    finally:
        shutil.rmtree(box, ignore_errors=True)


def check_order(order: list, constraints: list, units=None) -> list:
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
            # ⛔⛔ REDEFINED 2026-09-16 (F-SIGN-5). This used to mean "nothing may be ordered
            # after it" — an ORDINAL — and that made F-SIGN-5 unresolvable by construction:
            # `76a3b98c2` MODIFIES a file that F-S2-1 CREATES, so the only position it can
            # occupy is after F-S2-1, and the ordinal forbade every such position.
            # ⭐ The property anyone actually wanted is "no MEMBER-VISIBLE change lands after
            # this one", and that is derivable from each following unit's file set.
            for stem in order[idx[a] + 1:]:
                vis = member_visible_files(stem, units)
                if vis is None:
                    bad.append("UNREADABLE: %r follows %r and its file set could not be "
                               "read, so it cannot be shown free of member-visible files"
                               % (stem, a))
                elif vis:
                    bad.append("ORDER VIOLATION: %r follows the last member-visible unit "
                               "%r and carries %d member-visible file(s): %s"
                               % (stem, a, len(vis), ", ".join(sorted(vis))))
    return bad


#: ⛔ DERIVED, never declared. A member-visible file is a path under `app/src/` that is not a
#: test, spec, `__tests__` member or story. The predicate is proved non-vacuous in the
#: self-check against F-S2-1's own commit, which carries three.
_NOT_MEMBER_VISIBLE = (".test.", ".spec.", "__tests__/", ".stories.")


def is_member_visible_path(path: str) -> bool:
    p = path.replace("\\", "/")
    if not p.startswith("app/src/"):
        return False
    return not any(marker in p for marker in _NOT_MEMBER_VISIBLE)


def member_visible_files(stem: str, units=None):
    """The member-visible files a unit's commits touch, or None if unreadable.

    ⛔ UNREADABLE IS A THIRD STATE. A commit git cannot show is not a commit with no
    member-visible files — reporting it as clean is how a member-facing change slips past
    the rule this function exists to enforce.
    """
    for s, commits, _mv in (units if units is not None else UNITS):
        if s != stem:
            continue
        seen = set()
        for c in commits:
            rc, out = run(["git", "show", "--name-only", "--format=", c], CODE_REPO, False)
            if rc != 0:
                return None
            seen.update(p for p in out.split() if is_member_visible_path(p))
        return seen
    return set()


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

    # ── `#!last:` UNDER THE REDEFINED SEMANTICS (F-SIGN-5, 2026-09-16) ──────────────────
    # ⚰️ THE CONTROL THAT USED TO SIT HERE NOW PASSES FOR THE WRONG REASON, AND IT WAS
    # CAUGHT BY PROBING IT RATHER THAN RE-RUNNING IT. It moved F-S2-1 to position 0 and
    # asserted `check_order` refused — which it still does, but on the `#!after:` clauses
    # its fixture drags along, NOT on the `last` rule. Measured: with `last` as the ONLY
    # constraint over synthetic stems it now returns `[]`, because synthetic stems have no
    # file set and the rule is about FILES now, not position. A control whose subject has
    # moved out from under it is not a control.
    S2 = "s2-accelerator-chord-pre-implementation-gate"
    last_only = [("last", S2, None)]
    # a follower carrying member-visible files -> REFUSED, and the files are NAMED
    vis_units = [(S2, ["0ef787268"], True), ("a-member-visible-follower", ["0ef787268"], False)]
    v2 = check_order([S2, "a-member-visible-follower"], last_only, vis_units)
    show("a row after #!last: carrying member-visible files: refuses", len(v2) == 1, True)
    show("...and NAMES them", all(n in v2[0] for n in ("TickerPopup.jsx", "Watchlists.jsx")), True)
    # ⭐ NON-VACUITY, and the whole point of the redefinition: a TESTS-ONLY follower is fine
    tst_units = [(S2, ["0ef787268"], True), ("t-cp2-build-record", ["76a3b98c2"], False)]
    show("...but a TESTS-ONLY row after it is ALLOWED (F-SIGN-5's fix)",
         check_order([S2, "t-cp2-build-record"], last_only, tst_units), [])
    # ⛔ UNREADABLE is a third state, never "clean"
    bad_units = [(S2, ["0ef787268"], True), ("ghost", ["0000000000000000"], False)]
    v3 = check_order([S2, "ghost"], last_only, bad_units)
    show("an UNREADABLE follower is refused, not called clean",
         len(v3) == 1 and "UNREADABLE" in v3[0], True)
    show("the predicate can say YES (3 member-visible files in F-S2-1's own commit)",
         len(member_visible_files(S2, [(S2, ["0ef787268"], True)])), 3)

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

    # ── K CP7: the code repo is an argument ─────────────────────────────────────────────
    # ⛔ THE FIRST ROW IS THE ONE THAT MATTERS ON A REVIEW: absent flag == the old path,
    # byte for byte. A refactor that quietly re-aimed the default would merge 43 units into
    # somewhere nobody named.
    show("no --code-repo  -> the DEFAULT, unchanged",
         resolve_code_repo(None)[0], DEFAULT_CODE_REPO)
    show("...and that default is still the feat worktree",
         DEFAULT_CODE_REPO.name, "s7-price-level")
    # ⭐ NON-VACUITY: a flag that resolved to the default for every input would satisfy the
    # row above and be completely inert. This one names a DIFFERENT real worktree and
    # asserts the answer MOVED.
    other = DOCS_REPO.parent / "_merge-master"
    got, why = resolve_code_repo(str(other))
    show("--code-repo <master checkout> -> that path", got, other)
    show("...and it is NOT the default (the flag actually moves the target)",
         got != DEFAULT_CODE_REPO, True)
    show("...with no error", why, "")
    # ⛔ A TYPO REFUSES. Without this, `--code-repo _merg-master` targets a directory that
    # does not exist and the run dies later wearing git's wording instead of its own.
    missing = DOCS_REPO.parent / "_merge-master-TYPO-does-not-exist"
    got_t, why_t = resolve_code_repo(str(missing))
    show("a path that does not exist -> REFUSED, not used", got_t, None)
    show("...and the refusal NAMES the path it was given",
         str(missing) in why_t, True)
    # ⛔ A REAL DIRECTORY THAT IS NOT A WORK TREE is the nastier typo — it exists, so an
    # `is_dir()` test passes it straight through.
    got_d, why_d = resolve_code_repo(str(DOCS_REPO.parent))
    show("an existing NON-worktree directory -> REFUSED", got_d, None)
    show("...named as 'not a git work tree'", "not a git work tree" in why_d, True)
    # ⛔ And the docs repo itself IS a work tree, so the refusal above cannot be passing for
    # the reason "everything is refused".
    got_ok, _ = resolve_code_repo(str(DOCS_REPO))
    show("a real work tree is ACCEPTED (the refusal is not blanket)",
         got_ok == DOCS_REPO.resolve(), True)

    # ── K CP7: UNITS and the manifest are ONE list, and nothing was checking that ────────
    # ⚰️ Caught by walking into it: K CP7's own row was added to `sign_manifest.txt` and NOT
    # to `UNITS`, and every existing check stayed green. `sign_all` would have signed 44
    # units and `merge_all` would have merged 43 — the 44th signed, approved, and silently
    # never merged. Two hand-maintained lists of the same thing is the second-authority
    # defect this programme has now paid for in four different shapes.
    # ⛔ Set difference BOTH WAYS, never a count: equal lengths with one name swapped is the
    # failure a count cannot see.
    man = DOCS_REPO / "tools" / "sign_manifest.txt"
    if man.is_file():
        rows = []
        for line in man.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            first = line.split("|")[0].strip()
            if first.endswith(".md"):
                rows.append(pathlib.Path(first).stem)
        unit_stems = [u[0] for u in UNITS]
        show("the manifest was read at all (non-vacuity)", len(rows) > 30, True)
        show("in the manifest but NOT in UNITS -> would be signed, never merged",
             sorted(set(rows) - set(unit_stems)), [])
        show("in UNITS but NOT in the manifest -> would be merged, never signed",
             sorted(set(unit_stems) - set(rows)), [])
        show("...and the two lists are the same length",
             (len(rows), len(unit_stems)), (len(unit_stems), len(unit_stems)))
    else:                                                    # pragma: no cover - layout
        show("the manifest is readable from the tool", man.is_file(), True)

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
    # ⚰️⚰️ **K CP6 RETRACTS K CP5's PRIMITIVE HERE.** K CP5 used
    # `git merge-base --is-ancestor <commit> origin/master`, and that is WRONG for a
    # cherry-pick workflow: cherry-picking REWRITES the commit, so the original sha is never
    # an ancestor of master no matter how thoroughly the change landed.
    #
    # ⛔ Measured in a throwaway repo shaped like the real one — master moved independently,
    # so the cherry-picks produced new shas:
    #     unit 1  --is-ancestor -> exit 1 "not merged"   truth: IS on master   WRONG
    #     unit 2  --is-ancestor -> exit 1 "not merged"   truth: IS on master   WRONG
    #     unit 3  --is-ancestor -> exit 1 "not merged"   truth: is NOT          right
    # A resumed run would therefore re-cherry-pick an already-merged unit, hit "the previous
    # cherry-pick is now empty", exit 1 and leave CHERRY_PICK_HEAD behind — which is the
    # exact failure K CP5 was written to remove.
    #
    # ⭐ **`git cherry` compares PATCH IDS, which is the question actually being asked**:
    #     unit 1  -> "- d0a33c45b"  EQUIVALENT UPSTREAM     right
    #     unit 2  -> "- a62470bcb"  EQUIVALENT UPSTREAM     right
    #     unit 3  -> "+ 4326b6e7a"  still to do             right
    # ⚠️ The first version of that control used a fixture where feat sat directly on master,
    # so cherry-pick reproduced IDENTICAL shas and `--is-ancestor` looked correct. A fixture
    # that cannot distinguish is not a control.
    done = []
    for c in commits:
        rc, out = run(["git", "cherry", "origin/master", c], CODE_REPO, False)
        if rc != 0:
            return None, "`git cherry` could not read %s: %s" % (c[:9], out.strip()[:120])
        mine = [l for l in out.splitlines() if l[2:].startswith(c[:9])]
        # no line for this commit at all == it is CONTAINED in upstream == merged
        if not mine or mine[-1].startswith("-"):
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


def resolve_code_repo(raw):
    """(path, error) — K CP7. `raw` is `--code-repo` or None.

    ⛔ A TYPO MUST REFUSE, NOT TARGET SOMETHING ELSE. A path that is not a git work tree is
    rejected by name here, because every later `git -C <path>` would fail one at a time with
    git's own wording and the run would read as a git problem rather than a wrong argument.
    ⭐ `git rev-parse --show-toplevel` is the test rather than `(p / ".git").exists()`: in a
    worktree `.git` is a FILE pointing elsewhere, and a subdirectory of a repo has neither —
    so the cheap test answers "no" for a perfectly good worktree and "no" for a real typo,
    which is a check that cannot distinguish.
    """
    if raw is None:
        return DEFAULT_CODE_REPO, ""
    path = pathlib.Path(raw).expanduser()
    if not path.is_absolute():
        path = (pathlib.Path.cwd() / path)
    try:
        path = path.resolve()
    except OSError as exc:                                   # pragma: no cover - OS-dependent
        return None, "--code-repo %s cannot be resolved: %s" % (raw, exc)
    if not path.is_dir():
        return None, "--code-repo %s is not a directory." % path
    rc, out = run(["git", "rev-parse", "--show-toplevel"], path, False)
    if rc != 0:
        return None, "--code-repo %s is not a git work tree." % path
    return path, ""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", default="tools/sign_manifest.txt")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-member-visible", action="store_true")
    ap.add_argument("--until", default=None,
                    help="stop AFTER this unit stem (a sitting boundary)")
    ap.add_argument("--code-repo", default=None,
                    help="the checkout to cherry-pick INTO; must be at "
                         "origin/master. Default: %s" % DEFAULT_CODE_REPO)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)

    if a.self_check:
        return _self_check()

    # ⛔ K CP7 — BIND THE TARGET BEFORE ANYTHING READS IT, AND SAY WHAT IT IS.
    # Every helper resolves `CODE_REPO` at call time, so rebinding it here is what makes the
    # flag reach `git cherry`, the deploy wait and the cherry-pick alike — one value, one
    # authority. A run that does not announce its target is a run nobody can audit later.
    global CODE_REPO
    repo, why = resolve_code_repo(a.code_repo)
    if repo is None:
        print("⛔ %s" % why)
        print("   STOPPED. Nothing was cherry-picked, nothing was pushed.")
        return REFUSED
    CODE_REPO = repo
    print("[merge-all] code repo: %s%s" % (
        CODE_REPO, "" if a.code_repo else "   (default — no --code-repo given)"))

    manifest = pathlib.Path(a.manifest)
    if not manifest.is_absolute():
        manifest = DOCS_REPO / a.manifest

    # ⛔ K CP3: the order is checked BEFORE a single cherry-pick is attempted. Checking it
    # afterwards would be a post-mortem, not a guard.
    # ⛔ THE ORDER IS CHECKED OVER THE **WHOLE** LIST, BEFORE ANY TRUNCATION. A sitting
    # boundary must not be able to hide a constraint violation that lives after it.
    # ⛔⛔ K CP9 — A DRY RUN IS A REPLAY. The constraint graph is checked SECOND and is
    # subordinate, because F-SIGN-4 was a declared order that satisfied every constraint and
    # could not execute: it stranded at unit 11 on a workflow conflict while this very tool
    # printed "all 36 constraint(s) SATISFIED" and exit 0.
    if a.dry_run:
        ok_replay, detail = replay(base="origin/master")
        if not ok_replay:
            print(detail)
            print("[merge-all] REFUSED — the declared order cannot run. Nothing was "
                  "cherry-picked, nothing was pushed.")
            return FAIL
        print(detail)
        print()

    rc = enforce_order(manifest, [u[0] for u in UNITS])
    if rc != OK:
        return rc
    print()

    # ⛔ K CP6 — ON A RESUME, THE INTERRUPTED SETTLE IS RE-WAITED BEFORE THE FIRST PUSH.
    # A run killed between unit N's push and its settle leaves master's tip mid-deploy. The
    # next run skips N as ALREADY MERGED (correctly — it IS on master) and would then push
    # N+1 straight into the Layer-0 guard, which refuses while the last deployment is not
    # SUCCESS or is younger than its settle. That refusal is right and it stops the session
    # dead, which is the thing this checkpoint exists to prevent.
    # ⭐ So the wait is on origin/master's CURRENT TIP — the same commit the guard looks at —
    # and it happens once, before the first push of the run.
    # ⛔⛔ K CP6 — THE CODE WORKTREE MUST BE **AT MASTER** BEFORE ANYTHING IS CHERRY-PICKED,
    # AND IT WAS NOT. Measured 2026-09-15: `s7-price-level` sits on `feat/s7-price-level`,
    # and unit 1's commit `18dd13683` is ALREADY IN THAT BRANCH'S HISTORY — so
    # `git cherry-pick 18dd13683` is EMPTY, exits 1, leaves `.git/CHERRY_PICK_HEAD` behind,
    # and the owner's very first merge command dies on the very first unit.
    # ⭐ Reproduced in a throwaway repo before it was believed: the R.3 control failed at
    # `── u1` with exit 1 for exactly this reason, and that is why the control exists.
    # ⛔ It REFUSES rather than checking master out itself: this worktree is shared, and a
    # tool that silently moves somebody else's HEAD is a worse bug than the one it fixes.
    rc_h, head = run(["git", "rev-parse", "HEAD"], CODE_REPO, False)
    run(["git", "fetch", "origin", "master"], CODE_REPO, False)
    rc_m, om = run(["git", "rev-parse", "origin/master"], CODE_REPO, False)
    if rc_h != 0 or rc_m != 0:
        print("⛔ could not read HEAD or origin/master in %s. STOPPED." % CODE_REPO)
        return FAIL
    if head.strip() != om.strip():
        rc_b, br = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], CODE_REPO, False)
        msg = ("⛔ the code worktree is at %s (%s), not at origin/master (%s).\n"
               "   Every cherry-pick would be applied onto that branch — and for a branch "
               "that already CONTAINS these commits each one is EMPTY, exits 1, and leaves "
               ".git/CHERRY_PICK_HEAD behind.\n"
               "   Put it at master first:\n"
               "     git -C %s checkout -B merge-run origin/master"
               % (br.strip() or "?", head.strip()[:9], om.strip()[:9], CODE_REPO))
        if not a.dry_run:
            print(msg)
            print("   STOPPED. Nothing was cherry-picked, nothing was pushed.")
            return REFUSED
        # ⭐ A DRY RUN THAT STOPS HERE IS NOT A PREVIEW. Same rule as an unsigned packet:
        # report it loudly and keep printing the sequence the owner needs to read.
        print(msg)
        print("   ⚠️  WOULD STOP HERE (dry run continues)")
        print()

    resumed_wait_done = [False]
    skipped_any = [False]
    units = UNITS
    if a.until:
        stems = [u[0] for u in UNITS]
        if a.until not in stems:
            print("⛔ --until %r matches no unit. Nothing was merged." % a.until)
            print("   the last five units are: %s" % ", ".join(stems[-5:]))
            return REFUSED
        units = UNITS[:stems.index(a.until) + 1]

    print("[merge-all] units: %d of %d   member-visible included: %s%s"
          % (len(units), len(UNITS), a.include_member_visible,
             "   [--until %s]" % a.until if a.until else ""))
    print()

    for stem, commits, member_visible in units:
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
        # ⛔⛔ K CP10 — SIGNING IS THE LAST ACT BEFORE **THIS** UNIT'S MERGE.
        # ⚰️ Signing every row up front and then merging invites a strand on an ALREADY-SIGNED
        # unit, whose build record cites a SHA that the resolution would have to rewrite —
        # and a signature is pinned to the packet's content, so the fix would mean editing a
        # signed row. Master moves hourly here; F-MERGE-2 was exactly that shape.
        # ⭐ Signing here makes a strand hit an UNSIGNED row BY CONSTRUCTION, so the fix is
        # always a rewrite of one commit plus a record update, never a re-signature.
        if state != "SIGNED" and not a.dry_run:
            signed_now, why = sign_one(packet, stem)
            if not signed_now:
                print("    ⛔ could not sign %s: %s" % (stem, why))
                print("    ⛔ STOPPED — nothing after this was attempted.")
                return UNSIGNABLE
            state, reason = approval_state(packet)
            if state != "SIGNED":
                print("    ⛔ signed, but the packet still reads %s (%s). STOPPED."
                      % (state, reason))
                return UNSIGNABLE
            print("    ✅ SIGNED (%s)" % why)
        if state != "SIGNED":
            if not a.dry_run:
                print("    ⛔ %s (%s). STOPPED — nothing after this was attempted."
                      % (state, reason))
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
            # ⛔ "equivalent upstream", not "an ancestor": cherry-pick rewrites the sha,
            # so patch-id is the only thing that can answer this. See merged_into_master.
            print("    ✅ ALREADY MERGED (all %d commit(s) are equivalent to something "
                  "already on origin/master) — skipping." % len(commits))
            skipped_any[0] = True
            continue
        if done:
            # ⛔ PART of a unit on master is not a state this tool may paper over: the
            # remaining cherry-picks could be clean, or could be the half that conflicts.
            print("    ⛔ PARTIALLY MERGED — %d of %d commits are already on master: %s"
                  % (len(done), len(commits), ", ".join(done)))
            print("    ⛔ STOPPED. Finish or revert this unit by hand; a tool that "
                  "chooses for you here is choosing what lands on production.")
            return REFUSED
        # ⛔ THE RESUMED SETTLE, once, before this run's FIRST push. See the note above.
        if skipped_any[0] and not resumed_wait_done[0]:
            resumed_wait_done[0] = True
            rc, tip = run(["git", "rev-parse", "origin/master"], CODE_REPO, False)
            tip = tip.strip() if rc == 0 else ""
            print("    ⏳ RESUMING after a skip — waiting on master's current tip %s "
                  "before pushing anything new." % (tip[:9] or "UNREADABLE"))
            if not wait_for_deploy(tip, a.dry_run):
                print("    ⛔ master's tip has not settled. STOPPED before pushing — the "
                      "Layer-0 guard would refuse this push anyway, and stopping here says "
                      "why.")
                return FAIL
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
