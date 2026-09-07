"""Byte-exact mutation-check harness.

WHY THIS EXISTS
---------------
A mutation check proves a rail can fail: break the implementation on purpose,
watch the intended test go red, put it back. The value is real -- this program
has used it to prove several rails were not vacuous.

The hazard is that step three is "put it back". During Wave K Slice 1 I ran a
mutation against a file with legitimate UNCOMMITTED work in it and rolled back
with `git checkout -- <file>`, which restored HEAD and silently discarded the
implementation the mutation was testing. It was recoverable that time. The
purpose of a mutation check is to prove the rail, NOT to create a new
source-loss hazard.

So: this snapshots EXACT BYTES before mutating, restores those exact bytes in
a `finally` (so a crash, a failing test, or Ctrl-C all still restore), and
then VERIFIES the restoration by hashing. Never `git checkout`.

THE PROTOCOL IT ENFORCES
------------------------
  1. snapshot exact pre-mutation bytes of every target file
  2. apply the mutation
  3. run the test command; require it to FAIL (optionally: require a named
     test to be among the failures)
  4. restore the exact saved bytes
  5. re-run; require it to PASS
  6. verify the restored bytes hash-match the snapshot
Any deviation is reported and exits non-zero.

USAGE
-----
    python tools/mutation_check.py \
        --file api/services/journal_two/note_citation_text.py \
        --replace 'BLOCK_SEPARATOR = "\\n"' --with 'BLOCK_SEPARATOR = " "' \
        --test "python -m pytest tests/test_note_citation_text.py -q" \
        --expect-red test_nested_list_items_each_get_their_own_line

`--replace/--with` may be repeated and applies to the single `--file`; pass
`--file` more than once with matching `--replace/--with` groups by running the
tool once per file, or use `--line N --set TEXT` for a line-exact edit.
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path


def _digest(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _printable(line: str) -> str:
    """Make a captured line safe to print on THIS process's stdout.

    The mirror of the decode bug in `_run`. Having decoded the runner's box
    glyphs correctly, echoing them raised UnicodeEncodeError on a cp1252 pipe
    and killed the tool inside the branch whose only job is showing evidence.
    A diagnostic must never be able to take down the thing diagnosing.
    """
    enc = sys.stdout.encoding or "utf-8"
    return line.encode(enc, errors="replace").decode(enc, errors="replace")


def _run(cmd: str) -> tuple[int, str]:
    """Run the rail and capture everything it said.

    DECODE AS UTF-8, NEVER THE LOCALE CODEC. `text=True` decodes with the
    Windows locale codec (cp1252 here), which RAISES UnicodeDecodeError inside
    subprocess reader threads on bytes it has no mapping for -- 0x9D among
    them. Test runners print box-drawing and cross glyphs ONLY WHEN TESTS
    FAIL, so the capture worked on green runs and came back EMPTY on red ones.
    That is precisely inverted: `--expect-red` then reports "not among the
    failures" for a mutation that was attributed correctly, and the tool whose
    whole job is saying whether a rail is real answers "no" for a reason that
    has nothing to do with the rail. errors="replace" because a mangled glyph
    in a diagnostic is nothing; a lost diagnostic is the bug above.
    """
    p = subprocess.run(cmd, shell=True, capture_output=True,
                       encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", required=True, help="implementation file to mutate")
    ap.add_argument("--replace", action="append", default=[],
                    help="exact substring to replace (repeatable)")
    ap.add_argument("--with", dest="withs", action="append", default=[],
                    help="replacement for the matching --replace (repeatable)")
    ap.add_argument("--line", type=int, help="1-based line to overwrite instead")
    ap.add_argument("--set", dest="set_line", help="new text for --line")
    ap.add_argument("--test", required=True, help="shell command that runs the rail")
    ap.add_argument("--expect-red", help="substring that must appear in the FAILING output")
    args = ap.parse_args()

    path = Path(args.file)
    if not path.is_file():
        print(f"no such file: {path}")
        return 2
    if len(args.replace) != len(args.withs):
        print("--replace and --with must be given in matching pairs")
        return 2
    if not args.replace and args.line is None:
        print("nothing to mutate: pass --replace/--with or --line/--set")
        return 2

    # 1. SNAPSHOT -- binary, so encoding and newline translation cannot alter
    #    a single byte on the way back.
    original = path.read_bytes()
    before = _digest(original)
    print(f"[1] snapshot {path} ({len(original)} bytes, sha256 {before[:12]})")

    ok = True
    try:
        # 2. MUTATE
        text = original.decode("utf-8")
        if args.line is not None:
            lines = text.split("\n")
            if not (1 <= args.line <= len(lines)):
                print(f"--line {args.line} out of range (1..{len(lines)})")
                return 2
            print(f"[2] line {args.line}: {lines[args.line - 1]!r} -> {args.set_line!r}")
            lines[args.line - 1] = args.set_line or ""
            text = "\n".join(lines)
        for old, new in zip(args.replace, args.withs):
            if old not in text:
                print(f"[2] MUTATION TARGET NOT FOUND: {old!r}")
                return 2
            print(f"[2] replace {old!r} -> {new!r}")
            text = text.replace(old, new, 1)
        path.write_bytes(text.encode("utf-8"))

        # 3. REQUIRE RED
        code, out = _run(args.test)
        if code == 0:
            print("[3] [X] THE RAIL DID NOT FAIL -- it does not detect this mutation.")
            print("     A test that stays green through a broken implementation "
                  "is not a rail.")
            ok = False
        else:
            print(f"[3] rail failed as required (exit {code})")
            if args.expect_red and args.expect_red not in out:
                print(f"[3] [X] but {args.expect_red!r} was NOT among the failures -- "
                      f"something else broke, so this proves the wrong thing.")
                # SHOW WHAT DID FAIL. Without this the operator is told the
                # attribution is wrong and given nothing to attribute it WITH,
                # which is how a mis-attribution turns into a guessing loop.
                # (Long runner output is bounded; a wrapped or truncated test
                # name is itself a common cause of this branch.)
                print("[3] --- what actually failed (last 40 lines of output) ---")
                for line in out.rstrip().splitlines()[-40:]:
                    print("    | " + _printable(line))
                print("[3] --- end of captured output ---")
                ok = False
            elif args.expect_red:
                print(f"[3] and {args.expect_red!r} is among the failures")
    finally:
        # 4. RESTORE -- always, including on exception or a failing assertion.
        path.write_bytes(original)
        print(f"[4] restored {path}")

    # 5. REQUIRE GREEN AGAIN
    code, _ = _run(args.test)
    if code != 0:
        print(f"[5] [X] rail is RED after restore (exit {code}) -- the file may not "
              f"be what it was, or the rail was already failing before this ran.")
        ok = False
    else:
        print("[5] rail green again after restore")

    # 6. VERIFY BYTE-IDENTITY
    after = _digest(path.read_bytes())
    if after != before:
        print(f"[6] [X] RESTORED BYTES DIFFER  before={before[:12]} after={after[:12]}")
        ok = False
    else:
        print(f"[6] byte-identical restore verified (sha256 {after[:12]})")

    print("\nMUTATION CHECK PASSED" if ok else "\nMUTATION CHECK FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
