"""W1 §10.5 Journal-exclusion grep, classified.

    python tools/wisdom/core_journal_exclusion_grep.py            # table + summary
    python tools/wisdom/core_journal_exclusion_grep.py --json
    python tools/wisdom/core_journal_exclusion_grep.py --strict   # exit 1 on a live journal-sense hit in code

The owner's check: grep the program paths and the manifest for journal, j2, notebook,
broker, fills, reconcil (case-insensitive substrings, exactly as a grep would) and confirm
there are zero live references outside the import-ban check and the ruling text.

Every hit is classified:
  ban-check       the rails and their own tests and docs, or a line carrying the
                  "journal-exclusion guard" marker (a runtime refusal of excluded data)
  ruling-text     a line that states the exclusion, the deferral or a ban: a docs/wisdom
                  line with a ruling word, or a Python docstring or comment-only line with one
  live-reference  anything else; a human reads these
tagged with its sense: "journal" when the line names journal / j2 / notebook / broker,
"other" when only fills / reconcil matched (Discord message reconciliation, content-stated
outcome reconciliation, a gap fill) or the only journal word is SQLite's journal_mode
pragma; and with its kind: "doc" under docs/ or in a .md/.txt file, "code" otherwise.

--strict fails only on a live-reference with journal sense in CODE: a plan paragraph that
names D16 is a human's to read, not a gate's to fail. A trailing comment does not make a
code line prose. A scope that matched fewer files than FLOOR, or missed a sentinel, is
INCONCLUSIVE (exit 2), never clean. The classification is a reading aid; the import rails in
api/services/wisdom/core/bans.py are the enforcement.

Standard library only. Reads files; writes nothing.
"""
from __future__ import annotations

import argparse
import ast
import io
import json
import pathlib
import re
import sys
import tokenize

REPO = pathlib.Path(__file__).resolve().parents[2]
TERMS = ("journal", "j2", "notebook", "broker", "fills", "reconcil")
TERM_RE = re.compile("|".join(re.escape(t) for t in TERMS), re.IGNORECASE)
JOURNAL_SENSE_RE = re.compile(r"journal|j2|notebook|broker", re.IGNORECASE)
#: SQLite's own vocabulary. PRAGMA journal_mode is the write-ahead log, not the Journal.
SQLITE_JOURNAL_RE = re.compile(r"journal_mode", re.IGNORECASE)
#: The MORNING WIRE's own ledger file, `morning-wire data/wire_journal` — a different
#: product's artifact that happens to share the word. It is named in `wire_inputs.py` in a
#: dict of PC-only sources Wisdom declares it does NOT read, so flagging it reports the
#: opposite of what is true. Same carve-out shape as journal_mode, and for the same reason.
#: ⛔ OCCURRENCE-scoped, never line-scoped: only these exact spellings are removed before
#: the sense test, so `wire_journal and the J2 journal` on one line still reads as journal.
FOREIGN_JOURNAL_RE = re.compile(r"wire_journal", re.IGNORECASE)
PROGRAM_GLOBS = (
    "api/services/wisdom/**/*",
    "api/routers/wisdom_*.py",
    "tools/wisdom/**/*",
    "tools/wisdom_*.py",
    "tests/test_wisdom_*.py",
    "app/src/pages/admin/wisdom/**/*",
    "docs/wisdom/**/*",
    ".github/workflows/wisdom-rails.yml",
)
TEXT_SUFFIXES = frozenset({".py", ".md", ".json", ".sql", ".yml", ".yaml", ".js", ".jsx", ".css", ".txt"})
DOC_SUFFIXES = frozenset({".md", ".txt"})
#: (minimum files scanned, files that MUST be among them). The manifest is in W1 §10.5's scope.
FLOOR = (30, ("docs/wisdom/PROGRAM-MANIFEST.md", "api/services/wisdom/registry.py"))
BAN_CHECK_PATHS = frozenset({
    "api/services/wisdom/core/bans.py",
    "tools/wisdom/core_check_bans.py",
    "tools/wisdom/core_journal_exclusion_grep.py",
    "tests/test_wisdom_bans.py",
    # Plants banned references on purpose to prove each guard can FAIL (owner ruling,
    # drift #5, 2026-09-13). Same category as test_wisdom_bans.py: its journal/J2 strings are
    # fixtures, not reaches. ⚠️ The exemption is on STRINGS only and it is a real (pre-existing)
    # residual — a genuine journal reach inside a file on this list would not be caught here.
    # The AST rails do not cover tests/ at all, so this list is the only thing looking.
    "tests/test_wisdom_guard_mutation.py",
    "docs/wisdom/methodology/rails-v1.md",
    ".github/workflows/wisdom-rails.yml",
})
BAN_CHECK_MARKER = "journal-exclusion guard"
RULING_MARKERS = re.compile(
    r"part 10|d16b|d16a|deferred|exclu|out of scope|never|\bban|forbid|off-limits|do not|must not"
    r"|refuse|not in scope|no journal|import-ban"
    # ⚰️ 2026-09-14: the three DECLARATIONS §0.4b requires a module to carry — "NOTHING HERE
    # READS JOURNAL / J2 / NOTEBOOK / BROKER DATA" — matched none of the markers above and were
    # reported as live references. The rail was flagging the sentence that states the ban.
    r"|nothing here reads|reads no|is read, matched", re.IGNORECASE)

#: A journal term that appears ONLY inside a quoted string, where THAT STRING also carries the
#: ruling marker, is a DECLARATION of the exclusion rather than a reach.
#: ⛔ The marker requirement is what keeps this honest, and it is not decoration: a string literal
#: can absolutely BE a reach — `sqlite3.connect("/data/j2.db")` is one, and it carries no ruling
#: marker, so it is still caught. Without the marker this would exempt every hard-coded path.
#: ⛔⛔ AND THE MARKER MUST BE INSIDE THE QUOTES, NOT ANYWHERE ON THE LINE. The first version of
#: this exemption searched the whole line, and a planted probe walked straight through it:
#:     open("/data/notebook.db")  # D16b deferred      -> classified ruling-text, exit 0
#: A genuine read, laundered by appending a comment. Caught only because the exemption was
#: mutation-tested against a deliberate laundering attempt rather than against the honest case
#: alone — `lesson_an_over_refusal_is_invisible`'s mirror image: an over-PERMISSION is invisible too.
_QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"")


def _is_quoted_declaration(line: str) -> bool:
    """Every journal term on this line sits inside a string that DECLARES the exclusion.

    Two conditions, and both are load-bearing — each was added only after a planted probe
    walked through the version without it:
      1. removing the quoted spans leaves no journal term (so the term is not in live code);
      2. EVERY quoted span carrying a term also carries the ruling marker ITSELF.

    ⛔ (2) is per-span, not per-line and not over the concatenation. Measured:
           open("/data/notebook.db"); _M = "D16b deferred"
       passes a whole-line check and passes a joined-spans check, and it is a real read with
       an alibi sitting next to it.
    """
    if sense_of(_QUOTED.sub("", line)) == "journal":
        return False
    spans = [s for s in _QUOTED.findall(line) if sense_of(s) == "journal"]
    return bool(spans) and all(RULING_MARKERS.search(s) and not _LOOKS_LIKE_A_TARGET.search(s)
                               for s in spans)


#: ⛔ A span that looks like a PATH, a module or a table is never a declaration, whatever words it
#: also contains. The probe that forced this was `open("/data/notebook.db D16b deferred")` — a real
#: read wearing the marker INSIDE its own argument. Contrived (that path would not open), and closed
#: anyway: an exemption is only as good as the most contrived thing that fits it.
_LOOKS_LIKE_A_TARGET = re.compile(r"[/\\]|\.db\b|\.sqlite|\bimport\b|^[\w.]+$")


def iter_files(root: pathlib.Path) -> list[pathlib.Path]:
    found: set[pathlib.Path] = set()
    for pattern in PROGRAM_GLOBS:
        found.update(root.glob(pattern))
    return sorted(p for p in found
                  if p.is_file() and p.suffix.lower() in TEXT_SUFFIXES and "__pycache__" not in p.parts)


def python_prose_lines(text: str) -> set[int]:
    """Line numbers that are a docstring or a comment-only line in Python source.

    Source that does not parse has no prose lines, so every hit in it stays live."""
    prose: set[int] = set()
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return prose
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)):
                prose.update(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    try:
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type == tokenize.COMMENT and not token.line[:token.start[1]].strip():
                prose.add(token.start[0])
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return prose


def kind_of(relpath: str) -> str:
    if relpath.startswith("docs/") or pathlib.PurePosixPath(relpath).suffix.lower() in DOC_SUFFIXES:
        return "doc"
    return "code"


def sense_of(line: str) -> str:
    stripped = FOREIGN_JOURNAL_RE.sub("", SQLITE_JOURNAL_RE.sub("", line))
    return "journal" if JOURNAL_SENSE_RE.search(stripped) else "other"


def classify(relpath: str, line: str, *, prose: bool = False) -> str:
    if relpath in BAN_CHECK_PATHS or BAN_CHECK_MARKER in line.lower():
        return "ban-check"
    if (relpath.startswith("docs/wisdom/") or prose) and RULING_MARKERS.search(line):
        return "ruling-text"
    # ⚰️ The weekly report is REQUIRED to carry the sentence `"D16b: deferred. No Journal, J2,
    # Notebook or broker-fill data is read…"` (W1 Part 10) — and that sentence lives in a dict
    # literal, so it is CODE, not prose, and the clause above could never reach it. The rail was
    # therefore red on the artifact the owner asked for, by construction.
    if _is_quoted_declaration(line):
        return "ruling-text"
    return "live-reference"


def grep(root: pathlib.Path = REPO, files: list[pathlib.Path] | None = None) -> list[dict]:
    hits = []
    for path in (iter_files(root) if files is None else files):
        rel = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        prose = python_prose_lines(text) if path.suffix.lower() == ".py" else set()
        for number, line in enumerate(text.split("\n"), start=1):
            terms = sorted({m.group(0).lower() for m in TERM_RE.finditer(line)})
            if not terms:
                continue
            hits.append({
                "path": rel,
                "line": number,
                "terms": terms,
                "class": classify(rel, line, prose=number in prose),
                "sense": sense_of(line),
                "kind": kind_of(rel),
                "excerpt": line.strip()[:160],
            })
    return hits


def floor_problem(root: pathlib.Path, files: list[pathlib.Path]) -> str | None:
    minimum, sentinels = FLOOR
    scanned = {p.relative_to(root).as_posix() for p in files}
    missing = [s for s in sentinels if s not in scanned]
    if len(files) < minimum or missing:
        return (f"scanned {len(files)} files (floor {minimum})"
                + (f"; missing sentinel {', '.join(missing)}" if missing else ""))
    return None


def _utf8_stdout() -> None:
    # The Windows console codec (cp1252) cannot print every character a doc line holds.
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", errors="replace")


def main(argv=None) -> int:
    _utf8_stdout()
    parser = argparse.ArgumentParser(description="W1 §10.5 Journal-exclusion grep, classified")
    parser.add_argument("--root", default=str(REPO))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 when any live-reference hit in code has journal sense")
    parser.add_argument("--no-floor", action="store_true", help="synthetic trees in tests only")
    args = parser.parse_args(argv)
    root = pathlib.Path(args.root).resolve()
    files = iter_files(root)
    hits = grep(root, files)
    inconclusive = None if args.no_floor else floor_problem(root, files)
    live_journal = [h for h in hits if h["class"] == "live-reference" and h["sense"] == "journal"]
    live_code = [h for h in live_journal if h["kind"] == "code"]
    counts: dict = {}
    for hit in hits:
        key = (hit["class"], hit["sense"])
        counts[key] = counts.get(key, 0) + 1
    if args.json:
        print(json.dumps({"terms": TERMS, "scope": PROGRAM_GLOBS, "files_scanned": len(files),
                          "inconclusive": inconclusive, "hits": hits,
                          "counts": {f"{c}/{s}": n for (c, s), n in sorted(counts.items())},
                          "live_journal_sense": len(live_journal),
                          "live_journal_sense_code": len(live_code)}, indent=2))
    else:
        print(f"W1 §10.5 Journal-exclusion grep @ {root}")
        print(f"terms: {', '.join(TERMS)} (case-insensitive substrings)")
        print(f"scope: {', '.join(PROGRAM_GLOBS)}")
        for hit in hits:
            print(f"{hit['class']:<15} {hit['sense']:<8} {hit['kind']:<5} {hit['path']}:{hit['line']} "
                  f"[{','.join(hit['terms'])}] {hit['excerpt']}")
        print(f"files scanned: {len(files)}")
        print(f"hits: {len(hits)} in {len({h['path'] for h in hits})} files")
        for (klass, sense), number in sorted(counts.items()):
            print(f"  {klass}/{sense}: {number}")
        print(f"live-reference with journal sense: {len(live_journal)} "
              f"(code: {len(live_code)}, doc: {len(live_journal) - len(live_code)})")
        if inconclusive:
            print(f"INCONCLUSIVE: {inconclusive}")
    if args.strict and live_code:
        return 1
    return 2 if inconclusive else 0


if __name__ == "__main__":
    sys.exit(main())
