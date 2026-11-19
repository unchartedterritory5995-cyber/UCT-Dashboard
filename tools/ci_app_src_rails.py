"""Which pytest files READ app/src, and does a pull-request job that triggers on app/src run every one of them?

    python tools/ci_app_src_rails.py --census            # every app/src-reading pytest file, what it reads, who runs it
    python tools/ci_app_src_rails.py --check             # exit 1 when one is run by no PR job that app/src triggers
    python tools/ci_app_src_rails.py --print-list        # the rails the `app-src-pytest` job runs (all its shards)
    python tools/ci_app_src_rails.py --plan --changed changed.txt      # count=/n=/shards= for this PR's diff
    python tools/ci_app_src_rails.py --write-args a.txt --shard 2/4 --changed changed.txt   # one shard's pytest args
    python tools/ci_app_src_rails.py --json out.json     # the census as JSON

The home: the `app-src-pytest` job of .github/workflows/whole-app-engine-rails.yml (sharded, offline, the production
dependency set). The rail: tests/test_ci_app_src_rails.py, run by that workflow's `rails` job.

WHY (2026-11-19). #1998, a browser-only change, added the refusal-guard literal 'runtime:objects-withheld' to
app/src/components/chart/builder/runsHere.js without registering it in supportLoop/refusalCodes.json. All 52 of its
PR checks were green; master then went red on tests/test_support_loop_refusal_codes.py (and the
`tools/support_loop/refusal_codes.py --check` it wraps). That rail lives in tests/ but READS app/src, and no
pull-request job ran it, so a PR that changed app/src never met it. #2021 fixed it forward. This tool closes the
CLASS: every pytest file that reads app/src is named by a step of a PR job whose trigger covers what it reads, or it
is on EXEMPT with the reason it is deliberately not.

WHAT "READS app/src" MEANS HERE (static, over the AST; CODE, NEVER PROSE: a docstring or a comment never counts):
  * a path expression that resolves under app/src: `ROOT / "app" / "src" / ...`, `Path(ROOT, "app", "src")`,
    `os.path.join(...)`, `.joinpath`, `.glob/.rglob`, an f-string or a `+` over the repo root, a name bound to one,
    a bare relative literal handed to `open()` / `Path()` (pytest runs from the repo root);
  * a subprocess whose `cwd` is app/ (node / npx / vitest import app/src), or whose argv names app/src;
  * a path made of a name that holds several strings (a loop over literals, tuple unpacking included, a parametrized
    argument, a parameter of the file's own helper at its call sites): every string it can hold is read;
  * an import of, or a subprocess / importlib / runpy over, a module in tools/, scripts/ or tests/ (a helper) that
    itself reads app/src by the rules above, followed transitively. (Over-approximate on purpose: a test is charged
    with every read its helpers CAN make, which can only add a run, never hide one.)
  NOT counted: the server reading its own contract files (api/services/indicator_support.py reads
  supportLoop/refusalCodes.json at import, so every test that imports it reads app/src too). That is the PRODUCT
  reading a file, not a rail checking two languages agree, and following it would put most of the suite here.
  NOT seen (a static scan's limits, stated): a path assembled from data read at run time (a JSON fixture naming a
  file), a path a third-party library resolves, a path built by `getattr` or `eval`.

WHAT "RUN BY A PR JOB" MEANS: a job of a workflow with a `pull_request` trigger names the file in a step (a literal
path or a glob in `run:`, in the job's matrix or env, or a list a named tool prints: LIST_TOOLS), AND that trigger
covers every app/src path the file reads (no path filter, or a `paths:` glob that matches it; a walk of a directory
needs a glob that matches a file added under it). A job that names the file but triggers only on another part of
app/src does not count, because a PR that changes what the file reads still does not run it.

THE LIST IS DERIVED (print_list): the census, minus EXEMPT (deliberately not run on a PR, whole file), minus a
KNOWN_RED whole file, minus what another PR job already runs under a covering trigger. KNOWN_RED test ids run as
STRICT xfails (this module is the job's pytest plugin), so an entry goes red the day its test goes green. TOOL_CHECKS
are tool commands that must run as commands on the PR. judge() is the rail; it fails on a reader no PR runs, a stale
or reasonless EXEMPT/KNOWN_RED entry, a missing home step, and a TOOL_CHECKS command no PR step runs.

PATH-AWARE ON A PR (select): only the rails whose read set, own file, helpers, or imported api/ and services/ modules
the PR changes run; all of them when it changes something in RUN_ALL_ON or the diff is unknown. What the static scan
cannot see (above) is the nightly full suite's: full-suite-report.yml runs every file under tests/.

Standard library + PyYAML.
"""
from __future__ import annotations

import argparse
import ast
import glob as _glob
import json
import os
import pathlib
import posixpath
import re
import shlex
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = pathlib.Path(".github") / "workflows"
#: the workflow and the (sharded) job whose step runs this tool's list, and the step's name
HOME_WORKFLOW = "whole-app-engine-rails.yml"
HOME_JOB = "app-src-pytest"
HOME_STEP = "The app/src pytest rails, this shard (tools/ci_app_src_rails.py --write-args)"
APP_SRC = "app/src"
#: per-file recorded pytest seconds (the nightly's), to cut the list into shards of equal time
TIMINGS = pathlib.Path("tools") / "pytest_shard_timings.json"
#: a file the timings do not know is charged this much (ms): the median of the list on 2026-11-19 was ~1 s
UNKNOWN_MS = 3000

#: Rails that read app/src and are DELIBERATELY not run on a pull request, whole file. Each entry is a reason a reviewer
#: can argue with; an entry for a file that is no longer an app/src reader, or that a PR job now runs, is an error.
EXEMPT: dict[str, str] = {}

#: Tests RED on a clean runner on master when this list was cut. The home job runs each one as a STRICT xfail (this
#: module is loaded as a pytest plugin, `-p tools.ci_app_src_rails`): red stays green, and the day one PASSES the job
#: goes red with "delete its KNOWN_RED line", so an entry cannot outlive its red. A key with no `::` drops the whole
#: file, for a file that cannot even be collected there.
#: Measured with `python tools/remote_tests.py --pytest <the list>` on master 7dc696c0eb, 2026-11-19 (runs 44546651483,
#: 44546724286, 44546805460). Each is a red no PR job used to see, now named instead of hidden: fix the test or what it
#: checks, then DELETE its line here. ⛔ NOT here, on purpose: tests/test_support_loop_refusal_codes.py, the #1998 red,
#: which #2021 fixed. ⚰️ test_support_loop_tools.py's `..\\escape.pine` case left on 2026-11-19: #2035 made a backslash
#: a separator on every platform, so it is green on Linux now. ⚰️ test_user_definition_reproof.py's PUT-route rail left
#: the same day: #2037 named the second, intended PUT route (assistant memory). ⚰️ So did the run-half rail: #2039
#: narrowed it to the codes actually passed to refuse(...) ('lost-drawings' is never sent).
KNOWN_RED: dict[str, str] = {
    "tests/test_canonical_address_book.py":
        "cannot be COLLECTED: _ohlcv_ddl() asserts one ohlcv DDL in CODE and finds 0 (the parametrize runs at import)",
    "tests/test_a12_s6_consistency_rail.py::test_column_presets_have_a_typed_store_now":
        "AssertionError: the write side is gone (the column-presets store this rail pins moved)",
    "tests/test_entitlements_manifest.py::test_the_checked_in_manifest_IS_what_the_declarations_derive":
        "the checked-in entitlements manifest is not what the declarations derive: regenerate it",
    "tests/test_gate_box_lock.py::test_a_DEAD_holder_is_reclaimed_AND_the_reclaim_is_recorded":
        "dev-PC lock (scripts/gate_shards.py's box lock): on a runner a live pid reads as the holder (LockHeld)",
    "tests/test_gate_box_lock.py::test_R3_a_bypassed_run_under_a_live_holder_still_lands_INCONCLUSIVE_CONTENDED":
        "dev-PC lock: shells out to `powershell`, which a Linux runner does not have (FileNotFoundError)",
    "tests/test_gate_box_lock.py::test_the_load_reading_NEVER_changes_the_holder_contract":
        "dev-PC lock: pid 999999 reads as a live holder on a runner (LockHeld), so the contract cannot be probed there",
    "tests/test_gate_box_lock.py::test_the_lock_self_check_still_passes_end_to_end":
        "dev-PC lock: the self-check finds the running pytest itself as the holder on a runner (LockHeld)",
    "tests/test_gate_shards.py::test_the_read_set_covers_every_root_relative_path_the_suite_reads":
        "paths the suite reads are missing from GATE_READ_PATHS, so a re-derivation would carry a verdict across them",
    "tests/test_journal_styles_schema.py::test_the_committed_fixture_is_what_the_composer_makes_now":
        "the composer's output moved: regenerate journalStylesComposed.json and let its schema test judge the diff",
    "tests/test_notebook_campaign_clock.py::test_the_shared_data_root_is_refused[C:\\\\DATA\\\\clock]":
        "Windows path semantics: on Linux `C:\\DATA\\clock` is a relative name, so the refusal it pins cannot fire there",
    "tests/test_notebook_campaign_clock.py::test_the_shared_data_root_is_refused[c:\\\\data\\\\sub\\\\x]":
        "Windows path semantics: on Linux `c:\\data\\sub\\x` is a relative name, so the refusal it pins cannot fire there",
    "tests/test_notebook_upload_cap_2.py::test_reader_door_without_a_session_reads_no_body[/api/j2/entry-context/why]":
        "AttributeError: api.services.journal_two.entry_context has no attribute 'FLAG' (the flag this door read moved)",
    "tests/test_notebook_upload_cap_2.py::test_reader_door_without_a_session_reads_no_body"
    "[/api/j2/plan-grades/trades/t1/relink]":
        "AttributeError: api.services.journal_two.plan_grading has no attribute 'FLAG' (the flag this door read moved)",
    "tests/test_notebook_upload_cap_2.py::test_reader_door_without_a_session_reads_no_body[/api/j2/template-gallery]":
        "AttributeError: api.services.journal_two.template_gallery has no attribute 'FLAG' (the door's flag moved)",
    "tests/test_notebook_upload_cap_2.py::test_reader_door_without_a_session_reads_no_body"
    "[/api/j2/template-gallery/g1/report]":
        "AttributeError: api.services.journal_two.template_gallery has no attribute 'FLAG' (the door's flag moved)",
    "tests/test_persistence_manifest_server_keys.py::test_every_server_preference_is_declared_in_the_manifest":
        "5 server preference keys missing from the persistence manifest: `node tools/persistence_census.mjs --write`",
    "tests/test_scan_not_computable_inputs.py::test_EVERY_declared_BAR_READER_is_swept__DERIVED_FROM_THE_MANIFEST":
        "openingRangeHigh: the 'computable' fixture produced no value, so the 'holed' assertions would pass vacuously",
    # ⛔ red on master SINCE #2016 (c4f411c38c, 2026-11-19 16:51Z, admit:request-other): the server now admits the
    # request-other strategies, and neither strategyServeCensus.test.js's SERVER_ADMITS nor this rail's control was
    # re-latched. No PR job ran this rail on #2016; this job, the first time it ran after, found it.
    "tests/test_strategy_serve_arming.py::test_the_server_admits_exactly_the_census_list":
        "since #2016: the server admits 5 more strategies (request-other) than SERVER_ADMITS in the JS census latches",
    "tests/test_strategy_serve_arming.py::test_CONTROL_admission_is_a_door_not_a_pin":
        "since #2016: request-other is admitted now, so the control's (False, ['request-other']) reads (True, [])",
    "tests/test_terminal_next_kill_switch.py::test_every_frontend_gate_answers_from_the_payload_the_switch_empties":
        "a new frontend Terminal-Next gate exists and is not acknowledged in ACKNOWLEDGED_FRONTEND_GATES",
    "tests/test_voice_client_request_shapes.py::test_the_declared_exceptions_are_exactly_the_ones_that_exist":
        "the declared request-shape exceptions no longer equal the client's actual exceptions (the set moved)",
    "tests/test_widget_definitions_router.py::test_w10_plans_run_at_every_door_while_w10_is_on":
        "a W10 plan door answers None where 100.0 is pinned (assert None == 100.0)",
}

#: Tool checks that read app/src and must run, AS COMMANDS, on the PR that changes what they read (each also has a
#: pytest wrapper in the census; the command is the seconds-cheap, no-network form a reader of the log can rerun).
#: judge() fails when no pull_request job's step runs one under a trigger covering the tool's reads.
TOOL_CHECKS = (
    "python tools/support_loop/refusal_codes.py --check",       # #1998's miss: a guard literal the server never stores
)

#: Tools whose stdout (or whose function) is a list of test files a workflow step runs. {tool path: how to list}.
#: A step that runs one of these names every file it lists.
LIST_TOOLS = {
    "tools/run_gate_pine_rails.py": "gate_pine",
    "tools/bars_gate_rails.py": "bars",
    "tools/ci_app_src_rails.py": "self",
}

_ROOTISH = re.compile(r"^_*(ROOT|REPO|REPO_ROOT|PROJECT_ROOT|ROOT_DIR|REPO_DIR|BASE_DIR|REPOSITORY)$", re.I)
_PATH_CTORS = {"Path", "PurePath", "PosixPath", "WindowsPath", "PurePosixPath"}
_SUBPROCESS = {"run", "Popen", "check_output", "check_call", "call", "getoutput", "getstatusoutput"}
_TEST_FILE = re.compile(r"(^|/)(test_[^/]*|[^/]*_test)\.py$")
_SKIP_DIRS = {"__pycache__", "node_modules", ".pytest_cache"}


# ── evaluating path expressions ─────────────────────────────────────────────────────────────────────────────────

class _Unknown:
    """A path value this evaluator cannot resolve (tmp_path, a parameter, an env lookup)."""


UNKNOWN = _Unknown()


def _join(*parts):
    """Repo-relative join; None (unknown) poisons the result; a part above the repo root is unknown."""
    if any(p is None or p is UNKNOWN for p in parts):
        return None
    out = ""
    for p in parts:
        if not isinstance(p, str):
            return None
        p = p.replace("\\", "/")
        if p.startswith("/"):
            return None                                         # an absolute path is outside the repo
        out = posixpath.join(out, p) if out else p
    out = posixpath.normpath(out) if out else ""
    if out == ".":
        return ""
    if out.startswith(".."):
        return None
    return out


def _up(v, n=1):
    if not isinstance(v, str):
        return None
    for _ in range(n):
        if v in ("", "."):
            return None
        v = posixpath.dirname(v)
    return v


def _dotted(node) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return f"{base}.{node.attr}" if base else ""
    return ""


class _Eval:
    """Resolve an expression to a repo-relative path string (or None) given name bindings."""

    def __init__(self, rel_file: str, env: dict):
        self.file = rel_file
        self.env = env

    def __call__(self, node):
        try:
            return self._ev(node, 0)
        except RecursionError:
            return None

    def _ev(self, n, depth):
        if depth > 40:
            return None
        ev = lambda x: self._ev(x, depth + 1)  # noqa: E731
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            return n.value
        if isinstance(n, ast.Name):
            if n.id == "__file__":
                return self.file
            if n.id in self.env:
                return self.env[n.id]
            if _ROOTISH.match(n.id):
                return ""
            return None
        if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div):
            return _join(ev(n.left), ev(n.right))
        if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Add):
            l, r = ev(n.left), ev(n.right)
            if isinstance(l, str) and isinstance(r, str):
                if r.startswith("/") or r.startswith(os.sep):
                    return _join(l, r.lstrip("/\\"))
                return l + r
            return None
        if isinstance(n, ast.JoinedStr):
            out = ""
            for v in n.values:
                if isinstance(v, ast.Constant):
                    out += str(v.value)
                elif isinstance(v, ast.FormattedValue):
                    x = ev(v.value)
                    if not isinstance(x, str):
                        return None
                    out += x if x else "."
                else:
                    return None
            return _join(out) if out.startswith(".") else out
        if isinstance(n, ast.Attribute):
            if n.attr == "parent":
                return _up(ev(n.value))
            return None
        if isinstance(n, ast.Subscript):
            # X.parents[k]
            if isinstance(n.value, ast.Attribute) and n.value.attr == "parents":
                idx = n.slice
                if isinstance(idx, ast.Constant) and isinstance(idx.value, int):
                    return _up(ev(n.value.value), idx.value + 1)
            return None
        if isinstance(n, ast.Call):
            f = _dotted(n.func)
            last = f.rsplit(".", 1)[-1]
            args = n.args
            if last in _PATH_CTORS and f in (last, f"pathlib.{last}"):
                return _join(*[ev(a) for a in args]) if args else ""
            if f in ("os.path.join", "posixpath.join", "ntpath.join"):
                return _join(*[ev(a) for a in args])
            if f in ("os.path.dirname", "posixpath.dirname"):
                return _up(ev(args[0])) if args else None
            if f in ("os.path.abspath", "os.path.realpath", "os.path.normpath", "str", "os.fspath",
                     "pathlib.Path.resolve") and args:
                return ev(args[0])
            if isinstance(n.func, ast.Attribute):
                base = n.func.value
                if n.func.attr in ("resolve", "absolute", "expanduser", "as_posix") and not args:
                    return ev(base)
                if n.func.attr == "replace" and len(args) == 2 and ev(args[0]) in ("/", "\\"):
                    return ev(base)                             # `rel.replace("/", os.sep)`: the same path
                if n.func.attr == "joinpath":
                    return _join(ev(base), *[ev(a) for a in args])
                if n.func.attr == "with_name" and args:
                    return _join(_up(ev(base)), ev(args[0]))
            return None
        return None


def _glob_prefix(pattern: str) -> str:
    """The directory a glob pattern walks: its segments before the first wildcard."""
    segs = []
    for s in pattern.replace("\\", "/").split("/"):
        if any(c in s for c in "*?["):
            break
        segs.append(s)
    return "/".join(segs)


def _under(v, prefix=APP_SRC) -> bool:
    return isinstance(v, str) and (v == prefix or v.startswith(prefix + "/"))


def _as_read(v: str) -> str:
    """A read as the trigger check takes it: a glob is the directory it walks."""
    return _glob_prefix(v).rstrip("/") if any(c in v for c in "*?[") else v.rstrip("/")


def _walk(tree) -> list:
    """Every node of a parsed module, walked ONCE and kept on the tree (the scan asks for it many times)."""
    nodes = getattr(tree, "_uct_nodes", None)
    if nodes is None:
        nodes = list(ast.walk(tree))
        tree._uct_nodes = nodes
    return nodes


def _docstring_ids(tree) -> set:
    out = set()
    for node in _walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                out.add(id(body[0].value))
    # any bare string expression statement is prose too
    for node in _walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, (ast.Constant, ast.JoinedStr)):
            out.add(id(node.value))
    return out


def _bindings(tree, ev_factory) -> tuple[dict, set, dict]:
    """(name -> resolved path, {names bound to a PATH expression}, name -> [string literals of a list/tuple/set])
    from every simple assignment, in source order, three passes (a later name can feed an earlier use). A name bound
    to two different values keeps the first that resolved. A name bound to a bare string literal is a STRING, not a
    path: it is a read only where a path is made of it (`ROOT / NAME`, `open(NAME)`), never by being mentioned."""
    env: dict = {}
    origin: dict = {}
    paths: set = set()
    seqs: dict = {}
    assigns = []
    for node in _walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            assigns.append((node.targets[0].id, node.value))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            assigns.append((node.target.id, node.value))
        elif isinstance(node, ast.NamedExpr) and isinstance(node.target, ast.Name):
            assigns.append((node.target.id, node.value))
    for name, value in assigns:
        if isinstance(value, (ast.List, ast.Tuple, ast.Set)):
            lits = [e.value for e in value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
            if lits:
                seqs.setdefault(name, lits)
    for _ in range(3):
        ev = ev_factory(env)
        for name, value in sorted(assigns, key=lambda a: (a[1].lineno, a[1].col_offset)):
            v = ev(value)
            if isinstance(v, str) and name not in env:
                env[name] = v
                origin[name] = value
            # a PATH name is one whose value came from something that makes a path; a name bound to a string, or to
            # another name that holds only a string, is still a string
            o = origin.get(name)
            if o is not None and not isinstance(o, ast.Constant) and not (
                    isinstance(o, ast.Name) and o.id not in paths and not _ROOTISH.match(o.id)):
                paths.add(name)
    return env, paths, seqs


_MAX_VALUES = 400


def _lits(node, ev, seqs) -> list | None:
    """The string literals an iterable expression yields, or None when it is not a literal sequence."""
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return list(node.elts)
    if isinstance(node, ast.Name) and node.id in seqs:
        return [ast.Constant(value=v) for v in seqs[node.id]]
    if isinstance(node, ast.Call) and _dotted(node.func) in ("sorted", "list", "tuple", "set", "reversed") \
            and node.args:
        return _lits(node.args[0], ev, seqs)
    return None


def _string_values(tree, ev, seqs) -> dict:
    """{name: {strings it can hold}} from loops (tuple unpacking included), comprehensions, parametrize decorators and
    the call sites of this file's own functions. Scope-blind on purpose: a name's strings are the union over the file,
    which can only ADD candidate reads, never hide one. A fixed point, bounded."""
    values: dict = {}
    funcs = {n.name: n for n in _walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    seq_names = {}
    for node in _walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) \
                and isinstance(node.value, (ast.List, ast.Tuple, ast.Set, ast.Dict)):
            elts = node.value.keys if isinstance(node.value, ast.Dict) else node.value.elts
            seq_names[node.targets[0].id] = [e for e in elts if e is not None]

    def strings(n) -> set:
        if isinstance(n, ast.Name) and n.id in values:
            return set(values[n.id])
        v = ev(n)
        return {v} if isinstance(v, str) else set()

    def bind(target, n):
        if isinstance(target, ast.Name):
            s = strings(n)
            if s:
                cur = values.setdefault(target.id, set())
                if len(cur) < _MAX_VALUES:
                    cur.update(s)
        elif isinstance(target, (ast.Tuple, ast.List)) and isinstance(n, (ast.Tuple, ast.List)) \
                and len(target.elts) == len(n.elts):
            for t, e in zip(target.elts, n.elts):
                bind(t, e)

    def over(target, it):
        elts = None
        if isinstance(it, ast.Name) and it.id in seq_names:
            elts = seq_names[it.id]
        else:
            elts = _lits(it, ev, seqs)
        if isinstance(it, ast.Call) and isinstance(it.func, ast.Attribute) and it.func.attr in ("items", "keys") \
                and isinstance(it.func.value, ast.Name) and it.func.value.id in seq_names:
            elts = seq_names[it.func.value.id]
            if isinstance(target, ast.Tuple) and it.func.attr == "items":
                target = target.elts[0]
        if elts is None:
            return
        for e in elts:
            bind(target, e)

    relevant = [n for n in _walk(tree)
                if isinstance(n, (ast.For, ast.AsyncFor, ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp))
                or (isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.decorator_list)
                or (isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in funcs)]
    for _ in range(3):
        for node in relevant:
            if isinstance(node, (ast.For, ast.AsyncFor)):
                over(node.target, node.iter)
            elif isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
                for g in node.generators:
                    over(g.target, g.iter)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in node.decorator_list:
                    if isinstance(dec, ast.Call) and _dotted(dec.func).endswith("parametrize") and len(dec.args) >= 2:
                        names = ev(dec.args[0])
                        if not isinstance(names, str):
                            continue
                        names = [x.strip() for x in names.split(",") if x.strip()]
                        target = (ast.Name(id=names[0]) if len(names) == 1
                                  else ast.Tuple(elts=[ast.Name(id=x) for x in names]))
                        over(target, dec.args[1])
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in funcs:
                fn = funcs[node.func.id]
                params = [a.arg for a in fn.args.posonlyargs + fn.args.args]
                for p, a in zip(params, node.args):
                    bind(ast.Name(id=p), a)
                for kw in node.keywords:
                    if kw.arg in params:
                        bind(ast.Name(id=kw.arg), kw.value)
    return {k: {s.replace("\\", "/") for s in v} for k, v in values.items()}


def _multi_reads(tree, ev, values, prose) -> set:
    """The app/src paths made of a many-valued name: `ROOT / name`, `Path(ROOT, name)`, `os.path.join(ROOT, name)`,
    `ROOT.joinpath(name)`, `open(name)`, `Path(name)` (a bare relative path: pytest runs from the repo root)."""
    out: set = set()

    def multi(n) -> set:
        if isinstance(n, ast.Name) and n.id in values:
            return set(values[n.id])
        v = ev(n)
        return {v} if isinstance(v, str) else set()

    def joins(parts) -> set:
        acc = {""}
        for p in parts:
            vs = multi(p)
            if not vs:
                return set()
            acc = {x for a in acc for b in vs for x in [_join(a, b)] if isinstance(x, str)}
            if len(acc) > _MAX_VALUES:
                return set()
        return acc

    for node in _walk(tree):
        if id(node) in prose:
            continue
        cand: set = set()
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div) and isinstance(node.right, ast.Name) \
                and node.right.id in values:
            cand = joins([node.left, node.right])
        elif isinstance(node, ast.Call) and any(isinstance(a, ast.Name) and a.id in values for a in node.args):
            f = _dotted(node.func)
            last = f.rsplit(".", 1)[-1]
            if (last in _PATH_CTORS and f in (last, f"pathlib.{last}")) or f in ("os.path.join", "open", "io.open"):
                cand = joins(node.args if f not in ("open", "io.open") else node.args[:1])
            elif isinstance(node.func, ast.Attribute) and node.func.attr == "joinpath":
                cand = joins([node.func.value] + list(node.args))
        out |= {c for c in cand if _under(c)}
    return out


# ── one file: what it reads directly, and which modules it reaches ──────────────────────────────────────────────

def _read_targets(tree, rel_file: str) -> tuple[set, set]:
    """({app/src paths this module reads}, {repo-relative .py files it names as a path: tools it runs})."""
    reads: set = set()
    env, path_names, seqs = _bindings(tree, lambda e: _Eval(rel_file, e))
    ev = _Eval(rel_file, env)
    prose = _docstring_ids(tree)
    # a sub-expression that only BUILDS a longer path is not a read of itself: `ROOT / "app" / "src" / "x.js"` reads
    # x.js, not the whole of app/src. So the left operand of a `/` or `+`, the base of `.joinpath/.glob/...`, the
    # value under `.parent`, an assignment's value and an argument of a path constructor are judged through what is
    # made of them, never alone. A path NAME used any other way (`.read_text()`, `.as_uri()`, a call argument) is read.
    builds: set = set()
    for node in _walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Div, ast.Add)):
            builds.add(id(node.left))
            builds.add(id(node.right))
        elif isinstance(node, ast.Call):
            f = _dotted(node.func)
            last = f.rsplit(".", 1)[-1]
            if isinstance(node.func, ast.Attribute) and node.func.attr in (
                    "joinpath", "glob", "rglob", "with_name", "with_suffix", "relative_to"):
                builds.add(id(node.func.value))
            if (last in _PATH_CTORS and f in (last, f"pathlib.{last}")) or f in (
                    "os.path.join", "posixpath.join", "ntpath.join", "os.path.dirname", "os.path.abspath",
                    "os.path.realpath", "os.path.normpath", "str", "os.fspath", "os.walk", "os.listdir",
                    "os.scandir", "open", "io.open", "codecs.open", "glob.glob", "glob.iglob"):
                builds |= {id(a) for a in node.args}
        elif isinstance(node, ast.Attribute) and node.attr in ("parent", "parents"):
            builds.add(id(node.value))
        elif isinstance(node, ast.Subscript):
            builds.add(id(node.value))
        elif isinstance(node, ast.JoinedStr):
            builds |= {id(v.value) for v in node.values if isinstance(v, ast.FormattedValue)}
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            builds.add(id(node.value))
    named_py: set = set()
    # A name can stand for SEVERAL strings: a loop variable, a parametrized argument, a helper's parameter. Where a
    # path is made of such a name, every string it can hold is read:
    #   for rel in ("app/src/a.js", "app/src/b.js"): (ROOT / rel).read_text()
    #   @pytest.mark.parametrize("rel", PAGES) ... (ROOT / rel).read_text()
    #   def _js(path): return (REPO / path).read_text()   ...   _js("app/src/x.js")
    values = _string_values(tree, ev, seqs)
    reads |= _multi_reads(tree, ev, values, prose)

    for node in _walk(tree):
        if id(node) in prose:
            continue
        v = None
        if id(node) not in builds and (
                isinstance(node, (ast.BinOp, ast.JoinedStr, ast.Subscript, ast.Attribute))
                or (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in path_names)
                or (isinstance(node, ast.Call) and _dotted(node.func).rsplit(".", 1)[-1] in _PATH_CTORS | {"join"})):
            v = ev(node)
        if isinstance(node, ast.Call):
            f = _dotted(node.func)
            last = f.rsplit(".", 1)[-1]
            if isinstance(node.func, ast.Attribute):
                base = ev(node.func.value)
                attr = node.func.attr
                if attr in ("glob", "rglob") and node.args:
                    pat = ev(node.args[0])
                    if isinstance(pat, str):
                        v2 = _join(base, _glob_prefix(pat))
                        if attr == "rglob" and isinstance(v2, str) and _under(APP_SRC, v2):
                            v2 = APP_SRC                        # an rglob over an ancestor walks app/src
                        if _under(v2):
                            reads.add(v2)
                elif attr in ("read_text", "read_bytes", "open", "iterdir", "exists", "is_file", "is_dir", "stat",
                              "walk") and _under(base):
                    reads.add(base)
                elif attr == "walk" and isinstance(base, str) and _under(APP_SRC, base):
                    reads.add(APP_SRC)                          # Path.walk() over an ancestor walks app/src
            if f in ("glob.glob", "glob.iglob") and node.args:
                pat = ev(node.args[0])
                if isinstance(pat, str) and _under(_glob_prefix(pat)):
                    reads.add(_glob_prefix(pat))
            if f in ("os.walk", "os.listdir", "os.scandir") and node.args:
                v2 = ev(node.args[0])
                if _under(v2):
                    reads.add(v2)
                elif f == "os.walk" and isinstance(v2, str) and _under(APP_SRC, v2):
                    reads.add(APP_SRC)
            if f in ("open", "io.open", "codecs.open") and node.args:
                v2 = ev(node.args[0])
                if _under(v2):
                    reads.add(v2)
            if (last in _SUBPROCESS and f.startswith("subprocess.")) or f in ("os.system", "os.popen"):
                argv = []
                for a in node.args[:1]:
                    if isinstance(a, (ast.List, ast.Tuple)):
                        argv += [ev(e) for e in a.elts]
                    elif isinstance(a, ast.Name) and a.id in seqs:
                        argv += list(seqs[a.id])
                    else:
                        argv.append(ev(a))
                for kw in node.keywords:
                    if kw.arg == "cwd":
                        cwd = ev(kw.value)
                        if cwd == "app" or _under(cwd):
                            reads.add(APP_SRC + " (a process run in app/)")
                    if kw.arg == "args" and isinstance(kw.value, (ast.List, ast.Tuple)):
                        argv += [ev(e) for e in kw.value.elts]
                for a in argv:
                    if isinstance(a, str):
                        a2 = a.replace("\\", "/")
                        if "app/src/" in a2 or a2.endswith("app/src"):
                            reads.add(APP_SRC + " (named in a subprocess argv)")
                        if a2.endswith(".py") and not a2.startswith("-"):
                            named_py.add(a2.lstrip("./"))
            if f in ("importlib.util.spec_from_file_location", "runpy.run_path") and node.args:
                for a in node.args[:2]:
                    v2 = ev(a)
                    if isinstance(v2, str) and v2.endswith(".py"):
                        named_py.add(v2)
        if isinstance(v, str):
            if _under(v):
                reads.add(v)
            elif v.endswith(".py") and "/" in v:
                named_py.add(v)
    return reads, named_py


#: the repo's own top-level packages an import can name (api/ and services/ are the product; the rest are helpers)
_PACKAGES = ("tools", "scripts", "tests", "api", "services")
_HELPERS = ("tools", "scripts", "tests")


def _imports(tree, rel_file: str, repo: pathlib.Path) -> set:
    """Repo modules this file imports (tools/, scripts/, tests/ helpers and api/, services/), as repo-relative paths."""
    out = set()
    here = posixpath.dirname(rel_file)

    def mod_to_path(mod: str):
        parts = mod.split(".")
        for cand in ("/".join(parts) + ".py", "/".join(parts) + "/__init__.py"):
            if (repo / cand).is_file():
                return cand
        return None

    def bare(name: str):
        # a module made importable by a sys.path insert of tools/, scripts/ or the test's own directory
        top = name.split(".")[0]
        for base in ("tools", "scripts", here, "tests"):
            p = mod_to_path(f"{base.replace('/', '.')}.{name}" if base else name)
            if p and (p.startswith("tools/") or p.startswith("scripts/") or p.startswith("tests/")):
                return p
        return None

    for node in _walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                p = mod_to_path(a.name) if a.name.split(".")[0] in _PACKAGES else bare(a.name)
                if p:
                    out.add(p)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = here
                for _ in range(node.level - 1):
                    base = posixpath.dirname(base)
                mod = (base.replace("/", ".") + ("." + node.module if node.module else "")).strip(".")
            else:
                mod = node.module or ""
            if not mod:
                continue
            top = mod.split(".")[0]
            cands = []
            if top in _PACKAGES or node.level:
                cands.append(mod_to_path(mod))
                cands += [mod_to_path(f"{mod}.{a.name}") for a in node.names]
            else:
                cands.append(bare(mod))
            out |= {c for c in cands if c}
    return {p for p in out if p != rel_file}


#: a module whose text has none of these cannot spell a path into app/src (the cheap filter before an AST parse)
_SPELLS_APP = re.compile(r"""app[/\\]+src|["']app["']|["']app[/\\]|["']src["']""")


class Census:
    """The static read model over one checkout."""

    _of: dict = {}

    @classmethod
    def of(cls, repo: pathlib.Path = ROOT) -> "Census":
        """One model per checkout per process: the helper-module scan is the expensive half, and its answer does not
        change while a process judges one tree."""
        key = str(pathlib.Path(repo).resolve())
        if key not in cls._of:
            cls._of[key] = cls(pathlib.Path(key))
        return cls._of[key]

    def __init__(self, repo: pathlib.Path = ROOT):
        self.repo = repo.resolve()
        self._text: dict = {}
        self._direct: dict = {}
        self._mods: dict = {}
        self._deps: dict = {}
        self._readers: dict | None = None
        self._reader_rx = None

    def text(self, rel: str) -> str:
        if rel not in self._text:
            try:
                self._text[rel] = (self.repo / rel).read_text(encoding="utf-8", errors="replace")
            except OSError:
                self._text[rel] = ""
        return self._text[rel]

    def _parse(self, rel: str):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")                     # invalid escapes in other people's docstrings
            try:
                return ast.parse(self.text(rel), filename=rel)
            except (SyntaxError, ValueError):
                return None

    def _analyse(self, rel: str) -> None:
        tree = self._parse(rel)
        if tree is None:
            self._direct[rel], self._mods[rel] = set(), set()
            return
        reads, named = _read_targets(tree, rel) if _SPELLS_APP.search(self.text(rel)) else (set(), set())
        mods = _imports(tree, rel, self.repo)
        mods |= {n for n in named if n.split("/", 1)[0] in _PACKAGES and (self.repo / n).is_file()}
        deps = {m for m in mods if not _TEST_FILE.search(m)}
        self._direct[rel], self._deps[rel] = reads, deps
        self._mods[rel] = {m for m in deps if m.split("/", 1)[0] in _HELPERS}

    def direct(self, rel: str) -> set:
        if rel not in self._direct:
            self._analyse(rel)
        return self._direct[rel]

    def modules(self, rel: str) -> set:
        """The tools/, scripts/ and tests/ helper modules `rel` imports or runs (what its reads propagate through)."""
        if rel not in self._mods:
            self._analyse(rel)
        return self._mods[rel]

    def depends_on(self, rel: str) -> set:
        """Every repo file a change to which can change what the test `rel` checks, short of its app/src reads: the
        file itself, the helpers it reaches (transitively), and the api/ and services/ modules it or those helpers
        import by name (one hop: following the product's own imports would reach the whole app)."""
        out = {rel}
        seen, frontier = {rel}, [rel]
        while frontier:
            cur = frontier.pop()
            if cur not in self._deps:
                self._analyse(cur)
            for d in sorted(self._deps[cur]):
                out.add(d)
                if d.split("/", 1)[0] in _HELPERS and d not in seen:
                    seen.add(d)
                    frontier.append(d)
        return out

    def _helper_modules(self) -> list[str]:
        out = []
        for base in ("tools", "scripts", "tests"):
            if not (self.repo / base).is_dir():
                continue
            for p in (self.repo / base).rglob("*.py"):
                rel = p.relative_to(self.repo).as_posix()
                if any(part in _SKIP_DIRS for part in p.parts) or "/fixtures/" in rel or _TEST_FILE.search(rel):
                    continue
                out.append(rel)
        return sorted(out)

    def readers(self) -> dict:
        """{helper module (tools/, scripts/, tests/ non-test): {app/src path: chain}} for every one that reads app/src,
        directly or through the helpers it imports. A fixed point: a module joins when its text names a reader's
        module name (cheap) and its parsed imports reach one (exact)."""
        if self._readers is not None:
            return self._readers
        mods = self._helper_modules()
        found: dict = {}
        for m in mods:
            if _SPELLS_APP.search(self.text(m)):
                r = self.direct(m)
                if r:
                    found[m] = {x: "direct" for x in r}
        grew = True
        while grew:
            grew = False
            stems = {pathlib.PurePosixPath(m).stem if not m.endswith("__init__.py") else
                     pathlib.PurePosixPath(m).parent.name for m in found}
            rx = re.compile(r"\b(" + "|".join(sorted(map(re.escape, stems))) + r")\b") if stems else None
            for m in mods:
                if rx is None or not rx.search(self.text(m)):
                    continue
                hit = {}
                for dep in sorted(self.modules(m)):
                    for path, chain in sorted((found.get(dep) or {}).items()):
                        hit.setdefault(path, dep if chain == "direct" else f"{dep} -> {chain}")
                new = {k: v for k, v in hit.items() if k not in found.get(m, {})}
                if new:
                    found.setdefault(m, {}).update(new)
                    grew = True
        self._readers = found
        return found

    def reads_of_module(self, rel: str) -> set:
        """The app/src paths a tools/ / scripts/ / tests/ helper module reads, directly or through what it imports."""
        return {_as_read(k) for k in (self.readers().get(rel) or {})}

    def reads(self, rel: str) -> dict:
        """{app/src path: how ("direct", or the module chain)} for one test file."""
        out: dict = {x: "direct" for x in (self.direct(rel) if _SPELLS_APP.search(self.text(rel)) else set())}
        readers = self.readers()
        if self._reader_rx is None:
            stems = {pathlib.PurePosixPath(m).stem if not m.endswith("__init__.py") else
                     pathlib.PurePosixPath(m).parent.name for m in readers}
            self._reader_rx = re.compile(r"\b(" + "|".join(sorted(map(re.escape, stems))) + r")\b") if stems else False
        if self._reader_rx and self._reader_rx.search(self.text(rel)):
            for dep in sorted(self.modules(rel)):
                for path, chain in sorted((readers.get(dep) or {}).items()):
                    out.setdefault(path, dep if chain == "direct" else f"{dep} -> {chain}")
        return {_as_read(k): v for k, v in sorted(out.items())}

    def test_files(self) -> list[str]:
        out = []
        for p in (self.repo / "tests").rglob("*.py"):
            rel = p.relative_to(self.repo).as_posix()
            if any(part in _SKIP_DIRS for part in p.parts) or "/fixtures/" in rel:
                continue
            if _TEST_FILE.search(rel):
                out.append(rel)
        return sorted(out)

    def census(self) -> dict:
        """{test file: {app/src path: how}} for every pytest file under tests/ that reads app/src."""
        out = {}
        for t in self.test_files():
            r = self.reads(t)
            if r:
                out[t] = r
        return out


# ── which pull-request jobs name which test files ───────────────────────────────────────────────────────────────

def _on(doc: dict) -> dict:
    on = doc.get("on", doc.get(True)) or {}
    if isinstance(on, str):
        return {on: {}}
    if isinstance(on, list):
        return {k: {} for k in on}
    return {k: (v or {}) for k, v in on.items()}


def glob_rx(g: str) -> re.Pattern:
    """A GitHub `paths` filter pattern as a regex: `**` crosses `/`, `*` and `?` do not."""
    out, i = "", 0
    while i < len(g):
        if g.startswith("**", i):
            out, i = out + ".*", i + 2
        elif g[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif g[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(g[i]), i + 1
    return re.compile(out + r"\Z")


def triggers(globs, rel: str) -> bool:
    """Does a PR touching `rel` (a file, or anything under a directory it walks) trigger a workflow with these
    `paths:`? `globs is None` = no path filter."""
    if globs is None:
        return True
    rel = rel.split(" (", 1)[0]
    rxs = [glob_rx(g) for g in globs if not g.startswith("!")]
    return any(rx.match(rel) or rx.match(rel + "/x") for rx in rxs)


_TEST_TOKEN = re.compile(r"(?<![\w./-])((?:tests|api)/[\w./*?\[\]-]*\.py)\b")


def _job_text(job: dict) -> str:
    """Everything in a job a step can run a test file from: run scripts, matrix values, env."""
    bits = []
    for s in job.get("steps") or []:
        bits.append(str(s.get("run") or ""))
        bits.append(json.dumps(s.get("env") or {}))
        bits.append(json.dumps(s.get("with") or {}))
    bits.append(json.dumps((job.get("strategy") or {}).get("matrix") or {}))
    bits.append(json.dumps(job.get("env") or {}))
    return "\n".join(bits)


def _code_lines(text: str) -> str:
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))


def _listed_by_tool(tool: str, repo: pathlib.Path, home: list | None) -> list[str]:
    kind = LIST_TOOLS[tool]
    if kind == "self":
        return list(home or [])
    if kind == "gate_pine":
        doc = yaml.safe_load((repo / WORKFLOWS / "master-deploy-gate.yml").read_text(encoding="utf-8"))
        text = _code_lines(_job_text(((doc.get("jobs") or {}).get("pine-runtime") or {})))
        return sorted({m for m in _TEST_TOKEN.findall(text)})
    if kind == "bars":
        import importlib.util
        spec = importlib.util.spec_from_file_location("_bars_gate_rails_for_census", repo / tool)
        try:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return list(mod.gated(repo))
        except Exception:                                       # noqa: BLE001 - an unreadable list names nothing
            return []
    return []


def _expand(tok: str, repo: pathlib.Path) -> set:
    hits = _glob.glob(str(repo / tok)) if any(c in tok for c in "*?[") else [str(repo / tok)]
    return {pathlib.Path(h).resolve().relative_to(repo.resolve()).as_posix() for h in hits if pathlib.Path(h).is_file()}


def _job_files(job: dict, repo: pathlib.Path, home: list | None) -> set:
    text = _code_lines(_job_text(job))
    files = set()
    for tok in _TEST_TOKEN.findall(text):
        files |= _expand(tok, repo)
    for tool in LIST_TOOLS:
        if tool in text:
            files |= set(_listed_by_tool(tool, repo, home))
    return files


def pr_jobs(repo: pathlib.Path = ROOT, home: list | None = None) -> list[dict]:
    """[{workflow, job, paths (None = unfiltered), files}] for every job of every pull_request workflow. `home` is what
    this tool's own --print-list step runs (None: that step names nothing, as when the list is being derived)."""
    out = []
    for wf in sorted((repo / WORKFLOWS).glob("*.y*ml")):
        doc = yaml.safe_load(wf.read_text(encoding="utf-8")) or {}
        on = _on(doc)
        if "pull_request" not in on:
            continue
        pr = on["pull_request"]
        paths = pr.get("paths")
        globs = None if not (paths or pr.get("paths-ignore")) else [str(p) for p in (paths or ["**"])]
        for name, job in (doc.get("jobs") or {}).items():
            out.append({"workflow": wf.name, "job": name, "paths": globs,
                        "files": sorted(_job_files(job, repo, home))})
    return out


def master_gate_files(repo: pathlib.Path = ROOT) -> set:
    doc = yaml.safe_load((repo / WORKFLOWS / "master-deploy-gate.yml").read_text(encoding="utf-8"))
    files = set()
    for job in (doc.get("jobs") or {}).values():
        files |= _job_files(job, repo, None)
    return files


# ── the list this tool's own step runs, and the judgement ───────────────────────────────────────────────────────

def coverage(census: dict, jobs: list[dict]) -> dict:
    """{test: {"runs": [workflow/job whose trigger covers every read], "untriggered": [workflow/job (missing read)]}}"""
    out = {}
    for t, reads in census.items():
        runs, untrig = [], []
        for j in jobs:
            if t not in j["files"]:
                continue
            miss = [r for r in reads if not triggers(j["paths"], r)]
            (untrig if miss else runs).append(f"{j['workflow']}/{j['job']}" + (f" (not on {miss[0]})" if miss else ""))
        out[t] = {"runs": sorted(runs), "untriggered": sorted(untrig)}
    return out


def print_list(repo: pathlib.Path = ROOT, census: dict | None = None, exempt: dict | None = None,
               known_red: dict | None = None) -> list[str]:
    """The app/src rails no OTHER PR job runs on the PR that changes what they read: what the home step runs.

    DERIVED, NEVER HAND-KEPT: the census, minus EXEMPT, minus the files another PR job already runs under a trigger
    that covers what they read. So a NEW app/src rail is run on the next PR the day it lands, with no list to edit, and
    a rail another job takes over leaves this list by itself."""
    exempt = EXEMPT if exempt is None else exempt
    known_red = KNOWN_RED if known_red is None else known_red
    c = census if census is not None else Census.of(repo).census()
    cov = coverage(c, pr_jobs(repo, home=None))
    whole_file_red = {k for k in known_red if "::" not in k}
    return sorted(t for t in c if t not in exempt and t not in whole_file_red and not cov[t]["runs"])


#: A PR that changes one of these runs the WHOLE list: each can change how every listed rail runs (the scan and the
#: selection, the job, its environment and wrapper, pytest's own configuration, this rail).
RUN_ALL_ON = (
    "tools/ci_app_src_rails.py",
    "tests/test_ci_app_src_rails.py",
    ".github/workflows/whole-app-engine-rails.yml",
    ".github/actions/pine-heavy-setup/**",
    "tools/ci_offline.sh",
    "requirements.txt",
    "tests/ci-only-packages.txt",
    "pytest.ini",
    "tests/conftest.py",
    "tests/**/conftest.py",
)
#: the most shards a PR run uses, and the recorded time one shard is cut to before another is added
MAX_SHARDS = 4
SHARD_TARGET_MS = 300_000


def _read_prefix(read: str) -> str:
    """The path a change must fall under to change what a read sees: a node process run in app/ can import anything
    there (and its package files), a subprocess that names app/src reads app/src."""
    if read.endswith("(a process run in app/)"):
        return "app"
    return read.split(" (", 1)[0]


def touches(read: str, changed: str) -> bool:
    p = _read_prefix(read)
    return changed == p or changed.startswith(p + "/")


def select(files: list[str], census: dict, changed: list[str], model: "Census") -> tuple[list[str], str]:
    """The rails of `files` a PR changing `changed` must run, and why. PATH-AWARE: a rail runs when the PR changes a
    path it reads (its census read set), or the rail itself, a helper it reaches, or an api/ or services/ module it or
    a helper imports (Census.depends_on). Everything runs when the PR changes something in RUN_ALL_ON, or when what it
    changed is unknown (an empty list: a check that cannot see the diff must not pass by running nothing).
    What the static scan cannot see (its LIMITS) is the nightly full suite's: it runs every file under tests/."""
    changed = sorted({c.strip().replace("\\", "/") for c in changed if c.strip()})
    if not changed:
        return list(files), f"ALL {len(files)}: the changed files are unknown"
    rxs = [glob_rx(g) for g in RUN_ALL_ON]
    hit = next((c for c in changed if any(rx.match(c) for rx in rxs)), None)
    if hit:
        return list(files), f"ALL {len(files)}: the PR changes {hit}, which every listed rail runs through"
    cset = set(changed)
    chosen = [t for t in files
              if any(touches(r, c) for r in census.get(t, {}) for c in changed) or cset & model.depends_on(t)]
    return chosen, f"{len(chosen)} of {len(files)}: the rails that read, or depend on, what the PR changes"


def shard_count(files: list[str], timings: dict) -> int:
    if not files:
        return 0
    total = sum(timings.get(f, UNKNOWN_MS) for f in files)
    return max(1, min(MAX_SHARDS, len(files), -(-total // SHARD_TARGET_MS)))


def load_timings(repo: pathlib.Path = ROOT) -> dict:
    try:
        doc = json.loads((repo / TIMINGS).read_text(encoding="utf-8"))
        return {str(k): int(v) for k, v in (doc.get("files_ms") or {}).items()}
    except (OSError, ValueError, AttributeError):
        return {}


def partition(files: list[str], n: int, timings: dict) -> list[list[str]]:
    """`files` cut into `n` shards of about equal recorded time (longest first onto the lightest shard). Deterministic:
    every shard of a run computes the same partition from the same checkout, so the shards are disjoint and together
    are the whole list."""
    shards: list[list[str]] = [[] for _ in range(n)]
    load = [0] * n
    for f in sorted(files, key=lambda f: (-timings.get(f, UNKNOWN_MS), f)):
        i = min(range(n), key=lambda k: (load[k], k))
        shards[i].append(f)
        load[i] += timings.get(f, UNKNOWN_MS)
    return [sorted(s) for s in shards]


PLUGIN = "tools.ci_app_src_rails"


def shard_args(files: list[str], k: int, n: int, timings: dict) -> list[str]:
    """The pytest arguments of shard k of n: its files, then this module as a plugin (KNOWN_RED as strict xfails)."""
    mine = partition(files, n, timings)[k - 1]
    return list(mine) + ["-p", PLUGIN] if mine else []


def pytest_collection_modifyitems(config, items):  # noqa: ARG001 - the pytest hook signature
    """Active only when the home job loads this module as a plugin (`-p tools.ci_app_src_rails`): every KNOWN_RED test
    runs as a STRICT xfail. Its known red keeps the job green; the day it PASSES, XPASS(strict) turns the job red and
    says to delete its line, so a stale entry cannot hide a test that went green."""
    import pytest
    for item in items:
        why = KNOWN_RED.get(item.nodeid)
        if why:
            item.add_marker(pytest.mark.xfail(strict=True, reason=(
                f"KNOWN_RED in tools/ci_app_src_rails.py: {why}. An XPASS means it is green now: delete its line")))


def home_step(repo: pathlib.Path = ROOT) -> dict | None:
    path = repo / WORKFLOWS / HOME_WORKFLOW
    if not path.is_file():
        return None
    doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    for s in ((doc.get("jobs") or {}).get(HOME_JOB) or {}).get("steps") or []:
        if s.get("name") == HOME_STEP:
            return s
    return None


def judge(repo: pathlib.Path = ROOT, census: dict | None = None, exempt: dict | None = None,
          known_red: dict | None = None, tool_checks: tuple = TOOL_CHECKS) -> list[str]:
    """Every problem, one line each. Empty = every app/src-reading pytest file runs on the PR that changes what it
    reads, or is exempt with a reason."""
    exempt = EXEMPT if exempt is None else exempt
    known_red = KNOWN_RED if known_red is None else known_red
    c = census if census is not None else Census.of(repo).census()
    bad = []
    step = home_step(repo)
    home = print_list(repo, c, exempt, known_red)
    if step is None:
        bad.append(f"{HOME_WORKFLOW} job `{HOME_JOB}` has no step named {HOME_STEP!r}: nothing runs the list")
    elif "tools/ci_app_src_rails.py --write-args" not in str(step.get("run") or ""):
        bad.append(f"the step {HOME_STEP!r} does not run tools/ci_app_src_rails.py's list (--write-args)")
    cov = coverage(c, pr_jobs(repo, home=home if step is not None else None))
    for t in sorted(c):
        if t in known_red:
            continue                                            # a whole file known red: judged below
        if t in exempt:
            if cov[t]["runs"]:
                bad.append(f"EXEMPT but run: {t} is exempt and {cov[t]['runs'][0]} runs it: drop the exemption")
            continue
        if not cov[t]["runs"]:
            how = "; ".join(f"{r} via {v}" if v != "direct" else r for r, v in sorted(c[t].items())[:3])
            extra = f"; named only by {', '.join(cov[t]['untriggered'])}" if cov[t]["untriggered"] else ""
            bad.append(f"NOT RUN ON THE PR: {t} reads {how}{extra}. Run it in a PR job that triggers on what it reads, "
                       f"or exempt it in tools/ci_app_src_rails.py EXEMPT with the reason")
    for t in sorted(set(exempt) - set(c)):
        bad.append(f"EXEMPT but not an app/src reader: {t} (renamed, deleted, or it stopped reading app/src): drop it")
    for t, why in sorted(exempt.items()):
        if len(why.strip()) < 40:
            bad.append(f"EXEMPT without a reason a reviewer can argue with: {t}: {why!r}")
    for node, why in sorted(known_red.items()):
        f = node.split("::", 1)[0]
        if f not in c:
            bad.append(f"KNOWN_RED names {node}, whose file reads no app/src (renamed or deleted?): drop it")
        elif "::" not in node and cov[f]["runs"]:
            bad.append(f"KNOWN_RED drops {f} whole, and {cov[f]['runs'][0]} runs it anyway: drop the entry")
        elif "::" in node and f not in home:
            bad.append(f"KNOWN_RED names {node}, which the home job does not run (it runs {f} elsewhere): drop it")
        elif "::" in node and not _test_exists(repo, node):
            bad.append(f"KNOWN_RED names {node}, and {f} no longer defines that test: drop the entry")
        if len(why.strip()) < 40:
            bad.append(f"KNOWN_RED without the failure it records: {node}: {why!r}")
    bad += judge_tool_checks(repo, tool_checks)
    return bad


def _test_exists(repo: pathlib.Path, node: str) -> bool:
    """Does `file::[Class::]test[param]` still name a test in its file? Statically: the function (inside the class when
    one is named) is defined, and a parametrize id's text is in the file's source. (Whether it is still RED, only a
    run can say: that is the strict xfail's job.)"""
    path, *names = node.split("::")
    try:
        text = (repo / path).read_text(encoding="utf-8", errors="replace")
        tree = ast.parse(text)
    except (OSError, SyntaxError, ValueError):
        return False
    func, _, param = names[-1].partition("[")
    scope = tree.body
    for cls in names[:-1]:
        found = next((n for n in scope if isinstance(n, ast.ClassDef) and n.name == cls), None)
        if found is None:
            return False
        scope = found.body
    if not any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == func for n in scope):
        return False
    if param:
        literal = param[:-1].encode("ascii", "backslashreplace").decode("unicode_escape")
        return any(isinstance(n, ast.Constant) and n.value == literal for n in _walk(tree)) or param[:-1] in text
    return True


def judge_tool_checks(repo: pathlib.Path = ROOT, checks: tuple = TOOL_CHECKS,
                      model: "Census | None" = None) -> list[str]:
    """Each TOOL_CHECKS command is run by a step of a pull_request job whose trigger covers what the tool reads."""
    bad = []
    model = model or Census.of(repo)
    for cmd in checks:
        tool = next((w for w in shlex.split(cmd) if w.endswith(".py")), "")
        reads = model.reads_of_module(tool)
        if not reads:
            bad.append(f"TOOL_CHECKS: {tool} reads no app/src any more (or is gone): drop {cmd!r}")
            continue
        runners = []
        for wf in sorted((repo / WORKFLOWS).glob("*.y*ml")):
            doc = yaml.safe_load(wf.read_text(encoding="utf-8")) or {}
            on = _on(doc)
            if "pull_request" not in on:
                continue
            pr = on["pull_request"]
            globs = (None if not (pr.get("paths") or pr.get("paths-ignore"))
                     else [str(p) for p in (pr.get("paths") or ["**"])])
            for name, job in (doc.get("jobs") or {}).items():
                if cmd in _code_lines(_job_text(job)) and all(triggers(globs, r) for r in reads):
                    runners.append(f"{wf.name}/{name}")
        if not runners:
            bad.append(f"TOOL CHECK NOT RUN ON THE PR: `{cmd}` reads {', '.join(sorted(reads)[:3])}; no pull_request "
                       "job runs it under a trigger covering that")
    return bad


# ── the command line ────────────────────────────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--census", action="store_true", help="print the census table")
    ap.add_argument("--check", action="store_true", help="exit 1 when an app/src reader runs in no PR job")
    ap.add_argument("--print-list", action="store_true", help="the files the home step runs, space-separated")
    ap.add_argument("--json", type=pathlib.Path, help="write the census + coverage as JSON here")
    ap.add_argument("--changed", type=pathlib.Path,
                    help="the PR's changed files, one per line: --plan and --write-args then select the rails that "
                         "read or depend on them (an empty file selects ALL: the diff is unknown)")
    ap.add_argument("--plan", action="store_true",
                    help="print count=, n= and shards= (for $GITHUB_OUTPUT): how many rails this PR runs, in how many "
                         "shards")
    ap.add_argument("--write-args", type=pathlib.Path,
                    help="write the pytest arguments of one shard of the (selected) list here, one per line "
                         "(its files, then `-p tools.ci_app_src_rails`: KNOWN_RED tests run as strict xfails)")
    ap.add_argument("--shard", default="1/1", help="K/N: which shard --write-args writes (default the whole list)")
    ap.add_argument("--repo", type=pathlib.Path, default=ROOT)
    a = ap.parse_args(argv)
    repo = a.repo.resolve()
    if not (a.census or a.check or a.print_list or a.json or a.write_args or a.plan):
        ap.error("give --census, --check, --print-list, --plan, --write-args or --json")
    model = Census.of(repo)
    c = model.census()
    if not c:
        print("::error::the census found no pytest file that reads app/src: the scan is broken, not the suite clean")
        return 2
    home = print_list(repo, c)
    if a.print_list:
        print(" ".join(home))
        return 0 if home else 1
    chosen, why = home, f"ALL {len(home)}: no --changed given"
    if a.changed is not None:
        chosen, why = select(home, c, a.changed.read_text(encoding="utf-8").splitlines(), model)
    if a.plan:
        n = shard_count(chosen, load_timings(repo))
        print(f"count={len(chosen)}")
        print(f"n={n}")
        print(f"shards={json.dumps(list(range(1, n + 1)))}")
        print(f"app/src pytest rails selected: {why}", file=sys.stderr)
        for t in chosen:
            print(f"  {t}", file=sys.stderr)
        return 0
    if a.write_args:
        m = re.fullmatch(r"(\d+)/(\d+)", a.shard)
        if not m or not 1 <= int(m.group(1)) <= int(m.group(2)):
            ap.error(f"--shard {a.shard!r}: want K/N with 1 <= K <= N")
        k, n = int(m.group(1)), int(m.group(2))
        args = shard_args(chosen, k, n, load_timings(repo))
        a.write_args.write_text("".join(f"{x}\n" for x in args), encoding="utf-8")
        files = [x for x in args if x.endswith(".py")]
        print(f"app/src pytest rails, shard {k}/{n}: {len(files)} of {len(chosen)} selected ({why}); "
              f"{sum(1 for x in KNOWN_RED if x.split('::', 1)[0] in files)} known-red test(s) run as strict xfails")
        if not files:
            print(f"::error::shard {k}/{n} of the selected app/src rails is empty (the plan cut more shards than files)")
            return 1
        if not (a.check or a.census or a.json):
            return 0
    jobs = pr_jobs(repo, home=home if home_step(repo) is not None else None)
    cov = coverage(c, jobs)
    gate = master_gate_files(repo)
    if a.json:
        a.json.write_text(json.dumps({t: {"reads": c[t], **cov[t], "master_gate": t in gate,
                                          "exempt": EXEMPT.get(t)} for t in sorted(c)}, indent=1), encoding="utf-8")
    if a.census:
        for t in sorted(c):
            reads = sorted(c[t])
            show = ", ".join(reads[:2]) + (f" (+{len(reads) - 2})" if len(reads) > 2 else "")
            via = sorted({v for v in c[t].values() if v != "direct"})
            print(f"{t}\t{show}\t{' | '.join(cov[t]['runs']) or 'NONE'}\t"
                  f"{'gate' if t in gate else ''}\t{via[0] if via else ''}")
    if a.check:
        bad = judge(repo, c)
        for b in bad:
            print(f"::error::{b}")
        print(f"app/src pytest rails: {len(c)} pytest files read app/src; {len(home)} on the home step's list, "
              f"{sum(1 for t in c if cov[t]['runs'])} run on the PR in all; {len(EXEMPT)} exempt; {len(bad)} problem(s)")
        return 1 if bad else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
