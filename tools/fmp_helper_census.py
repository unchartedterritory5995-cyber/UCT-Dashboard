"""TERM-072 (FB-A3-01) -- the private-FMP-helper census, with a ratchet that only shrinks.

WHAT IT COUNTS. The two FMP reaches the other FMP rails cannot see, per file,
by AST over `api/` (test files excluded):

  legacy_helper      any reach to `earnings_estimates._fmp_get` -- the one
                     surviving private FMP GET helper of the six TERM-072 named.
                     A call, an attribute load (`ee._fmp_get`), a bare name
                     (`ex.submit(_fmp_get, ...)`), an import of the name, or a
                     string literal equal to it in CODE (`getattr(ee, "_fmp_get")`).
  private_transport  a reach into `fmp_client`'s private transport from outside
                     the adapter: any `_`-prefixed module-level name of
                     `api/services/fmp_client.py` (DERIVED from that file's AST,
                     never typed -- `_get_raw`, `_fetch`, `_session`, `_BASE_URL`,
                     ...), read through a name bound to the fmp_client module or
                     imported from it. This is how a new helper would build an FMP
                     request with no hostname literal at all -- the shape TERM-022
                     measured on the Massive side (`massive._REST_BASE +
                     client._api_key`), which a literal-only census reads as clean.

WHY A THIRD FMP RAIL. The two that exist look at literals and names:
`tools/vendor_callsite_census.py` counts FMP hostname and credential literals
and `_fmp_get*`-shaped DEFS; `tools/fmp_guard_census.py` quarantines by file.
Neither sees the dominant reach this ticket is about -- the shared helper
called THROUGH AN IMPORT -- which is why `docs/d1-implementation-log.md` had to
re-count its consumers by hand three times (9, then 11, then 21 modules).
Together the three answer "can a new module reach FMP except through the
adapter?"; this one covers the half the other two are blind to by construction.

PROSE NEVER COUNTS. Comments are not in the AST; a docstring is a string
statement and is skipped (the same `_prose_nodes` rule the vendor census uses,
imported, not copied). Only a string literal in an expression position counts.

THE RATCHET. `REMAINING` below is the whole allowed set, per file, each with the
reason it cannot move yet. `tests/test_fmp_helper_census.py` requires the census
to EQUAL it: growth or a new file is red by name; a shrink is red as slack until
the entry is lowered here. A count may only go down. The adapter file and the
helper's own definition site are the only places these names may appear freely.
"""
from __future__ import annotations

import ast
import os
import sys
from dataclasses import dataclass
from typing import Iterable

if __package__ in (None, ""):  # pragma: no cover - run as a script
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.vendor_callsite_census import _is_test_file, _iter_py_files, _prose_nodes  # noqa: E402

DEFAULT_ROOTS = ("api",)
ADAPTER_FILE = "api/services/fmp_client.py"
ADAPTER_MODULE = "api.services.fmp_client"
HELPER_NAME = "_fmp_get"
HELPER_FILE = "api/services/earnings_estimates.py"

#: The allowed remainder, per file: (reaches, why it has not moved). SHRINK ONLY.
#:
#: ⚠️ Four of these stay for the SAME reason, and it is a number nobody in this
#: repo has read: `fmp_client`'s token bucket is GLOBAL, per process, and defaults
#: to 120 requests/minute (`FMP_RATE_LIMIT_PER_MIN`, spec §9.4's open item). The
#: legacy helper has no bucket at all. A caller that fires an unpaced burst of the
#: same order as the bucket would, once migrated, get a LOCAL `rate_limited` denial
#: where the legacy helper made the call -- a different answer from the same FMP
#: -- and would drain the budget every member-request caller shares (the G5
#: sizing's "a busy backfill starves an unrelated caller"). Unblock: read the
#: variable on the service that runs each sweep; if the burst fits, migrate.
REMAINING: dict[str, tuple[int, str]] = {
    "api/services/bars_sanitize.py": (3,
        "bars-api territory, excluded from migration BY OWNER RULING (G1, "
        "2026-09-12; tests/test_fmp_timeout_pinning.py OWNER_RESERVED)."),
    "api/services/implied_backfill.py": (1,
        "options hot path, excluded by standing directive (d1-implementation-log "
        "'Exclusions and standing directives'). Also the 739-symbol backfill sweep."),
    "api/routers/research.py": (2,
        "`/api/research/news/{sym}` is pinned byte-for-byte as the COMPATIBILITY "
        "BRIDGE for the calendar modal's NewsSection.jsx (its own docstring). "
        "Import + the `ex.submit(_fmp_get, ...)` reference."),
    "api/services/fmp_bulk.py": (1,
        "`/stable/ratios-bulk` answers CSV and the adapter is JSON-only; non-JSON "
        "support is gap G3, DEFERRED by owner ruling 2026-09-12. No typed function "
        "exists, and one would be guaranteed-failing."),
    "api/services/earnings_history_fmp.py": (2,
        "BUCKET: `implied_backfill`'s sweep calls `fmp_beat_history` for up to 739 "
        "symbols at a measured 0.6-0.7 s each, two FMP calls per symbol -- ~180 "
        "requests/min against a 120/min default bucket. Migrating would turn the "
        "overflow into local denials that fall through to the 3 s-paced Finnhub leg."),
    "api/services/fmp_transcripts.py": (2,
        "BUCKET: `call_recap_warmer.submit_batch` fetches up to 60 names back to "
        "back with no pacing, two FMP calls per uncached name -- up to 120 requests "
        "in one burst, the whole default bucket."),
    "api/darkpool_eod.py": (1,
        "BUCKET: the EOD build enriches up to 3 bands x (top_n 10 + buffer 18) = 84 "
        "names with no pacing, and a denied profile is cached as blank sector/isEtf "
        "FOR THE DAY."),
    "api/services/screener/earnings_dates.py": (1,
        "BUCKET: the nightly batch fires 84 one-day `/stable/earnings-calendar` "
        "calls (`_TOTAL_DAYS`/`_CHUNK_DAYS`) with no pacing; a denied chunk silently "
        "costs that day's rows."),
}


@dataclass(frozen=True)
class Hit:
    path: str
    line: int
    kind: str
    detail: str

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}:{self.line} [{self.kind}] {self.detail}"


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def adapter_private_names(base: str) -> frozenset[str]:
    """Every `_`-prefixed module-level name `fmp_client.py` defines -- DERIVED, so
    a private added to the adapter tomorrow is guarded the day it lands."""
    with open(os.path.join(base, *ADAPTER_FILE.split("/")), "r", encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    out: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name):
                    out.add(t.id)
    return frozenset(n for n in out if n.startswith("_") and not n.startswith("__"))


def _adapter_aliases(tree: ast.AST, rel: str) -> tuple[set[str], dict[str, str]]:
    """(names bound to the fmp_client MODULE, {local name: private name} imported
    from it) for one file."""
    in_services = rel.startswith("api/services/") and rel.count("/") == 2
    modules: set[str] = set()
    imported: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == ADAPTER_MODULE and a.asname:
                    modules.add(a.asname)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if (node.level == 0 and mod == "api.services") or (node.level == 1 and not mod and in_services):
                for a in node.names:
                    if a.name == "fmp_client":
                        modules.add(a.asname or "fmp_client")
            elif (node.level == 0 and mod == ADAPTER_MODULE) or (node.level == 1 and mod == "fmp_client" and in_services):
                for a in node.names:
                    imported[a.asname or a.name] = a.name
    return modules, imported


def _file_hits(tree: ast.AST, rel: str, privates: frozenset[str]) -> list[Hit]:
    hits: list[Hit] = []
    if rel == ADAPTER_FILE:
        return hits

    # ── legacy_helper ─────────────────────────────────────────────────────
    prose = _prose_nodes(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == HELPER_NAME:
            hits.append(Hit(rel, node.lineno, "legacy_helper", f".{HELPER_NAME}"))
        elif isinstance(node, ast.Name) and node.id == HELPER_NAME:
            hits.append(Hit(rel, node.lineno, "legacy_helper", HELPER_NAME))
        elif isinstance(node, ast.ImportFrom):
            for a in node.names:
                if a.name == HELPER_NAME:
                    hits.append(Hit(rel, node.lineno, "legacy_helper", f"import {HELPER_NAME}"))
        elif (isinstance(node, ast.Constant) and node.value == HELPER_NAME
              and id(node) not in prose):
            hits.append(Hit(rel, node.lineno, "legacy_helper", f"'{HELPER_NAME}'"))

    # ── private_transport ─────────────────────────────────────────────────
    modules, imported = _adapter_aliases(tree, rel)
    for local, real in imported.items():
        if real in privates:
            for node in ast.walk(tree):
                if isinstance(node, ast.Name) and node.id == local and isinstance(node.ctx, ast.Load):
                    hits.append(Hit(rel, node.lineno, "private_transport", real))
    if modules:
        for node in ast.walk(tree):
            if (isinstance(node, ast.Attribute) and node.attr in privates
                    and isinstance(node.value, ast.Name) and node.value.id in modules):
                hits.append(Hit(rel, node.lineno, "private_transport", node.attr))
    return hits


def census(base: str, roots: Iterable[str] = DEFAULT_ROOTS) -> list[Hit]:
    """Every private-FMP-helper reach under `roots`, sorted. The helper's own
    `def` line is not a reach (a FunctionDef name is not a Name node)."""
    privates = adapter_private_names(base)
    out: list[Hit] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            if _is_test_file(path):
                continue
            rel = os.path.relpath(path, base).replace("\\", "/")
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    tree = ast.parse(fh.read(), filename=path)
            except (OSError, SyntaxError, ValueError):
                continue
            out.extend(_file_hits(tree, rel, privates))
    out.sort(key=lambda h: (h.path, h.line, h.kind, h.detail))
    return out


def counts(hits: Iterable[Hit]) -> dict[str, int]:
    out: dict[str, int] = {}
    for h in hits:
        out[h.path] = out.get(h.path, 0) + 1
    return dict(sorted(out.items()))


Delta = tuple[str, int, int]  # (file, allowed, now)


def compare(now: dict[str, int], allowed: dict[str, int]) -> tuple[list[Delta], list[Delta], list[Delta]]:
    """(grew, new, slack) -- `new` is a file absent from the allowance, `slack`
    a count below it (including a file that dropped to zero)."""
    grew: list[Delta] = []
    new: list[Delta] = []
    slack: list[Delta] = []
    for path in sorted(set(now) | set(allowed)):
        n, a = now.get(path, 0), allowed.get(path, 0)
        if a == 0 and n > 0:
            new.append((path, 0, n))
        elif n > a:
            grew.append((path, a, n))
        elif n < a:
            slack.append((path, a, n))
    return grew, new, slack


def allowed_counts() -> dict[str, int]:
    return {p: n for p, (n, _why) in REMAINING.items()}


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - operator entry
    base = repo_root()
    hits = census(base)
    now = counts(hits)
    print(f"PRIVATE-FMP-HELPER reaches under api/ outside {ADAPTER_FILE}: "
          f"{sum(now.values())} in {len(now)} files")
    for h in hits:
        print(f"  {h}")
    grew, new, slack = compare(now, allowed_counts())
    print(f"\nratchet: grew={grew} new={new} slack={slack}")
    return 1 if (grew or new or slack) else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
