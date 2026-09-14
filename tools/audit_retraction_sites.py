"""Where does a retracted finding still stand? Enumerate, never estimate.

⛔⛔ **RETRACTIONS PROPAGATE BY DERIVATION.** A finding is withdrawn in the document that
filed it and goes on being true everywhere else it was ever repeated. This walks both
worktrees and prints every site that cites a retracted finding by ID, or repeats its
CLAIM without naming it — the second class being the one a grep for the ID misses
entirely.

⛔ **SCOPE ENUMERATION BEFORE SCOPE OBEDIENCE (F-B-1).** The roots are printed with their
file counts BEFORE any match is reported. A run told to search two worktrees that finds
one is a broken run, and it must look different from a clean one.

⛔ **CODE, NEVER PROSE.** In a source file, comments and docstrings are stripped before
matching. A retraction's own explanatory comment is not a live claim — `tools/
sql_resolves.py` opens with a paragraph about F-OI21-1 precisely because it exists to
prevent it, and counting that as an un-retracted site would be the instrument reporting
a property of itself. Markdown is prose by nature and is matched whole.

Exit 0 = measured · 2 = UNREADABLE (a root missing, or a positive control that did not fire)
"""
from __future__ import annotations

import argparse
import ast
import pathlib
import re
import sys

OK, FAIL, UNREADABLE_EXIT = 0, 1, 2

#: Declared, so widening it is a reviewable act.
ABSENCE = re.compile(
    r"\b(do(?:es)?\s+not\s+exist|absent|missing|phantom|no\s+such\s+table|cannot\s+be\s+run)\b",
    re.I)

CODE_SUFFIXES = {".py", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv",
             "coverage", ".vite"}


def strip_code_comments(text: str, suffix: str) -> str:
    """Blank out comments and docstrings, keeping line numbers intact."""
    lines = text.splitlines()
    if suffix == ".py":
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return text
        doc_spans = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                                 ast.ClassDef)):
                body = getattr(node, "body", None)
                if (body and isinstance(body[0], ast.Expr)
                        and isinstance(body[0].value, ast.Constant)
                        and isinstance(body[0].value.value, str)):
                    c = body[0].value
                    doc_spans.append((c.lineno, getattr(c, "end_lineno", c.lineno)))
        for lo, hi in doc_spans:
            for i in range(lo - 1, min(hi, len(lines))):
                lines[i] = ""
        out = []
        for ln in lines:
            hash_at = ln.find("#")
            # crude but conservative: only strip a # that is not inside a quote
            if hash_at >= 0 and ln.count("'", 0, hash_at) % 2 == 0 \
                    and ln.count('"', 0, hash_at) % 2 == 0:
                ln = ln[:hash_at]
            out.append(ln)
        return "\n".join(out)
    # JS family
    text = re.sub(r"/\*[\s\S]*?\*/", lambda m: "\n" * m.group(0).count("\n"), text)
    out = []
    for ln in text.splitlines():
        at = ln.find("//")
        if at >= 0 and ln.count("'", 0, at) % 2 == 0 and ln.count('"', 0, at) % 2 == 0:
            ln = ln[:at]
        out.append(ln)
    return "\n".join(out)


#: ⚰️ THIS FILE IS ITSELF A SITE, AND v1 REPORTED IT AS ONE. Its `--id` default is the
#: literal `F-OI21-1`, so the auditor found its own argument parser and counted it beside
#: the real citations — an instrument reporting a property of ITSELF as a property of the
#: repo. Skipped by identity (resolved path), and the skip is PRINTED, never silent.
_SELF = pathlib.Path(__file__).resolve()
_SKIPPED_SELF: list = []


def walk(root: pathlib.Path):
    """A FILE argument is scanned as itself. ⚰️ v1 took directories only, so a run told
    to search the briefing and both CLAUDE.md files searched none of them — they sit at
    a worktree ROOT, outside every docs/ tools/ tests/ subtree. The told-vs-found line
    said 7 of 7 and was correct about directories and silent about the rest."""
    if root.is_file():
        if root.resolve() != _SELF:
            yield root
        else:
            _SKIPPED_SELF.append(str(root))
        return
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in CODE_SUFFIXES or p.suffix.lower() in {".md", ".json", ".txt"}:
            if p.resolve() == _SELF:
                _SKIPPED_SELF.append(str(p))
                continue
            yield p


def sites(roots, finding_id: str, claim_terms) -> tuple[list, dict]:
    id_re = re.compile(re.escape(finding_id))
    term_res = [re.compile(r"\b" + re.escape(t) + r"\b") for t in claim_terms]
    found, counts = [], {"scanned": 0, "unreadable": 0}
    for root in roots:
        for p in walk(root):
            try:
                raw = p.read_text(encoding="utf-8", errors="strict")
            except Exception:                            # noqa: BLE001
                counts["unreadable"] += 1
                continue
            counts["scanned"] += 1
            body = (strip_code_comments(raw, p.suffix.lower())
                    if p.suffix.lower() in CODE_SUFFIXES else raw)
            for n, line in enumerate(body.splitlines(), 1):
                kind = None
                if id_re.search(line):
                    kind = "BY-ID"
                elif any(r.search(line) for r in term_res) and ABSENCE.search(line):
                    kind = "BY-CLAIM"
                if kind:
                    found.append({"file": str(p).replace(chr(92), "/"), "line": n,
                                  "kind": kind, "text": " ".join(line.split())[:150]})
    return found, counts


def _self_check() -> int:
    """⛔ clean / dirty / empty, before the repo."""
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-56s -> %-8s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    import tempfile
    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        (d / "clean.md").write_text("Everything here is fine and cites nothing.\n",
                                    encoding="utf-8")
        (d / "dirty_id.md").write_text("As recorded in F-XX-9 the table was dropped.\n",
                                       encoding="utf-8")
        (d / "dirty_claim.md").write_text("The table `zzz_log` does not exist anywhere.\n",
                                          encoding="utf-8")
        (d / "code.py").write_text(
            '"""F-XX-9 in a docstring is an explanation, not a claim."""\n'
            "VALUE = 1  # F-XX-9 in a comment is not a claim either\n"
            'NOTE = "F-XX-9 in a string IS a site"\n', encoding="utf-8")
        rows, counts = sites([d], "F-XX-9", ["zzz_log"])
        by = {r["file"].rsplit("/", 1)[-1] for r in rows}
        show("CLEAN fixture yields no site", "clean.md" in by, False)
        show("DIRTY fixture, cited BY ID", "dirty_id.md" in by, True)
        show("DIRTY fixture, claim repeated WITHOUT the id", "dirty_claim.md" in by, True)
        show("CODE: docstring and comment are NOT sites", len(
            [r for r in rows if r["file"].endswith("code.py")]), 1)
        show("CODE: the surviving site is the string literal",
             [r["line"] for r in rows if r["file"].endswith("code.py")], [3])
        show("non-vacuity: files scanned", counts["scanned"], 4)

        # a FILE target, the case v1 could not see at all
        rows2, counts2 = sites([d / "dirty_id.md"], "F-XX-9", ["zzz_log"])
        show("a FILE target is scanned as itself", (len(rows2), counts2["scanned"]), (1, 1))

        # the instrument's own file is skipped, and the skip is recorded
        _SKIPPED_SELF.clear()
        rows3, counts3 = sites([_SELF], "F-OI21-1", ["zzz_log"])
        show("THIS instrument's own file is not a site",
             (len(rows3), len(_SKIPPED_SELF)), (0, 1))
        _SKIPPED_SELF.clear()

    with tempfile.TemporaryDirectory() as td:
        rows, counts = sites([pathlib.Path(td)], "F-XX-9", ["zzz_log"])
        show("EMPTY input: zero files", (len(rows), counts["scanned"]), (0, 0))

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--id", default="F-OI21-1")
    ap.add_argument("--terms", nargs="*",
                    default=["calendar_alerts_fired", "ai_search_log"])
    ap.add_argument("--control", default="",
                    help="a path the search MUST hit, or the run is UNREADABLE")
    ap.add_argument("roots", nargs="*")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()

    roots = []
    print("[retraction] TOLD %d target(s):" % len(a.roots))
    for r in a.roots:
        p = pathlib.Path(r)
        exists = p.is_dir() or p.is_file()
        n = sum(1 for _ in walk(p)) if exists else 0
        print("   %-58s %-9s files=%d"
              % (r, ("DIR" if p.is_dir() else "FILE") if exists else "⛔ MISSING", n))
        if exists:
            roots.append(p)
    print("[retraction] FOUND %d of %d target(s)%s"
          % (len(roots), len(a.roots),
             "" if len(roots) == len(a.roots) else "   ⛔ DELTA != 0"))
    if not roots:
        print("[retraction] ZERO readable roots — the derivation is broken, not the repo.")
        return UNREADABLE_EXIT

    rows, counts = sites(roots, a.id, a.terms)
    print("[retraction] files scanned: %d | unreadable: %d" % (counts["scanned"],
                                                               counts["unreadable"]))
    if _SKIPPED_SELF:
        print("[retraction] skipped THIS INSTRUMENT'S OWN FILE: %s" % _SKIPPED_SELF[0])
    if a.control:
        hit = any(a.control in r["file"] for r in rows)
        print("[retraction] POSITIVE CONTROL %s -> %s" % (a.control, "HIT" if hit else "⛔ MISS"))
        if not hit:
            print("[retraction] the control did not fire; every count below is unproven.")
            return UNREADABLE_EXIT

    by_kind = {}
    for r in rows:
        by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1
    for r in rows:
        print("%-9s %s:%d\n          %s" % (r["kind"], r["file"], r["line"], r["text"]))
    print("\n[retraction] sites: %d   %s"
          % (len(rows), " ".join("%s=%d" % kv for kv in sorted(by_kind.items()))))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
