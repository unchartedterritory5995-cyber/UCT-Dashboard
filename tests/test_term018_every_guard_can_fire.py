"""TERM-018 / RM-N15 - PROVE EVERY GUARD CAN FIRE. The NOW exit gate's first clause.

⛔⛔ WHAT THIS RAIL IS FOR, IN ONE SENTENCE. `docs/terminal-research/12-decisions/
gates/term-018-can-every-guard-fire.md` classified 49 guards as PROVEN 22 / FIREABLE
15 / CANNOT FIRE 6 / UNKNOWN 6, and then said the most important thing in the whole
document about its own result:

    "PROVEN reads stronger than it is. Of 22 PROVEN rows only ONE has a recorded
    production firing; the rest rest on unit tests with injected inputs, which prove
    a predicate is satisfiable rather than that the wire from real input to real
    channel is intact."

So in that document PROVEN means *somebody believed it*. This rail exists to make it
mean *observed red before green, on the record, and still true today*.

⛔⛔ THE GUARD POPULATION IS DERIVED BY AST, NEVER TYPED. A hand-maintained list of
guard names is the exact defect this programme documents (the writer-index FOUR, the
COT router's "4 routes", the setup catalog's "24"). `derive_population` walks the
repo for call sites of the alert sink and for the sink's own decision functions, and
`docs/.../term-018-guard-observations.json` only says which of the DERIVED guards
carry an observation and which are declared debt. A guard added to the code and to
neither list fails BY NAME on the first run.

────────────────────────────────────────────────────────────────────────────────
HOW "OBSERVED RED BEFORE GREEN" IS REPRESENTED, AND THE ARGUMENT FOR IT
────────────────────────────────────────────────────────────────────────────────

A rail cannot revert code and re-run a suite. So the observation is a RECORD - and a
rail that only asserts a record EXISTS is a spelling check. Six ties turn the record
into something that can fail on a real regression. Each is a different failure:

  1. SITE RESOLVES.      `predicate.file` + `predicate.scope` resolve to a real def by
                         AST. Catches a deleted or renamed guard.
  2. PIN PRESENT.        `predicate.pinned` occurs in that scope's source, with
                         comments and docstrings STRIPPED and whitespace normalised.
                         ⭐ THIS IS THE CLAUSE THAT CATCHES A REAL REGRESSION: the
                         mutation proof was taken against those exact bytes, so if
                         somebody edits the predicate the record stops describing the
                         code and the rail says so by name.
  3. MUTATION ABSENT.    `predicate.mutation` does NOT occur. Catches the defect
                         coming back.
  4. THE PIN            applying the mutation to the source IN MEMORY must make 2 and
     DISCRIMINATES.     3 both fail. ⭐ Without this, a pin that cannot tell the fixed
                        form from the broken one passes both 2 and 3 forever. This is
                        the clause that makes the record non-vacuous rather than
                        merely present.
  5. THE TEST EXISTS,   every `observed_by` node id exists by AST, is COLLECTED by
     IS COLLECTED, AND  pytest, and its module mentions - IN CODE, never in a
     REACHES THE GUARD. docstring - a name that reaches the pinned scope. Catches a
                        renamed/deleted/uncollectable test, and an observation that
                        names a test having nothing to do with the guard.
  6. THE PROOF IS REAL. `proof.commit` is an ancestor of HEAD and its message contains
                        `proof.quote` verbatim. ⭐ So an observation CANNOT BE ADDED
                        without a commit that records an actual red count. The cost of
                        a new record is a real mutation run, not a sentence.

⛔⛔ WHAT THIS RAIL DOES NOT PROVE - STATED PLAINLY, BECAUSE THE GAP IS REAL:

  * It does NOT prove the named test is red TODAY if the guard is reverted. Nothing
    static can prove that. It proves the mutation was performed once, on a named
    commit, against a named test that still exists and is still collected, and that
    the predicate it was performed against is byte-for-byte still the predicate in
    the code.
  * Clause 5's edge is STRUCTURAL: the test module can touch the guard's code path.
    It does not prove it does. A test that imports a module and asserts nothing about
    it satisfies the edge.
  * It says NOTHING about the 22 guards in `declared_unobserved`. Those are counted
    debt, not coverage. The rail's job there is narrow and total: the debt list must
    be EXACTLY the complement of the observed set within the derived population, and
    it may only shrink.
  * It reads ONE alert channel (`chart_health_alerts`). §"SCOPE" below names what is
    out and why.
  * It asserts no flag state and reads no production. Every claim is source + git.

────────────────────────────────────────────────────────────────────────────────
SCOPE - AND WHAT IS DELIBERATELY OUT
────────────────────────────────────────────────────────────────────────────────

IN: the chart-health operator alert channel, which is lane A's channel (`TERM-011`
splits ops from business events on it) - every `chart_health_alerts.emit` call site
under `api/`, ALIAS-RESOLVED, plus that module's own decision functions. Measured 25
guards. Plus two observations OUTSIDE that population, recorded because they are the
wave's two other real red-before-green results: the wire missed-run watchdog (CARD 27
/ G-01) and `TERM-012`'s p95 acceptance bar (CARD 16 / G-49).

OUT, each with the reason:
  * `alerts.add_alert` - the member/broadcast sink. The audit classifies its two sinks
    UNKNOWN on purpose (G-43, G-44) and its 10 producers are the audit's own named
    DEFERRED band. One exception is recorded as an extra: the wire watchdog.
  * `api/worker_main.py`'s bars watchdog (G-04). Measured, not assumed: it posts to
    `DISCORD_WEBHOOK_URL` DIRECTLY and never touches this sink - its own comment at
    `:462` says so. A different channel, so a different population.
  * The fundamentals standing digest (G-13), the S7 taxonomy sweeps (G-42), the
    exposure-gate and push broadcasts (G-34..G-37), the three dead alert types
    (G-38..G-40), the notebook reminder (G-45) and the desk-session rows
    (G-27..G-29). None reaches this sink.
  * `alerts.py`'s broadcast-reachability table (`d870ece6e`). It IS a fresh
    mutation-proved artifact, and it is NOT a guard that fires: it is a docstring
    claim. Its pin would live in a docstring, which clause 2 strips by construction.
    Excluded rather than special-cased.

────────────────────────────────────────────────────────────────────────────────
TWO TRAPS THIS FILE IS BUILT AROUND, BOTH LOGGED IN THIS REPO
────────────────────────────────────────────────────────────────────────────────

⛔ A CHECK THAT HUNTS A LITERAL IN SOURCE MATCHES ITS OWN EXPLANATION. Six logged
instances. It is LIVE here, not hypothetical: `_staleness_window`'s docstring says
"NEVER from `max(last_ok, boot)`" and `chart_health_alerts`' docstring says the
throttle "was per KEY alone" - i.e. both recorded mutations are quoted in prose feet
away from the code. Every pin therefore matches against comment- and
docstring-stripped source, and `test_the_stripper_...` carries a control proving the
stripper still SEES a real occurrence.

⛔ AN EMPTY RESULT IS A FAILED INVOCATION UNTIL PROVEN OTHERWISE. Every AST walk,
every `git` call and the pytest collection probe carries a non-vacuity assertion, and
the git and collection probes each carry a control proving they can answer NO.
"""
from __future__ import annotations

import ast
import io
import json
import os
import re
import subprocess
import sys
import tokenize
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RECORD_PATH = ROOT / "docs" / "terminal-research" / "12-decisions" / "gates" / \
    "term-018-guard-observations.json"

#: ⛔ THE DEBT CEILING IS A LITERAL HERE, NOT IN THE RECORD, DELIBERATELY. Shrinking
#: the debt is free; GROWING it requires editing this test, which is a visible diff on
#: a gate rail rather than one more row in a data file. Same reasoning as
#: `test_the_default_in_source_is_ON_and_cannot_be_flipped_unnoticed`: pin the literal
#: so it cannot be changed and the test "fixed" to match.
DECLARED_UNOBSERVED_CEILING = 22

#: Every file whose AST could not be read during the population sweep. A silent
#: `except SyntaxError: continue` would let a guard hide in an unparseable file.
SWEEP_SKIPS_ALLOWED: frozenset[str] = frozenset()


# ══════════════════════════════════════════════════════════════════════════════
#  Source stripping - comments and docstrings, offset-preserving
# ══════════════════════════════════════════════════════════════════════════════

def _line_offsets(src: str) -> list[int]:
    out, pos = [], 0
    for line in src.splitlines(keepends=True):
        out.append(pos)
        pos += len(line)
    out.append(pos)
    return out


def _blank(src: str, spans: list[tuple[int, int]]) -> str:
    """Replace each spanned character with a space, KEEPING newlines.

    Offset-preserving on purpose: every line number and column taken from the
    original AST stays valid in the result, so a scope can be sliced out of the
    stripped text using the unstripped tree's line range.
    """
    chars = list(src)
    for a, b in spans:
        for i in range(a, min(b, len(chars))):
            if chars[i] != "\n":
                chars[i] = " "
    return "".join(chars)


def strip_comments_and_docstrings(src: str) -> str:
    """Blank every comment and every docstring. Two passes, and both are needed.

    Comments never reach the AST at all, so they need `tokenize`; docstrings DO reach
    it and are ordinary string Constants, so they need the AST. A check built on only
    one of the two passes still matches its own explanation.
    """
    starts = _line_offsets(src)

    def off(lineno: int, col: int) -> int:
        return starts[lineno - 1] + col

    tree = ast.parse(src)
    doc_spans: list[tuple[int, int]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                                 ast.ClassDef)):
            continue
        body = getattr(node, "body", None) or []
        if not body:
            continue
        first = body[0]
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                and isinstance(first.value.value, str):
            c = first.value
            doc_spans.append((off(c.lineno, c.col_offset),
                              off(c.end_lineno, c.end_col_offset)))
    without_docs = _blank(src, doc_spans)

    starts2 = _line_offsets(without_docs)
    comment_spans: list[tuple[int, int]] = []
    for tok in tokenize.generate_tokens(io.StringIO(without_docs).readline):
        if tok.type == tokenize.COMMENT:
            comment_spans.append((starts2[tok.start[0] - 1] + tok.start[1],
                                  starts2[tok.end[0] - 1] + tok.end[1]))
    return _blank(without_docs, comment_spans)


def normalise(text: str) -> str:
    """Collapse every run of whitespace to one space.

    This is what lets a pin span a multi-line call (`emit(\\n  "key",\\n "warning",`)
    and survive a reflow, and it is what makes a pin readable in the record.
    """
    return re.sub(r"\s+", " ", text).strip()


# ══════════════════════════════════════════════════════════════════════════════
#  Scope extraction
# ══════════════════════════════════════════════════════════════════════════════

def _parents(tree: ast.AST) -> dict[int, ast.AST]:
    p: dict[int, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            p[id(child)] = node
    return p


def _qualname(node: ast.AST, parents: dict[int, ast.AST], *, own: bool) -> str:
    """Dotted chain of enclosing def/class names. `own=True` includes `node` itself."""
    chain: list[str] = []
    if own and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        chain.append(node.name)
    cur = node
    while id(cur) in parents:
        cur = parents[id(cur)]
        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            chain.append(cur.name)
    return ".".join(reversed(chain)) or "<module>"


def scope_source(path: Path, scope: str) -> str:
    """The comment/docstring-stripped, whitespace-normalised source of one scope.

    `scope` is a dotted qualname, or `<module>` for the whole file (which is what a
    module-level constant set needs - `tools/bars_warmth_audit.py`'s tier sets).
    """
    src = path.read_text(encoding="utf-8")
    stripped = strip_comments_and_docstrings(src)
    if scope == "<module>":
        return normalise(stripped)
    tree = ast.parse(src)
    parents = _parents(tree)
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if _qualname(node, parents, own=True) == scope:
            lines = stripped.splitlines(keepends=True)
            return normalise("".join(lines[node.lineno - 1:node.end_lineno]))
    raise LookupError(
        f"scope {scope!r} does not exist in {path} - the guard has been renamed or "
        "deleted, and its recorded observation no longer describes any code."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Population derivation (AST, alias-resolved)
# ══════════════════════════════════════════════════════════════════════════════

def sink_aliases_in(tree: ast.AST, dotted: str) -> set[str]:
    """Every local name bound to `dotted`, at module level OR inside a function body.

    ⛔ THE FUNCTION-LOCAL CASE IS THE ONE THAT MATTERS. `bars_continuous_audit.py`
    does `from api.services import chart_health_alerts as _alerts` INSIDE a function,
    and its four sites are the most load-bearing guards in the audit (both
    `intraday_hotset_stale` tiers, `bars_store_unhealthy`, `bars_daily_store_stale`).
    A derivation matching only the literal module name misses all four.
    """
    names: set[str] = set()
    tail = dotted.rsplit(".", 1)[-1]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == dotted:
                    names.add(alias.asname or tail)
        elif isinstance(node, ast.ImportFrom):
            pkg = node.module or ""
            for alias in node.names:
                if f"{pkg}.{alias.name}" == dotted:
                    names.add(alias.asname or alias.name)
    return names


def _literal_or_computed(node: ast.AST | None) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return "<computed>"


def emit_sites_in(src: str, rel: str, dotted: str, sink_fn: str,
                  *, aliases: set[str] | None = None) -> dict[str, int]:
    """`{guard_id: lineno}` for every `<alias>.<sink_fn>(key, severity, ...)` call.

    The id is `<relpath>::<enclosing qualname>::<key>::<severity>`. Key and severity
    are in the id because that is THE AUDIT'S OWN UNIT: "two tiers of one metric under
    two thresholds are two guards, because they have two predicates."
    """
    tree = ast.parse(src)
    found = sink_aliases_in(tree, dotted) if aliases is None else aliases
    if not found:
        return {}
    parents = _parents(tree)
    out: dict[str, int] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == sink_fn):
            continue
        if not (isinstance(func.value, ast.Name) and func.value.id in found):
            continue
        key = _literal_or_computed(node.args[0] if node.args else None)
        sev = _literal_or_computed(node.args[1] if len(node.args) > 1 else None)
        out[f"{rel}::{_qualname(node, parents, own=False)}::{key}::{sev}"] = node.lineno
    return out


def gate_functions_in(src: str, rel: str, sink_fn: str) -> dict[str, int]:
    """The sink's own decision functions: `<sink_fn>` plus the same-module functions
    it calls. These are the audit's "guards-of-guards" - whether an emit ever leaves
    the process (G-46, G-47)."""
    tree = ast.parse(src)
    module_funcs = {n.name: n for n in tree.body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    if sink_fn not in module_funcs:
        raise AssertionError(
            f"{rel} has no top-level `{sink_fn}` - the sink has moved and every "
            "derivation below is pointed at nothing."
        )
    names = {sink_fn}
    for node in ast.walk(module_funcs[sink_fn]):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id in module_funcs:
            names.add(node.func.id)
    return {f"{rel}::{name}": module_funcs[name].lineno for name in sorted(names)}


def derive_population(root: Path, spec: dict) -> tuple[dict[str, int], list[str]]:
    """`({guard_id: lineno}, [files skipped])`. The skip list is returned, never
    swallowed - a guard hiding in an unparseable file is exactly the blind spot an
    `except SyntaxError: continue` creates."""
    dotted = spec["sink_module"]
    sink_fn = spec["sink_function"]
    guards: dict[str, int] = {}
    skipped: list[str] = []
    for base in spec["emit_site_roots"]:
        for path in sorted((root / base).rglob("*.py")):
            rel = path.relative_to(root).as_posix()
            try:
                guards.update(emit_sites_in(path.read_text(encoding="utf-8"), rel,
                                            dotted, sink_fn))
            except (SyntaxError, UnicodeDecodeError, ValueError) as exc:
                skipped.append(f"{rel}: {type(exc).__name__}")
    sink_rel = dotted.replace(".", "/") + ".py"
    sink_path = root / sink_rel
    guards.update(gate_functions_in(sink_path.read_text(encoding="utf-8"),
                                    sink_rel, sink_fn))
    return guards, skipped


# ══════════════════════════════════════════════════════════════════════════════
#  Test-side derivation
# ══════════════════════════════════════════════════════════════════════════════

def pytest_test_names_in(src: str) -> set[str]:
    """Top-level and class-nested `def test_*` names, by AST.

    ⚠️ NOT itself named `test_*`: pytest would collect a helper taking a `src`
    argument as a test and error on a missing fixture. It did, once.
    """
    tree = ast.parse(src)
    parents = _parents(tree)
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) \
                and node.name.startswith("test"):
            out.add(_qualname(node, parents, own=True).split(".")[-1])
    return out


def code_mentions_in(src: str) -> set[str]:
    """Every name, attribute, string literal and import path a module mentions IN CODE.

    ⛔ DOCSTRINGS ARE EXCLUDED, and comments never reach the AST. Without that, a test
    whose docstring recounts the defect would satisfy the guard edge while testing
    something else - the trap this repo has logged six times.
    """
    tree = ast.parse(src)
    doc_ids: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                                 ast.ClassDef)):
            continue
        body = getattr(node, "body", None) or []
        if body and isinstance(body[0], ast.Expr) \
                and isinstance(body[0].value, ast.Constant) \
                and isinstance(body[0].value.value, str):
            doc_ids.add(id(body[0].value))

    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            out.add(node.id)
        elif isinstance(node, ast.Attribute):
            out.add(node.attr)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) \
                and id(node) not in doc_ids:
            out.add(node.value)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                out.add(alias.name)
                out.add(alias.asname or alias.name.split(".")[-1])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                out.add(node.module)
            for alias in node.names:
                out.add(alias.name)
                out.add(alias.asname or alias.name)
    return out


def names_that_reach(root: Path, rel: str, scope: str) -> set[str]:
    """Names an observing test could plausibly mention to touch `scope`.

    The scope itself, every same-module function that transitively CALLS it, the
    module's dotted path, its bare module name and its filename. The transitive
    closure is what lets a test that drives the public entry point count, without the
    record having to declare that entry point by hand.
    """
    path = root / rel
    src = path.read_text(encoding="utf-8")
    tokens = {rel, Path(rel).name, Path(rel).stem, rel.removesuffix(".py").replace("/", ".")}
    if scope == "<module>":
        return tokens
    leaf = scope.split(".")[-1]
    tokens.add(leaf)
    tokens.add(scope)

    tree = ast.parse(src)
    parents = _parents(tree)
    # callee -> {callers}, over every def in the module (nested defs included, keyed
    # by leaf name, which is how a test would name them).
    callers: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        me = node.name
        for inner in ast.walk(node):
            if not isinstance(inner, ast.Call):
                continue
            f = inner.func
            callee = f.id if isinstance(f, ast.Name) else (
                f.attr if isinstance(f, ast.Attribute) else None)
            if callee and callee != me:
                callers.setdefault(callee, set()).add(me)
    # Enclosing defs count too: a nested guard is reached by driving its parent.
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == leaf:
            outer = _qualname(node, parents, own=False)
            if outer != "<module>":
                callers.setdefault(leaf, set()).add(outer.split(".")[-1])

    frontier, seen = {leaf}, {leaf}
    while frontier:
        nxt: set[str] = set()
        for name in frontier:
            for up in callers.get(name, set()):
                if up not in seen:
                    seen.add(up)
                    nxt.add(up)
        frontier = nxt
    return tokens | seen


# ══════════════════════════════════════════════════════════════════════════════
#  git and pytest probes - each with a non-vacuity control below
# ══════════════════════════════════════════════════════════════════════════════

def git(*args: str) -> str:
    """Run git at ROOT. Raises on a non-zero exit rather than returning "".

    ⛔ A swallowed git failure returns an empty string, and every membership check
    below passes trivially over an empty string.
    """
    proc = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed ({proc.returncode}): "
                             f"{proc.stderr.strip()[:400]}")
    return proc.stdout


def git_is_ancestor(sha: str, of: str = "HEAD") -> bool:
    proc = subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", sha, of],
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=120)
    if proc.returncode not in (0, 1):
        raise AssertionError(f"git merge-base --is-ancestor {sha} {of} could not answer "
                             f"({proc.returncode}): {proc.stderr.strip()[:400]}")
    return proc.returncode == 0


def pytest_collect(node_ids: list[str]) -> tuple[int, set[str]]:
    """`(exit code, collected node ids)` from ONE scoped `--collect-only`.

    ⛔ SCOPED BY NAMED NODE IDS ONLY. An unscoped collection on this box has reached
    6.6 GB; naming ~6 files does not. One subprocess, not one per id.
    """
    env = {k: v for k, v in os.environ.items()
           if k not in ("PYTEST_ADDOPTS", "PYTEST_CURRENT_TEST", "PYTEST_XDIST_WORKER")}
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", "--no-header",
         "-p", "no:cacheprovider", *node_ids],
        cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
        errors="replace", env=env, timeout=600)
    wanted = set(node_ids)
    collected = {line.strip() for line in proc.stdout.splitlines()
                 if line.strip() in wanted}
    return proc.returncode, collected


# ══════════════════════════════════════════════════════════════════════════════
#  The record
# ══════════════════════════════════════════════════════════════════════════════

RECORD = json.loads(RECORD_PATH.read_text(encoding="utf-8"))
OBSERVED = RECORD["observed"]
DECLARED = RECORD["declared_unobserved"]
POP_SPEC = RECORD["derived_population"]

#: Collected once: the derivation is the same for every test and costs a repo sweep.
_POPULATION, _SWEEP_SKIPS = derive_population(ROOT, POP_SPEC)


def _ids(records: list[dict]) -> list[str]:
    return [r["guard"] for r in records]


def _all_observed_node_ids() -> list[str]:
    seen: list[str] = []
    for rec in OBSERVED:
        for nid in rec["observed_by"]:
            if nid not in seen:
                seen.append(nid)
    return seen


# ══════════════════════════════════════════════════════════════════════════════
#  A. THE DERIVATION IS REAL  (non-vacuity + the controls the roadmap names)
# ══════════════════════════════════════════════════════════════════════════════

def test_the_derived_population_is_not_empty_and_meets_its_floor():
    emit_floor = POP_SPEC["emit_site_count_floor"]
    gate_floor = POP_SPEC["gate_function_count_floor"]
    sink_rel = POP_SPEC["sink_module"].replace(".", "/") + ".py"
    gates = [g for g in _POPULATION if g.startswith(sink_rel + "::") and g.count("::") == 1]
    emits = [g for g in _POPULATION if g not in gates]
    assert len(emits) >= emit_floor, (
        f"only {len(emits)} emit sites derived (floor {emit_floor}). An empty or thin "
        "result is a failed walk, not a codebase without alerts."
    )
    assert len(gates) >= gate_floor, f"only {len(gates)} gate functions derived: {gates}"


def test_the_population_contains_the_members_named_in_the_record():
    """A COUNT can be satisfied by the wrong set. Name members instead."""
    missing = [g for g in POP_SPEC["must_contain_by_name"] if g not in _POPULATION]
    assert not missing, (
        "the derivation no longer finds guards the record names by name: "
        f"{missing}\nderived: {sorted(_POPULATION)}"
    )


def test_the_population_sweep_read_every_file_it_walked():
    unexpected = [s for s in _SWEEP_SKIPS if s.split(":")[0] not in SWEEP_SKIPS_ALLOWED]
    assert not unexpected, (
        f"files skipped during the sweep: {unexpected}. A guard in an unreadable file "
        "is invisible to this rail, which is why the skip list is asserted empty "
        "instead of swallowed."
    )


def test_ALIAS_RESOLUTION_IS_LOAD_BEARING_and_finds_the_function_local_import():
    """CONTROL on the derivation, and a finding in its own right.

    `bars_continuous_audit.py` binds the sink as `_alerts` inside a function body. A
    derivation restricted to the literal name `chart_health_alerts` finds NONE of its
    four sites, and those four include both `intraday_hotset_stale` tiers, i.e. the
    exact pair whose escalation defect this wave fixed.

    ⚰️ This docstring said that restricted derivation was "what
    `tests/test_chart_health_severity_vocabulary.py::chart_health_emits_in` does".
    TRUE WHEN WRITTEN, FALSE NOW: that rail was alias-blind for exactly this reason
    and has been fixed - it resolves aliases scope-aware, pins its population at 21
    literal-severity sites, and carries its own load-bearing control of this shape.
    The sentence is corrected rather than deleted because the blind-matcher
    measurement is what motivated both controls.
    """
    rel = "api/services/bars_continuous_audit.py"
    src = (ROOT / rel).read_text(encoding="utf-8")
    dotted, sink_fn = POP_SPEC["sink_module"], POP_SPEC["sink_function"]

    alias_resolved = emit_sites_in(src, rel, dotted, sink_fn)
    literal_only = emit_sites_in(src, rel, dotted, sink_fn,
                                 aliases={dotted.rsplit(".", 1)[-1]})

    assert len(alias_resolved) >= 4, sorted(alias_resolved)
    assert not literal_only, (
        "the alias-blind derivation now finds sites here too - re-read this test's "
        "docstring before relaxing it"
    )
    for key in ("intraday_hotset_stale::critical", "intraday_hotset_stale::warning",
                "bars_store_unhealthy::critical"):
        assert any(g.endswith(key) for g in alias_resolved), (key, sorted(alias_resolved))


def test_the_stripper_removes_comments_and_docstrings_but_still_sees_real_code():
    """CONTROL for the six-logged-instances trap, with a REAL occurrence beside the
    ghosts so the check cannot pass by seeing nothing at all."""
    src = (
        '"""module docstring: max(last_ok, boot) is prose."""\n'
        "def f(a):\n"
        '    """fn docstring: _throttle.get(alert_key, 0) is prose too."""\n'
        "    # comment: minute=5 is prose three\n"
        "    return REAL_CODE_TOKEN(a)\n"
    )
    body = normalise(strip_comments_and_docstrings(src))
    assert "REAL_CODE_TOKEN(a)" in body, body          # ← the control
    assert "max(last_ok, boot)" not in body, body
    assert "_throttle.get(alert_key, 0)" not in body, body
    assert "minute=5" not in body, body


def test_a_docstring_mention_does_not_satisfy_the_guard_edge():
    """CONTROL on clause 5: a test whose DOCSTRING names the guard does not reach it."""
    doc_only = '"""drives registry._staleness_window."""\nimport os\n'
    code_too = 'import os\nNAME = "_staleness_window"\n'
    assert "_staleness_window" not in code_mentions_in(doc_only)
    assert "os" in code_mentions_in(doc_only)          # ← the control
    assert "_staleness_window" in code_mentions_in(code_too)


def test_the_git_probe_can_answer_NO():
    """Non-vacuity + control. `HEAD` is not an ancestor of an older commit, so a probe
    that always said True would fail here."""
    head = git("rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", head), repr(head)
    assert git_is_ancestor(head, head), "a commit is its own ancestor"
    older = OBSERVED[0]["proof"]["commit"]
    assert git_is_ancestor(older, head), f"{older} is not on this history"
    assert not git_is_ancestor(head, older), (
        "the ancestry probe answered YES for a descendant - it cannot say NO, so "
        "every proof-commit assertion below is vacuous"
    )


def test_the_pytest_collection_probe_can_answer_NO():
    """Non-vacuity + control for clause 5's collection half."""
    real = OBSERVED[0]["observed_by"][0]
    path = real.split("::")[0]
    code, collected = pytest_collect([real])
    assert code == 0 and collected == {real}, (code, collected)

    bogus = f"{path}::test_this_node_id_does_not_exist_term018"
    code2, collected2 = pytest_collect([bogus])
    assert code2 != 0 and not collected2, (
        "pytest reported success collecting a node id that does not exist - the "
        f"collection check cannot fail. exit={code2} collected={collected2}"
    )


# ══════════════════════════════════════════════════════════════════════════════
#  B. TOTALITY - the gate clause. A guard with no observing test fails BY NAME.
# ══════════════════════════════════════════════════════════════════════════════

def test_every_derived_guard_is_either_OBSERVED_or_DECLARED_by_name():
    in_pop = {r["guard"] for r in OBSERVED if r["in_population"]}
    declared = set(_ids(DECLARED))
    unaccounted = sorted(set(_POPULATION) - in_pop - declared)
    assert not unaccounted, (
        "GUARDS WITH NO RED-BEFORE-GREEN OBSERVATION AND NO DECLARATION:\n  "
        + "\n  ".join(f"{g}  (line {_POPULATION[g]})" for g in unaccounted)
        + "\n\nEvery guard on this alert channel must either carry a verified "
          "observation in term-018-guard-observations.json or be declared as debt "
          "there. A new guard is not allowed to arrive silently - that is the whole "
          "gate (roadmap §2.3 clause 1)."
    )


def test_no_guard_is_both_observed_and_declared_debt():
    both = sorted({r["guard"] for r in OBSERVED} & set(_ids(DECLARED)))
    assert not both, (
        f"recorded as observed AND as debt: {both}. Two authorities over one guard; "
        "the copy with no rail goes stale first."
    )


def test_no_declared_entry_names_a_guard_that_no_longer_exists():
    stale = sorted(g for g in _ids(DECLARED) if g not in _POPULATION)
    assert not stale, (
        f"declared debt for guards the derivation no longer finds: {stale}. Either "
        "the guard was deleted (remove the row) or the derivation moved (fix it) - a "
        "debt list that outlives its subject is a ledger describing nothing."
    )


def test_the_declared_debt_never_grows():
    assert len(DECLARED) <= DECLARED_UNOBSERVED_CEILING, (
        f"{len(DECLARED)} guards are declared unobserved; the ceiling is "
        f"{DECLARED_UNOBSERVED_CEILING}. Debt may only shrink. Raising the ceiling is "
        "a deliberate edit to this file, not a row in a data file."
    )


def test_every_in_population_claim_in_the_record_is_true():
    """Stops the cheapest way to dodge totality: marking a guard `in_population: false`."""
    wrong_out = sorted(r["guard"] for r in OBSERVED
                       if not r["in_population"] and r["guard"] in _POPULATION)
    wrong_in = sorted(r["guard"] for r in OBSERVED
                      if r["in_population"] and r["guard"] not in _POPULATION)
    assert not wrong_out, (
        f"recorded as outside the derived population but the derivation finds them: "
        f"{wrong_out} - an `in_population: false` on a derived guard would exempt it "
        "from the totality check above."
    )
    assert not wrong_in, (
        f"recorded as inside the derived population but not derived: {wrong_in}"
    )


def test_the_record_partitions_the_population_and_reports_the_numbers():
    """The gate's headline, derived. Fails if the arithmetic does not close - the
    CoverageLine rule: a receipt whose sum does not close is not presented."""
    in_pop = {r["guard"] for r in OBSERVED if r["in_population"]}
    declared = set(_ids(DECLARED))
    assert in_pop | declared == set(_POPULATION), (
        sorted(in_pop | declared), sorted(_POPULATION))
    assert len(in_pop) + len(declared) == len(_POPULATION), (
        len(in_pop), len(declared), len(_POPULATION))
    assert len(in_pop) >= 3, f"observed within the population fell to {len(in_pop)}"


# ══════════════════════════════════════════════════════════════════════════════
#  C. EVERY OBSERVATION IS VERIFIED  (clauses 1-6, one test per clause)
# ══════════════════════════════════════════════════════════════════════════════

def _params():
    return [pytest.param(r, id=r["guard"]) for r in OBSERVED]


@pytest.mark.parametrize("rec", _params())
def test_clause1_the_guards_site_still_resolves(rec):
    pred = rec["predicate"]
    path = ROOT / pred["file"]
    assert path.is_file(), f"{pred['file']} does not exist"
    scope_source(path, pred["scope"])          # raises LookupError by name


@pytest.mark.parametrize("rec", _params())
def test_clause2_the_pinned_predicate_is_still_in_the_source(rec):
    pred = rec["predicate"]
    body = scope_source(ROOT / pred["file"], pred["scope"])
    assert pred["pinned"] in body, (
        f"THE PREDICATE THIS OBSERVATION WAS TAKEN AGAINST IS GONE.\n"
        f"  guard   : {rec['guard']}\n"
        f"  expected: {pred['pinned']}\n"
        f"  in      : {pred['file']}::{pred['scope']} (comments and docstrings stripped)\n"
        f"The red-before-green proof in {rec['proof']['commit']} was performed against "
        "those exact bytes, so it no longer says anything about the code that ships. "
        "Re-take the mutation and re-record it, or restore the predicate."
    )


@pytest.mark.parametrize("rec", _params())
def test_clause3_the_mutated_predicate_is_absent(rec):
    pred = rec["predicate"]
    body = scope_source(ROOT / pred["file"], pred["scope"])
    assert pred["mutation"] not in body, (
        f"THE DEFECT IS BACK.\n  guard: {rec['guard']}\n  found: {pred['mutation']}\n"
        f"  in   : {pred['file']}::{pred['scope']}"
    )


@pytest.mark.parametrize("rec", _params())
def test_clause4_the_pin_DISCRIMINATES_the_mutation(rec):
    """⭐ THE CLAUSE THAT STOPS THIS BEING A SPELLING CHECK.

    Applies the recorded mutation to the real source IN MEMORY (nothing is written)
    and asserts clauses 2 and 3 both FLIP. A pin that cannot tell the fixed form from
    the broken one would satisfy 2 and 3 forever and prove nothing.
    """
    pred = rec["predicate"]
    body = scope_source(ROOT / pred["file"], pred["scope"])
    assert pred["pinned"] != pred["mutation"], "the pin and the mutation are identical"
    mutated = body.replace(pred["pinned"], pred["mutation"])
    assert mutated != body, "the mutation is a no-op against the real source"
    assert pred["pinned"] not in mutated, (
        f"clause 2 would still pass on the MUTATED source for {rec['guard']} - the pin "
        "cannot distinguish the fix from the defect. Reword the pin so the mutated "
        "form does not contain it."
    )
    assert pred["mutation"] in mutated, f"clause 3 cannot see the mutation for {rec['guard']}"


@pytest.mark.parametrize("rec", _params())
def test_clause5a_every_observing_test_exists_by_name(rec):
    assert rec["observed_by"], f"{rec['guard']} names no observing test"
    for node_id in rec["observed_by"]:
        rel, _, func = node_id.partition("::")
        path = ROOT / rel
        assert path.is_file(), f"{rel} does not exist ({rec['guard']})"
        names = pytest_test_names_in(path.read_text(encoding="utf-8"))
        assert names, f"no test functions found in {rel} - a failed parse, not an empty file"
        assert func in names, (
            f"{node_id} does not exist: {rel} has no `def {func}`. The observation for "
            f"{rec['guard']} names a test that has been renamed or deleted."
        )


@pytest.mark.parametrize("rec", _params())
def test_clause5b_every_observing_test_module_reaches_the_guard(rec):
    pred = rec["predicate"]
    reach = names_that_reach(ROOT, pred["file"], pred["scope"])
    assert pred["scope"] == "<module>" or pred["scope"].split(".")[-1] in reach, \
        "the reach derivation does not contain the guard itself - it is broken"
    for node_id in rec["observed_by"]:
        rel = node_id.split("::")[0]
        mentions = code_mentions_in((ROOT / rel).read_text(encoding="utf-8"))
        assert mentions, f"no code mentions parsed from {rel} - a failed walk"
        overlap = sorted(mentions & reach)
        assert overlap, (
            f"{rel} mentions nothing in code that reaches "
            f"{pred['file']}::{pred['scope']}.\n  reachable: {sorted(reach)}\n"
            "An observation naming a test with no structural path to the guard is a "
            "marker comment, which is what this rail exists to refuse."
        )


@pytest.mark.parametrize("rec", _params())
def test_clause6_the_proof_commit_is_an_ancestor_and_records_the_red_count(rec):
    sha = rec["proof"]["commit"]
    quote = normalise(rec["proof"]["quote"])
    assert re.fullmatch(r"[0-9a-f]{7,40}", sha), f"not a sha: {sha!r}"
    assert git_is_ancestor(sha), (
        f"{sha} is not an ancestor of HEAD, so the observation for {rec['guard']} "
        "cites a commit that is not on this history."
    )
    message = normalise(git("log", "-1", "--format=%B", sha))
    assert len(message) > 40, f"empty commit message for {sha} - a failed git read"
    assert quote in message, (
        f"THE PROOF COMMIT DOES NOT RECORD THE MUTATION THIS OBSERVATION CLAIMS.\n"
        f"  guard : {rec['guard']}\n  commit: {sha}\n  quote : {quote}\n"
        "An observation may only cite a commit whose own message records the red "
        "count, so adding a record costs a real mutation run."
    )


def test_clause5c_every_observing_test_is_COLLECTED_by_pytest():
    """One batched, scoped `--collect-only`. A test that exists in source but cannot
    be collected - an import error, a module-level skip, a renamed fixture - is not an
    observation anybody can re-run."""
    node_ids = _all_observed_node_ids()
    assert len(node_ids) >= 3 * len(OBSERVED) - 2, f"suspiciously few node ids: {node_ids}"
    code, collected = pytest_collect(node_ids)
    missing = sorted(set(node_ids) - collected)
    assert code == 0 and not missing, (
        f"pytest could not collect every observing test (exit {code}).\n"
        f"  missing: {missing}\n"
        "A recorded observation whose test cannot be collected is a record of a test "
        "that no longer runs."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  D. THE DISCRIMINATOR - plant one observed guard and one unobserved guard
# ══════════════════════════════════════════════════════════════════════════════

def _plant(root: Path) -> dict:
    """A miniature repo: a sink module with the real `emit` shape, and a producer with
    TWO emit sites. Used to prove the rail's verdict differs between a guard that is
    recorded and one that is not, through the real derivation code."""
    sink_dir = root / "api" / "services"
    sink_dir.mkdir(parents=True)
    (sink_dir / "chart_health_alerts.py").write_text(
        "import time\n"
        "_throttle = {}\n"
        "def _should_page(k, s):\n"
        "    return s == 'critical'\n"
        "def emit(alert_key, severity, message):\n"
        "    last = _throttle.get((alert_key, severity), 0)\n"
        "    if time.time() - last < 600:\n"
        "        return False\n"
        "    return _should_page(alert_key, severity)\n",
        encoding="utf-8", newline="\n")
    (sink_dir / "planted_producer.py").write_text(
        '"""A docstring naming planted_beta so the docstring path is exercised."""\n'
        "def raise_alpha():\n"
        "    from api.services import chart_health_alerts as _a\n"
        "    if 1 > 0:\n"
        '        _a.emit("planted_alpha", "critical", "x")\n'
        "def raise_beta():\n"
        "    from api.services import chart_health_alerts as _a\n"
        '    _a.emit("planted_beta", "warning", "y")\n',
        encoding="utf-8", newline="\n")
    return {
        "sink_module": "api.services.chart_health_alerts",
        "sink_function": "emit",
        "emit_site_roots": ["api"],
        "emit_site_count_floor": 2,
        "gate_function_count_floor": 2,
    }


def test_the_rail_DISTINGUISHES_an_observed_guard_from_an_unobserved_one(tmp_path):
    """MANDATORY DISCRIMINATOR (roadmap §2.3 clause 1: "a control so it cannot pass
    for the wrong reason"). Two guards are planted, identical but for whether the
    record covers them, and the partition must name exactly the uncovered one.
    """
    spec = _plant(tmp_path)
    derived, skips = derive_population(tmp_path, spec)
    assert not skips, skips

    alpha = "api/services/planted_producer.py::raise_alpha::planted_alpha::critical"
    beta = "api/services/planted_producer.py::raise_beta::planted_beta::warning"
    assert alpha in derived and beta in derived, sorted(derived)
    # The alias-resolved derivation also found the sink's own gate functions.
    assert "api/services/chart_health_alerts.py::emit" in derived, sorted(derived)

    def unaccounted(observed: set[str], declared: set[str]) -> list[str]:
        return sorted(set(derived) - observed - declared)

    everything_else = set(derived) - {alpha, beta}
    # One observed, one not: the rail names the one that is not.
    assert unaccounted({alpha}, everything_else) == [beta]
    # The mirror, so the verdict is not simply "always beta".
    assert unaccounted({beta}, everything_else) == [alpha]
    # Both covered: silent.
    assert unaccounted({alpha, beta}, everything_else) == []
    # Neither covered: BOTH named, so the check is not one-at-a-time by accident.
    assert unaccounted(set(), everything_else) == sorted([alpha, beta])


def test_the_planted_guards_observation_clauses_also_discriminate(tmp_path):
    """The same discriminator one level down: a pin that matches the planted fixed
    form, and a mutation that does not - proved by flipping the source in memory."""
    _plant(tmp_path)
    sink = tmp_path / "api" / "services" / "chart_health_alerts.py"
    pinned = "last = _throttle.get((alert_key, severity), 0)"
    mutation = "last = _throttle.get(alert_key, 0)"

    body = scope_source(sink, "emit")
    assert pinned in body and mutation not in body, body
    mutated = body.replace(pinned, mutation)
    assert pinned not in mutated and mutation in mutated, mutated

    # And the docstring of the planted producer must NOT satisfy the guard edge for a
    # guard it only names in prose.
    producer = (tmp_path / "api" / "services" / "planted_producer.py").read_text(encoding="utf-8")
    mentions = code_mentions_in(producer)
    assert "planted_beta" in mentions           # ← in code (an emit argument)
    assert "A docstring naming planted_beta" not in " ".join(sorted(mentions))
