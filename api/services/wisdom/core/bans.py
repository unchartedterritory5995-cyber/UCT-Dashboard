"""The four Wisdom Loop ban rails (W1 §0.4a, §0.4b, §0.4d, §0.4i, Part 10; CONTRACTS §6.2).

STANDARD LIBRARY ONLY, AND NOTHING FROM api.*. The CI job installs nothing but pytest and
loads this file by path (tests/test_wisdom_bans.py, tools/wisdom/core_check_bans.py), so
an import of the product here would make every rail unrunnable exactly where it matters.

THE FOUR RAILS
  substack       No Wisdom module imports the Substack publisher or the Sunday Scans
                 publish/run/promo modules, or names the saved Substack login or a
                 Sunday Scans drafts path (W1 §0.4a).
  journal        No Wisdom module imports, queries or names Journal / J2 / Notebook /
                 broker-sync code, tables or paths (W1 Part 10; D16b is deferred).
  private_store  The owner-private store is importable only from its three owners;
                 every other module under api/ and tools/wisdom fails by name (§0.4d).
  offlimits      On a feat/wisdom-loop or wisdom/* branch, the diff against the merge
                 base with origin/master touches no off-limits path (§0.4i).

WHAT A SOURCE RAIL READS IS CODE, NEVER PROSE. Imports come from the AST, in every form
(absolute, relative, star, aliased, importlib.import_module, __import__). String checks
skip docstrings, and comments are not in the AST at all, so a banned name in a comment or
a docstring is not a violation. A file that does not parse is a violation: it cannot be
proven clean. A scan that saw fewer files than its floor is INCONCLUSIVE, never a pass.
"""
from __future__ import annotations

import ast
import fnmatch
import functools
import os
import pathlib
import re
import shutil
import subprocess
from typing import Iterable, Iterator, NamedTuple, Optional

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]

SOURCE_RAILS = ("substack", "journal", "private_store")
RAILS = SOURCE_RAILS + ("offlimits",)


class Violation(NamedTuple):
    rail: str
    path: str
    line: int
    detail: str

    def render(self) -> str:
        return f"[{self.rail}] {self.path}:{self.line}: {self.detail}"


class RailResult(NamedTuple):
    rail: str
    files_scanned: int
    violations: tuple
    skipped: Optional[str] = None
    inconclusive: Optional[str] = None


class GitError(RuntimeError):
    """A git invocation failed, so the diff rail can say nothing about this branch."""


# ── scopes ───────────────────────────────────────────────────────────────────

PROGRAM_SCOPE = ("api/services/wisdom/**", "api/routers/wisdom_*.py", "tools/wisdom/**", "tools/wisdom_*.py")
PRIVATE_STORE_SCOPE = ("api/**", "tools/wisdom/**", "tools/wisdom_*.py")
SCOPES = {"substack": PROGRAM_SCOPE, "journal": PROGRAM_SCOPE, "private_store": PRIVATE_STORE_SCOPE}

#: (minimum files, files that MUST be among those scanned). Below either, the scan is not a measurement.
SCOPE_FLOORS = {
    "substack": (30, ("api/services/wisdom/registry.py", "api/routers/wisdom_core.py",
                      "api/services/wisdom/core/bans.py")),
    "journal": (30, ("api/services/wisdom/registry.py", "api/routers/wisdom_core.py",
                     "api/services/wisdom/core/bans.py")),
    "private_store": (1000, ("api/main.py", "api/routers/wisdom_core.py",
                             "api/services/wisdom/core/private.py")),
}

#: The ban checks themselves must spell the banned names. Their IMPORTS are still checked;
#: only their string constants are exempt. This set is exact and asserted by a test.
BAN_CHECK_FILES = frozenset({
    "api/services/wisdom/core/bans.py",
    "tools/wisdom/core_check_bans.py",
    "tools/wisdom/core_journal_exclusion_grep.py",
})


def scope_files(root: pathlib.Path, patterns: Iterable[str]) -> list[pathlib.Path]:
    root = pathlib.Path(root)
    found: set[pathlib.Path] = set()
    for pattern in patterns:
        if pattern.endswith("/**"):
            base = root / pattern[:-3]
            if base.is_dir():
                found.update(base.rglob("*.py"))
        else:
            parent, glob = pattern.rsplit("/", 1)
            directory = root / parent
            if directory.is_dir():
                found.update(directory.glob(glob))
    return sorted(p for p in found if p.is_file() and "__pycache__" not in p.parts)


# ── rail substack (W1 §0.4a) ─────────────────────────────────────────────────

SUNDAY_SCAN_BANNED = frozenset({"publish", "run", "promo", "*"})
SUBSTACK_STRING_PATTERNS = (
    ("the saved Substack login (storage_state.json)", re.compile(r"storage_state\.json", re.IGNORECASE)),
    ("a Sunday Scans drafts path", re.compile(r"sunday[_-]?scans?[\\/]+drafts", re.IGNORECASE)),
)


def substack_import_violation(module: str) -> Optional[str]:
    parts = module.split(".")
    if parts[0] == "substack":
        return f"imports the Substack publisher ({module}); W1 §0.4a"
    for index, part in enumerate(parts[:-1]):
        if part == "sunday_scan" and parts[index + 1] in SUNDAY_SCAN_BANNED:
            return f"imports a Sunday Scans publish/run/promo module ({module}); W1 §0.4a"
    return None


# ── rail journal (W1 Part 10) ────────────────────────────────────────────────

JOURNAL_MODULE_PREFIXES = ("api.services.journal", "api.routers.journal")
JOURNAL_MODULES = ("api.routers.broker_sync", "api.routers.note_sync")
JOURNAL_SEGMENTS = frozenset({"notes_search"})
JOURNAL_STRING_PATTERNS = (
    ("a J2 table", re.compile(r"(?<![A-Za-z0-9])j2_[A-Za-z0-9_]+", re.IGNORECASE)),
    ("a Journal table", re.compile(
        r"(?<![A-Za-z0-9_])(?:journal_entries|trade_executions|journal_screenshots|daily_journals"
        r"|weekly_reviews|journal_resources)(?![A-Za-z0-9_])", re.IGNORECASE)),
    ("the journal-2-0 path", re.compile(r"journal-2-0", re.IGNORECASE)),
    ("a lib/offline path", re.compile(r"lib[\\/]+offline", re.IGNORECASE)),
    ("the J2/Journal API", re.compile(r"/api/(?:j2|journal)(?![A-Za-z0-9_])", re.IGNORECASE)),
)


def journal_import_violation(module: str) -> Optional[str]:
    if module.startswith(JOURNAL_MODULE_PREFIXES):
        return f"imports Journal/J2 code ({module}); W1 Part 10"
    if any(module == name or module.startswith(name + ".") for name in JOURNAL_MODULES):
        return f"imports broker or note sync ({module}); W1 Part 10"
    if JOURNAL_SEGMENTS & set(module.split(".")):
        return f"imports Notebook search ({module}); W1 Part 10"
    return None


# ── rail private_store (W1 §0.4d) ────────────────────────────────────────────

CORE_PACKAGE = "api.services.wisdom.core"
PRIVATE_MODULE = CORE_PACKAGE + ".private"
PRIVATE_ALLOWED_IMPORTERS = frozenset({
    "api/services/wisdom/core/private.py",
    "api/services/wisdom/extract/writer.py",
    "api/routers/wisdom_core.py",
})
#: S-B reviewer finding F3, 2026-09-13: this matched only the MODULE path, so the store stayed
#: reachable from any module by opening its FILE or naming its TABLE — neither of which is an
#: import, and neither of which this rail could see:
#:     sqlite3.connect(os.environ.get("WISDOM_PRIVATE_DB_PATH", "/data/wisdom_private.db"))
#:     SELECT value_enc FROM wisdom_private_positions
#: §0.4d is about REACH. Whether the bytes come back readable is a different question, and a
#: rail that only stops the readable route is not enforcing the rule.
PRIVATE_STRING_PATTERN = re.compile(
    r"wisdom[./\\]core[./\\]private(?![A-Za-z0-9_])"
    r"|WISDOM_PRIVATE_DB_PATH"
    r"|wisdom_private\.db"
    r"|wisdom_private_[A-Za-z0-9_]+",
    re.IGNORECASE)
_PRIVATE_DETAIL = ("reaches the owner-private store; only core/private.py, extract/writer.py "
                   "and api/routers/wisdom_core.py may (W1 §0.4d)")


# ── AST helpers ──────────────────────────────────────────────────────────────

def _package_of(relpath: str) -> list[str]:
    stem = relpath[:-3] if relpath.endswith(".py") else relpath
    return stem.split("/")[:-1]


def _resolve_from_base(node: ast.ImportFrom, package: list[str]) -> str:
    if not node.level:
        return node.module or ""
    keep = len(package) - (node.level - 1)
    parts = package[:keep] if keep > 0 else []
    if node.module:
        parts = parts + node.module.split(".")
    return ".".join(parts)


def _dynamic_import_target(node: ast.Call) -> Optional[str]:
    func = node.func
    name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
    if name not in ("__import__", "import_module") or not node.args:
        return None
    first = node.args[0]
    if not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
        return None
    target = first.value
    if not target.startswith("."):
        return target
    package = None
    for keyword in node.keywords:
        if keyword.arg == "package" and isinstance(keyword.value, ast.Constant) \
                and isinstance(keyword.value.value, str):
            package = keyword.value.value
    if package is None and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant) \
            and isinstance(node.args[1].value, str):
        package = node.args[1].value
    if package is None:
        return None
    level = len(target) - len(target.lstrip("."))
    package_parts = package.split(".")
    keep = len(package_parts) - (level - 1)
    rest = target.lstrip(".")
    parts = (package_parts[:keep] if keep > 0 else []) + (rest.split(".") if rest else [])
    return ".".join(parts)


def iter_imports(tree: ast.AST, relpath: str) -> Iterator[tuple[str, int]]:
    """Every module a file imports, as a dotted name, with its line."""
    package = _package_of(relpath)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name, node.lineno
        elif isinstance(node, ast.ImportFrom):
            base = _resolve_from_base(node, package)
            if base:
                yield base, node.lineno
            for alias in node.names:
                yield (f"{base}.{alias.name}" if base else alias.name), node.lineno
        elif isinstance(node, ast.Call):
            target = _dynamic_import_target(node)
            if target:
                yield target, node.lineno


def _docstring_node_ids(tree: ast.AST) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def iter_code_strings(tree: ast.AST) -> Iterator[tuple[str, int]]:
    """String constants that are code, not documentation."""
    docstrings = _docstring_node_ids(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            yield node.value, getattr(node, "lineno", 0)


def _private_attribute_lines(tree: ast.AST, relpath: str) -> list[int]:
    """`core.private` / getattr(core, "private") on a name bound to the core package."""
    package = _package_of(relpath)
    bound = {CORE_PACKAGE}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == CORE_PACKAGE and alias.asname:
                    bound.add(alias.asname)
        elif isinstance(node, ast.ImportFrom):
            base = _resolve_from_base(node, package)
            for alias in node.names:
                full = f"{base}.{alias.name}" if base else alias.name
                if full == CORE_PACKAGE:
                    bound.add(alias.asname or alias.name)
    lines: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == "private":
            if ast.unparse(node.value) in bound:
                lines.append(node.lineno)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "getattr" \
                and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant) \
                and node.args[1].value == "private" and ast.unparse(node.args[0]) in bound:
            lines.append(node.lineno)
    return lines


# ── source scanning ──────────────────────────────────────────────────────────

def scan_source(relpath: str, text: str, rails: Iterable[str] = SOURCE_RAILS) -> list[Violation]:
    """Pure: the violations one file's text commits under the given source rails."""
    relpath = relpath.replace("\\", "/")
    rails = tuple(r for r in rails if r in SOURCE_RAILS)
    try:
        tree = ast.parse(text, filename=relpath)
    except SyntaxError as exc:
        return [Violation(rail, relpath, exc.lineno or 0,
                          f"does not parse ({exc.msg}), so it cannot be proven clean") for rail in rails]
    found: set[Violation] = set()
    imports = list(iter_imports(tree, relpath))
    strings = [] if relpath in BAN_CHECK_FILES else list(iter_code_strings(tree))
    if "substack" in rails:
        for module, line in imports:
            why = substack_import_violation(module)
            if why:
                found.add(Violation("substack", relpath, line, why))
        for value, line in strings:
            for label, pattern in SUBSTACK_STRING_PATTERNS:
                if pattern.search(value):
                    found.add(Violation("substack", relpath, line, f"names {label}; W1 §0.4a"))
    if "journal" in rails:
        for module, line in imports:
            why = journal_import_violation(module)
            if why:
                found.add(Violation("journal", relpath, line, why))
        for value, line in strings:
            for label, pattern in JOURNAL_STRING_PATTERNS:
                if pattern.search(value):
                    found.add(Violation("journal", relpath, line, f"names {label}; W1 Part 10"))
    if "private_store" in rails and relpath not in PRIVATE_ALLOWED_IMPORTERS:
        for module, line in imports:
            if module == PRIVATE_MODULE or module.startswith(PRIVATE_MODULE + "."):
                found.add(Violation("private_store", relpath, line, f"imports {module}: {_PRIVATE_DETAIL}"))
        for line in _private_attribute_lines(tree, relpath):
            found.add(Violation("private_store", relpath, line, f"reads core.private: {_PRIVATE_DETAIL}"))
        for value, line in strings:
            if PRIVATE_STRING_PATTERN.search(value):
                found.add(Violation("private_store", relpath, line,
                                    f"names the private store by string: {_PRIVATE_DETAIL}"))
    return sorted(found, key=lambda v: (v.rail, v.path, v.line, v.detail))


def run_source_rail(rail: str, root: pathlib.Path = REPO_ROOT, *, enforce_floor: bool = True) -> RailResult:
    if rail not in SOURCE_RAILS:
        raise ValueError(f"not a source rail: {rail!r}")
    root = pathlib.Path(root)
    files = scope_files(root, SCOPES[rail])
    violations: list[Violation] = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            violations.append(Violation(rail, rel, 0,
                                        f"cannot be read ({type(exc).__name__}), so it cannot be proven clean"))
            continue
        # ⛔ casefold (F3): this fast path skipped any file whose only mention was the
        # UPPERCASE env var WISDOM_PRIVATE_DB_PATH, before a single check ran.
        if rail == "private_store" and "private" not in text.casefold():
            continue
        violations.extend(scan_source(rel, text, (rail,)))
    inconclusive = None
    if enforce_floor:
        floor, sentinels = SCOPE_FLOORS[rail]
        scanned = {p.relative_to(root).as_posix() for p in files}
        missing = [s for s in sentinels if s not in scanned]
        if len(files) < floor or missing:
            inconclusive = (f"scanned {len(files)} files against a floor of {floor}"
                            + (f"; required files not scanned: {missing}" if missing else ""))
    return RailResult(rail, len(files), tuple(violations), None, inconclusive)


# ── rail offlimits (W1 §0.4i) ────────────────────────────────────────────────

# ⛔ This list IS CONTRACTS §1 "Never edit". It enforced 8 of the ~20 paths named there until
# 2026-09-13 (S-B reviewer finding F2) — and its test parametrised over the same 8 the code
# already named, so it was a tautology that could never go red on an omission
# (`lesson_a_gate_list_drifts_like_any_other_artifact`). The missing entries included
# `api/routers/auth.py` and `api/services/auth_db.py` (§0 row 15 flags auth.py as carrying an
# unmerged edit elsewhere) and the flow-worker files, where a green rail over a watched file
# buys a PERMANENT OPRA tape gap. tests/test_wisdom_bans.py now DERIVES the expected set from
# CONTRACTS.md §1 and fails by name on the next path added there.
OFFLIMITS_PREFIXES = (
    "app/src/pages/journal-2-0/",
    "docs/discord-render/",
    "services/chart_renderer/",
    "api/services/alert_taxonomy/",
    "app/src/hub/",
)
OFFLIMITS_FILES = (
    "app/src/pages/BreadthCharts.jsx",
    "app/src/pages/breadth/PresetRow.jsx",
    "app/src/pages/breadth/MetricReadout.jsx",
    "app/src/components/tiles/CatalystTable.jsx",
    "api/services/data_sync.py",
    "api/services/llm_batch.py",
    "api/services/tweet_store.py",
    "api/services/zoom_client.py",
    "api/routers/auth.py",
    "api/services/auth_db.py",
    "docs/runbooks/deploy-windows.md",
)
#: CONTRACTS §1 writes this one as a glob.
OFFLIMITS_GLOBS = ("api/services/buzz_*.py",)
OFFLIMITS_BASENAMES = ("OptionsFlow.jsx",)
OFFLIMITS_ANYWHERE_DIR = "lib/offline/"


@functools.lru_cache(maxsize=1)
def flow_worker_watched() -> frozenset:
    """CONTRACTS §1: "every flow-worker watched file (header of api/flow_worker_main.py)".

    DERIVED from tools/flow_worker_watch_coverage.py, which already parses that header — a
    second hand-typed copy of this list is the defect F2 was. Returns empty if the tool
    cannot be read; `offlimits_rail_limitations()` reports that rather than letting an
    unreadable list pass as an empty one.
    """
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "_fw_watch", str(REPO_ROOT / "tools" / "flow_worker_watch_coverage.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return frozenset(str(p).replace("\\", "/") for p in module.watched_paths(str(REPO_ROOT)))
    except Exception:
        return frozenset()


def offlimits_rail_limitations() -> tuple:
    """What this rail knows it cannot see. An empty derived list must never read as 'clean'."""
    return () if flow_worker_watched() else (
        "the flow-worker watched list could not be derived from "
        "tools/flow_worker_watch_coverage.py, so a watched file is NOT covered by this run",)
PROGRAM_BRANCH_RE = re.compile(r"^(?:feat/wisdom-loop|wisdom/.+)$")
BASE_REFS = ("origin/master", "master", "origin/HEAD")


def offlimits_reason(path: str) -> Optional[str]:
    path = path.replace("\\", "/")
    if path.startswith("./"):
        path = path[2:]
    for prefix in OFFLIMITS_PREFIXES:
        if path.startswith(prefix):
            return f"touches off-limits path {prefix}"
    if path in OFFLIMITS_FILES:
        return f"touches off-limits file {path}"
    for pattern in OFFLIMITS_GLOBS:
        if fnmatch.fnmatch(path, pattern):
            return f"touches off-limits path {pattern}"
    if path in flow_worker_watched():
        return (f"touches flow-worker watched file {path} — a redeploy drops the Massive OPRA "
                f"socket and Massive does not replay: the tape gap is permanent until T+1")
    if path.rsplit("/", 1)[-1] in OFFLIMITS_BASENAMES:
        return f"touches off-limits file {path.rsplit('/', 1)[-1]}"
    if path.startswith(OFFLIMITS_ANYWHERE_DIR) or f"/{OFFLIMITS_ANYWHERE_DIR}" in path:
        return f"touches an off-limits {OFFLIMITS_ANYWHERE_DIR} directory"
    return None


def offlimits_violations(paths: Iterable[str]) -> list[Violation]:
    out = []
    for path in paths:
        reason = offlimits_reason(path)
        if reason:
            out.append(Violation("offlimits", path.replace("\\", "/"), 0, reason + "; W1 §0.4i"))
    return sorted(set(out))


def rail_applies_to_branch(branch: Optional[str]) -> bool:
    return bool(branch) and bool(PROGRAM_BRANCH_RE.match(branch))


def git(root: pathlib.Path, *args: str, env: Optional[dict] = None) -> str:
    executable = shutil.which("git")
    if not executable:
        raise GitError("git is not on PATH")
    proc = subprocess.run([executable, "-C", str(root), *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=env)
    if proc.returncode != 0:
        raise GitError(f"git {' '.join(args)} exited {proc.returncode}: {proc.stderr.strip()[:300]}")
    return proc.stdout


def branch_identity(root: pathlib.Path, env: Optional[dict] = None) -> tuple[str, str]:
    """(branch, where it came from). A PR checkout is a detached merge commit, so CI's
    own variables win over `git rev-parse`."""
    env = os.environ if env is None else env
    head_ref = (env.get("GITHUB_HEAD_REF") or "").strip()
    if head_ref:
        return head_ref, "GITHUB_HEAD_REF"
    ref_name = (env.get("GITHUB_REF_NAME") or "").strip()
    if ref_name and not ref_name.endswith("/merge"):
        return ref_name, "GITHUB_REF_NAME"
    try:
        return git(root, "rev-parse", "--abbrev-ref", "HEAD", env=dict(env)).strip(), "git rev-parse"
    except GitError:
        return "", "git rev-parse (failed)"


def merge_base(root: pathlib.Path, head: str = "HEAD", env: Optional[dict] = None) -> Optional[tuple[str, str]]:
    for ref in BASE_REFS:
        try:
            sha = git(root, "merge-base", ref, head, env=env).strip()
        except GitError:
            continue
        if sha:
            return sha, ref
    return None


def _split_z(output: str) -> list[str]:
    return [p for p in output.split("\0") if p]


def changed_files(root: pathlib.Path, base: str, head: str = "HEAD", *,
                  include_worktree: bool = True, env: Optional[dict] = None) -> list[str]:
    found = set(_split_z(git(root, "diff", "--name-only", "--no-renames", "-z", base, head, env=env)))
    if include_worktree:
        found |= set(_split_z(git(root, "diff", "--name-only", "--no-renames", "-z", "HEAD", env=env)))
        found |= set(_split_z(git(root, "ls-files", "--others", "--exclude-standard", "-z", env=env)))
    return sorted(found)


def run_offlimits_rail(root: pathlib.Path = REPO_ROOT, *, branch: Optional[str] = None,
                       env: Optional[dict] = None) -> RailResult:
    root = pathlib.Path(root)
    source = "argument"
    if branch is None:
        branch, source = branch_identity(root, env)
    if not rail_applies_to_branch(branch):
        return RailResult("offlimits", 0, (), skipped=(
            f"branch {branch!r} (from {source}) is not feat/wisdom-loop or wisdom/*; "
            "the off-limits diff rail fires only on program branches"))
    try:
        base = merge_base(root, env=env)
        if base is None:
            return RailResult("offlimits", 0, (), inconclusive=(
                f"no merge base with any of {BASE_REFS}; fetch origin/master (CI: fetch-depth 0)"))
        files = changed_files(root, base[0], env=env)
    except GitError as exc:
        return RailResult("offlimits", 0, (), inconclusive=str(exc))
    return RailResult("offlimits", len(files), tuple(offlimits_violations(files)))


# ── everything ───────────────────────────────────────────────────────────────

def run_all(root: pathlib.Path = REPO_ROOT, *, enforce_floor: bool = True, branch: Optional[str] = None,
            env: Optional[dict] = None) -> list[RailResult]:
    results = [run_source_rail(rail, root, enforce_floor=enforce_floor) for rail in SOURCE_RAILS]
    results.append(run_offlimits_rail(root, branch=branch, env=env))
    return results


def format_report(results: Iterable[RailResult]) -> tuple[str, int]:
    """(text, exit code): 1 on any violation, 2 when nothing failed but a rail could not
    measure, 0 only when every rail that applies measured and passed."""
    results = list(results)
    lines = []
    for result in results:
        if result.skipped:
            lines.append(f"[{result.rail}] SKIPPED: {result.skipped}")
            continue
        status = "FAIL" if result.violations else ("INCONCLUSIVE" if result.inconclusive else "PASS")
        lines.append(f"[{result.rail}] {status}: {result.files_scanned} files scanned, "
                     f"{len(result.violations)} violation(s)")
        if result.inconclusive:
            lines.append(f"    inconclusive: {result.inconclusive}")
        lines.extend("    " + v.render() for v in result.violations)
    if any(r.violations for r in results):
        code = 1
    elif any(r.inconclusive for r in results):
        code = 2
    else:
        code = 0
    return "\n".join(lines), code
