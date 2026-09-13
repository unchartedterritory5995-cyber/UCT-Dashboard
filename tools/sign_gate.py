"""Fill a gate packet's approval block, computing the fingerprint correctly.

⛔ THE FINGERPRINT IS `git hash-object` OF THE PACKET **WITH THE AT SHA FIELD
BLANK** — the packet's own format says so. That means the value cannot be typed
or guessed: it has to be computed from the exact bytes, with the field emptied,
and only then written in.

⚰️ A session once treated twelve of these as commit SHAs, found they did not
resolve, called them fabrications and rewrote eight of them into commit hashes —
destroying the one value that pins each approval to the bytes the owner
approved. This tool exists so the value is always DERIVED.

    python tools/sign_gate.py <packet.md> --by "..." --on YYYY-MM-DD --scope-file s.txt
    python tools/sign_gate.py --self-check
"""
from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys
import tempfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parents[1]
#: ⛔⛔ `\s` MATCHES A NEWLINE AND THAT DESTROYED THREE PACKETS.
#: The first version used `\s+` after the colon. In an UNSIGNED block the field is
#: empty, so the pattern matched the colon plus the LINE BREAK, the group
#: swallowed it, and
#: `.*$` then matched the NEXT line — replacing `APPROVED ON:` with the approver's
#: name and splicing the fingerprint into `SCOPE APPROVED:`. The packets were
#: restored from HEAD.
#: ⭐ The failure direction is the dangerous one: it still WROTE a fingerprint, so
#: a packet came out carrying an approval hash with no approver on it — which
#: reads as signed to anything that greps for the hash.
#: MEASURED 2026-09-13, and it CORRECTS the obvious reading: the defect is a
#: CONJUNCTION, not the character class. Against a realistic packet (a blank line
#: before the block, empty fields), what each pattern CONSUMES:
#:     [ 	]*$      -> 'APPROVED BY:'                      safe
#:     \s*$         -> 'APPROVED BY:'                      safe (the $ forces a backtrack)
#:     (\s*).*$     -> 'APPROVED BY:' + \n + 'APPROVED ON:'   CROSSES A LINE
#:     (\s+).*$     -> 'APPROVED BY:' + \n + 'APPROVED ON:'   CROSSES A LINE  <- the original
#: SO A SINGLE-FACTOR MUTATION STAYS GREEN AND IS TELLING THE TRUTH. Swapping
#: [ 	]* for \s* is not the bug; adding .*$ back alone is not the bug either.
#: BOTH are needed: a class that can cross the newline AND a trailing match that
#: continues onto the next line. That is why two attempts to mutate this rail came
#: back green, and why neither was evidence the rail was weak.
_H = "[ " + chr(92) + "t]*"

_AT_LINE = re.compile("^(APPROVED AT SHA:" + _H + ")([0-9a-f]*)" + _H + "$", re.M)


def hash_object(text: str) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False,
                                     encoding="utf-8", newline="") as fh:
        fh.write(text)
        tmp = fh.name
    try:
        r = subprocess.run(["git", "hash-object", tmp], cwd=ROOT,
                           capture_output=True, text=True, check=True)
        return r.stdout.strip()
    finally:
        pathlib.Path(tmp).unlink(missing_ok=True)


def fingerprint(text: str) -> str:
    """The packet's hash WITH the AT SHA field blank — the format's own rule."""
    blanked = _AT_LINE.sub(lambda m: m.group(1), text, count=1)
    return hash_object(blanked)[:9]


def sign(path: pathlib.Path, by: str, on: str, scope: str) -> str:
    t = path.read_text(encoding="utf-8")
    if not _AT_LINE.search(t):
        raise SystemExit(f"⛔ no APPROVED AT SHA line in {path.name}")
    fp = fingerprint(t)
    # ⚠️ Normalise the padding rather than preserving whatever was there: an
    # UNSIGNED block has zero spaces after the colon, so preserving it produced
    # "APPROVED AT SHA:40caca541" — correct, unreadable, and inconsistent with
    # every signed packet in the tree.
    t = _AT_LINE.sub(lambda m: "APPROVED AT SHA:      " + fp, t, count=1)
    t = re.sub("^APPROVED BY:" + _H + "$", "APPROVED BY:      " + by, t, count=1, flags=re.M)
    t = re.sub("^APPROVED ON:" + _H + "$", "APPROVED ON:      " + on, t, count=1, flags=re.M)
    path.write_text(t, encoding="utf-8")
    return fp


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("packet", nargs="?")
    ap.add_argument("--by", default="Patrick (owner), via Claude Chat middleman")
    ap.add_argument("--on", default="2026-09-12")
    ap.add_argument("--scope-file")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()

    if a.self_check:
        ok = True
        body = ("APPROVED BY:      x\nAPPROVED ON:      y\n"
                "APPROVED AT SHA:  \nSCOPE APPROVED:   z\n")
        f1 = fingerprint(body)
        # CONTROL 1 — filling the field must NOT change the fingerprint
        filled = body.replace("APPROVED AT SHA:  \n", f"APPROVED AT SHA:  {f1}\n")
        if fingerprint(filled) != f1:
            print("  ⛔ the fingerprint changes once written — the blanking is wrong"); ok = False
        # CONTROL 2 — changing the SCOPE MUST change it
        if fingerprint(body.replace("z", "zz")) == f1:
            print("  ⛔ the fingerprint ignores the packet body"); ok = False
        # CONTROL 3 — it is 9 hex chars, not a commit
        if not re.fullmatch("[0-9a-f]{9}", f1):
            print(f"  ⛔ malformed fingerprint {f1!r}"); ok = False
        # CONTROL 4 -- THE ONE THAT WOULD HAVE CAUGHT THE NEWLINE BUG.
        # Sign a realistic EMPTY block and assert every field survives. The
        # first version passed controls 1-3 and still destroyed the packet:
        # it wrote a fingerprint into a packet with NO approver on it.
        import tempfile
        # ⛔ THE BLOCK IS PRECEDED BY A BLANK LINE, on the owner's instruction.
        # That is the shape every real packet has, and it is the shape that lets a
        # newline-crossing character class walk BACKWARDS out of the field as well
        # as forwards. A fixture without it tests an easier document than exists.
        empty = chr(10).join(["# packet", "", "## APPROVAL", "", "```", "",
                              "APPROVED BY:", "APPROVED ON:", "APPROVED AT SHA:",
                              "SCOPE APPROVED:", "```", ""])
        d = tempfile.mkdtemp()
        pp = pathlib.Path(d) / "g.md"
        pp.write_text(empty, encoding="utf-8")
        sign(pp, "SOMEBODY", "2026-01-01", "")
        out = pp.read_text(encoding="utf-8")
        for field in ("APPROVED BY:", "APPROVED ON:", "APPROVED AT SHA:",
                      "SCOPE APPROVED:"):
            if field not in out:
                print("  DESTROYED the line " + field); ok = False
        if "SOMEBODY" not in out:
            print("  the approver was not written"); ok = False
        if not re.search("^APPROVED ON:[ ]+2026-01-01$", out, re.M):
            print("  APPROVED ON was not filled on its own line"); ok = False
        if re.search("^APPROVED AT SHA:[ ]*$", out, re.M):
            print("  the fingerprint was not written"); ok = False
        if not re.search("^APPROVED AT SHA:[ ]{2,}[0-9a-f]{9}$", out, re.M):
            print("  the fingerprint is written without the standard padding"); ok = False
        if out.count("APPROVED BY:") != 1 or out.count("SCOPE APPROVED:") != 1:
            print("  a field was duplicated or consumed"); ok = False
        print("SELF-CHECK:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    if not a.packet:
        raise SystemExit("give a packet path, or --self-check")
    scope = pathlib.Path(a.scope_file).read_text(encoding="utf-8") if a.scope_file else ""
    fp = sign(pathlib.Path(a.packet), a.by, a.on, scope)
    print(f"signed {a.packet}  AT SHA {fp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
