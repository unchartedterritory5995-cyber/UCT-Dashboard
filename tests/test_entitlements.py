"""E-7 — toolkits: breadth is gated where it is PRODUCED, and mechanics never.

🔴 WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE, IN THREE SENTENCES.

  1. A member on a smaller plan is shown a DIFFERENT NUMBER under the same
     indicator's name (§1.4 — "nobody is sold a worse RSI").
  2. A screen that stops at 500 of 3,742 symbols looks like a quiet market
     instead of saying so (§6.3 — with a billing cause).
  3. A cap is COMPUTED AND NEVER APPLIED — the shape of all eight features that
     shipped green and unreachable this week
     (`lesson_built_tested_green_and_unreachable`).

🔴 THE FIRST ONE IS THE HARD ONE, AND THE MEASUREMENT DECIDED THE INSTRUMENT.
`ema(close,20)` on this file's own corpus is `15.269399733598789` over all 400
bars and `15.269384587868412` over the last 120. Two different indicators. The
relative difference is **9.919e-07**, which is INSIDE `pytest.approx`'s default
`rel=1e-6` — so `assert trimmed == pytest.approx(full)` **PASSES**. That is not a
close call, it is a measured false negative, and
`test_the_CORPUS_is_history_SENSITIVE…` asserts it explicitly so the reason the
gate is `repr()` for `repr()` is in the suite rather than in a comment.

⛔ AND A BIT-IDENTITY ASSERTION WITHOUT A POSITIVE CONTROL IS AN ASSERTION THAT TWO
IDENTICAL CALLS ARE IDENTICAL. `test_and_that_gate_CAN_FAIL_…` drives the SAME
assertion helper with the entitlement layer replaced by the plausible-but-rejected
TRIMMING implementation and requires it to go RED. That is what makes the green
one mean something.

────────────────────────────────────────────────────────────────────────────────
⚠️ THREE DELIBERATE DEPARTURES FROM THE BRIEF'S DRAFT TESTS, EACH FOR A REASON
THAT IS ITSELF A CONTRACT.

  * The draft's `small` toolkit carried `max_history_bars=120` and expected the
    SAME column as an uncapped one. Under E-7's ruling (see
    `entitlements`' header and `docs/decisions/2026-08-08-toolkit-gating-axes.md`)
    that call REFUSES rather than returning a trimmed-and-therefore-different
    column, so the bit-identity matrix uses toolkits whose history admits the
    bars, and the too-small cap gets its own refusal test. E-3 flagged that the
    draft's two E-7 tests contradicted each other here; this is the resolution.

  * The draft's positive control used a `_test_round_to` field ON `Limits`. A
    production field whose only purpose is to perturb per-symbol compute is
    ITSELF the §1.4 violation this module forbids, sitting inside the one place
    entitlement numbers live. The control instead swaps in the rejected
    implementation and re-runs the SAME assertion.

  * The definition-results route census lives HERE rather than being appended to
    `tests/test_scan_screener_auth.py`: that file is mid-edit by another agent
    (its `EXPECTED_SCANS_ROUTES` 15→16 bump is uncommitted), and a per-file
    pathspec commit cannot take my hunk without taking theirs.
"""
from __future__ import annotations

import ast as pyast
import copy
import dataclasses
import datetime
import pathlib

import pytest
from fastapi import Depends, FastAPI

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import ast_interpret
from api.services import ast_table
from api.services import entitlements as ent
from api.services import user_definitions as svc
from api.services.screener import scan_evaluator
from api.services.screener import scan_store
from api.services.screener import snapshot_db

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = ROOT / "api"


ROUTERS = API / "routers"

SESSION = 20260807
SESSION_DATE = datetime.date(2026, 8, 7)
TF = scan_evaluator.DEFAULT_TF


# ═══ trees, bars and toolkits ═══════════════════════════════════════════════

def _series(name):
    return {"type": "series", "name": name}


def _num(value):
    return {"type": "num", "value": value}


def _op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def _call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


#: 🔴 THE GATE'S SUBJECT IS DELIBERATELY A **RECURSIVE** INDICATOR.
#: `sma` at the last bar reads exactly its own window and is insensitive to
#: everything before it, so a bit-identity assertion over `sma` would be green
#: under a trimming history cap — vacuously. `ema` seeds from bar zero
#: (`ast_interpret._ema_col`), so it is the shape a history axis can actually
#: damage, and `test_the_CORPUS_is_history_SENSITIVE…` proves that rather than
#: assuming it.
EMA_TREE = _call("ema", _series("close"), _num(20))

#: `close > 0` — reads no declared scalar, so the snapshot gate does not apply and
#: the sweep tests measure ENTITLEMENT rather than freshness.
PRICE_TREE = _op(">", _series("close"), _num(0))

BAR_COUNT = 400


def _bars(n=BAR_COUNT):
    """`n` daily bars whose closes are NOT monotonic — a straight ramp makes an
    EMA converge and hides exactly the seeding difference under test."""
    out = []
    for i in range(n):
        close = 10.0 + (i % 7) * 1.3 + (i % 13) * 0.21
        out.append({"t": 20260101 + i, "o": close, "h": close + 1,
                    "l": close - 1, "c": close, "v": 1_000_000})
    return out


BARS = _bars()

#: ⛔ EVERY TOOLKIT BELOW IS A TEST FIXTURE, NOT A SHIPPED ONE. The shipped table
#: is `ent.TOOLKITS` and it holds exactly one entry; these exist to prove that a
#: DOWNGRADE shrinks the answer, which is the test that makes an entitlement bound
#: an entitlement bound rather than a capacity bound with a new spelling.
SMALL = ent.Limits("small", max_symbols=5, max_history_bars=BAR_COUNT,
                   max_definitions=1, min_refresh_seconds=86_400)
LARGE = ent.Limits("large", None, None, 500, None)
UNGATED = ent.TOOLKITS[ent.DEFAULT_TOOLKIT]

#: Every toolkit whose history bound ADMITS `BARS`. All three must agree bit for
#: bit; that is the whole of §1.4 as a machine check.
ADMITTING = (UNGATED, SMALL, LARGE)


# ═══ 1. §1.4 — GATE BREADTH, NEVER MECHANICS ════════════════════════════════

def _column_under(bars, limits):
    """The per-symbol path a toolkit can touch: the entitlement gate on the bars,
    then the SHIPPED interpreter. ⛔ Nothing in between — if a toolkit could
    change a number, it would have to change it here."""
    return ast_interpret.interpret(EMA_TREE, ent.apply_history_cap(bars, limits))


def _assert_bit_identical(bars, toolkits):
    """The ONE assertion, used by both the gate and its control.

    ⛔ `repr()` FOR `repr()`, NOT `pytest.approx`. See the module docstring: the
    difference a trimmed lookback produces is 1.14e-6 relative, which the default
    tolerance is within a hair of accepting.
    """
    reference = None
    for limits in toolkits:
        column = [repr(x) for x in _column_under(bars, limits)]
        if reference is None:
            reference = (limits.toolkit, column)
            continue
        assert column == reference[1], (
            f"toolkit {limits.toolkit!r} computed a DIFFERENT column from "
            f"{reference[0]!r} on the same bars — somebody was sold a worse "
            "indicator. Spec §1.4: gate breadth, never mechanics.")
    return reference[1]


def test_the_SAME_definition_on_the_SAME_symbol_is_BIT_IDENTICAL_under_every_toolkit():
    """🔴 SPEC §1.4: GATE BREADTH, NEVER MECHANICS. Nobody is sold a worse RSI.

    ⛔ `repr()` FOR `repr()`, NOT `pytest.approx`. A toolkit that quietly halved a
    lookback, downsampled the bars or rounded the output would agree to six
    decimals and be a different indicator.
    """
    column = _assert_bit_identical(BARS, ADMITTING)
    # …and the control on the CONTROL: an all-None column would satisfy the
    # equality above while proving nothing about a real indicator.
    assert any(v is not None for v in _column_under(BARS, UNGATED)), column[:3]


def test_and_that_gate_CAN_FAIL_which_is_the_only_reason_it_means_anything(monkeypatch):
    """⚠️ THE POSITIVE CONTROL. A toolkit layer that DOES perturb the compute must
    be caught by the assertion above — otherwise it is asserting that two
    identical calls are identical.

    ⛔ THE POISON IS THE REJECTED IMPLEMENTATION, NOT A SYNTHETIC ONE. The plausible
    design — the one the brief's own signature (`apply_history_cap(bars, limits)
    -> list`) invites — is to TRIM the bars to `max_history_bars`. That is what is
    substituted here, and the SAME assertion helper the gate uses must go red on
    it. A control that rounded the output in the test would prove only that the
    test can subtract.
    """
    def _trimming_history_cap(bars, limits):
        """THE DESIGN E-7 REFUSED — see the decision record."""
        kept = list(bars)
        if limits is None or limits.max_history_bars is None:
            return kept
        return kept[-limits.max_history_bars:]

    poison = dataclasses.replace(SMALL, toolkit="poison", max_history_bars=120)

    # the mutation is PROVEN APPLIED before any verdict is taken from it
    assert len(_trimming_history_cap(BARS, poison)) == 120 < len(BARS)

    monkeypatch.setattr(ent, "apply_history_cap", _trimming_history_cap)
    with pytest.raises(AssertionError) as exc:
        _assert_bit_identical(BARS, (UNGATED, poison))
    assert "worse indicator" in str(exc.value)


def _names_the_history_cap(node) -> bool:
    """`monkeypatch.setattr` takes the target either as `mod.attr` or as a NAME
    STRING beside the module. Both spellings count; neither is prose, because a
    docstring mentioning the function is a `Constant` nobody passes to `setattr`."""
    if isinstance(node, pyast.Attribute):
        return node.attr == "apply_history_cap"
    return isinstance(node, pyast.Constant) and node.value == "apply_history_cap"


def test_the_POSITIVE_CONTROL_is_COLLECTED_and_not_merely_PRESENT__BY_AST():
    """🔴 M8, AND IT IS THE ONE MUTATION AN EXIT CODE CANNOT SEE.

    Deleting a test — or renaming it out of `test_*` so pytest stops collecting it
    — can only ever make a suite SMALLER and GREENER. The gauntlet measured
    exactly that: the control renamed to `_deleted_control` left the run at exit 0
    with 48 tests instead of 49, i.e. SURVIVED. So the control's existence is
    itself asserted, structurally.

    ⛔ DERIVED FROM THE SHAPE, NOT FROM THE NAME. What makes a function the
    control is that it (a) is COLLECTED — its name starts with `test_`, (b)
    replaces `apply_history_cap` with the rejected implementation, and (c) drives
    the SAME `_assert_bit_identical` helper the gate uses, inside a
    `pytest.raises`. A rail keyed on the typed name would go green again the
    moment someone renamed the control while gutting it.
    """
    tree = pyast.parse(pathlib.Path(__file__).read_text(encoding="utf-8"))
    controls = []
    for fn in pyast.walk(tree):
        if not isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
            continue
        if not fn.name.startswith("test_"):
            continue                          # pytest does not collect it
        # ⛔ NODES, NOT `ast.dump` TEXT. The first spelling of this rail matched
        # its OWN docstring and the string literals in this very function, so it
        # certified itself and M8 SURVIVED. A guard that can be satisfied by
        # prose about the guard is the `lesson_test_that_passes_vacuously` shape.
        swaps = any(
            isinstance(n, pyast.Call) and _dotted(n.func).endswith(".setattr")
            and any(_names_the_history_cap(a) for a in n.args)
            for n in pyast.walk(fn))
        drives = any(isinstance(n, pyast.Call) and isinstance(n.func, pyast.Name)
                     and n.func.id == "_assert_bit_identical"
                     for n in pyast.walk(fn))
        expects_red = any(
            isinstance(n, pyast.With) and any(
                isinstance(item.context_expr, pyast.Call)
                and _dotted(item.context_expr.func).endswith("raises")
                for item in n.items)
            for n in pyast.walk(fn))
        if swaps and drives and expects_red:
            controls.append(fn.name)
    assert controls, (
        "no COLLECTED test replaces `apply_history_cap` with the rejected "
        "implementation and requires `_assert_bit_identical` to go red. Without "
        "it the §1.4 gate is an assertion that two identical calls are identical.")


def test_the_CORPUS_is_history_SENSITIVE_so_the_bit_identity_gate_is_not_VACUOUS():
    """⛔ A GATE OVER AN INSENSITIVE SUBJECT IS GREEN FOR THE WRONG REASON.

    `sma(close,50)` at the last bar reads exactly fifty bars and is identical
    however much history precedes it, so a bit-identity assertion over an SMA
    would pass under a trimming cap. This measures that the tree under test is the
    other kind, and it is the measurement quoted in the decision record.
    """
    full = ast_interpret.interpret(EMA_TREE, BARS)
    short = ast_interpret.interpret(EMA_TREE, BARS[-120:])
    assert repr(full[-1]) != repr(short[-1]), (
        "the EMA corpus stopped being history-sensitive — the §1.4 gate above is "
        "now vacuous and must be re-pointed at a recursive indicator")

    # 🔴 AND THIS IS THE WHOLE REASON THE GATE IS `repr()` FOR `repr()`, ASSERTED
    # RATHER THAN CLAIMED: `pytest.approx` at its DEFAULT tolerance ACCEPTS these
    # two as equal. An approximate comparison would have shipped the defect.
    assert short[-1] == pytest.approx(full[-1]), (
        "the corpus drifted far enough that pytest.approx now catches the trim. "
        "That is not a fix — it means this demonstration no longer demonstrates "
        "anything, and the gate's justification has to be re-measured.")
    assert abs(full[-1] - short[-1]) / abs(full[-1]) < 1e-6

    # the other half — an insensitive tree, so "different" is not just noise
    sma = _call("sma", _series("close"), _num(50))
    assert (repr(ast_interpret.interpret(sma, BARS)[-1])
            == repr(ast_interpret.interpret(sma, BARS[-120:])[-1]))


# ═══ 2. the HISTORY axis — identity or refusal, never shorter ═══════════════

def test_a_history_cap_that_does_not_fit_REFUSES_rather_than_TRIMMING():
    """🔴 E-7's ADJUDICATION, AS A TEST. `docs/decisions/2026-08-08-toolkit-gating-axes.md` §4.

    Breadth is how much you may ASK about; mechanics is the number that comes back
    for the question you were allowed to ask. A trim does not narrow the question
    — it answers the same one worse — so the axis is enforced as a refusal.
    """
    tight = dataclasses.replace(SMALL, max_history_bars=120)
    with pytest.raises(ent.ToolkitWithheld) as exc:
        ent.apply_history_cap(BARS, tight)
    assert exc.value.reason == ent.HISTORY_WITHHELD
    assert "NOT trimmed" in exc.value.detail
    # ⛔ AND IT IS `withheld`, NOT `dropped` AND NOT `not_computable`.
    assert exc.value.reason.startswith("toolkit:")


def test_a_SMALLER_history_cap_may_REFUSE_but_it_may_NEVER_ANSWER_DIFFERENTLY():
    """🔴 M1, CAUGHT BY §1.4 ITSELF RATHER THAN BY A PROPERTY RAIL.

    The bit-identity matrix above only drives toolkits the shipped
    `apply_history_cap` ADMITS, so a trimming implementation would slip past it —
    it never raises, so the matrix simply never gets to compare. This is the
    either/or that closes that: a toolkit whose cap is SMALLER than the history
    the definition reads has exactly two honest outcomes, and "a different number
    under the same name" is not one of them.
    """
    tight = dataclasses.replace(SMALL, max_history_bars=120)
    try:
        column = _column_under(BARS, tight)
    except ent.ToolkitWithheld:
        return                                   # the ruling: "your plan stops here"
    assert ([repr(x) for x in column]
            == [repr(x) for x in _column_under(BARS, UNGATED)]), (
        "a toolkit with a SMALLER history cap answered, and answered DIFFERENTLY. "
        "That is a trim: the member was sold a worse indicator under the same "
        "name, and `pytest.approx` would not have noticed. Spec §1.4.")


@pytest.mark.parametrize("cap,n", [(None, 400), (400, 400), (10_000, 400),
                                   (None, 0), (5, 5), (5, 4)])
def test_apply_history_cap_NEVER_returns_a_SHORTER_column_than_it_was_given(cap, n):
    """⛔ THE PROPERTY, OVER THE WHOLE ADMITTING RANGE. Two outcomes exist and
    neither of them is a shorter list: the identity, or a raise. A future edit
    that "just clamps it" fails here rather than in a member's chart."""
    bars = _bars(n)
    limits = dataclasses.replace(SMALL, max_history_bars=cap)
    out = ent.apply_history_cap(bars, limits)
    assert len(out) == len(bars)
    assert [b["c"] for b in out] == [b["c"] for b in bars]


def test_NOTHING_under_api_SLICES_A_SERIES_BY_A_TOOLKIT_NUMBER__BY_AST():
    """⛔ THE STRUCTURAL HALF OF THE RULING, BECAUSE THE BEHAVIOURAL HALF ONLY SEES
    `apply_history_cap`.

    The dangerous edit is not inside that function — it is somewhere else doing
    `bars[-limits.max_history_bars:]` and never calling it. AST over every module
    under `api/`: no subscript may be indexed by an attribute named
    `max_history_bars`, anywhere.
    """
    offenders = _slices_by_history_cap(_api_sources())
    assert not offenders, (
        "these sites slice a series by a toolkit's history number, which is the "
        "TRIM the ruling forbids:\n  " + "\n  ".join(offenders))

    # the control: the walk CAN see one, so an empty list is a real result rather
    # than a scan that matches nothing.
    planted = _slices_by_history_cap(
        {"planted.py": "def f(bars, limits):\n"
                       "    return bars[-limits.max_history_bars:]\n"})
    assert planted == ["planted.py:2"], planted


def _slices_by_history_cap(sources) -> list:
    out = []
    for name, source in sources.items():
        try:
            tree = pyast.parse(source)
        except SyntaxError:                                  # pragma: no cover
            continue
        for node in pyast.walk(tree):
            if not isinstance(node, pyast.Subscript):
                continue
            for inner in pyast.walk(node.slice):
                if (isinstance(inner, pyast.Attribute)
                        and inner.attr == "max_history_bars"):
                    out.append(f"{name}:{node.lineno}")
    return sorted(set(out))


def _api_sources() -> dict:
    out = {}
    for path in sorted(API.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        try:
            out[path.relative_to(ROOT).as_posix()] = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:                           # pragma: no cover
            continue
    return out


# ═══ 3. the SYMBOL axis — applied in the SWEEP, reported as WITHHELD ════════

@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, PROVED to be the one in use."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    return path


@pytest.fixture
def bars(monkeypatch):
    """A stub bars store keyed by ticker. Missing ticker == no bars."""
    from api.services import bars_sqlite

    table: dict = {}

    def _get(ticker, tf, max_bars):
        rows = table.get(str(ticker).upper())
        return list(rows or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)
    return table


def _store_bars(n=60, end=SESSION_DATE):
    out = []
    for i in range(n):
        d = end - datetime.timedelta(days=n - 1 - i)
        key = d.year * 10_000 + d.month * 100 + d.day
        close = 10.0 + i
        out.append((key, close, close + 1, close - 1, close, 1_000_000))
    return out


def _definition(tree, *, rev=None, def_id="u_000000000001"):
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": "A Screen", "shortName": "SCR",
                 "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": tree,
                    "fn": svc.ast_hash(tree),
                    **({"rev": rev} if rev is not None else {})},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


UNIVERSE = [f"SYM{i:03d}" for i in range(20)]


def _sweep(bars_table, limits):
    for sym in UNIVERSE:
        bars_table[sym] = _store_bars()
    return scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                       universe=UNIVERSE, as_of=SESSION,
                                       limits=limits)


def test_a_SYMBOL_CAP_is_applied_in_the_SWEEP_and_reported_as_WITHHELD_not_DROPPED(
        store, bars):
    """🔴 §6.3, AND THIS IS THE POINT AT WHICH ENTITLEMENT MEETS IT.

    *"A screen that silently drops 800 symbols returns fewer hits and looks like a
    quiet market — and a trader would act on it."* A toolkit cap does exactly that
    unless it is reported, and it must NOT be reported as `dropped` OR as
    `not_computable`: dropped means "we tried and failed, here they are, re-run
    them"; not-computable means "we ran and the maths had nothing to say";
    withheld means "your plan stops here". Folding any two of those makes a capped
    screen read as a broken one and a broken one read as a capped one.
    """
    out = _sweep(bars, SMALL)

    assert out["evaluated"] == 5
    assert out["withheld"] == len(UNIVERSE) - 5
    assert out["withheld_reason"] == ent.SYMBOLS_WITHHELD == "toolkit:symbols"
    assert out["dropped"] == 0 and out["not_computable"] == 0
    assert out["dropped_symbols"] == []
    # ⛔ AND THE CLOSED IDENTITY STILL CLOSES OVER WHAT WAS EVALUATED, not over
    # the universe — `withheld` is outside the identity by construction.
    assert out["evaluated"] == out["answered"] + out["dropped"] + out["not_computable"]
    # …and the universe closes too, which is the arithmetic that catches M9.
    assert out["evaluated"] + out["withheld"] == len(UNIVERSE)


def test_the_cap_is_applied_at_PRODUCTION_not_at_DISPLAY(store, bars):
    """⛔ E7-A1. A UI that hides rows is not entitlement: the rows were computed,
    they cost the pod the GIL for those seconds, and a client can ask for them.
    Asserted on the PAYLOAD, never on the DOM.

    ⭐ `evaluated` IS THE DISCRIMINATOR, and it is the only one that can tell the
    two designs apart. A display-layer cap leaves `evaluated == 20` and simply
    renders five rows; a production cap never looks at the other fifteen, so
    `evaluated == 5` and the pod did one quarter of the work.

    ⚠️ THE ROUTE-LEVEL HALF IS E-4's AND IT HAS NOT LANDED. The draft asserted this
    against a scan-result route derived from `router.routes`; no such route is
    mounted yet (`test_EVERY_definition_results_route_…` asserts that count and
    will fail the day one arrives ungated). The envelope asserted here IS the
    payload that route will serve.
    """
    capped = _sweep(bars, SMALL)
    uncapped = _sweep(bars, LARGE)

    assert capped["evaluated"] == 5, (
        "the sweep looked at every symbol and something downstream is hiding "
        "them — that is a UI, not an entitlement")
    assert uncapped["evaluated"] == len(UNIVERSE)
    assert capped["withheld"] > 0 and uncapped["withheld"] == 0
    assert uncapped["withheld_reason"] is None


def test_a_DOWNGRADE_actually_SHRINKS_the_answer(store, bars):
    """⛔ GROUND TRUTH §4.3: every limit in the repo today is a CAPACITY bound,
    not an ENTITLEMENT bound, and *"entitlement bounds are a billing contract and
    need a test that a downgrade actually shrinks the answer."*

    A cap that is computed and never applied is the shape of every one of the
    eight features that shipped green and unreachable this week.
    """
    big = _sweep(bars, LARGE)
    small = _sweep(bars, SMALL)
    assert small["evaluated"] < big["evaluated"]
    assert len(small["hits"]) <= len(big["hits"])
    # …and it shrank because of the PLAN, not because the sweep failed.
    assert small["dropped"] == big["dropped"] == 0


def test_the_SHIPPED_toolkit_changes_NOTHING__proved_by_an_EQUALITY(store, bars):
    """⛔ E-7 LANDS DARK ON BREADTH WHILE LIVE ON MECHANISM.

    A full sweep under `TOOLKITS['all']` must return the SAME envelope as one with
    no limits at all. Anything else means the mechanism shipped with a number in
    it, and every member's screen changed the day it merged.
    """
    with_toolkit = _sweep(bars, UNGATED)
    with_nothing = _sweep(bars, None)
    for key in ("evaluated", "answered", "dropped", "not_computable",
                "withheld", "withheld_reason", "hits"):
        assert with_toolkit[key] == with_nothing[key], key
    assert with_toolkit["evaluated"] == len(UNIVERSE)


def test_the_SWEEPs_slice_and_apply_symbol_cap_AGREE(store):
    """⛔ TWO IMPLEMENTATIONS OF ONE BILLING CONTRACT IS THE DEFECT THIS REPO
    REPEATS MOST.

    `scan_evaluator._apply_limits` shipped in E-3, before this module existed, and
    reads `limits.max_symbols` by duck type because importing `entitlements` from
    the sweep was not yet possible. `apply_symbol_cap` is the DEFINITION. They must
    answer identically or "which symbols does your plan let you see" has two
    authorities — so both are driven over a matrix here rather than trusted.
    """
    syms = [f"S{i}" for i in range(10)]
    for cap in (None, 0, 1, 5, 9, 10, 11, 500):
        limits = dataclasses.replace(SMALL, max_symbols=cap)
        kept, withheld = ent.apply_symbol_cap(syms, limits)
        swept, n_withheld, reason = scan_evaluator._apply_limits(syms, limits)
        assert kept == swept, cap
        assert len(withheld) == n_withheld, cap
        assert reason == (ent.SYMBOLS_WITHHELD if withheld else None), cap
        # every symbol is in exactly one bucket, and the order is the caller's
        assert kept + withheld == syms, cap

    # …and `None` limits is the ungated path on both sides.
    assert ent.apply_symbol_cap(syms, None) == (syms, [])
    assert scan_evaluator._apply_limits(syms, None) == (syms, 0, None)


def test_the_WITHHELD_VOCABULARY_is_PINNED_to_the_SWEEPs_not_RESTATED():
    """⛔ E-3 OWNS THE WORD; THIS MODULE MUST NOT INVENT A SECOND SPELLING.

    Importing `scan_evaluator` from `entitlements` is not available: a ROUTER
    imports `entitlements`, and `test_scan_evaluator_off_request_path` forbids the
    sweep appearing in a router's namespace at all. So the two are pinned EQUAL
    here instead — the same idiom `user_definitions.FIRST_REV` uses against
    `alert_rev_migration.DEFAULT_REV`, and for the same reason: importing would
    make a divergence invisible.
    """
    assert scan_evaluator.WITHHELD_REASONS[0] == ent.SYMBOLS_WITHHELD

    # ✅ THE PIN CAME OFF, AND IT CAME OFF BY FAILING FIRST. This read
    # `assert ent.HISTORY_WITHHELD not in scan_evaluator.WITHHELD_REASONS` with a
    # message telling whoever tripped it to close §4 of the decision record. The
    # history refusal is now wired in `scan_evaluator._history_withheld`, the rail
    # went RED by name on the commit that landed it, and §4 is closed — so the
    # `<=` becomes an `==`. ⛔ AN EQUALITY, NOT A SUBSET: the two sides now declare
    # the same closed set, and a reason added on one side alone is the divergence
    # this pin exists to catch. That is E-5's idiom with `9c4f1f74`'s scalars pin,
    # and it is why the pin was written as a failing assertion rather than a TODO.
    assert set(scan_evaluator.WITHHELD_REASONS) == set(ent.WITHHELD_REASONS)
    assert ent.HISTORY_WITHHELD in scan_evaluator.WITHHELD_REASONS

    # ⛔ AND THE SWEEP'S OWN TRUNCATION WORD IS NOT ONE OF THEM. "We ran out of
    # night" is not "your plan stops here": one is fixed by starting earlier, the
    # other by upgrading, and a member cannot act on the difference if they share
    # a bucket.
    assert scan_evaluator.UNSWEPT_REASON not in ent.WITHHELD_REASONS


# ═══ 4. the DEFINITION-COUNT axis — a live downgrade, on a real write path ══

@pytest.fixture
def defs(tmp_path, monkeypatch):
    """The definition store, and the alert DB the rev-migration reads.

    ⛔ `AUTH_DB_PATH` ALONE IS NOT ENOUGH — six product modules capture it at
    IMPORT, so the attribute is what has to move. Copied from
    `tests/test_user_definitions.py::store`, which learned this the hard way.
    """
    from api.services import alert_rev_migration as rev
    from api.services import indicator_alert_service as ias

    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _stored(i):
    tree = _op(">", _series("close"), _num(float(i)))
    return _definition(tree, def_id=f"u_{i:012d}")


def test_a_DOWNGRADE_actually_SHRINKS_the_DEFINITION_COUNT_too(defs):
    """⛔ THE SECOND DOWNGRADE, ON THE ONE AXIS THAT IS FULLY WIRED TODAY.

    `POST /api/user-definitions` → `save()` → `check_definition_count`. Under the
    shipped toolkit this is byte-for-byte today's behaviour; under a one-definition
    plan the SECOND create is refused. That difference is what makes
    `max_definitions` an entitlement bound rather than `MAX_DEFINITIONS_PER_USER`
    with a longer name.
    """
    tight = ent.Limits("tight", None, None, 1, None)

    first = svc.save("u1", "u_000000000001", _stored(1), limits=tight)
    assert first["appended"] is True

    with pytest.raises(ent.ToolkitLimitExceeded) as exc:
        svc.save("u1", "u_000000000002", _stored(2), limits=tight)
    assert "definition count exceeds 1" in str(exc.value)
    assert "'tight'" in str(exc.value)

    # ⭐ AND THE UPGRADE UNDOES IT — a refusal that is unconditional is a bug, not
    # a plan.
    second = svc.save("u1", "u_000000000002", _stored(2), limits=LARGE)
    assert second["appended"] is True
    assert len(svc.list_for_user("u1")) == 2


def test_the_DEFAULT_toolkit_leaves_the_definition_cap_EXACTLY_where_it_was(defs):
    """⛔ NOTHING CHANGES FOR ANYBODY. `limits=None` and the shipped toolkit must
    both refuse at exactly `MAX_DEFINITIONS_PER_USER`, and the store's own sentence
    must survive: `tests/test_user_definitions.py` matches on it."""
    assert ent.TOOLKITS["all"].max_definitions == svc.MAX_DEFINITIONS_PER_USER

    ent.check_definition_count(svc.MAX_DEFINITIONS_PER_USER - 1, None)
    with pytest.raises(ValueError, match="definition count exceeds"):
        ent.check_definition_count(svc.MAX_DEFINITIONS_PER_USER, None)
    with pytest.raises(ValueError, match="definition count exceeds"):
        ent.check_definition_count(svc.MAX_DEFINITIONS_PER_USER,
                                   ent.TOOLKITS["all"])
    # ⛔ AND IT IS A `ValueError`, so `_save_or_400` still turns it into a 400
    # rather than letting a plan refusal escape as a 500 that reads as an outage.
    assert issubclass(ent.ToolkitLimitExceeded, ValueError)


def test_the_count_cap_is_reached_from_the_STORE__BY_AST():
    """⛔ A CAP THAT IS COMPUTED AND NEVER CALLED IS THE EIGHT-FEATURE SHAPE.

    `save()` must CALL `check_definition_count`; the behavioural test above cannot
    tell "the cap ran" from "the store happened to refuse for its own reasons",
    because until this commit it had its own reason.
    """
    tree = pyast.parse(pathlib.Path(svc.__file__).read_text(encoding="utf-8"))
    save = next(n for n in pyast.walk(tree)
                if isinstance(n, pyast.FunctionDef) and n.name == "save")
    called = {_dotted(n.func) for n in pyast.walk(save) if isinstance(n, pyast.Call)}
    assert "entitlements.check_definition_count" in called, sorted(called)

    # …and the old local comparison is GONE, not merely bypassed.
    literals = [n for n in pyast.walk(save)
                if isinstance(n, pyast.Compare)
                and isinstance(n.left, pyast.Call)
                and _dotted(n.left.func) == "_live_def_count"]
    assert not literals, (
        "save() still compares the live count itself — two authorities over one "
        "billing contract")


# ═══ 5. WHETHER vs HOW MUCH — the two gates never collapse ══════════════════

def test_limits_for_decides_HOW_MUCH_and_NEVER_WHETHER():
    """⛔ M7. One 402 meaning two things is how "which surface refused me" stops
    being answerable — the exact property `4e2563bd`'s distinct per-router
    sentences exist to preserve.

    So `limits_for` answers the SAME thing for a free member, a paid member, an
    admin and nobody at all. Whether they get through the door is `require_paid`'s
    sentence, spoken somewhere else.
    """
    everyone = [None, {}, {"id": "x"},
                {"id": "f", "role": "member", "plan": "free"},
                {"id": "p", "role": "member", "plan": "pro"},
                {"id": "a", "role": "admin", "plan": "free"}]
    answers = {ent.limits_for(u) for u in everyone}
    assert answers == {ent.TOOLKITS[ent.DEFAULT_TOOLKIT]}


def test_entitlements_NEVER_speaks_a_refusal_SENTENCE__BY_AST():
    """⛔ THE STRUCTURAL HALF OF M7. A `limits_for` that grew an `HTTPException`
    would be `require_paid` wearing a different name, and the behavioural test
    above would still pass for every user it was handed."""
    source = pathlib.Path(ent.__file__).read_text(encoding="utf-8")
    tree = pyast.parse(source)
    names = {n.id for n in pyast.walk(tree) if isinstance(n, pyast.Name)}
    names |= {n.attr for n in pyast.walk(tree) if isinstance(n, pyast.Attribute)}
    assert "HTTPException" not in names, (
        "entitlements raises an HTTP refusal — it decides HOW MUCH, never WHETHER")
    assert "is_paid_user" not in names, (
        "entitlements consults the paid gate — the two decisions collapsed")


def test_the_WRITE_routes_carry_BOTH_gates_and_the_router_declares_NEITHER():
    """⛔ BESIDE `require_paid`, NEVER INSTEAD OF IT — read off `router.routes` by
    OBJECT IDENTITY, never off the source text.

    ⚠️ AND `router.dependencies == []` IS LOAD-BEARING, for the same reason
    `tests/test_user_definitions_auth.py` says so: a hoisted router-level gate
    would make every per-handler assertion pass for a route that declares none.
    """
    from api.routers import user_definitions as ud

    by_path = {}
    for route in ud.router.routes:
        if not getattr(route, "methods", None):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            by_path[(method, route.path)] = [
                d.call for d in route.dependant.dependencies]

    writes = [k for k in by_path if k[0] in ("POST", "PUT")
              and not k[1].endswith("/propose")]
    assert sorted(writes) == [("POST", "/api/user-definitions"),
                              ("PUT", "/api/user-definitions/{def_id}")], writes

    for key in writes:
        assert ud.require_paid in by_path[key], key
        assert ent.limits_dependency in by_path[key], (
            f"{key} appends a definition without reading the caller's toolkit — "
            "the count cap is computed against a plan nobody looked up")
    assert ud.router.dependencies == []


# ═══ 6. the DEFINITION-RESULTS route census ═════════════════════════════════
#
# ⛔ EXTENDED, NOT RE-LITIGATED. `4e2563bd` derived the (method, path) set from
# `router.routes` for BOTH routers, asserted the COUNTS THROUGH NAMED CONSTANTS,
# cross-checked them against an AST walk of the router SOURCE, and read each
# route's CLASS off `route.dependant.dependencies` BY OBJECT IDENTITY. That work
# stands and is not touched here.
#
# What is added is ONE CLASS: a route that serves DEFINITION RESULTS must also
# carry the entitlement, and the count of those is asserted too — so a further
# route lands covered rather than riding in.
#
# ⛔ THE INTEGER LIVES IN THIS FILE'S CONSTANT. It is ZERO today because E-4 has
# not registered a scan-result surface yet, and a zero with a proven-sighted
# classifier beside it is a real rail: the day the first one mounts, this goes red
# and the author has to add `Depends(limits_dependency)` to make it green.

#: ⛔ ASSERTED, NOT INFORMATIONAL. See above.
#:
#: ⭐ 2026-08-09 — 0 → 1, AND THE RAIL FIRED WHILE IT WAS BEING WRITTEN. This
#: constant was 0 and green when E-7 started; E-4 registered
#: `GET /api/scans/definition-results` mid-task and the census went RED naming it,
#: on a route that carried `require_paid` and no toolkit at all. That is M5 caught
#: in the wild rather than in a fixture. The deliberate edit is this bump PLUS
#: `Depends(limits_dependency)` on that handler — the number alone would have been
#: a way to make a red test quiet.
#:
#: ⭐ 2026-08-25 — 1 → 2, AND THE RAIL FIRED AGAIN, THE SAME WAY. W5a mounted
#: `GET /api/scans/definition-record` (`api/routers/definition_record.py`, which
#: reads `definition_record.claim_for`/`latest_evaluation`) and this census went
#: RED naming BOTH paths. The deliberate edit is this bump PLUS
#: `Depends(limits_dependency)` on that handler, APPLIED to the claim's named
#: `unproven` symbols — the number alone would have been a way to quiet a red.
#: ⚠️ MEASURED, NOT PREDICTED: W4a's `POST /api/scans/run` was already merged
#: when this bump was made and is NOT classified — `api/routers/scan_run.py`
#: imports only `api.services.screener.scan_run`, so it clears the cheap
#: name prefilter (it mentions the stores in prose) and the AST correctly
#: rejects it. The lane brief predicted "3 after both lanes merge"; the census
#: says 2. If a future task moves a store read INTO that router, this constant
#: moves with it — read the failure's path list, never a forecast.
#: ⭐ 2026-08-26 — 2 → 4, AND THE COUNT IS THE SMALLEST PART OF THE EDIT. W4a's
#: `POST /api/scans/run` and `GET /api/scans/run/{job}` were passing this census
#: VACUOUSLY: the cheap prefilter cleared the router (the word `scan_evaluator`
#: appears three times in its own PROSE), so the router really was imported and
#: AST-walked — and then `_serves_definition_results` resolved its one
#: `api.services.screener.*` alias against `RESULT_STORES`, matched no key, and
#: answered False for BOTH handlers. The census yielded two paths and neither was
#: the route that computes and hands back hits. Bumping a number would have made
#: that WORSE: a census that counts correctly today and still cannot see the
#: route is the same defect wearing a bigger number. So the fix is the
#: `scan_run` entry below, and the assertion that MATTERS is
#: `test_the_census_SEES_every_route_that_hands_back_definition_RESULTS`, which
#: names the paths.
#: ⭐ 2026-08-26 — 4 → 6, AND BOTH NEW ROUTES ARE THE *THIRD* SHAPE. W4b.5 mounts
#: `api/routers/scan_live.py`: `GET /api/scans/live-status` (the intraday
#: sweeper's LIVENESS BEAT — the last cycle receipt and how stale it is) and
#: `GET /api/scans/demand` (the demand ring + member watchlist symbols, for the
#: WORKER's prewarm ring, under the PUSH_SECRET bearer). Both BIND `scan_store`,
#: so the blunt recogniser is right to see them — and NEITHER hands back a
#: definition's hits.
#: ⛔ AND `Depends(limits_dependency)` WOULD HAVE BEEN THE WRONG ANSWER, not
#: merely a redundant one. `/api/scans/demand` is credentialed by a shared secret
#: and has NO member session at all; `limits_dependency` resolves through
#: `get_current_user_with_plan`, so bolting it on would have broken the worker's
#: only door while reading as protection — the exact "declared there and never
#: used" shape `READBACK_DOORS` below was written to refuse. So the doors are
#: NAMED instead (`NON_RESULT_DOORS`), which turns "could not tell" into a real
#: answer and keeps the strict half strict.
EXPECTED_DEFINITION_RESULT_ROUTES = 6

#: The modules that OWN definition results. ⚠️ Each is checked to EXIST and to
#: expose its read door below, so a rename empties the census LOUDLY instead of
#: quietly — the `_fetch_naaim` failure one lane over
#: (a guard whose list stopped matching the thing it guarded, and passed).
RESULT_STORES = {
    # ⚠️ `live_beat` and `demand_recent` are listed so `_doors_reached` can NAME
    # them, NOT because they serve results — see `NON_RESULT_DOORS`. An
    # unlistable door resolves to the empty set, which this census reads as
    # "could not tell" and holds to the STRICT rule; naming them is what makes
    # the classification an answer instead of a shrug.
    "api.services.screener.scan_store": ("hits", "coverage", "join_clause",
                                         "live_beat", "demand_recent"),
    "api.services.screener.scan_evaluator": ("evaluate_one", "run_sweep"),
    "api.services.definition_record": ("latest_evaluation",),
    # ⭐ W4a's on-demand run. It does not READ a stored result — it COMPUTES one
    # (through `scan_evaluator.evaluate_one` on a single-worker pool) and hands it
    # back, which is the same thing to a member and the same thing to a toolkit.
    # Two doors, and the difference between them is load-bearing: see
    # `READBACK_DOORS`.
    "api.services.screener.scan_run": ("submit_run", "job_status"),
}

#: ⛔ THE DOORS THAT ONLY HAND BACK AN ANSWER SOMEBODY ELSE ALREADY PRODUCED.
#:
#: The rule this file enforces is that a definition-result surface is
#: entitlement-checked. For every producing door that means `Depends(
#: limits_dependency)` ON THE ROUTE — that is where the caller's plan is read and
#: handed to the evaluation. For a read-back door it does NOT: `scan_run`'s poll
#: returns the hits of a job that was queued under the SUBMIT's toolkit, so
#: re-reading the plan when the answer is handed back would be a second authority
#: over one number, and a dependency declared there and never used would read as
#: protection while protecting nothing.
#:
#: ⛔ SO A READ-BACK ROUTE IS NOT EXEMPT, IT IS PAIRED: the census still has to
#: SEE it, and `test_EVERY_definition_results_route_is_covered_by_the_DERIVED_
#: census` asserts that a covered PRODUCING route exists in the same module.
#: An unpaired read-back is a hit list handed out under no plan at all.
READBACK_DOORS = {"api.services.screener.scan_run.job_status"}

#: ⛔ THE DOORS THAT LIVE ON A RESULT STORE AND HAND BACK NO RESULT.
#:
#: `scan_store` owns the definition-result tables AND the live sweep's operational
#: artifacts. `live_beat` answers "is the intraday sweeper alive, and how stale is
#: its last cycle" — a receipt about the JOB, carrying no symbol and no
#: definition's hits. `demand_recent` answers "which symbols did somebody just
#: NAME", which is an input to the worker's prewarm order, not an output of any
#: scan. A toolkit sells whole-market scan RESULTS; neither of these is one.
#:
#: ⛔ SO THIS IS AN EXEMPTION FOR A DOOR, NEVER FOR A ROUTE. A handler reaching one
#: of these AND a producing door is still strict — the arm below requires the
#: resolved set to be ENTIRELY non-result, exactly like the read-back arm — and a
#: handler this walk cannot resolve at all still counts as producing. Controlled
#: by `test_a_NON_RESULT_door_is_no_DOORWAY_for_a_producing_one`.
#:
#: ⚠️ AND HERE IS EXACTLY HOW FAR THAT GUARANTEE REACHES, because the first
#: version of this comment overstated it and a review measured the gap
#: (W4b.5 fix round 1, finding 1). `_doors_reached` resolves the handler's body
#: AND every function DEFINED IN THE SAME MODULE that it calls, transitively —
#: so the one-line-helper escape ("name the exempt door in the handler, reach
#: `hits` from a helper") is closed, in both the attribute and the
#: `from … import hits as h` spellings.
#:
#: ⛔ WHAT IS STILL OUT OF REACH, STATED RATHER THAN IMPLIED: a producing door
#: reached through a function in ANOTHER module. That is not a hole this
#: exemption opens — it is the reach `_serves_definition_results` has too, and it
#: is the SAME reach, which is what keeps the two consistent: a handler that
#: binds no result-store module is never RECOGNISED as a definition-result
#: surface at all, so it never reaches these arms to be excused by them. The
#: lenient arms can only be entered by a handler that binds a store directly, and
#: that population is now resolved completely. A cross-module walk would be a
#: real widening of the census; it is not this fix, and nothing shipped needs it.
NON_RESULT_DOORS = {
    "api.services.screener.scan_store.live_beat",
    "api.services.screener.scan_store.demand_recent",
}


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


def _resolve_from(node: pyast.ImportFrom, pkg: str) -> str:
    if not node.level:
        return node.module or ""
    parts = pkg.split(".")
    base = parts[: len(parts) - (node.level - 1)] if node.level > 1 else parts
    return ".".join([p for p in base if p] + ([node.module] if node.module else []))


def _alias_map(nodes, pkg: str) -> dict:
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


def _serves_definition_results(source: str, func_name: str, pkg: str) -> bool:
    """Does this handler read the definition-RESULT store?

    ⛔ AST, NEVER GREP. `lesson_probe_names_must_be_derived_not_typed`: a grep on
    this branch reported five call sites and all five were prose. Both import
    shapes count — the module-level one AND the function-local one this repo uses
    constantly — and a NAMESAKE alias (`from api.services import engine as
    scan_store`) must NOT trip it.
    """
    try:
        tree = pyast.parse(source)
    except SyntaxError:                                      # pragma: no cover
        return False
    inside = set()
    handler = None
    for fn in pyast.walk(tree):
        if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
            if fn.name == func_name and handler is None:
                handler = fn
            for n in pyast.walk(fn):
                inside.add(id(n))
    if handler is None:
        return False
    top = [n for n in pyast.walk(tree)
           if isinstance(n, (pyast.Import, pyast.ImportFrom)) and id(n) not in inside]
    aliases = _alias_map(top, pkg)
    aliases.update(_alias_map(
        [n for n in pyast.walk(handler)
         if isinstance(n, (pyast.Import, pyast.ImportFrom))], pkg))

    used = {n.id for n in pyast.walk(handler) if isinstance(n, pyast.Name)}
    used |= {_dotted(n).split(".")[0] for n in pyast.walk(handler)
             if isinstance(n, pyast.Attribute)}
    for local, target in aliases.items():
        if local not in used:
            continue
        for module in RESULT_STORES:
            if target == module or target.startswith(module + "."):
                return True
    return False


def _doors_reached(source: str, func_name: str, pkg: str) -> set:
    """The NAMED result-store doors this handler reaches, dotted.

    ⚠️ RECOGNITION AND CLASSIFICATION ARE SEPARATE QUESTIONS AND ARE ANSWERED
    SEPARATELY. `_serves_definition_results` decides whether a route is a
    definition-result surface at all, and it is deliberately BLUNT: binding a
    store module counts, because from there any door is one attribute away. This
    answers the narrower "which doors", and it is used for ONE thing — telling a
    producing route from a read-back one.

    ⛔ AN EMPTY ANSWER MEANS "COULD NOT TELL", AND THE COVERAGE RULE READS THAT AS
    PRODUCING. A handler this cannot resolve is therefore held to the STRICT rule,
    so a future shape this walk does not understand fails loudly rather than
    slipping into the lenient half.
    """
    try:
        tree = pyast.parse(source)
    except SyntaxError:                                      # pragma: no cover
        return set()
    inside, handler = set(), None
    for fn in pyast.walk(tree):
        if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
            if fn.name == func_name and handler is None:
                handler = fn
            for n in pyast.walk(fn):
                inside.add(id(n))
    if handler is None:
        return set()

    # ⛔ THE HANDLER *AND EVERY MODULE-LEVEL FUNCTION IT REACHES* — fix round 1,
    # W4b.5 finding 1. This walked the handler body ALONE until 2026-08-26, and
    # that made the lenient arms below a DOORWAY rather than a door exemption: a
    # handler naming one exempt door while reaching a PRODUCING one through a
    # one-line helper resolved to the exempt door only, landed in the lenient
    # arm, and was excused from `limits_dependency` while handing back a
    # definition's symbols. `test_the_NON_RESULT_arm_is_not_reachable_THROUGH_A_
    # HELPER` is that exact shape, and the walk below is what closes it.
    #
    # ⚠️ SCOPED TO THIS MODULE, DELIBERATELY, and the limit is stated rather than
    # implied: a door reached through a function in ANOTHER module is still
    # invisible here. That is the same reach `_serves_definition_results` has, so
    # a route whose handler binds no store at all is not recognised as a
    # definition-result surface in the first place — the lenient arm can only be
    # entered by a handler that DOES bind one, which is the population this walk
    # now covers completely.
    bodies = _reached_functions(tree, handler)

    top = [n for n in pyast.walk(tree)
           if isinstance(n, (pyast.Import, pyast.ImportFrom)) and id(n) not in inside]
    aliases = _alias_map(top, pkg)
    for fn in bodies:
        aliases.update(_alias_map(
            [n for n in pyast.walk(fn)
             if isinstance(n, (pyast.Import, pyast.ImportFrom))], pkg))

    nodes = [n for fn in bodies for n in pyast.walk(fn)]
    out = set()
    for local, target in aliases.items():
        # a door imported BY NAME (`from ...scan_run import job_status`)
        if "." in target:
            head, attr = target.rsplit(".", 1)
            if attr in RESULT_STORES.get(head, ()) and any(
                    isinstance(n, pyast.Name) and n.id == local for n in nodes):
                out.add(target)
        # a door reached THROUGH the module object (`scan_run.job_status(...)`)
        for node in nodes:
            if (isinstance(node, pyast.Attribute)
                    and isinstance(node.value, pyast.Name)
                    and node.value.id == local
                    and node.attr in RESULT_STORES.get(target, ())):
                out.add(f"{target}.{node.attr}")
    return out


def _reached_functions(tree, start) -> list:
    """``start`` plus every function DEFINED IN THIS MODULE that it calls,
    transitively — the handler's real reach inside its own file.

    ⛔ BY NAME OFF THE MODULE'S OWN DEFS, so a call to something imported, built
    in, or defined elsewhere adds nothing: a walk that followed every call would
    resolve every route to every door, make all three arms collapse into
    "producing", and read as maximum strictness while actually having stopped
    measuring. `test_the_helper_walk_does_not_INVENT_a_door_from_an_unrelated_
    call` is the control on precisely that.

    Recursion is bounded by the `seen` set, so a helper pair that calls each
    other terminates.
    """
    by_name = {n.name: n for n in pyast.walk(tree)
               if isinstance(n, (pyast.FunctionDef, pyast.AsyncFunctionDef))}
    order, seen, stack = [start], {getattr(start, "name", None)}, [start]
    while stack:
        fn = stack.pop()
        for node in pyast.walk(fn):
            if not (isinstance(node, pyast.Call) and isinstance(node.func, pyast.Name)):
                continue
            name = node.func.id
            if name in by_name and name not in seen:
                seen.add(name)
                order.append(by_name[name])
                stack.append(by_name[name])
    return order


def _mounted_router_modules() -> set:
    """Every `api.routers.X` whose `.router` reaches `include_router` in `main.py`.

    ⛔ BY AST OVER `api/main.py`, AND `api.main` IS DELIBERATELY NOT IMPORTED.
    Importing it builds caches under the shared production data root and
    `conftest`'s write guard fails the session for it — a pre-existing,
    order-dependent trap that `tests/test_scan_evaluator_off_request_path.py`
    already falls into when run alone. Reading the source answers the same
    question ("is this router mounted?") without paying that.

    ⛔ AND AN AST, NEVER A GREP: a grep for a module name reports the import line,
    the comment above it and any prose that mentions it.
    """
    src = (API / "main.py").read_text(encoding="utf-8")
    tree = pyast.parse(src)
    alias = {}
    for node in pyast.walk(tree):
        if isinstance(node, pyast.ImportFrom) and (node.module or "").startswith("api.routers"):
            for a in node.names:
                alias[a.asname or a.name] = f"{node.module}.{a.name}"
        elif isinstance(node, pyast.Import):
            for a in node.names:
                if a.name.startswith("api.routers."):
                    alias[a.asname or a.name] = a.name
    out = set()
    for node in pyast.walk(tree):
        if not (isinstance(node, pyast.Call)
                and isinstance(node.func, pyast.Attribute)
                and node.func.attr == "include_router" and node.args):
            continue
        arg = node.args[0]
        if (isinstance(arg, pyast.Attribute) and arg.attr == "router"
                and isinstance(arg.value, pyast.Name)):
            out.add(alias.get(arg.value.id, arg.value.id))
    return out


def _result_routes_in(source: str, router) -> list:
    """``(route, doors)`` for one router — the census's per-router step, EXTRACTED.

    ⭐ EXTRACTED SO A CONTROL CAN DRIVE THE REAL DECISION. Everything that decides
    whether a route is covered lives here: the cheap prefilter, the AST detector
    and the door resolution. `test_the_census_would_CATCH_a_planted_UNGATED_route`
    feeds this a router built in the test and its own source, so the control
    exercises the shipped code path rather than a re-implementation of it — which
    is what a census this file already got wrong once is owed.
    """
    if not any(m.rsplit(".", 1)[-1] in source for m in RESULT_STORES):
        return []                          # cheap prefilter; the AST decides below
    out = []
    for route in getattr(router, "routes", []):
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None or not getattr(route, "methods", None):
            continue
        name = getattr(endpoint, "__name__", "")
        if name and _serves_definition_results(source, name, "api.routers"):
            out.append((route, _doors_reached(source, name, "api.routers")))
    return out


def _definition_result_routes() -> list:
    """Every MOUNTED route whose handler reads the definition-result store, as
    ``(route, doors)``.

    ⛔ DERIVED, NEVER TYPED — twice over. The router modules come off the
    directory; "is it mounted" comes off an AST walk of `main.py`; and the routes
    come off `module.router.routes`, which is the table FastAPI dispatches on.

    ⭐ ONLY THE ROUTERS WHOSE SOURCE REACHES A RESULT STORE ARE IMPORTED. Importing
    every router to ask a question about two of them is a lot of side effects for
    nothing; the AST prefilter is what makes the census cheap AND keeps it total —
    a router the prefilter clears cannot have a handler that reads the store.
    """
    mounted = _mounted_router_modules()
    assert len(mounted) > 20, (
        f"the include_router walk found {len(mounted)} routers — main.py mounts "
        "far more than that, so this census is looking at nothing")

    out = []
    for path in sorted(ROUTERS.glob("*.py")):
        if path.name == "__init__.py":
            continue
        module_name = f"api.routers.{path.stem}"
        if module_name not in mounted:
            continue
        source = path.read_text(encoding="utf-8")
        if not any(m.rsplit(".", 1)[-1] in source for m in RESULT_STORES):
            continue                       # cheap prefilter, repeated here so an
        import importlib                   # unmatched router is never IMPORTED
        module = importlib.import_module(module_name)
        out.extend(_result_routes_in(source, module.router))
    return out


def _dependency_calls(route) -> list:
    return [d.call for d in route.dependant.dependencies]


def test_the_census_SEES_every_route_that_hands_back_definition_RESULTS():
    """⭐ THE RECOGNITION HALF, WHICH THE COUNT ALONE DOES NOT SAY.

    ⛔ THE COUNT MOVING IS NOT THE ASSERTION. This census passed W4a's
    `POST /api/scans/run` for the wrong reason and the wrong reason mattered:
    the cheap prefilter cleared the router (the word `scan_evaluator` is in its
    own PROSE, three times), so it WAS imported and AST-walked — and then
    `_serves_definition_results` resolved its one `api.services.screener.*` alias
    against `RESULT_STORES`, matched no key, and answered False for BOTH handlers.
    A census yielding `['/api/scans/definition-results']` while a route that
    computes and hands back hits sat beside it is not covering that route; it
    cannot SEE it. So the paths are asserted, not just how many there are.

    ⛔ AND THE DOORS ARE NAMED, so this cannot be satisfied by a route that
    merely mentions the module: `submit_run` and `job_status` are the two
    functions of the run service a request may reach, and the census resolves
    which of them each handler actually names.
    """
    paths = {r.path for r, _ in _definition_result_routes()}
    assert "/api/scans/run" in paths, (
        "the on-demand run route is not in the definition-results census: "
        f"{sorted(paths)}")
    assert "/api/scans/run/{job}" in paths, (
        "the poll that hands back the hits is not in the census: "
        f"{sorted(paths)}")


def test_EVERY_definition_results_route_is_covered_by_the_DERIVED_census():
    """A route that serves DEFINITION RESULTS must carry the entitlement, and the
    count of those is asserted too — so a further route lands covered rather than
    riding in. ⛔ THE INTEGER LIVES IN THIS FILE'S CONSTANT.

    ⭐ TWO RULES SINCE 2026-08-26, BECAUSE THERE ARE NOW TWO SHAPES. A route that
    reaches a PRODUCING door reads the caller's plan itself. A route that reaches
    only a `READBACK_DOORS` entry hands back an answer already produced under that
    plan, and is required to be PAIRED with a covered producing route in the same
    module — never simply skipped. ⛔ AND "COULD NOT TELL WHICH DOOR" IS TREATED AS
    PRODUCING (`_doors_reached` returning empty), so the lenient half is reachable
    only by a resolution that actually succeeded.
    """
    routes = _definition_result_routes()
    assert len(routes) == EXPECTED_DEFINITION_RESULT_ROUTES, (
        "the set of routes serving definition results changed: "
        + str(sorted(r.path for r, _ in routes))
        + ". Update EXPECTED_DEFINITION_RESULT_ROUTES DELIBERATELY, and give the "
          "new route `Depends(limits_dependency)` — a whole-market scan result is "
          "the thing a toolkit sells.")

    # ⭐ THREE ARMS, AND EVERY ROUTE LANDS IN EXACTLY ONE. `lenient` is the union
    # of the two non-strict door sets; a route is only spared if EVERY door it
    # reaches is in it, so one producing door anywhere pulls the whole route back
    # under the strict rule.
    lenient = READBACK_DOORS | NON_RESULT_DOORS
    producing = [(r, d) for r, d in routes if not d or (d - lenient)]
    readback = [(r, d) for r, d in routes
                if d and not (d - lenient) and (d & READBACK_DOORS)]
    non_result = [(r, d) for r, d in routes if d and not (d - NON_RESULT_DOORS)]
    assert producing, (
        "every definition-result route resolved to a read-back door — the strict "
        "half of this rule is exercising nothing")
    assert non_result, (
        "no route resolved to a NON-RESULT door — `NON_RESULT_DOORS` is naming "
        "doors nothing reaches, which is an exemption that can only rot")
    assert len(producing) + len(readback) + len(non_result) == len(routes), (
        "a route landed in two arms or none: "
        f"{sorted(r.path for r, _ in routes)}")

    for route, _ in producing:
        assert ent.limits_dependency in _dependency_calls(route), route.path

    covered = {door.rsplit(".", 1)[0] for route, doors in producing
               if ent.limits_dependency in _dependency_calls(route)
               for door in doors}
    for route, doors in readback:
        modules = {d.rsplit(".", 1)[0] for d in doors}
        assert modules <= covered, (
            f"{route.path} hands back definition results from {sorted(modules)} "
            "and no route that PRODUCES them under the caller's toolkit is "
            "covered — the hits were computed under no plan at all")


def test_the_census_would_CATCH_a_planted_UNGATED_definition_result_route():
    """⭐ THE CONTROL, AND IT DRIVES THE SHIPPED DECISION, NOT A COPY OF IT.

    ⛔ A CENSUS THAT COUNTS CORRECTLY TODAY IS NOT A CENSUS. This one yielded a
    plausible number for weeks while structurally unable to SEE `POST
    /api/scans/run`; nothing went red, because the only thing being asserted was
    a count that happened to match. So a route is PLANTED here — a real
    `APIRouter` with real dependencies, and the source text the walk reads —
    and pushed through `_result_routes_in`, which is the same function the census
    itself calls per router. Three claims:

      1. the planted UNGATED route is RECOGNISED (prefilter → AST → door), and
      2. the coverage rule REPORTS it, and
      3. the same route WITH `Depends(limits_dependency)` is recognised and
         reported clean — so #2 is the gate answering, not the walk failing.
    """
    from fastapi import APIRouter

    source = (
        "from fastapi import APIRouter, Depends\n"
        "from api.services.screener import scan_run\n"
        "router = APIRouter()\n"
        "@router.get('/api/planted/ungated')\n"
        "def planted_ungated(user=Depends(get_current_user_with_plan)):\n"
        "    return scan_run.submit_run(user['id'], 'd1')\n"
        "@router.get('/api/planted/gated')\n"
        "def planted_gated(limits=Depends(limits_dependency)):\n"
        "    return scan_run.submit_run('u', 'd1')\n")

    planted = APIRouter()

    @planted.get("/api/planted/ungated")
    def planted_ungated(user=Depends(get_current_user_with_plan)):  # pragma: no cover
        return {}

    @planted.get("/api/planted/gated")
    def planted_gated(limits=Depends(ent.limits_dependency)):       # pragma: no cover
        return {}

    found = dict(
        (r.path, doors) for r, doors in _result_routes_in(source, planted))
    assert set(found) == {"/api/planted/ungated", "/api/planted/gated"}, (
        f"the census did not RECOGNISE a planted definition-result route: {found}")
    assert all(d == {"api.services.screener.scan_run.submit_run"}
               for d in found.values()), found

    uncovered = sorted(r.path for r, doors in _result_routes_in(source, planted)
                       if (not doors or (doors - READBACK_DOORS))
                       and ent.limits_dependency not in _dependency_calls(r))
    assert uncovered == ["/api/planted/ungated"], (
        "the coverage rule did not report the planted ungated route (or reported "
        f"the gated one too): {uncovered}")


def test_a_NON_RESULT_door_is_no_DOORWAY_for_a_producing_one():
    """⛔ THE CONTROL ON THE LENIENT ARM, AND IT IS THE WHOLE REASON THE ARM IS
    SAFE. `NON_RESULT_DOORS` exempts a DOOR, not a route: a handler that reads
    `scan_store.live_beat` and `scan_store.hits` in the same breath is handing back
    a definition's symbols and must still carry the entitlement. Driven through
    `_result_routes_in` — the same function the census calls — so this cannot pass
    against a copy of the decision.
    """
    from fastapi import APIRouter

    source = (
        "from fastapi import APIRouter, Depends\n"
        "from api.services.screener import scan_store\n"
        "router = APIRouter()\n"
        "@router.get('/api/planted/beat')\n"
        "def planted_beat():\n"
        "    return scan_store.live_beat('D')\n"
        "@router.get('/api/planted/beat-and-hits')\n"
        "def planted_beat_and_hits():\n"
        "    return {'b': scan_store.live_beat('D'), 'h': scan_store.hits('d', 'D', 1)}\n")

    planted = APIRouter()

    @planted.get("/api/planted/beat")
    def planted_beat():                                             # pragma: no cover
        return {}

    @planted.get("/api/planted/beat-and-hits")
    def planted_beat_and_hits():                                    # pragma: no cover
        return {}

    found = dict((r.path, doors) for r, doors in _result_routes_in(source, planted))
    assert found["/api/planted/beat"] == {
        "api.services.screener.scan_store.live_beat"}, found
    assert found["/api/planted/beat-and-hits"] == {
        "api.services.screener.scan_store.live_beat",
        "api.services.screener.scan_store.hits"}, found

    lenient = READBACK_DOORS | NON_RESULT_DOORS
    # the beat-only route is spared…
    assert not (found["/api/planted/beat"] - lenient)
    # …and the one that ALSO hands back hits is NOT, though it carries the very
    # same exempt door.
    assert found["/api/planted/beat-and-hits"] - lenient == {
        "api.services.screener.scan_store.hits"}


def test_the_NON_RESULT_arm_is_not_reachable_THROUGH_A_HELPER():
    """🔴 FIX ROUND 1, FINDING 1 — THE HOLE MY OWN ⛔ CLAIM DENIED EXISTED.

    W4b.5 shipped `NON_RESULT_DOORS` with the note "exempts a DOOR, never a
    ROUTE", and that was FALSE AS A GUARANTEE: `_doors_reached` walked the
    HANDLER BODY ONLY, so a handler naming `scan_store.live_beat` while reaching
    `scan_store.hits` through a module-level helper resolved to `{live_beat}`,
    landed in the lenient arm, and was exempt from `limits_dependency` while
    handing back a definition's symbols. The conclusion held — no shipped route
    abuses it — but the reasoning did not, and the exemption W4b.5 added put two
    more doors in a position to play that part.

    ⛔ THE INDIRECTION IS CLOSED, NOT MERELY DOCUMENTED. `_doors_reached` now
    follows calls to module-level functions transitively, so a door a helper
    opens is the handler's door. This drives the exact shape the review measured,
    including the `from … import hits as h` spelling.
    """
    from fastapi import APIRouter

    source = "\n".join([
        "from fastapi import APIRouter",
        "from api.services.screener import scan_store",
        "router = APIRouter()",
        "def _page(d):",
        "    return scan_store.hits(d, 'D', 20260101)",
        "@router.get('/api/planted/via-helper')",
        "def planted_via_helper():",
        "    return {'beat': scan_store.live_beat('D'), 'rows': _page('d1')}",
        "",
    ])

    planted = APIRouter()

    @planted.get("/api/planted/via-helper")
    def planted_via_helper():                                   # pragma: no cover
        return {}

    found = dict((r.path, doors) for r, doors in _result_routes_in(source, planted))
    doors = found["/api/planted/via-helper"]
    assert "api.services.screener.scan_store.hits" in doors, (
        "the producing door reached through a module-level helper was invisible: "
        f"{doors} — the lenient arm is a doorway after all")
    assert doors - (READBACK_DOORS | NON_RESULT_DOORS) == {
        "api.services.screener.scan_store.hits"}, doors


def test_the_helper_walk_sees_the_IMPORTED_NAME_spelling_too():
    """The other spelling of the same escape: the helper imports the door BY NAME
    (`from …scan_store import hits as h`) instead of reaching it through the
    module object. `_doors_reached` resolves both, and a walk that handled only
    the attribute form would leave this one open."""
    from fastapi import APIRouter

    source = "\n".join([
        "from fastapi import APIRouter",
        "from api.services.screener import scan_store",
        "from api.services.screener.scan_store import hits as h",
        "router = APIRouter()",
        "def _page(d):",
        "    return h(d, 'D', 20260101)",
        "@router.get('/api/planted/via-import')",
        "def planted_via_import():",
        "    return {'beat': scan_store.live_beat('D'), 'rows': _page('d1')}",
        "",
    ])

    planted = APIRouter()

    @planted.get("/api/planted/via-import")
    def planted_via_import():                                   # pragma: no cover
        return {}

    found = dict((r.path, doors) for r, doors in _result_routes_in(source, planted))
    assert "api.services.screener.scan_store.hits" in found["/api/planted/via-import"], (
        found)


def test_the_helper_walk_does_not_INVENT_a_door_from_an_unrelated_call():
    """The control on the control. A handler calling a module-level helper that
    touches NO result store must still resolve to its own doors only — a
    transitive walk that returned everything would make every route producing and
    the lenient arms unreachable, which reads as "safe" and is really "blind"."""
    from fastapi import APIRouter

    source = "\n".join([
        "from fastapi import APIRouter",
        "from api.services.screener import scan_store",
        "router = APIRouter()",
        "def _fmt(x):",
        "    return str(x).upper()",
        "@router.get('/api/planted/beat-only')",
        "def planted_beat_only():",
        "    return _fmt(scan_store.live_beat('D'))",
        "",
    ])

    planted = APIRouter()

    @planted.get("/api/planted/beat-only")
    def planted_beat_only():                                    # pragma: no cover
        return {}

    found = dict((r.path, doors) for r, doors in _result_routes_in(source, planted))
    assert found["/api/planted/beat-only"] == {
        "api.services.screener.scan_store.live_beat"}, found
    assert not (found["/api/planted/beat-only"] - NON_RESULT_DOORS)


def test_the_census_prefilter_does_not_DROP_a_router_before_the_AST_sees_it():
    """⚠️ THE OTHER HALF OF THE PLANT. `_result_routes_in` opens with a raw
    substring test, and a router it drops is never parsed, never imported and
    never counted — a whole class of route that would be invisible without ever
    failing anything. It is checked against the routers that really carry these
    surfaces, and shown to still DROP one that carries none.
    """
    for name in ("scan_run", "scan_results", "definition_record"):
        source = (ROUTERS / f"{name}.py").read_text(encoding="utf-8")
        assert any(m.rsplit(".", 1)[-1] in source for m in RESULT_STORES), name
    assert not _result_routes_in("router = None\nSTORE = 'nothing here'\n", None)


# ─── and the SAME route, driven ───────────────────────────────────────────────

RESULT_DEF_HASH = "sha256:" + "e" * 64
RESULT_HITS = [f"HIT{i:02d}" for i in range(9)]


def _scan_result_route_path() -> str:
    """⛔ FROM `router.routes`, NEVER TYPED. E-4 chose the scan surface (E4-A5) and
    registered it; reading it off the table means a surface that MOVED is a red
    here instead of a 404 nobody notices."""
    from api.routers import scan_results

    paths = sorted({r.path for r in scan_results.router.routes
                    if getattr(r, "methods", None)})
    assert len(paths) == 1, paths
    return paths[0]


@pytest.fixture
def results_store(tmp_path, monkeypatch):
    """A screener db carrying ONE swept definition, filed the way the sweep files
    it. ⛔ Every expectation below is measured off this build, never restated."""
    import contextlib as _ctx

    from api.services import ast_freshness

    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path)
    scan_store.init_db()
    with _ctx.closing(snapshot_db.connect()) as conn:
        for t in RESULT_HITS:
            conn.execute("INSERT INTO screener_rows (ticker) VALUES (?)", (t,))
        conn.commit()
    scan_store.record_hits(RESULT_DEF_HASH, TF, SESSION, RESULT_HITS)
    scan_store.record_coverage(
        RESULT_DEF_HASH, TF, SESSION,
        evaluated=len(RESULT_HITS), answered=len(RESULT_HITS),
        dropped=0, not_computable=0, dropped_symbols=[],
        freshness=ast_freshness.freshness_for(PRICE_TREE)["mode"])
    return path


def test_the_ROUTE_reaches_limits_dependency_WITHOUT_an_override(results_store):
    """⛔ THE OVERRIDE IN THE TWO TESTS BELOW IS THE INJECTED-DEPENDENCY TRAP,
    NAMED AND CLOSED HERE.

    `lesson_injected_dependency_hides_the_fetch`: 996 green tests shipped a
    feature that ran in 0 of 24 charts because every test handed in a fake. Those
    tests override `limits_dependency` to install a SMALL toolkit, which is the
    only way to observe a downgrade while exactly one toolkit ships — so this one
    drives the REAL dependency, unfaked, and requires the real answer.
    """
    from fastapi.testclient import TestClient

    from api.routers import scan_results

    app = FastAPI()
    app.include_router(scan_results.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {
        "id": "paid1", "role": "member", "plan": "pro"}
    body = TestClient(app).get(
        _scan_result_route_path(),
        params={"def_hash": RESULT_DEF_HASH, "tf": TF,
                "as_of": str(SESSION)}).json()

    # the shipped toolkit is ungated, so a real caller gets everything and the
    # payload says nothing was withheld — E-7 lands DARK on breadth.
    assert len(body["tickers"]) == len(RESULT_HITS)
    assert body["coverage"].get("withheld") in (None, 0)


def test_the_cap_is_applied_at_PRODUCTION_not_at_DISPLAY__ON_THE_ROUTE(
        results_store, monkeypatch):
    """⛔ E7-A1, ON THE PAYLOAD AND NEVER ON THE DOM.

    ⭐ AND THE SLICE IS AT THE READ DOOR ON PURPOSE — see
    `api/routers/scan_results.py`'s header. The sweep is member-independent
    (deduped by `def_hash`, no member column in `scan_hits`), so there IS no
    member at sweep time and a shared receipt must describe the whole universe.
    What E7-A1 forbids is a UI that RECEIVES every row and hides some; here the
    browser is handed the shorter list and told so, and no client can ask for the
    rest.

    ⚠️ THE PATH IS DERIVED off `router.routes` rather than typed, so a surface
    that moved is a red here instead of a 404 nobody notices.
    """
    from fastapi.testclient import TestClient

    from api.routers import scan_results

    path = _scan_result_route_path()
    cap = 4

    def _client(limits):
        app = FastAPI()
        app.include_router(scan_results.router)
        app.dependency_overrides[get_current_user_with_plan] = lambda: {
            "id": "paid1", "role": "member", "plan": "pro"}
        app.dependency_overrides[ent.limits_dependency] = lambda: limits
        return TestClient(app)

    query = {"def_hash": RESULT_DEF_HASH, "tf": TF, "as_of": str(SESSION)}
    small = dataclasses.replace(SMALL, max_symbols=cap)

    capped = _client(small).get(path, params=query).json()
    ungated = _client(UNGATED).get(path, params=query).json()

    assert len(ungated["tickers"]) == len(RESULT_HITS) > cap
    assert ungated["coverage"].get("withheld") in (None, 0)

    assert len(capped["tickers"]) == cap
    assert capped["coverage"]["withheld"] == len(RESULT_HITS) - cap
    assert capped["coverage"]["withheld_reason"] == ent.SYMBOLS_WITHHELD

    # ⛔ AND THE FOUR COUNTS ARE UNTOUCHED — `evaluated` describes what the SWEEP
    # looked at, for everybody. A read-time cap that moved it would claim the pod
    # did less work than it did, and the closed identity would stop closing.
    for key in ("evaluated", "answered", "dropped", "not_computable"):
        assert capped["coverage"][key] == ungated["coverage"][key], key
    cov = capped["coverage"]
    assert cov["evaluated"] == cov["answered"] + cov["dropped"] + cov["not_computable"]

    # ⛔ AND `truncated` KEEPS ITS OWN MEANING. "the page is short of the hits" is
    # not "your plan stops here", and a cap that set it would tell a member to
    # page for rows they can never have.
    assert capped["truncated"] is False


def test_a_DOWNGRADE_actually_SHRINKS_the_ANSWER_a_MEMBER_RECEIVES(results_store):
    """🔴 M6 — the wire-cut on the server half. `limits_for` computed and never
    passed is invisible to every structural test; only a downgrade that changes
    the BYTES a member receives can see it."""
    from fastapi.testclient import TestClient

    from api.routers import scan_results

    def _rows(limits):
        app = FastAPI()
        app.include_router(scan_results.router)
        app.dependency_overrides[get_current_user_with_plan] = lambda: {
            "id": "p", "role": "member", "plan": "pro"}
        app.dependency_overrides[ent.limits_dependency] = lambda: limits
        body = TestClient(app).get(
            _scan_result_route_path(),
            params={"def_hash": RESULT_DEF_HASH, "tf": TF,
                    "as_of": str(SESSION)}).json()
        return body["tickers"]

    big = _rows(LARGE)
    small = _rows(dataclasses.replace(SMALL, max_symbols=2))
    assert len(small) < len(big)
    assert small == big[:2], "the slice is not the caller's own order"


@pytest.mark.parametrize("source,expected", [
    # a direct module-level import, USED in the handler
    ("from api.services.screener import scan_store\n"
     "def handler():\n"
     "    return scan_store.hits('h', 'D', 1)\n", True),
    # the LAZY import inside the handler, which a module-level scan would miss
    ("def handler():\n"
     "    from api.services.screener.scan_store import coverage\n"
     "    return coverage('h', 'D', 1)\n", True),
    # the evaluator itself
    ("from api.services.screener import scan_evaluator\n"
     "def handler():\n"
     "    return scan_evaluator.evaluate_one({}, 'D')\n", True),
    # ⛔ a NAMESAKE alias must NOT trip it — a census that fires on the WORD is a
    # grep wearing an AST's clothes
    ("from api.services import engine as scan_store\n"
     "def handler():\n"
     "    return scan_store.get_movers()\n", False),
    # prose must not trip it either
    ("# scan_store.hits is the read door\n"
     "def handler():\n"
     "    return 'scan_store.hits'\n", False),
    # an import that the HANDLER never uses belongs to some other handler
    ("from api.services.screener import scan_store\n"
     "def other():\n"
     "    return scan_store.hits('h', 'D', 1)\n"
     "def handler():\n"
     "    return 1\n", False),
])
def test_the_census_SEES_a_planted_results_route_and_IGNORES_the_namesake(
        source, expected):
    """⚠️ THE POSITIVE CONTROL. A census whose count is ZERO is indistinguishable
    from a census that cannot see anything — unless it is shown a planted one."""
    assert _serves_definition_results(source, "handler", "api.routers") is expected


def test_the_census_would_FLAG_a_results_route_that_OMITS_the_entitlement():
    """🔴 M5, AS A CONTROL. The count above is zero, so the `for` loop that checks
    the dependency iterates zero times. This drives the same check against a
    synthetic app carrying one covered route and one uncovered one, and requires
    exactly the uncovered one to be reported.
    """
    app = FastAPI()

    @app.get("/covered")
    def covered(limits=Depends(ent.limits_dependency)):      # pragma: no cover
        return {}

    @app.get("/uncovered")
    def uncovered(user=Depends(get_current_user_with_plan)):  # pragma: no cover
        return {}

    routes = [r for r in app.routes if getattr(r, "methods", None)
              and r.path in ("/covered", "/uncovered")]
    assert len(routes) == 2
    missing = [r.path for r in routes
               if ent.limits_dependency not in _dependency_calls(r)]
    assert missing == ["/uncovered"]


def test_every_RESULT_STORE_the_census_names_EXISTS_and_exposes_its_read_door():
    """⛔ DERIVE A GUARD'S SUBJECTS FROM SOMETHING THAT CAN GO MISSING LOUDLY.

    The census keys on module names. A rename would empty it silently and the
    zero above would keep passing — the shape of the `_fetch_naaim` guard that
    passed VACUOUSLY once its subject moved. So each named module is imported and
    each named read door resolved.
    """
    import importlib

    for module_name, doors in RESULT_STORES.items():
        module = importlib.import_module(module_name)
        for door in doors:
            assert callable(getattr(module, door, None)), f"{module_name}.{door}"


# ═══ 7. the NUMBERS live in exactly ONE place ═══════════════════════════════

AXES = ("max_symbols", "max_history_bars", "max_definitions",
        "min_refresh_seconds")


def _axis_literals(sources) -> list:
    """Every site binding an axis NAME to an integer LITERAL, by file and line."""
    out = []
    for name, source in sources.items():
        try:
            tree = pyast.parse(source)
        except SyntaxError:                                  # pragma: no cover
            continue
        for node in pyast.walk(tree):
            targets = []
            if isinstance(node, pyast.Assign):
                targets = [(t, node.value) for t in node.targets]
            elif isinstance(node, pyast.AnnAssign) and node.value is not None:
                targets = [(node.target, node.value)]
            elif isinstance(node, pyast.keyword) and node.arg:
                targets = [(node, node.value)]
            for target, value in targets:
                label = getattr(target, "arg", None) or getattr(target, "id", None) \
                    or getattr(target, "attr", None)
                if label not in AXES:
                    continue
                if isinstance(value, pyast.Constant) and isinstance(value.value, int) \
                        and not isinstance(value.value, bool):
                    out.append(f"{name}:{node.lineno}")
    return sorted(set(out))


def test_the_NUMBERS_live_in_exactly_ONE_place():
    """A constant restated is a constant that rots.

    AST over the whole `api/` tree: no integer literal may be bound to one of the
    four axis names OUTSIDE `entitlements.TOOLKITS` — with the control that a
    synthetic module carrying one IS reported by file and line.

    🔴 M4. "A cap number moved into the sweep module" is the mutation, and two
    authorities over a BILLING contract is what makes it worse than the usual
    duplication: ops tunes one, finance owns the other, and nobody is told.
    """
    sources = {k: v for k, v in _api_sources().items()
               if not k.endswith("api/services/entitlements.py")}
    offenders = _axis_literals(sources)
    assert not offenders, (
        "a toolkit cap number appears outside entitlements.TOOLKITS:\n  "
        + "\n  ".join(offenders))

    # ⚠️ THE CONTROL, because an empty list is otherwise indistinguishable from a
    # scan that matches nothing.
    planted = _axis_literals({"planted.py": "MAX = 1\nmax_symbols = 500\n"})
    assert planted == ["planted.py:2"], planted
    planted_kw = _axis_literals(
        {"kw.py": "x = Limits('t', max_symbols=500, max_definitions=3)\n"})
    assert planted_kw == ["kw.py:1"], planted_kw


def test_the_SHIPPED_toolkit_REFERENCES_its_capacity_bound_rather_than_RESTATING_it():
    """⛔ TURNING A CAPACITY BOUND INTO AN ENTITLEMENT BOUND IS A CATEGORY CHANGE.

    `max_definitions` must be an ATTRIBUTE REFERENCE in the source, not `50`. They
    are the same number today on purpose; the reference is what makes the day they
    separate a deliberate edit instead of a silent divergence, and it is why the
    AST rail above can exempt this file without exempting a literal in it.
    """
    tree = pyast.parse(pathlib.Path(ent.__file__).read_text(encoding="utf-8"))
    constructions = [n for n in pyast.walk(tree)
                     if isinstance(n, pyast.Call) and _dotted(n.func) == "Limits"]
    assert constructions, "TOOLKITS no longer constructs any Limits"
    for call in constructions:
        for kw in call.keywords:
            if kw.arg not in AXES:
                continue
            assert not isinstance(kw.value, pyast.Constant) or kw.value.value is None, (
                f"{kw.arg} is a literal in the shipped table — every number must "
                "be a reference to the bound it comes from")
    assert ent.TOOLKITS["all"].max_definitions == svc.MAX_DEFINITIONS_PER_USER


def test_the_TOOLKIT_TABLE_cannot_be_mutated_at_runtime():
    """⛔ ONE PLACE MEANS ONE PLACE. A plain dict would let any importer rewrite a
    billing contract for the life of the process, and nothing would say so."""
    with pytest.raises(TypeError):
        ent.TOOLKITS["all"] = LARGE                          # type: ignore[index]
    with pytest.raises(dataclasses.FrozenInstanceError):
        ent.TOOLKITS["all"].max_symbols = 5                  # type: ignore[misc]
    assert list(ent.TOOLKITS) == ["all"]
    assert ent.TOOLKITS["all"].max_symbols is None


# ═══ 8. the CADENCE axis — the data floor first, the plan second ════════════

def test_an_entitlement_can_only_RAISE_the_refresh_floor_never_LOWER_it():
    """⛔ CONTRACT 3. An entitlement permitting a faster refresh than the data
    supports sells a promise the table cannot keep — and it fails INVISIBLY,
    because every number still looks right; the member just infers that new
    information arrived when the same 03:00 rows were re-read.
    """
    nightly = ent.CADENCE_FLOOR_SECONDS["nightly"]

    # a plan trying to buy a faster refresh than the store rebuilds
    fast = dataclasses.replace(SMALL, min_refresh_seconds=60)
    assert ent.refresh_floor_seconds("nightly", fast) == nightly

    # a plan asking for SLOWER than the data — the plan wins, it is a real bound
    slow = dataclasses.replace(SMALL, min_refresh_seconds=nightly * 7)
    assert ent.refresh_floor_seconds("nightly", slow) == nightly * 7

    # ⭐ A BARS-ONLY TREE HAS NO SCALAR CEILING, so intraday is honest for it and
    # the only floor is the plan's.
    assert ent.refresh_floor_seconds(None, fast) == 60
    assert ent.refresh_floor_seconds(None, UNGATED) is None
    assert ent.refresh_floor_seconds("nightly", UNGATED) == nightly


def test_every_cadence_the_MANIFEST_declares_has_a_FLOOR():
    """⛔ DERIVED FROM THE REGISTRY THE CODE ITERATES, NEVER FROM A HAND-LIST.

    E-2 measured the asymmetry (M5/M5b): a hand-list that AGREES with today's
    manifest is invisible to every behavioural test. So the subject set comes off
    `ast_table.scalar_names()`, and a fifty-fifth scalar declaring `intraday`
    fails BY NAME here instead of silently getting no floor.
    """
    declared = {ast_table.scalar_cadence(n) for n in ast_table.scalar_names()}
    assert declared, "the manifest declared no cadences — the rail is vacuous"
    missing = sorted(declared - set(ent.CADENCE_FLOOR_SECONDS))
    assert not missing, (
        f"the manifest declares cadence(s) {missing} with no floor in "
        "CADENCE_FLOOR_SECONDS. A scan on that cadence could be sold a refresh "
        "the store cannot deliver.")

    # …and an undeclared cadence is REFUSED rather than silently unbounded.
    with pytest.raises(ValueError, match="no declared floor"):
        ent.refresh_floor_seconds("every-tick", UNGATED)


def test_a_JOINED_cadence_takes_the_COARSEST_part():
    """⚠️ E-3 reports two disagreeing cadences as BOTH, joined, because ranking
    them needs an order the manifest does not declare. Ranking them HERE is a
    different question and a legitimate one: this is not choosing which to report,
    it is refusing to promise faster than the slowest thing the answer depends on.
    """
    floors = dict(ent.CADENCE_FLOOR_SECONDS)
    floors["hourly"] = 3600
    import types
    patched = types.MappingProxyType(floors)
    original = ent.CADENCE_FLOOR_SECONDS
    try:
        ent.CADENCE_FLOOR_SECONDS = patched                  # type: ignore[misc]
        assert ent.refresh_floor_seconds("hourly/nightly", UNGATED) == 86_400
        assert ent.refresh_floor_seconds("hourly", UNGATED) == 3600
    finally:
        ent.CADENCE_FLOOR_SECONDS = original                 # type: ignore[misc]


# ═══ 9. the shape itself ════════════════════════════════════════════════════

@pytest.mark.parametrize("kwargs", [
    {"toolkit": ""},
    {"max_symbols": -1},
    {"max_symbols": True},          # ⚠️ `isinstance(True, int)` is True
    {"max_symbols": 1.5},
    {"max_definitions": None},
    {"max_definitions": -3},
    {"min_refresh_seconds": "86400"},
])
def test_a_LIMITS_refuses_a_value_that_would_read_as_a_CAP_and_is_not_one(kwargs):
    """⛔ `max_symbols=True` WOULD CAP A UNIVERSE SWEEP AT ONE SYMBOL while reading
    as "enabled". A bool sails through every obvious numeric guard, which is the
    trap Phase D Task 5 measured in the hash lane; the bool branch comes first."""
    with pytest.raises(ValueError):
        dataclasses.replace(SMALL, **kwargs)


def test_a_TOOLKIT_is_hashable_frozen_and_comparable_BY_VALUE():
    """It is passed across a request boundary, put in sets by the tests above and
    compared for equality by the "nothing changed" rail — all three need value
    semantics, and a frozen dataclass is the one shape that gives all three."""
    assert ent.Limits("a", None, None, 1, None) == ent.Limits("a", None, None, 1, None)
    assert len({UNGATED, copy.deepcopy(UNGATED)}) == 1
    with pytest.raises(dataclasses.FrozenInstanceError):
        SMALL.max_symbols = 9                                # type: ignore[misc]
