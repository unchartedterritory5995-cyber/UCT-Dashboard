"""`structure_origin` — is this a published classic, or ours?

⭐ WHY THIS ANSWER NEEDS ITS OWN RAIL. `Criterion.origin` says who supplied one
NUMBER; it cannot say whether the STRUCTURE is a classic. Darvas Box carries
several `origin="uct"` criteria and is still Darvas' pattern. The distinction
matters because the whole grammar exists so a member can tell "a house published
this" from "we made this up", and a structure-level claim was the one place that
distinction was NOT being made — five UCT-invented structures were shipping
beside the published classics with nothing on screen to separate them.

⛔ EVERY ASSERTION HERE IS DERIVED FROM THE CATALOG, never typed against it. A
test that listed the five UCT structures by name would go stale the day a sixth
is added and would be asserting about the list rather than the rule.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc


def _origins():
    return {st.key: bc.structure_origin(st) for st in bc.ALL_STRUCTURES}


# ─── the rule itself ────────────────────────────────────────────────────────

def test_a_structure_with_any_source_id_is_published():
    """The positive half of the rule, checked against every catalog member."""
    for st in bc.ALL_STRUCTURES:
        cited = [c for c in st.criteria if c.source_id]
        if cited:
            assert bc.structure_origin(st) == "published", (
                f"{st.key} cites {cited[0].source_id!r} and must read as published"
            )


def test_a_structure_citing_nobody_is_ours():
    """The negative half. ⛔ Stated as a separate sentence from the one above,
    because a guard that only tests one direction is the shape this repo keeps
    paying for — the condition and the invariant have to agree BOTH ways."""
    for st in bc.ALL_STRUCTURES:
        if not any(c.source_id for c in st.criteria):
            assert bc.structure_origin(st) == "uct", (
                f"{st.key} traces to no house and must read as ours"
            )


def test_a_refusal_still_counts_as_engagement_with_the_literature():
    """⭐ THE SUBTLE HALF. A refusal carries a source_id: it records a house
    being ASKED and declining to publish. That is evidence the structure exists
    in the literature, so a structure known only through refusals is still a
    published classic — not ours. Keying the rule on `origin` instead of
    `source_id` would have inverted exactly these."""
    refusal_only = [
        st for st in bc.ALL_STRUCTURES
        if any(c.source_id and c.value is None and c.missing for c in st.criteria)
        and not any(c.source_id and c.value is not None for c in st.criteria)
    ]
    for st in refusal_only:
        assert bc.structure_origin(st) == "published"


# ─── non-vacuity: the rule must be able to say BOTH things ──────────────────

def test_the_derivation_actually_separates_the_catalog():
    """⛔ THE CONTROL. A function that returned one constant would satisfy every
    assertion above (each is guarded by an `if` that would simply never fire on
    the wrong branch). This is the case that refuses that: the live catalog must
    contain at least one of each, or this rail is measuring nothing."""
    vals = set(_origins().values())
    assert "published" in vals, "no published classic — the rule cannot be tested"
    assert "uct" in vals, (
        "no UCT-original in the catalog, so the branch that labels our own "
        "structures is unexercised and could be deleted without any rail noticing"
    )


def test_a_synthetic_structure_flips_the_answer():
    """The rule responds to its INPUT, not to catalog identity — proven on two
    structures that differ in exactly one field."""
    mine = bc.Structure(
        key="synthetic-ours", label="S", axis="relation", family="F",
        bias="neutral", rank=99, min_bars=1, desc="d",
        criteria=(bc.Criterion(condition="a rule we invented", value=3,
                               origin="uct"),),
    )
    theirs = bc.Structure(
        key="synthetic-theirs", label="S", axis="relation", family="F",
        bias="neutral", rank=99, min_bars=1, desc="d",
        criteria=(bc.Criterion(condition="a rule a house published", value=3,
                               quote="q", source_id="some_house_1960"),),
    )
    assert bc.structure_origin(mine) == "uct"
    assert bc.structure_origin(theirs) == "published"


# ─── it reaches the payload, and the count is derived ───────────────────────

def test_every_provenance_entry_carries_its_origin():
    """A field the router computes and the payload drops is the 'built, tested,
    unreachable' defect one layer down."""
    prov = bc.provenance()
    assert prov, "provenance() returned nothing"
    for key, entry in prov.items():
        assert entry.get("origin") in ("published", "uct"), (
            f"{key} reached the payload without an origin"
        )
        assert entry["origin"] == _origins()[key]


def test_the_uct_original_count_is_derived_not_typed():
    """⛔ The count and the thing it counts must be the same walk. A literal
    beside the list it describes is the writer-index / COT-routes / setup-catalog
    defect, three times over in this repo."""
    counts = bc.provenance_counts()
    expected = sum(1 for v in _origins().values() if v == "uct")
    assert counts["uct_originals"] == expected
    assert counts["structures"] == len(bc.ALL_STRUCTURES)


def test_the_criterion_states_still_close_over_every_criterion():
    """The three per-criterion states partition the criteria exactly — nothing
    lands in two buckets and nothing is dropped."""
    counts = bc.provenance_counts()
    total = sum(len(st.criteria) for st in bc.ALL_STRUCTURES)
    assert counts["sourced"] + counts["refused"] + counts["ours"] == total
