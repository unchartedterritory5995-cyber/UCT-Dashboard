"""THE REPAINT LINTER'S RAILS -- the Python lane, and the cross-lane agreement.

The product's market position is *receipts*, and the badge is the claim. This
file is one half of what makes the claim checkable; the other half is
``app/src/components/chart/engine/ast/lint.test.js``. They read the SAME corpus
fixture and the SAME decision record, so a lane that quietly disagreed with the
other would be a failing test rather than a discovery six months later.

Written against the nine obligations the decision record states, not against the
implementation:

    1  decidable on the AST, with NO execution
    2  the forward-reference set derived from the MANIFEST both lanes read
    3  a corpus that must be branded repainting, non-vacuity asserted
    4  a positive control the OTHER way
    5  the guard-deleted control
    6  no exemption surface, proven by AST over the linter's own source
    7  it must be able to disagree with us, and the disagreement must survive
    8  natives and the server lane are in scope of the MEASUREMENT
    9  per-plot granularity, expressible before any badge moves

⛔ NOTHING HERE EDITS A BADGE.
"""
from __future__ import annotations

import ast as pyast
import io
import json
import pathlib
import re

import pytest

from api.services import ast_lint as al
from api.services import indicator_compute as ic

# ⭐ IMPORTED, NEVER RE-TYPED. ``TRAILING_PAD`` is the ONE place a trailing
# dependency of a shipped compute is already pinned, and its own comment says
# why it is declared as a number rather than waived: *"change the back-shift and
# this goes red with the two numbers in hand."* A hand-copied literal here would
# be a SECOND declaration of one fact and it would rot the day the pad moved --
# which is exactly the mutation this file's own AST rail below is built to kill.
from tests.test_indicator_golden import TRAILING_PAD

ROOT = pathlib.Path(__file__).resolve().parent.parent
CORPUS_PATH = ROOT / "tests" / "fixtures" / "ast" / "must_repaint.json"
RECORD_PATH = ROOT / "docs" / "decisions" / "2026-08-06-machine-repaint-linter.md"
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "indicators"

CORPUS = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))

#: The corpus's declared v2 entries merged ON TOP of the shipped manifest.
#: ⛔ THE SHIPPED HALF IS NEVER COPIED -- it is ``al.TABLE``, read from the same
#: ``closedTable.json`` the parser is configured from.
CORPUS_TABLE = dict(al.TABLE)
CORPUS_TABLE["functions"] = dict(al.TABLE["functions"], **CORPUS["tableOverlay"]["functions"])


def case_by_id(case_id):
    for c in CORPUS["cases"]:
        if c["id"] == case_id:
            return c
    raise AssertionError("must_repaint.json has no case %r" % case_id)


# --------------------------------------------------------------------------- #
# obligations 3 + 4 -- the corpus, and its own non-vacuity
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("case", CORPUS["cases"], ids=[c["id"] for c in CORPUS["cases"]])
def test_every_corpus_case_gets_the_verdict_it_declares(case):
    """Each case is HAND-DERIVED and carries its own reason in the fixture.

    ⛔ ``expect`` is the SAME field the vitest lane asserts against, so this is
    also the cross-lane binding: if the two lanes' vocabularies or arithmetic
    diverged, one of them would fail here. Two independent implementations
    agreeing on eleven hand-derived trees is a stronger claim than either one
    agreeing with itself.
    """
    got = al.lint_repaint(case["ast"], {"table": CORPUS_TABLE})
    assert got["mode"] == case["expect"], (
        "%s: expected %s, measured %s (%s). Read the case's own `why` before changing either "
        "side -- 'make the corpus match the linter' is how a measurement becomes a tautology."
        % (case["id"], case["expect"], got["mode"], "; ".join(got["reasons"]))
    )
    assert got["reasons"], "%s produced a verdict with no reason" % case["id"]


def test_the_corpus_is_not_degenerate_in_either_direction():
    """A corpus in which every case is clean measures nothing -- and one in which
    every case is dirty measures nothing either, because a linter that returns
    ``repaints`` unconditionally passes every one of them.

    ⭐ AND EVERY VALUE IN THE VOCABULARY IS REACHED BY A HAND-DERIVED CASE. The
    record's section 3 warns that *"a vocabulary value nothing can ever emit is a
    value that does not exist"* -- it says that about ``preview-repaints``, which
    today is emitted by nothing at all.
    """
    expected = [c["expect"] for c in CORPUS["cases"]]
    counts = {m: expected.count(m) for m in al.REPAINT_MODES}
    assert counts["non-repainting"] >= 2, (
        "obligation 4: without a clean case, a linter that returns `repaints` unconditionally "
        "passes every dirty case and is indistinguishable from one that works. counts=%r" % counts)
    assert counts["preview-repaints"] >= 1, counts
    assert counts["repaints"] >= 1, counts
    assert set(expected) == set(al.REPAINT_MODES), (
        "a badge value no case expects is a value nothing measures. counts=%r" % counts)
    assert [c["id"] for c in CORPUS["cases"] if not c.get("why", "").strip()] == []


def test_the_two_lanes_read_the_same_corpus_file_and_the_same_vocabulary():
    """The fixture is the shared artefact, and the vitest lane reads this path.

    ⚠️ A GREP FOR THE PATH WOULD FIND THIS FILE'S OWN COMMENTS, so the JS lane's
    reference is read as a string CONSTANT out of its parsed source... which
    Python cannot do for JavaScript. So it is asserted the honest way instead:
    the path is checked to exist and to be the one THIS lane loaded, and the
    binding between the lanes is the ``expect`` field above, which both assert.
    """
    assert CORPUS_PATH.exists()
    js = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "lint.test.js").read_text(
        encoding="utf-8")
    assert "tests/fixtures/ast/must_repaint.json" in js, (
        "the vitest lane no longer reads this corpus, so `expect` has stopped being a cross-lane "
        "agreement and each lane is only agreeing with itself")


# --------------------------------------------------------------------------- #
# obligation 1 -- decided on the tree, nothing is ever run
# --------------------------------------------------------------------------- #


def test_no_evaluator_is_reachable_from_the_linter():
    """⛔ PROVEN BY THE IMPORT GRAPH, NOT BY A PROMISE.

    An empirical *"we ran it and nothing moved"* is a statement about one bar
    window and the badge's claim is universal, so the linter must be structurally
    incapable of running a formula. It imports the standard library and nothing
    else -- in particular not ``indicator_compute``, which is the module that
    could answer the question the wrong way.
    """
    tree = pyast.parse(pathlib.Path(al.__file__).read_text(encoding="utf-8"))
    modules = set()
    for node in pyast.walk(tree):
        if isinstance(node, pyast.Import):
            modules.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, pyast.ImportFrom):
            modules.add((node.module or "").split(".")[0])
    assert modules == {"__future__", "json", "pathlib", "re", "typing"}, (
        "the linter reaches a module outside the standard library. If that module can compute an "
        "indicator, the verdict could be reached by RUNNING the formula instead of by reading the "
        "tree -- and a claim measured on one bar window is not the universal claim the badge makes. "
        "modules=%r" % sorted(modules))


# --------------------------------------------------------------------------- #
# obligation 2 -- the forward set comes from the manifest, not a second list
# --------------------------------------------------------------------------- #


def test_the_forward_reach_comes_out_of_the_declared_window():
    """Change the DECLARATION, change the verdict. No line of the linter moves.

    That is what obligation 2 asks for: the maximum forward index an entry can
    read comes from the table BOTH LANES READ, so the day an offset form is added
    its reach is already decided. A per-function offset table kept beside the
    manifest is a second grammar and it drifts silently.
    """
    tree = {"type": "call", "name": "probe",
            "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 7}]}

    def with_spec(spec):
        table = dict(al.TABLE)
        table["functions"] = dict(al.TABLE["functions"], probe=spec)
        return al.lint_repaint(tree, {"table": table})

    assert with_spec({"args": ["series", "int"], "lookback": "arg1"})["mode"] == "non-repainting"
    flipped = with_spec({"args": ["series", "int"], "lookback": -3})
    assert (flipped["mode"], flipped["forward"]) == ("preview-repaints", 3)
    assert with_spec({"args": ["series", "int"], "lookback": 0, "forward": "arg1"})["forward"] == 7
    assert with_spec({"args": ["series", "int"], "lookback": 0, "forward": "unbounded"})["mode"] == "repaints"


def test_the_linter_carries_no_offset_table_of_its_own():
    """⛔ AST, NOT GREP. The question is which string CONSTANTS the module holds.

    A grep for a manifest function name finds this file's own prose and the
    linter's own comments; a comment cannot be a constant, and that is the whole
    reason obligation 6 says *"never by grep"*.
    """
    tree = pyast.parse(pathlib.Path(al.__file__).read_text(encoding="utf-8"))
    constants = {n.value for n in pyast.walk(tree)
                 if isinstance(n, pyast.Constant) and isinstance(n.value, str)}
    manifest_names = set(al.TABLE["functions"]) | set(al.TABLE["series"])
    assert not (constants & manifest_names), (
        "the linter names a manifest entry in its own source: %r" % sorted(constants & manifest_names))
    assert manifest_names, "the manifest declares no names, so the check above filtered nothing"


def test_max_lookback_is_the_backward_window_and_never_a_forward_bound():
    """⛔ A lookback read as a forward bound brands ``sma(close, 20)`` as reading
    twenty bars ahead. Every clean case in the corpus goes with it and the
    builder ships nothing -- which is exactly how that confusion is caught."""
    sma20 = case_by_id("plain_sma")["ast"]
    reach = al.ast_reach(sma20, {"table": CORPUS_TABLE})
    assert (reach["back"], reach["forward"]) == (20, 0)
    assert al.max_lookback(sma20, {"table": CORPUS_TABLE}) == 20
    # a composed window really sums, so `back` is a number somebody could use
    assert al.max_lookback(case_by_id("cross_of_emas")["ast"], {"table": CORPUS_TABLE}) == 22


# --------------------------------------------------------------------------- #
# obligation 5 -- the guard-deleted control
# --------------------------------------------------------------------------- #


def _mutated_linter(fragment: str, replacement: str) -> dict:
    """Exec a MUTATED COPY of the linter's source into a fresh namespace.

    ⛔ NOTHING ON DISK IS TOUCHED, so there is no file to restore and no chance of
    restoring the wrong one -- a harness on this branch has already restored the
    file it PATCHED rather than the one the mutation WROTE.

    ⛔ AND THE MUTATION IS PROVEN TO HAVE APPLIED. ``assert old in src`` before
    ``replace`` is the rule; a control that silently mutated nothing would report
    *"still red"* and read as a working gate.
    """
    src = pathlib.Path(al.__file__).read_text(encoding="utf-8")
    assert src.count(fragment) == 1, (
        "the guard-deleted control cannot find exactly one occurrence of the fragment it deletes "
        "(found %d). The control is measuring nothing." % src.count(fragment))
    namespace = {"__name__": "ast_lint_guard_deleted", "__file__": al.__file__}
    exec(compile(src.replace(fragment, replacement), al.__file__, "exec"), namespace)  # noqa: S102
    return namespace


def _dirty_cases():
    return [c for c in CORPUS["cases"] if c["expect"] != "non-repainting"]


def test_with_the_forward_reference_check_deleted_the_corpus_comes_back_non_zero_clean():
    """⭐ THE LINTER IS DEMONSTRATED CAPABLE OF BEING WRONG.

    A gate that cannot fail is not a gate. With the forward-reference branch
    deleted, every BOUNDED forward reference reads ``non-repainting`` -- and the
    fail-closed cases stay dirty, because they never reached that branch at all.
    A partial collapse is the honest shape; a total one would mean the two
    verdicts were the same verdict.
    """
    mutant = _mutated_linter('    if forward > 0:\n        return "preview-repaints"\n', "")
    wrongly_clean = sorted(
        c["id"] for c in _dirty_cases()
        if mutant["lint_repaint"](c["ast"], {"table": CORPUS_TABLE})["mode"] == "non-repainting")
    assert wrongly_clean == ["centred_window", "future_index", "future_offset_series"], wrongly_clean
    assert 0 < len(wrongly_clean) < len(_dirty_cases())


def test_with_the_declared_window_ignored_the_manifest_derived_cases_collapse_too():
    """The second deletion is strictly WIDER, and the difference is the
    measurement that says the two are not one deletion wearing two names:
    ``unbounded_forward`` is decided by the DECLARED window rather than by the
    fail-closed branch, so ignoring the declaration launders it clean as well."""
    mutant = _mutated_linter(
        "                    forward = _add_reach(own_forward, arg_forward)",
        "                    forward = arg_forward")
    wrongly_clean = sorted(
        c["id"] for c in _dirty_cases()
        if mutant["lint_repaint"](c["ast"], {"table": CORPUS_TABLE})["mode"] == "non-repainting")
    assert wrongly_clean == [
        "centred_window", "future_index", "future_offset_series", "unbounded_forward"], wrongly_clean


def test_control_the_unmutated_linter_brands_every_dirty_case_dirty():
    """Without this the two controls above could be measuring a corpus that was
    never dirty in the first place."""
    assert [c["id"] for c in _dirty_cases()
            if al.lint_repaint(c["ast"], {"table": CORPUS_TABLE})["mode"] == "non-repainting"] == []


# --------------------------------------------------------------------------- #
# obligation 6 -- no exemption surface, proven structurally
# --------------------------------------------------------------------------- #


def _string_constants(src: str) -> set:
    """Every string CONSTANT a module holds, by AST.

    ⛔ NOT A GREP. On this branch a grep has counted comments in BOTH directions:
    it read a tombstone comment as a live declaration, and it counted four sites
    where three existed because the fourth was a comment quoting the code shape.
    """
    return {n.value for n in pyast.walk(pyast.parse(src))
            if isinstance(n, pyast.Constant) and isinstance(n.value, str)}


#: The shipped indicator names this lane can see, DERIVED rather than typed --
#: ``_CASE_COLUMNS`` is the dispatch table the golden fixtures are keyed by, and
#: its keys are the compute names the chart registry's definitions carry.
SHIPPED_NAMES = sorted(ic._CASE_COLUMNS)


def test_there_is_no_exemption_for_anything():
    """⛔ An allow-list, an ``author == 'uct'`` branch, an id-keyed override and a
    "known-good" set all take the same shape: a string constant naming one of
    ours. There is none, and if an exemption is ever genuinely needed it is a
    change to the decision record FIRST and to code second."""
    constants = _string_constants(pathlib.Path(al.__file__).read_text(encoding="utf-8"))
    named = sorted(constants & set(SHIPPED_NAMES))
    assert named == [], (
        "the linter names a shipped indicator in a string constant: %r. That is the hand-audited "
        "metadata this linter exists to replace." % named)
    assert len(SHIPPED_NAMES) > 10, "the shipped-name list is empty, so the filter above filtered nothing"


def test_control_the_same_detector_finds_an_exemption_when_one_is_really_there():
    """Three green filters prove only that a set intersection is empty sometimes.

    This is the exemption the test above forbids, written out, and the detector
    must FIND it -- and must NOT find the same name in a comment, which is the
    half a grep gets wrong in the direction that fails a clean file.
    """
    exempt = (
        "def lint_repaint(tree, opts=None):\n"
        "    if opts.get('defId') == 'ichimoku':\n"
        "        return {'mode': 'non-repainting'}\n"
        "    return {'mode': 'repaints'}\n"
    )
    assert sorted(_string_constants(exempt) & set(SHIPPED_NAMES)) == ["ichimoku"]
    assert _string_constants("# ichimoku is not exempt\nA = 1\n") & set(SHIPPED_NAMES) == set()


def test_the_verdict_is_id_blind_behaviourally():
    """The same tree answers the same under every id somebody could smuggle in."""
    tree = case_by_id("future_offset_series")["ast"]
    base = al.lint_repaint(tree, {"table": CORPUS_TABLE})["mode"]
    answers = set()
    for name in SHIPPED_NAMES + ["uct", "", "anything"]:
        answers.add(al.lint_repaint(tree, {
            "table": CORPUS_TABLE, "defId": name, "id": name,
            "author": "uct", "tier": "free", "trusted": True,
        })["mode"])
    assert answers == {base}


# --------------------------------------------------------------------------- #
# obligations 7, 8, 9 -- THE MEASUREMENT, and the record that holds it
# --------------------------------------------------------------------------- #


def _record_measurement_block() -> list:
    """The record's machine-readable block, read out of the REPO.

    ``.superpowers/`` is gitignored, so a number that lives only there does not
    exist. ⚠️ CRLF is normalised at the door: ``core.autocrlf`` is on in this
    checkout and a ``split("\\n")`` would leave a ``\\r`` on every line.
    """
    md = io.open(RECORD_PATH, encoding="utf-8").read().replace("\r\n", "\n")
    blocks = [b for b in md.split("```") if b.lstrip().startswith("LINTER-MEASUREMENT-V1")]
    assert len(blocks) == 1, (
        "the decision record must carry exactly ONE `LINTER-MEASUREMENT-V1` block (found %d). Zero "
        "means the measurement lives nowhere durable; two means the first has stopped being the "
        "answer." % len(blocks))
    return [line.strip() for line in blocks[0].strip().split("\n") if line.strip()]


def _pads_measured_from_the_golden_fixtures() -> dict:
    """``(case, column) -> trailing null run``, measured off the committed artefacts.

    The declaration lives in ``TRAILING_PAD``; this measures the ARTEFACT the
    declaration describes, so the two agree on a number neither of them typed.
    """
    out = {}
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        expected = doc.get("expected")
        if not isinstance(expected, dict):
            continue
        for col, values in expected.items():
            if not isinstance(values, list) or not values:
                continue
            trailing = 0
            for value in reversed(values):
                if value is not None:
                    break
                trailing += 1
            if trailing:
                assert trailing != len(values), "%s.%s is entirely null" % (path.name, col)
                out[(path.stem, col)] = trailing
    return out


def _declared_forward_facts() -> dict:
    """``"<fn>.<column>" -> n``, built from the DECLARATION, keyed by compute name.

    ⛔ THE CASE NAME IS NOT THE COMPUTE NAME AND IS NOT ASSUMED TO BE. The join
    goes through the fixture's own ``kind`` field -- the same field
    ``compute_case`` dispatches on -- so a fixture renamed from
    ``ichimoku_9_26_52`` to anything else does not silently drop the fact.
    """
    facts = {}
    for (case_name, column), pad in TRAILING_PAD.items():
        doc = json.loads((FIXTURE_DIR / ("%s.json" % case_name)).read_text(encoding="utf-8"))
        facts["%s.%s" % (doc["kind"], column)] = pad
    return facts


def _server_lane_definitions() -> list:
    """Definition-shaped rows for every compute this lane can name.

    ⛔ DERIVED FROM ``_CASE_COLUMNS``, NOT TYPED. That table is the Python lane's
    own statement of which columns each compute produces, so the plot list here
    is the lane's own and not a copy of the chart registry's.
    """
    return [
        {"id": kind, "compute": {"kind": "native", "fn": kind},
         "plots": [{"key": col} for col in cols]}
        for kind, cols in sorted(ic._CASE_COLUMNS.items())
    ]


def test_the_declaration_and_the_artefact_agree_on_a_number_neither_lane_typed():
    """⚠️ ``TRAILING_PAD`` is a DECLARATION; the golden fixture is the ARTEFACT.

    They are asserted equal here so that the JS lane -- which measures the
    artefact -- and this lane -- which reads the declaration -- are provably
    talking about the same fact. Neither lane holds a literal.
    """
    assert _pads_measured_from_the_golden_fixtures() == dict(TRAILING_PAD), (
        "the declared trailing pad and the pad actually present in the committed golden fixture "
        "have diverged. One of them is wrong and the repaint verdict rests on both.")
    assert TRAILING_PAD, "TRAILING_PAD is empty, so every assertion resting on it is vacuous"


def test_the_server_lane_states_per_plot_whether_it_could_decide_at_all():
    """⭐ OBLIGATIONS 8 + 9 IN THIS LANE.

    Every shipped compute here is hand-written Python. The linter cannot read a
    line of it, and it says so PER PLOT rather than reporting a clean answer it
    did not earn -- so *"the linter agreed with every shipped badge"* is a
    sentence that cannot be written over silence. The one plot it can decide is
    decided by a fact pinned OUTSIDE the linter and handed in.
    """
    defs = _server_lane_definitions()
    facts = _declared_forward_facts()
    rows = al.lint_catalogue(defs, {"declared_forward_facts": facts})

    decided = [r for r in rows if r["decidability"] == "decided"]
    assert len(rows) > 20, "the catalogue is empty, so everything below is a claim about zero rows"
    assert {r["decidability"] for r in rows} <= set(al.DECIDABILITY)
    assert all(r["address"] == "%s.%s" % (r["defId"], r["plotKey"]) for r in rows)
    # "no opinion" and "agrees" are different sentences, and this is the clause
    # that stops them being written the same way.
    assert [r["address"] for r in rows
            if r["decidability"] == "undecidable-hand-written" and r["mode"] is not None] == []
    assert [r["address"] for r in decided if r["mode"] is None] == []
    assert all(r["reasons"] for r in rows)
    assert sorted(r["address"] for r in decided) == sorted(facts), (
        "the linter decided a plot no external fact was pinned for, or failed to decide one that "
        "was. Its only source of knowledge about a hand-written compute is the facts handed in.")


def test_the_recorded_measurement_is_confirmed_independently_by_this_lane():
    """⭐⭐ OBLIGATION 7 -- IT CAN DISAGREE WITH US, AND THE DISAGREEMENT SURVIVES.

    The vitest lane rebuilds the whole recorded block from the chart registry.
    This lane cannot see a shipped badge, so it confirms the half it CAN derive
    on its own: the address, the verdict and the forward reach of every decided
    row, from ``TRAILING_PAD`` and ``_CASE_COLUMNS``.

    ⛔ A disagreement recorded here cannot be silenced by editing the badge --
    deleting the ``disagreement`` line fails the vitest lane, editing
    ``meta.repaint`` fails the enumeration ledger's biconditional against this
    same record's header, and moving the pad fails this test. Three rails, three
    directions, and the failure direction is always *"the finding is loud"*.
    """
    recorded = _record_measurement_block()
    facts = _declared_forward_facts()
    rows = al.lint_catalogue(_server_lane_definitions(), {"declared_forward_facts": facts})
    decided = [r for r in rows if r["decidability"] == "decided"]

    derived_verdicts = sorted(
        "verdict %s %s forward=%s" % (r["address"], r["mode"], r["forward"]) for r in decided)
    recorded_verdicts = sorted(line for line in recorded if line.startswith("verdict "))
    assert recorded_verdicts == derived_verdicts, (
        "the decision record's verdict rows and this lane's independent derivation have diverged. "
        "recorded=%r derived=%r" % (recorded_verdicts, derived_verdicts))

    # …and the record does not get to claim agreement while a disagreement stands.
    disagreements = [line for line in recorded if line.startswith("disagreement ")]
    assert disagreements, (
        "the record's measurement block records no disagreement at all. That is either a real "
        "change -- in which case the vitest lane has already gone red and this message is the "
        "second one you are reading -- or somebody deleted the finding.")
    for line in disagreements:
        address = line.split()[1]
        assert address in {r["address"] for r in decided}, (
            "the record names a disagreement on a plot this lane cannot decide: %s" % address)
        measured = dict(part.split("=", 1) for part in line.split()[2:])["measured"]
        row = next(r for r in decided if r["address"] == address)
        assert measured == row["mode"], (
            "the record says the linter measured %s for %s; this lane measures %s"
            % (measured, address, row["mode"]))

    # the record's own counts must be readable and non-zero, or the block is decoration
    counts = dict(line.split() for line in recorded if len(line.split()) == 2)
    assert int(counts["decided"]) == len(decided)
    assert int(counts["undecidable-hand-written"]) > 0, (
        "the record claims every plot was decidable. Every shipped compute is hand-written and "
        "spec section 11 forbids static analysis of it -- a zero here means the measurement is "
        "describing a tree that does not exist.")


def test_the_record_still_calls_the_decision_open_and_names_the_owner_question():
    """⚠️ THE MEASUREMENT DOES NOT RESOLVE THE DECISION, AND MUST NOT SAY IT DOES.

    The enumeration ledger reads this record's ``**Status:**`` header as a
    BICONDITIONAL against the code -- ``OPEN`` iff the badge is still a shared
    default no definition overrides and no plot carries. Task 7 measures and
    changes no badge, so ``OPEN`` is the true answer and this is the second lane
    that says so. A header flipped without a badge moving is red in two files.
    """
    md = io.open(RECORD_PATH, encoding="utf-8").read().replace("\r\n", "\n")
    status_lines = [line for line in md.split("\n") if line.startswith("**Status:**")]
    assert len(status_lines) == 1, status_lines
    tokens = [t for t in ("OPEN", "RESOLVED") if re.search(r"\b%s\b" % t, status_lines[0])]
    assert tokens == ["OPEN"], (
        "the record's status is not readable as exactly one token from the closed set, or the "
        "decision was resolved while Task 7 moved no badge: %r" % status_lines[0])
    assert "MEASURED" in status_lines[0], (
        "the header no longer says a measurement landed, so a reader who never scrolls past it is "
        "told the linter has not run")


# --------------------------------------------------------------------------- #
# the rail that kills a hand-copied fact
# --------------------------------------------------------------------------- #


def test_this_module_holds_no_second_copy_of_a_pinned_pad():
    """⛔ THE PAD IS READ, NEVER RE-TYPED -- ASSERTED OVER THIS FILE'S OWN AST.

    A hand-copied ``26`` is a SECOND DECLARATION of one fact. It is not wrong
    today; it rots the day the back-shift moves, and it rots GREEN, because the
    number it copied and the number it should have read were equal at the moment
    somebody typed it. That is the exact shape ``TRAILING_PAD``'s own comment
    exists to prevent -- *"change the back-shift and this goes red with the two
    numbers in hand"* -- and a test that copied the number would have taken that
    guarantee away one file over.

    ⚠️ A grep for the digits would find them in the corpus fixture's prose, in
    the record, and in this docstring. The question is which CONSTANTS this
    module holds, and only an AST can answer it.
    """
    pads = set(TRAILING_PAD.values())
    assert pads, "TRAILING_PAD is empty, so this rail is checking against nothing"
    tree = pyast.parse(pathlib.Path(__file__).read_text(encoding="utf-8"))
    copied = sorted(
        n.value for n in pyast.walk(tree)
        if isinstance(n, pyast.Constant)
        and not isinstance(n.value, bool)
        and isinstance(n.value, int)
        and n.value in pads
    )
    assert copied == [], (
        "this test module holds a literal %r, which is one of the pinned trailing pads. Read it "
        "from `TRAILING_PAD` instead: two declarations of one fact drift, and this one would drift "
        "in the direction that keeps passing." % copied)
    # …and the same in string form, because `"26"` is a hand-copy wearing a coat.
    copied_str = sorted(
        n.value for n in pyast.walk(tree)
        if isinstance(n, pyast.Constant) and isinstance(n.value, str) and n.value in {str(p) for p in pads}
    )
    assert copied_str == [], copied_str


def test_control_the_hand_copy_detector_finds_a_hand_copy():
    """Without this the rail above proves only that a set intersection is empty."""
    pad = sorted(TRAILING_PAD.values())[0]
    source = "PAD = %d\n" % pad
    found = [n.value for n in pyast.walk(pyast.parse(source))
             if isinstance(n, pyast.Constant) and isinstance(n.value, int) and n.value == pad]
    assert found == [pad]
