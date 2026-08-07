"""The budget, in the lane that can still prove the RecursionError half.

⭐ THIS FILE'S FIRST IMPORT IS ``ast_budget``, AND THAT IS A RAIL RATHER THAN A
HABIT. ``ast_budget`` imports ``ast_interpret`` at module level and
``ast_interpret.interpret`` imports ``ast_budget`` INSIDE the function; Python has
no live bindings, so a genuine top-level cycle would break for whichever module
is imported second. ``tests/test_ast_interpret.py`` imports the interpreter first;
this one imports the budget first. If the resolution broke in this direction
every case below would fail at collection — the loudest possible way to report
it.

⭐⭐ WHAT THIS LANE OWNS THAT THE JS ONE CANNOT. ``maxNodes`` is 128 and a
canonical tree's DEPTH can never exceed its node count, so once the budget is in
place the recursive walker can be reached with at most 128 frames — the
``RangeError`` / ``RecursionError`` is UNREACHABLE through ``interpret``. In JS
that leaves only a structural rail (``budget.test.js`` walks both modules' ASTs
and asserts zero ``try``). Python can lower its OWN recursion limit, so the
behavioural proof survives here: a tree well inside every cap, evaluated under a
limit low enough to exhaust the stack, must raise ``RecursionError`` and must NOT
raise a ``TableRefusal``.
"""
from __future__ import annotations

import ast as pyast
import io
import json
import os
import pathlib
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

from api.services import ast_budget            # noqa: E402  ← FIRST, deliberately
from api.services import ast_interpret         # noqa: E402

_FIXTURES = _ROOT / "tests" / "fixtures" / "ast"
_MANIFEST = (_ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
             / "closedTable.json")
_JS_BUDGET = (_ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
              / "budget.js")


def _read_json(path) -> dict:
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


ESCAPES = _read_json(_FIXTURES / "escapes.json")
CORPUS = _read_json(_FIXTURES / "corpus.json")
TABLE = _read_json(_MANIFEST)

BARS = [{"t": i, "o": 1.0, "h": 2.0, "l": 0.5, "c": float(i + 1), "v": 100}
        for i in range(64)]

NUM = lambda v: {"type": "num", "value": v}                       # noqa: E731
SER = lambda n: {"type": "series", "name": n}                     # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}     # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731


def chain_of_nodes(n: int) -> dict:
    """A canonical tree of EXACTLY ``n`` nodes, built ITERATIVELY.

    A recursive builder would die constructing the very input the node budget
    exists to refuse. A ``u-`` chain gives exact control of the count — one node
    per wrap — which a ``1 + (1 + …)`` chain cannot: that one only produces ODD
    counts, so it can never land ON a boundary.
    """
    node = NUM(1)
    for _ in range(n - 1):
        node = OP("u-", node)
    return node


def chain_of_series(n: int) -> dict:
    """A canonical tree performing EXACTLY ``n`` base-series reads."""
    names = sorted(TABLE["series"])
    node = SER(names[0])
    for i in range(1, n):
        node = OP("+", node, SER(names[i % len(names)]))
    return node


def guard_of(fn) -> str:
    """The guard that fired, or a NAMED non-refusal. Never a bare boolean."""
    try:
        fn()
    except ast_interpret.TableRefusal as exc:
        return exc.guard
    except Exception as exc:  # noqa: BLE001
        return f"NOT-A-REFUSAL:{type(exc).__name__}"
    return "REACHED-A-VALUE"


# ═══════════════════════════════════════════════════════════════════════════ #
# 1. THE CAPS ARE ONE SET, AND THE TWO LANES HOLD THE SAME NUMBERS
# ═══════════════════════════════════════════════════════════════════════════ #

def test_every_cap_has_a_guard_and_every_guard_has_a_sentence():
    """⛔ BOTH DIRECTIONS, DERIVED. A cap with no guard is a number nothing reads;
    a guard with no cap is a refusal nothing can produce — the shape of
    ``lesson_gate_that_cannot_fail``. Neither survives a set equality both ways,
    and neither is visible to a test that reads one list."""
    caps = sorted(ast_budget.DEFAULT_BUDGET)
    assert sorted(ast_budget.CAP_GUARD) == caps
    assert sorted(ast_budget.CAP_GUARD.values()) == sorted(ast_budget.REFUSALS)
    assert sorted(ast_budget.CAP_ORDER) == caps, "a cap outside CAP_ORDER is never consulted"
    assert len(caps) >= 3
    for cap, value in ast_budget.DEFAULT_BUDGET.items():
        assert isinstance(value, int) and not isinstance(value, bool) and value >= 1, cap


def test_the_two_lanes_hold_THE_SAME_THREE_NUMBERS_read_not_retyped():
    """⛔ READ OUT OF ``budget.js``, NEVER RE-TYPED. Two lanes with different caps
    is two products: a formula the browser accepts and the server refuses is the
    exact shape of the B5 defect where an alert naming a JS-only indicator could
    be STORED and could never FIRE.

    The JS source is parsed with a narrow regex over its ``DEFAULT_BUDGET``
    literal rather than executed, because this lane has no JS runtime — and the
    parse is asserted NON-VACUOUS first, so a regex that stopped matching cannot
    read as agreement.
    """
    import re
    src = io.open(_JS_BUDGET, encoding="utf-8").read().replace("\r\n", "\n")
    block = re.search(r"export const DEFAULT_BUDGET = Object\.freeze\(\{(.*?)\}\)",
                      src, re.S)
    assert block, "budget.js no longer declares DEFAULT_BUDGET in the shape this reads"
    found = {k: int(v) for k, v in re.findall(r"(\w+)\s*:\s*(\d+)", block.group(1))}
    assert found, "the DEFAULT_BUDGET block parsed to NOTHING — a vacuous agreement"
    assert found == dict(ast_budget.DEFAULT_BUDGET), (
        f"the lanes disagree about the caps: js={found} py={dict(ast_budget.DEFAULT_BUDGET)}")


def test_the_refusal_sentences_are_disjoint_from_every_other_guards():
    """⛔ Two gates sharing a phrase let a ``raises(match=…)`` pass with the safety
    deleted, and that has happened in this repo (Phase C Task 9's M1). The
    substring half is the one a set-equality misses."""
    everything = dict(ast_interpret.REFUSALS)
    everything.update(ast_budget.REFUSALS)
    assert len(everything) == len(ast_interpret.REFUSALS) + len(ast_budget.REFUSALS)
    sentences = list(everything.values())
    assert len(set(sentences)) == len(sentences)
    for a in sentences:
        for b in sentences:
            if a is not b:
                assert a not in b, f"{a!r} is a SUBSTRING of {b!r}"
    for guard in ast_budget.REFUSALS:
        assert guard.startswith("budget:")
    for guard in ast_interpret.REFUSALS:
        assert not guard.startswith("budget:")


def test_the_caps_have_headroom_over_everything_this_repo_ships():
    """⚠️ THE OTHER DIRECTION OF THE SAME RISK. A cap tight enough to refuse the
    committed corpus takes ``--check`` red the moment it lands; a cap nothing can
    reach is not a guard. Both numbers are MEASURED here."""
    worst = {k: 0 for k in ast_budget.DEFAULT_BUDGET}
    for case in CORPUS["cases"]:
        result = ast_budget.budget_result(case["ast"], None)
        assert result["ok"], f"{case['id']} is over budget: {result.get('error')}"
        for cap, value in result["measured"].items():
            worst[cap] = max(worst[cap], value)
    for cap, cap_value in ast_budget.DEFAULT_BUDGET.items():
        assert worst[cap] < cap_value, f"{cap}: the corpus already sits AT the cap"
    assert len(CORPUS["cases"]) >= 17


# ═══════════════════════════════════════════════════════════════════════════ #
# 2. BOTH DOORS, AND BOTH LETHAL
# ═══════════════════════════════════════════════════════════════════════════ #

def test_a_budget_is_checked_at_REGISTRATION_and_again_at_COMPUTE():
    """⛔ BOTH, AND THE REASON IS NOT BELT-AND-BRACES.

    Registration-only: a definition registered under one budget and run under a
      later, smaller one computes forever at the old cost.
    Compute-only: the refusal arrives as a chart that draws sometimes — spec §6
      state 4, when it should have been an error the author saw while typing.

    The registration check is the UX; the compute check is the SAFETY, and the
    safety one is the one a mutation must not be able to delete quietly.
    """
    fat = chain_of_nodes(ast_budget.DEFAULT_BUDGET["maxNodes"] + 1)
    assert ast_budget.budget_result(fat, None)["ok"] is False
    with pytest.raises(ast_budget.BudgetExceeded, match="exceeds the node budget"):
        ast_budget.check_budget(fat, None)
    with pytest.raises(ast_interpret.TableRefusal, match="exceeds the node budget"):
        ast_interpret.interpret(fat, BARS)


def test_the_refusal_is_a_TableRefusal_by_INHERITANCE_not_by_resemblance():
    """⛔ THE TYPE IS THE CONTRACT. ``tools/ast_conformance.py`` recognises a
    refusal BY TYPE and reconciles ``.guard`` against the guard the case declares.
    A separate class that merely LOOKED like a refusal is the "right type for the
    wrong reason" blindness that instrument declared about itself."""
    assert issubclass(ast_budget.BudgetExceeded, ast_interpret.TableRefusal)
    caught = None
    try:
        ast_interpret.interpret(chain_of_nodes(200), BARS)
    except ast_interpret.TableRefusal as exc:
        caught = exc
    assert isinstance(caught, ast_budget.BudgetExceeded)
    assert caught.guard == "budget:nodes"


@pytest.mark.parametrize("cap, guard", sorted(ast_budget.CAP_GUARD.items()))
def test_each_cap_admits_AT_the_boundary_and_refuses_ONE_over_it(cap, guard):
    """⭐ AT the cap, not near it. A guard tested only with a wildly oversized
    input passes with an off-by-one in EITHER direction, and an off-by-one that
    ADMITS is a guard that is not there for the case it was written for. Every
    number below is READ OUT OF ``DEFAULT_BUDGET``, never typed — and the
    parametrisation is DERIVED from ``CAP_GUARD``, so a fourth cap arrives here
    with no edit and a renamed one fails by name."""
    limit = ast_budget.DEFAULT_BUDGET[cap]
    build = {
        "maxNodes": chain_of_nodes,
        "maxLookback": lambda n: CALL("sma", SER("close"), NUM(n)),
        "maxSeriesRefs": chain_of_series,
    }[cap]

    at_the_cap = build(limit)
    assert ast_budget._MEASURE[cap](at_the_cap) == limit, "the fixture is not AT the cap"
    assert ast_budget.budget_result(at_the_cap, None)["ok"] is True
    # …and it really COMPUTES, which a refusal-only test never checks: a guard
    # that refused everything would satisfy the negative half alone.
    assert len(ast_interpret.interpret(at_the_cap, BARS)) == len(BARS)

    over = build(limit + 1)
    result = ast_budget.budget_result(over, None)
    assert result["ok"] is False and result["guard"] == guard, result
    assert guard_of(lambda: ast_interpret.interpret(over, BARS)) == guard


def test_the_lookback_budget_is_a_TREE_SUM_not_the_largest_single_argument():
    """``sma(sma(close, 300), 300)`` looks back 600 bars, not 300. A budget that
    read the largest argument would admit a formula needing more history than the
    chart holds — and a column that is NaN for its whole visible range is a line
    the user cannot see and cannot debug."""
    inner = CALL("sma", SER("close"), NUM(300))
    assert ast_interpret.max_lookback(CALL("sma", inner, NUM(300))) == 600
    assert ast_budget.budget_result(inner, None)["ok"] is True
    assert ast_budget.budget_result(CALL("sma", inner, NUM(300)), None)["guard"] == "budget:lookback"


# ═══════════════════════════════════════════════════════════════════════════ #
# 3. THE STORED BUDGET IS USER DATA
# ═══════════════════════════════════════════════════════════════════════════ #

def test_a_stored_budget_overrides_the_default_DOWNWARD_ONLY():
    """⛔ DOWNWARD ONLY. ``compute.budget`` arrives from a stored definition,
    which is USER DATA. A stored budget that could RAISE the cap is a stored value
    that turns off its own limit — the same class as an ``active=0`` that also
    blinds a soak, refused for the same reason."""
    assert ast_budget.effective_budget({"maxNodes": 9999})["maxNodes"] == \
        ast_budget.DEFAULT_BUDGET["maxNodes"]
    assert ast_budget.effective_budget({"maxNodes": 8})["maxNodes"] == 8
    for cap, cap_value in ast_budget.DEFAULT_BUDGET.items():
        assert ast_budget.effective_budget({cap: cap_value * 10})[cap] == cap_value
        assert ast_budget.effective_budget({cap: 1})[cap] == 1
        assert ast_budget.effective_budget({cap: cap_value})[cap] == cap_value


def test_the_clamp_is_INSIDE_the_check_so_no_caller_can_route_around_it():
    """⚠️ A CLAMP A CALLER HAS TO REMEMBER IS A CLAMP SOMEBODY FORGETS."""
    fat = chain_of_nodes(ast_budget.DEFAULT_BUDGET["maxNodes"] + 1)
    result = ast_budget.budget_result(fat, {"maxNodes": 10 ** 9})
    assert result["ok"] is False and result["guard"] == "budget:nodes"
    assert result["caps"]["maxNodes"] == ast_budget.DEFAULT_BUDGET["maxNodes"]
    with pytest.raises(ast_interpret.TableRefusal, match="exceeds the node budget"):
        ast_interpret.interpret(fat, BARS, None, {"maxNodes": 10 ** 9})
    # …and a TIGHTER stored budget really does reach compute, which is the whole
    # reason the compute check re-reads it rather than trusting registration.
    slim = CALL("sma", SER("close"), NUM(20))
    assert len(ast_interpret.interpret(slim, BARS)) == len(BARS)
    assert guard_of(lambda: ast_interpret.interpret(slim, BARS, None, {"maxLookback": 19})) \
        == "budget:lookback"


@pytest.mark.parametrize("junk", [
    None, "lots", {}, [], 7, {"maxNodes": "lots"}, {"maxNodes": 0}, {"maxNodes": -5},
    {"maxNodes": 12.5}, {"maxNodes": True}, {"maxNodes": None},
])
def test_a_malformed_stored_budget_falls_back_to_the_CEILING_never_above_it(junk):
    """A blob that is not a whole number ≥ 1 is ``defSchema``'s problem at a
    different door. What matters here is the DIRECTION of the fallback: the
    default IS the ceiling, so falling back to it can only tighten.

    ⚠️ ``{"maxNodes": True}`` IS IN THE LIST ON PURPOSE. ``isinstance(True, int)``
    is ``True`` and ``True >= 1`` is ``True``, so a bool sails through every
    obvious guard in this language — the same trap ``_number`` refuses loudly for.
    """
    effective = ast_budget.effective_budget(junk)
    assert effective == dict(ast_budget.DEFAULT_BUDGET), junk


def test_an_undeclared_cap_key_is_ignored_rather_than_absorbed():
    """A stored blob cannot introduce a cap this module has no guard for."""
    assert sorted(ast_budget.effective_budget({"maxWhatever": 3})) == \
        sorted(ast_budget.DEFAULT_BUDGET)


# ═══════════════════════════════════════════════════════════════════════════ #
# 4. THE DOOR. THIS IS THE DEFECT THE WHOLE TASK IS ABOUT.
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_corpus_carries_a_case_for_EVERY_cap_named_not_counted():
    """⚠️ A LIST, NOT A COUNT. A count survives a rename; a list names the case
    that moved. And without this floor every assertion below is satisfied by an
    EMPTY corpus — the same way ``escaped == parsed`` is satisfied by ``0 == 0``.
    """
    budget_cases = [c for c in ESCAPES["cases"] if str(c["guard"]).startswith("budget:")]
    assert sorted(c["id"] for c in budget_cases) == [
        "lookback_too_deep", "nested_lookback", "too_many_nodes", "too_many_series"]
    assert sorted({c["guard"] for c in budget_cases}) == sorted(ast_budget.REFUSALS)


def test_a_refusal_that_belongs_to_another_guard_is_never_relabelled_as_a_budget_one():
    """⭐ THE HALF A BUDGET IS MOST LIKELY TO BREAK. ``budget_result`` calls
    ``max_lookback``, which refuses ``resolve:function``, ``resolve:arity`` and
    ``resolve:window``; because the budget now runs FIRST, those refusals are
    raised from INSIDE it. They must still name their own door — a refusal names
    what DECIDED, never what was on the stack when it did."""
    assert guard_of(lambda: ast_interpret.interpret(
        CALL("rugpull", SER("close"), NUM(3)), BARS)) == "resolve:function"
    assert guard_of(lambda: ast_interpret.interpret(
        CALL("sma", SER("close")), BARS)) == "resolve:arity"
    assert guard_of(lambda: ast_interpret.interpret(
        CALL("sma", SER("close"), SER("close")), BARS)) == "resolve:window"
    assert guard_of(lambda: ast_interpret.interpret(SER("globalThis"), BARS)) == "resolve:name"
    assert guard_of(lambda: ast_interpret.interpret({"type": "wat"}, BARS)) == "interpret:node"
    # …and through the REGISTRATION door too, which returns a result for a budget
    # and RAISES for anything else. A ``budget_result`` that swallowed these into
    # ``{ok: False, guard: 'budget:*'}`` would move four cases to the wrong door
    # in a single edit.
    assert guard_of(lambda: ast_budget.budget_result(
        CALL("rugpull", SER("close"), NUM(3)), None)) == "resolve:function"
    assert guard_of(lambda: ast_budget.budget_result({"type": "wat"}, None)) == "interpret:node"


def test_max_lookback_answers_0_for_an_undeclared_series_and_it_CANNOT_BITE():
    """⏳ TASK 7 HANDED THIS FORWARD AS THE ONE DECLARED DIVERGENCE: ``max_lookback``
    treats EVERY ``series`` node as 0 lookback, including a name the table has
    never heard of. A budget computed from a wrong lookback is a budget that does
    not bind — so this has to be argued, not assumed.

    ⭐ IT CANNOT BITE, AND THE PROOF IS THE ORDER OF THE DOORS RATHER THAN A
    SECOND CHECK. ``max_lookback`` is only ever WRONG about a name that does not
    resolve, and a tree containing such a name is refused by ``resolve:name``
    before it computes a single bar. There is no input for which the budget says
    yes and the walker then runs on a lookback it got wrong.

    ⛔ AND FIXING IT HERE WOULD BE THE WRONG DOOR AGAIN. Refusing an undeclared
    name inside the budget would move ``escapes.json``'s three ``resolve:name``
    cases under a ``budget:*`` guard — re-creating, in one edit, the exact defect
    this task exists to remove.
    """
    assert ast_interpret.max_lookback(SER("globalThis")) == 0
    assert "globalThis" not in TABLE["series"]
    for name in ("toString", "hasOwnProperty", "globalThis", "__class__"):
        assert ast_budget.budget_result(SER(name), None)["ok"] is True   # admitted…
        assert guard_of(lambda n=name: ast_interpret.interpret(SER(n), BARS)) == "resolve:name"
    # ⚠️ THE ONE PLACE AN UNDECLARED NAME *IS* COUNTED IS ``series_refs``, and it
    # is counted CONSERVATIVELY — an over-count can only tighten the budget.
    assert ast_budget.series_refs(SER("globalThis")) == 1


# ═══════════════════════════════════════════════════════════════════════════ #
# 5. A RecursionError IS NOT A REFUSAL, AND IT CANNOT BE MADE INTO ONE
# ═══════════════════════════════════════════════════════════════════════════ #

def _trys_in(source: str) -> list:
    return [n for n in pyast.walk(pyast.parse(source)) if isinstance(n, pyast.Try)]


def test_the_scanner_FINDS_a_relabelling_except_the_positive_control_first():
    """⛔ A DETECTOR NOBODY PROVED CAN FIRE IS NOT A DETECTOR. This is the mutation
    the rail below forbids, written out in full; the scan must see it. Without
    this the next assertion is satisfied by a broken walker.

    ⛔ AN AST, NEVER A GREP — and the second half is why: a source whose only
    ``except`` is inside a STRING must NOT be a hit. ``git grep -c
    admit_alert_fire`` said 2, then 3, on this branch, and every one was prose in
    a comment.
    """
    mutated = (
        "def interpret(ast, bars):\n"
        "    try:\n"
        "        return walk(ast, bars)\n"
        "    except RecursionError:\n"
        "        raise BudgetExceeded('budget:nodes', 'exceeds the node budget')\n")
    assert len(_trys_in(mutated)) == 1
    prose = "# try: walk(ast)\n# except RecursionError: raise BudgetExceeded(...)\nX = 'try: except:'\n"
    assert _trys_in(prose) == []


def test_neither_the_budget_nor_the_interpreter_contains_a_single_try():
    """⭐ THE STRUCTURAL HALF, IN BOTH LANES. ``budget.test.js`` walks
    ``budget.js`` and ``interpret.js`` with acorn and asserts the same zero; this
    walks their Python twins with ``ast``. A caught ``RecursionError`` is one line
    from being a refusal, and the line would be invisible to every behavioural
    test in a lane where the overflow is unreachable."""
    for path in (_ROOT / "api" / "services" / "ast_budget.py",
                 _ROOT / "api" / "services" / "ast_interpret.py"):
        source = io.open(path, encoding="utf-8").read()
        assert _trys_in(source) == [], (
            f"{path.name} grew a try/except — a caught RecursionError is one line "
            "from being a budget refusal")
    # …and the control that keeps the reader honest: this instrument DOES find
    # them elsewhere, so the zero above is a property of those two files.
    assert len(_trys_in(io.open(
        _ROOT / "tools" / "ast_conformance.py", encoding="utf-8").read())) > 0


def test_a_stack_overflow_raises_RecursionError_and_NEVER_a_TableRefusal():
    """⭐⭐ THE BEHAVIOURAL PROOF THIS LANE STILL OWNS.

    With ``maxNodes`` at 128 the walker can be reached with at most 128 frames, so
    the overflow is unreachable through ``interpret`` on the real limit — the
    relabelling defect could be INTRODUCED and never OBSERVED, which is exactly
    the shape that rots green. Lowering the limit makes it observable again: the
    tree below is INSIDE every cap (so the budget admits it) and the walk still
    exhausts the stack, and what comes back must be the language declining, not
    the table.

    ⚠️ THE LIMIT IS RESTORED IN A ``finally`` THAT CANNOT BE SKIPPED, and the
    restore is asserted — a harness that left the interpreter's own limit lowered
    would poison every test after it in the session.
    """
    deep = chain_of_nodes(120)                       # 120 < 128: the budget admits it
    assert ast_budget.budget_result(deep, None)["ok"] is True

    before = sys.getrecursionlimit()
    outcome = None
    try:
        sys.setrecursionlimit(60)                    # < 120 frames of `eval_node`
        try:
            ast_interpret.interpret(deep, BARS)
            outcome = "REACHED-A-VALUE"
        except ast_interpret.TableRefusal as exc:
            outcome = f"REFUSAL:{exc.guard}"
        except RecursionError:
            outcome = "RecursionError"
    finally:
        sys.setrecursionlimit(before)
    assert sys.getrecursionlimit() == before
    assert outcome == "RecursionError", (
        f"a stack overflow was reported as {outcome} — that is the shape that "
        "makes a census report a closed table over a walker that crashed")


def test_the_measurements_survive_the_tree_that_kills_the_walker():
    """⚠️ THE ASYMMETRY IS THE POINT, and it is what lets the budget guard the
    walker rather than needing the walker to be safe first. ``node_count`` and
    ``series_refs`` are iterative; ``interpret`` is a plain recursive walk."""
    fat = chain_of_nodes(8001)
    assert ast_interpret.node_count(fat) == 8001
    assert ast_budget.series_refs(fat) == 0
    result = ast_budget.budget_result(fat, None)
    assert result == {
        "ok": False, "guard": "budget:nodes",
        "error": ("exceeds the node budget — this formula measures 8001 and the "
                  f"cap is {ast_budget.DEFAULT_BUDGET['maxNodes']}"),
        "caps": dict(ast_budget.DEFAULT_BUDGET),
        "measured": {"maxNodes": 8001},
    }
    # ⭐ `measured` HOLDS ONE KEY, AND THAT IS THE SHORT-CIRCUIT BEING ASSERTED:
    # the node cap is what bounds the cost of everything after it, so
    # `max_lookback` never walked this tree at all.
    assert guard_of(lambda: ast_interpret.interpret(fat, BARS)) == "budget:nodes"


# ═══════════════════════════════════════════════════════════════════════════ #
# 6. THE CYCLE
# ═══════════════════════════════════════════════════════════════════════════ #

def test_either_module_may_be_imported_first():
    """The two modules depend on each other and Python has no live bindings, so
    the resolution is order-sensitive and both orders have to be measured.

    This file's collection already proves BUDGET-FIRST. The other order is proved
    in a FRESH INTERPRETER rather than by re-importing here, because ``sys.modules``
    already holds both and a re-import would measure nothing — the vacuous-pass
    shape this phase has now met six distinct ways.
    """
    import subprocess
    for first, second in (("ast_budget", "ast_interpret"), ("ast_interpret", "ast_budget")):
        code = (
            "import sys; sys.path.insert(0, %r)\n"
            "from api.services import %s\n"
            "from api.services import %s\n"
            "from api.services.ast_interpret import interpret\n"
            "bars=[{'t':0,'o':1.0,'h':1.0,'l':1.0,'c':1.0,'v':1}]\n"
            "print(interpret({'type':'num','value':2.0}, bars))\n"
        ) % (str(_ROOT), first, second)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                              text=True, cwd=str(_ROOT), env=env)
        assert proc.returncode == 0, (
            f"importing {first} before {second} broke: {proc.stderr[-800:]}")
        assert proc.stdout.strip() == "[2.0]", proc.stdout
