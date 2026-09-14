"""One mapping from what an adapter saw to what a member reads (OI-23; §3.5, §3.8c).

Three vocabularies met on this path — the member-facing contract, the adapter taxonomy, and the
`/flow` router's inline classes — and none of them knew about the others. This is the rail on the
table that joins them, and on the two properties that make it worth having:

  * it is TOTAL — every upstream × every fatal reason, so a new reason fails the suite until its
    copy exists, rather than rendering as "something went wrong on our side" forever;
  * it is a PAIR, not a lookup on the reason alone — the same observation means different things
    from different upstreams, and collapsing them blames a member for our outage.
"""
from __future__ import annotations

import itertools

import pytest

from api.services.discord_render import contract
from api.services.discord_render.adapters import classes
from api.services.discord_render.adapters import result as R


def test_the_mapping_is_total_over_every_upstream_and_every_fatal_reason():
    """⛔ THE ONE THAT MATTERS. Add a reason to the taxonomy and this fails until its copy exists."""
    missing = [(u, r) for u, r in itertools.product(classes.UPSTREAMS, sorted(R.FATAL_REASONS))
               if (u, r) not in classes.CLASS_OF]
    assert not missing, (
        f"{len(missing)} (upstream, reason) pair(s) have no member-facing class: {missing}")


def test_every_mapped_class_exists_in_the_member_facing_contract():
    """A class the contract does not know renders as `internal` via `normalize_class` — silently."""
    unknown = sorted({c for c in classes.CLASS_OF.values() if c not in contract.FAILURE_CLASSES})
    assert not unknown, f"mapped to classes that have no copy: {unknown}"
    for cls in set(classes.CLASS_OF.values()):
        assert contract.normalize_class(cls) == cls, f"{cls} does not survive normalize_class"


def test_the_mapping_names_no_reason_outside_the_taxonomy():
    """Both directions: a stale row for a reason that no longer exists is dead cover."""
    stale = sorted({r for _, r in classes.CLASS_OF if r not in R.ALL_REASONS})
    assert not stale, f"rows for reasons that are not in the taxonomy: {stale}"
    unknown_upstream = sorted({u for u, _ in classes.CLASS_OF if u not in classes.UPSTREAMS})
    assert not unknown_upstream, unknown_upstream


def test_the_same_reason_means_different_things_from_different_upstreams():
    """⛔ THE REASON THIS IS A PAIR. `empty` from bars is the MEMBER'S input — no bars for that
    symbol and timeframe, excluded from the success-rate SLO. `empty` from the renderer is OURS.
    One lookup on the reason alone would either blame a member for our outage or bury our outage
    in a user-error bucket."""
    assert classes.for_reason("bars", R.EMPTY) == "no_bars"
    assert classes.for_reason("renderer", R.EMPTY) == "renderer_unavailable"
    assert classes.for_reason("bars", R.EMPTY) in contract.USER_ERROR_CLASSES
    assert classes.for_reason("renderer", R.EMPTY) not in contract.USER_ERROR_CLASSES


def test_the_flow_classes_are_the_three_the_router_already_emitted():
    """The copy must not move: these sentences are what members read today on the pre-V2 path."""
    assert classes.for_reason("flow", R.TIMEOUT) == "flow_timeout"
    assert classes.for_reason("flow", R.BREAKER_OPEN) == "flow_unavailable"
    assert classes.for_reason("flow", R.UPSTREAM_ERROR) == "flow_error"


def test_an_unmapped_pair_raises_rather_than_quietly_becoming_internal():
    """⛔ `normalize_class` falling back to `internal` is the right RUNTIME behaviour and the wrong
    DEVELOPMENT behaviour — the cause would be unlearnable, which is C-08 one level up."""
    with pytest.raises(KeyError, match="no member-facing class"):
        classes.for_reason("bars", "a_reason_nobody_declared")
    with pytest.raises(KeyError):
        classes.for_reason("an_upstream_nobody_declared", R.TIMEOUT)


def test_a_result_maps_through_its_first_class():
    r = R.fail(R.BREAKER_OPEN, provider="flow").with_reason(R.CACHED)
    assert classes.for_result("flow", r) == "flow_unavailable", (
        "the FIRST class is the cause; the rest followed from it")


def test_no_reason_at_all_is_internal_rather_than_an_exception():
    assert classes.for_reason("bars", None) == "internal"
    assert classes.for_result("bars", R.ok([], provider="p")) == "internal"


def test_an_empty_flow_answer_is_still_the_routers_own_sentence_not_a_failure_class():
    """⛔ A COMMENT CLAIMING A RULE IS NOT A RULE. `/flow` with zero contracts is a correct answer
    and the router has copy for it; the `(flow, EMPTY)` row exists only to keep the cross-product
    total. This asserts the router still carries that sentence, so the rule and the code cannot
    drift apart while the comment keeps saying they agree."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "routers" /
           "discord_interactions.py").read_text(encoding="utf-8")
    assert classes.flow_empty_is_not_a_failure() in src, (
        "the router no longer carries the no-flow sentence; either it moved (update this rail) or "
        "an empty answer now renders as a failure class, which it is not")
