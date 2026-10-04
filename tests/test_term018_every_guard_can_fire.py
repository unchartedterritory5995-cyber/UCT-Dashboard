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
rail that only asserts a record EXISTS is a spelling check. Eight ties turn the record
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
  7. THE WIRE IS INTACT. every observation declares how its guard is REACHED in a
                        running process (`wire`), and the declaration is checked by
                        AST: a `chain` of call sites - each one a real call, whose
                        name is BOUND to the previous hop's module by an import and
                        transitively calls or references it - ending in a module a
                        Railway service actually boots (read from `railway*.json`
                        and the Dockerfile it names, never typed). ⭐ THE BACKLOG'S
                        OWN WORDS: "the wire is the part that has actually been cut
                        in this repo" (CARD 27: a correct comparison on a schedule
                        it could never fire at). So every hop is also CUT IN MEMORY
                        and the chain must break - a wire check that survives its
                        wire being cut is a spelling check, and a chain that
                        survives it has a second registration nobody can
                        mutation-prove. A sink (its wire is every producer in the
                        derived population) and a hand-run CLI are the only other
                        kinds, and each is checked for being what it claims.
  8. NO SEAM IS BOUND   within the guard's reach, no parameter default is a module-
     AT IMPORT.         level def, class or import. `def f(read=real_read)` captures
                        the original ONCE, so `monkeypatch.setattr(mod, "real_read",
                        fake)` reaches nothing and the observing test silently
                        exercises the real function - the backlog's seam rule:
                        "every injected seam in a new monitor must be `=None` and
                        resolved in the body, or its proof is theatre."

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
  * Clause 7 stops at the entry MODULE. That the function holding the last hop
    (usually `lifespan`) actually runs, and that an env flag around it is set, is
    the process's business and production's, neither of which a static rail reads.
    Edges are STRUCTURAL like clause 5's: a name bound to a module and a def that
    references another prove the wire CAN carry the guard, not that it does.
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
import functools
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
#:
#: ⚠️⚠️ 22 -> 24, TEMPORARILY, AND IT MUST GO BACK. TERM-011 / RM-N09 step 4 adds two
#: guards to this sink (`_should_email_second_transport` and `_email_second_transport`,
#: the second transport for `(OPS, critical)`). BOTH were mutation-proved red-before-green
#: — 8 red and 7 red, counts and pins recorded in the two new `declared_unobserved` rows'
#: `pending_observation` blocks — so they are NOT unmeasured debt. They are debt because
#: CLAUSE 6 IS UNSATISFIABLE BEFORE THE COMMIT EXISTS: an observation may only cite a
#: commit that is already an ancestor of HEAD, and the change carrying these guards is
#: not committed yet. ⛔ THE PROMOTION IS OWED, NOT OPTIONAL: in the commit after step 4,
#: move both `pending_observation` blocks into `observed` with the step-4 SHA and put this
#: literal back to 22. A ceiling left loose is how a debt list stops meaning anything —
#: `lesson_a_documented_workaround_is_not_a_recovery_path`.
#: 22 -> 20 (2026-10-03, TERMINAL-NEXT Lane P): G-16 and G-17, the wire coverage
#: monitor's two guards, observed two-sided (tests/test_term018_wire_coverage_guards.py,
#: proof 21e1467c5d) and moved to `observed`.
DECLARED_UNOBSERVED_CEILING = 20

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
    src_lines = src.splitlines(keepends=True)

    def off(lineno: int, col: int) -> int:
        # ⛔ ast col offsets are UTF-8 BYTES; `src` is indexed by CHARACTERS. A
        # docstring carrying non-ASCII (`coverage_monitor.run_check`'s arrows) made a
        # raw byte offset overshoot into the next line's indentation and the stripped
        # text stopped parsing. Convert on the line's own bytes.
        line = src_lines[lineno - 1] if lineno - 1 < len(src_lines) else ""
        return starts[lineno - 1] + len(line.encode("utf-8")[:col].decode("utf-8", "ignore"))

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


# ══════════════════════════════════════════════════════════════════════════════
#  E. CLAUSE 7 - THE WIRE. The guard is reached from a process that actually boots.
# ══════════════════════════════════════════════════════════════════════════════

#: The three ways an observation may say its guard is reached. CLOSED on purpose: a
#: free-text reason is the escape hatch every hard case would take.
WIRE_KINDS = ("chain", "table", "sink", "cli")

#: What a cut wire's name becomes. Nothing in the repo binds it.
WIRE_CUT = "__term018_wire_cut__"

#: `add_job` sites the matcher must find in `api/main.py` before a "no such job"
#: answer means anything. ~160 at 2026-09-29; a floor, not a count.
MAIN_ADD_JOB_FLOOR = 50


def service_entry_modules(root: Path) -> set[str]:
    """Repo-relative paths of the modules a Railway service BOOTS, read from the
    configuration that boots them - never typed.

    Two sources, because the services boot two ways: `railway*.json`'s
    `deploy.startCommand` (`python -m api.worker_main`, `uvicorn api.main:app`), and,
    for a config with no start command, the `CMD` lines of the Dockerfile its
    `build.dockerfilePath` names (`web` boots `Dockerfile.web`'s CMD). A name that
    resolves to no file is dropped rather than trusted.
    """
    texts: list[str] = []
    for cfg in sorted(root.glob("railway*.json")):
        data = json.loads(cfg.read_text(encoding="utf-8"))
        cmd = (data.get("deploy") or {}).get("startCommand")
        if cmd:
            texts.append(cmd)
        dockerfile = (data.get("build") or {}).get("dockerfilePath")
        if dockerfile and (root / dockerfile).is_file():
            texts.extend(line for line in (root / dockerfile).read_text(
                encoding="utf-8").splitlines() if line.lstrip().startswith("CMD"))
    out: set[str] = set()
    for text in texts:
        for name in re.findall(r"\bapi\.(\w+)", text):
            if (root / "api" / f"{name}.py").is_file():
                out.add(f"api/{name}.py")
    return out


def _dotted(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return f"{base}.{node.attr}" if base else None
    return None


@functools.lru_cache(maxsize=64)
def _parsed(src: str) -> tuple[ast.AST, dict[int, ast.AST]]:
    """One parse per distinct source TEXT. `api/main.py` is read by several records;
    a cut is a different text, so it is parsed fresh rather than served the uncut
    tree."""
    tree = ast.parse(src)
    return tree, _parents(tree)


def refs_reach(src: str, scope: str) -> set[str]:
    """Leaf names of every def in this module that transitively CALLS or REFERENCES
    `scope`, plus `scope` itself.

    Wider than `names_that_reach` on purpose: the wire into a monitor is almost never
    a call. It is `threading.Thread(target=_loop)` or `add_job(_check)` - a bare
    REFERENCE to a def - so a caller graph built from calls alone cannot see the one
    edge a scheduler actually uses. `test_REFERENCE_EDGES_ARE_LOAD_BEARING` is the
    control.
    """
    if scope == "<module>":
        return set()
    tree, parents = _parsed(src)
    fns = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    defs = {n.name for n in fns}
    callers: dict[str, set[str]] = {}
    for node in fns:
        me = node.name
        for inner in ast.walk(node):
            ref = None
            if isinstance(inner, ast.Call):
                f = inner.func
                ref = f.id if isinstance(f, ast.Name) else (
                    f.attr if isinstance(f, ast.Attribute) else None)
            elif isinstance(inner, ast.Name) and isinstance(inner.ctx, ast.Load) \
                    and inner.id in defs:
                ref = inner.id
            if ref and ref != me:
                callers.setdefault(ref, set()).add(me)
        outer = _qualname(node, parents, own=False)
        if outer != "<module>":
            callers.setdefault(me, set()).add(outer.rsplit(".", 1)[-1])
    leaf = scope.rsplit(".", 1)[-1]
    frontier, seen = {leaf}, {leaf}
    while frontier:
        nxt: set[str] = set()
        for name in frontier:
            for up in callers.get(name, set()):
                if up not in seen:
                    seen.add(up)
                    nxt.add(up)
        frontier = nxt
    return seen


def _is_add_job(call: str) -> bool:
    return call.rsplit(".", 1)[-1] == "add_job"


def wire_calls_in(src: str, call: str, job_id: str | None = None,
                  id_kw: str = "id") -> list[ast.Call]:
    """Every call whose dotted callee IS `call` or ends in `.<call>` - and, when
    `job_id` is given, whose `<id_kw>=` keyword is exactly that literal. Source order."""
    tree, _ = _parsed(src)
    out: list[ast.Call] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        d = _dotted(node.func)
        if not d or not (d == call or d.endswith("." + call)):
            continue
        if job_id is not None and not any(
                k.arg == id_kw and isinstance(k.value, ast.Constant)
                and k.value.value == job_id for k in node.keywords):
            continue
        out.append(node)
    return sorted(out, key=lambda n: (n.lineno, n.col_offset))


def _wire_target(node: ast.Call, call: str, arg: str | None = None) -> ast.AST | None:
    """What a hop hands control to. A hop naming `arg` hands over that keyword's value
    (a `JobSpec(fn=...)` table entry); `add_job` hands over the JOB (first positional
    or `func=`), never `add_job` itself; any other call hands over its callee."""
    if arg is not None:
        return next((k.value for k in node.keywords if k.arg == arg), None)
    if _is_add_job(call):
        if node.args:
            return node.args[0]
        return next((k.value for k in node.keywords if k.arg == "func"), None)
    return node.func


def _nested_defs(tree: ast.AST, parents: dict[int, ast.AST], scope: str) -> set[str]:
    """Leaf names of the defs lexically INSIDE `scope`.

    ⚰️ The same-scope `add_job` allowance first accepted ANY target registered from
    inside the guard's scope; clause 7's own cut then showed that renaming the job
    left the wire watchdog's chain intact. The job it registers must be one the guard
    itself defines."""
    return {n.name for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and _qualname(n, parents, own=True).startswith(scope + ".")}


def _module_of(rel: str) -> str:
    return rel.removesuffix(".py").replace("/", ".")


def hop_edge_fault(node: ast.Call, hop: dict, anchor_file: str, anchor_scope: str,
                   srcs) -> str | None:
    """None when this call carries control into the anchor; otherwise WHY it does not.

    Same file: the target must be a def that reaches the anchor - or, for an
    `add_job` only, the registration may sit INSIDE the anchor's own scope (the wire
    watchdog registers its nested `_check` from within the very function it is).
    Another file: the name must be BOUND to the anchor's module by an import in the
    hop's file. ⛔ Without that the edge is a coincidence of spelling - a `start`
    exists in dozens of modules, and a leaf-name match would let any of them stand in
    for the one that matters.
    """
    tree, parents = _parsed(srcs(hop["file"]))
    target = _dotted(_wire_target(node, hop["call"], hop.get("arg")))
    if target is None:
        return "its target is not a plain name, so nothing static can follow it"
    leaf = target.rsplit(".", 1)[-1]
    reach = refs_reach(srcs(anchor_file), anchor_scope)
    if hop["file"] == anchor_file:
        if "." in target:
            return f"`{target}` is an attribute, not a def of this module"
        if leaf in reach:
            return None
        enclosing = _qualname(node, parents, own=False)
        if _is_add_job(hop["call"]) and enclosing == anchor_scope \
                and leaf in _nested_defs(tree, parents, anchor_scope):
            return None
        return f"`{leaf}` does not call or reference `{anchor_scope}`"
    mod = _module_of(anchor_file)
    if "." in target:
        base = target.rsplit(".", 1)[0]
        if base not in sink_aliases_in(tree, mod):
            return f"`{base}` is not bound to `{mod}` by any import in {hop['file']}"
    elif leaf not in sink_aliases_in(tree, f"{mod}.{leaf}"):
        return f"`{leaf}` is not imported from `{mod}` in {hop['file']}"
    if leaf not in reach:
        return f"`{mod}.{leaf}` does not call or reference `{anchor_scope}`"
    return None


def verify_chain(root: Path, pred: dict, hops: list[dict], entries: set[str],
                 overrides: dict[str, str] | None = None, *, require_entry: bool = True
                 ) -> tuple[str | None, list[tuple[dict, ast.Call]]]:
    """`(fault or None, [(hop, the call that carried it)])`, walking OUTWARD from the
    guard's scope one hop at a time. Each hop's anchor is the def holding the
    previous hop's call. `overrides` substitutes a file's text, which is how a wire
    is cut without touching the disk."""
    overrides = overrides or {}

    def srcs(rel: str) -> str:
        if rel in overrides:
            return overrides[rel]
        return (root / rel).read_text(encoding="utf-8")

    if not hops:
        return "a chain with no hops", []
    anchor_file, anchor_scope = pred["file"], pred["scope"]
    carried: list[tuple[dict, ast.Call]] = []
    for i, hop in enumerate(hops, 1):
        if not (root / hop["file"]).is_file():
            return f"hop {i}: {hop['file']} does not exist", carried
        cands = wire_calls_in(srcs(hop["file"]), hop["call"], hop.get("job_id"),
                              hop.get("id_kw", "id"))
        if not cands:
            jid = f" with id={hop['job_id']!r}" if hop.get("job_id") else ""
            return f"hop {i}: no call to `{hop['call']}`{jid} in {hop['file']}", carried
        faults: list[str] = []
        for node in cands:
            why = hop_edge_fault(node, hop, anchor_file, anchor_scope, srcs)
            if why is None:
                carried.append((hop, node))
                break
            faults.append(f"line {node.lineno}: {why}")
        else:
            return (f"hop {i}: no call to `{hop['call']}` in {hop['file']} reaches "
                    f"{anchor_file}::{anchor_scope} - " + "; ".join(faults)), carried
        _, parents = _parsed(srcs(hop["file"]))
        anchor_file = hop["file"]
        anchor_scope = _qualname(carried[-1][1], parents, own=False)
    if require_entry and anchor_file not in entries:
        return (f"the chain ends in {anchor_file}, which no Railway service boots "
                f"(boots: {sorted(entries)})"), carried
    return None, carried


def cut_name(src: str, node: ast.AST) -> str:
    """Rename ONE Name / Attribute leaf to `WIRE_CUT`, in memory - the wire is cut and
    nothing else moves.

    ⛔ ast column offsets are UTF-8 BYTE offsets, so the edit is made on bytes (several
    of these files carry non-ASCII), and lines are split on "\\n" only: `splitlines`
    also breaks on form feeds and U+2028, which would shift every line number the AST
    handed back.
    """
    if isinstance(node, ast.Attribute):
        ln, end = node.end_lineno, node.end_col_offset
        start, word = end - len(node.attr), node.attr
    elif isinstance(node, ast.Name):
        ln, start = node.lineno, node.col_offset
        end, word = start + len(node.id), node.id
    else:
        raise AssertionError(f"cannot cut a {type(node).__name__}")
    lines = src.split("\n")
    raw = lines[ln - 1].encode("utf-8")
    assert raw[start:end].decode("utf-8") == word, (raw[start:end], word)
    lines[ln - 1] = (raw[:start] + WIRE_CUT.encode("utf-8") + raw[end:]).decode("utf-8")
    return "\n".join(lines)


def _has_main_guard(src: str) -> bool:
    tree, _ = _parsed(src)
    for node in tree.body:
        if isinstance(node, ast.If) and isinstance(node.test, ast.Compare):
            names = {_dotted(node.test.left)} | {
                c.value for c in node.test.comparators if isinstance(c, ast.Constant)}
            if {"__name__", "__main__"} <= names:
                return True
    return False


ENTRIES = service_entry_modules(ROOT)
SINK_REL = POP_SPEC["sink_module"].replace(".", "/") + ".py"


def _chain_params():
    return [pytest.param(r, id=r["guard"]) for r in OBSERVED
            if (r.get("wire") or {}).get("kind") in ("chain", "table")]


def _is_registration(hop: dict) -> bool:
    """A hop that registers a job rather than calling it - its TARGET is a second
    thing that can be cut (`add_job(_check)`, `JobSpec(fn=_watchdog)`)."""
    return _is_add_job(hop["call"]) or hop.get("arg") is not None


def wire_chains(rec: dict) -> list[tuple[dict, list[dict], bool]]:
    """`[(pred, hops, must_end_in_a_booted_module)]` for one observation.

    A `table` wire is TWO chains with one edge between them that nothing static can
    follow: guard -> the table entry naming it, and the table's dispatcher -> a
    booted module. Both are proved; the edge between is NAMED in `unfollowable`.
    """
    wire = rec.get("wire") or {}
    if wire.get("kind") == "chain":
        return [(rec["predicate"], wire["hops"], True)]
    if wire.get("kind") == "table":
        return [(rec["predicate"], wire["hops"], False),
                (wire["dispatcher"], wire["dispatcher_hops"], True)]
    return []


def test_the_boot_modules_are_READ_from_the_service_configuration():
    """Non-vacuity + named members. A derivation that read nothing would fail every
    chain with "no service boots it" - loud, but for the wrong reason."""
    assert len(ENTRIES) >= 3, sorted(ENTRIES)
    for must in ("api/main.py", "api/worker_main.py"):
        assert must in ENTRIES, (must, sorted(ENTRIES))


def test_the_add_job_matcher_can_answer_YES_and_NO():
    """The L4 shape the backlog names: an AST over `api/main.py` that finds the jobs,
    with a control proving an absent id is answered NO rather than matched loosely."""
    src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert len(wire_calls_in(src, "add_job")) >= MAIN_ADD_JOB_FLOOR
    assert wire_calls_in(src, "add_job", "wire_freshness_watchdog")
    assert not wire_calls_in(src, "add_job", "term018_no_such_job_id")


def test_every_observation_declares_its_wire():
    bad = []
    for rec in OBSERVED:
        wire = rec.get("wire")
        if not isinstance(wire, dict) or wire.get("kind") not in WIRE_KINDS:
            bad.append(f"{rec['guard']}: wire={wire!r}")
            continue
        hops = wire.get("hops")

        def _hops_ok(hs) -> bool:
            return bool(hs) and all(isinstance(h, dict) and h.get("file") and h.get("call")
                                    for h in hs)

        if wire["kind"] in ("chain", "table"):
            if not _hops_ok(hops):
                bad.append(f"{rec['guard']}: a {wire['kind']} needs hops of "
                           f"{{file, call}}: {hops!r}")
        elif hops:
            bad.append(f"{rec['guard']}: a {wire['kind']} wire carries no hops")
        if wire["kind"] == "table":
            disp = wire.get("dispatcher") or {}
            if not (disp.get("file") and disp.get("scope")) \
                    or not _hops_ok(wire.get("dispatcher_hops")):
                bad.append(f"{rec['guard']}: a table names its dispatcher {{file, scope}} "
                           "and the dispatcher's own hops")
            if not (hops and hops[-1].get("job_id")):
                bad.append(f"{rec['guard']}: a table's last hop is the ENTRY, by its id")
            if not str(wire.get("unfollowable") or "").strip():
                bad.append(f"{rec['guard']}: a table must NAME the edge nothing static "
                           "can follow - that is the price of the kind")
    assert not bad, (
        "EVERY OBSERVATION MUST SAY HOW ITS GUARD IS REACHED IN A RUNNING PROCESS:\n  "
        + "\n  ".join(bad)
        + f"\n\n`wire.kind` is one of {WIRE_KINDS}. A guard proved red-before-green "
          "in a test and reached by nothing in production is the CARD 27 shape.")


@pytest.mark.parametrize("rec", _params())
def test_clause7_the_wire_carries_the_guard_into_a_booted_process(rec):
    wire = rec.get("wire") or {}
    pred = rec["predicate"]
    kind = wire.get("kind")
    if kind in ("chain", "table"):
        for start, hops, must_boot in wire_chains(rec):
            fault, carried = verify_chain(ROOT, start, hops, ENTRIES,
                                          require_entry=must_boot)
            assert fault is None, (
                f"THE WIRE TO {rec['guard']} IS BROKEN: {fault}\n"
                "The guard can still be proved red-before-green in its own test and "
                "never run in production. Fix the wiring, or re-declare the chain the "
                "code uses.")
            assert len(carried) == len(hops)
    elif kind == "sink":
        assert pred["file"] == SINK_REL, (
            f"`sink` is reserved for the sink module ({SINK_REL}); "
            f"{pred['file']} must declare the chain that reaches it")
        emits = [g for g in _POPULATION if not g.startswith(SINK_REL + "::")]
        assert len(emits) >= POP_SPEC["emit_site_count_floor"], (
            "a sink's wire IS its producers, and the derivation found too few")
    elif kind == "cli":
        assert not pred["file"].startswith("api/"), (
            f"{pred['file']} is service code; a service guard declares its chain")
        assert _has_main_guard((ROOT / pred["file"]).read_text(encoding="utf-8")), (
            f"{pred['file']} has no `if __name__ == \"__main__\":` - it is not a CLI")
    else:
        pytest.fail(f"undeclared wire for {rec['guard']} - see "
                    "test_every_observation_declares_its_wire")


@pytest.mark.parametrize("rec", _chain_params())
def test_clause7_CUTTING_any_hop_breaks_the_chain(rec):
    """⭐ THE BACKLOG'S "MUTATION-CHECKING THE WIRE", RUN FOR EVERY HOP, EVERY RUN.

    Each hop's call is renamed in memory and the chain must stop verifying; an
    `add_job` hop is cut twice, once at `add_job` and once at the job it names. A
    chain that survives a cut has a SECOND registration carrying the same guard -
    and three copies cannot be mutation-proved (delete every copy but one).
    """
    cut_count = 0
    for start, hops, must_boot in wire_chains(rec):
        fault, carried = verify_chain(ROOT, start, hops, ENTRIES, require_entry=must_boot)
        assert fault is None, fault
        for hop, node in carried:
            src = (ROOT / hop["file"]).read_text(encoding="utf-8")
            cuts = [node.func]
            if _is_registration(hop):
                cuts.append(_wire_target(node, hop["call"], hop.get("arg")))
            for cut in cuts:
                mutated = cut_name(src, cut)
                assert mutated != src
                fault2, _ = verify_chain(ROOT, start, hops, ENTRIES,
                                         overrides={hop["file"]: mutated},
                                         require_entry=must_boot)
                cut_count += 1
                assert fault2 is not None, (
                    f"CUTTING `{_dotted(cut)}` at {hop['file']}:{cut.lineno} LEFT THE "
                    f"CHAIN TO {rec['guard']} INTACT. Something else carries the same "
                    "wire - delete every copy but one, or the survivor cannot be proved.")
    assert cut_count >= 1, f"no hop of {rec['guard']} was cut - the discriminator ran on nothing"


def _plant_service(root: Path, *, main_body: str) -> dict:
    """A miniature estate: one monitor whose only route to its guard is a thread
    TARGET (a reference, never a call), a same-named `start` in an unrelated module,
    a relay module no service boots, and an entry module Railway boots."""
    svc = root / "api" / "services"
    svc.mkdir(parents=True)
    (root / "railway.json").write_text(
        json.dumps({"deploy": {"startCommand": "exec uvicorn api.main:app"}}),
        encoding="utf-8", newline="\n")
    (svc / "mon.py").write_text(
        "import threading\n"
        "def decide(x):\n"
        "    return x > 1\n"
        "def poll_once():\n"
        "    return decide(2)\n"
        "def _loop():\n"
        "    poll_once()\n"
        "def start():\n"
        "    threading.Thread(target=_loop, daemon=True).start()\n"
        "def unrelated():\n"
        "    return 0\n",
        encoding="utf-8", newline="\n")
    (svc / "other.py").write_text("def start():\n    return None\n",
                                  encoding="utf-8", newline="\n")
    (svc / "relay.py").write_text(
        "def go():\n    from api.services import mon\n    mon.start()\n",
        encoding="utf-8", newline="\n")
    (root / "api" / "main.py").write_text(main_body, encoding="utf-8", newline="\n")
    return {"file": "api/services/mon.py", "scope": "decide"}


_PLANTED_MAIN = (
    "def lifespan(app):\n"
    "    from api.services import mon\n"
    "    mon.start()\n"
)


def test_REFERENCE_EDGES_ARE_LOAD_BEARING(tmp_path):
    """CONTROL on `refs_reach`: the monitor's only route from `start` to `decide` is
    `Thread(target=_loop)`. The call-only graph cannot see it; the wire needs it."""
    _plant_service(tmp_path, main_body=_PLANTED_MAIN)
    src = (tmp_path / "api" / "services" / "mon.py").read_text(encoding="utf-8")
    assert "start" in refs_reach(src, "decide")
    assert "start" not in names_that_reach(tmp_path, "api/services/mon.py", "decide")
    assert "unrelated" not in refs_reach(src, "decide")            # ← and it can say NO


def test_the_wire_check_DISTINGUISHES_a_live_wire_from_every_broken_one(tmp_path):
    """MANDATORY DISCRIMINATOR for clause 7, through the real functions: one planted
    chain that must hold, and four breakages that must each be named."""
    pred = _plant_service(tmp_path, main_body=_PLANTED_MAIN)
    entries = service_entry_modules(tmp_path)
    assert entries == {"api/main.py"}, entries
    hops = [{"file": "api/main.py", "call": "mon.start"}]

    fault, carried = verify_chain(tmp_path, pred, hops, entries)
    assert fault is None and len(carried) == 1, fault

    # 1. the call is cut
    main = (tmp_path / "api" / "main.py").read_text(encoding="utf-8")
    cut = cut_name(main, carried[0][1].func)
    assert "mon.start" not in cut
    fault, _ = verify_chain(tmp_path, pred, hops, entries, overrides={"api/main.py": cut})
    assert fault and "no call" in fault, fault

    # 2. the SAME spelling, bound to a different module - a coincidence, refused
    wrong = main.replace("import mon", "import other as mon")
    fault, _ = verify_chain(tmp_path, pred, hops, entries, overrides={"api/main.py": wrong})
    assert fault and "not bound" in fault, fault

    # 3. the call exists and is bound, but never reaches THIS guard
    fault, _ = verify_chain(tmp_path, {**pred, "scope": "unrelated"}, hops, entries)
    assert fault and "does not call or reference" in fault, fault

    # 4. a perfect chain that ends where no service boots
    fault, _ = verify_chain(tmp_path, pred, [{"file": "api/services/relay.py",
                                             "call": "mon.start"}], entries)
    assert fault and "no Railway service boots" in fault, fault


def test_an_add_job_hop_is_held_to_its_literal_id(tmp_path):
    """The scheduler form: a job registered by id, one hop out from the guard."""
    pred = _plant_service(tmp_path, main_body=(
        "def lifespan(app, scheduler):\n"
        "    def _job():\n"
        "        from api.services import mon\n"
        "        mon.start()\n"
        "    scheduler.add_job(_job, id='mon_job', max_instances=1)\n"
    ))
    entries = service_entry_modules(tmp_path)
    hops = [{"file": "api/main.py", "call": "mon.start"},
            {"file": "api/main.py", "call": "add_job", "job_id": "mon_job"}]
    fault, carried = verify_chain(tmp_path, pred, hops, entries)
    assert fault is None and len(carried) == 2, fault
    fault, _ = verify_chain(tmp_path, pred, [hops[0], {**hops[1], "job_id": "other_job"}],
                            entries)
    assert fault and "with id='other_job'" in fault, fault
    main = (tmp_path / "api" / "main.py").read_text(encoding="utf-8")
    job_cut = cut_name(main, _wire_target(carried[1][1], "add_job"))
    fault, _ = verify_chain(tmp_path, pred, hops, entries, overrides={"api/main.py": job_cut})
    assert fault and "does not call or reference" in fault, fault


def test_a_table_entry_is_held_to_its_id_and_its_fn_and_cannot_pass_as_a_whole_chain(tmp_path):
    """The dispatch-table form (Wisdom's `JobSpec(job_id=..., fn=...)`): the entry is
    proved to name a def that reaches the guard - and the half-chain that ends in the
    table is REFUSED when asked to stand in for a wire into a booted module."""
    pred = _plant_service(tmp_path, main_body=_PLANTED_MAIN)
    (tmp_path / "api" / "services" / "tbl.py").write_text(
        "from api.services import mon\n"
        "def _job(ctx):\n"
        "    return mon.start()\n"
        "JOBS = [Spec(job_id='tbl_job', fn=_job)]\n",
        encoding="utf-8", newline="\n")
    entries = service_entry_modules(tmp_path)
    hops = [{"file": "api/services/tbl.py", "call": "mon.start"},
            {"file": "api/services/tbl.py", "call": "Spec", "arg": "fn",
             "id_kw": "job_id", "job_id": "tbl_job"}]
    fault, carried = verify_chain(tmp_path, pred, hops, entries, require_entry=False)
    assert fault is None and len(carried) == 2, fault
    fault, _ = verify_chain(tmp_path, pred, hops, entries)             # ← whole-chain ask
    assert fault and "no Railway service boots" in fault, fault
    fault, _ = verify_chain(tmp_path, pred, [hops[0], {**hops[1], "job_id": "nope"}],
                            entries, require_entry=False)
    assert fault and "with id='nope'" in fault, fault
    tbl = (tmp_path / "api" / "services" / "tbl.py").read_text(encoding="utf-8")
    fn_cut = cut_name(tbl, _wire_target(carried[1][1], "Spec", "fn"))
    fault, _ = verify_chain(tmp_path, pred, hops, entries, require_entry=False,
                            overrides={"api/services/tbl.py": fn_cut})
    assert fault and "does not call or reference" in fault, fault


#: The two checks the CI job cannot run (they collect the product's own tests).
CI_ONLY_LOCAL = ("test_the_pytest_collection_probe_can_answer_NO",
                 "test_clause5c_every_observing_test_is_COLLECTED_by_pytest")
CI_WORKFLOW = ROOT / ".github" / "workflows" / "term018-guards.yml"


def test_the_CI_job_deselects_exactly_the_two_collection_checks():
    """The shipping wire for THIS rail. The job may drop the two checks that need the
    product installed - by exact node id - and nothing else; it must keep full history
    (clause 6) and skip the product-importing conftests. A deselect list that grew, or a
    `-k` filter, would let the job go green on a rail that had quietly stopped running."""
    text = CI_WORKFLOW.read_text(encoding="utf-8")
    here = Path(__file__).name
    assert f"tests/{here}" in text, "the workflow no longer runs this rail"
    deselected = re.findall(r"--deselect\s+(\S+)", text)
    assert sorted(deselected) == sorted(f"tests/{here}::{n}" for n in CI_ONLY_LOCAL), deselected
    names = pytest_test_names_in(Path(__file__).read_text(encoding="utf-8"))
    assert set(CI_ONLY_LOCAL) <= names, "a deselected id names a test that does not exist"
    assert not re.search(r"\s-k\s", text), "a -k filter can silently match nothing"
    assert re.search(r"fetch-depth:\s*0\b", text), "clause 6 needs the full history"
    assert "--noconftest" in text


# ══════════════════════════════════════════════════════════════════════════════
#  F. CLAUSE 8 - NO SEAM IN THE GUARD'S REACH IS BOUND AT IMPORT
# ══════════════════════════════════════════════════════════════════════════════

def import_bound_defaults(src: str, only: set[str] | None = None) -> tuple[list[str], int]:
    """`([violations], parameter defaults inspected)`.

    A violation is a default that is a module-level def or class, a name imported
    INTO the module, or an attribute rooted at an imported module (`clock=time.time`)
    - each evaluated ONCE, at import. An UPPER_CASE leaf is a constant, not a seam,
    and is skipped. `only` restricts the walk to defs with those leaf names.
    """
    tree, _ = _parsed(src)
    bound: set[str] = set()
    modules: set[str] = set()
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(n.name)
        elif isinstance(n, ast.Import):
            for a in n.names:
                modules.add((a.asname or a.name).split(".")[0])
        elif isinstance(n, ast.ImportFrom):
            for a in n.names:
                bound.add(a.asname or a.name)
    out: list[str] = []
    seen = 0
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if only is not None and fn.name not in only:
            continue
        a = fn.args
        pos = a.posonlyargs + a.args
        pairs = list(zip(pos[len(pos) - len(a.defaults):], a.defaults))
        pairs += [(k, d) for k, d in zip(a.kwonlyargs, a.kw_defaults) if d is not None]
        for arg, d in pairs:
            seen += 1
            leaf = _dotted(d)
            if leaf is None or leaf.rsplit(".", 1)[-1].isupper():
                continue
            head = leaf.split(".", 1)[0]
            if ("." not in leaf and head in bound) or ("." in leaf and head in (modules | bound)):
                out.append(f"{fn.name}({arg.arg}={leaf}) line {d.lineno}")
    return out, seen


def _seam_scope(rec: dict) -> set[str] | None:
    """The defs a monitor's observing test would patch its way into: everything that
    reaches the guard, plus the guard's own nested defs."""
    pred = rec["predicate"]
    if pred["scope"] == "<module>":
        return None
    src = (ROOT / pred["file"]).read_text(encoding="utf-8")
    tree, parents = _parsed(src)
    return refs_reach(src, pred["scope"]) | _nested_defs(tree, parents, pred["scope"])


_MONITOR_KINDS = ("chain", "table", "sink")


def _monitor_params():
    return [pytest.param(r, id=r["guard"]) for r in OBSERVED
            if (r.get("wire") or {}).get("kind") in _MONITOR_KINDS]


@pytest.mark.parametrize("rec", _monitor_params())
def test_clause8_no_seam_in_the_guards_reach_is_bound_at_import(rec):
    src = (ROOT / rec["predicate"]["file"]).read_text(encoding="utf-8")
    bad, _ = import_bound_defaults(src, _seam_scope(rec))
    assert not bad, (
        f"SEAMS BOUND AT IMPORT in the reach of {rec['guard']}:\n  " + "\n  ".join(bad)
        + "\n\nA default is evaluated once, when the module loads, so a test that "
          "monkeypatches the module attribute reaches nothing and the observation "
          "exercises the real function. Default it to None and resolve it in the body.")


def test_clause8_inspected_real_defaults_in_the_guards_reach():
    """Non-vacuity: across every monitor's reach the walk read parameter defaults, so
    "no violation" is an answer about defaults rather than about an empty walk."""
    total = 0
    for rec in OBSERVED:
        if (rec.get("wire") or {}).get("kind") in _MONITOR_KINDS:
            src =(ROOT / rec["predicate"]["file"]).read_text(encoding="utf-8")
            total += import_bound_defaults(src, _seam_scope(rec))[1]
    assert total >= 5, f"only {total} parameter defaults inspected - a failed walk"


def test_the_seam_detector_can_answer_YES_and_NO():
    """CONTROL: the two real shapes are caught (`scripts/deploy_watch.py`'s
    `probe_fn=probe`, and a module attribute), and a late-bound seam, a constant and a
    literal are not."""
    src = (
        "import time\n"
        "from api.x import probe, MAX_ROWS\n"
        "def helper():\n"
        "    return 1\n"
        "def f(a, probe_fn=probe, clock=time.time, *, read=None, cap=MAX_ROWS, n=5,\n"
        "      fallback=helper):\n"
        "    return a\n"
        "def g(x=None):\n"
        "    return x\n"
    )
    bad, seen = import_bound_defaults(src)
    assert seen == 7, seen
    assert sorted(b.split(" line")[0] for b in bad) == [
        "f(clock=time.time)", "f(fallback=helper)", "f(probe_fn=probe)"], bad
    assert import_bound_defaults(src, {"g"}) == ([], 1)             # ← scoped, and clean
