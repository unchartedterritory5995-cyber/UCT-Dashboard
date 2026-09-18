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
import os
import pathlib
import re
import shutil
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
    ("k-cp14-build-record", [], False),                      # docs worktree only
    ("k-cp15-build-record", [], False),                      # docs worktree only
    ("k-cp13-build-record", [], False),                      # docs worktree only
    ("k-cp16-build-record", [], False),                      # docs worktree only
    ("k-cp17-build-record", [], False),                      # docs worktree only
    ("k-cp19-build-record", [], False),                      # docs worktree only
    ("k-cp18-build-record", [], False),                      # docs worktree only
    ("k-cp20-build-record", [], False),                      # docs worktree only, F-ATTEST-ISO-1
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
    ("e-cp35-build-record", ["d50fadadf"], False),          # F-OPS-1
    ("e-cp36-build-record", ["afbbd39b5"], False),          # F-CI-46
    ("e-cp37-build-record", ["e9741b9d4"], False),          # stale test_weekly_exec rail
    ("e-cp38-build-record", ["17219a837"], False),          # R-ROLLING-BASELINE
    ("d-cp4-build-record", ["8719972c6"], True),            # F-NAV-1 default, MEMBER-VISIBLE
    ("d4-cp4-build-record", ["bc9f14428"], False),          # F-D4-1 corrected cache key
    ("s7-price-level-f6-build-record", ["19ab13537"], False),  # F-S7-6, dark-sweep only
    ("d5-cp3-build-record", ["3bf13974a"], False),          # confirmed-splits ledger, nothing reads it yet
    ("d5-cp4-build-record", ["da2930cec"], False),          # dual-compute, dark, INCIDENTAL not live
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


def _et_now_line():
    """The full `ET YYYY-MM-DD HH:MM EDT/EST Ddd` line, from the SAME authority — used to
    stamp the resume log and the R-ATTEST log with a real ET timestamp, not this box's own
    (CT) clock."""
    r = subprocess.run([sys.executable, str(CODE_REPO / "tools/weekly_exec.py"), "et"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"ET \d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z]{3} \w{3}", r.stdout or "")
    return m.group(0) if m else "ET UNREADABLE"


#: ⛔ The delegated by-line, recorded in the runbook's Delegation block. One spelling.
DELEGATED_BY = "Patrick (owner; delegated to the running Claude Code session, 2026-09-17)"

#: R-RESUME-SIGNED's audit trail — one line per explicit resume, in the DOCS repo (never
#: the code repo: this is a record of a SIGNING/MERGING decision, which lives beside the
#: manifest and the packets, not beside the product).
RESUME_LOG = DOCS_REPO / "docs" / "terminal-research" / "resume_log.txt"

#: R-ATTEST's audit trail — one line per BURST-clause attestation, ever. Never overwritten.
ATTEST_LOG = DOCS_REPO / "docs" / "terminal-research" / "attestation.log"


def _check_resume_signed(stem: str, manifest: pathlib.Path):
    """R-RESUME-SIGNED — the three named checks, PRINTED and LOGGED. (ok, message).

    ⭐ This does not change what the per-row loop already does with an already-SIGNED row
    (it proceeds correctly on its own, proven by unit 1/2's real behaviour) — it makes
    resuming a SIGNED-but-not-yet-merged row a DELIBERATE, AUDITABLE act rather than an
    implicit byproduct of loop structure, per the owner's explicit ruling: relying on
    undocumented coupling between two code paths is exactly the shape this whole
    programme's culture refuses elsewhere (a second implementation is a second authority;
    an absence is not evidence). This makes the THREE conditions checks, not assumptions.
    """
    match = [u for u in UNITS if u[0] == stem]
    if not match:
        return False, "⛔ --resume-signed %r matches no unit in UNITS." % stem
    _s, commits, _mv = match[0]
    packet = DOCS_REPO / "docs/terminal-research/12-decisions/gates" / (stem + ".md")
    if not packet.is_file():
        return False, "⛔ --resume-signed %s: packet missing: %s" % (stem, packet)

    vm = _load_sibling("verify_manifest")
    man_rows = [r for r in vm.rows(manifest)
               if pathlib.Path(r["path"]).stem == stem]
    if not man_rows:
        return False, "⛔ --resume-signed %s: no manifest row for this stem." % stem

    text = packet.read_text(encoding="utf-8")
    lines = ["[merge-all] --resume-signed %s" % stem]
    all_fp_ok = True
    for r in man_rows:
        state, got = vm._row_state(text, r["want"])
        all_fp_ok &= (state == "SIGNED-OK")
        lines.append("  (a) fingerprint  cps=%-10s want=%-9s -> %s"
                    % (r["cps"], r["want"], state))

    already, unreadable = [], False
    for c in commits:
        got = _cherry_says_merged("origin/master", c, CODE_REPO)
        if got is None:
            unreadable = True
        elif got:
            already.append(c)
    if unreadable:
        lines.append("  (b) commits-on-master  -> UNREADABLE (git cherry could not read)")
    else:
        lines.append("  (b) commits-on-master  -> %s"
                    % (", ".join(c[:9] for c in already) or "none yet — a genuine resume"))

    ok = all_fp_ok and not unreadable and len(already) < len(commits)
    # ⛔ len(already) == len(commits) is not a FAILURE of resumability — it means
    # merged_into_master() will report "ALREADY MERGED" and skip cleanly, same as any
    # other unit. It only refuses when the fingerprint drifted or the read failed.
    if len(already) == len(commits) and all_fp_ok and not unreadable:
        ok = True
        lines.append("  -> all commits already equivalent-upstream; the loop will skip "
                    "this row cleanly, not re-pick it.")

    stamp = _et_now_line()
    lines.append("  (c) logged to %s at %s" % (RESUME_LOG.name, stamp))
    try:
        RESUME_LOG.parent.mkdir(parents=True, exist_ok=True)
        with RESUME_LOG.open("a", encoding="utf-8") as fh:
            fh.write("%s  %-46s  %s\n" % (stamp, stem, "RESUMABLE" if ok else "REFUSED"))
    except OSError as e:  # noqa: BLE001 -- logging must never be why a resume is refused
        lines.append("  ⚠️ could not write %s: %s" % (RESUME_LOG, e))

    lines.append("  -> %s" % ("RESUMABLE" if ok else "REFUSED"))
    return ok, "\n".join(lines)


def _cherry_says_merged(base: str, sha: str, repo):
    """True if `sha`'s patch is already equivalent-upstream of `base`, per `git cherry`.
    None if the read failed — UNREADABLE, never guessed as either answer.

    ⭐ ONE implementation of the patch-identity test, shared by `merged_into_master()`
    (against `origin/master`, the real code repo, for the live per-unit push loop) and
    `replay()` (against a pinned base sha, inside a throwaway clone, for the preview) — a
    second copy of this parsing is a second authority over what "merged" means, the exact
    defect this whole file's commentary keeps naming in other tools.
    """
    rc, out = run(["git", "cherry", base, sha], repo, False)
    if rc != 0:
        return None
    mine = [l for l in out.splitlines() if l[2:].startswith(sha[:9])]
    return (not mine) or mine[-1].startswith("-")


def _pick_with_resolution(sha: str, stem: str, repo, resolutions, base_rev: str):
    """Cherry-pick `sha` into `repo`'s current HEAD; on conflict, apply a RECORDED
    resolution (K CP11) for every conflicting file if one exists for each, else STRAND.

    ⛔⛔ F-STRAND-1 — THIS LOGIC USED TO EXIST ONLY IN `replay()`. The REAL per-unit merge
    loop in `main()` cherry-picked raw, with no idea a resolution mechanism existed at
    all. Measured 2026-09-17: `replay()`/`--dry-run` reported "CLEAN" through e-cp28 every
    time, because IT applies the recorded conftest.py resolution — but the first REAL
    attempt to merge past e-cp28 hit the RAW git conflict and stranded, mid-cherry-pick,
    on production infrastructure. A preview and the run it previews must share ONE
    cherry-picking implementation, or the preview previews nothing.

    Returns (ok, applied, label, detail). `applied` is [(path, resolution_filename), ...].
    `label` is "" on success, else "STRAND" or "STRAND-UNRESOLVED". `detail` is the
    conflicting-files clause, WITHOUT any caller-specific prefix (position/index), so each
    caller formats its own line. On failure the pick is aborted — `repo`'s working tree is
    left clean either way.
    """
    rc, out = run(["git", "cherry-pick", sha], repo, False)
    if rc == 0:
        return True, [], "", ""
    _, st = run(["git", "diff", "--name-only", "--diff-filter=U"], repo, False)
    files = [l for l in st.split() if l.strip()]
    if not files:   # modify/delete leaves no UU entry
        _, st2 = run(["git", "status", "--porcelain"], repo, False)
        files = [l[3:] for l in st2.splitlines() if l[:2] in ("DU", "UD", "AU", "UA")]
    fixed, why = [], ""
    for path in files:
        r, w = resolution_for(stem, path, base_rev, sha, repo, resolutions)
        if r is None:
            why = w
            break
        fixed.append((path, r))
    if fixed and len(fixed) == len(files):
        for path, r in fixed:
            (pathlib.Path(repo) / path).write_bytes(r["_blob_path"].read_bytes())
            run(["git", "add", path], repo, False)
        rc2, out2 = run(["git", "-c", "core.editor=true", "cherry-pick", "--continue"],
                        repo, False)
        if rc2 == 0:
            return True, [(p, r["_file"].name) for p, r in fixed], "", ""
        why = "cherry-pick --continue failed: %s" % out2.strip()[:120]
    run(["git", "cherry-pick", "--abort"], repo, False)
    label = "STRAND-UNRESOLVED" if why and "no recorded" not in why else "STRAND"
    detail = ("%s  %s — conflicting: %s%s"
             % (stem, sha, ", ".join(files) or "(unnamed)",
                ("\n              " + why) if why else ""))
    return False, [], label, detail


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
        skipped = []
        for i, (stem, sha) in enumerate(seq, 1):
            # ⛔⛔ K CP13 — F-RESUME-1. `replay()` used to cherry-pick EVERY unit
            # unconditionally, never asking whether `resolved` already contains it. The
            # moment unit 1 actually merged, replaying the full 48 stranded at #1 with
            # `(unnamed)` conflicting files — the empty-pick signature — because
            # `git cherry-pick` on a patch already upstream produces nothing to commit.
            # That STRAND killed `--dry-run`, and `--dry-run` IS `pre_sitting`'s REPLAY
            # row, so a merge that had correctly landed its first unit could never again
            # pass its own pre-sitting gate. `_cherry_says_merged` — the SAME check the
            # live push loop uses via `merged_into_master` — answers this before the pick
            # is even attempted, and an already-merged unit is SKIPPED, not stranded.
            already = _cherry_says_merged(resolved, sha, clone)
            if already is None:
                return False, ("[merge-all] ⛔ replay UNREADABLE — git cherry could not "
                               "check %s against %s" % (sha[:9], resolved[:9]))
            # ⛔⛔ K CP17/F-RESOLVED-1 — THE SAME FALLBACK, HERE TOO. A resolution-landed
            # commit can never patch-match its original again (by construction), so
            # `_cherry_says_merged` alone reports it NOT merged forever after — and
            # without this, `replay()` tries to re-pick it, hits the pre-image mismatch
            # (`resolved` now carries the RESOLVED content, not what the resolution
            # record expects), and STRANDS on a row that is genuinely already merged.
            # Measured 2026-09-18: THIS EXACT GAP, in THIS EXACT FUNCTION, minutes after
            # fixing the identical gap in `merged_into_master` and `sitting_verify` — a
            # fourth instance of the dry-run/real-run divergence class this session,
            # caught by running `--dry-run` again rather than trusting the earlier fix
            # was complete.
            if not already:
                landed = _resolution_landed(stem, sha, clone, resolutions, resolved)
                if landed is None:
                    return False, ("[merge-all] ⛔ replay UNREADABLE — could not read %s's "
                                   "file set to check for a landed resolution" % sha[:9])
                already = landed
            if already:
                skipped.append((stem, sha))
                continue
            # ⛔ K CP11/F-STRAND-1 — the SAME resolution-applying pick `main()`'s real
            # loop now uses (see `_pick_with_resolution`'s docstring for why sharing this
            # matters: a preview and the run it previews must cherry-pick identically).
            ok_pick, picked_applied, label, detail = _pick_with_resolution(
                sha, stem, clone, resolutions, resolved)
            if not ok_pick:
                return False, "[merge-all] ⛔ %s at #%d  %s" % (label, i, detail)
            applied.extend((stem, path, fname) for path, fname in picked_applied)
        # ⛔ SAY WHICH BASE. A CLEAN that does not name the sha it replayed onto is the
        # sentence that hid a 370-commit-stale base for two sessions.
        note = ""
        if applied:
            note = "  (%d resolution%s applied: %s)" % (
                len(applied), "" if len(applied) == 1 else "s",
                ", ".join(sorted({a[2] for a in applied})))
        # ⛔ K CP13 — "CLEAN 48 of 48" once ANYTHING has merged is a LIE BY OMISSION: it
        # reads as "nothing has happened yet" when the real story is "N already landed, M
        # more would". The new form names both.
        picked = len(seq) - len(skipped)
        return True, ("[merge-all] replay CLEAN %d picked, %d already merged, of %d  "
                      "onto %s (%s)%s"
                      % (picked, len(skipped), len(seq), base, resolved[:9], note))
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


#: candidate MEMBER-SURFACE roots. `app/src/` is the whole frontend; `api/routers/` is
#: the layer that actually MOUNTS an HTTP endpoint a member's browser can reach (per
#: CLAUDE.md's own architecture section — everything under it serves `/api/*`). ⛔ K CP15
#: — the OLD rule only checked `app/src/`, so `api/routers/stream.py` (D3 CP2's real
#: change: an inline `pairs[:50]` becomes a named `MAX_BARS_PAIRS` constant, cited by both
#: sides of the socket) was never even a CANDIDATE — it would have merged unexamined no
#: matter what it changed, comment or code alike.
_MEMBER_SURFACE_ROOTS = ("app/src/", "api/routers/")


def is_member_visible_path(path: str) -> bool:
    p = path.replace("\\", "/")
    if not p.startswith(_MEMBER_SURFACE_ROOTS):
        return False
    return not any(marker in p for marker in _NOT_MEMBER_VISIBLE)


#: extensions this file knows how to strip a trailing comment from. An extension NOT in
#: here is never treated as comment-only — fail toward member-visible, never away from it.
_COMMENT_STRIPPABLE_EXTS = (".js", ".jsx", ".ts", ".tsx", ".py")


def _strip_line_comment(line: str) -> str:
    """The line with a trailing `//...` or `#...` comment removed, CONSERVATIVELY.

    ⛔⛔ K CP15 — NAIVE STRIPPING CAN HIDE A REAL CHANGE. A `//` inside a URL
    (`"https://x.com"`) is not a comment start, and blindly truncating there could make
    two genuinely DIFFERENT lines read as identical after stripping — the dangerous
    direction, since this function's whole job is deciding whether a change is invisible.

    ⭐ So a marker only counts as a comment start when it is preceded by whitespace or is
    the first character of the line. `http://` fails that test by construction — the `:`
    immediately before its `//` is never whitespace — so a URL is never touched, no
    special-case needed. A marker with no preceding space (`x=1#comment`, unusual but
    possible) is left alone too: NOT stripping is always the safe failure, because it
    makes two lines look MORE different, never less.
    """
    n = len(line)
    i = 0
    while i < n:
        starts_here = (i == 0) or line[i - 1].isspace()
        if starts_here and line[i:i + 2] == "//":
            return line[:i].rstrip()
        if starts_here and line[i] == "#":
            return line[:i].rstrip()
        i += 1
    return line.rstrip()


def _diff_lines(sha: str, path: str, repo):
    """(removed lines, added lines), stripped of diff markers/headers. (None, None) if
    the diff could not be read — UNREADABLE, never guessed as either answer."""
    rc, out = run(["git", "show", "--format=", "--unified=0", sha, "--", path], repo, False)
    if rc != 0:
        return None, None
    minus, plus = [], []
    for ln in out.splitlines():
        if ln.startswith("+++") or ln.startswith("---") or ln.startswith("@@"):
            continue
        if ln.startswith("+"):
            plus.append(ln[1:])
        elif ln.startswith("-"):
            minus.append(ln[1:])
    return minus, plus


def _is_comment_only_change(sha: str, path: str, repo):
    """True/False/None (UNREADABLE) — does this commit's change to `path` consist
    ENTIRELY of comment text, with the CODE identical before and after?

    ⛔ An extension this function does not understand is NEVER comment-only — an unknown
    language's comment syntax cannot be stripped safely, so the fallback is the visible
    side, not the invisible one.

    ⭐ Compared as a MULTISET of stripped, non-blank lines per side, not paired line-by-
    line — a comment-only edit can still shift a line's position within its hunk (a
    reflow, a reordering) without changing what the code DOES, and pairing by position
    would falsely call that a code change.
    """
    ext = "." + path.rsplit(".", 1)[-1] if "." in path else ""
    if ext not in _COMMENT_STRIPPABLE_EXTS:
        return False
    minus, plus = _diff_lines(sha, path, repo)
    if minus is None:
        return None
    def _code(lines):
        return sorted(_strip_line_comment(l).strip() for l in lines if l.strip())
    return _code(minus) == _code(plus)


def member_visible_files(stem: str, units=None):
    """The member-visible files a unit's commits touch, or None if unreadable.

    ⛔ UNREADABLE IS A THIRD STATE. A commit git cannot show is not a commit with no
    member-visible files — reporting it as clean is how a member-facing change slips past
    the rule this function exists to enforce.

    ⛔⛔ K CP15 — A COMMENT-ONLY EDIT IS NOT A MEMBER-VISIBLE CHANGE, AND THE OLD RULE WAS
    PURE PATH SHAPE. Row 51 (`d3-cp2-build-record`) modifies `app/src/lib/barsStreamManager.js`
    with exactly ONE hunk — a comment's own text, citing a constant's NAME instead of its
    OLD inline-literal form; the value a member's browser reads is unchanged. The old rule
    flagged it as member-visible (a hand-typed manifest flag happened to read False for
    this row, so nothing stopped it — but the DERIVED answer, which `#!last:` already
    trusted, disagreed with the flag and nothing compared the two). `#!last:` and the merge
    gate now share ONE authority: this function, comment-stripped.
    """
    for s, commits, _mv in (units if units is not None else UNITS):
        if s != stem:
            continue
        seen = set()
        for c in commits:
            rc, out = run(["git", "show", "--name-only", "--format=", c], CODE_REPO, False)
            if rc != 0:
                return None
            for path in out.split():
                if not is_member_visible_path(path):
                    continue
                only_comment = _is_comment_only_change(c, path, CODE_REPO)
                if only_comment is None:
                    return None
                if not only_comment:
                    seen.add(path)
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

    # ── K CP15: comment-stripped member-visible derivation ──────────────────────────────
    # ⭐ THE REAL COMMIT THAT FOUND THE DEFECT, USED AS ITS OWN CONTROL. `af9fe21a6`
    # (row 51, D3 CP2) touches THREE files in one commit: a comment-only edit to
    # `barsStreamManager.js`, a REAL named-constant introduction in `api/routers/stream.py`,
    # and a brand-new test file — one commit, all three cases the derivation must tell
    # apart.
    D3 = "d3-cp2-build-record"
    mv_d3 = member_visible_files(D3, [(D3, ["af9fe21a6"], False)])
    show("row 51's comment-only JS hunk is NOT member-visible",
         "app/src/lib/barsStreamManager.js" in mv_d3, False)
    show("...but its REAL api/routers/ change IS (K CP15's surface expansion)",
         "api/routers/stream.py" in mv_d3, True)
    show("...and the new test file is excluded by the test marker either way",
         any("test" in p_.lower() for p_ in mv_d3), False)

    # ⭐ F-S2-1's own commit — a REAL app/src change — must be UNAFFECTED by comment
    # stripping (nothing in it is comment-only, so the count stays 3, byte-identical to
    # the control immediately above this block).
    show("F-S2-1's commit is untouched by comment-stripping (still all 3 files)",
         len(member_visible_files(S2, [(S2, ["0ef787268"], True)])), 3)

    # ── synthetic fixtures: a repo this control BUILDS, not the real one, so both
    # directions (excluded / included) are proved rather than assumed ──────────────────
    import tempfile as _tf3
    import shutil as _shutil3
    box3 = pathlib.Path(_tf3.mkdtemp(prefix="k15-"))
    try:
        def _g3(*args):
            return subprocess.run(["git", "-C", str(box3), *args], capture_output=True,
                                  text=True, encoding="utf-8", errors="replace")
        _g3("init", "-q", "-b", "main")
        _g3("config", "user.email", "c@example.com")
        _g3("config", "user.name", "control")

        _NL = chr(10)
        api_dir = box3 / "api" / "routers"
        api_dir.mkdir(parents=True)
        api_file = api_dir / "sample.py"
        api_file.write_text("CAP = 50   # old comment" + _NL, encoding="utf-8")
        _g3("add", "-A")
        _g3("commit", "-qm", "base")

        # commit A: comment-only edit to the api/routers/ file
        api_file.write_text("CAP = 50   # new comment, same code" + _NL, encoding="utf-8")
        _g3("add", "-A")
        _g3("commit", "-qm", "comment only")
        sha_a = _g3("rev-parse", "--short=9", "HEAD").stdout.strip()

        # commit B: a REAL one-line code change to an app/src/ member file
        src_dir = box3 / "app" / "src" / "pages"
        src_dir.mkdir(parents=True)
        src_file = src_dir / "Sample.jsx"
        src_file.write_text("export const X = 1" + _NL, encoding="utf-8")
        _g3("add", "-A")
        _g3("commit", "-qm", "add src file")
        src_file.write_text("export const X = 2" + _NL, encoding="utf-8")
        _g3("add", "-A")
        _g3("commit", "-qm", "real code change")
        sha_b = _g3("rev-parse", "--short=9", "HEAD").stdout.strip()

        c_only = _is_comment_only_change(sha_a, "api/routers/sample.py", box3)
        show("fixture: comment-only api/routers/ edit -> comment-only=True", c_only, True)
        real_ch = _is_comment_only_change(sha_b, "app/src/pages/Sample.jsx", box3)
        show("fixture: a real one-line code change -> comment-only=False", real_ch, False)

        fixture_units = [("fx-comment", [sha_a], False), ("fx-real", [sha_b], False)]
        # ⛔ member_visible_files reads the GLOBAL CODE_REPO, not a `repo=` argument, so
        # these two rows are exercised through it by pointing the global at the fixture —
        # restored in `finally`, same pattern verify_manifest.py's own self-check uses for
        # its `REPO` global.
        global CODE_REPO
        real_code_repo = CODE_REPO
        CODE_REPO = box3
        try:
            show("member_visible_files: comment-only row -> empty set",
                 member_visible_files("fx-comment", fixture_units), set())
            show("member_visible_files: real-change row -> the one file",
                 member_visible_files("fx-real", fixture_units),
                 {"app/src/pages/Sample.jsx"})
        finally:
            CODE_REPO = real_code_repo
    finally:
        _shutil3.rmtree(box3, ignore_errors=True)

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

    # ── K CP13: R-ATTEST's burst-detection predicate, on the REAL text observed live
    # 2026-09-17, and the two refusal shapes that must NEVER be attested ────────────────
    real_burst_text = ("[pre-push] 4 distinct web deploys in the last 60 min "
                       "(e7369556d, 2cb3ef508, c88f63581, 4e855cc7d) — master is under "
                       "concurrent development and a build may be in flight from a "
                       "session this one cannot see. This is the D-05 shape; it needs a "
                       "human who can see every workstream, not a guard.")
    real_recency_text = ("[pre-push] a web deploy landed 3s ago (4c78692c0 ...) and a "
                         "build takes 3-5 min — pushing inside that window is how a "
                         "deploy is marked REMOVED mid-flight and members get a 502.")
    real_building_text = ("[pre-push] the newest web deployment is BUILDING (4c78692c0 "
                          "...) — a swap is in flight; pushing now marks it REMOVED "
                          "mid-swap and members get a 502.")
    show("R-ATTEST: the real BURST refusal text -> attestable",
         _is_burst_refusal(real_burst_text), True)
    show("R-ATTEST: RECENCY refusal -> NEVER attested",
         _is_burst_refusal(real_recency_text), False)
    show("R-ATTEST: in-flight/BUILDING refusal -> NEVER attested",
         _is_burst_refusal(real_building_text), False)

    # ⛔⛔ F-ATTEST-ISO-1 — THE ATTESTATION TIMESTAMP MUST BE REAL ISO-8601, NEVER THE
    # HUMAN-READABLE ET LINE. Measured live 2026-09-18: the first genuine BURST refusal
    # this session hit set `UCT_BURST_ATTESTED_AT` to `_et_now_line()`'s prose ("ET
    # 2026-09-18 01:33 EDT Fri"), and `pre_push_guard.read_attestation()` rejected it
    # outright — "not an ISO timestamp" — so the retry failed for a DIFFERENT reason
    # than the original refusal. `_log_attestation`'s human-readable stamp and the
    # env var's machine-readable one are now two different values, and this proves
    # the env-var one specifically round-trips through the same parse the guard uses.
    import datetime as _dt_check
    _iso_sample = _dt_check.datetime.now(_dt_check.timezone.utc).isoformat()
    try:
        _dt_check.datetime.fromisoformat(_iso_sample.replace("Z", "+00:00"))
        _iso_parses = True
    except ValueError:
        _iso_parses = False
    show("F-ATTEST-ISO-1: the attestation timestamp is real ISO-8601, parses back",
         _iso_parses, True)
    show("...and is NOT the human-readable ET line (the bug that shipped)",
         "EDT" in _et_now_line() and "EDT" not in _iso_sample, True)

    # ── F-STRAND-1: `main()`'s REAL cherry-pick loop must apply recorded resolutions,
    # not just `replay()` (the preview). Fixture repo, both directions ─────────────────
    import tempfile as _tf4, shutil as _shutil4
    box4 = pathlib.Path(_tf4.mkdtemp(prefix="k13-strand-"))
    try:
        def _g4(*args):
            return subprocess.run(["git", "-C", str(box4), *args], capture_output=True,
                                  text=True, encoding="utf-8", errors="replace")
        _NL4 = chr(10)
        f = box4 / "shared.txt"
        _g4("init", "-q", "-b", "master")
        _g4("config", "user.email", "c@example.com")
        _g4("config", "user.name", "control")
        f.write_text("line1" + _NL4 + "line2" + _NL4, encoding="utf-8")
        _g4("add", "-A"); _g4("commit", "-qm", "base")
        base_sha = _g4("rev-parse", "HEAD").stdout.strip()
        # master diverges: line2 -> masterX
        f.write_text("line1" + _NL4 + "masterX" + _NL4, encoding="utf-8")
        _g4("add", "-A"); _g4("commit", "-qm", "master moves shared.txt")
        _g4("branch", "-f", "unit-base", base_sha)
        _g4("checkout", "-q", "-b", "feat", "unit-base")
        # unit diverges the SAME line differently: line2 -> unitY -- guaranteed conflict
        f.write_text("line1" + _NL4 + "unitY" + _NL4, encoding="utf-8")
        _g4("add", "-A"); _g4("commit", "-qm", "unit changes shared.txt")
        unit_sha = _g4("rev-parse", "HEAD").stdout.strip()
        _g4("checkout", "-q", "master")

        ok_no_res, _app, label_no_res, detail_no_res = _pick_with_resolution(
            unit_sha, "fx-strand-row", box4, [], "master")
        show("F-STRAND-1: a conflict with NO recorded resolution -> STRAND, aborted",
             ok_no_res, False)
        show("...named STRAND (not UNRESOLVED -- no candidate rows at all)",
             label_no_res, "STRAND")
        rc_clean, st_clean = _g4("status", "--porcelain"), None
        show("...and the worktree is clean afterward (no stuck CHERRY_PICK_HEAD)",
             not rc_clean.stdout.strip(), True)

        # now WITH a matching recorded resolution
        # ⛔ "unit pre-image" is the blob AT the unit's OWN commit (what it carries),
        # matching `resolution_for`'s `_blob_hash(repo, unit_sha, path)` -- NOT its
        # parent's content. First version of this fixture used `unit-base` (the parent)
        # and the control read (False, 0) on a case that should apply cleanly, caught by
        # running it rather than reading it.
        m_pre = _g4("rev-parse", "master:shared.txt").stdout.strip()
        u_pre = _g4("rev-parse", "%s:shared.txt" % unit_sha).stdout.strip()
        resolved_blob = box4 / "resolved.txt"
        resolved_blob.write_text("line1" + _NL4 + "BOTH" + _NL4, encoding="utf-8")
        resolved_blob_hash = run(["git", "hash-object", str(resolved_blob)], box4, False)[1].strip()
        fake_resolution = [{"row": "fx-strand-row", "path": "shared.txt",
                            "master pre-image": m_pre, "unit pre-image": u_pre,
                            "resolved blob": resolved_blob_hash,
                            "_blob_path": resolved_blob,
                            "_file": pathlib.Path("fx-strand-row--shared-txt.md")}]
        ok_res, applied_res, label_res, _detail_res = _pick_with_resolution(
            unit_sha, "fx-strand-row", box4, fake_resolution, "master")
        show("F-STRAND-1: the SAME conflict WITH a matching resolution -> applied clean",
             (ok_res, len(applied_res)), (True, 1))
        show("...and it is the SAME function replay() now shares (no second copy)",
             "_pick_with_resolution" in dir(sys.modules[__name__]), True)

        # ── F-RESOLVED-1's SECOND bug: `base_rev` must be a PARAMETER, never the
        # hardcoded string "origin/master" -- that broke inside replay()'s own clone,
        # where "origin/master" means something else entirely (F-SIGN-16). `box4`'s
        # "master" branch just received the resolution (via _pick_with_resolution
        # above); "unit-base" never did. ─────────────────────────────────────────────
        show("F-RESOLVED-1: base_rev is CONSULTED, not hardcoded -- landed on 'master'",
             _resolution_landed("fx-strand-row", unit_sha, box4, fake_resolution, "master"),
             True)
        show("...and correctly NOT landed against a DIFFERENT ref ('unit-base') "
             "-- proves base_rev is a real parameter, not decoration",
             _resolution_landed("fx-strand-row", unit_sha, box4, fake_resolution, "unit-base"),
             False)
    finally:
        _shutil4.rmtree(box4, ignore_errors=True)

    # ── K CP13: --resume-signed's three checks, against the REAL manifest and packets ──
    ok_r1, msg1 = _check_resume_signed("packet-a-absent-bound-gate", man)
    show("--resume-signed on a row that is SIGNED and FULLY MERGED -> resumable "
         "(the loop will skip it cleanly)", ok_r1, True)
    show("--resume-signed on a stem not in UNITS -> refused",
         _check_resume_signed("no-such-unit-stem", man)[0], False)

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else FAIL


# --------------------------------------------------------------------------------------

#: cache of resolved binary paths, so the (cheap but not free) `shutil.which` lookup
#: happens once per distinct name per process, not once per subprocess call.
_RESOLVED_BIN = {}


def _resolve_bin(name: str) -> str:
    """⛔⛔ K CP13 — `subprocess.run([name, ...])` CANNOT RESOLVE A WINDOWS NPM SHIM.

    ⚰️⚰️ THIS IS WHY UNIT 2 COULD NOT MERGE. `run(["railway", ...], ...)` handed the bare
    string `"railway"` straight to `subprocess.run`, which on Windows calls `CreateProcess`
    directly — no shell, no PATH-extension resolution of the kind `cmd.exe` does for a
    `.cmd` shim. `railway` on this box IS such a shim
    (`AppData/Roaming/npm/railway`, no executable extension), so the call raised
    `FileNotFoundError` — AFTER unit 1's push had already succeeded, and BEFORE every
    resume's first push, because the "resumed settle" (`wait_for_deploy`) fires before any
    cherry-pick is attempted on a run that starts with a skip.

    ⭐ `pre_push_guard._railway()`, in this SAME repository, already carries the fix and
    the lesson: `shutil.which`, never `shell=True`. `merge_all` had not adopted it. This
    function is the one place that lesson now lives for every subprocess call this file
    makes — `run()` below routes every command through it, so git, railway, or any future
    CLI this tool learns to shell out to gets the fix for free, not just the one call site
    that happened to crash first.
    """
    if name not in _RESOLVED_BIN:
        _RESOLVED_BIN[name] = shutil.which(name) or name
    return _RESOLVED_BIN[name]


def run(cmd, cwd, dry):
    printable = " ".join(cmd)
    if dry:
        print("    $ %s" % printable)
        return 0, ""
    resolved = [_resolve_bin(cmd[0])] + list(cmd[1:])
    try:
        out = subprocess.run(resolved, cwd=str(cwd), capture_output=True, text=True,
                             encoding="utf-8", errors="replace")
    except OSError as e:
        # ⛔⛔ K CP13 — A REFUSAL, NEVER A CRASH. A CLI this session cannot execute is a
        # fact about the machine, printed and returned as an ordinary failed command, not
        # an uncaught exception that kills a merge mid-sitting with a traceback nobody
        # asked to read. This is what stops unit 2's FileNotFoundError from EVER
        # happening again, on this call or any other `run()` makes.
        return 1, ("⛔ could not execute %r (resolved to %r): %s: %s"
                  % (cmd[0], resolved[0], type(e).__name__, e))
    return out.returncode, (out.stdout or "") + (out.stderr or "")


def _resolution_landed(stem: str, sha: str, repo, resolutions,
                       base_rev: str = "origin/master") -> "bool | None":
    """True if `sha`'s intended change is ALREADY on `base_rev` via a recorded
    resolution that was applied to a PRIOR pick of it — a case `git cherry` can never
    see, and must not be confused with "not merged."

    ⛔⛔ `base_rev` IS A PARAMETER, NEVER A HARDCODED STRING — THE SAME F-SIGN-16 TRAP
    THIS WHOLE FILE WAS BUILT AROUND. The first version of this function hardcoded
    `"origin/master"`, which is correct for `merged_into_master` (called against the
    real `CODE_REPO`) and WRONG inside `replay()`'s throwaway clone, where `origin/
    master` resolves to the CLONE's own origin — the source repo's LOCAL branch, not
    the pinned `resolved` sha `replay()` explicitly checked out to avoid exactly this.
    Measured 2026-09-18: with the hardcoded string, `replay()`'s own use of this
    function still stranded on `e-cp28-build-record`, minutes after "fixing" it,
    because the pre-image check was reading the wrong ref's blob.

    ⛔⛔ F-RESOLVED-1 — A RESOLUTION-APPLIED COMMIT CAN NEVER PATCH-MATCH ITS ORIGINAL
    AGAIN, BY CONSTRUCTION. Resolving a conflict means writing DIFFERENT bytes than the
    original commit's diff would have produced, so the resulting commit's patch-id
    necessarily differs from `sha`'s own patch-id forever after. `_cherry_says_merged`
    reports such a row as "not merged" EVEN THOUGH IT IS, and a caller that trusts that
    verdict will try to re-pick it — hitting the SAME conflict again, except now the
    resolution's own recorded "master pre-image" no longer matches (master already
    carries the RESOLVED content), so `resolution_for` refuses it as a pre-image
    mismatch and the pick STRANDS. On production infrastructure, not a preview.

    ⚰️ Measured 2026-09-18: `e-cp28-build-record`'s resolution landed via `_pick_with_
    resolution` for the first time this session (the recorded conftest.py resolution).
    The very next state check found `git cherry` reporting NOT-MERGED against the tip
    that its own resolved content is sitting on.

    ⭐ The fix asks a DIFFERENT, correct question: for every path this commit touches, is
    there a resolution recorded for (stem, path) whose verified `resolved blob` hash
    equals that path's CURRENT blob on origin/master? If every touched path answers yes,
    the commit's intended, resolved content IS present — regardless of what its own
    patch-id says. A commit with even ONE unresolved-or-unmatched path returns False,
    never guessed as landed.
    """
    rc, out = run(["git", "show", "--name-only", "--format=", sha], repo, False)
    if rc != 0:
        return None
    paths = [p for p in out.split() if p.strip()]
    if not paths:
        return None
    for path in paths:
        cands = [r for r in resolutions if r["row"] == stem and r["path"] == path]
        if not cands:
            return False
        cur = _blob_hash(repo, base_rev, path)
        if cur is None or not any(r["resolved blob"] == cur for r in cands):
            return False
    return True


def merged_into_master(commits, dry, stem=None, resolutions=None):
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
    # ⛔ K CP13 — SAME TEST, ONE IMPLEMENTATION. `_cherry_says_merged` is exactly this
    # loop's body, extracted so `replay()` answers "is this unit already on the base I am
    # replaying onto" with the identical logic that decides it for a live push — a second
    # copy of this parsing is a second authority over what "merged" means.
    # ⛔⛔ F-RESOLVED-1 — resolutions are loaded ONCE here too (lazily, only if the
    # caller didn't already hand them in), so a resolution-landed commit is recognized
    # as merged instead of re-stranding on its own already-satisfied pre-image check.
    res = resolutions
    if res is None and stem is not None:
        res, res_corrupt = read_resolutions()
        if res_corrupt:
            return None, "REFUSED-CORRUPT-RESOLUTION: %s" % "; ".join(
                "%s (%s)" % c for c in res_corrupt)
    done = []
    for c in commits:
        got = _cherry_says_merged("origin/master", c, CODE_REPO)
        if got is None:
            return None, "`git cherry` could not read %s" % c[:9]
        if not got and stem is not None and res:
            landed = _resolution_landed(stem, c, CODE_REPO, res)
            if landed is None:
                return None, "could not read %s's file set to check for a landed resolution" % c[:9]
            got = landed
        if got:
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
    # ⛔⛔ K CP13 — THIS FUNCTION'S OWN `railway` CALL IS THE ONE THAT CRASHED, AND FIVE
    # SESSIONS OF `--dry-run` NEVER REACHED IT. The `if dry: return True` below used to
    # return before calling `run()` at all — a green REPLAY that never exercised the one
    # subprocess call that turned out to be fatal the moment a real push finally reached
    # it. `deployment list` is a READ; making the call for real here (never gating the
    # dry run's exit on what it returns, since there is no real push's sha to check yet)
    # is what makes a green dry run mean the resolver and the CLI actually work, not just
    # that the code path was never visited.
    if dry:
        railway_path = shutil.which("railway")
        print("    $ railway deployment list --service web --json   "
              "# poll until the deployment for %s reaches SUCCESS, then +%ds settled"
              % (sha[:9] or "the commit this push creates", SETTLE_SECONDS))
        if railway_path is None:
            print("    ⚠️  NOT-EXERCISED: shutil.which('railway') -> None. The real run "
                  "would REFUSE here rather than wait; this dry run can prove that much, "
                  "not the deploy wait itself.")
            return True
        rc, out = run(["railway", "deployment", "list", "--service", "web", "--json"],
                      CODE_REPO, False)
        if rc != 0:
            print("    ⚠️  the real railway call FAILED even though dry-run does not "
                  "gate on it: %s" % out.strip()[:200])
        else:
            print("    (railway resolved to %s; the real deployment-list call "
                  "succeeded, %d byte(s) — the resolver and the CLI both work)"
                  % (railway_path, len(out)))
        return True
    if not sha:
        print("    ⛔ the pushed commit is UNREADABLE, so its deploy cannot be "
              "identified. STOPPED — waiting for 'some' deploy is the defect K CP5 "
              "removed.")
        return False
    railway_path = shutil.which("railway")
    print("    (railway resolved to: %s)" % (railway_path or "NOT FOUND"))
    if railway_path is None:
        print("    ⛔ the railway CLI could not be resolved on PATH. REFUSING rather "
              "than polling for a deploy this session has no way to observe.")
        return False
    deadline = time.time() + DEPLOY_TIMEOUT
    seen = None
    first_poll = True
    while time.time() < deadline:
        rc, out = run(["railway", "deployment", "list", "--service", "web", "--json"],
                      CODE_REPO, False)
        if rc != 0:
            # ⛔ A FAILED CALL IS A REASON TO RETRY, NEVER TO CRASH OR TO GIVE UP EARLY.
            # `run()` now returns (1, reason) instead of raising — this is that contract's
            # other half: a transient network blip does not abort a merge already in
            # flight, it just costs one more poll interval.
            print("    ⛔ railway call failed (retrying): %s" % out.strip()[:200])
            time.sleep(POLL_SECONDS)
            first_poll = False
            continue
        row = _deployment_for_sha(out, sha)
        if row is not None:
            status = row.get("status")
            if status != seen:
                print("    … %s is %s" % (sha[:9], status))
                seen = status
            if status == "SUCCESS":
                # ⭐ K CP13 — ONLY WAIT IF THE DEPLOY SOURCE DOES NOT ALREADY SHOW IT
                # SETTLED. A resume minutes (or hours) after the push it is checking
                # already happened does not need ANOTHER 150 s sleep on top of a deploy
                # that has been sitting at SUCCESS the whole time — this is the "resumed
                # settle waits only if not already SUCCESS >=150s" half of R-BATCH's
                # cadence. A timestamp this function cannot parse falls back to the
                # ORIGINAL behaviour (always sleep the full settle) — failing toward MORE
                # waiting, never less.
                age = _iso_age_seconds(row.get("createdAt"))
                if first_poll and age is not None and age >= SETTLE_SECONDS:
                    print("    already %ds settled (>= %ds) — no extra wait needed"
                          % (int(age), SETTLE_SECONDS))
                    return True
                time.sleep(SETTLE_SECONDS)
                return True
            if status in ("FAILED", "CRASHED", "REMOVED"):
                print("    ⛔ the deploy for %s ended %s" % (sha[:9], status))
                return False
            if status == "SKIPPED":
                # ⚰️ MEASURED 2026-09-18: three consecutive master-tip commits from
                # OTHER sessions (bf100aadf, d517e7cd7, 888791525 — each a docs/tools
                # -only push, none touching web's watchPatterns) landed SKIPPED and
                # then sat there, because this function only recognized SUCCESS as a
                # pass and FAILED/CRASHED/REMOVED as a stop. SKIPPED fell through
                # neither branch, so every one of them burned the full 900s
                # DEPLOY_TIMEOUT and refused a unit that had nothing to do with them.
                # ⭐ SKIPPED is a real, immediate terminal state, not a transient one:
                # Railway has already decided this commit's diff matches none of
                # web's watchPatterns, so no build was ever started — there is
                # nothing in flight for a push to collide with, which is the only
                # thing this wait exists to prevent. Same semantics this repo already
                # relies on for flow-worker's SKIPPED (a push that misses its watch
                # list, `railway deployment list --service flow-worker`).
                print("    %s is SKIPPED — no web build for this commit (its diff "
                      "matches none of web's watchPatterns); nothing is in flight to "
                      "collide with, proceeding without a settle wait." % sha[:9])
                return True
        first_poll = False
        time.sleep(POLL_SECONDS)
    print("    ⛔ %ds passed and the deploy for %s never reached a terminal status. "
          "UNREADABLE is not SUCCESS." % (DEPLOY_TIMEOUT, sha[:9]))
    return False


def _iso_age_seconds(iso_ts):
    """Seconds since an ISO-8601 timestamp (Railway's `createdAt`), or None if it cannot
    be parsed — never guessed, since a wrong guess here shortens a real settle wait."""
    if not iso_ts:
        return None
    try:
        import datetime as _dt
        t = _dt.datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
        now = _dt.datetime.now(_dt.timezone.utc)
        return (now - t).total_seconds()
    except Exception:  # noqa: BLE001 -- unparsable is UNREADABLE, not a bug to raise on
        return None


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


def _print_guard_clauses(repo):
    """Print the PUSHING repo's OWN pre_push_guard.py — path, line count, and the
    clauses it enforces, parsed from its own constants. ⭐ The guard that binds is the
    one in the repo `git push` actually runs through, which is `_merge-master` (checked
    out at master) — NOT the feature branch's copy. Measured 2026-09-17: the two differ,
    739 lines vs 279, and only the longer one carries the BURST clause. A session that
    reasoned from the shorter copy would not know this clause exists at all."""
    gp = pathlib.Path(repo) / "tools" / "pre_push_guard.py"
    if not gp.is_file():
        print("    [guard] %s — NOT FOUND, cannot introspect clauses" % gp)
        return
    text = gp.read_text(encoding="utf-8", errors="replace")
    n_lines = len(text.splitlines())
    consts = {}
    for name in ("RECENT_PUSH_WINDOW_SECONDS", "BURST_WINDOW_SECONDS", "BURST_MIN_DEPLOYS",
                "MIN_SETTLE_SECONDS", "ATTEST_MAX_AGE_SECONDS"):
        m = re.search(r"^%s\s*=\s*(\d+)" % re.escape(name), text, re.M)
        if m:
            consts[name] = int(m.group(1))
    print("    [guard] %s  (%d lines)" % (gp, n_lines))
    print("    [guard] clauses: %s"
          % (", ".join("%s=%s" % kv for kv in consts.items()) or "none parsed from this copy"))


def _log_attestation(commits_desc: str, refusal_text: str, stamp: str):
    """R-ATTEST's audit trail: ET, the guard's refusal line, the deployment list this
    session read at attestation time, and the batch it unblocked. Appended, never
    overwritten — every attestation this session ever makes is a permanent record."""
    rc, deploys_raw = run(["railway", "deployment", "list", "--service", "web", "--json"],
                          CODE_REPO, False)
    rows_summary = "UNREADABLE"
    if rc == 0:
        try:
            data = json.loads(deploys_raw)
            if isinstance(data, dict):
                data = data.get("deployments") or []
            lines = []
            for r in data[:6]:
                m = (r.get("meta") or {})
                lines.append("  %s %-9s %s"
                            % ((m.get("commitHash") or "")[:9], r.get("status"),
                               r.get("createdAt")))
            rows_summary = "\n".join(lines) or "(empty)"
        except Exception:  # noqa: BLE001 -- a log entry that fails to parse still logs
            rows_summary = "UNPARSEABLE (%d bytes)" % len(deploys_raw or "")
    try:
        ATTEST_LOG.parent.mkdir(parents=True, exist_ok=True)
        with ATTEST_LOG.open("a", encoding="utf-8") as fh:
            fh.write("=== %s ===\n" % stamp)
            fh.write("batch: %s\n" % commits_desc)
            fh.write("guard refusal:\n%s\n" % refusal_text.strip())
            fh.write("deployment list read at attestation time:\n%s\n" % rows_summary)
            fh.write("attested by: %s\n\n" % DELEGATED_BY)
    except OSError as e:  # noqa: BLE001 -- a failed log write must not block the retry
        print("    ⚠️ could not write %s: %s" % (ATTEST_LOG, e))


def _is_burst_refusal(guard_output: str) -> bool:
    """Is this guard REFUSAL text the BURST clause, specifically? Extracted as its own
    pure predicate so it can be tested against fixture text without touching git — the
    real strings this matches were observed live, 2026-09-17: 'This is the D-05 shape'
    and '4 distinct web deploys in the last 60 min'. ⛔ RECENCY and BUILDING refusals
    ('a build takes 3-5 min', 'a swap is in flight') must NOT match — those are never
    attested, per R-ATTEST."""
    return ("D-05 shape" in guard_output
           or ("distinct" in guard_output and "deploys in the last" in guard_output))


def _push_with_attest(commits_desc: str, dry: bool):
    """Push HEAD to origin/master. On a BURST refusal ONLY, attest under R-ATTEST
    (the owner's 2026-09-17 ruling that concurrent master pushes in this window are the
    owner's OWN other sessions), log it, and retry EXACTLY ONCE. A RECENCY or
    in-flight/BUILDING refusal is NEVER attested — those are facts about a build actually
    happening, and the caller's own bounded wait-and-retry handles them normally, the
    same way it always has. Returns (rc, out) from whichever attempt was last made.
    """
    rc, out = run(["git", "push", "origin", "HEAD:master"], CODE_REPO, dry)
    if rc == 0 or dry:
        return rc, out
    if not _is_burst_refusal(out):
        return rc, out
    # ⛔⛔ THE LOG STAMP AND THE ATTESTATION STAMP ARE TWO DIFFERENT THINGS. `stamp`
    # (the human-readable ET line) is for `attestation.log`, which a person reads.
    # `pre_push_guard.read_attestation()` parses `UCT_BURST_ATTESTED_AT` with its own
    # `_iso()` — a REAL ISO-8601 timestamp, never the ET prose line. Measured live,
    # 2026-09-18: the first real BURST this session hit REJECTED the attestation
    # outright — "UCT_BURST_ATTESTED_AT='ET 2026-09-18 01:33 EDT Fri' is not an ISO
    # timestamp" — because this function set the SAME string for both purposes.
    stamp = _et_now_line()
    import datetime as _dt
    iso_now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    print("    [R-ATTEST] BURST refusal — attesting under the owner's 2026-09-17 ruling "
          "(concurrent master pushes in this window are the owner's own sessions).")
    for line in out.strip().splitlines()[-4:]:
        print("    [R-ATTEST]   %s" % line)
    _log_attestation(commits_desc, out, stamp)
    os.environ["UCT_BURST_ATTESTED_BY"] = DELEGATED_BY
    os.environ["UCT_BURST_ATTESTED_AT"] = iso_now
    try:
        rc2, out2 = run(["git", "push", "origin", "HEAD:master"], CODE_REPO, dry)
    finally:
        # ⛔ THE ATTESTATION IS SCOPED TO THIS ONE PUSH, NEVER LEFT STANDING. A name alone
        # in the environment for the rest of the run would silently exit BURST on every
        # later push too, which is a standing grant nobody asked for.
        os.environ.pop("UCT_BURST_ATTESTED_BY", None)
        os.environ.pop("UCT_BURST_ATTESTED_AT", None)
    print("    [R-ATTEST] retried once — %s" % ("OK" if rc2 == 0 else "STILL REFUSED"))
    return rc2, out2


def _flush_batch(pending: list, dry: bool) -> bool:
    """Push everything cherry-picked since the last push, as ONE push. `pending` is
    [(stem, commits), ...] describing what is IN this push — for the message and the
    attestation log, never for deciding WHAT to push (that is whatever is on local HEAD,
    exactly like the original one-push-per-unit code)."""
    if not pending:
        return True
    names = ", ".join(s for s, _c in pending)
    rc, out = run(["git", "rev-parse", "HEAD"], CODE_REPO, False)
    sha = "" if dry else (out.strip() if rc == 0 else "")
    print("    [batch] pushing %d row(s): %s" % (len(pending), names))
    _print_guard_clauses(CODE_REPO)
    rc, out = _push_with_attest(names, dry)
    if rc != 0:
        print("    ⛔ push refused (Layer-0 guard or remote): \n%s" % out)
        return False
    if not wait_for_deploy(sha, dry):
        print("    ⛔ web deploy did not reach SUCCESS. STOPPED.")
        return False
    print("    ✅ batch merged and deployed: %s" % names)
    return True


def main(argv=None) -> int:
    """K CP18 — parse args, dispatch self-check, then acquire the merge lock (R-LOCK)
    before touching anything, and release it in `finally` on EVERY path out of `_run`,
    including a refusal. `_run` is the FULL original `main()` body, unchanged except for
    taking the already-parsed `a` directly.

    ⛔⛔ TWO SESSIONS SHARING ONE MERGE CHECKOUT IS THE COLLISION THIS EXISTS TO CATCH.
    See `merge_lock.py`'s module docstring for the incident that found this gap.
    """
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
    # ⛔⛔ K CP13 — R-BATCH. Consecutive rows whose DERIVED member-visible file set is
    # empty are cherry-picked one by one (each still signed immediately before its own
    # pick, K CP10 unchanged) and pushed as ONE push after the last of them. A row that
    # derives member-visible ends the batch and pushes alone. Default OFF: the ORIGINAL
    # one-push-per-unit behaviour is unchanged unless this is passed.
    ap.add_argument("--batch", action="store_true",
                    help="R-BATCH: push consecutive non-member-visible rows together")
    # ⛔⛔ K CP13 — R-RESUME-SIGNED. An explicit, checked, LOGGED confirmation that <stem>
    # is a SIGNED-but-not-yet-merged row being deliberately resumed, per the three named
    # checks in `_check_resume_signed`. Refuses before touching anything if any check
    # fails; otherwise the ordinary per-row loop below proceeds exactly as it would
    # without this flag — this only makes the resume auditable, it does not change what
    # happens next.
    ap.add_argument("--resume-signed", default=None, metavar="STEM",
                    help="R-RESUME-SIGNED: explicit, logged confirmation to resume STEM")
    a = ap.parse_args(argv)

    if a.self_check:
        return _self_check()

    # ⛔⛔ K CP18 — R-LOCK. Acquired BEFORE `_run` touches the checkout, the manifest, or
    # any packet. A live holder REFUSES here (exit 6, naming the holder) rather than
    # racing it; a dead holder is reclaimed, loudly. Released in `finally` on every path
    # `_run` returns by, including every refusal — never left standing.
    merge_lock = _load_sibling("merge_lock")
    session = os.environ.get("UCT_SESSION_ID") or DELEGATED_BY
    checkout = a.code_repo or str(DEFAULT_CODE_REPO)
    et = _et_now_line()
    lock_state, lock_detail = merge_lock.acquire(session, checkout, et)
    print("[merge-all] merge lock: %s — %s" % (lock_state, lock_detail))
    if lock_state == merge_lock.HELD:
        print("⛔ REFUSED — another session holds the merge lock. Nothing was touched.")
        print("   %s" % lock_detail)
        return 6
    try:
        return _run(a)
    finally:
        ok_rel, rel_detail = merge_lock.release()
        print("[merge-all] merge lock release: %s — %s" % (ok_rel, rel_detail))


def _run(a) -> int:
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

    if a.resume_signed:
        ok_r, msg = _check_resume_signed(a.resume_signed, manifest)
        print(msg)
        if not ok_r:
            print("   STOPPED. Nothing was cherry-picked, nothing was pushed.")
            return REFUSED
        print()

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

    # ⛔⛔ F-STRAND-1 — RESOLUTIONS ARE LOADED HERE TOO NOW. Before this fix `main()`'s
    # real per-unit cherry-pick loop had NO IDEA the K CP11 resolution mechanism existed —
    # only `replay()` (the preview) loaded and applied them. Measured 2026-09-17: the
    # first real attempt to merge past e-cp28 hit the RAW conflict `replay()`'s own
    # resolution silently absorbed on every "CLEAN" preview, and stranded mid-cherry-pick
    # on the production merge checkout.
    resolutions, corrupt = read_resolutions()
    if corrupt:
        print("⛔ REFUSED-CORRUPT-RESOLUTION: %s"
              % "; ".join("%s (%s)" % c for c in corrupt))
        print("   STOPPED. Nothing was cherry-picked, nothing was pushed.")
        return REFUSED

    pending = []   # R-BATCH: [(stem, commits), ...] picked but not yet pushed
    for stem, commits, _hand_flag in units:
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
        # ⭐ UNCHANGED under --batch: a batch accumulates PICKS, never signatures-in-advance.
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
        # ⛔⛔ K CP15 — THE GATE NOW READS THE SAME DERIVATION `#!last:` TRUSTS, NOT THE
        # HAND-TYPED TUPLE FLAG. `_hand_flag` above is kept only as a display legacy —
        # never read for a decision — because the flag and the derivation disagreed on
        # row 51 (flag False, derived True at the time, now correctly False after comment-
        # stripping) with nothing comparing them (F-MV-1). member_visible_files(None) —
        # UNREADABLE — fails CLOSED: a unit this session cannot prove clean is treated as
        # member-visible, never waved through on an absence of evidence.
        mv_files = member_visible_files(stem)
        is_mv = True if mv_files is None else bool(mv_files)
        if is_mv and not a.include_member_visible:
            names = ", ".join(sorted(mv_files)) if mv_files else "UNREADABLE file set"
            print("    ⛔ MEMBER-VISIBLE (%s). Re-run with --include-member-visible when "
                  "you want it to go." % names)
            print("    ⛔ STOPPED before it, deliberately.")
            if a.batch and pending:
                print("    [batch] flushing %d pending row(s) before stopping."
                      % len(pending))
                if not _flush_batch(pending, a.dry_run):
                    return FAIL
            return OK
        if not commits:
            print("    (docs worktree only — nothing to merge into master)")
            continue
        # ⛔ K CP5 — ASK MASTER FIRST. This is what makes the script resumable, and it is
        # a READ, so it runs in dry-run too: a preview that cannot tell you what is
        # already done is not a preview of the run you are about to do.
        done, why = merged_into_master(commits, a.dry_run, stem=stem, resolutions=resolutions)
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
        # ⭐ K CP13 — `wait_for_deploy` itself now short-circuits when the deploy source
        # already shows master's tip settled >=150s, so a resume long after the last
        # push no longer pays a second full sleep on top of one it already paid.
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
            if a.dry_run:
                # ⛔ A DRY RUN NEVER MUTATES THE CODE REPO. `_pick_with_resolution` always
                # cherry-picks for real (it has to, to detect a conflict) — so dry-run
                # takes the OLD print-only path exactly as before, never calling it.
                print("    $ git cherry-pick %s" % c)
                continue
            ok_pick, picked_here, label, detail = _pick_with_resolution(
                c, stem, CODE_REPO, resolutions, "origin/master")
            if not ok_pick:
                print("    ⛔ %s  %s" % (label, detail))
                print("    ⛔ the code worktree's cherry-pick was ABORTED (clean). "
                      "Nothing left mid-pick.")
                return FAIL
            for path, fname in picked_here:
                print("    ✅ recorded resolution applied: %s :: %s" % (path, fname))
        if a.batch:
            # ⛔⛔ K CP13 — R-BATCH. This row is NOT member-visible (is_mv is False, or
            # we would have refused/flushed-and-stopped above), so its pick joins the
            # PENDING batch instead of pushing alone. The batch flushes as ONE push the
            # moment a member-visible row, the end of `units`, or a refusal is reached.
            pending.append((stem, commits))
            print("    ✅ picked into pending batch (%d row(s) so far: %s)"
                  % (len(pending), ", ".join(s for s, _c in pending)))
            continue
        # ⛔ The sha is read AFTER the cherry-picks, because that is the commit the deploy
        # will carry. In dry-run no cherry-pick happened, so HEAD is somebody else's
        # commit — report the absence rather than a sha that would be wrong.
        rc, out = run(["git", "rev-parse", "HEAD"], CODE_REPO, False)
        sha = "" if a.dry_run else (out.strip() if rc == 0 else "")
        _print_guard_clauses(CODE_REPO)
        rc, out = _push_with_attest(stem, a.dry_run)
        if rc != 0:
            print("    ⛔ push refused (Layer-0 guard or remote): \n%s" % out)
            return FAIL
        if not wait_for_deploy(sha, a.dry_run):
            print("    ⛔ web deploy did not reach SUCCESS. STOPPED.")
            return FAIL
        print("    ✅ merged and deployed")

    # ⛔ K CP13 — A BATCH LEFT PENDING AT THE END OF THE LIST (or at --until) IS FLUSHED
    # HERE. Without this, a sitting boundary that lands mid-batch would sign and pick
    # every row correctly and push NONE of them.
    if a.batch and pending:
        print("[merge-all] end of units — flushing final batch of %d row(s)"
              % len(pending))
        if not _flush_batch(pending, a.dry_run):
            return FAIL

    if a.dry_run:
        print()
        print("[merge-all] DRY RUN — nothing merged, nothing pushed.")
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
