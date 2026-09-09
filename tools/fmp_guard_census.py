"""AST census: every direct FMP call site outside `api/services/fmp_client.py`.

Per provider-abstraction-spec.md §21.1, generalizing `test_yf_guard_census.py`'s
own stated reasoning ("a count would pass on a swap... an AST, never a grep").
Simpler in shape than the yfinance census (no guard-wrapping/call-graph tracing
needed) because the spec's own rule for this one is a literal-detection rule,
not a "is this reach wrapped in the guard" rule:

WHAT COUNTS AS A VIOLATION
    (a) Any string literal (plain or inside an f-string) anywhere in the file
        that contains "financialmodelingprep.com" — this is how every known
        direct FMP call site in this codebase builds its URL (an f-string with
        the domain baked in), so a literal-content walk finds them all without
        needing to model which function is being called.
    (b) A function definition (any nesting level) whose name matches
        `_fmp_get` exactly or the `_fmp_get_*` shape — the ad-hoc-client
        naming pattern this build's migration retired one instance of at a
        time (insider.py's `_fmp_get_insider`, the now-restored
        `earnings_estimates._fmp_get`, etc.).

Both rules are scoped to OUTSIDE `api/services/fmp_client.py` — that file is
the one place a `financialmodelingprep.com` literal and an `_fmp_get`-shaped
name are supposed to exist.

QUARANTINE — a named, explicit, NOT-silent exemption list (§21.1's own
convention: "keep it empty if you possibly can", but real, tracked debt is
recorded here rather than left to silently fail the rail). Every entry cites
why it exists. Shrinks as future migration work lands; never grows silently —
`tests/test_fmp_guard_census.py` pins the exact entries and fails by name if
the list changes without a matching test update.
"""
from __future__ import annotations

import ast
import fnmatch
import os
from dataclasses import dataclass
from typing import Iterable

FMP_DOMAIN = "financialmodelingprep.com"
ADAPTER_FILE = "api/services/fmp_client.py"
FUNC_NAME_PATTERNS = ("_fmp_get", "_fmp_get_*")

DEFAULT_ROOTS = ("api",)
_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})

# ── QUARANTINE ────────────────────────────────────────────────────────────
# Every path here is real, tracked debt — recorded in
# docs/d1-implementation-log.md Section 1 (the 10 files the D1 spec's own
# pass didn't name) and Section 1's addendum (the 9 external consumers of
# earnings_estimates._fmp_get, of which this file-literal rule only catches
# the files that construct their OWN financialmodelingprep.com URL — the
# import-only consumers are invisible to rule (a) by construction and are
# NOT listed here, since there is nothing for this specific rule to exempt).
QUARANTINE: dict[str, str] = {
    "api/routers/calendar.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/routers/earnings.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/bars_fetch.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/calendar_alerts.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/catalyst/sources.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/econ_calendar_fmp.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/implied_store.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/index_constituents.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/screener/fundamentals_bulk.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/ticker_logos.py": "10-file addendum — not part of this build's originally-scoped 6 call sites",
    "api/services/engine.py": "2 remaining inline FMP news calls (/stable/news/*) — out of this build's originally-scoped 2 call sites in this file",
    "api/services/earnings_estimates.py": "_fmp_get itself: kept byte-for-byte, load-bearing for 9 external consumers outside this build's authorized migration scope (see Section 1 addendum)",
}


def _is_test_file(path: str) -> bool:
    base = os.path.basename(path)
    return base.startswith("test_") or base.endswith("_test.py")


@dataclass(frozen=True)
class UrlLiteralHit:
    path: str
    line: int
    col: int
    snippet: str

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}:{self.line}:{self.col} {self.snippet}"


@dataclass(frozen=True)
class HelperDefHit:
    path: str
    line: int
    name: str

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}:{self.line} def {self.name}"


def _iter_py_files(root: str, base: str) -> Iterable[str]:
    abs_root = os.path.join(base, root)
    for dirpath, dirnames, filenames in os.walk(abs_root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def _rel(path: str, base: str) -> str:
    return os.path.relpath(path, base).replace("\\", "/")


def _parse(path: str):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
        return ast.parse(src, filename=path), src.splitlines()
    except (OSError, SyntaxError):
        return None, []


def _joined_str_contains(node: ast.JoinedStr, needle: str) -> bool:
    for value in node.values:
        if isinstance(value, ast.Constant) and isinstance(value.value, str) and needle in value.value:
            return True
    return False


def _snippet(lines: list[str], lineno: int, col: int, width: int = 100) -> str:
    if 1 <= lineno <= len(lines):
        text = lines[lineno - 1].strip()
        return text[:width]
    return ""


def _url_literal_hits(tree: ast.AST, rel: str, lines: list[str]) -> list[UrlLiteralHit]:
    """One hit per literal occurrence — NOT one per AST node. `ast.walk`
    recurses into a `JoinedStr`'s own `.values`, so a plain f-string's
    literal segment is visited twice (once as the `JoinedStr` itself, once
    as the child `Constant`) unless the child is explicitly skipped;
    without this a single planted f-string reported 2 hits instead of 1."""
    joined_str_children: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            joined_str_children.update(id(v) for v in node.values)

    out: list[UrlLiteralHit] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            if _joined_str_contains(node, FMP_DOMAIN):
                out.append(UrlLiteralHit(rel, node.lineno, node.col_offset, _snippet(lines, node.lineno, node.col_offset)))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and FMP_DOMAIN in node.value:
            if id(node) in joined_str_children:
                continue  # already counted via its parent JoinedStr above
            out.append(UrlLiteralHit(rel, node.lineno, node.col_offset, _snippet(lines, node.lineno, node.col_offset)))
    return out


def _helper_def_hits(tree: ast.AST, rel: str) -> list[HelperDefHit]:
    out: list[HelperDefHit] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if any(fnmatch.fnmatchcase(node.name, pat) for pat in FUNC_NAME_PATTERNS):
                out.append(HelperDefHit(rel, node.lineno, node.name))
    return out


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def census(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
           include_tests: bool = False) -> tuple[list[UrlLiteralHit], list[HelperDefHit]]:
    """(url_literal_hits, helper_def_hits) for every file under `roots`
    OUTSIDE `fmp_client.py`, EXCLUDING files in QUARANTINE. Sorted by
    path then line."""
    url_hits: list[UrlLiteralHit] = []
    def_hits: list[HelperDefHit] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            rel = _rel(path, base)
            if rel == ADAPTER_FILE or rel in QUARANTINE:
                continue
            if not include_tests and _is_test_file(path):
                continue
            tree, lines = _parse(path)
            if tree is None:
                continue
            url_hits.extend(_url_literal_hits(tree, rel, lines))
            def_hits.extend(_helper_def_hits(tree, rel))
    url_hits.sort(key=lambda h: (h.path, h.line, h.col))
    def_hits.sort(key=lambda h: (h.path, h.line))
    return url_hits, def_hits


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import sys

    base = repo_root()
    urls, defs = census(base)
    print(f"UNQUARANTINED financialmodelingprep.com literals outside {ADAPTER_FILE}: {len(urls)}")
    for h in urls:
        print(f"    {h}")
    print()
    print(f"UNQUARANTINED _fmp_get-shaped function definitions outside {ADAPTER_FILE}: {len(defs)}")
    for h in defs:
        print(f"    {h}")
    print()
    print(f"QUARANTINE ({len(QUARANTINE)} entries):")
    for path, why in QUARANTINE.items():
        print(f"    {path} — {why}")

    sys.exit(1 if (urls or defs) else 0)
