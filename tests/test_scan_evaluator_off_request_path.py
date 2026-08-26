"""E-3 — the sweep is ABSENT from the request path, and the gate is REACHABILITY.

🔴 THE 524 CLASS, AND WHY A BOUND IS NOT ENOUGH.

`main.py` sets `limiter.total_tokens = 64` and the Signature routes are `sync def`,
so each holds one of 64 shared anyio threads for its full duration. A universe
screen is ~2-8 s of pure-Python CPU (GT §2.3, LOCAL) and it is GIL-bound (GT
§2.4), so it degrades EVERY handler on the pod for those seconds — not just its
own slot. `/confluence-scan` was a ten-minute request on one anyio worker; that is
the 2026-07-01 outage.

E-3's rule is STRONGER than `/confluence-scan`'s four bounds, which bound a
REQUEST. Here a member request NEVER triggers an evaluation at all, so the honest
instrument is a REACHABILITY CENSUS: walk every mounted route's endpoint, build
the call graph by AST, and assert `scan_evaluator`'s entry points appear in NO
handler's transitive closure.

⛔ THE COUNT OF HANDLERS WALKED IS ASSERTED. A hand-listed path set let two paid
Signature endpoints ride uncovered in Phase C, and a census that walked ZERO
routes would pass this the same way.

⛔ AST, NEVER GREP. `lesson_probe_names_must_be_derived_not_typed`: a grep on this
branch reported five call sites and all five were prose.

⚠️ THE GRAPH IS BUILT ONCE AND THE QUESTION IS ASKED BACKWARDS. Walking a forward
closure per handler re-parses the whole `api/` tree for every one of ~300
endpoints. Instead the call graph is built once, the functions that TOUCH the
subject are marked, and the mark is propagated along reversed edges to a fixpoint
— so "can this handler reach it" is a set membership. Same answer, one pass.

───────────────────────────────────────────────────────────────────────────────
🔴 THE SUBJECT IS THE SWEEP, NOT THE FILE IT LIVES IN. (narrowed 2026-08-09)

This rail first read "does the name `api.services.screener.scan_evaluator` appear
anywhere in this handler's closure", and on that reading it went red on
`/api/user-definitions/propose` → `definition_concierge._cadence_ceiling` →
`scan_evaluator.cadence_ceiling`. **That was the rail over-matching, not the
handler misbehaving.** `cadence_ceiling(tree)` is `ast_freshness.freshness_for`
plus a `"/".join` — a walk of the caller's OWN tree against a module-level
manifest dict. No DB, no bars, no universe, nothing that scales with symbol
count: **1.9 µs/call, measured 2026-08-09 (1,000 calls in 1.89 ms)** against the
sweep's 2-8 s. Guarding it guarded the module, not the behaviour, and this file
already knew the difference — `test_the_ONLY_production_caller_of_the_sweep_is_
the_SCHEDULER` has always defined "the sweep" as `_ENTRY_POINTS`, and it stayed
green through the same call. Two definitions of one subject in one file is this
repo's most repeated defect; there is now one.

**The rule, and it is DEFAULT-DENY:**

  1. Binding the MODULE OBJECT (`from ...screener import scan_evaluator`, or
     `import ... as se`) trips — unconditionally, even unused. Once the module is
     in the namespace the whole sweep is one attribute away and a `getattr` is
     invisible to an AST census, so the census could not honestly say what was
     reached.
  2. A reference that NAMES one function trips unless that name is in
     `_OFF_SWEEP_READS` — the subject's public functions that provably do no
     universe-scale work. Everything else, including every private helper, trips.

⛔ `_OFF_SWEEP_READS` IS NOT AN ALLOW-LIST YOU MAY GROW QUIETLY. It is one half of
a partition, and `test_the_subject_has_no_UNCLASSIFIED_public_function` derives
the other half from the subject's own AST: a new public function on
`scan_evaluator` fails BY NAME until somebody rules on it. A list a guard reads
must come from the artifact, never from a hand-kept copy of it.
"""
from __future__ import annotations

import ast as pyast
import collections
import pathlib

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_API = _ROOT / "api"

#: The module whose entry points must be unreachable, and the entry points.
_SUBJECT = "api.services.screener.scan_evaluator"
_ENTRY_POINTS = ("evaluate_one", "run_sweep", "sweep_job", "definitions_to_sweep",
                 "live_sweep_job")

#: The subject's OTHER public functions — the ones a request may name, because
#: none of them touches the universe, the bars store or the screener snapshot.
#: Each is O(1) or O(tree); none is O(symbols). ⛔ THE PARTITION IS RAILED: see
#: `test_the_subject_has_no_UNCLASSIFIED_public_function`.
#:
#:   cadence_ceiling  — `ast_freshness.freshness_for` over the caller's own tree
#:                      against the module-level manifest. 1.9 µs/call.
#:   expected_session — the bars store's OWN calendar function (weekend/pre-open/
#:                      holiday walk-back over a `datetime`). No store read.
#:   enabled          — `os.environ.get("SCAN_SWEEP_ENABLED")`.
#:   market_open_et   — walks the minutes of ONE calendar day asking
#:                      `bars_fetch.bucket_60_et_unix_seconds` which one is not a
#:                      clock hour, so the session open is DERIVED rather than
#:                      typed. Pure arithmetic over `datetime`; no store, no
#:                      universe. MEASURED 1.75 ms/call on this box — the most
#:                      expensive entry here by three orders of magnitude, and
#:                      still O(1) in SYMBOLS, which is what this partition is
#:                      about. ⚠️ It is also 1.75 ms a request has no reason to
#:                      spend: nothing under `api/routers/` calls it today and the
#:                      census above is what keeps that true.
#:   sweep_deadline   — `market_open_et` minus `SWEEP_STOP_BEFORE_OPEN`.
#:   previous_session — the bars store's OWN calendar again, probed at midnight of
#:                      the session, which is its weekend/holiday walk-back
#:                      answering "the last session strictly before this one".
#:                      No store read.
#:   live_bars_for    — W4b.2's forming bar. ⭐ IT READS NOTHING: the bars and the
#:                      quote both arrive as ARGUMENTS, so there is no universe,
#:                      no bars store and no screener snapshot behind it. The work
#:                      is `_last_confirmed_index` over the caller's OWN bars plus
#:                      `live_tier.sanity_reason`, which is arithmetic over two
#:                      dicts. O(bars) for ONE symbol, O(1) in symbols — which is
#:                      what this partition is about.
#:   live_enabled     — `os.environ.get("SCAN_LIVE_SWEEP_ENABLED")`, read per call
#:                      so a rollback is unsetting a variable rather than a deploy.
#:   live_interval_s  — `os.environ.get("SCAN_LIVE_INTERVAL_S")` with a floor and a
#:                      fallback. Arithmetic over one string.
#:   note_demand      — a delegate onto `scan_store.note_demand`: a bounded
#:                      (2,000-entry) in-memory dict write behind a `threading.Lock`
#:                      held for the length of the write. No store, no universe.
#:                      ⚠️ A ROUTER MUST STILL NOT CALL IT HERE — the import rail
#:                      above forbids a router importing ANYTHING from this module,
#:                      so W4a's run-now door calls `scan_store.note_demand`
#:                      directly. This name exists for the lane contract and for
#:                      the sweep's own use, and it is classified rather than
#:                      entry-pointed because reaching it costs a request nothing.
_OFF_SWEEP_READS = ("cadence_ceiling", "expected_session", "enabled",
                    "market_open_et", "sweep_deadline", "previous_session",
                    "live_bars_for", "live_enabled", "live_interval_s",
                    "note_demand")


# ═══ the ONE bounded door on the request path, NAMED ════════════════════
#
# ⭐ THE SPEC PUT AN ON-DEMAND RUN ON THE REQUEST PATH (2026-08-25 §5.5, lane
# W4a) AND THE ANSWER IS NOT "LET A HANDLER EVALUATE". It is a QUEUE. The two
# mounted handlers call `submit_run` / `job_status`, which put a job on a
# single-worker pool and read it back; `scan_evaluator.evaluate_one` is called
# only on that pool's thread, inside `_run_job`. The invariant this file protects
# is therefore UNCHANGED — no handler evaluates on the request thread — and what
# is stated below is NARROWER than the blanket it replaces, not wider.
#
# ⚠️ WHY A NARROWING WAS NEEDED AT ALL, MEASURED 2026-08-26. `_touches_subject`'s
# MODULE clause is attributed to EVERY function of a module that binds the sweep
# at the top, so `submit_run` and `job_status` inherited `scan_run.py`'s import
# and BOTH handlers read as offenders — while the function that actually calls the
# sweep, `_run_job`, is reached from neither: `_POOL.submit(_run_job, job_id)`
# passes a function OBJECT, which builds no call edge. The blunt clause was
# answering a question about a FILE when the question is about a FUNCTION.
#
# ⛔ SO THE MODULE CLAUSE IS REPLACED — FOR THIS ONE NAMED MODULE — BY A STRICTER
# PER-FUNCTION RULE, never lifted. Two tests carry the halves the clause used to:
#   * `test_the_run_handlers_reach_the_QUEUE_and_STOP…` — what the handlers name
#     in this module is EXACTLY `_QUEUE_DOORS`, nothing either can reach is a
#     `_BOUNDED_CALLERS` entry, and no function in that closure names an entry
#     point. That is "the path terminates at the queue" said as an assertion.
#   * `test_the_BOUNDED_module_names_the_sweep_ONLY_in_RULED_forms` — the dynamic
#     escape the module clause existed to close (`getattr(scan_evaluator, name)`,
#     the module rebound or handed to a function) is closed BY NAME instead.
#
# ⛔ AND THE PROPAGATION IS DELIBERATELY *NOT* CUT AT `_BOUNDED_CALLERS`. The
# lane brief prescribed treating it as a graph leaf ("a bounded leaf taints
# nothing above it"). That would be a hole, not a narrowing: the day somebody
# replaces `_POOL.submit(_run_job, job_id)` with a direct `_run_job(job_id)` —
# the queue collapsed back onto the request thread, which is the whole outage
# class — a leaf rule would keep this file green. It stays an ordinary reacher,
# and `test_the_NARROWING_is_LOAD_BEARING…` plants exactly that edit and watches
# the census catch it.
#
# ⛔ GROWING EITHER SET IS A REVIEWED DECISION, never a way to make a red quiet.
_BOUNDED_MODULE = "api.services.screener.scan_run"

#: The ONE function that may CALL the sweep off the scheduler: the pool worker.
#: Its bounds live where they are USED and are railed there, not restated here —
#: `tests/test_scan_run.py::test_evaluate_one_is_called_EXACTLY_ONCE_inside__run_
#: job_with_mode_on_demand__BY_AST` owns "one call, in `_run_job`, `mode=` the
#: non-writing literal, a pool of exactly one worker". This file owns REACH.
_BOUNDED_CALLERS = {(_BOUNDED_MODULE, "_run_job")}

#: The functions of `_BOUNDED_MODULE` a mounted handler may reach: one QUEUES and
#: one READS BACK. The pool thread sits between them and `_BOUNDED_CALLERS`.
_QUEUE_DOORS = {(_BOUNDED_MODULE, "submit_run"), (_BOUNDED_MODULE, "job_status")}

#: The ceiling this exemption was granted UNDER — not a second authority over the
#: cap (that is `scan_run.MAX_RUN_SYMBOLS`, and its behaviour is railed in
#: `tests/test_scan_run.py`), but the number above which "bounded" stops being
#: true and the ruling above has to be made again.
_BOUNDED_SYMBOL_CEILING = 500


# ═══ the module index, DERIVED from the filesystem ══════════════════════════

def _module_files() -> dict:
    out = {}
    for path in _API.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        rel = path.relative_to(_ROOT).with_suffix("")
        parts = list(rel.parts)
        if parts[-1] == "__init__":
            parts = parts[:-1]
        out[".".join(parts)] = path
    return out


_MODULES = _module_files()
_PARSED: dict = {}
_INFO: dict = {}


def _parse(name: str, overlay: dict):
    if name in overlay:
        return pyast.parse(overlay[name])
    if name in _PARSED:
        return _PARSED[name]
    path = _MODULES.get(name)
    tree = None
    if path is not None:
        try:
            tree = pyast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):        # pragma: no cover
            tree = None
    _PARSED[name] = tree
    return tree


def _resolve_from(node: pyast.ImportFrom, pkg: str) -> str:
    """`from . import x` and `from ..y import z`, resolved against the package."""
    if not node.level:
        return node.module or ""
    parts = pkg.split(".")
    base = parts[: len(parts) - (node.level - 1)] if node.level > 1 else parts
    return ".".join([p for p in base if p] + ([node.module] if node.module else []))


def _alias_map(nodes, pkg: str) -> dict:
    """``{local name: dotted target}`` for a batch of import statements."""
    out = {}
    for node in nodes:
        if isinstance(node, pyast.Import):
            for a in node.names:
                out[a.asname or a.name.split(".")[0]] = (
                    a.name if a.asname else a.name.split(".")[0])
        elif isinstance(node, pyast.ImportFrom):
            base = _resolve_from(node, pkg)
            for a in node.names:
                if a.name == "*":
                    continue
                out[a.asname or a.name] = f"{base}.{a.name}" if base else a.name
    return out


def _module_info(name: str, overlay: dict) -> dict:
    """``{aliases, functions}`` — module-level import aliases and every function.

    ⚠️ MODULE-LEVEL IMPORTS ARE SEPARATED FROM FUNCTION-LOCAL ONES. This repo
    imports lazily inside functions constantly (`bars_fetch` is heavy, the
    interpreter/budget pair is an import cycle), so a census that read only the
    top of a file would miss the most common shape a handler would use.
    """
    if not overlay and name in _INFO:
        return _INFO[name]
    tree = _parse(name, overlay)
    if tree is None:
        info = {"aliases": {}, "functions": {}}
    else:
        inside = set()
        functions = {}
        for fn in pyast.walk(tree):
            if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
                functions.setdefault(fn.name, fn)
                for n in pyast.walk(fn):
                    inside.add(id(n))
        top = [n for n in pyast.walk(tree)
               if isinstance(n, (pyast.Import, pyast.ImportFrom))
               and id(n) not in inside]
        pkg = name.rsplit(".", 1)[0] if "." in name else name
        info = {"aliases": _alias_map(top, pkg), "functions": functions}
    if not overlay:
        _INFO[name] = info
    return info


def _dotted(func) -> str:
    parts = []
    node = func
    while isinstance(node, pyast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, pyast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return ""


def _longest_module_prefix(dotted: str, overlay: dict):
    parts = dotted.split(".")
    for i in range(len(parts), 0, -1):
        head = ".".join(parts[:i])
        if head in _MODULES or head in overlay:
            return head, parts[i:]
    return None, []


def _refs_and_callees(module: str, func: str, overlay: dict) -> tuple:
    """``(api names this function references, (module, func) it calls)``.

    IMPORTS **and** CALLS: an import at the top of this function's module, an
    import inside the function itself, and every call whose callee resolves into
    an `api.*` module.
    """
    info = _module_info(module, overlay)
    node = info["functions"].get(func)
    if node is None:
        return set(), set()
    pkg = module.rsplit(".", 1)[0] if "." in module else module
    aliases = dict(info["aliases"])
    aliases.update(_alias_map(
        [n for n in pyast.walk(node)
         if isinstance(n, (pyast.Import, pyast.ImportFrom))], pkg))

    refs = {t for t in aliases.values() if t.startswith("api.")}
    callees = set()
    for call in [n for n in pyast.walk(node) if isinstance(n, pyast.Call)]:
        dotted = _dotted(call.func)
        if not dotted:
            continue
        parts = dotted.split(".")
        head, rest = parts[0], parts[1:]
        if not rest and head in info["functions"]:
            callees.add((module, head))
            continue
        target = aliases.get(head)
        if target is None:
            continue
        full = ".".join([target] + rest)
        if not full.startswith("api."):
            continue
        refs.add(full)
        mod, attr = _longest_module_prefix(full, overlay)
        if mod and attr:
            callees.add((mod, attr[0]))
    return refs, callees


def _touches_subject(refs, node=None) -> bool:
    """Does this reference set reach THE SWEEP? See the module docstring.

    ⛔ DEFAULT-DENY ON THE ATTRIBUTE, UNCONDITIONAL ON THE MODULE. The module
    clause is the blunt one on purpose: a bound module object puts the whole
    sweep one `getattr` away, and a dynamic attribute is exactly what an AST
    census cannot see. A NAMED function is a closed binding — you get that one
    thing — so the census can honestly rule on it, and it denies everything the
    subject has not proven free of universe-scale work.

    ⛔ WITH EXACTLY ONE NAMED EXCEPTION, `_BOUNDED_MODULE`, where the module
    clause would answer a question about a FILE when the question is about a
    FUNCTION — see the block beside `_BOUNDED_CALLERS`. `node` is the function
    being asked about; omitting it keeps the blunt reading, so a caller that
    forgets it can only be STRICTER, never laxer.
    """
    bounded = node is not None and node[0] == _BOUNDED_MODULE
    for ref in refs:
        if ref == _SUBJECT:
            if bounded:
                continue
            return True
        if ref.startswith(_SUBJECT + "."):
            attr = ref[len(_SUBJECT) + 1:].split(".")[0]
            if attr not in _OFF_SWEEP_READS:
                return True
    return False


_REACHERS: set = set()
_GRAPH: dict = {}


def _build_graph():
    """Every `api.*` function's refs and callees, then the BACKWARD closure of
    everything that can reach the subject."""
    if _GRAPH:
        return
    for module in _MODULES:
        if module == _SUBJECT:
            continue
        for func in _module_info(module, {})["functions"]:
            _GRAPH[(module, func)] = _refs_and_callees(module, func, {})
    callers = collections.defaultdict(set)
    frontier = []
    for node, (refs, callees) in _GRAPH.items():
        for callee in callees:
            callers[callee].add(node)
        if _touches_subject(refs, node):
            frontier.append(node)
    _REACHERS.update(frontier)
    while frontier:
        node = frontier.pop()
        for caller in callers.get(node, ()):
            if caller not in _REACHERS:
                _REACHERS.add(caller)
                frontier.append(caller)


def _endpoints_from_router_routes() -> list:
    """Every mounted route's endpoint, as ``(module, function, path)``.

    ⛔ DERIVED FROM THE ROUTE TABLE, NEVER TYPED. A route that is not mounted
    answers 200 SPA HTML rather than 404, so "the endpoint exists" has to be
    checked against `app.routes` — the artifact the server actually dispatches on.
    """
    from api.main import app

    out = []
    for route in app.routes:
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        module = getattr(endpoint, "__module__", "")
        name = getattr(endpoint, "__name__", "")
        if not module.startswith("api.") or not name:
            continue
        out.append((module, name, getattr(route, "path", "")))
    return out


def _transitive_imports_and_calls(handler, overlay=None) -> bool:
    """Can this handler reach the subject? ⛔ The answer, not a set — the set was
    a per-handler forward closure that re-parsed `api/` three hundred times."""
    overlay = overlay or {}
    _build_graph()
    module, func = handler[0], handler[1]
    seen = set()
    stack = [(module, func)]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        if node in _REACHERS:
            return True
        refs, callees = (_refs_and_callees(node[0], node[1], overlay)
                         if node[0] in overlay else _GRAPH.get(node, (set(), set())))
        if _touches_subject(refs, node):
            return True
        stack.extend(callees)
    return False


# ═══ the gate ═══════════════════════════════════════════════════════════════

def test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes():
    """🔴 M8. A member request never triggers an evaluation — not bounded on the
    request path, ABSENT from it."""
    handlers = _endpoints_from_router_routes()
    assert len(handlers) > 100, f"the census walked {len(handlers)} handlers"

    offenders = [f"{h[2]} -> {h[0]}::{h[1]}" for h in handlers
                 if _transitive_imports_and_calls(h)]
    assert not offenders, (
        "these route handlers can reach the universe sweep:\n  "
        + "\n  ".join(offenders)
        + "\nA universe screen is 2-8 s of GIL-bound pure-Python CPU on a pod "
          "with 64 shared anyio threads. That is the 2026-07-01 outage.")


@pytest.mark.parametrize("source,expected", [
    # a DIRECT call from the handler
    ("from api.services.screener import scan_evaluator\n"
     "def handler():\n"
     "    return scan_evaluator.evaluate_one({}, 'D')\n", True),
    # the import alone, at module level — still in this module's namespace
    ("from api.services.screener import scan_evaluator\n"
     "def handler():\n"
     "    return 1\n", True),
    # a LAZY import inside the handler, which a module-level scan would miss
    ("def handler():\n"
     "    from api.services.screener.scan_evaluator import run_sweep\n"
     "    return run_sweep([])\n", True),
    # ⛔ TRANSITIVE — through a helper in the same module
    ("def _helper():\n"
     "    from api.services.screener import scan_evaluator\n"
     "    return scan_evaluator.run_sweep([])\n"
     "def handler():\n"
     "    return _helper()\n", True),
    # ⛔ A MODULE BOUND UNDER AN ALIAS is still the whole sweep one getattr away
    ("import api.services.screener.scan_evaluator as se\n"
     "def handler():\n"
     "    return se.run_sweep([])\n", True),
    # ⛔ A PRIVATE HELPER IS NOT AN OFF-SWEEP READ — default-deny, by name
    ("def handler():\n"
     "    from api.services.screener.scan_evaluator import _read_bars\n"
     "    return _read_bars('AAPL', 'D', 400)\n", True),
    # ⭐ THE NARROWING, AND IT IS EXACT. A named pure manifest read is allowed BY
    # THE RULE — this is `/api/user-definitions/propose`'s actual chain.
    ("def handler():\n"
     "    from api.services.screener.scan_evaluator import cadence_ceiling\n"
     "    return cadence_ceiling({})\n", False),
    # ⛔ BUT THE MODULE CLAUSE STILL BITES ON THE SAME PURE CALL. Reaching
    # `cadence_ceiling` THROUGH the module object binds the module, so the
    # narrowing cannot be used as a doorway.
    ("from api.services.screener import scan_evaluator\n"
     "def handler():\n"
     "    return scan_evaluator.cadence_ceiling({})\n", True),
    # prose and a namesake must NOT trip it
    ("# scan_evaluator.evaluate_one is the door\n"
     "SCAN = 'scan_evaluator.evaluate_one'\n"
     "def handler():\n"
     "    return SCAN\n", False),
    ("from api.services import engine as scan_evaluator\n"
     "def handler():\n"
     "    return scan_evaluator.get_movers()\n", False),
])
def test_the_census_SEES_a_planted_handler_and_IGNORES_the_namesake(source, expected):
    """⚠️ THE POSITIVE CONTROL, IN FOUR SHAPES. Phase C Task 1 measured the
    failure this prevents: a fixture written in a shape the scanner structurally
    could not match left the scan asserting nothing while staying green.

    ⛔ AND THE NAMESAKE CASE IS THE OTHER HALF. A census that fires on the WORD
    `scan_evaluator` is a grep wearing an AST's clothes — E-6 hit exactly this
    with `indicator_alert_service.record_evaluation`.
    """
    planted = "api.routers.__planted_for_this_test__"
    hit = _transitive_imports_and_calls((planted, "handler", "/planted"),
                                        overlay={planted: source})
    assert hit is expected


def test_the_census_walks_the_SAME_route_table_the_server_dispatches_on():
    """⛔ The handler count is an ASSERTION, not a log line. A census that walked
    zero routes — or that could not READ the handlers it walked — would pass the
    gate above exactly the way a correct one does."""
    from api.main import app

    _build_graph()
    handlers = _endpoints_from_router_routes()
    mounted = [r for r in app.routes if getattr(r, "endpoint", None) is not None]
    assert 100 < len(handlers) <= len(mounted)
    assert _REACHERS, (
        "nothing in api/ was found to reach the sweep — not even the scheduler "
        "job that is supposed to. The graph is empty and the gate is vacuous.")
    unreadable = [h for h in handlers if (h[0], h[1]) not in _GRAPH]
    assert not unreadable, (
        f"{len(unreadable)} handlers are absent from the AST graph, so the gate "
        f"says nothing about them, e.g. {unreadable[:5]}")


def test_the_subject_has_no_UNCLASSIFIED_public_function():
    """🔴 THE PARTITION IS DERIVED FROM THE SUBJECT, NOT HAND-KEPT BESIDE IT.

    `_touches_subject` is default-deny on named attributes, so `_OFF_SWEEP_READS`
    decides what a request may reach. A list like that rots in ONE direction that
    matters: a new public function on `scan_evaluator` that nobody classifies
    would be denied (safe), but a function MOVED out of `_ENTRY_POINTS` and never
    re-ruled would go quiet. So both halves are checked against the module's own
    AST — `lesson_probe_names_must_be_derived_not_typed`, and the same shape as
    the writer-index rail: **fail BY NAME, never on a count.**
    """
    tree = _parse(_SUBJECT, {})
    assert tree is not None, f"{_SUBJECT} did not parse — the rail is vacuous"
    public = {n.name for n in tree.body
              if isinstance(n, (pyast.FunctionDef, pyast.AsyncFunctionDef))
              and not n.name.startswith("_")}
    assert public, "the subject declares no public function — the rail is vacuous"

    overlap = set(_ENTRY_POINTS) & set(_OFF_SWEEP_READS)
    assert not overlap, (
        f"{sorted(overlap)} is declared BOTH the sweep and an off-sweep read. "
        "One name cannot be two rulings.")

    classified = set(_ENTRY_POINTS) | set(_OFF_SWEEP_READS)
    assert public == classified, (
        "the subject's public surface and this rail's ruling on it disagree.\n"
        f"  unclassified (a request's reach to these is UNRULED): "
        f"{sorted(public - classified)}\n"
        f"  ruled on but GONE from the module: {sorted(classified - public)}\n"
        "Every public function of the sweep's module is either THE SWEEP "
        "(`_ENTRY_POINTS`) or proven free of universe-scale work "
        "(`_OFF_SWEEP_READS`). A new one is neither until someone says so.")


def test_the_evaluator_module_is_not_imported_by_any_ROUTER_at_all():
    """⛔ THE BLUNTER HALF, AND IT IS DELIBERATE. `api/routers/` is the request
    path; the sweep has no business in its namespace even unused. E-2 shipped with
    `api/routers/` untouched for the same reason and said so."""
    offenders = []
    for name in sorted(_MODULES):
        if not name.startswith("api.routers."):
            continue
        tree = _parse(name, {})
        if tree is None:                                 # pragma: no cover
            continue
        pkg = name.rsplit(".", 1)[0]
        for node in pyast.walk(tree):
            if isinstance(node, pyast.Import):
                if any(a.name.startswith(_SUBJECT) for a in node.names):
                    offenders.append(name)
            elif isinstance(node, pyast.ImportFrom):
                base = _resolve_from(node, pkg)
                if base.startswith(_SUBJECT) or any(
                        f"{base}.{a.name}" == _SUBJECT for a in node.names):
                    offenders.append(name)
    assert not offenders, f"routers importing the sweep: {sorted(set(offenders))}"


#: The scheduler job that has always been the sweep's one production caller.
_SCHEDULER_SITE = "api/main.py::_run_scan_sweep"


def _sweep_call_sites(overlay=None) -> set:
    """Every `api/**` call of an `_ENTRY_POINTS` function, as ``path::function``.

    ⛔ AST OVER THE TREE, NEVER A GREP. `overlay` plants a source under a module
    name so a control can prove this can still SEE a call site that is not there
    today — a census whose answer is fixed by construction rules on nothing.
    """
    overlay = overlay or {}
    sites = set()
    for name in sorted(set(_MODULES) | set(overlay)):
        if name == _SUBJECT:
            continue
        tree = _parse(name, overlay)
        if tree is None:                                 # pragma: no cover
            continue
        rel = (_MODULES[name].relative_to(_ROOT).as_posix()
               if name in _MODULES else name)
        pkg = name.rsplit(".", 1)[0] if "." in name else name
        aliases = _alias_map(
            [n for n in pyast.walk(tree)
             if isinstance(n, (pyast.Import, pyast.ImportFrom))], pkg)
        # ⚠️ THE INNERMOST ENCLOSING FUNCTION WINS. `ast.walk` is breadth-first,
        # so an outer function is seen before the one nested inside it and a plain
        # assignment leaves the nested name in place. E-6's writer census uses
        # `setdefault` (outermost) and would have reported `register_screener_jobs`
        # here — true, but not the name a reader would go looking for.
        enclosing = {}
        for fn in pyast.walk(tree):
            if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
                for n in pyast.walk(fn):
                    enclosing[id(n)] = fn.name
        for call in [n for n in pyast.walk(tree) if isinstance(n, pyast.Call)]:
            dotted = _dotted(call.func)
            if not dotted:
                continue
            parts = dotted.split(".")
            target = aliases.get(parts[0])
            if target is None:
                continue
            full = ".".join([target] + parts[1:])
            if (full.startswith(_SUBJECT + ".")
                    and full.rsplit(".", 1)[-1] in _ENTRY_POINTS):
                sites.add(f"{rel}::{enclosing.get(id(call), '<module>')}")
    return sites


def _expected_sweep_call_sites() -> set:
    """The scheduler job plus every `_BOUNDED_CALLERS` entry — DERIVED from that
    set, never retyped beside it, so a second name added there without a ruling
    cannot be spelled into this expectation by accident."""
    out = {_SCHEDULER_SITE}
    for module, func in _BOUNDED_CALLERS:
        path = _MODULES.get(module)
        assert path is not None, f"{module} is not a module under api/"
        out.add(f"{path.relative_to(_ROOT).as_posix()}::{func}")
    return out


def test_the_production_callers_of_the_sweep_are_the_SCHEDULER_and_ONE_BOUNDED_DOOR():
    """⭐ THE DOOR HAS EXACTLY TWO PRODUCTION CALL SITES AND BOTH ARE NAMED.

    (Was `test_the_ONLY_production_caller_of_the_sweep_is_the_SCHEDULER` until
    2026-08-26 — renamed, not relaxed: leaving a name that says ONLY beside an
    assertion that expects two is the artifact-that-lies defect this program keeps
    paying for. A grep for the old name lands here.)

    Phase C's zero-to-one idiom, now zero-to-two: a door deliberately shut, with
    the shut asserted, and each opening NAMED — so a third caller (a route, a
    warmer, a startup hook) fails BY NAME rather than arriving unnoticed.

      * `api/main.py::_run_scan_sweep`  — the 05:00 ET cron job.
      * `_BOUNDED_CALLERS`              — the on-demand pool worker (spec §5.5,
        lane W4a). It is NOT a request: the handlers queue, this runs on
        `scan_run._POOL`'s one thread, and everything about that shape is
        asserted by the three tests below.
    """
    sites = _sweep_call_sites()
    assert sites == _expected_sweep_call_sites(), (
        f"the sweep's production call sites are {sorted(sites)} — exactly "
        f"{sorted(_expected_sweep_call_sites())} are expected: the scheduler job, "
        "and the BOUNDED on-demand worker (`_BOUNDED_CALLERS`)")


def test_the_call_site_census_SEES_a_planted_THIRD_caller():
    """⚠️ THE CONTROL ON THE TEST ABOVE. An expectation that grew to admit a real
    call site is worth nothing unless the instrument can still SEE the next one.
    A planted module calling the sweep from an ordinary function must appear.
    """
    planted = "api.services.__planted_for_this_test__"
    sites = _sweep_call_sites(overlay={planted: (
        "from api.services.screener import scan_evaluator\n"
        "def some_new_warmer():\n"
        "    return scan_evaluator.run_sweep([])\n")})
    assert f"{planted}::some_new_warmer" in sites, sorted(sites)
    assert sites - _expected_sweep_call_sites() == {f"{planted}::some_new_warmer"}


# ═══ the bounded door: the path TERMINATES at the queue ═════════════════

def _forward_closure(nodes) -> set:
    """Every `api.*` function reachable from `nodes` along call edges."""
    _build_graph()
    seen, stack = set(), list(nodes)
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        _, callees = _GRAPH.get(node, (set(), set()))
        stack.extend(callees)
    return seen


def _entry_points_named_in(nodes) -> list:
    """``func -> ref`` for every node in `nodes` that NAMES a sweep entry point."""
    out = []
    for node in sorted(nodes):
        refs, _ = _GRAPH.get(node, (set(), set()))
        for ref in sorted(refs):
            if (ref.startswith(_SUBJECT + ".")
                    and ref.rsplit(".", 1)[-1] in _ENTRY_POINTS):
                out.append(f"{node[0]}::{node[1]} -> {ref}")
    return out


def _run_router_handlers() -> list:
    """The mounted handlers of the on-demand router, off `router.routes`.

    ⛔ DERIVED FROM THE ROUTE TABLE, not from the router's source and not from a
    typed pair: an unmounted route answers 200 SPA HTML rather than 404, so only
    the table FastAPI dispatches on can answer "which handlers are there".
    """
    router = "api.routers." + _BOUNDED_MODULE.rsplit(".", 1)[-1]
    handlers = [h for h in _endpoints_from_router_routes() if h[0] == router]
    assert handlers, (
        f"no mounted handler belongs to {router} — either it was unmounted or "
        "this rail is now asserting nothing")
    return handlers


def test_the_run_handlers_reach_the_QUEUE_and_STOP__the_evaluator_is_past_the_pool():
    """⭐ "THE PATH TERMINATES AT THE QUEUE", SAID AS AN ASSERTION.

    The module clause is off for `_BOUNDED_MODULE`, so this is the half that
    replaces it on the reach question, and it is four statements, not one:

      1. what the mounted handlers NAME in that module is EXACTLY `_QUEUE_DOORS`
         — a handler that started calling a third function of it fails here;
      2. nothing either door can reach is a `_BOUNDED_CALLERS` entry, and no
         function in that whole closure names an entry point — so the queue is
         genuinely between the request and the sweep, rather than merely looking
         that way in the two functions somebody happened to check;
      3. the census itself agrees, which is the statement W4b's red made; and
      4. the door the exemption was granted to is still BOUNDED.
    """
    _build_graph()
    handlers = _run_router_handlers()

    named = set()
    for handler in handlers:
        _, callees = _refs_and_callees(handler[0], handler[1], {})
        named |= {c for c in callees if c[0] == _BOUNDED_MODULE}
    assert named == _QUEUE_DOORS, (
        f"the mounted handlers name {sorted(named)} in {_BOUNDED_MODULE}; the "
        f"ruled set is {sorted(_QUEUE_DOORS)}. A handler that reaches a third "
        "function of the run service has not been ruled on.")

    reached = _forward_closure(_QUEUE_DOORS)
    # the two non-vacuity controls this pair of assertions needs: the walk really
    # went PAST its seeds, and the matcher really can recognise an entry point --
    # a closure that stopped at the doors, or a matcher that recognised nothing,
    # would satisfy both of the assertions below exactly the way a correct one does.
    assert reached > _QUEUE_DOORS, (
        "the forward walk from the queue doors reached nothing beyond them")
    assert _entry_points_named_in(_forward_closure(_BOUNDED_CALLERS)), (
        "the same walk over the BOUNDED caller reports no entry point -- the "
        "matcher is blind and the two assertions below say nothing")
    assert not (reached & _BOUNDED_CALLERS), (
        f"a queue door can reach {sorted(reached & _BOUNDED_CALLERS)} — the pool "
        "is no longer between the request thread and the evaluation")
    assert not _entry_points_named_in(reached), _entry_points_named_in(reached)

    offenders = [f"{h[2]} -> {h[0]}::{h[1]}" for h in handlers
                 if _transitive_imports_and_calls(h)]
    assert not offenders, offenders

    # — and the exemption was granted to a BOUNDED door. The cap's VALUE and its
    # behaviour live in `scan_run` and `tests/test_scan_run.py`; what is asserted
    # here is the ceiling this ruling was reasoned under.
    from api.services.screener import scan_run

    assert scan_run.MAX_RUN_SYMBOLS <= _BOUNDED_SYMBOL_CEILING, (
        f"the on-demand door now admits {scan_run.MAX_RUN_SYMBOLS} symbols; the "
        f"exemption above was reasoned at ≤ {_BOUNDED_SYMBOL_CEILING} and has to "
        "be made again, not widened here")


# ═══ the escape the module clause used to close ═══════════════════════

def _sweep_declared_names() -> set:
    """Every name the subject declares at module level — functions, classes and
    assignments — DERIVED from its AST, so a typo or a dynamic reach cannot be
    read as "probably some constant"."""
    tree = _parse(_SUBJECT, {})
    assert tree is not None, f"{_SUBJECT} did not parse — the rail is vacuous"
    out = set()
    for node in tree.body:
        if isinstance(node, (pyast.FunctionDef, pyast.AsyncFunctionDef, pyast.ClassDef)):
            out.add(node.name)
        elif isinstance(node, pyast.Assign):
            for target in node.targets:
                if isinstance(target, pyast.Name):
                    out.add(target.id)
                elif isinstance(target, pyast.Tuple):
                    out |= {e.id for e in target.elts if isinstance(e, pyast.Name)}
        elif isinstance(node, pyast.AnnAssign) and isinstance(node.target, pyast.Name):
            out.add(node.target.id)
    return out


def _sweep_public_functions() -> set:
    tree = _parse(_SUBJECT, {})
    return {n.name for n in tree.body
            if isinstance(n, (pyast.FunctionDef, pyast.AsyncFunctionDef))
            and not n.name.startswith("_")}


def _unruled_sweep_references(module: str, overlay=None) -> list:
    """Every reference to the sweep inside `module` this file cannot RULE ON.

    The module clause is off for `_BOUNDED_MODULE`, so the escape it existed to
    close is closed here BY NAME instead — and this is the one place that reads
    the module object as a VALUE rather than as a call graph:

      * a local bound to the sweep MODULE may appear only as the `.value` of an
        attribute access. `getattr(scan_evaluator, name)`, `se = scan_evaluator`,
        `helper(scan_evaluator)` — anything that hands the object around — is
        unruled, because from there the census can no longer say what was reached.
      * the attribute reached must be a name the subject DECLARES, and when it is
        one of the subject's public FUNCTIONS it must be an `_OFF_SWEEP_READS`
        entry, or an `_ENTRY_POINTS` one inside a `_BOUNDED_CALLERS` function.
      * a local bound DIRECTLY to an entry point (`from …scan_evaluator import
        evaluate_one`) may only be USED inside a `_BOUNDED_CALLERS` function.
    """
    overlay = overlay or {}
    tree = _parse(module, overlay)
    assert tree is not None, f"{module} did not parse — the rail is vacuous"
    pkg = module.rsplit(".", 1)[0] if "." in module else module
    aliases = _alias_map(
        [n for n in pyast.walk(tree)
         if isinstance(n, (pyast.Import, pyast.ImportFrom))], pkg)
    module_aliases = {k for k, v in aliases.items() if v == _SUBJECT}
    named_aliases = {k: v.rsplit(".", 1)[-1] for k, v in aliases.items()
                     if v.startswith(_SUBJECT + ".")}

    enclosing = {}
    for fn in pyast.walk(tree):
        if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
            for n in pyast.walk(fn):
                enclosing[id(n)] = fn.name
    parents = {}
    for node in pyast.walk(tree):
        for child in pyast.iter_child_nodes(node):
            parents[id(child)] = node

    allowed = {f for m, f in _BOUNDED_CALLERS if m == module}
    declared, public = _sweep_declared_names(), _sweep_public_functions()
    out = []
    for node in pyast.walk(tree):
        if not isinstance(node, pyast.Name):
            continue
        where = enclosing.get(id(node), "<module>")
        if node.id in module_aliases:
            parent = parents.get(id(node))
            if not (isinstance(parent, pyast.Attribute) and parent.value is node
                    and isinstance(node.ctx, pyast.Load)):
                out.append(
                    f"{where}: the sweep MODULE is handed around as a value at "
                    f"line {node.lineno} rather than read as an attribute — from "
                    "there an AST census cannot say what it reaches")
                continue
            attr = parent.attr
            if attr not in declared:
                out.append(f"{where}: `{node.id}.{attr}` (line {node.lineno}) is "
                           "not a name the sweep module declares")
            elif attr in public and attr not in _OFF_SWEEP_READS and where not in allowed:
                out.append(
                    f"{where}: names `{attr}` (line {node.lineno}); only "
                    f"{sorted(allowed) or 'no function in this module'} may reach "
                    "the sweep here")
        elif node.id in named_aliases and isinstance(node.ctx, pyast.Load):
            attr = named_aliases[node.id]
            if attr in _ENTRY_POINTS and where not in allowed:
                out.append(f"{where}: uses `{node.id}` (= {_SUBJECT}.{attr}) at "
                           f"line {node.lineno}, outside {sorted(allowed)}")
    return out


def test_the_BOUNDED_module_names_the_sweep_ONLY_in_RULED_forms():
    """⛔ THE HALF THE NARROWING OWES. The module clause was closing a real hole —
    a bound module object is one `getattr` from the whole sweep — so turning it
    off for `_BOUNDED_MODULE` would be a relaxation unless that hole is closed by
    name. It is: every reference to the sweep in that module is read off the AST
    and ruled on individually.
    """
    unruled = _unruled_sweep_references(_BOUNDED_MODULE)
    assert not unruled, (
        f"{_BOUNDED_MODULE} reaches the sweep in ways this rail cannot rule on:"
        "\n  " + "\n  ".join(unruled))


# ═══ the controls: the narrowing is LOAD-BEARING, not decoration ═════════

#: A faithful skeleton of `scan_run.py` — the same import, the same three
#: functions, the queue between them — into which each control plants ONE edit.
_QUEUE_SHAPE = """from api.services.screener import scan_evaluator
from concurrent.futures import ThreadPoolExecutor
_POOL = ThreadPoolExecutor(max_workers=1)
def _run_job(job_id):
    return scan_evaluator.evaluate_one({}, 'D', universe=[], mode='on-demand')
def submit_run(user_id, def_id, **kw):
    %s
    return 'job-1'
def job_status(job_id, user_id):
    return {'state': 'queued'}
"""


@pytest.mark.parametrize("plant,why", [
    ("return scan_evaluator.evaluate_one({}, 'D')",
     "the door evaluates on the request thread itself"),
    ("_run_job('job-1')",
     "the queue collapsed — submit CALLS the worker body instead of posting it"),
])
def test_the_NARROWING_is_LOAD_BEARING__a_planted_second_path_is_still_caught(plant, why):
    """⛔ AN EXEMPTION NOBODY HAS SEEN FIRE IS A HOLE.

    Both plants leave `_QUEUE_DOORS`, `_BOUNDED_CALLERS` and the router untouched
    and change only what `submit_run` DOES — so a narrowing written as "these two
    doors are fine" would sail through both. The second is the one the lane
    brief's prescribed graph-leaf rule would have missed: with `_BOUNDED_CALLERS`
    cut out of propagation, a direct call to the worker body from the request
    thread is invisible, and that is the entire outage class.
    """
    handlers = _run_router_handlers()
    caught = [h for h in handlers
              if _transitive_imports_and_calls(
                  h, overlay={_BOUNDED_MODULE: _QUEUE_SHAPE % plant})]
    assert caught, (
        f"the census did not catch a planted path where {why} — the narrowing "
        "around the on-demand door exempts more than it says it does")


@pytest.mark.parametrize("plant,why", [
    ("def job_status(job_id, user_id):\n"
     "    return getattr(scan_evaluator, 'evaluate_one')({}, 'D')\n",
     "reached dynamically, which no call graph can follow"),
    ("def resolve_universe(user_id, **kw):\n"
     "    return scan_evaluator.run_sweep([])\n",
     "a second function of the bounded module calling the sweep"),
    ("def _run_job(job_id):\n"
     "    return scan_evaluator.evaluate_one({}, 'D')\n"
     "def submit_run(user_id, def_id, **kw):\n"
     "    se = scan_evaluator\n"
     "    return se.evaluate_one({}, 'D')\n",
     "the module rebound to a local name and used from there"),
])
def test_the_RULED_FORMS_check_SEES_each_escape_the_module_clause_used_to_close(plant, why):
    """⚠️ THE CONTROL ON THE TEST ABOVE, in the three shapes that matter. The
    first is the reason the module clause is blunt everywhere else: a `getattr` is
    invisible to a call-graph census, so only a rule about the module OBJECT can
    see it at all.
    """
    source = "from api.services.screener import scan_evaluator\n" + plant
    unruled = _unruled_sweep_references(_BOUNDED_MODULE,
                                        overlay={_BOUNDED_MODULE: source})
    assert unruled, f"the ruled-forms check missed a sweep reference {why}"


def test_the_RULED_FORMS_check_does_not_fire_on_a_NAMESAKE_or_an_OFF_SWEEP_read():
    """⛔ AND THE OTHER HALF: a check that fires on the WORD is a grep wearing an
    AST's clothes, and one that fired on `expected_session` would push the door
    into re-deriving the session calendar itself."""
    for source in (
        # the ruled reads the door really makes, in the shapes it makes them
        "from api.services.screener import scan_evaluator\n"
        "def submit_run(user_id, def_id, tf=scan_evaluator.DEFAULT_TF):\n"
        "    return scan_evaluator.expected_session()\n",
        # a NAMESAKE alias bound to something else entirely
        "from api.services import engine as scan_evaluator\n"
        "def submit_run(user_id, def_id):\n"
        "    return scan_evaluator.get_movers()\n",
        # prose, which is what a grep would have reported
        "SCAN = 'scan_evaluator.evaluate_one'\n"
        "def submit_run(user_id, def_id):\n"
        "    return SCAN\n",
    ):
        assert not _unruled_sweep_references(
            _BOUNDED_MODULE, overlay={_BOUNDED_MODULE: source}), source
