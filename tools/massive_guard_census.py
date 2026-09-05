"""AST census: every direct Massive/Polygon call site outside
`api/services/massive.py`.

Per provider-abstraction-spec.md §21.1, same shape as `fmp_guard_census.py` —
a literal-string walk, not a guard-region trace (see that module's docstring
for the full reasoning).

WHAT COUNTS AS A VIOLATION
    Any string literal (plain or inside an f-string) anywhere in a file,
    OUTSIDE `api/services/massive.py`, that contains "api.massive.com".

PARTNER_EXEMPT vs QUARANTINE — two distinct categories, per §21.1's explicit
instruction ("an explicit, by-name exemption for the two partner-owned
files... not a silent skip"):
  - `PARTNER_EXEMPT`: `massive_ws_worker.py` / `massive_processor.py` —
    partner-owned (Ravi co-edits these; do not touch without ack, per this
    program's own standing collaboration rule). PERMANENT, not migration
    debt — these are never expected to shrink to zero.
  - `QUARANTINE`: every other non-adapter file that still constructs a
    Massive URL directly. Real, TEMPORARY, tracked debt — this build's
    approved narrow slice (spec §10.2) migrated exactly one capability
    (`live_prices.py::_fetch_snapshots`, onto the new `get_batch_quotes`);
    every other direct call site in every one of these files, INCLUDING
    `live_prices.py`'s own two remaining ones (`_grouped_closes`,
    `_fetch_extended_volume` — genuinely different capabilities, not
    migrated this pass), is real debt for a future migration slice, not
    silently exempted or silently expanded into this pass's scope.
"""
from __future__ import annotations

import ast
import os
from dataclasses import dataclass
from typing import Iterable

MASSIVE_DOMAIN = "api.massive.com"
ADAPTER_FILE = "api/services/massive.py"

DEFAULT_ROOTS = ("api",)
_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})

# ── Partner-owned — permanent exemption, not debt ───────────────────────────
# `project_partner_collab_branch`: Ravi co-edits these; don't touch without
# ack. Cited here BY NAME, not silently skipped, per §21.1's explicit
# instruction and GOVERNING_PRINCIPLES.md §5's partner-file boundary.
PARTNER_EXEMPT: dict[str, str] = {
    "api/massive_ws_worker.py": "partner-owned (Ravi) — GOVERNING_PRINCIPLES.md §5",
    "api/massive_processor.py": "partner-owned (Ravi) — GOVERNING_PRINCIPLES.md §5",
}

# ── QUARANTINE — real, tracked, temporary migration debt ────────────────────
# The D1 authorization's approved narrow slice (spec §10.2) migrated exactly
# ONE capability this pass (live_prices.py::_fetch_snapshots, onto the new
# get_batch_quotes). Every direct call site below — including live_prices.py's
# OWN remaining two — is real debt for a future, separately-authorized
# migration slice. Recorded in docs/d1-implementation-log.md.
QUARANTINE: dict[str, str] = {
    "api/backfill_rest.py": "not part of this build's approved narrow slice (spec §10.2: live_prices.py + etf_holdings.py only)",
    "api/darkpool_massive_ingest.py": "not part of this build's approved narrow slice",
    "api/flow_rest_backfill.py": "not part of this build's approved narrow slice",
    "api/massive_oi_snapshots.py": "not part of this build's approved narrow slice",
    "api/oi_massive_snapshots.py": "not part of this build's approved narrow slice",
    "api/oi_morning.py": "not part of this build's approved narrow slice",
    "api/oi_snapshot_router.py": "not part of this build's approved narrow slice",
    "api/routers/live_prices.py": "_grouped_closes (grouped-daily-close) and _fetch_extended_volume (minute-range aggregates) are distinct, unvalidated capabilities not migrated this pass — only _fetch_snapshots (now get_batch_quotes) was",
    "api/services/audit.py": "not part of this build's approved narrow slice",
    "api/services/breadth_dividends.py": "not part of this build's approved narrow slice",
    "api/services/etf_holdings.py": "spec §10.2's own second-named narrow-slice file — its one Massive call (etf_symbol_set, reference-tickers pagination) is a genuinely different, unvalidated capability; not migrated this pass to avoid inventing an unvalidated typed method under time pressure",
    "api/services/polygon_extras.py": "not part of this build's approved narrow slice",
    "api/services/polygon_news.py": "not part of this build's approved narrow slice",
    "api/services/polygon_options.py": "not part of this build's approved narrow slice",
    "api/services/trade_conditions.py": "not part of this build's approved narrow slice",
    "api/services/watchlist_prebuilt_refresh.py": "not part of this build's approved narrow slice",
    "api/ticker_types.py": "not part of this build's approved narrow slice",
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


def _snippet(lines: list[str], lineno: int, width: int = 100) -> str:
    if 1 <= lineno <= len(lines):
        return lines[lineno - 1].strip()[:width]
    return ""


def _url_literal_hits(tree: ast.AST, rel: str, lines: list[str]) -> list[UrlLiteralHit]:
    """One hit per literal occurrence, not per AST node — see
    fmp_guard_census.py's identical helper for why a JoinedStr's own
    Constant children must be skipped to avoid double-counting."""
    joined_str_children: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            joined_str_children.update(id(v) for v in node.values)

    out: list[UrlLiteralHit] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            if _joined_str_contains(node, MASSIVE_DOMAIN):
                out.append(UrlLiteralHit(rel, node.lineno, node.col_offset, _snippet(lines, node.lineno)))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and MASSIVE_DOMAIN in node.value:
            if id(node) in joined_str_children:
                continue
            out.append(UrlLiteralHit(rel, node.lineno, node.col_offset, _snippet(lines, node.lineno)))
    return out


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def census(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
           include_tests: bool = False) -> list[UrlLiteralHit]:
    """Every api.massive.com literal under `roots` OUTSIDE massive.py,
    EXCLUDING PARTNER_EXEMPT and QUARANTINE paths. Sorted by path then line."""
    exempt = set(PARTNER_EXEMPT) | set(QUARANTINE)
    out: list[UrlLiteralHit] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            rel = _rel(path, base)
            if rel == ADAPTER_FILE or rel in exempt:
                continue
            if not include_tests and _is_test_file(path):
                continue
            tree, lines = _parse(path)
            if tree is None:
                continue
            out.extend(_url_literal_hits(tree, rel, lines))
    out.sort(key=lambda h: (h.path, h.line, h.col))
    return out


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import sys

    base = repo_root()
    hits = census(base)
    print(f"UNEXEMPTED api.massive.com literals outside {ADAPTER_FILE}: {len(hits)}")
    for h in hits:
        print(f"    {h}")
    print()
    print(f"PARTNER_EXEMPT ({len(PARTNER_EXEMPT)} entries, permanent):")
    for path, why in PARTNER_EXEMPT.items():
        print(f"    {path} — {why}")
    print()
    print(f"QUARANTINE ({len(QUARANTINE)} entries, tracked migration debt):")
    for path, why in QUARANTINE.items():
        print(f"    {path} — {why}")

    sys.exit(1 if hits else 0)
