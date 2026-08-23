"""The concept vocabulary's gates.

⭐ WHAT THIS FILE IS FOR, IN ONE LINE: a generic model guesses what "trending"
means and guesses differently next Tuesday; these tests are what make UCT able
to answer with the FIRM'S definition and prove it is still the firm's.

Four properties, and each one has a control that makes it able to fail:

  1. **Every concept expands to a tree that parses.** Asserted in the JS lane,
     against the SHIPPED parser (`conceptVocabulary.test.js`) — there is no
     Python parser and there must never be one (D-A1). What this file asserts
     is the half Python can: every NAME in the frozen tree is declared in the
     closed table, DERIVED from `closedTable.json`, with a planted concept
     naming a lost name proving the rail can go red.
  2. **Every grounding is looked up, never trusted.** A preset the screener
     stopped shipping, a starter screen that was renamed, a classifier label
     that moved, a setup definition the firm reworded — each one refuses the
     concept BY NAME rather than shipping a word that expands into nothing.
  3. **No threshold in the vocabulary is the author's.** Every numeric literal
     in a concept's tree must be published by one of its own citations. This is
     the rail that separates "the firm's vocabulary" from "somebody's opinion
     in a JSON file", and the mutation is one character wide.
  4. **A word the firm cannot ground is refused BY NAME, never approximated.**
     With a real ungroundable phrase, and with nothing in the payload a member
     could mistake for a partial answer.

⚠️ MEASURED ENVIRONMENT, RECORDED RATHER THAN PATCHED AROUND: the Brain Pack is
NOT installed on this box, so `brain_service.available()` is False and the KB
half of an attribution is UNVERIFIED. `test_an_ATTRIBUTION_the_KB_REJECTS_makes
_the_concept_RED` injects a present-but-rejecting brain so the check is exercised
anyway, and `test_the_brain_pack_state_is_REPORTED_and_never_reads_as_a_PASS`
asserts an unverified attribution can never be mistaken for a verified one.

⛔ NO COUNT IS TYPED IN THIS FILE. Three count errors landed in this project's
own documents inside twenty-four hours, every one of them written by the party
with the most context. Everything here is derived from the artifact it checks.
"""
from __future__ import annotations

import copy
import io
import json
import pathlib
import re

import pytest

from api.services import ast_table, concept_vocabulary as cv


# --------------------------------------------------------------------------- #
# helpers — every one of them DERIVES from an artifact
# --------------------------------------------------------------------------- #

def _raw():
    """A mutable copy of the shipped vocabulary, read from the same file.

    The module's `VOCAB` is deep-frozen on purpose; a planted-vocabulary control
    needs to edit one, so it reads the bytes again rather than unfreezing.
    """
    with io.open(cv.VOCAB_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _raw_table():
    with io.open(ast_table.MANIFEST_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _tree_of(source_word, vocab=None):
    return (vocab or _raw())["concepts"][source_word]["ast"]


def _root_yields(tree, table=None):
    """What the manifest says the ROOT of this tree can produce.

    ⛔ THIS IS NOT `scan_definition.is_boolean_tree` AND MUST NOT GROW INTO IT.
    E-2 owns the one Python derivation of a tree's kind; this is a TEST reading
    `yields_of` for the root of a hand-curated two-or-three-node abbreviation, so
    that the vocabulary cannot ship a word that screens on a number. When E-2's
    function exists, this collapses into a call to it.
    """
    kind = tree.get("type")
    if kind == "num":
        return "num"
    name = tree.get("name")
    try:
        answer = ast_table.yields_of(name, table)
    except KeyError:  # a bar series: the manifest declares no `yields` for one
        return "num"
    if answer != "passthrough":
        return answer
    branches = {_root_yields(a, table) for a in (tree.get("args") or ())[1:]}
    return "bool" if branches == {"bool"} else "num"


# --------------------------------------------------------------------------- #
# 1. the expansion is legal, and every name in it is the table's
# --------------------------------------------------------------------------- #

def test_every_NAME_a_concept_expands_into_is_DECLARED_in_the_closed_table():
    """⛔ DERIVED FROM `closedTable.json`, NEVER HAND-LISTED. A concept
    referencing a name the table lost must go red here rather than at a member's
    save door, which is the worst possible moment to discover it.

    ⚠️ The `source` half of this — that the text actually PARSES — belongs to
    the JS lane and the shipped parser. `rsi(close,14) < 30` parses perfectly
    well and refuses at `resolve:function`; only the table can say so.
    """
    declared = ast_table.declared_names()
    assert declared, "the closed table declared nothing; this rail would pass vacuously"
    for word, spec in cv.concepts().items():
        reached = cv.names_in(spec["ast"])
        assert reached, f"{word}: its tree names nothing at all"
        assert reached <= declared, (word, sorted(reached - declared))


def test_a_PLANTED_concept_naming_a_name_THE_TABLE_LOST_goes_RED():
    """⚠️ THE CONTROL, and without it the rail above is a rail over nothing.

    Two plants, because the rail has two ways to be vacuous: a name the table
    never declared, and a name the table USED to declare and dropped — which is
    the direction that actually happens, and the one a hand-list can never see.

    🔴 THE FIRST PLANT IS DERIVED, AND THIS CASE IS WHY. It used to be the
    literal `rsi` — "the function CORRECTION 1 was written about" — and Phase F
    DECLARED `rsi`, so the plant stopped being undeclared: `resolve` sailed past
    the ungrounded gate and died at a later one, which is a rail overtaken by the
    thing it watches. The subject is now the first entry of the manifest's own
    `_functions_excluded`, the register of indicators the chart draws and a
    formula may not call, so declaring one MOVES this plant to the next refusal
    instead of quietly emptying it.
    """
    refused = sorted(k for k in _raw_table().get("_functions_excluded", {})
                     if not k.startswith("_"))
    assert refused, "the manifest refuses no indicator by name — this plant has no subject"
    assert not (set(refused) & set(_raw_table()["functions"])), (
        "a name is BOTH declared and listed as refused; the register is lying"
    )
    undeclared = refused[0]

    planted = _raw()
    planted["concepts"]["zzplanted"] = {
        "source": f"{undeclared}(close, 14) < 30",
        "ast": {"type": "op", "name": "<", "args": [
            {"type": "call", "name": undeclared, "args": [
                {"type": "series", "name": "close"}, {"type": "num", "value": 14}]},
            {"type": "num", "value": 30}]},
        "grounding": [{"kind": "scalar", "column": "rsi14"}],
    }
    out = cv.resolve("zzplanted", vocab=planted)
    assert out["ok"] is False and out["gate"] == cv.GATE_UNGROUNDED
    assert undeclared in out["reason"], out["reason"]

    # …and a name the table DROPS takes a shipped concept down with it.
    shrunk = _raw_table()
    del shrunk["scalars"]["rs_rank"]
    lost = cv.resolve("leader", table=shrunk)
    assert lost["ok"] is False, "a concept survived the table losing the name it screens on"
    assert "rs_rank" in lost["reason"]
    # The control on the control: with the real table, the same word resolves.
    assert cv.resolve("leader")["ok"] is True


def test_every_concept_is_a_CONDITION_by_the_MANIFESTS_OWN_yields():
    """⭐ A SCAN IS `<ast> != 0` (E-A1), so a concept that expands into a NUMBER
    is a perfectly good indicator and a wrong answer to "find me stocks where…".
    `sma(close,20) != 0` is true for every symbol on the board.

    Derived from the manifest's `yields` (CORRECTION 2), never from a list of
    comparison operators typed here.
    """
    for word, spec in cv.concepts().items():
        assert _root_yields(spec["ast"]) == "bool", (
            f'"{word}" expands into a number, not a condition: {spec["source"]}')

    # The control: the derivation can say `num`, or the loop above is a tautology.
    assert _root_yields({"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}) == "num"


# --------------------------------------------------------------------------- #
# 2. the grounding is resolved, not claimed
# --------------------------------------------------------------------------- #

def test_EVERY_concept_RESOLVES_and_the_grounding_is_LOOKED_UP_not_claimed():
    """🔴 AMENDMENT 1 §A1.3, made mechanical. The moat is that UCT's answer comes
    from the firm's own assets; a "grounding" nobody verifies is a comment.

    Every citation is resolved against the artifact it names — a preset in the
    screener's filter registry, a screen the screener ships, a column the closed
    table declares, or a labelled branch of firm code located by AST.
    """
    report = cv.grounding_report()
    assert report["concepts"], "the vocabulary is empty; every rail here is vacuous"
    assert report["unresolved"] == [], report
    for row in report["concepts"]:
        assert row["kinds"], row
        assert set(row["kinds"]) <= set(cv.GROUNDING_KINDS), row
        assert row["cites"], f"{row['word']} resolved to no citation detail"


@pytest.mark.parametrize("field,bad", [("preset", "Over 999"), ("key", "zz_no_such_filter")])
def test_a_PRESET_CITATION_THAT_STOPS_RESOLVING_refuses_the_concept_BY_NAME(field, bad):
    """⛔ THE FIRM'S THRESHOLDS MOVE, AND WHEN THEY DO THIS FILE MUST NOTICE.
    Retuning `rs_rank`'s preset or renaming the filter must not leave a concept
    quoting a number nobody publishes any more.
    """
    planted = _raw()
    planted["concepts"]["leader"]["grounding"][0][field] = bad
    out = cv.resolve("leader", vocab=planted)
    assert out["ok"] is False and out["gate"] == cv.GATE_UNGROUNDED
    assert bad in out["reason"], out["reason"]
    assert "source" not in out and "ast" not in out


def test_a_CLASSIFIER_LABEL_THAT_MOVED_refuses_the_concept():
    """⭐ "trending" QUOTES FIRM CODE, and the citation is what keeps the two in
    step. `ma_stack` is a TEXT column and therefore excluded from the closed
    table, so the concept has to say the comparison chain that PRODUCES the
    `full-bull` label rather than naming the column — and a rename of that label
    is exactly the drift this citation exists to catch.
    """
    planted = _raw()
    planted["concepts"]["trending"]["grounding"][0]["label"] = "zz-not-a-label"
    out = cv.resolve("trending", vocab=planted)
    assert out["ok"] is False
    assert "zz-not-a-label" in out["reason"]

    planted2 = _raw()
    planted2["concepts"]["trending"]["grounding"][0]["function"] = "zz_gone"
    assert cv.resolve("trending", vocab=planted2)["ok"] is False


def test_an_UNKNOWN_GROUNDING_KIND_refuses_rather_than_being_IGNORED():
    """⛔ A FIFTH KIND IS A DECISION about what counts as the firm's answer, not
    an implementation detail. A reader that skipped kinds it did not recognise
    would let an unresolvable citation ship as a grounded one.
    """
    planted = _raw()
    planted["concepts"]["leader"]["grounding"] = [{"kind": "vibes", "why": "it feels right"}]
    out = cv.resolve("leader", vocab=planted)
    assert out["ok"] is False and "vibes" in out["reason"]


def test_a_concept_with_NO_CITATION_AT_ALL_is_refused():
    """An uncited concept is an opinion in a JSON file wearing the firm's name."""
    planted = _raw()
    planted["concepts"]["leader"]["grounding"] = []
    assert cv.resolve("leader", vocab=planted)["ok"] is False


# --------------------------------------------------------------------------- #
# 2b. the FIFTH kind: the firm's own PUBLISHED DEFINITION of a setup
# --------------------------------------------------------------------------- #
#
# ⭐⭐ WHAT THIS SECTION IS DEFENDING, because a fifth citation kind is the exact
# shape of a weakened gate and has to be read as one until proven otherwise.
# `setup_catalog` exists for a tree that states NO NUMBER: the four older kinds
# all answer "who published this threshold?", and a literal-free formula has no
# threshold for them to discharge. What it does assert is an IDENTITY — this
# shape is that setup — and the artifact that can vouch for an identity is the
# firm's own written definition, which it publishes in the Setup Library and
# shows to members.
#
# ⛔ SO THE TWO PROPERTIES THAT KEEP IT FROM BEING A LOOPHOLE ARE ASSERTED FIRST
# AND HARDEST: it publishes NOTHING (so a definition can never launder a number
# or a column), and it names no setup of its own (so a starter cannot be
# grounded in a different setup's definition than the one it is filed under).
#
# ⛔ AND EVERY SUBJECT BELOW IS DERIVED FROM `setupCatalog.js`. A test that typed
# a setup name and a quoted phrase would keep passing after the firm reworded
# the definition it claims to be checking — which is the precise staleness this
# kind exists to catch.


def _defs():
    return cv.setup_definitions()


def _subject():
    """A setup the firm publishes a definition AND a trigger level for."""
    for name in sorted(_defs()):
        if _defs()[name]["pivot"]:
            return name
    pytest.fail("no published definition carries a pivot; the level check has "
                "no subject and would pass vacuously")


def _shared_phrase():
    """A word from the SUBJECT'S definition that also describes another setup.

    ⛔ DERIVED, because the discrimination control cannot be a typed word: the
    day the catalogue's prose moves, a typed collision quietly stops colliding
    and the control passes for the wrong reason — a generic phrase would then be
    sailing through the very check this proves is real.
    """
    defs = _defs()
    mine = cv._prose(defs[_subject()]["essence"])
    others = {n: cv._prose(e["essence"]) for n, e in defs.items() if n != _subject()}
    counts = {word: sum(1 for text in others.values() if word in text)
              for word in sorted(set(re.findall(r"[a-z]{4,}", mine)))}
    counts = {w: n for w, n in counts.items() if n}
    assert counts, ("no word in this setup's published definition describes any "
                    "other setup; the collision control has no subject")
    return max(sorted(counts), key=lambda w: counts[w])


#: A literal-free, scalar-free condition over two bar series — the CLASS of tree
#: this kind exists for, and the reason it is written here rather than lifted
#: from a starter: this file's subject is the resolver, not the catalogue.
_SHAPE = {"type": "op", "name": ">", "args": [{"type": "series", "name": "close"},
                                              {"type": "series", "name": "open"}]}


def _cite(subject=None, **over):
    entry = _defs()[subject or _subject()]
    cite = {"kind": "setup_catalog", "direction": entry["direction"],
            "level": entry["pivot"], "describes": [entry["essence"]]}
    cite.update(over)
    return cite


def _ground(cite=None, *, setup=..., tree=None):
    subject = _subject() if setup is ... else setup
    return cv.resolve_grounding(
        tree or _SHAPE, [cite if cite is not None else _cite()],
        attribution={"setup": subject} if subject else None)


def test_the_SETUP_LIBRARY_reader_is_DERIVED_and_REFUSES_TO_READ_NOTHING(tmp_path):
    """⛔ `firm_setups`' rule, and its reason. A reader that returned an empty
    mapping when the file moved would make every definition citation refuse with
    "the Setup Library publishes no definition of X" — a red that names the
    setup when the fault is the path, and one somebody would act on by deleting
    a perfectly good starter."""
    defs = _defs()
    assert defs, "the Setup Library read as empty; every check here is vacuous"
    for name, entry in defs.items():
        assert entry["name"] == name
        assert entry["essence"].strip() and entry["direction"].strip()
        assert entry["family"].strip()

    with pytest.raises(FileNotFoundError):
        cv.setup_definitions(tmp_path / "nope.js")
    empty = tmp_path / "setupCatalog.js"
    with io.open(empty, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("export const SETUP_CATALOG = [\n]\n")
    with pytest.raises(ValueError, match="no setup definitions"):
        cv.setup_definitions(empty)
    halfread = tmp_path / "half.js"
    with io.open(halfread, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("export const SETUP_CATALOG = [\n"
                 "  {\n    name: 'Zzz',\n    family: 'Nowhere',\n"
                 "    direction: 'long',\n  },\n]\n")
    with pytest.raises(ValueError, match="essence"):
        cv.setup_definitions(halfread)


def test_a_DEFINITION_grounds_a_LITERAL_FREE_tree_and_PUBLISHES_NOTHING():
    """⭐ THE WHOLE POINT, AND THE HALF THAT KEEPS IT HONEST IN ONE ASSERTION.

    The citation resolves — and it hands back NO values and NO columns, so a
    definition can vouch for a shape and can never be the thing that publishes a
    number. The detail it carries is the firm's OWN English, not a phrase this
    resolver composed.
    """
    got = _ground()
    assert got["ok"] is True, got.get("detail")
    (cite,) = got["grounding"]
    assert cite["kind"] == "setup_catalog"
    assert cite["values"] == set() and cite["keys"] == set()
    assert _defs()[_subject()]["essence"] in cite["detail"]
    assert _subject() in cite["detail"]


def test_a_DEFINITION_CANNOT_LAUNDER_A_NUMBER_or_a_COLUMN():
    """⛔⛔ THE LOOPHOLE THIS KIND WOULD BE IF IT PUBLISHED ANYTHING.

    A definition is prose; if citing one made a tree "grounded" outright, every
    invented threshold in the repo could be shipped under a setup name. It
    cannot: the two rails that follow the citation loop draw on what the
    citations PUBLISH, and this one publishes an empty set — so a tree carrying
    any number, or screening on any table-declared scalar, is refused NAMING it
    even though its definition citation resolved perfectly.
    """
    numbered = copy.deepcopy(_SHAPE)
    numbered["args"][1] = {"type": "num", "value": 42}
    out = _ground(tree=numbered)
    assert out["ok"] is False and "42" in out["detail"], out

    columned = {"type": "op", "name": "&&", "args": [
        copy.deepcopy(_SHAPE), {"type": "series", "name": "above_50sma"}]}
    out = _ground(tree=columned)
    assert out["ok"] is False and "above_50sma" in out["detail"], out


def test_a_DEFINITION_citation_NAMES_NO_SETUP__it_reads_the_ATTRIBUTION():
    """⛔ A `setup` FIELD ON THE CITATION WOULD BE THE WHOLE DEFECT.

    A starter's attribution is its catalogue entry's own KEY, so resolving
    against the attributed name makes it structurally impossible to file a
    starter under one setup and ground it in another's definition. Here the
    citation is handed a DIFFERENT setup's name and it changes nothing — the
    resolution still follows the attribution — and with no attribution at all
    the citation refuses rather than picking one.
    """
    other = sorted(set(_defs()) - {_subject()})[0]
    honest = _ground()
    smuggled = _ground(_cite(**{"setup": other}))
    assert smuggled["ok"] is True
    assert smuggled["grounding"][0]["detail"] == honest["grounding"][0]["detail"]
    assert other not in smuggled["grounding"][0]["detail"]

    orphan = _ground(setup=None)
    assert orphan["ok"] is False and "attributed to no setup" in orphan["detail"]


def test_a_DEFINITION_the_SETUP_LIBRARY_DOES_NOT_PUBLISH_is_REFUSED_BY_NAME():
    """⚠️ THE NON-VACUITY CONTROL, AND IT HAS A REAL SUBJECT ON THIS BOX.

    The firm's two setup files do not agree: `setupGroups.js` names setups the
    Setup Library publishes no definition for. A citation for one of those has
    nothing to quote and must refuse NAMING it — which is exactly what keeps a
    literal-free tree for such a setup out of the library rather than letting
    "it has no numbers" read as "it needs no grounding".
    """
    unpublished = sorted(cv.firm_setups() - set(_defs()))
    assert unpublished, (
        "every setup the taxonomy names now has a published definition — this "
        "control has no subject, and every refusal leaning on the gap needs "
        "re-adjudicating")
    victim = unpublished[0]
    out = cv.resolve_grounding(
        _SHAPE, [{"kind": "setup_catalog", "direction": "long",
                  "describes": ["anything at all"]}],
        attribution={"setup": victim})
    assert out["ok"] is False
    assert victim in out["detail"] and "publishes no definition" in out["detail"]


def test_a_REWORDED_definition_takes_the_citation_DOWN_WITH_IT():
    """⭐ THE MECHANICAL GUARANTEE, STATED EXACTLY. Nothing here proves the
    quoted words MEAN the tree — that is a review judgement, as it is for every
    other kind. What IS proven is the negative: the phrases must still be in the
    firm's published definition, verbatim, or the citation refuses and somebody
    re-reads the pair."""
    out = _ground(_cite(describes=["zz the firm never wrote this"]))
    assert out["ok"] is False
    assert "zz the firm never wrote this" in out["detail"]
    assert "no longer says" in out["detail"]

    # ⚠️ …and the fold is EXACTLY as wide as the smart-quote problem. The
    # artifact writes `day’s` with U+2019; an ASCII apostrophe must still match,
    # and nothing beyond quotes, dashes, case and whitespace may.
    entry = _defs()[_subject()]
    ascii_quoted = entry["essence"].replace("’", "'").replace("—", "-")
    assert _ground(_cite(describes=[ascii_quoted.upper()]))["ok"] is True
    assert _ground(_cite(describes=[entry["essence"].replace("e", "3")]))["ok"] is False


def test_a_DEFINITION_citation_must_SINGLE_ITS_SETUP_OUT():
    """⭐⭐ THE TOOTH THAT SEPARATES A DEFINITION FROM A WORD-MENTION.

    "The catalogue mentions this setup" is worth nothing — the whole objection to
    grounding a shape in prose is that prose is loose. So the phrases a citation
    quotes must describe THIS setup and no other one the firm publishes, and the
    refusal names the setups it collides with. The colliding phrase is DERIVED
    from the catalogue, so it cannot stop colliding while the test goes on
    passing.
    """
    generic = _shared_phrase()
    out = _ground(_cite(describes=[generic]))
    assert out["ok"] is False, f"{generic!r} described more than one setup and passed"
    assert "do not single" in out["detail"]
    others = [n for n, e in _defs().items()
              if n != _subject() and cv._prose(generic) in cv._prose(e["essence"])]
    assert others and all(n in out["detail"] for n in others), (others, out["detail"])

    # …and quoting NOTHING is its own refusal: a citation that only asserts the
    # name exists says nothing whatever about the shape being screened.
    for nothing in ([], ["   "], None):
        out = _ground(_cite(describes=nothing))
        assert out["ok"] is False and "quotes nothing" in out["detail"], nothing


def test_the_DIRECTION_and_the_TRIGGER_LEVEL_are_the_FIRMS_and_are_CHECKED():
    """A setup the firm re-classifies, or re-draws, takes a tree written for the
    old reading down with it. Both claims are one word wide and both go red."""
    entry = _defs()[_subject()]
    wrong = {"long": "short", "short": "long", "both": "long"}[entry["direction"]]
    out = _ground(_cite(direction=wrong))
    assert out["ok"] is False and wrong in out["detail"] and entry["direction"] in out["detail"]

    # …and an UNSTATED direction is not a pass — a citation must make the claim.
    out = _ground(_cite(direction=None))
    assert out["ok"] is False

    levels = {"h", "l", "c"} - {entry["pivot"]}
    out = _ground(_cite(level=sorted(levels)[0]))
    assert out["ok"] is False and "trigger line" in out["detail"]
    # The level is the one optional claim (a published definition need not carry
    # a glyph pivot), so omitting it resolves — and stating it wrongly does not.
    assert _ground(_cite(level=None))["ok"] is True


# --------------------------------------------------------------------------- #
# 3. no threshold in the vocabulary is the author's
# --------------------------------------------------------------------------- #

def test_NO_NUMBER_IN_A_CONCEPTS_TREE_IS_THE_AUTHORS():
    """⭐⭐ THE RAIL THAT MAKES THIS A VOCABULARY RATHER THAN AN OPINION.

    Every numeric literal in every concept's tree must be published by one of
    that concept's own citations — the firm's preset, the firm's screen, the
    firm's classifier windows, or the 0/1 of a boolean column. `rs_rank >= 80`
    is here because `FILTERS['rs_rank']` ships a preset labelled `Over 80`.

    ⛔ AND THE SCALARS TOO. A concept that quietly added a fourth column to a
    three-filter screen would keep every threshold honest and still screen on
    something nobody cited.
    """
    for word in cv.concepts():
        got = cv.resolve(word)
        assert got["ok"] is True, (word, got.get("reason"))
        published = set()
        cited_keys = set()
        for c in got["grounding"]:
            published |= c["values"]
            cited_keys |= c["keys"]
        assert cv.literals_in(got["ast"]) <= published, (word, got["source"])
        assert cv.scalars_in(got["ast"]) <= cited_keys, (word, got["source"])


def test_a_ONE_CHARACTER_RETUNE_of_a_threshold_goes_RED():
    """⚠️ THE MUTATION THIS FILE EXISTS FOR, and it is one character wide.

    `rs_rank >= 80` becomes `>= 75`. 75 is a plausible number, it is a number a
    reviewer would nod at, and it is nobody's published threshold — so the check
    must name it rather than shrug.
    """
    planted = _raw()
    tree = planted["concepts"]["leader"]["ast"]
    assert tree["args"][1]["value"] == 80, "the fixture moved; re-derive it"
    tree["args"][1]["value"] = 75
    out = cv.resolve("leader", vocab=planted)
    assert out["ok"] is False and out["gate"] == cv.GATE_UNGROUNDED
    assert "75" in out["reason"], out["reason"]
    # The control: put it back and the same word resolves through the same path.
    tree["args"][1]["value"] = 80
    assert cv.resolve("leader", vocab=planted)["ok"] is True


def test_a_concept_that_screens_on_an_UNCITED_column_is_refused():
    """⛔ THE OTHER HALF OF THE SAME RAIL, and the one a threshold check misses.

    A fourth column quietly added to a three-filter screen keeps every number
    honest and still screens on something nobody at the firm agreed to. The
    plant uses a BARE boolean column so it carries no literal at all — the
    threshold rail cannot see it, and only the citation-keys rail can.
    """
    planted = _raw()
    leader = planted["concepts"]["leader"]
    leader["ast"] = {"type": "op", "name": "&&", "args": [
        leader["ast"], {"type": "series", "name": "above_50sma"}]}
    out = cv.resolve("leader", vocab=planted)
    assert out["ok"] is False and out["gate"] == cv.GATE_UNGROUNDED
    assert "above_50sma" in out["reason"], out["reason"]
    # The control: the same column IS cited by the screen-grounded concept, and
    # that one resolves — so the rail is about the citation, not the column.
    assert cv.resolve("leaders pulling back")["ok"] is True


def test_a_NEGATIVE_threshold_is_matched_WITH_ITS_SIGN():
    """⚠️ `-5` CANONICALISES TO `u-` OVER `num 5`, so a naive literal walk reports
    `5` and would happily accept `dist_52w_high_pct >= 5` — the sign error that
    turns "within 5% of the high" into "5% ABOVE the high", i.e. nothing.
    """
    assert cv.literals_in(_tree_of("near its highs")) == {-5.0}
    planted = _raw()
    planted["concepts"]["near its highs"]["ast"]["args"][1] = {"type": "num", "value": 5}
    out = cv.resolve("near its highs", vocab=planted)
    assert out["ok"] is False and "5.0" in out["reason"]


# --------------------------------------------------------------------------- #
# 4. refusal by name, never an approximation
# --------------------------------------------------------------------------- #

def test_an_UNGROUNDABLE_word_is_REFUSED_BY_NAME_and_NEVER_APPROXIMATED():
    """🔴 AMENDMENT 1 consequence 3, with a real ungroundable phrase.

    "cheap" has no defensible definition here: the firm's own screen that uses
    the word bundles a forward-P/E ceiling with an ROE floor and an EPS-growth
    floor, so the word alone does not say which multiple — and inventing one is
    spec §1.6's "unmeasured accuracy claims" wearing a helpful face.

    ⛔ A WRONG SCAN THAT LOOKS RIGHT IS WORSE THAN A REFUSAL, and the refusal
    NAMES THE WORD so a member can say what they meant instead of being handed
    somebody's guess.
    """
    out = cv.resolve("cheap")
    assert out["ok"] is False
    assert out["gate"] == cv.GATE_AMBIGUOUS
    assert "cheap" in out["reason"]
    assert "source" not in out and "ast" not in out   # not even a partial expansion


def test_EVERY_declared_refusal_NAMES_ITS_OWN_WORD():
    """A refusal that says "that is ambiguous" tells a member nothing. Every
    reason in the file repeats the word it is refusing."""
    declined = cv.refused()
    assert declined, "nothing is refused; this vocabulary claims it can ground anything"
    for word, reason in declined.items():
        assert word in reason.lower(), (word, reason)
        assert len(reason) > 40, (word, reason)


def test_a_word_the_vocabulary_NEVER_HEARD_OF_is_a_DIFFERENT_refusal_and_still_named():
    """⭐ TWO GATES, DISJOINT ON PURPOSE. "we decided not to guess at this" and
    "we have never seen this word" are different answers, and a member deserves
    to know which one they hit."""
    out = cv.resolve("zzz never seen this")
    assert out["ok"] is False
    assert out["gate"] == cv.GATE_UNGROUNDED
    assert "zzz never seen this" in out["reason"]
    assert cv.GATE_AMBIGUOUS != cv.GATE_UNGROUNDED


def test_the_REFUSED_list_and_the_CONCEPT_list_are_DISJOINT():
    """A word that is both grounded and refused would resolve or refuse
    depending on lookup order, which is the worst of both."""
    assert not (set(cv.refused()) & set(cv.concepts()))


def test_the_vocabularys_own_KEYS_are_NORMALISED_so_two_spellings_cannot_drift():
    for word in cv.concepts():
        assert word == cv.normalise(word), word
    for word in cv.refused():
        assert word == cv.normalise(word), word
    assert cv.resolve("  Leaders   Pulling BACK ")["ok"] is True


# --------------------------------------------------------------------------- #
# the word is provenance; the tree is the definition
# --------------------------------------------------------------------------- #

def test_the_EXPANSION_IS_THE_TREE_and_the_WORD_IS_ONLY_PROVENANCE():
    """🔴 AMENDMENT 1 consequence 1 — VERSIONING, made structural.

    A resolved concept hands back a TREE, by value. Nothing in that tree names
    the concept, so a caller that stores it stores maths rather than a late
    binding to a vocabulary that moves. If "trending" is redefined next quarter,
    every scan saved against today's definition keeps today's maths and today's
    `def_hash` — the only reading under which a saved scan still means what its
    author confirmed.
    """
    got = cv.resolve("trending")
    blob = json.dumps(got["ast"])
    assert "concept" not in blob and "trending" not in blob

    # …and redefining the word does NOT reach an expansion already taken.
    taken = copy.deepcopy(got["ast"])
    moved = _raw()
    moved["version"] = "9999-01-01.1"
    moved["concepts"]["trending"]["source"] = "close > sma(close, 200)"
    moved["concepts"]["trending"]["ast"] = {"type": "op", "name": ">", "args": [
        {"type": "series", "name": "close"},
        {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 200}]}]}
    after = cv.resolve("trending", vocab=moved)
    assert after["ast"] != taken, "the fixture did not actually move the definition"
    assert taken == got["ast"], "an already-expanded tree changed when the file did"
    assert after["version"] != got["version"], (
        "the definition moved and the version did not — a silent edit is exactly "
        "what a versioned vocabulary exists to prevent")


def test_the_SENTENCE_resolve_HANDS_BACK_IS_THE_FILES_OWN_BYTES():
    """⛔ THIS LANE HAS NO READ-BACK AND MUST NEVER GROW ONE.

    `sentence.js` is the ONE producer of the text a member confirms, and the JS
    lane re-derives every frozen sentence from the shipped module on every run.
    What Python can guarantee is the other half: that `resolve` is a
    PASS-THROUGH — no prettifying, no title-casing, no fallback to the word, no
    synthesised text for a concept that carries none. Any of those would be the
    second vocabulary this whole design exists to prevent, arriving through the
    lane that cannot check itself.

    ⛔ AND IT SAYS NOTHING ABOUT WHICH CONCEPTS HAVE ONE. Whether a tree is
    sayable is `sentence.js`'s answer; a rule here that "every concept carries a
    sentence" would be a SECOND AUTHORITY over a value another module owns, and
    would go red for the wrong reason the day the read-back legitimately refuses
    something.
    """
    raw = _raw()["concepts"]
    for word in cv.concepts():
        got = cv.resolve(word)
        assert got["ok"] is True, (word, got.get("reason"))
        assert got["sentence"] == raw[word].get("sentence"), word

    # ⚠️ THE CONTROL, because the loop above is satisfied by `None == None`.
    # A planted sentence must come back verbatim — bytes the reader could only
    # have got from the file it was handed.
    planted = _raw()
    marker = "ZZ 1 when the planted phrase is read verbatim and 0 otherwise"
    planted["concepts"]["leader"]["sentence"] = marker
    assert cv.resolve("leader", vocab=planted)["sentence"] == marker


def test_the_RESOLUTION_carries_the_VERSION_so_the_word_can_be_recorded_as_provenance():
    got = cv.resolve("coiled")
    assert got["version"] == cv.version() == cv.load()[cv.VOCAB_VERSION_KEY]
    assert got["word"] == "coiled"


def test_a_vocabulary_with_NO_VERSION_is_REFUSED_BY_THE_READER(tmp_path):
    """⛔ WITHOUT A VERSION, A DEFINITION CHANGE IS NOT AN EVENT. A reader that
    tolerated a missing one would make rule 4 unenforceable everywhere else."""
    doc = _raw()
    doc.pop("version")
    p = tmp_path / "v.json"
    with io.open(p, "w", encoding="utf-8") as fh:
        json.dump(doc, fh)
    with pytest.raises(ValueError, match="version"):
        cv.load(p)
    with pytest.raises(FileNotFoundError):
        cv.load(tmp_path / "nope.json")


# --------------------------------------------------------------------------- #
# attribution: the second attestation, and it is never a pass by default
# --------------------------------------------------------------------------- #

def test_every_ATTRIBUTION_names_a_setup_the_FIRMS_OWN_TAXONOMY_declares():
    """⛔ DERIVED FROM `setupGroups.js`, AND THE COUNT IS NEVER RESTATED.
    AMENDMENT 2 said "31 named setups across 4 families", corrected itself, and
    conflated two separate files while doing it."""
    setups = cv.firm_setups()
    assert setups, "the taxonomy read as empty; this rail would pass vacuously"
    attributed = {spec["attribution"]["setup"]
                  for spec in cv.concepts().values() if spec.get("attribution")}
    assert attributed, "nothing is attributed; the taxonomy half of the moat is unused"
    assert attributed <= setups, sorted(attributed - setups)


def test_an_ATTRIBUTION_TO_A_NON_SETUP_goes_RED():
    planted = _raw()
    planted["concepts"]["coiled"]["attribution"] = {"setup": "Vibes Reversal"}
    out = cv.resolve("coiled", vocab=planted)
    assert out["ok"] is False and "Vibes Reversal" in out["reason"]


def test_an_ATTRIBUTION_THE_KB_REJECTS_makes_the_concept_RED(monkeypatch):
    """⛔ M10: `resolve` must CALL `lookup_playbook`, not trust the word.

    ⚠️ MEASURED: the Brain Pack is NOT installed on this box, so the live call
    cannot fail here. That is a property of the box, not of the check — so the
    check is exercised against an injected brain that IS present and DOES
    reject, which is the state a rotted KB key produces in production.
    """
    from api.services import brain_service

    calls = []

    def _rejecting(setup):
        calls.append(setup)
        return {"ok": False, "reason": f"no setup template named '{setup}'"}

    monkeypatch.setattr(brain_service, "available", lambda: True)
    monkeypatch.setattr(brain_service, "lookup_playbook", _rejecting)

    out = cv.resolve("coiled")
    assert calls, "the KB was never consulted — the attribution was trusted"
    assert out["ok"] is False
    assert "VCP" in out["reason"]

    # The control, through the same injection: a brain that ANSWERS lets it pass
    # and records the verification, so the red above is the rejection and not
    # merely the presence of a brain.
    monkeypatch.setattr(brain_service, "lookup_playbook",
                        lambda s: {"ok": True, "name": s, "source": f"setup template: {s}"})
    ok = cv.resolve("coiled")
    assert ok["ok"] is True and ok["attribution"]["playbook_verified"] is True


def test_the_BRAIN_PACK_state_is_REPORTED_and_never_reads_as_a_PASS():
    """⚠️ `brain_service` NEVER RAISES — it returns `{"ok": False, "error":
    "brain not available"}`. So an uninstalled pack must produce `None`
    (UNVERIFIED) and never `True`; a tri-state that collapsed to a boolean would
    make "we could not check" indistinguishable from "we checked".
    """
    from api.services import brain_service
    for row in cv.grounding_report()["concepts"]:
        if row["attribution"] is None:
            assert row["playbook_verified"] is None
        elif not brain_service.available():
            assert row["playbook_verified"] is None, (
                f"{row['word']} claims a KB-verified playbook on a box with no "
                "Brain Pack installed")


# --------------------------------------------------------------------------- #
# §1.6 — a win rate is a claim, and no number reaches a surface
# --------------------------------------------------------------------------- #

def test_NO_WINRATE_REACHES_THE_DATA_OR_ANYTHING_resolve_RETURNS():
    """⛔ AMENDMENT 1 consequence 4 + design §8.3 (OPEN). A win rate is a CLAIM
    subject to §1.6 and to E-6's record. Until E-6 can back it, the vocabulary
    carries the PROVENANCE — which playbook a concept is attributed to — and
    never a rate. A number on a surface gets screenshotted.

    ⚠️ THE SCAN IS ON THE CONCEPT DATA AND ON WHAT `resolve` HANDS BACK, NOT ON
    THE FILE'S PROSE. The manifest's own notes name `setup_winrate` while
    explaining why no number may ship, and its citations quote the firm's preset
    LABELS (`Up >3%`, `Within 5%`) — which are thresholds, not accuracy claims.
    A rail that forbade the file from stating its own rule, or forbade a
    threshold from being a percentage, would be measuring the wrong artifact.
    """
    data = json.dumps({"concepts": _raw()["concepts"], "refused": _raw()["_refused"]})
    payload = json.dumps([cv.resolve(w) for w in cv.concepts()], default=str)
    for blob, what in ((data, "the concept data"), (payload, "a resolution")):
        low = blob.lower()
        for token in ("winrate", "win_rate", "win rate", "hit rate", "success rate"):
            assert token not in low, (what, token)


def test_the_MODULE_NEVER_CALLS_setup_winrate__BY_AST():
    """⛔ STRUCTURAL, BECAUSE THE VALUE SCAN ABOVE ONLY SEES WHAT TODAY'S DATA
    PRODUCES. `brain_service.setup_winrate` is the function whose whole output is
    the claim §8.3 has not yet decided how to phrase, and the honest guarantee is
    that this module never asks for it at all.

    AST, not grep: a grep matches the word in the docstring that explains the
    rule, which is how a control-audit grep reads green by construction.
    """
    import ast as pyast
    src = pathlib.Path(cv.__file__).read_text(encoding="utf-8")
    called = {pyast.unparse(n.func) for n in pyast.walk(pyast.parse(src))
              if isinstance(n, pyast.Call)}
    assert not any(c.endswith("setup_winrate") for c in called), sorted(called)
    # The control: the walk does see the call this module DOES make to the KB.
    assert any(c.endswith("lookup_playbook") for c in called), sorted(called)


def test_a_WINRATE_ARRIVING_FROM_THE_KB_DOES_NOT_LEAK_INTO_THE_RESOLUTION(monkeypatch):
    """⚠️ THE CONTROL, AND THE REALISTIC LEAK. Nobody types a percentage into the
    vocabulary; what happens is `lookup_playbook`'s answer — which carries a
    `winrate` field — being spread into the payload by a well-meaning
    `**answer`. So the brain is made to return one, loudly.
    """
    from api.services import brain_service
    monkeypatch.setattr(brain_service, "available", lambda: True)
    monkeypatch.setattr(brain_service, "lookup_playbook", lambda s: {
        "ok": True, "name": s, "winrate": 0.61, "win_rate_pct": "61%",
        "source": f"setup template: {s}"})

    payload = json.dumps(cv.resolve("coiled"), default=str)
    assert "winrate" not in payload.lower() and "61" not in payload, payload
    assert re.findall(r"\d+(?:\.\d+)?\s*%", payload) == [], payload
    # …and the control on the control: the fixture really did carry one.
    assert "61%" in json.dumps(brain_service.lookup_playbook("VCP"))


# --------------------------------------------------------------------------- #
# the review artifact
# --------------------------------------------------------------------------- #

def test_grounding_report_is_TOTAL_over_the_vocabulary_and_names_the_unresolved():
    """⭐ THE ARTIFACT A REVIEW READS: every word, what it means, and what makes
    that the firm's answer. Total over the file, so a concept cannot be reviewed
    by being left out of the report."""
    report = cv.grounding_report()
    assert {r["word"] for r in report["concepts"]} == set(cv.concepts())
    assert {r["word"] for r in report["refused"]} == set(cv.refused())
    assert report["resolved"] == len(cv.concepts())

    planted = _raw()
    planted["concepts"]["leader"]["grounding"][0]["preset"] = "Over 999"
    broken = cv.grounding_report(vocab=planted)
    assert broken["unresolved"] == ["leader"]
    assert broken["resolved"] == len(cv.concepts()) - 1
