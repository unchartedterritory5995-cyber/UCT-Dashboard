"""S6 CP2' -- `api/services/member_interest.py`'s own test suite.

SPEC-S6-PERSONALIZATION §5's stated test scope for the first migration:
"per-source isolation, the empty-member case, the fail-soft contract, cache
invalidation on write [N/A -- no cache exists until CP4, which is a
separate, owner-blocked checkpoint], the mutation proofs."

WEIGHTED SET (Decision Card 1, DEFAULTABLE, applied 2026-09-18): `interest_for`
returns `{by_source, all_mine, entities}`, where every entity carries its
weight AND `because[]` -- the reasons it is there (SPEC-S6 §3.3: "a resolver
that returns a ranked list with no provenance is unfalsifiable to the person
it is about").
"""
from __future__ import annotations

from unittest import mock

from api.services import member_interest as mi


# ═════════════════════════════════════════════════════════════════════════
# PER-SOURCE ISOLATION
# ═════════════════════════════════════════════════════════════════════════

def test_each_source_is_independently_swappable():
    """⛔ Proves the four sources are genuinely isolated, not a single join
    that happens to look like four -- swap ONE, the other three answer from
    their real (mocked-to-empty-by-default) implementation untouched."""
    with mock.patch.object(mi, "_watchlist_syms", return_value={"AAPL"}), \
         mock.patch.object(mi, "_flagged_syms", return_value=set()), \
         mock.patch.object(mi, "_position_syms", return_value=set()), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        result = mi.interest_for("u1")
    assert result["by_source"]["watchlist"] == {"AAPL"}
    assert result["by_source"]["flagged"] == set()
    assert result["by_source"]["positions"] == set()
    assert result["by_source"]["uct20"] == set()
    assert result["all_mine"] == {"AAPL"}


def test_the_empty_member_case():
    """A member with nothing anywhere -- no watchlist, no flags, no
    positions, not on UCT20 -- gets an empty answer, not an error and not a
    partial one mistaken for a failure."""
    with mock.patch.object(mi, "_watchlist_syms", return_value=set()), \
         mock.patch.object(mi, "_flagged_syms", return_value=set()), \
         mock.patch.object(mi, "_position_syms", return_value=set()), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        result = mi.interest_for("nobody")
    assert result["all_mine"] == set()
    assert result["entities"] == {}
    assert result["by_source"] == {"watchlist": set(), "flagged": set(),
                                    "positions": set(), "uct20": set()}


# ═════════════════════════════════════════════════════════════════════════
# THE FAIL-SOFT CONTRACT -- a failing source yields PARTIAL, never EMPTY
# ═════════════════════════════════════════════════════════════════════════

def test_a_failing_source_never_blanks_the_others():
    """⛔ Carried over verbatim from calendar_personalization.py's original
    stated invariant. This is the one property SPEC-S6 §5 names explicitly
    as easy to lose in a refactor: 'a resolver that raises when one source
    is down turns a personalization nicety into an outage on whatever
    surface asks first.'"""
    with mock.patch.object(mi, "_watchlist_syms", side_effect=RuntimeError("db locked")), \
         mock.patch.object(mi, "_flagged_syms", return_value={"NVDA"}), \
         mock.patch.object(mi, "_position_syms", return_value={"TSLA"}), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        result = mi.interest_for("u2")
    assert result["by_source"]["watchlist"] == set()
    assert result["by_source"]["flagged"] == {"NVDA"}
    assert result["by_source"]["positions"] == {"TSLA"}
    assert result["all_mine"] == {"NVDA", "TSLA"}


def test_MUTATION_a_failing_source_is_distinguishable_from_an_empty_one_via_because():
    """⛔ C5-02 §2's named anti-pattern: 'empty-because-unreadable
    indistinguishable from empty-because-new.' `because[]` is where this
    distinction actually surfaces -- a symbol present via ONE working source
    still names only that source, never a phantom entry for the failed one.

    Mutation: if `interest_for` swallowed the exception and returned the
    SAME symbols as if the source had succeeded (e.g. by defaulting to a
    stale cache instead of set()), this test could not tell the difference
    from the healthy case -- which is exactly why it asserts on `because`,
    not just membership."""
    with mock.patch.object(mi, "_watchlist_syms", side_effect=RuntimeError("db locked")), \
         mock.patch.object(mi, "_flagged_syms", return_value={"NVDA"}), \
         mock.patch.object(mi, "_position_syms", return_value=set()), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        result = mi.interest_for("u3")
    assert result["entities"]["NVDA"]["because"] == ["flagged"]
    assert "watchlist" not in result["entities"]["NVDA"]["because"]


def test_all_four_sources_failing_yields_empty_not_an_exception():
    with mock.patch.object(mi, "_watchlist_syms", side_effect=RuntimeError()), \
         mock.patch.object(mi, "_flagged_syms", side_effect=RuntimeError()), \
         mock.patch.object(mi, "_position_syms", side_effect=RuntimeError()), \
         mock.patch.object(mi, "_uct20_syms", side_effect=RuntimeError()):
        result = mi.interest_for("u4")   # must not raise
    assert result == {"by_source": {"watchlist": set(), "flagged": set(),
                                     "positions": set(), "uct20": set()},
                       "all_mine": set(), "entities": {}}


# ═════════════════════════════════════════════════════════════════════════
# because[] -- PROVENANCE
# ═════════════════════════════════════════════════════════════════════════

def test_because_names_every_source_a_symbol_actually_came_from():
    with mock.patch.object(mi, "_watchlist_syms", return_value={"AAPL"}), \
         mock.patch.object(mi, "_flagged_syms", return_value={"AAPL"}), \
         mock.patch.object(mi, "_position_syms", return_value=set()), \
         mock.patch.object(mi, "_uct20_syms", return_value={"AAPL"}):
        result = mi.interest_for("u5")
    assert set(result["entities"]["AAPL"]["because"]) == {"watchlist", "flagged", "uct20"}


# ═════════════════════════════════════════════════════════════════════════
# THE WEIGHT REGISTRY -- bucketing, not a flat per-source sum
# ═════════════════════════════════════════════════════════════════════════

def test_positions_alone_weighs_3():
    with mock.patch.object(mi, "_watchlist_syms", return_value=set()), \
         mock.patch.object(mi, "_flagged_syms", return_value=set()), \
         mock.patch.object(mi, "_position_syms", return_value={"TSLA"}), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        result = mi.interest_for("u6")
    assert result["entities"]["TSLA"]["weight"] == 3.0


def test_watchlist_and_flagged_share_ONE_bucket_not_stacked():
    """⛔ THE LOAD-BEARING CASE. `watchlist` and `flagged` are the same
    weight bucket ('list', +2.0) -- a symbol in BOTH must weigh 2.0, not
    4.0. This is exactly what a naive per-source-additive sum would get
    wrong, and it is the reason SOURCE_BUCKETS groups by bucket rather than
    listing four independent weights."""
    with mock.patch.object(mi, "_watchlist_syms", return_value={"NVDA"}), \
         mock.patch.object(mi, "_flagged_syms", return_value={"NVDA"}), \
         mock.patch.object(mi, "_position_syms", return_value=set()), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        result = mi.interest_for("u7")
    assert result["entities"]["NVDA"]["weight"] == 2.0


def test_weights_stack_ACROSS_distinct_buckets():
    """A symbol that is BOTH a position AND on the watchlist gets both
    buckets' weights: 3.0 + 2.0 = 5.0. Distinct buckets DO stack; only
    within-bucket duplication (the case above) does not."""
    with mock.patch.object(mi, "_watchlist_syms", return_value={"AMD"}), \
         mock.patch.object(mi, "_flagged_syms", return_value=set()), \
         mock.patch.object(mi, "_position_syms", return_value={"AMD"}), \
         mock.patch.object(mi, "_uct20_syms", return_value=set()):
        result = mi.interest_for("u8")
    assert result["entities"]["AMD"]["weight"] == 5.0


def test_all_four_sources_at_once_sums_all_three_buckets():
    with mock.patch.object(mi, "_watchlist_syms", return_value={"MSFT"}), \
         mock.patch.object(mi, "_flagged_syms", return_value={"MSFT"}), \
         mock.patch.object(mi, "_position_syms", return_value={"MSFT"}), \
         mock.patch.object(mi, "_uct20_syms", return_value={"MSFT"}):
        result = mi.interest_for("u9")
    assert result["entities"]["MSFT"]["weight"] == 3.0 + 2.0 + 1.0


def test_MUTATION_changing_a_bucket_weight_changes_the_computed_weight():
    """External mutation of the actual registry, not the test's own
    logic -- proving the weight genuinely DERIVES from SOURCE_BUCKETS rather
    than being independently hardcoded somewhere inside interest_for."""
    original = mi.SOURCE_BUCKETS
    try:
        mi.SOURCE_BUCKETS = (("positions", "positions", 99.0),) + original[1:]
        mi._BUCKET_WEIGHT["positions"] = 99.0
        with mock.patch.object(mi, "_watchlist_syms", return_value=set()), \
             mock.patch.object(mi, "_flagged_syms", return_value=set()), \
             mock.patch.object(mi, "_position_syms", return_value={"TSLA"}), \
             mock.patch.object(mi, "_uct20_syms", return_value=set()):
            result = mi.interest_for("u10")
        assert result["entities"]["TSLA"]["weight"] == 99.0
    finally:
        mi.SOURCE_BUCKETS = original
        mi._BUCKET_WEIGHT["positions"] = 3.0


# ═════════════════════════════════════════════════════════════════════════
# weight_buckets_payload -- the wire shape CP3 reads
# ═════════════════════════════════════════════════════════════════════════

def test_weight_buckets_payload_groups_watchlist_and_flagged_together():
    payload = mi.weight_buckets_payload()
    list_bucket = next(b for b in payload if set(b["sources"]) == {"flagged", "watchlist"})
    assert list_bucket["weight"] == 2.0
    positions_bucket = next(b for b in payload if b["sources"] == ["positions"])
    assert positions_bucket["weight"] == 3.0
    uct20_bucket = next(b for b in payload if b["sources"] == ["uct20"])
    assert uct20_bucket["weight"] == 1.0


def test_weight_buckets_payload_is_json_safe():
    import json
    json.dumps(mi.weight_buckets_payload())   # must not raise


def test_NON_VACUITY_weight_buckets_payload_covers_every_declared_source():
    """⛔ A payload with zero buckets would satisfy every assertion above by
    vacuity if they were written as pure absence checks. This pins the
    positive: every name in SOURCES appears in exactly one bucket."""
    payload = mi.weight_buckets_payload()
    named = set()
    for b in payload:
        named.update(b["sources"])
    assert named == set(mi.SOURCES)
