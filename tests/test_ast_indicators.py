"""⭐⭐ THE PYTHON HALF OF PHASE F'S ACCEPTANCE, AND THE REPAINT DECISION.

The gap this phase closed was a sentence: **a member cannot write
``rsi(close, 14) > 70``.** The browser half of the acceptance is
``app/src/components/chart/builder/BuilderSheet.indicators.test.jsx``, which
drives the shipped sheet. This file is the SERVER half — the lane a scan, an
alert and a definition read on — plus the one decision Phase F owed the repaint
linter: ``ichimokuChikou`` is a genuine forward reference and must NOT badge
``non-repainting``.

⛔ NOTHING HERE RE-IMPLEMENTS AN INDICATOR AND NOTHING HERE RE-DERIVES A NUMBER.
Every expectation is either the manifest's own declaration, a value the shipped
``indicator_compute`` produced, or a structural property of the tree. The
cross-lane equality itself is NOT asserted here: it lives in
``tests/fixtures/ast/conformance_log.json`` as a frozen digest per case, checked
by ``tools/ast_conformance.py --check``, because an equality this file re-ran
would be a second oracle over the one the gate already owns.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_freshness, ast_interpret, ast_lint, ast_table, scan_definition

ACCEPTANCE_SOURCE = "rsi(close, 14) > 70"


def _is_pad(v) -> bool:
    """"Not computable here" in EITHER lane's spelling.

    ⚠️ The Python walker returns a list and pads with ``None``; the JS walker
    returns a ``Float64Array``, which cannot hold one, and pads with NaN.
    ``tools/ast_conformance.compare_lanes`` normalises the two before any
    cross-lane comparison — that is a CONTAINER difference, not a maths one,
    and a reader here that knew only one of them would trip over it.
    """
    return v is None or (isinstance(v, float) and math.isnan(v))

#: ⛔ THE TREE IS READ OUT OF THE COMMITTED CORPUS, NEVER HAND-WRITTEN HERE.
#: There is exactly one parser and it is `parse.js` (decision D-A1), so a tree
#: typed into a Python test is a tree nothing parsed — and `corpus.json`'s
#: `rsi_overbought` row is the one the conformance log's digest is taken over, so
#: reading it is what makes this file and that gate the same subject.
CORPUS_PATH = (pathlib.Path(__file__).resolve().parents[1]
               / "tests" / "fixtures" / "ast" / "corpus.json")


def _corpus_case(case_id: str) -> dict:
    with io.open(CORPUS_PATH, encoding="utf-8") as fh:
        doc = json.load(fh)
    for case in doc["cases"]:
        if case["id"] == case_id:
            return case
    raise AssertionError(
        f"the corpus has no case {case_id!r}. Every claim in this file is about "
        "the tree that row holds, so a missing row makes them claims about "
        "nothing rather than failures."
    )


@pytest.fixture(scope="module")
def bars() -> list:
    """A deterministic ramp long enough for a 52-bar Ichimoku window.

    ⚠️ NOT the parity fixture. The cross-lane numbers are the conformance log's
    job; what these bars are for is shape — column length, warm-up position, the
    0/1 domain — and a synthetic series makes the warm-up index arithmetic
    something a reader can check by eye.
    """
    out = []
    for i in range(160):
        c = 100 + math.sin(i / 5.0) * 8 + i * 0.05
        out.append({"t": 1700000000 + i * 300, "o": c - 0.3, "h": c + 0.6,
                    "l": c - 0.6, "c": c, "v": 1000 + i})
    return out


# ═══════════════════════════════════════════════════════════════════════════ #
# `rsi(close, 14) > 70` — the one expression this phase is measured by
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_acceptance_expression_is_a_SCAN_on_the_python_lane():
    """⛔ THE PREMISE FIRST. Every case below would pass vacuously against a
    manifest that had lost the entry — the walker would simply refuse and no
    assertion would notice unless one says so out loud."""
    assert "rsi" in ast_table.bar_names(), (
        "the closed table no longer declares `rsi` — every case in this file is "
        "about nothing"
    )
    assert ast_table.yields_of("rsi") == "num", (
        "`rsi(close, 14)` is a NUMBER; the `> 70` is what makes the expression a "
        "scan. A `bool` here would admit the bare call as a condition."
    )

    case = _corpus_case("rsi_overbought")
    assert case["source"] == ACCEPTANCE_SOURCE
    tree = case["ast"]
    # ⭐ `is_boolean_tree` IS WHAT DECIDES WHETHER A DEFINITION MAY BE SCANNED,
    # and it is DERIVED from the manifest's `yields` rather than from a list of
    # comparison operators — so a twenty-ninth function is classified the day it
    # lands. This is that derivation meeting an indicator for the first time.
    assert scan_definition.is_boolean_tree(tree) is True

    # …and the bare call is NOT a scan, which is the other half of the same
    # claim: admitting a real-valued tree would make `!= 0` true for every
    # non-zero reading on the board.
    bare = {"type": "call", "name": "rsi",
            "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 14}]}
    assert scan_definition.is_boolean_tree(bare) is False


def test_the_acceptance_expression_LINTS_non_repainting_with_a_tree_sum_lookback():
    tree = _corpus_case("rsi_overbought")["ast"]
    reach = ast_lint.ast_reach(tree)
    # ⭐ THE CLAIM `_no_offset` EXISTS TO PROTECT. `rsi` declares
    # `lookback: "arg1"`, so the window is decidable WITHOUT evaluating anything
    # and the forward reach is a real 0 rather than the `unknown` the badge fails
    # closed on. An indicator that could not be bounded this way would badge
    # `repaints`, and nobody arms a repainting alert.
    assert reach["back"] == 14
    assert reach["forward"] == 0
    assert ast_lint.max_lookback(tree) == 14
    assert ast_lint.mode_from_reach(reach["forward"]) == "non-repainting"
    assert ast_lint.lint_repaint(tree)["mode"] == "non-repainting"


def test_the_acceptance_expression_is_LIVE_not_as_of_a_snapshot():
    """⭐ THE OTHER VERDICT, AND IT IS THE ONE THAT MAKES AN INDICATOR WORTH
    HAVING. `rsi14` is a screener SCALAR dated by a nightly `bars_asof`;
    `rsi(close, 14)` is recomputed from the bars in hand. `ast_freshness` is
    where the difference becomes visible to a member, so it is asserted rather
    than described."""
    tree = _corpus_case("rsi_overbought")["ast"]
    assert ast_freshness.scalars_in(tree) == set()
    assert ast_freshness.freshness_for(tree)["mode"] == "live"

    # …and the scalar spelling really is the other answer, so this is a
    # DISTINCTION rather than a constant.
    scalar_tree = {"type": "op", "name": ">",
                   "args": [{"type": "series", "name": "rsi14"},
                            {"type": "num", "value": 70}]}
    assert ast_freshness.freshness_for(scalar_tree)["mode"] != "live"


def test_the_acceptance_expression_EVALUATES_to_a_0_1_column(bars):
    tree = _corpus_case("rsi_overbought")["ast"]
    col = ast_interpret.interpret(tree, bars, {})
    assert len(col) == len(bars)
    # ⛔ A COMPARISON IS 0/1 AND NOTHING ELSE — `closedTable.json::_booleans`. An
    # indicator arriving as a raw reading on this path would put a 63.4 in a
    # column the alert grammar reads as a signal. ⚠️ A comparison against a NaN
    # is 0 rather than NaN (the manifest pins that separately), so this column
    # carries no pad at all and `None` appearing here would itself be a finding.
    assert all(v in (0.0, 1.0) for v in col), sorted({v for v in col})[:5]

    # …and the RSI underneath it warms up rather than fabricating zeros.
    # ⚠️ THIS LANE PADS WITH `None`. The JS lane returns a `Float64Array` and
    # pads with NaN; a Python list can hold either, and `ast_conformance`
    # normalises the two before comparing. Reading it as NaN here would trip over
    # a difference that is a container's, not the maths'.
    raw = ast_interpret.interpret(
        {"type": "call", "name": "rsi",
         "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 14}]},
        bars, {})
    assert _is_pad(raw[13]), "bar 13 is inside the warm-up and must not carry a value"
    assert not _is_pad(raw[14]) and math.isfinite(raw[14]), "bar 14 is the first computable RSI"
    assert 0.0 < raw[14] < 100.0


# ═══════════════════════════════════════════════════════════════════════════ #
# the repaint decision Phase F owed: chikou is a FORWARD reference
# ═══════════════════════════════════════════════════════════════════════════ #

def test_the_lagging_span_lints_PREVIEW_REPAINTS_and_the_forward_ROSTER_is_pinned():
    """⭐⭐ `chikou[j]` IS `close[j + 26]` — the exact construction
    ``closedTable.json::_no_offset`` names as the thing the repaint linter has to
    be able to decide, and until Phase F nothing in the table could express it.

    ⛔ THE VERDICT IS `preview-repaints`, NOT `repaints` AND NOT
    `non-repainting`, and all three matter. `non-repainting` would be the brand's
    central claim made falsely about a value that moves while the newest bar
    forms. `repaints` would be true but would throw away the fact that the reach
    is a KNOWN, FINITE 26 bars — and ``lint.js``'s own header records that
    `preview-repaints` was, until now, *"emitted by nothing at all"*, which is a
    mode nobody could show working.
    """
    tree = _corpus_case("ichimoku_chikou")["ast"]
    reach = ast_lint.ast_reach(tree)
    assert reach["forward"] == 26, (
        "the lagging span's forward reach is the kijun period, read off the "
        "manifest's `forward: arg4` declaration"
    )
    assert reach["back"] == 52
    assert ast_lint.lint_repaint(tree)["mode"] == "preview-repaints"
    # …and the reason travels with the verdict rather than being inferable.
    assert ast_lint.ast_reach(tree)["reasons"], (
        "a non-zero forward reach with no stated reason is a badge a member "
        "cannot act on"
    )

    # ⛔ AND THE ROSTER IS PINNED — every entry, with the ruling that admitted it.
    #
    # ⚰️ THIS ASSERTED `== {"ichimokuChikou": "arg4"}` AND THE CASE WAS NAMED
    # `..._and_it_is_the_only_one`. The REASON below is right and unchanged — a
    # forward declaration is a repaint claim about a member's chart and belongs
    # to the owner of that claim — but a hard-coded SINGLETON encoded scarcity as
    # if it were the rule, and that scarcity is exactly what let three false
    # claims about this machinery survive (a defect called "latent because every
    # table-legal tree is non-repainting today", a mutation that "did not
    # discriminate", and `canSaveFormula`'s `acknowledged` branch believed dead).
    #
    # ⭐ THE TEETH ARE UNCHANGED: a FOURTH entry growing a `forward` still lands
    # RED here by name. What changed is that the roster can hold a ruling.
    forwards = {name: spec.get("forward")
                for name, spec in ast_table.TABLE["functions"].items()
                if "forward" in spec}
    assert forwards == {
        # the lagging span IS `close[j + 26]`; the displacement is the compute's own
        "ichimokuChikou": "arg4",
        # W2a.6, owner-ruled: TV-native confirmed-late. The value is drawn on the
        # pivot bar once the right-hand bars exist, and the badge is honest about
        # the k-bar wait instead of hiding it behind a lag.
        "pivothigh": "arg2",
        "pivotlow": "arg2",
    }, (
        f"the forward roster changed: {sorted(forwards)}. Each entry is a repaint "
        "claim about a member's chart and belongs with the owner of that claim, "
        "not with an implementation task -- so a new one lands here, by name."
    )
    # ⛔ AND THE TWO CLOUD SPANS ARE STILL OUT, which is the half the singleton
    # was really protecting: declaring `forward` on them would brand them for a
    # displacement the shipped compute does NOT perform
    # (`_functions_excluded._ichimoku_forward_cloud`).
    #
    # ⚰️ AND THIS LOOP LINTED `ichimoku_span_a` ON BOTH ITERATIONS. `span` was
    # dropped from the second assertion, so `ichimokuSpanB`'s mode was never
    # measured and the rail carried HALF the coverage it appeared to have -- in
    # the very case written to replace a rail that had encoded a singleton. The
    # case id is DERIVED from the entry name now, so the two cannot drift apart.
    for span, case_id in (("ichimokuSpanA", "ichimoku_span_a"),
                          ("ichimokuSpanB", "ichimoku_span_b")):
        assert case_id.replace("_", "").lower() == span.lower(), (span, case_id)
        assert "forward" not in ast_table.TABLE["functions"][span], span
        reach = ast_lint.ast_reach(_corpus_case(case_id)["ast"])
        assert reach["forward"] == 0, (span, reach)
        assert ast_lint.mode_from_reach(reach["forward"]) == "non-repainting", span
        # ⛔ AND THE CASE REALLY CALLS THE ENTRY IT CLAIMS TO -- a corpus id that
        # stopped pointing at this function would make the lines above a
        # measurement of some other tree, which is exactly how the duplicated
        # `ichimoku_span_a` above went unnoticed.
        assert _corpus_case(case_id)["ast"]["name"] == span, (span, case_id)


def test_the_lagging_span_really_does_read_a_LATER_bar(bars):
    """⛔ THE DECLARATION AND THE COMPUTE ARE TWO DIFFERENT THINGS, AND
    ``lint.js`` says so in writing: *"a compute whose real window is wider than
    its declaration would be branded on the declaration and the linter would be
    wrong."* So the `forward: arg4` above is checked against what the column
    actually holds, not only against what the manifest says.
    """
    tree = _corpus_case("ichimoku_chikou")["ast"]
    col = ast_interpret.interpret(tree, bars, {})
    closes = [b["c"] for b in bars]
    kijun = 26
    matched = 0
    for j, v in enumerate(col):
        if _is_pad(v):
            continue
        assert j + kijun < len(closes)
        assert v == pytest.approx(closes[j + kijun], rel=0, abs=0), (
            f"chikou[{j}] is {v}, and close[{j + kijun}] is {closes[j + kijun]}"
        )
        matched += 1
    assert matched > 50, (
        f"only {matched} bars carried a lagging value — the loop above asserted "
        "almost nothing"
    )
    # ⛔ THE PAD IS AT THE END, which is the shape that makes this a FORWARD
    # reference at all: the last `kijun` bars have no lagging value yet because
    # the bar they would read has not happened.
    assert all(_is_pad(v) for v in col[-kijun:])


# ═══════════════════════════════════════════════════════════════════════════ #
# the refusals are a register, not an omission
# ═══════════════════════════════════════════════════════════════════════════ #

def test_every_refused_indicator_is_STILL_refused_and_says_why():
    """⭐ `_functions_excluded` IS HALF OF AN IDENTITY, EXACTLY LIKE
    `_scalars_excluded`. A declared list on its own is a list of what somebody
    remembered; with the register beside it, a member who cannot find `obv`
    learns whether it was forgotten or refused — and re-declaring one means
    DELETING its key, which is a decision somebody has to make on purpose.
    """
    excluded = ast_table.TABLE["_functions_excluded"]
    names = [k for k in excluded if not k.startswith("_")]
    assert names, "the register is empty — this test has no subject"

    declared = set(ast_table.TABLE["functions"])
    both = sorted(set(names) & declared)
    assert not both, (
        f"{both} are BOTH declared and listed as refused. The register is lying, "
        "and `conceptVocabulary.test.js` derives its undeclared-name probe from it."
    )
    for name in names:
        reason = excluded[name]
        assert isinstance(reason, str) and len(reason) > 40, (
            f"{name} is refused with no stated reason. A refusal nobody explained "
            "is indistinguishable from an omission, which is the whole thing this "
            "register exists to prevent."
        )
        # …and it really is unreachable: the walker has no implementation either,
        # so a formula naming it dies at `resolve:function` rather than finding a
        # binding somebody left behind.
        assert name not in ast_interpret.FN


def test_our_atr_IS_WILDER_and_the_difference_from_pine_is_the_SEED(bars):
    """🔴 ADJUDICATING A CROSS-PRODUCT FINDING: *"`ta.atr` matches neither Wilder
    RMA (0.20) nor SMA-of-TR (0.21) — a third convention"*, raised as a possible
    MEMBER-VISIBLE correctness defect because ATR feeds position sizing.

    ⭐ IT IS NOT A THIRD CONVENTION. Ours is Wilder's, exactly. This case builds
    Wilder's original independently — `TR = max(h-l, |h-c[1]|, |l-c[1]|)`, seed =
    the simple mean of the first `n` TRs, then `ATR_i = ATR_{i-1} + (TR_i -
    ATR_{i-1}) / n` — and asserts the shipped column matches it. The two
    alternatives are computed as well and asserted to DISAGREE, so this cannot
    pass by all three being the same thing.

    ⭐ WHAT THE OTHER PRODUCT ACTUALLY MEASURED IS THE SEED, AND IT CONVERGES.
    Pine's `ta.tr` defines bar 0 as `high - low` (there is no previous close), so
    its TR series starts one bar earlier and `ta.rma`'s seed lands on bar `n-1`
    where ours lands on bar `n`. Same smoothing, different first window. The gap
    decays with the RMA: ~2.0e-2 at the seed, ~3.0e-3 by bar 40, ~2.8e-5 by bar
    100, ~1.3e-11 by bar 300. ⛔ SO A CROSS-PRODUCT PROBE MUST NOT SAMPLE THE
    WARM-UP — 0.20 vs 0.21 read at bar 15 is two seeds, not two formulas, and
    reading it as a formula difference is how a correct implementation gets
    "fixed".
    """
    n = 14
    tr = [None] + [max(bars[i]["h"] - bars[i]["l"],
                       abs(bars[i]["h"] - bars[i - 1]["c"]),
                       abs(bars[i]["l"] - bars[i - 1]["c"]))
                   for i in range(1, len(bars))]

    wilder = [None] * len(bars)
    wilder[n] = sum(tr[1:n + 1]) / n
    for i in range(n + 1, len(bars)):
        wilder[i] = wilder[i - 1] + (tr[i] - wilder[i - 1]) / n

    sma_of_tr = [None] * len(bars)
    for i in range(n, len(bars)):
        sma_of_tr[i] = sum(tr[i - n + 1:i + 1]) / n

    got = ast_interpret.interpret(
        {"type": "call", "name": "atr",
         "args": [{"type": "series", "name": "high"}, {"type": "series", "name": "low"},
                  {"type": "series", "name": "close"}, {"type": "num", "value": n}]},
        bars, {})

    _assert_same_column(got, wilder, "atr-vs-Wilder")

    # ⛔ AND THE CONTROL: the other convention must DISAGREE, or the case above
    # is satisfied by every definition being the same and says nothing.
    apart = max(abs(got[i] - sma_of_tr[i]) / max(abs(got[i]), abs(sma_of_tr[i]))
                for i in range(n, len(bars))
                if not _is_pad(got[i]) and sma_of_tr[i] is not None)
    assert apart > 1e-3, (
        f"the simple-MA-of-TR convention is only {apart:.2e} away from ours, so "
        "matching Wilder above distinguishes nothing"
    )


#: The role names an ``int`` slot may carry that are NOT windows. ⛔ CLOSED, and
#: kept to one entry on purpose: the note inside ``accum``'s own generic-set
#: widening warns against "a vocabulary that grows one adjective at a time", and
#: this is the same widening. ``anchor`` earned it because ``avwap``'s instant is
#: inexpressible any other way — the table has two argument kinds and no string
#: literal node.
_INT_ROLES = frozenset({"anchor"})


def test_every_function_PINS_ITS_ARGUMENT_ORDER_for_the_translators():
    """⭐ `args` SAYS A SLOT IS A SERIES; `argRoles` SAYS WHICH SERIES.

    🔴 THE MEASURED REASON. The TC2000 translator refused four whole families —
    `CCIx.z`, `DIPLUSd.z`, `DIMINUSd.z`, `WSTOCx.y.z` — because `cci`, `plusDI`,
    `minusDI` and `williamsR` declared three `series` arguments and nothing said
    which three or in what order. A translator that GUESSES `(close, high, low)`
    where the maths wants `(high, low, close)` does not fail: it returns a
    plausible number. That is the worst failure shape in this codebase, and a
    sentence in a note cannot prevent it because a parser cannot read one.

    ⛔ SO THE ROLES ARE ASSERTED AGAINST `args`, IN BOTH DIRECTIONS. A slot
    renamed on one side and not the other lands RED here rather than leaving two
    descriptions of one argument list quietly disagreeing — which is this repo's
    most repeated defect, wearing yet another coat.
    """
    functions = ast_table.TABLE["functions"]
    problems = []
    for name, spec in functions.items():
        args = list(spec.get("args") or ())
        roles = list(spec.get("argRoles") or ())
        # ⛔ A ZERO-ARGUMENT ENTRY HAS ZERO ROLES, AND THAT IS NOT THE SAME FACT
        # AS "somebody forgot the key" (2026-08-26, `vwap()`). The two are told
        # apart by asking whether the KEY IS PRESENT, not whether the list is
        # truthy — an emptiness test conflated them, and would have reported a
        # correct nullary entry as a translator hazard while a genuinely missing
        # key on a 4-argument indicator reported the same words.
        if "argRoles" not in spec:
            problems.append(f"{name}: no argRoles — a translator cannot place its arguments")
            continue
        if len(roles) != len(args):
            problems.append(f"{name}: {len(roles)} roles for {len(args)} args")
            continue
        if len(set(roles)) != len(roles):
            problems.append(f"{name}: repeats a role name {roles} — two slots one name")
        for i, (kind, role) in enumerate(zip(args, roles)):
            if not isinstance(role, str) or not role:
                problems.append(f"{name}: slot {i} has no role")
                continue
            # ⭐ THE TWO DESCRIPTIONS MUST AGREE ON WHICH SLOTS ARE WINDOWS. A
            # translator reads the roles to find the window, so a `series` slot
            # must never claim to be one — that half is absolute.
            says_period = role.lower().endswith("period")
            if kind != "int" and says_period:
                problems.append(
                    f"{name}: slot {i} is a series and its role {role!r} claims to be a window")
            # ⚠️ AND AN `int` SLOT IS NOT ALWAYS A PERIOD ANY MORE. This read
            # `(kind == "int") != says_period` until 2026-08-26, when
            # `avwap(anchorEpoch)` landed: its `int` is an INSTANT, not a window,
            # and the table has no other argument kind that can carry one (two
            # kinds, `series` and `int`, and no string literal node). So the int
            # roles are a CLOSED SET instead — the same treatment `seed`/`update`
            # got when `accum` landed — and the window slots are PINNED below so
            # `anchor` can never sit on one.
            if kind == "int" and not says_period and role not in _INT_ROLES:
                problems.append(
                    f"{name}: slot {i} is an int whose role {role!r} is outside "
                    f"{sorted(_INT_ROLES)} and does not name a period")
    assert not problems, problems

    # ⛔ AND THE SLOT A WINDOW DECLARATION NAMES MUST BE A PERIOD ROLE. This is
    # what keeps the closed set above from being a hole: `lookback`/`forward`
    # spell `argN` (optionally `k*argN`), so the manifest itself says which slot
    # IS the window, and a translator following the roles can never be sent to
    # the anchor instead. DERIVED from the shipped grammar's own pattern, never a
    # copy of it.
    misdeclared = []
    for name, spec in functions.items():
        roles = list(spec.get("argRoles") or ())
        for field in ("lookback", "forward"):
            decl = spec.get(field)
            if not isinstance(decl, str):
                continue
            m = ast_lint._ARG_REF.match(decl)
            if not m:
                continue                     # `session` names no slot at all
            slot = int(m.group(2))
            role = roles[slot] if slot < len(roles) else None
            if not (isinstance(role, str) and role.lower().endswith("period")):
                misdeclared.append(
                    f"{name}: {field} names slot {slot}, whose role is {role!r} "
                    "and must name a period")
    assert not misdeclared, misdeclared
    assert any(isinstance(s.get("lookback"), str)
               and ast_lint._ARG_REF.match(s["lookback"])
               for s in functions.values()), (
        "no function declares an argument window — the pin above has no subject")

    # ⛔ AND THE ROLE NAMES ARE NOT FREE TEXT. Every `series` slot's role is
    # either a bar field this table declares or one of the two generic shapes
    # (`source` for a single input, `left`/`right` for a symmetric pair), so a
    # translator has a closed set to match against rather than a vocabulary that
    # grows one adjective at a time.
    # ⭐ `condition` JOINED ON 2026-08-26, AND IT IS NOT AN ADJECTIVE. Two of the
    # bounded-state entries take a slot the maths reads as a 0/1 EVENT rather than
    # as a price — `barssince(condition, n)`, `valuewhen(condition, source, n)` —
    # and a translator that filled that slot with `close` because the role said
    # `source` would produce a plausible column off a price compared to zero. It
    # is PINNED below, the way `seed`/`update` are, so it cannot spread to a slot
    # whose entry does not yield a condition there.
    generic = {"source", "left", "right", "seed", "update", "condition"}
    allowed = set(ast_table.TABLE["series"]) | generic

    # ⛔ AND `condition` IS ONLY LEGAL WHERE THE ENTRY REALLY READS AN EVENT.
    # Derived from the manifest: the slot must be a `series`, and the entry must
    # be one whose own sentence says the slot is TRUE or FALSE rather than a
    # quantity. A role that could sit anywhere is the free text this set exists
    # to prevent.
    for name, spec in functions.items():
        for i, role in enumerate(spec.get("argRoles") or ()):
            if role != "condition":
                continue
            assert spec["args"][i] == "series", (name, i, spec["args"])
            # ⚰️ THIS READ `("{%d} was" % i) in phrase or ("{%d} was" % i) in
            # phrase` -- THE SAME EXPRESSION ON BOTH SIDES OF AN `or`, so the
            # `or` could never change the verdict and half the check was
            # decoration. Both halves are real now: the slot must be SPOKEN in
            # the sentence, and the sentence must say what makes it a condition.
            phrase = spec.get("sentence", "")
            assert ("{%d}" % i) in phrase, (name, i, phrase)
            assert "true" in phrase.lower(), (name, phrase)
    assert any("condition" in (s.get("argRoles") or ()) for s in functions.values()), (
        "no function declares a `condition` slot — the pin above has no subject")

    # ⭐ THE TWO RECURRENCE SHAPES ARE NOT FREE TEXT EITHER, AND THIS IS WHAT
    # KEEPS THEM CLOSED. `seed` and `update` were added to the generic set above
    # the day `accum` landed; on their own that would be exactly the "vocabulary
    # that grows one adjective at a time" the note warns against. So the mapping
    # is PINNED: the role at the slot the manifest calls the seed must be
    # `seed`, and the role at the slot it calls the body must be `update`. A
    # manifest that swapped the two indices would still satisfy the closed set
    # and lands RED here instead — which matters, because swapping them makes
    # the walker evaluate the seed as a per-bar body and produce numbers.
    misplaced = []
    for name, rec in ast_table.recurrences().items():
        roles = list(ast_table.TABLE["functions"][name].get("argRoles") or ())
        for index_key, expected in (("seed", "seed"), ("body", "update")):
            got = roles[rec[index_key]] if rec[index_key] < len(roles) else None
            if got != expected:
                misplaced.append(
                    f"{name}: recurrence.{index_key} points at slot {rec[index_key]}, "
                    f"whose role is {got!r} and must be {expected!r}")
    assert not misplaced, misplaced
    stray = sorted({
        role for spec in functions.values()
        for kind, role in zip(spec["args"], spec["argRoles"])
        if kind != "int" and role not in allowed
    })
    assert not stray, (
        f"{stray} name a series slot with something outside "
        f"{sorted(allowed)}. A translator matches on this set."
    )

    # …and the four families that were refused for want of an order are covered.
    # ⛔ DERIVED: every declared function taking more than one `series` is named,
    # so a twenty-ninth arrives covered rather than quietly unreachable.
    multi = sorted(n for n, s in functions.items()
                   if sum(1 for k in s["args"] if k != "int") > 1)
    assert multi, "no multi-series function — this case has no subject"
    assert all(functions[n].get("argRoles") for n in multi), multi


def test_the_two_documented_compositions_are_the_columns_they_replace(bars):
    """⭐ THE REGISTER MAKES TWO CLAIMS THAT ARE NOT REFUSALS BUT PROMISES, and a
    promise nobody measures is the shape this repo keeps paying for.
    `_functions_excluded` says the MACD signal line and the stochastic %D are not
    declarable — their windows are sums of two arguments — but ARE expressible.
    These are the compositions it offers, checked against the very columns the
    shipped implementation computes.
    """
    from api.services.indicator_compute import compute_macd_raw, compute_stoch_raw

    signal_tree = _corpus_case("macd_signal_by_composition")["ast"]
    got = ast_interpret.interpret(signal_tree, bars, {})
    _, want, _ = compute_macd_raw([b["c"] for b in bars], 12, 26, 9)
    _assert_same_column(got, want, "macdSignal")

    d_tree = _corpus_case("stoch_d_by_composition")["ast"]
    got_d = ast_interpret.interpret(d_tree, bars, {})
    _, want_d = compute_stoch_raw(bars, 14, 3)
    _assert_same_column(got_d, want_d, "stochD")


def _assert_same_column(got, want, label: str) -> None:
    """⛔ NEVER `pytest.approx`'s DEFAULT. Measured this week, an `ema`
    difference of 9.919e-07 sits INSIDE its `rel=1e-6` default — a tolerance that
    admits the exact class of drift these comparisons exist to catch. The
    tolerance here is the conformance log's own 1e-9, spelled out.
    """
    assert len(got) == len(want)
    compared = 0
    for i, (a, b) in enumerate(zip(got, want)):
        a_nan = a is None or (isinstance(a, float) and math.isnan(a))
        b_nan = b is None
        assert a_nan == b_nan, f"{label}[{i}]: pad disagreement ({a!r} vs {b!r})"
        if a_nan:
            continue
        scale = max(abs(a), abs(b))
        assert scale == 0 or abs(a - b) <= 1e-9 * scale, (
            f"{label}[{i}]: {a!r} vs {b!r}, rel {abs(a - b) / scale}"
        )
        compared += 1
    assert compared > 50, (
        f"{label}: only {compared} bars were compared — the loop asserted almost "
        "nothing"
    )
