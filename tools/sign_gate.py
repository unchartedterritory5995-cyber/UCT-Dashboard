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
#: A FILLED field's value: everything to the end of the line and NOTHING past it.
#: Built from chr(10) for the same reason `_H` is built from chr(92) — this file has
#: been pasted through a heredoc that collapsed its backslashes.
_FILLED = "[^" + chr(10) + "]*"

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
    # ⛔ K CP6 — A SIGNED BLOCK WITH A BLANK SCOPE IS MALFORMED, NOT SIGNED.
    # ⭐ This is the same refusal the reader already makes about a missing approver, applied
    # to the field that says WHAT was approved. A scope-less approval reads as a full one to
    # anything that greps for the hash — the packet says a person approved something and
    # does not say what — and three blocks in this tree are already in that state.
    scopes = _SCOPE_LINE.findall(text)
    empty = [i for i, s in enumerate(scopes) if not s.strip()]
    if len(scopes) == len(ats) and empty:
        return MALFORMED, ("%d block(s) carry a fingerprint with a BLANK `SCOPE APPROVED:` "
                           "- an approval that does not say what was approved" % len(empty))
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


#: A checkpoint id, in every spelling this tree actually uses: `CP1`, `E CP25`, `A-CP1`,
#: `T2 CP1`. ⛔ Hyphen and space are the SAME character here — `packet-a` writes `A CP1` in
#: its heading and the manifest writes `A-CP1`, and a deriver that told them apart would
#: refuse a legitimate row and stop the signing session at it.
_CP_ID = r"[A-Z][A-Z0-9]*[- ]?CP\d+|CP\d+"


#: ⚠️ These use RAW STRINGS, unlike `_H` above, which is built from `chr(92)` because this
#: file has twice been pasted through a heredoc that collapsed its backslashes. These were
#: written with an editor that writes exact bytes; the self-check below is what proves it.
_WS_RUN = re.compile(r"[-\s]+")
_CP_TAIL = re.compile(r"CP\d+$")
_CP_TABLE_ROW = re.compile(r"^\|\s*\**\s*(" + _CP_ID + r")\s*\**\s*\|", re.M)
_UNIT_LINE = re.compile(r"^unit:[ \t]*(.+)$", re.M)


def _norm_cp(s: str) -> str:
    return _WS_RUN.sub(" ", s.strip().upper())


def _cp_forms(tok: str) -> set:
    """Both spellings a manifest row may use: the full id, and its bare `CPnn` tail.

    ⛔ `E CP25` has to satisfy a row that says `CP25` (build records write the bare form)
    AND one that says `E CP25`. Measured against all 38 rows before this shipped.
    """
    n = _norm_cp(tok)
    out = {n}
    m = _CP_TAIL.search(n)
    if m:
        out.add(m.group(0))
    return out


def declared_checkpoints(text: str):
    """(the checkpoint ids this packet declares, which evidence said so).

    ⭐ **STRONGEST AVAILABLE EVIDENCE, WITH THE WEAKER MODE NAMED.** `declared` means the
    ids came from the packet's own `unit:` line or the first cell of its checkpoint table —
    35 of the 38 rows. `prose` means the packet has neither and declares its checkpoint in a
    heading or a sentence — measured, exactly 3 do (`packet-a-absent-bound-gate`,
    `packet-t-stale-test-gate`, and packet A's sibling), and a deriver that refused them
    would have stopped the session at its first row.

    ⛔ The mode is RETURNED, never swallowed: a caller that cannot tell a table from a
    sentence is asserting something it did not measure.
    """
    strong = set()
    m = _UNIT_LINE.search(text)
    if m:
        for t in re.findall(_CP_ID, m.group(1)):
            strong |= _cp_forms(t)
    for mm in _CP_TABLE_ROW.finditer(text):
        strong |= _cp_forms(mm.group(1))
    if strong:
        return strong, "declared"
    weak = set()
    for t in re.findall(_CP_ID, text):
        weak |= _cp_forms(t)
    return weak, "prose"


def rederive_signed(text: str, span) -> str:
    """The fingerprint a SIGNED block should carry, recomputed from the file.

    ⚰️⚰️ **K CP5 — `fingerprint(text, span)` DOES NOT COME BACK ON A SIGNED PACKET, AND
    THAT IS BY CONSTRUCTION.** `sign()` hashes BEFORE it writes `APPROVED BY:` and
    `APPROVED ON:`, and those bytes are inside the hash. Measured 2026-09-15 on a packet
    signed by `sign_all.py` three minutes earlier and untouched since:

        stored c9904433a   fingerprint(text, span) c4152be4b   DOES NOT re-derive

    …and on the real tree: **5 of 35 signed blocks re-derive, 30 do not.** The module
    docstring calls that round trip *"the only way an approval can be checked after the
    fact"*, so this is the difference between a checkable approval and a decorative one.

    ⭐ **The value being pinned is right; the reader was wrong.** A fingerprint pins the
    bytes the owner READ — the packet with an empty approval block — not the bytes after
    the signature was stamped into it. So the reader must blank all THREE written fields,
    which is what this does, and `fingerprint()` is left exactly as it is: changing what
    is hashed would re-date every approval in the tree and invalidate all 36 manifest
    fingerprints at once.

    ⛔ It lives HERE and not in `sign_all.py` because a second implementation of a
    fingerprint is a second authority over it (`lesson_a_second_authority_over_one_value`).
    """
    lo, hi = span
    t = text[:lo] + "APPROVED AT SHA:" + text[hi:]
    # ⛔ NOT `_H` HERE. `_H` is `[ \t]*`, which matches only an EMPTY field — correct for
    # `sign()`, which writes INTO a blank line, and a silent no-op here, where the field
    # is filled. ⛔ And not `.*` either: per the comment on `_H` above, a class that can
    # reach a newline walks into the NEXT field. `[^\n]*` cannot cross a line by
    # construction, which is the property that matters.
    t = re.sub("^APPROVED BY:" + _FILLED + "$", "APPROVED BY:", t, count=1, flags=re.M)
    t = re.sub("^APPROVED ON:" + _FILLED + "$", "APPROVED ON:", t, count=1, flags=re.M)
    # ⛔ K CP6: the SCOPE is now written by `sign()` too, and it is hashed BEFORE that write
    # (the fingerprint pins the bytes the owner READ — an empty block). So the reader must
    # blank all FOUR written fields, or every packet this tool signs stops re-deriving the
    # day the scope starts being filled in.
    # ⚠️ This is correct for a packet THIS TOOL signed. A historical packet whose scope was
    # hand-written BEFORE signing had that text inside its hash; re-derive those with
    # `fingerprint(text, span)` instead.
    t = re.sub("^SCOPE APPROVED:" + _FILLED + "$", "SCOPE APPROVED:", t, count=1, flags=re.M)
    return hash_object(t)[:9]


#: an UNSIGNED scope line — the one this signer writes into
_SCOPE_BLANK = re.compile(r"^SCOPE APPROVED:[ \t]*$", re.M)
#: any scope line, filled or not; group(1) is the value
_SCOPE_LINE = re.compile(r"^SCOPE APPROVED:[ \t]*([^\n]*)$", re.M)

REFUSED_BLANK_SCOPE, REFUSED_UNDECLARED_SCOPE, REFUSED_NO_SCOPE_LINE = 2, 3, 4


def sign(path: pathlib.Path, by: str, on: str, scope: str) -> str:
    """Write the approval block. ⛔ **THE SCOPE IS WRITTEN, AND IT IS CHECKED FIRST.**

    ⚰️⚰️ **K CP6 — `scope` WAS ACCEPTED AND NEVER READ.** From this function's first
    version until 2026-09-15 the argument was dropped on the floor: `sign_all` composed a
    scope per row, wrote it to `.scopes/*.txt`, passed `--scope-file`, and the packet came
    out with a **blank** `SCOPE APPROVED:` line. Proved by AST, with `by` and `on` as the
    positive control. **Three signed blocks in this tree already look like that**, and 38
    more were one command away.

    ⭐ **A blank scope is not a small defect**: `read_approval` answers SIGNED on the AT SHA
    line alone, so a scope-less approval reads as a full one — the packet says a person
    approved something and does not say what.

    ⛔ **REFUSALS COME BEFORE ANY READ OF A SPAN, so nothing is written on a bad scope:**
      2  the scope is blank or whitespace
      3  the scope names no checkpoint this packet declares (`declared_checkpoints`)
      4  the block has no BLANK `SCOPE APPROVED:` line to write into — refusing rather than
         letting `re.sub` no-op, which is exactly the silent drop this checkpoint removes.
    """
    t = path.read_text(encoding="utf-8")
    if not _AT_LINE.search(t):
        raise SystemExit(f"⛔ no APPROVED AT SHA line in {path.name}")

    one_line = " ".join((scope or "").split())
    if not one_line:
        print("⛔ %s: a signature needs a SCOPE naming a checkpoint. Nothing was written."
              % path.name)
        raise SystemExit(REFUSED_BLANK_SCOPE)
    declared, mode = declared_checkpoints(t)
    named = re.findall(_CP_ID, one_line)
    hit = [tok for tok in named if _cp_forms(tok) & declared]
    if not hit:
        print("⛔ %s: the scope %r names no checkpoint this packet declares (%s: %s). "
              "Nothing was written."
              % (path.name, one_line[:60], mode, ", ".join(sorted(declared)) or "none"))
        raise SystemExit(REFUSED_UNDECLARED_SCOPE)

    span = target_span(t)
    if not _SCOPE_BLANK.search(t, span[0]):
        print("⛔ %s: no BLANK `SCOPE APPROVED:` line after the block being signed, so the "
              "scope could not be written. Nothing was written." % path.name)
        raise SystemExit(REFUSED_NO_SCOPE_LINE)
    fp = fingerprint(t, span)
    # ⛔⛔ 2026-09-18 — `fp` IS COMPUTED HERE, ON `t` AS IT STANDS RIGHT NOW. If the
    # caller pre-filled `APPROVED BY:`/`APPROVED ON:` in the template BEFORE running
    # this tool (rather than leaving all FOUR fields blank and letting `--by`/`--on`
    # below write them), `fp` pins bytes that INCLUDE that pre-filled text — but
    # `rederive_signed()` (the verifier) unconditionally blanks all FOUR fields on
    # every check, assuming BY/ON were EMPTY at fingerprint time same as SHA/SCOPE.
    # The two disagree, and `sign_all.py --verify` reports SIGNED-DRIFTED on a packet
    # that was never actually edited after signing.
    # ⚰️ Found 2026-09-18: three packets signed this way in one session
    # (d5-cp7-build-record, s6-cp2-prime-build-record, s6-cp3-build-record) all
    # drifted for exactly this reason, while packets signed with a genuinely-blank
    # template re-derive cleanly. Fixed by re-blanking all four fields and re-running
    # this tool from scratch — never by hand-patching the manifest's expected value.
    # ⭐ **Leave ALL FOUR fields blank in the template — `APPROVED BY:`, `APPROVED ON:`,
    # `APPROVED AT SHA:`, `SCOPE APPROVED:`, each with nothing after the colon — and
    # let this tool write every one of them.** Pre-filling BY/ON "for readability
    # before signing" is the exact trap.
    #
    # ⚠️ Normalise the padding rather than preserving whatever was there: an
    # UNSIGNED block has zero spaces after the colon, so preserving it produced
    # "APPROVED AT SHA:40caca541" — correct, unreadable, and inconsistent with
    # every signed packet in the tree.
    # ⛔ WRITTEN BY SPAN, into the UNSIGNED block — see target_span.
    lo, hi = span
    t = t[:lo] + "APPROVED AT SHA:  " + fp + t[hi:]
    t = re.sub("^APPROVED BY:" + _H + "$", "APPROVED BY:      " + by, t, count=1, flags=re.M)
    t = re.sub("^APPROVED ON:" + _H + "$", "APPROVED ON:      " + on, t, count=1, flags=re.M)
    # ⛔ THE SCOPE IS SPLICED BY SPAN, into the blank line belonging to THE BLOCK BEING
    # SIGNED — not by `re.sub(count=1)`, which writes the FIRST blank line in the file and
    # would put this block's scope on a different block's. Same defect as the 2026-09-13
    # fingerprint loss, one field along.
    # ⚠️ Anchored on the AT SHA line AS IT NOW STANDS, not on `lo`: the BY and ON writes
    # happen EARLIER in the block and lengthen the text before it, so `lo` no longer points
    # where it did. Re-finding the line we just wrote is the only offset that survives.
    here = t.find("APPROVED AT SHA:  " + fp)
    ms = _SCOPE_BLANK.search(t, here if here >= 0 else lo)
    if ms is None:                      # pragma: no cover - guarded above, kept honest
        raise SystemExit(REFUSED_NO_SCOPE_LINE)
    t = t[:ms.start()] + "SCOPE APPROVED:   " + one_line + t[ms.end():]
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
        # ⛔ K CP6: the fixture now DECLARES a checkpoint, because the signer refuses a
        # scope the packet does not declare. A fixture that declared none would only ever
        # exercise the refusal and never the write.
        empty = chr(10).join(["---", "unit: CP1", "---", "",
                              "# packet", "", "## APPROVAL", "", "```", "",
                              "APPROVED BY:", "APPROVED ON:", "APPROVED AT SHA:",
                              "SCOPE APPROVED:", "```", ""])
        d = tempfile.mkdtemp()
        pp = pathlib.Path(d) / "g.md"
        pp.write_text(empty, encoding="utf-8")
        sign(pp, "SOMEBODY", "2026-01-01", "CP1 ONLY")
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
            "SCOPE APPROVED:", "```", ""])
        d2 = tempfile.mkdtemp()
        f2 = pathlib.Path(d2) / "two.md"
        f2.write_text(two, encoding="utf-8")
        newfp = sign(f2, "Patrick", "2026-09-13", "CP3 discharge")
        after = f2.read_text(encoding="utf-8")
        if "APPROVED AT SHA:  148af5293" not in after:
            print("  ⛔ SIGNING DESTROYED THE ALREADY-SIGNED FINGERPRINT"); ok = False
        if f"APPROVED AT SHA:  {newfp}" not in after:
            print("  ⛔ the unsigned block was left blank"); ok = False
        if after.count("APPROVED BY:      Patrick") != 3:
            print("  ⛔ the approver did not land on the unsigned block"); ok = False
        # CONTROL 6 — re-signing a fully signed packet must REFUSE, not clobber.
        try:
            sign(f2, "Patrick", "2026-09-13", "CP3 discharge")
            print("  ⛔ re-signing a fully signed packet was allowed"); ok = False
        except SystemExit:
            pass
        # CONTROL 7 — K CP5. A SIGNED packet must be CHECKABLE: `rederive_signed` gives
        # back the value in the field. Run against the CONTROL-4 packet, which was signed
        # by `sign()` itself a few lines up, so the fixture is the real write path and not
        # a hand-built lookalike.
        signed_text = pp.read_text(encoding="utf-8")
        _m7 = re.search("^APPROVED AT SHA:" + _H + "([0-9a-f]{9})$", signed_text, re.M)
        if _m7 is None:
            print("  ⛔ CONTROL 7 fixture has no signed line to re-derive"); ok = False
        else:
            if rederive_signed(signed_text, _m7.span()) != _m7.group(1):
                print("  ⛔ a signed packet does not re-derive — an approval cannot be "
                      "checked after the fact"); ok = False
            # …and it must be ABLE to fail: change one byte of the BODY and the value
            # must move. Without this, "it re-derives" is satisfied by a function that
            # returns the string it was handed.
            mutated = signed_text.replace("# packet", "# packet (edited)", 1)
            if mutated == signed_text:
                print("  ⛔ CONTROL 7's mutation changed nothing — vacuous"); ok = False
            elif rederive_signed(mutated, _m7.span()) == _m7.group(1):
                print("  ⛔ re-derivation ignores the packet body"); ok = False
            # ⛔ AND the OLD reader must still be the one that is wrong, or this control
            # is testing nothing that was broken: `fingerprint(text, span)` on the same
            # signed text must NOT come back, because `sign()` hashes before it writes
            # APPROVED BY / APPROVED ON.
            if fingerprint(signed_text, _m7.span()) == _m7.group(1):
                print("  ⚠️  CONTROL 7: fingerprint() now re-derives too — the defect "
                      "K CP5 was built for is gone; delete rederive_signed, don't keep "
                      "two authorities"); ok = False

        # ── K CP6 — THE SCOPE IS WRITTEN, AND A BAD ONE WRITES NOTHING ──────────────
        import hashlib

        def _sha(p):
            return hashlib.sha256(p.read_bytes()).hexdigest()

        def _fx(scope_line="SCOPE APPROVED:"):
            d3 = pathlib.Path(tempfile.mkdtemp()) / "p.md"
            d3.write_text(chr(10).join(
                ["---", "id: packet-x", "---", "", "# PACKET X", "",
                 "| cp | what |", "|---|---|", "| **CP1** | a |", "| **CP2** | b |", "",
                 "```", "", "APPROVED BY:", "APPROVED ON:", "APPROVED AT SHA:",
                 scope_line, "```", ""]) + chr(10), encoding="utf-8")
            return d3

        # CONTROL 8 — a declared scope is WRITTEN, verbatim
        f8 = _fx()
        sign(f8, "Patrick", "2026-09-15", "CP2 ONLY — this and nothing else.")
        line8 = [l for l in f8.read_text(encoding="utf-8").splitlines()
                 if l.startswith("SCOPE APPROVED:")][0]
        if "CP2 ONLY" not in line8 or "nothing else" not in line8:
            print("  ⛔ the scope was not written: %r" % line8); ok = False
        # ⛔ …and it lands on the block being signed, beside its own fingerprint.
        if not re.search("^APPROVED AT SHA:[ ]+[0-9a-f]{9}$",
                         f8.read_text(encoding="utf-8"), re.M):
            print("  ⛔ CONTROL 8 wrote a scope without a fingerprint"); ok = False
        # CONTROL 9 — a BLANK scope refuses, and writes NOTHING (sha256 both sides)
        f9 = _fx()
        b9 = _sha(f9)
        try:
            sign(f9, "Patrick", "2026-09-15", "   ")
            print("  ⛔ a blank scope was accepted"); ok = False
        except SystemExit as exc:
            if exc.code != REFUSED_BLANK_SCOPE:
                print("  ⛔ blank scope exited %r, not %d" % (exc.code,
                                                             REFUSED_BLANK_SCOPE)); ok = False
        if _sha(f9) != b9:
            print("  ⛔ a REFUSED blank scope still changed the file"); ok = False
        # CONTROL 10 — a scope naming a checkpoint the packet does not declare
        f10 = _fx()
        b10 = _sha(f10)
        try:
            sign(f10, "Patrick", "2026-09-15", "CP9 ONLY")
            print("  ⛔ an undeclared checkpoint was accepted"); ok = False
        except SystemExit as exc:
            if exc.code != REFUSED_UNDECLARED_SCOPE:
                print("  ⛔ undeclared scope exited %r, not %d"
                      % (exc.code, REFUSED_UNDECLARED_SCOPE)); ok = False
        if _sha(f10) != b10:
            print("  ⛔ a REFUSED undeclared scope still changed the file"); ok = False
        # CONTROL 11 — the deriver: mode, and it can say NO
        d_tab, m_tab = declared_checkpoints(_fx().read_text(encoding="utf-8"))
        if m_tab != "declared":
            print("  ⛔ a packet with a checkpoint table did not read `declared`"); ok = False
        if "CP2" not in d_tab:
            print("  ⛔ the deriver missed a checkpoint its own table declares"); ok = False
        if "CP9" in d_tab:
            print("  ⛔ the deriver accepts a checkpoint nothing declares"); ok = False
        d_pr, m_pr = declared_checkpoints("# a packet with no table" + chr(10)
                                          + "One checkpoint: **T-CP1**." + chr(10))
        if m_pr != "prose":
            print("  ⛔ the weaker mode was not NAMED"); ok = False
        if "T CP1" not in d_pr:
            print("  ⛔ the fallback missed a checkpoint declared in a sentence"); ok = False
        # CONTROL 12 — a scope that is written must not break re-derivation
        t12 = f8.read_text(encoding="utf-8")
        m12 = re.search("^APPROVED AT SHA:[ ]*([0-9a-f]{9})$", t12, re.M)
        if m12 and rederive_signed(t12, m12.span()) != m12.group(1):
            print("  ⛔ a packet with a WRITTEN scope no longer re-derives"); ok = False

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
