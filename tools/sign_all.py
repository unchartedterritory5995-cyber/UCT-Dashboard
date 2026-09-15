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

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
OK, FAIL, REFUSED = 0, 1, 2


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


def fingerprint_of(path: pathlib.Path) -> str:
    """sign_gate's OWN computation, imported rather than reimplemented — a second
    implementation of a fingerprint is a second authority over it."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("_sg", str(HERE / "sign_gate.py"))
    sg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sg)
    text = path.read_text(encoding="utf-8")
    return sg.fingerprint(text)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--manifest", default="tools/sign_manifest.txt")
    ap.add_argument("--by", default="Patrick")
    ap.add_argument("--on", default=None, help="default: the ET clock authority")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    man = pathlib.Path(a.manifest)
    if not man.is_file():
        print("⛔ manifest not found: %s" % man)
        return REFUSED
    table = rows(man)
    on = a.on or et_today()

    print("[sign-all] manifest: %s" % man)
    print("[sign-all] rows: %d   signature date: %s (from the ET authority)"
          % (len(table), on))
    print()

    # ── PASS 1: verify every row BEFORE writing anything ──────────────────
    bad = []
    for r in table:
        p = REPO / r["path"]
        if not p.is_file():
            r["state"], r["got"] = "MISSING-FILE", "-"
        elif r["want"] == "PENDING":
            r["state"], r["got"] = "PENDING", fingerprint_of(p)
        else:
            got = fingerprint_of(p)
            r["got"] = got
            r["state"] = "ok" if got == r["want"] else "MISMATCH"
        if r["state"] in ("MISSING-FILE", "MISMATCH", "PENDING"):
            bad.append(r)
        print("  %-2d %-58s %-12s %s"
              % (r["line"], pathlib.Path(r["path"]).name, r["cps"], r["state"]))
        if r["state"] == "MISMATCH":
            print("       want %s" % r["want"])
            print("       got  %s" % r["got"])
        if r["state"] == "PENDING":
            print("       fill the manifest with: %s" % r["got"])

    if bad:
        print()
        print("⛔ STOPPED at %d row(s). NOTHING WAS WRITTEN — not even for the rows that "
              "verified, because a manifest that has drifted in one place is not "
              "trustworthy in the others." % len(bad))
        return REFUSED

    # ── PASS 2: sign ──────────────────────────────────────────────────────
    print()
    scope_dir = REPO / ".scopes"
    for r in table:
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
        print("[sign-all] DRY RUN — %d sign command(s) printed, nothing written."
              % len(table))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
