"""Every validator this signing session depends on, in one runnable list.

⛔⛔ WHY THIS FILE EXISTS. `verify_manifest --check-commits` was built in session 2, was
correct throughout, and **stopped being run** — because it was in no list. Eleven commits
went unclaimed for five sessions underneath it, while a DIFFERENT check's "40 OK, 0 STALE"
was recorded in the validator block as though it answered the same question (F-SIGN-6).

⭐ **A validator not in a runnable list is a validator nobody runs.** The runbook's numbers
are derived by this script; nothing in the runbook restates them.

⛔ Every exit code is read from the PROCESS. `cmd | tail` reports tail's status, and that
single trap has now produced three false readings in this programme.

Usage:
    python tools/pre_sitting.py                       # READY / NOT-READY
    python tools/pre_sitting.py --manifest <path>     # against a copy (controls)
    python tools/pre_sitting.py --self-check          # prove it can say NOT-READY
"""
from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = pathlib.Path(__file__).resolve().parent
DOCS = HERE.parent
READY, NOT_READY = 0, 1


def _run(args):
    r = subprocess.run([sys.executable] + args, cwd=str(DOCS), capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def _first(out, pattern, default="(no line matched)"):
    m = re.search(pattern, out, re.M)
    return m.group(0).strip() if m else default


def legacy_tagged(out: str, manifest_text: str):
    """(tolerable, note) for audit_scope_vs_checkpoints.

    ⛔ DERIVED, NOT DECLARED: a failing line is tolerable only if its packet has **zero**
    rows in the signing manifest — i.e. this session can neither sign nor merge it. Any
    failing line whose packet IS in the manifest is a BLOCKER, because that packet is one
    of the things about to be signed.
    """
    # ⚰️ CODE, NEVER PROSE — and this instrument committed the defect on its first run.
    # A loose `UNNUMBERED\s+(\S+)` matched the sentence "...a third slice is UNNUMBERED for
    # the same reason...", yielding the packet name "for", which then matched the manifest
    # as a SUBSTRING and reported a BLOCKER that did not exist. Anchored to the audit's own
    # row format, at line start.
    packets = sorted({m.group(1) for m in
                      re.finditer(r"^\s*⛔ UNNUMBERED\s+(\S+)\s+(?:line|slice)\s+\d+",
                                  out, re.M)})
    if not packets:
        return False, "exit 1 but no UNNUMBERED row could be parsed — UNREADABLE"
    # ⛔ And membership is compared against DERIVED manifest stems, exactly — never `in`
    # against the file's text, where any short token matches something.
    stems = {pathlib.Path(l.split("|")[0].strip()).stem
             for l in manifest_text.splitlines()
             if l.strip() and not l.lstrip().startswith("#") and ".md" in l.split("|")[0]}
    with_rows = sorted(p for p in packets if p in stems)
    if with_rows:
        return False, "BLOCKER: %s has a manifest row" % ", ".join(with_rows)
    return True, "EXPECTED-LEGACY: %d packets, 0 manifest rows" % len(packets)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", default="tools/sign_manifest.txt")
    ap.add_argument("--code-repo", default=None)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    man = pathlib.Path(a.manifest)
    if not man.is_absolute():
        man = DOCS / a.manifest
    manifest_text = man.read_text(encoding="utf-8") if man.is_file() else ""
    repo_args = ["--code-repo", a.code_repo] if a.code_repo else []

    rows, blocking = [], None

    def record(name, rc, result, ok):
        nonlocal blocking
        rows.append((name, rc, result))
        if not ok and blocking is None:
            blocking = "%s (exit %s) — %s" % (name, rc, result)

    rc, out = _run(["tools/verify_manifest.py", "--manifest", str(man)])
    record("verify_manifest (fingerprints)", rc,
           _first(out, r"^\[verify-manifest\] \d+ OK, \d+ STALE"), rc == 0)

    rc, out = _run(["tools/verify_manifest.py", "--manifest", str(man), "--check-commits"])
    record("verify_manifest --check-commits", rc,
           _first(out, r"^\s*mapped: \d+ of \d+"), rc == 0)

    rc, out = _run(["tools/merge_all.py", "--self-check"])
    record("merge_all --self-check (drift)", rc,
           "SELF-CHECK: PASS" if rc == 0 else _first(out, r"^.*WRONG.*$"), rc == 0)

    rc, out = _run(["tools/verify_doc_shas.py"])
    record("verify_doc_shas", rc, _first(out, r"^\[doc-sha\].*$"), rc == 0)

    rc, out = _run(["tools/audit_signature_regexes.py"])
    record("audit_signature_regexes", rc,
           "every approval-block pattern is line-anchored" if rc == 0 else "FAILED", rc == 0)

    rc, out = _run(["tools/audit_scope_vs_checkpoints.py"])
    if rc == 0:
        record("audit_scope_vs_checkpoints", rc, "clean", True)
    else:
        tolerable, note = legacy_tagged(out, manifest_text)
        record("audit_scope_vs_checkpoints", rc, note, tolerable)

    rc, out = _run(["tools/sign_all.py", "--manifest", str(man), "--dry-run"])
    record("sign_all --dry-run", rc, _first(out, r"^\[sign-all\] DRY RUN.*$"), rc == 0)

    rc, out = _run(["tools/merge_all.py", "--manifest", str(man), "--dry-run"] + repo_args)
    record("merge_all --dry-run (REPLAY)", rc,
           # ⛔ NOT `$`-anchored: the CLEAN line now carries the base sha and any resolutions
           # applied, and an anchored pattern reported "(no line matched)" for a perfectly
           # good run — a validator block whose RESULT column goes blank is half a check.
           _first(out, r"^\[merge-all\] (replay CLEAN \d+ of \d+.*|⛔ STRAND.*)"), rc == 0)

    print()
    print("%-34s %5s  %s" % ("VALIDATOR", "EXIT", "RESULT"))
    print("-" * 100)
    for name, code, result in rows:
        print("%-34s %5s  %s" % (name, code, result[:58]))
    print("-" * 100)
    if blocking is None:
        print("PRE-SITTING: READY  (%d validators, all green or explained)" % len(rows))
        return READY
    print("PRE-SITTING: NOT-READY")
    print("  first blocking line: %s" % blocking)
    return NOT_READY


def _self_check() -> int:
    """⛔ Prove it can say NOT-READY, against a COPY — never the real manifest."""
    import shutil
    import tempfile
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-52s -> %-10s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    rc, _ = _run(["tools/pre_sitting.py"])
    show("the real tree reads READY", rc, READY)

    box = pathlib.Path(tempfile.mkdtemp(prefix="pre-sitting-"))
    try:
        # ⛔ A COPY. Corrupting the real manifest to prove a check works is how a session
        # leaves a repo worse than it found it.
        copy = box / "sign_manifest.txt"
        text = (DOCS / "tools" / "sign_manifest.txt").read_text(encoding="utf-8")
        lines = text.splitlines(True)
        for i, l in enumerate(lines):
            m = re.search(r"\| ([0-9a-f]{9})\s*$", l)
            if m:
                lines[i] = l.replace(m.group(1), "0" * 9)
                break
        copy.write_text("".join(lines), encoding="utf-8", newline="\n")
        rc, out = _run(["tools/pre_sitting.py", "--manifest", str(copy)])
        show("one corrupted fingerprint reads NOT-READY", rc, NOT_READY)
        show("...and the blocking line NAMES verify_manifest",
             "verify_manifest (fingerprints)" in out, True)
    finally:
        shutil.rmtree(box, ignore_errors=True)

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return READY if ok else NOT_READY


if __name__ == "__main__":
    raise SystemExit(main())
