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


#: An AT SHA line that is EMPTY — the unsigned one. `[0-9a-f]*` in `_AT_LINE`
#: also matches the empty string, so `_AT_LINE` matches signed AND unsigned lines
#: alike; this one matches only a field with nothing in it.
_AT_LINE_BLANK = re.compile("^(APPROVED AT SHA:" + _H + ")$", re.M)


def target_span(text: str):
    """The span of the AT SHA line to write — THE UNSIGNED ONE.

    ⚰️⚰️ **THIS FUNCTION EXISTS BECAUSE THE TOOL DESTROYED A SIGNED FINGERPRINT,
    2026-09-13.** `sign()` used `_AT_LINE.sub(..., count=1)`, which writes the
    first line the regex MATCHES — and `_AT_LINE`'s `[0-9a-f]*` matches a FILLED
    field just as happily as an empty one. In
    `s7-indicator-condition-pre-implementation-gate.md` the CP1-CP2 block's line
    carries trailing prose (`3460a279b   (git hash-object of this packet ...`) so
    it does **not** match `$`; the first line that DID match was the **already
    signed CP3 block**, whose historical `148af5293` was overwritten with a fresh
    hash while the genuinely unsigned third block was left blank.

    ⭐ **THE FAILURE DIRECTION IS THE DANGEROUS ONE, AGAIN.** It still reported
    `signed ... AT SHA <new>` and exited 0. Nothing said a value had been lost —
    and the lost value is precisely the one the module docstring above calls
    *"the one value that pins each approval to the bytes the owner approved."*

    ⛔ So the target is chosen by EMPTINESS, never by position, and the count is
    asserted: zero unsigned blocks means there is nothing to sign (re-signing is
    not this tool's job), and more than one means the caller must say which.
    """
    blanks = list(_AT_LINE_BLANK.finditer(text))
    if not blanks:
        raise SystemExit(
            "⛔ no UNSIGNED `APPROVED AT SHA:` line (every block already carries a "
            "fingerprint). Re-signing would destroy a historical value — add the new "
            "approval block first, then sign.")
    if len(blanks) > 1:
        raise SystemExit(
            f"⛔ {len(blanks)} unsigned APPROVED AT SHA lines — refusing to guess which. "
            "Leave exactly one block blank.")
    return blanks[0].span()


SIGNED, UNSIGNED, MALFORMED = "SIGNED", "UNSIGNED", "MALFORMED"

#: any AT SHA line: group(2) is the fingerprint, empty when unsigned.
_AT_ANY = re.compile("^(APPROVED AT SHA:" + _H + ")([0-9a-f]*)(.*)$", re.M)
_FIELDS = ("APPROVED BY:", "APPROVED ON:", "SCOPE APPROVED:")


def read_approval(text: str):
    """THREE STATES - SIGNED / UNSIGNED / MALFORMED. Returns (state, reason).

    K CP4 - THIS EXISTS BECAUSE `is_signed()` DERIVED "SIGNED" FROM AN ABSENCE.
    `merge_all.is_signed()` asked `target_span()` for an unsigned block and treated the
    resulting `SystemExit` as *signed*. `target_span` raises for TWO different reasons:
    every block is filled (genuinely signed) AND there is no block at all. A document
    with NO approval block therefore read as SIGNED and would have merged unchallenged.
    Measured 2026-09-15: `packet-a-absent-bound-gate.md` and
    `entity-master-pre-implementation-gate.md` are both in that state on disk today.

    That is the non-vacuity rule inside the one tool that most needs it: an absence is
    not evidence. A reader of a signature must never answer SIGNED because it failed to
    find something.

    SIGNED HERE IS A STATEMENT ABOUT FORM, NOT ABOUT TRUTH, AND THE DIFFERENCE IS
    LOAD-BEARING. A fingerprint pins the bytes as they stood AT APPROVAL, so any later
    edit anywhere in the packet legitimately stops it re-deriving from the CURRENT file -
    `fingerprint()`'s own docstring says so. Measured 2026-09-15: only 5 of 35 filled
    blocks re-derive from the current file, and two carry 40-character hashes rather than
    the 9-character form. Defining SIGNED as "re-derives now" would declare 30 genuine
    owner approvals invalid and make `merge_all` refuse every unit.

    So: this reader answers "does a written approval exist and is it well-formed?".
    `tools/verify_manifest.py` answers "is the fingerprint still true, and if not, which
    commit was it last true at?" by walking history. Two questions, two tools. Do not
    fold the second into the first.
    """
    ats = list(_AT_ANY.finditer(text))
    if not ats:
        return UNSIGNED, "no approval block at all (0 `APPROVED AT SHA:` lines)"

    for label in _FIELDS:
        n = len(re.findall("^" + re.escape(label), text, re.M))
        if n != len(ats):
            return MALFORMED, ("%d `%s` line(s) beside %d approval block(s) - a block is "
                               "missing a field or carries a duplicate"
                               % (n, label.rstrip(":"), len(ats)))

    blanks = [m for m in ats if not m.group(2)]
    if len(blanks) > 1:
        return MALFORMED, ("%d unsigned blocks - a signature could not say which "
                           "checkpoint it covers" % len(blanks))
    if len(blanks) == 1:
        return UNSIGNED, "1 block awaiting a fingerprint (%d of %d signed)" % (
            len(ats) - 1, len(ats))
    return SIGNED, "all %d block(s) carry a fingerprint" % len(ats)


def _read_approval_check() -> int:
    """Controls for the three-state reader, including the two that caused the defect."""
    ok = True
    NL = "\n"
    BT = "```"

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-54s -> %-10s %s" % (label, got, "ok" if good else "WRONG (want %s)" % want))

    def blk(sha=""):
        return (BT + NL + "APPROVED BY:      Patrick" + NL
                + "APPROVED ON:      2026-09-15" + NL
                + "APPROVED AT SHA:  " + sha + NL
                + "SCOPE APPROVED:   CP1" + NL + BT + NL)

    body = "# packet" + NL + NL + "prose" + NL + NL

    show("SIGNED: one filled block", read_approval(body + blk("abc123def"))[0], SIGNED)
    show("UNSIGNED: one blank block", read_approval(body + blk())[0], UNSIGNED)
    # THE DEFECT: no block at all used to read as SIGNED
    show("NO BLOCK AT ALL -> UNSIGNED, never SIGNED", read_approval(body)[0], UNSIGNED)
    # two FILLED blocks is the ordinary multi-checkpoint packet, NOT malformed:
    # measured 2026-09-15, 13 of 35 gate docs carry 2-3 blocks, all signed.
    show("two FILLED blocks (13 real docs look like this) -> SIGNED",
         read_approval(body + blk("aaa111bbb") + blk("ccc222ddd"))[0], SIGNED)
    show("two UNSIGNED blocks -> MALFORMED",
         read_approval(body + blk() + blk())[0], MALFORMED)
    show("one filled + one blank -> UNSIGNED",
         read_approval(body + blk("abc123def") + blk())[0], UNSIGNED)
    missing = (BT + NL + "APPROVED BY:      Patrick" + NL
               + "APPROVED AT SHA:  abc123def" + NL
               + "SCOPE APPROVED:   CP1" + NL + BT + NL)
    show("block missing APPROVED ON -> MALFORMED",
         read_approval(body + missing)[0], MALFORMED)
    dup = blk("abc123def") + "APPROVED BY:      Someone" + NL
    show("duplicated APPROVED BY -> MALFORMED", read_approval(body + dup)[0], MALFORMED)

    # NON-VACUITY: the reader must actually distinguish, not answer one thing always.
    states = {read_approval(body + blk("abc123def"))[0],
              read_approval(body)[0],
              read_approval(body + blk() + blk())[0]}
    show("the reader returns all three states (non-vacuity)", len(states), 3)

    print("READ-CHECK:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def blank_span(text: str, span) -> str:
    """`text` with the AT SHA line at `span` reduced to its bare label."""
    lo, hi = span
    return text[:lo] + "APPROVED AT SHA:" + text[hi:]


def fingerprint(text: str, span=None) -> str:
    """The packet's hash with ONE block's AT SHA field blank — the format's rule.

    `span` names WHICH block. Omitted, it is the unsigned one (`target_span`),
    which is what SIGNING wants. Passed explicitly, any block can be
    RE-DERIVED — blanking a filled field and hashing must return the value that
    was in it, and that round trip is the only way an approval can be checked
    after the fact.

    ⭐ Every OTHER block is left exactly as it stands. A fingerprint pins the
    bytes the owner approved AT approval time, so a sibling's filled field is
    part of those bytes — which is also why a later edit elsewhere in the packet
    legitimately stops a fingerprint re-deriving from the CURRENT file, and
    `git show <sha>:<file>` is how it is recovered.
    """
    if span is None:
        span = target_span(text)
    return hash_object(blank_span(text, span))[:9]


def sign(path: pathlib.Path, by: str, on: str, scope: str) -> str:
    t = path.read_text(encoding="utf-8")
    if not _AT_LINE.search(t):
        raise SystemExit(f"⛔ no APPROVED AT SHA line in {path.name}")
    span = target_span(t)
    fp = fingerprint(t, span)
    # ⚠️ Normalise the padding rather than preserving whatever was there: an
    # UNSIGNED block has zero spaces after the colon, so preserving it produced
    # "APPROVED AT SHA:40caca541" — correct, unreadable, and inconsistent with
    # every signed packet in the tree.
    # ⛔ WRITTEN BY SPAN, into the UNSIGNED block — see target_span.
    lo, hi = span
    t = t[:lo] + "APPROVED AT SHA:  " + fp + t[hi:]
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
    ap.add_argument("--read-check", action="store_true")
    a = ap.parse_args()

    if a.self_check:
        ok = True
        body = ("APPROVED BY:      x\nAPPROVED ON:      y\n"
                "APPROVED AT SHA:  \nSCOPE APPROVED:   z\n")
        f1 = fingerprint(body)
        # CONTROL 1 — filling the field must NOT change the fingerprint, i.e. a
        # SIGNED block must RE-DERIVE. Its span is passed explicitly because a
        # filled packet has no unsigned block for target_span to find, and
        # re-derivation is the ONLY way an approval can be checked after the fact.
        filled = body.replace("APPROVED AT SHA:  \n", f"APPROVED AT SHA:  {f1}\n")
        _m = re.search("^APPROVED AT SHA:.*$", filled, re.M)
        if fingerprint(filled, _m.span()) != f1:
            print("  ⛔ a signed block does not re-derive — verification is impossible"); ok = False
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
        # CONTROL 5 — ⚰️ THE 2026-09-13 DEFECT, EXACTLY. A packet with a SIGNED
        # block whose line carries trailing prose (so it does NOT match `$`),
        # followed by a genuinely UNSIGNED block. The old code wrote the first
        # REGEX-MATCHING line: it destroyed the signed CP3 fingerprint and left
        # the unsigned block blank, while reporting success and exiting 0.
        # ⭐ THREE blocks, the real packet's shape — and the ORDER is the whole
        # point. Block 1's line carries trailing prose so it does NOT match `$`;
        # block 2's is CLEAN so it DOES. The old code therefore skipped the
        # first and wrote the second — destroying a signed fingerprint — while
        # block 3, the only genuinely unsigned one, stayed blank. A fixture
        # without a clean signed block reproduces the symptom and not the loss.
        two = chr(10).join([
            "# packet", "", "```",
            "APPROVED BY:      Patrick", "APPROVED ON:      2026-09-13",
            "APPROVED AT SHA:  3460a279b   (git hash-object as it stood at",
            "                  approval, with this field blank)",
            "SCOPE APPROVED:   CP1-CP2", "```", "",
            "## second", "", "```",
            "APPROVED BY:      Patrick", "APPROVED ON:      2026-09-12",
            "APPROVED AT SHA:  148af5293",
            "SCOPE APPROVED:   CP3", "```", "",
            "## third", "", "```",
            "APPROVED BY:", "APPROVED ON:", "APPROVED AT SHA:",
            "SCOPE APPROVED:   CP3 discharge", "```", ""])
        d2 = tempfile.mkdtemp()
        f2 = pathlib.Path(d2) / "two.md"
        f2.write_text(two, encoding="utf-8")
        newfp = sign(f2, "Patrick", "2026-09-13", "")
        after = f2.read_text(encoding="utf-8")
        if "APPROVED AT SHA:  148af5293" not in after:
            print("  ⛔ SIGNING DESTROYED THE ALREADY-SIGNED FINGERPRINT"); ok = False
        if f"APPROVED AT SHA:  {newfp}" not in after:
            print("  ⛔ the unsigned block was left blank"); ok = False
        if after.count("APPROVED BY:      Patrick") != 3:
            print("  ⛔ the approver did not land on the unsigned block"); ok = False
        # CONTROL 6 — re-signing a fully signed packet must REFUSE, not clobber.
        try:
            sign(f2, "Patrick", "2026-09-13", "")
            print("  ⛔ re-signing a fully signed packet was allowed"); ok = False
        except SystemExit:
            pass

        print("SELF-CHECK:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    if getattr(a, "read_check", False):
        return _read_approval_check()

    if not a.packet:
        raise SystemExit("give a packet path, or --self-check")
    scope = pathlib.Path(a.scope_file).read_text(encoding="utf-8") if a.scope_file else ""
    fp = sign(pathlib.Path(a.packet), a.by, a.on, scope)
    print(f"signed {a.packet}  AT SHA {fp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
