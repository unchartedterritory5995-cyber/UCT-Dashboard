"""Who is a member — the three population lists, pinned across two files.

⛔⛔ ONE FACT IN TWO FILES. `api/services/journal_two/notebook_populations.py`
(the soak's server read) and `tools/nb_observe.py` (the sampler, which runs from
a COPY outside every worktree and so cannot import `api`) carry the same three
constants. This file READS the sampler by AST — it never imports it and never
retypes its lists — and asserts the two are equal. A third copy typed into this
test would be a third authority.

⛔ BY FULL EMAIL, NEVER BY PREFIX. The cases below drive the defect shapes the
sampler's own history names: `member-smoke@` is not `smoke@`, and an address that
merely LOOKS like one of ours is not one of ours.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.journal_two import notebook_populations as pops

ROOT = pathlib.Path(__file__).resolve().parents[1]
SAMPLER = ROOT / "tools" / "nb_observe.py"
NAMES = ("RIG_AND_OWNER", "SYNTHETIC_MEMBERS", "INTERNAL_DOMAIN")


def _sampler_constants() -> dict:
    """The sampler's three module-level constants, read by AST."""
    tree = ast.parse(SAMPLER.read_text(encoding="utf-8"))
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and tgt.id in NAMES:
                    found[tgt.id] = ast.literal_eval(node.value)
    return found


def test_the_sampler_read_is_not_empty():
    """⭐ NON-VACUITY CONTROL: an AST read that found nothing would make the
    equality below compare an empty dict to itself."""
    found = _sampler_constants()
    assert set(found) == set(NAMES), found
    assert found["RIG_AND_OWNER"] and found["SYNTHETIC_MEMBERS"]
    assert "member-smoke@uctintelligence.internal" in found["SYNTHETIC_MEMBERS"]


@pytest.mark.parametrize("name", NAMES)
def test_the_three_lists_equal_the_samplers(name):
    """⛔ The same fact, byte for byte — a list changed in one file only goes red."""
    assert _sampler_constants()[name] == getattr(pops, name)


FIXTURE = {
    "unchartedterritory5995@gmail.com": "rig_owner",
    "smoke@uctintelligence.internal": "synthetic",
    "member-smoke@uctintelligence.internal": "synthetic",
    "bench@uctintelligence.internal": "synthetic",
    "somebody-new@uctintelligence.internal": "unknown_internal",
    "trader.one@example.com": "organic",
}


@pytest.mark.parametrize("email,expected", sorted(FIXTURE.items()))
def test_each_address_lands_in_exactly_its_bucket(email, expected):
    assert pops.population_of(email) == expected


def test_the_fixture_covers_every_population():
    """⭐ CONTROL: the table above is not quietly one answer."""
    assert set(FIXTURE.values()) == set(pops.POPULATIONS)


@pytest.mark.parametrize("email,expected", [
    # ⛔ A PREFIX LOOKALIKE IS NOT SYNTHETIC. It is on our reserved domain and
    # nobody declared it, so it is an unknown internal — flagged, not organic.
    ("xsmoke@uctintelligence.internal", "unknown_internal"),
    ("smoke2@uctintelligence.internal", "unknown_internal"),
    # ⛔ ...and an outside address that merely CONTAINS one of our words is a person.
    ("smoke@gmail.com", "organic"),
    ("member-smoke@example.com", "organic"),
    # the domain match is an exact suffix INCLUDING the `@`
    ("x@notuctintelligence.internal", "organic"),
    ("x@uctintelligence.internal.example.com", "organic"),
])
def test_a_lookalike_is_never_matched_by_prefix_or_substring(email, expected):
    assert pops.population_of(email) == expected


def test_case_and_surrounding_space_do_not_change_the_bucket():
    assert pops.population_of("  SMOKE@UCTIntelligence.Internal ") == "synthetic"
    assert pops.population_of("UnchartedTerritory5995@Gmail.com") == "rig_owner"


@pytest.mark.parametrize("bad", ["", "   ", None])
def test_an_identity_without_an_address_is_refused_never_organic(bad):
    """⛔ 'We could not tell who this was' must never read as a real member."""
    with pytest.raises(ValueError):
        pops.population_of(bad)
