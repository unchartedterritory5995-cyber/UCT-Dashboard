"""Sign every unsigned gate packet, in merge order, from one command.

⛔⛔ **THIS REMOVES TYPING, NOT JUDGEMENT.** The owner still authorises every signature —
by choosing to run this, having read the manifest table, which is printed before anything
is written. What it removes is nine hand-typed `sign_gate.py` invocations, nine scope
files, and the chance of pasting the wrong fingerprint into one of them at 11pm.

⛔ **IT REFUSES BEFORE IT WRITES.** Every row's fingerprint is recomputed from the packet
on disk and compared to the manifest. On any mismatch the run STOPS at that row and writes
nothing — including nothing for the rows that already passed, because a manifest that has
drifted in one place is not trustworthy in the others.

⚰️ **The drift is not hypothetical.** The F-S2-1 packet was published as `28da7740d` and
edited the same day; its real fingerprint is `72cda4cda`. Signing it against the published
value would have recorded an approval of a document that no longer existed.

⭐ **A SCOPE NAMES A CHECKPOINT, NEVER A PACKET.** `sign_gate.py` takes a `--scope-file`;
this writes one per row from the manifest's checkpoint ids, so *"SCOPE APPROVED: Packet B"*
— which authorises nothing — cannot be produced by accident.

Usage:
    python tools/sign_all.py --manifest tools/sign_manifest.txt --dry-run   # print only
    python tools/sign_all.py --manifest tools/sign_manifest.txt             # sign
"""
from __future__ import annotations

import argparse
import datetime
import pathlib
import re
import shutil
import subprocess
import sys

# ⚰️ THE ELEVENTH cp1252 SIGHTING IN THIS PROGRAMME, and the first one inside the signer.
# Every sibling tool carries this; `sign_all` did not, and the gap was invisible because the
# paths that print ⛔ are the REFUSAL paths — the ones nobody exercises until something goes
# wrong. Measured 2026-09-15: `--until` naming no row raised
# `UnicodeEncodeError: 'charmap' codec can't encode character '⛔'` INSTEAD of the
# refusal it was about to print, turning a clean exit 2 into a traceback and exit 1.
# ⛔ A refusal that cannot be printed is a refusal nobody receives.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - a stream that cannot be reconfigured is not fatal
        pass

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
OK, FAIL, REFUSED = 0, 1, 2
#: ⛔⛔ NO DELEGATION, NO SIGNATURE. A session may sign only under a delegation recorded in
#: the runbook that names a COMMITTED prompt file and its blob hash. Its own exit code, so
#: "the owner never delegated this" can never be mistaken for "a manifest row was stale".
NO_DELEGATION = 5
RUNBOOK = pathlib.Path(__file__).resolve().parents[1] / "docs/terminal-research/SIGNING_SESSION.md"
_DELEG_HASH = re.compile(r"^hash\s+([0-9a-f]{40})\s*$", re.M)
_DELEG_PROMPT = re.compile(r"^prompt\s+(\S+)\s*$", re.M)


def delegation_state(runbook=None, repo=None):
    """(state, detail). SIGNED-authority states: OK / ABSENT / MISMATCH / UNREADABLE.

    ⛔ THE HASH IS OF THE COMMITTED BLOB (`git rev-parse HEAD:<path>`), NEVER OF THE WORKING
    FILE. `core.autocrlf=true` here: a checkout restores CRLF and `git hash-object` on the
    working copy then disagrees with the blob the commit records. A delegation that stops
    verifying after an ordinary checkout is not an authority — it is a tripwire on `git
    checkout`, which this programme has already been bitten by twice.
    """
    rb = pathlib.Path(runbook) if runbook else RUNBOOK
    # ⛔ THE REPO IS FIXED; ONLY THE RUNBOOK IS OVERRIDABLE. Deriving the root from the
    # runbook's own location made every fixture outside the repo fail as "not a committed
    # file" — the right verdict for the wrong reason, which a control caught and a reviewer
    # would not have. A fixture must be able to isolate the block it is testing.
    root = pathlib.Path(repo) if repo else pathlib.Path(__file__).resolve().parents[1]
    if not rb.is_file():
        return "UNREADABLE", "runbook not found: %s" % rb
    text = rb.read_text(encoding="utf-8")
    if "## Delegation" not in text:
        return "ABSENT", "the runbook carries no `## Delegation` block"
    mh, mp = _DELEG_HASH.search(text), _DELEG_PROMPT.search(text)
    if not mh or not mp:
        return "UNREADABLE", "the Delegation block has no `hash` and/or `prompt` line"
    declared, rel = mh.group(1), mp.group(1)
    r = subprocess.run(["git", "rev-parse", "HEAD:%s" % rel], cwd=str(root),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        return "MISMATCH", "%s is not a committed file (the authority must be committed)" % rel
    actual = r.stdout.strip()
    if actual != declared:
        return "MISMATCH", "%s committed as %s, runbook declares %s" % (rel, actual[:12],
                                                                       declared[:12])
    return "OK", "%s @ %s" % (rel, actual[:12])


def rows(manifest: pathlib.Path) -> list:
    out = []
    for n, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 3:
            raise SystemExit("⛔ manifest line %d is not `path | cps | fingerprint`: %s"
                             % (n, raw))
        out.append({"line": n, "path": parts[0], "cps": parts[1], "want": parts[2]})
    return out


def et_today() -> str:
    """⛔ The DATE COMES FROM THE CLOCK AUTHORITY, never from a caller or a prompt.
    F-CLOCK-1: `TZ=America/New_York date` in Git Bash silently returns UTC labelled GMT,
    a four-hour error, and two prompts have already carried a wrong date."""
    # ⚠️ TOLD-vs-FOUND: `weekly_exec.py` is NOT in this worktree. It lives in the CODE
    # worktree, and v1 of this function looked only beside itself and refused. The
    # refusal was correct behaviour and the wrong scope; candidates are declared, tried
    # in order, and the ones tried are NAMED when none works.
    cands = [HERE / "weekly_exec.py",
             REPO.parent / "s7-price-level" / "tools" / "weekly_exec.py"]
    tried = []
    for c in cands:
        tried.append(str(c))
        if not c.is_file():
            continue
        out = subprocess.run([sys.executable, str(c), "et"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace",
                             cwd=str(c.parent.parent), timeout=120)
        m = re.search(r"ET (\d{4}-\d{2}-\d{2})", out.stdout or "")
        if m:
            return m.group(1)
    raise SystemExit(
        "⛔ could not read the ET date from the clock authority — refusing to guess a "
        "signature date. Tried: %s" % ", ".join(tried))


def _sign_gate():
    """sign_gate's OWN computations, imported rather than reimplemented — a second
    implementation of a fingerprint is a second authority over it."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("_sg", str(HERE / "sign_gate.py"))
    sg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sg)
    return sg


def fingerprint_of(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    return _sign_gate().fingerprint(text)


def already_signed_as(path: pathlib.Path):
    """(state, detail) for a row that is ALREADY signed — the resume case.

    ⚰️⚰️ **K CP5 — A SECOND RUN USED TO DIE ON ROW 1 AND NEVER REACH ROW 2.** Measured
    2026-09-15 against two fixture packets signed by this tool minutes earlier:

        [sign-all] rows: 2
        ⛔ no UNSIGNED `APPROVED AT SHA:` line (every block already carries a
        fingerprint). Re-signing would destroy a historical value — …
        exit=1

    That is `sign_gate.target_span` raising out of PASS 1's `fingerprint_of`, through
    `main()`, before a single row was classified. ⛔ **The refusal is right and the blast
    radius was wrong**: nothing is written, and nothing after row 1 is even LOOKED at, so
    a run interrupted at unit 12 of 36 could not be resumed without hand-editing the
    manifest — during a session the owner has to sit through for hours.

    ⭐ **SIGNED-ALREADY IS VERIFIED, NEVER ASSUMED.** The recorded fingerprint must equal
    the manifest's AND re-derive from the file (`sign_gate.rederive_signed`). A row that
    carries somebody else's value, or a packet edited after signing, is a MISMATCH and
    still stops the run — which is the whole point of the pass.
    """
    sg = _sign_gate()
    text = path.read_text(encoding="utf-8")
    state, reason = sg.read_approval(text)
    if state != sg.SIGNED:
        return state, reason
    filled = [m for m in re.finditer("^APPROVED AT SHA:[ ]*([0-9a-f]{6,})[^" + chr(10)
                                     + "]*$", text, re.M)]
    got = [(m.group(1), sg.rederive_signed(text, m.span())) for m in filled]
    return sg.SIGNED, got


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", default="tools/sign_manifest.txt")
    ap.add_argument("--by", default="Patrick")
    ap.add_argument("--on", default=None, help="default: the ET clock authority")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--until", default=None,
                    help="stop AFTER this packet stem (a sitting boundary). ⛔ Everything "
                         "before it is still verified; nothing after it is touched.")
    ap.add_argument("--runbook", default=None,
                    help="the runbook carrying the Delegation block (controls only)")
    a = ap.parse_args(argv)

    # ⛔⛔ THE DELEGATION IS CHECKED BEFORE THE MANIFEST IS EVEN READ. A signature written
    # without a recorded authority cannot be un-written: the fingerprint goes into the packet
    # and the packet is what the merge verifies.
    dstate, ddetail = delegation_state(a.runbook)
    if dstate != "OK":
        print("⛔ NO DELEGATION (%s): %s" % (dstate, ddetail))
        print("   Nothing was signed. Record the delegation in the runbook's `## Delegation` "
              "block, naming a COMMITTED prompt file and its blob hash.")
        return NO_DELEGATION
    print("[sign-all] delegation OK — %s" % ddetail)

    man = pathlib.Path(a.manifest)
    if not man.is_file():
        print("⛔ manifest not found: %s" % man)
        return REFUSED
    table = rows(man)
    # ⛔ K CP6 — THE SITTING BOUNDARY. A three-hour run is two sittings plus the
    # member-visible unit alone; `--until` is what makes "stop cleanly here" a command
    # rather than a promise. It TRUNCATES the table, so every row after the boundary is
    # not verified, not signed, and not reported as anything — the next sitting reads them.
    # ⛔ An --until naming nothing is REFUSED. A boundary that silently matched no row
    # would sign the whole manifest while the operator believed it had stopped.
    if a.until:
        stems = [pathlib.Path(r["path"]).stem for r in table]
        if a.until not in stems:
            print("⛔ --until %r matches no row in this manifest. Nothing was verified or "
                  "written." % a.until)
            print("   the last five rows are: %s" % ", ".join(stems[-5:]))
            return REFUSED
        table = table[:stems.index(a.until) + 1]
    on = a.on or et_today()

    print("[sign-all] manifest: %s" % man)
    print("[sign-all] rows: %d   signature date: %s (from the ET authority)"
          % (len(table), on))
    print()

    # ── PASS 1: verify every row BEFORE writing anything ──────────────────
    sg = _sign_gate()
    bad = []
    for r in table:
        p = REPO / r["path"]
        if not p.is_file():
            r["state"], r["got"] = "MISSING-FILE", "-"
        else:
            # ⛔ K CP5 — ASK WHAT STATE THE PACKET IS IN **BEFORE** ASKING FOR ITS
            # FINGERPRINT. `fingerprint()` needs an UNSIGNED block and raises without
            # one, so on a resume the old order threw before it could classify anything.
            state, detail = already_signed_as(p)
            if state == sg.SIGNED:
                stored = [s for s, _ in detail]
                rederived = [d for _, d in detail]
                if r["want"] not in stored:
                    r["state"] = "SIGNED-ELSEWHERE"
                    r["got"] = ", ".join(stored) or "-"
                elif r["want"] not in rederived:
                    r["state"] = "SIGNED-DRIFTED"
                    r["got"] = ", ".join(rederived) or "-"
                else:
                    r["state"], r["got"] = "SIGNED-ALREADY", r["want"]
            elif state == sg.MALFORMED:
                r["state"], r["got"] = "MALFORMED", detail
            elif r["want"] == "PENDING":
                r["state"], r["got"] = "PENDING", fingerprint_of(p)
            else:
                got = fingerprint_of(p)
                r["got"] = got
                r["state"] = "ok" if got == r["want"] else "MISMATCH"
        if r["state"] not in ("ok", "SIGNED-ALREADY"):
            bad.append(r)
        print("  %-2d %-58s %-12s %s"
              % (r["line"], pathlib.Path(r["path"]).name, r["cps"], r["state"]))
        if r["state"] in ("MISMATCH", "SIGNED-ELSEWHERE", "SIGNED-DRIFTED"):
            print("       want %s" % r["want"])
            print("       got  %s" % r["got"])
        if r["state"] == "SIGNED-ELSEWHERE":
            print("       the packet is signed, but not with the value this manifest "
                  "names — a different approval is on it.")
        if r["state"] == "SIGNED-DRIFTED":
            print("       signed with the right value, which no longer re-derives — the "
                  "packet was EDITED AFTER SIGNING.")
        if r["state"] == "MALFORMED":
            print("       %s" % r["got"])
        if r["state"] == "PENDING":
            print("       fill the manifest with: %s" % r["got"])

    done = [r for r in table if r["state"] == "SIGNED-ALREADY"]
    todo = [r for r in table if r["state"] == "ok"]
    print()
    print("[sign-all] %d already signed (verified, will be skipped) · %d to sign · "
          "%d refusing" % (len(done), len(todo), len(bad)))

    if bad:
        print()
        print("⛔ STOPPED at %d row(s). NOTHING WAS WRITTEN — not even for the rows that "
              "verified, because a manifest that has drifted in one place is not "
              "trustworthy in the others." % len(bad))
        return REFUSED
    if not todo:
        print("[sign-all] NOTHING TO DO — every row is already signed. This is the "
              "resume case, and it is a success, not a refusal.")
        return OK

    # ── PASS 2: sign ──────────────────────────────────────────────────────
    print()
    scope_dir = REPO / ".scopes"
    for r in table:
        if r["state"] == "SIGNED-ALREADY":
            # ⛔ SKIPPED, AND SAID OUT LOUD. A silent skip and a silent success are the
            # same line of output, and the difference is what the owner is reading for.
            print("  %-58s SIGNED-ALREADY (%s)"
                  % (pathlib.Path(r["path"]).name, r["want"]))
            continue
        cps = [c.strip() for c in r["cps"].split(",") if c.strip()]
        scope = ("%s ONLY — the checkpoint(s) named here and nothing else in the packet."
                 % ", ".join(cps))
        sf = scope_dir / (pathlib.Path(r["path"]).stem + ".scope.txt")
        cmd = [sys.executable, str(HERE / "sign_gate.py"), r["path"],
               "--by", a.by, "--on", on, "--scope-file", str(sf)]
        if a.dry_run:
            print("  # scope: %s" % scope)
            print("  " + " ".join('"%s"' % c if " " in c else c for c in cmd))
            continue
        scope_dir.mkdir(exist_ok=True)
        sf.write_text(scope + "\n", encoding="utf-8")
        out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                             errors="replace", cwd=str(REPO))
        print("  %-58s %s" % (pathlib.Path(r["path"]).name,
                              "SIGNED" if out.returncode == 0 else "FAILED"))
        if out.returncode != 0:
            print((out.stdout or "") + (out.stderr or ""))
            print("⛔ STOPPED. Rows after this one were not attempted.")
            return FAIL

    if a.dry_run:
        print()
        print("[sign-all] DRY RUN — %d sign command(s) printed, %d skipped as already "
              "signed, nothing written." % (len(todo), len(done)))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
