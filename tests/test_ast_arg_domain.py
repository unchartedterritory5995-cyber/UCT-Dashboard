"""W9k.1 / X41 — the DECLARED argument domain, refused at the resolve pass.

🔴 THE DEFECT. `closedTable.json::_functions_domain` declares an argument domain
the `int` kind cannot express: `macd`'s `lookback: "arg2"` is an upper bound only
while `slow >= fast`, and every line of the Ichimoku family starts at the LONGEST
of its three periods. Both walkers enforced that as an ALL-NaN COLUMN and never
as an exception — so `macd(close, 26, 12)`, a 12/26 transposition one keystroke
away, produced nothing, and `close > macd(close, 26, 12)` measured **0.0 on all
60 bars, one distinct value**:

    unresolved_inputs()   -> []          every symbol ANSWERED
    unresolved_lookback() -> 0           the history question is clean
    assert_scannable()    -> yields bool the screen SAVED

⛔ A definite NO at full reported coverage, on a savable screen, with nothing
anywhere saying the formula was meaningless. A member reads "0 matches" as a
quiet market. That is X23 with the sign reversed, through a door the
not-computable pre-pass cannot see — the hole comes from neither the arguments
nor the declared lookback, but from the manifest's OWN domain declaration.

⭐ THE RULING, AND WHY IT IS NOT A FOURTH PER-ROW QUESTION. `fast > slow` is true
of that TREE on every bar, for every symbol, forever. A property true of the
formula on every row belongs where the formula is ADMITTED, once — the same line
`_fn_avwap` already draws, refusing a sub-1990 anchor BY NAME (`resolve:window`)
while leaving "no bar precedes the anchor" a quiet per-row column, *"and the
asymmetry is the point"*. A per-row check would be wrong twice: it would carry a
decision that cannot vary by row, and it would pay for that decision on every
symbol in the universe.

⛔ WHAT THIS FILE ASSERTS THAT A HAPPY-PATH RAIL WOULD NOT. **Both directions,
per family** — a guard that refuses everything passes half of what matters — and
the ORACLE for "which argument lists are out of domain" is the shipped ADAPTER's
own all-NaN behaviour rather than a predicate re-typed here, so the guard and the
maths cannot drift apart silently.

⛔ AND THE JS LANE HAS ITS OWN HALF (`argDomain.test.js`). The two walkers are a
deliberate mirror at 1e-9; a fix railed in one lane leaves its twin green and
unguarded. The refusal SENTENCE is asserted byte-identical across the two here,
read out of the shipped JS module through node rather than re-typed.
"""
from __future__ import annotations

import json
import math
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

from api.services import ast_interpret, ast_table, scan_definition  # noqa: E402

NUM = lambda v: {"type": "num", "value": v}                        # noqa: E731
SER = lambda n: {"type": "series", "name": n}                      # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}      # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731

#: 60 synthetic daily bars — the fixture the defect was measured on.
BARS = [
    {"t": 1780000000 + i * 86400, "o": 100.0 + i, "h": 101.0 + i,
     "l": 99.0 + i, "c": 100.0 + i + (i % 5), "v": 1000 + i}
    for i in range(60)
]

FUNCTIONS = ast_table.TABLE[ast_table.FUNCTIONS_SECTION]


def _definition(tree):
    return {"id": "x", "compute": {"kind": "ast", "ast": tree}}


def _ceiling_index(name: str) -> int:
    """The argument slot the entry's domain declaration points at.

    ⭐ RESOLVED THROUGH THE WALKER'S OWN `argN` GRAMMAR (`_LOOKBACK_RE`), never a
    second regex here — the pattern this repo already hoisted after a fourth
    hand-written copy branded ADX as repainting in production.
    """
    m = ast_interpret._LOOKBACK_RE.fullmatch(str(ast_table.arg_domains()[name]))
    assert m is not None, f"{name}'s domain declaration names no argument"
    return int(m.group(2))


def _int_slots(name: str) -> list[int]:
    return [i for i, kind in enumerate(tuple(FUNCTIONS[name]["args"])) if kind == "int"]


def _call_with(name: str, periods: dict[int, int]):
    """A call on `name` with the given `int` slots filled and every series slot a
    bar field. Derived from the entry's `args`, so a sixth argument needs no edit."""
    args = []
    for i, kind in enumerate(tuple(FUNCTIONS[name]["args"])):
        args.append(NUM(periods[i]) if kind == "int" else SER(_series_for(name, i)))
    return CALL(name, *args)


def _series_for(name: str, index: int) -> str:
    """The bar field for a series slot, read off `argRoles` when it names one.

    ⚠️ NOT ALWAYS `close`: the Ichimoku family declares `high`/`low`, and handing
    it a flat column would make its window midpoints degenerate.
    """
    roles = tuple(FUNCTIONS[name].get("argRoles") or ())
    role = roles[index] if index < len(roles) else ""
    return role if role in ast_table.TABLE[ast_table.SERIES_SECTION] else "close"


def _adapter_is_all_nan(name: str, periods: dict[int, int]) -> bool:
    """Does the SHIPPED adapter answer an all-NaN column for these periods?

    ⭐⭐ THIS IS THE ORACLE, AND IT IS NOT THE GUARD'S OWN PREDICATE. Asking
    `max(others) > ceiling` here would be the guard re-typed, and a mutation to
    both would pass. `FN[name]` is the walker's binding table — the same maths
    the chart draws — so this test asks *"does this call actually compute
    nothing?"* and the guard has to agree with the answer.
    """
    length = len(BARS)
    args = []
    for i, kind in enumerate(tuple(FUNCTIONS[name]["args"])):
        if kind == "int":
            args.append(periods[i])
        else:
            field = {"high": "h", "low": "l", "close": "c", "open": "o",
                     "volume": "v"}[_series_for(name, i)]
            args.append([float(b[field]) for b in BARS])
    column = ast_interpret.FN[name](*args)
    return all(v is None or (isinstance(v, float) and math.isnan(v)) for v in column[:length])


def _guard_refuses(name: str, periods: dict[int, int]) -> bool:
    try:
        ast_interpret.max_lookback(_call_with(name, periods))
    except ast_interpret.TableRefusal as exc:
        assert exc.guard == "resolve:domain", exc.guard
        return True
    return False


# ═══════════════════════════════════════════════════════════════════════════ #
# 1. THE ROSTER IS DERIVED, AND ITS ABSENCES HAVE REASONS
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_roster_is_READ_OFF_THE_MANIFEST_and_nothing_is_typed_in_either_lane():
    """⛔ A hand-typed list of "functions with an argument domain" beside a
    manifest that already declares them is this repo's most repeated defect.

    Both the roster AND the ceiling come out of the entry: `domain` names another
    key on the same entry, and THAT key's own `argN` declaration is the ceiling.
    So moving an entry's `lookback` to another slot moves its domain with it, and
    no argument index is written down twice.
    """
    domains = ast_table.arg_domains()
    assert domains, "no entry declares an argument domain; this file is vacuous"
    # ⛔ THE CENSUS ASSERTS THE SIZE OF WHAT IT READ. The roster must be exactly
    # the entries the manifest declares — no more (an invented name) and no fewer
    # (a hand-list that quietly drops the Ichimoku five) — and the WALKER's own
    # constant must be that same set, or the guard reads a narrower one.
    declared = sorted(n for n, s in FUNCTIONS.items()
                      if isinstance(s.get(ast_table.ARG_DOMAIN), str))
    assert sorted(domains) == declared, "the reader is not the manifest's own set"
    assert sorted(ast_interpret._ARG_DOMAINS) == declared, (
        "the walker guards a narrower set than the manifest declares")
    for name, declaration in domains.items():
        spec = FUNCTIONS[name]
        assert declaration == spec[spec[ast_table.ARG_DOMAIN]], (
            f"{name}'s domain does not resolve through its own declaration")
        ceiling = _ceiling_index(name)
        assert tuple(spec["args"])[ceiling] == "int"
        assert len(_int_slots(name)) >= 2, (
            f"{name} declares a domain with nothing to compare against")


def test_a_PLANTED_entry_is_guarded_and_a_REMOVED_declaration_drops_out():
    """⭐ THE DERIVATION HAS A SEAM, for the reason `barReadersOf` has one: a
    derivation nobody can plant a manifest against is indistinguishable from a
    hand-list that happens to be right today.

    Both directions on a COPY of the shipped manifest — the frozen `TABLE` is
    never touched.
    """
    functions = {k: dict(v) for k, v in FUNCTIONS.items()}
    real = ast_table.arg_domains({ast_table.FUNCTIONS_SECTION: functions})
    assert "macd" in real

    # …a seventh entry declaring one is picked up with no code change…
    functions["sma"] = dict(functions["sma"], domain="lookback")
    widened = ast_table.arg_domains({ast_table.FUNCTIONS_SECTION: functions})
    assert widened.get("sma") == FUNCTIONS["sma"]["lookback"]

    # …and an entry that stops declaring one drops out.
    functions["macd"] = {k: v for k, v in functions["macd"].items()
                         if k != ast_table.ARG_DOMAIN}
    narrowed = ast_table.arg_domains({ast_table.FUNCTIONS_SECTION: functions})
    assert "macd" not in narrowed


def test_a_ceiling_that_NAMES_NO_ARGUMENT_is_left_alone_rather_than_guessed_at(monkeypatch):
    """⛔ THE READER REPORTS, THE WALKER RESOLVES — and neither invents a slot.

    `vwap` declares `lookback: "session"`, which names no argument at all. The
    reader hands that declaration back verbatim (it is what the entry says); the
    GUARD then finds no `argN` in it and leaves the call alone. A fabricated
    index would make the guard refuse a slot the entry never declared, which is
    an over-refusal with no red test anywhere.
    """
    functions = {k: dict(v) for k, v in FUNCTIONS.items()}
    functions["vwap"] = dict(functions["vwap"], domain="lookback")
    reported = ast_table.arg_domains({ast_table.FUNCTIONS_SECTION: functions})
    assert reported["vwap"] == "session", "the reader dropped a real declaration"

    monkeypatch.setattr(ast_interpret, "_ARG_DOMAINS", reported)
    # …and the walker asks nothing of it: `vwap()` still resolves.
    assert ast_interpret.max_lookback(CALL("vwap")) == ast_interpret.SESSION_MAX_BARS


def test_every_UNDECLARED_int_argument_has_a_REASON__a_roster_not_a_count():
    """⛔ THE CENSUS THAT MAKES THIS SET HONEST, and it is a roster with a reason
    per entry rather than a number.

    An entry carrying a second `int` period is a candidate for this defect. It is
    accounted for in exactly one of two ways: the entry DECLARES a domain, or the
    manifest declares that period as its `forward` reach. `pivothigh(close, 2, 5)`
    is the live counter-example — 2 bars back, 5 bars ahead, perfectly well
    defined — which is why a rule inferred from "an entry with two periods" would
    have been an over-refusal rather than a fix.

    A new entry with an unaccounted second period lands RED here, by name.
    """
    domains = ast_table.arg_domains()
    unaccounted = []
    accounted_by_forward = []
    excused_by_role = []
    for name, spec in sorted(FUNCTIONS.items()):
        lookback = str(spec.get("lookback"))
        m = ast_interpret._LOOKBACK_RE.fullmatch(lookback)
        if m is None:
            continue
        ceiling = int(m.group(2))
        roles = list(spec.get("argRoles") or ())
        # ⛔⛔ AN ``int`` IS NOT AUTOMATICALLY A PERIOD, AND THE MANIFEST
        # ALREADY SAYS WHICH IS WHICH. X41 is a WINDOW that can reach past the
        # declared one; an ANCHOR is an instant and reaches nowhere by itself.
        # Reading the declared ROLE is what tells them apart, and it is the
        # same declaration ``_functions_arg_roles`` already makes for the
        # translators (*"`period`-suffixed roles mark the `int` slots"*) -- a
        # read, not a second rule.
        # ⚠️ THE EXEMPTION IS NOT OPEN-ENDED: ``test_ast_indicators.py``
        # refuses any ``int`` slot whose role is neither period-suffixed nor
        # one of the declared non-window roles, so a slot excused here has
        # been vouched for there.
        # ⚠️ ``cumFrom(source, anchorEpoch, maxBars)`` is what forced the
        # question: its reach IS its lookback and its anchor is an instant, so
        # before this read it was reported as a live X41 for carrying a second
        # ``int`` -- an over-refusal with the census's own name on it.
        others = []
        for i in _int_slots(name):
            if i == ceiling:
                continue
            role = str(roles[i]) if i < len(roles) else ""
            if role.lower().endswith("period"):
                others.append(i)
            else:
                excused_by_role.append(f"{name} arg {i} ({role or 'no role'})")
        if not others or name in domains:
            continue
        forward = spec.get("forward")
        fm = ast_interpret._LOOKBACK_RE.fullmatch(str(forward)) if forward else None
        if fm is not None and all(i == int(fm.group(2)) for i in others):
            accounted_by_forward.append(name)
            continue
        unaccounted.append(f"{name} args {others}")
    assert unaccounted == [], (
        "these entries carry an int period outside their declared lookback and "
        "neither declare a `domain` nor name it as their `forward` reach — each "
        f"is a live X41: {unaccounted}")
    assert accounted_by_forward, (
        "no entry is excused by its `forward` reach any more — the discriminator "
        "this census rests on is gone, so it now proves nothing")
    assert excused_by_role, (
        "no `int` slot is excused for being a non-window role any more — the "
        "second discriminator this census rests on is gone, so an anchor would "
        "be reported as a live X41 again")


# ═══════════════════════════════════════════════════════════════════════════ #
# 2. THE GUARD AGREES WITH THE MATHS — the discriminating rail
# ═══════════════════════════════════════════════════════════════════════════ #

@pytest.mark.parametrize("name", sorted(ast_table.arg_domains()))
def test_the_guard_refuses_EXACTLY_what_the_SHIPPED_adapter_answers_all_NaN(name):
    """⛔⛔ BOTH DIRECTIONS, AND AGAINST AN INDEPENDENT ORACLE.

    A fixture that only feeds transposed arguments cannot tell a correct guard
    from `return True`. This sweeps a grid over the entry's `int` slots and
    asserts, case by case, that the guard refuses a call **iff** `FN[name]` — the
    shipped maths — really does compute nothing on any bar.

    The counts are asserted non-zero in BOTH classes: a grid where every case
    refuses, or none does, measures nothing.
    """
    ceiling = _ceiling_index(name)
    slots = _int_slots(name)
    values = (3, 5, 9)
    grid = []
    for combo in _product(values, len(slots)):
        periods = dict(zip(slots, combo))
        grid.append((periods, _guard_refuses(name, periods),
                     _adapter_is_all_nan(name, periods)))
    disagreed = [p for p, refused, nan in grid if refused != nan]
    assert disagreed == [], (
        f"{name}: the guard and the shipped adapter disagree on {len(disagreed)} "
        f"argument lists (ceiling is arg{ceiling}): {disagreed[:4]}")
    refused = sum(1 for _, r, _ in grid if r)
    assert 0 < refused < len(grid), (
        f"{name}: the grid produced {refused}/{len(grid)} refusals — a fixture "
        "that cannot produce both answers is not a rail")


def _product(values, width):
    out = [()]
    for _ in range(width):
        out = [row + (v,) for row in out for v in values]
    return out


# ═══════════════════════════════════════════════════════════════════════════ #
# 3. BOTH DIRECTIONS, PER FAMILY — and the SCREEN consequence
# ═══════════════════════════════════════════════════════════════════════════ #

@pytest.mark.parametrize("name", sorted(ast_table.arg_domains()))
def test_the_TRANSPOSED_call_is_refused_BY_NAME_AT_THE_TOKEN(name):
    """The refusal names the offending argument, its ROLE, the ceiling it passed,
    and what to do instead — not "this formula is invalid"."""
    ceiling = _ceiling_index(name)
    over = next(i for i in _int_slots(name) if i != ceiling)
    periods = {i: 1 for i in _int_slots(name)}
    periods[over] = 2
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        ast_interpret.max_lookback(_call_with(name, periods))
    assert exc.value.guard == "resolve:domain"
    message = str(exc.value)
    roles = tuple(FUNCTIONS[name].get("argRoles") or ())
    assert f"{name} argument {over} is its {roles[over]} at 2" in message
    assert f"argument {ceiling}, its {roles[ceiling]}, at 1" in message
    assert f"put the larger one in argument {ceiling}" in message, (
        "the refusal names the defect and not the fix — a member is told their "
        "formula is wrong with no way to make it right")


@pytest.mark.parametrize("name", sorted(ast_table.arg_domains()))
def test_the_WELL_ORDERED_call_still_SAVES_and_still_COMPUTES(name):
    """⛔ THE CONTROL. A guard that refuses everything passes half of what
    matters, and half of what matters here is that the formula a member meant
    still works."""
    ceiling = _ceiling_index(name)
    periods = {i: (3 if i != ceiling else 9) for i in _int_slots(name)}
    tree = _call_with(name, periods)
    assert ast_interpret.max_lookback(tree) >= 9
    column = ast_interpret.interpret(tree, BARS, {})
    assert any(v is not None for v in column), (
        f"{name} computes nothing at well-ordered periods — the fixture, not the "
        "guard, is what this test would then be measuring")
    assert scan_definition.assert_scannable(
        _definition(OP(">", SER("close"), tree)))["yields"] == "bool"


def test_the_SCREEN_CONSEQUENCE_is_gone__before_it_answered_0_at_full_coverage():
    """🔴 THE MEASUREMENT THIS LANE EXISTS FOR.

    BEFORE: `close > macd(close, 26, 12)` was savable and answered **0.0 on all
    60 bars, one distinct value**, with `unresolved_inputs() == []` and
    `unresolved_lookback() == 0` — a definite NO for every symbol at full
    reported coverage.

    AFTER: the tree does not resolve, so there is no column to launder and no
    screen to save. The refusal is the SAME at both doors.
    """
    bad = CALL("macd", SER("close"), NUM(26), NUM(12))
    tree = OP(">", SER("close"), bad)

    with pytest.raises(ast_interpret.TableRefusal) as evaluated:
        ast_interpret.interpret(tree, BARS, {})
    assert evaluated.value.guard == "resolve:domain"

    with pytest.raises(scan_definition.ScanRefused) as saved:
        scan_definition.assert_scannable(_definition(tree))
    assert saved.value.gate == "tree"
    assert "macd argument 1 is its fastPeriod at 26" in str(saved.value)

    # ⛔ AND THE OTHER POLARITY, which is the face that hands a member the whole
    # board: `!(close > macd(close, 26, 12))` answered 1.0 on every bar.
    with pytest.raises(ast_interpret.TableRefusal):
        ast_interpret.interpret(OP("!", tree), BARS, {})


# ═══════════════════════════════════════════════════════════════════════════ #
# 4. ADVERSARIAL INPUTS — a corpus is blind beside what it measures
# ═══════════════════════════════════════════════════════════════════════════ #

def test_EQUAL_periods_are_IN_domain__the_declaration_is_a_bound_not_an_order():
    """`macd(close, 26, 26)` computes a flat zero and is a legitimate, if dull,
    formula. A strict `<` would have refused it — an over-refusal with no red
    test anywhere, which is the shape `lesson_an_over_refusal_is_invisible`
    describes."""
    equal = CALL("macd", SER("close"), NUM(26), NUM(26))
    assert ast_interpret.max_lookback(equal) == 26
    column = ast_interpret.interpret(equal, BARS, {})
    assert {v for v in column if v is not None} == {0.0}
    assert scan_definition.assert_scannable(
        _definition(OP(">", SER("close"), equal)))["yields"] == "bool"


def test_a_NON_LITERAL_period_is_still_resolve_window__the_EARLIER_door_wins():
    """⛔ ATTRIBUTION ORDER. A call whose window cannot be READ has no periods to
    compare, so reporting `resolve:domain` there would measure traversal order
    instead of the defect. Every `int` slot is read in INDEX order first."""
    for tree, slot in (
        (CALL("macd", SER("close"), SER("len"), NUM(12)), 1),
        (CALL("macd", SER("close"), NUM(26), SER("len")), 2),
    ):
        with pytest.raises(ast_interpret.TableRefusal) as exc:
            ast_interpret.max_lookback(tree)
        assert exc.value.guard == "resolve:window"
        assert f"argument {slot} must be a whole number" in str(exc.value)


def test_a_NESTED_occurrence_refuses__the_pass_walks_every_call_not_the_root():
    """`sma(macd(close, 26, 12), 5)` hides the defect one level down, and the
    outer call is perfectly well formed."""
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        ast_interpret.max_lookback(
            CALL("sma", CALL("macd", SER("close"), NUM(26), NUM(12)), NUM(5)))
    assert exc.value.guard == "resolve:domain"
    assert "macd argument 1" in str(exc.value)


def test_an_ICHIMOKU_period_out_of_order_refuses_even_in_the_FORWARD_slot():
    """⚠️ `ichimokuChikou` declares `forward: "arg4"` (the kijun) AND uses that
    period as a backward window, so the domain covers it. Measured: at
    `(9, 60, 52)` the shipped adapter answers all-NaN on 60 bars — the forward
    declaration does not exempt the slot, and a rule inferred from `forward`
    alone would have missed this one entirely."""
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        ast_interpret.max_lookback(CALL(
            "ichimokuChikou", SER("high"), SER("low"), SER("close"),
            NUM(9), NUM(60), NUM(52)))
    assert exc.value.guard == "resolve:domain"
    assert "argument 4 is its kijunPeriod at 60" in str(exc.value)


# ═══════════════════════════════════════════════════════════════════════════ #
# 5. THE CROSS-LANE SENTENCE — byte-identical, read out of the shipped module
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_two_lanes_refuse_with_a_BYTE_IDENTICAL_sentence():
    """⛔ THE MEMBER IS TOLD WHY. Two lanes phrasing one refusal differently give
    the same formula two explanations depending on which walker happened to run
    it — and the escape census recognises refusals BY GUARD, so a lane with
    different words still looks closed.

    ⚠️ A HARD FAILURE, NOT A SKIP, IF NODE IS MISSING: a skipped cross-lane rail
    is how a rail rots.
    """
    import ast_conformance

    cases = []
    for name in sorted(ast_table.arg_domains()):
        ceiling = _ceiling_index(name)
        over = next(i for i in _int_slots(name) if i != ceiling)
        periods = {i: 4 for i in _int_slots(name)}
        periods[over] = 7
        cases.append((name, _call_with(name, periods)))

    driver = (
        "import { register } from 'node:module'\n"
        "import { pathToFileURL } from 'node:url'\n"
        "register('data:text/javascript,"
        "import%20%7B%20readFile%20%7D%20from%20%27node%3Afs/promises%27%3B"
        "export%20async%20function%20load(u%2Cc%2Cn)%7Bif(u.endsWith(%27.json%27))"
        "%7Bconst%20s%3Dawait%20readFile(new%20URL(u)%2C%27utf8%27)%3B"
        "return%7Bformat%3A%27module%27%2CshortCircuit%3Atrue%2C"
        "source%3A%60export%20default%20%24%7Bs%7D%60%7D%7Dreturn%20n(u%2Cc)%7D')\n"
        f"const m = await import(pathToFileURL({json.dumps(ast_conformance.JS_INTERPRET_PATH)}).href)\n"
        f"const trees = {json.dumps([t for _, t in cases])}\n"
        "const out = []\n"
        "for (const t of trees) {\n"
        "  try { m.maxLookback(t); out.push(null) }\n"
        "  catch (e) { out.push({ guard: e.guard, message: e.message }) }\n"
        "}\n"
        "process.stdout.write(JSON.stringify(out))\n"
    )
    proc = subprocess.run(
        [ast_conformance._node(), "--input-type=module", "-e", driver],
        cwd=str(ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace")
    assert proc.returncode == 0, (
        "the JS lane could not be run; this rail is a HARD failure rather than a "
        f"skip. stderr:\n{(proc.stderr or '')[-1500:]}")
    js = json.loads(proc.stdout)
    assert len(js) == len(cases)

    for (name, tree), other in zip(cases, js):
        with pytest.raises(ast_interpret.TableRefusal) as exc:
            ast_interpret.max_lookback(tree)
        assert other is not None, f"{name}: the JS lane admitted a tree this one refuses"
        assert other["guard"] == exc.value.guard == "resolve:domain"
        assert other["message"] == str(exc.value), (
            f"{name}: the lanes phrase one refusal differently\n"
            f"  js: {other['message']!r}\n  py: {str(exc.value)!r}")
