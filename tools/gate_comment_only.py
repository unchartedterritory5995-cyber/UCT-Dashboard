"""R-J — PROVE a deploy delta is comment- or doc-only, or demand a re-run.

⛔ WHY THIS IS A TOOL AND NOT A JUDGEMENT.

Deploys #4 and #4b both shipped a SHA that the full suite had not been measured
on. Both times the delta was genuinely inert -- two Python tool files no JS test
imports, then one comment block -- and both times the argument for shipping was
MINE, made in prose, in the deploy record. That is exactly the shape this repo
keeps getting burned by: a claim about a diff, written by the person who wants
the diff to be fine.

⭐ THE RULE (owner, 2026-09-10): the checklist is measured on the SHA THAT IS
PUSHED. The only permitted exception is a delta this tool proves is comment- or
doc-only. Anything else means re-running journal-2-0 at rest and the Wave Q1
rails on the pushed SHA at minimum.

⛔⛔ THE STRIPPER FAILS TOWARD "RE-RUN", ALWAYS, AND THAT IS THE WHOLE DESIGN.
A clever comment stripper is a liability here: if it strips a `//` that lives
inside a string literal, or a `#` inside a Python string, it can make a REAL
code change look inert -- and this tool's whole job is to authorise skipping a
test run. So it only removes:

    · a line that is ENTIRELY a comment once trimmed
    · a block comment whose opener and closer are each alone on their line

Anything cleverer is declined. Under-stripping costs a 2-minute re-run;
over-stripping ships an unmeasured code change and calls it proved.
"""
from __future__ import annotations

import re
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CODE_SUFFIXES = (".js", ".jsx", ".ts", ".tsx", ".py", ".mjs", ".cjs")

_JS_LINE = re.compile(r"^\s*//")
_PY_LINE = re.compile(r"^\s*#")
_BLOCK_OPEN = re.compile(r"^\s*/\*")
_BLOCK_CLOSE = re.compile(r"\*/\s*$")
_DOCSTR = re.compile(r'^\s*(?:[rRbBuUfF]{0,2})("""|\'\'\')')


def strip_comments(text: str, path: str) -> str:
    """⛔ Conservative by construction. See the module docstring."""
    out, in_block, in_doc, doc_q = [], False, False, ""
    for raw in text.splitlines():
        line = raw.rstrip()
        if in_block:
            if _BLOCK_CLOSE.search(line):
                in_block = False
            continue
        if in_doc:
            if doc_q in line:
                in_doc = False
            continue
        if path.endswith(".py"):
            if _PY_LINE.match(line):
                continue
            m = _DOCSTR.match(line)
            if m:
                q = m.group(1)
                # A one-line docstring closes on the same line.
                if line.count(q) < 2:
                    in_doc, doc_q = True, q
                continue
        else:
            if _JS_LINE.match(line):
                continue
            if _BLOCK_OPEN.match(line):
                if not _BLOCK_CLOSE.search(line):
                    in_block = True
                continue
        out.append(line.strip())
    # ⛔ Whitespace-insensitive comparison: re-indenting is not a code change,
    # and a diff that is only indentation must not force a re-run either.
    return "\n".join(l for l in out if l)


def sh(*args: str) -> str:
    r = subprocess.run(args, capture_output=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} -> {r.returncode}: {r.stderr[:200]}")
    return r.stdout


def prove(old: str, new: str) -> tuple[bool, list[str], list[str]]:
    """→ (comment_only, code_files_that_differ, all_changed_files)."""
    changed = [f for f in sh("git", "diff", "--name-only", f"{old}..{new}").splitlines() if f.strip()]
    offenders = []
    for f in changed:
        if not f.endswith(CODE_SUFFIXES):
            continue          # docs, json, css: not code, not this tool's concern
        try:
            a = sh("git", "show", f"{old}:{f}")
        except RuntimeError:
            a = ""            # added on the new side
        try:
            b = sh("git", "show", f"{new}:{f}")
        except RuntimeError:
            b = ""            # deleted on the new side
        if strip_comments(a, f) != strip_comments(b, f):
            offenders.append(f)
    return (not offenders), offenders, changed


def self_check() -> int:
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok ' if ok else 'FAIL'}  {name}")
        bad += 0 if ok else 1

    js = "x.js"
    case("a whole-line // comment is stripped",
         strip_comments("const a = 1\n// hello\n", js) == "const a = 1")
    case("a block comment alone on its lines is stripped",
         strip_comments("/*\n * hi\n */\nconst a = 1\n", js) == "const a = 1")
    case("re-indentation alone is not a code change",
         strip_comments("  const a = 1\n", js) == strip_comments("const a = 1\n", js))
    # ⛔ THE CASES THAT MATTER: over-stripping would authorise skipping a test run.
    case("⛔ a // INSIDE a string is NOT stripped",
         strip_comments('const u = "http://x"\n', js) == 'const u = "http://x"')
    case("⛔ a trailing comment leaves its CODE behind",
         strip_comments("const a = 1  // why\n", js) == "const a = 1  // why")
    case("⛔ a # inside a python string is NOT stripped",
         strip_comments('u = "a#b"\n', "x.py") == 'u = "a#b"')
    case("a python whole-line # comment is stripped",
         strip_comments("a = 1\n# hi\n", "x.py") == "a = 1")
    case("a python docstring is stripped",
         strip_comments('"""doc\nmore\n"""\na = 1\n', "x.py") == "a = 1")
    case("a real code change survives stripping (the whole point)",
         strip_comments("const a = 1\n", js) != strip_comments("const a = 2\n", js))
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def main() -> int:
    if "--self-check" in sys.argv:
        return self_check()
    if len(sys.argv) < 3:
        print("usage: gate_comment_only.py <old-sha> <new-sha> | --self-check")
        return 2
    old, new = sys.argv[1], sys.argv[2]
    ok, offenders, changed = prove(old, new)
    print(f"\n⭐ R-J — is {old[:9]}..{new[:9]} comment/doc-only?")
    print(f"   files changed: {len(changed)}")
    code = [f for f in changed if f.endswith(CODE_SUFFIXES)]
    print(f"   code files in the delta: {len(code)}")
    for f in code:
        mark = "⛔ CODE DIFFERS" if f in offenders else "· comment-only"
        print(f"     {mark}  {f}")
    if ok:
        print("\n✅ PROVED comment/doc-only — zero non-whitespace difference after"
              " stripping.\n   The checklist measured at the older SHA still stands.")
    else:
        print("\n⛔ NOT comment-only. The checklist must be re-run on the PUSHED SHA:"
              "\n   journal-2-0 at rest, and the Wave Q1 rails, at minimum.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
