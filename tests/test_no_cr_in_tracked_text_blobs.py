"""No tracked text file may be staged with CR line endings.

⛔ THIS EXISTS BECAUSE ONE FILE ARRIVED WITH `\r\r\n` ON 1980 OF ITS 2048 LINES.
`app/src/components/chart/engine/ast/interpret.js` was committed doubly-converted
while its parent blob was pure LF. Nothing failed: JS tolerates CR, every suite
stayed green, and the conformance corpus agreed to 1e-9. The damage was to
history and to merging — `git blame` attributed all 2048 lines to the feature
commit, and any other lane's edit of that file would have been a whole-file
conflict on a branch seven lanes share. A code reviewer found it by reading the
diff stat, which is not a mechanism anyone should have to rely on.

⚠️ THIS BOX HAS `core.autocrlf=true` AND NO `text` ATTRIBUTE COVERS `*.js`, so git
decides text-vs-binary by sniffing each blob. That is exactly the condition
`.gitattributes`'s own header warns about for fonts, and it is why the index —
what actually gets committed — is the thing to assert on, rather than the working
tree, which is *supposed* to hold CRLF on Windows.
"""
from __future__ import annotations

import subprocess

# `git ls-files --eol` prints one row per tracked path: `i/<eol> w/<eol> attr/<a>`.
# `i/` is the INDEX — the bytes a commit would store. `lf` is the only acceptable
# value for text; `none` (no line endings at all) and `-text` (sniffed binary) are
# fine and are not text files in the sense meant here.
_OK_INDEX_EOL = frozenset({"i/lf", "i/none", "i/-text"})

# ⭐ A path `.gitattributes` DECLARES `-text` (`attr/-text`; `binary` expands to it) is
# not a text file in that sense either, and is exempt whatever its `i/` column says.
# ⚰️ This file said so from the start ("`-text` (declared binary in .gitattributes)
# are fine") but tested only the `i/` column, where a declared-`-text` blob reports
# its endings (`i/crlf`), never `-text`. Two deliberate policies are such paths:
# SD-1 S1 (7073a66b02, 2026-09-15) declares every blob ALREADY STORED with CR `-text`
# so nothing flattens it into a whole-file diff (its own rail is
# tests/test_gitattributes_eol.py), and Wave P5 freezes
# `tools/wave_p_cert_corpus/manifest.json` as bytes. The first full backend run
# (PR #1855) found this rail red on exactly those.
_DECLARED_NOT_TEXT = "attr/-text"

# Scanning the whole repo costs ~1s, so there is no reason to sample.
_ROOTS = ("app/src", "api", "tests", "tools", "docs", "scripts")


def _rows() -> list[tuple[str, bool, str]]:
    """``(index eol, declared -text in .gitattributes, path)`` per tracked path."""
    out = subprocess.run(
        ["git", "ls-files", "--eol", "--", *_ROOTS],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    rows = []
    for line in out.splitlines():
        if not line.strip():
            continue
        # "i/lf    w/lf    attr/                \tpath/with spaces.js"
        fields, _, path = line.partition("\t")
        parts = fields.split()
        if parts:
            rows.append((parts[0], _DECLARED_NOT_TEXT in parts[1:], path.strip()))
    return rows


def _offenders(rows) -> list[str]:
    return sorted(p for eol, declared, p in rows if eol not in _OK_INDEX_EOL and not declared)


def test_CONTROL_only_a_DECLARED_minus_text_path_may_carry_cr():
    rows = [("i/crlf", False, "undeclared.js"), ("i/mixed", False, "undeclared.md"),
            ("i/crlf", True, "declared.js"), ("i/lf", False, "clean.py")]
    assert _offenders(rows) == ["undeclared.js", "undeclared.md"]


def test_no_tracked_text_file_is_staged_with_cr_line_endings():
    offenders = _offenders(_rows())
    assert not offenders, (
        "these tracked files would be committed with CR line endings, which makes "
        "`git blame` attribute the whole file to one commit and turns any "
        "concurrent edit into a whole-file conflict:\n  " + "\n  ".join(offenders)
    )


def test_the_census_actually_READ_the_repository():
    """⛔ The assertion above passes vacuously if `git ls-files` returns nothing —
    a wrong root, a `--` typo, a non-repo cwd. A census must assert the SIZE of
    what it read, not only its verdict."""
    rows = _rows()
    assert len(rows) > 3000, f"expected thousands of tracked files, read {len(rows)}"
    assert any(p.endswith(".js") for _, _d, p in rows), "no .js files were read at all"
    assert any(p.endswith(".py") for _, _d, p in rows), "no .py files were read at all"


def test_the_eol_vocabulary_this_rail_ACCEPTS_is_still_the_whole_vocabulary():
    """⚠️ Anti-rot. `_OK_INDEX_EOL` is an allow-list, so a git version that starts
    reporting a new shape would be silently accepted. Assert that every value git
    actually produces here is one this file has considered — the same reason the
    rail above asserts a size."""
    seen = {eol for eol, _d, _p in _rows()}
    unconsidered = seen - _OK_INDEX_EOL - {"i/crlf", "i/mixed"}
    assert not unconsidered, (
        f"git reported index EOL values this rail has never considered: {sorted(unconsidered)}. "
        "Decide whether each is acceptable and add it to _OK_INDEX_EOL, or leave it "
        "out so it fails — but do not let it pass unexamined."
    )
