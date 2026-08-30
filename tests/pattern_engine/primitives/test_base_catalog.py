from api.services.screener import base_catalog as bc


def test_every_key_is_unique():
    keys = [s.key for s in bc.ALL_STRUCTURES]
    assert len(keys) == len(set(keys))


def test_every_structure_declares_a_known_axis():
    for s in bc.ALL_STRUCTURES:
        assert s.axis in ("shape", "relation"), s.key


def test_shapes_and_relations_partition_all_structures():
    assert len(bc.SHAPES) + len(bc.RELATIONS) == len(bc.ALL_STRUCTURES)
    assert all(s.axis == "shape" for s in bc.SHAPES)
    assert all(s.axis == "relation" for s in bc.RELATIONS)


def test_every_relation_carries_a_predicate_and_no_shape_does():
    """Shapes are CLASSIFIED by a total cascade; relations are COLLECTED by
    their own predicate. A shape with a predicate would be a second authority
    on what that shape is.
    """
    for s in bc.RELATIONS:
        assert callable(s.detect), f"{s.key} is a relation with no predicate"
    for s in bc.SHAPES:
        assert s.detect is None, f"{s.key} is a shape carrying a predicate"


def test_ranks_are_unique_within_an_axis():
    """Rank is ORDERING ONLY, but a tie makes render order undefined."""
    for group in (bc.SHAPES, bc.RELATIONS):
        ranks = [s.rank for s in group]
        assert len(ranks) == len(set(ranks))


def test_every_criterion_has_exactly_one_provenance_state():
    """⛔ THE PROVENANCE RAIL. A criterion is one of exactly three things:
    sourced (a value AND the quote it came from AND a source id), refused
    (no value, plus a `missing:` saying what would have to be published), or
    ours (`origin` == 'uct'). Anything else is a number attributed to nobody
    — which is how `setup_templates` ended up carrying a Minervini
    breakout-volume figure he never published.
    """
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            sourced = c.value is not None and bool(c.quote) and bool(c.source_id)
            refused = c.value is None and bool(c.missing)
            ours = c.origin == "uct"
            assert sum([sourced, refused, ours]) == 1, (
                f"{s.key}: criterion {c.condition!r} is in "
                f"{sum([sourced, refused, ours])} provenance states"
            )


def test_a_uct_origin_criterion_never_claims_a_source():
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            if c.origin == "uct":
                assert not c.source_id, f"{s.key}: uct number cites {c.source_id}"


def test_a_sourced_criterion_always_carries_its_quote():
    """A number without the sentence it came from is not usable — it cannot
    be re-verified, and it is indistinguishable from one we invented.
    """
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            if c.origin == "source" and c.value is not None:
                assert c.quote, f"{s.key}: {c.condition!r} has a value and no quote"


def test_confidence_is_from_the_closed_vocabulary():
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            assert c.confidence in ("high", "med", "low"), s.key


def test_origin_is_from_the_closed_vocabulary():
    for s in bc.ALL_STRUCTURES:
        for c in s.criteria:
            assert c.origin in ("source", "uct"), s.key


def test_bias_never_forecasts():
    """Textbook bias only, same ruling as the candle library."""
    for s in bc.ALL_STRUCTURES:
        assert s.bias in ("bullish", "bearish", "neutral"), s.key


def test_meta_exposes_label_and_desc_for_every_key():
    m = bc.meta()
    assert set(m) == {s.key for s in bc.ALL_STRUCTURES}
    for key, entry in m.items():
        assert entry["label"] and entry["desc"], key


def test_by_key_returns_none_for_an_unknown_key():
    assert bc.by_key("no-such-structure") is None


def test_banned_verdict_words_appear_in_no_label_or_desc():
    """A structure DESCRIBES; it does not grade its own outcome. Extends the
    candle library's banned-words rail.

    ⚠️ NARROWED DELIBERATELY. The blunt version banned the bare word
    "confirmed" and immediately fired on "too few confirmed swings" — which
    is `zigzag`'s own term for a non-provisional pivot, not a verdict about
    the structure. A rail that flags correct code teaches people to ignore
    it (`lesson_a_sweep_that_flags_thirteen_when_two_are_defects`), so the
    ban is on the VERDICT sense: a structure that calls itself confirmed,
    failed, valid or high-probability. "confirmed swing(s)" is the
    segmenter's vocabulary and stays legal.
    """
    banned = (
        "confirmed pattern", "confirmed structure", "confirmed base",
        "confirmed breakout", "failed pattern", "failed structure",
        "failed base", "failed breakout", "high-probability",
        "high probability", "valid setup", "reliable setup",
    )
    for s in bc.ALL_STRUCTURES:
        blob = f"{s.label} {s.desc}".lower()
        for phrase in banned:
            assert phrase not in blob, f"{s.key} says {phrase!r}"


def test_the_narrowed_ban_still_catches_a_real_verdict():
    """Non-vacuity control. The narrowing above is only safe if the rail can
    still fail — otherwise it is a comment, not a test.
    """
    banned = (
        "confirmed pattern", "confirmed structure", "confirmed base",
        "confirmed breakout", "failed pattern", "failed structure",
        "failed base", "failed breakout", "high-probability",
        "high probability", "valid setup", "reliable setup",
    )
    offender = "A high-probability confirmed base that rarely fails".lower()
    assert any(p in offender for p in banned)
    innocent = "Too few confirmed swings to read a structure".lower()
    assert not any(p in innocent for p in banned)


def test_there_is_at_least_one_shape_and_shapes_can_name_anything():
    """SHAPE is a TOTAL partition, so the cascade must have a final branch
    that takes no condition. That branch is a real structure with a key.
    """
    assert bc.SHAPES
    assert bc.FALLBACK_SHAPE in {s.key for s in bc.SHAPES}


def test_the_darvas_box_is_registered_as_a_relation():
    box = bc.by_key("darvas-box")
    assert box is not None
    assert box.axis == "relation"
    assert box.criteria, "the box must carry its sourced criteria"


def test_darvas_box_records_that_darvas_publishes_no_duration_bound():
    """He explicitly declines to bound it: 'I did not care how long it stayed
    in its box'. That refusal must survive into the catalog AS a refusal,
    not be quietly replaced by a number of ours.
    """
    box = bc.by_key("darvas-box")
    dur = [c for c in box.criteria if "duration" in c.condition.lower()]
    assert dur, "expected a duration criterion"
    assert any(c.value is None and c.missing for c in dur)


def test_darvas_box_height_is_not_a_gate():
    """The 10% / 15-20% figures are Darvas's OBSERVATIONS of what boxes look
    like, not filters he applied. The corpus says so explicitly, so the
    catalog must mark them descriptive.
    """
    box = bc.by_key("darvas-box")
    height = [c for c in box.criteria if "height" in c.condition.lower()]
    assert height
    assert all("descriptive" in (c.condition + (c.missing or "")).lower()
               or c.confidence == "med" for c in height)


def test_darvas_box_requires_a_live_frame_not_a_historic_one():
    """⛔ THE RECENCY GATE IS LOAD-BEARING.

    Measured 2026-08-30: without it the predicate matched 3,582 of 3,705
    tickers (96.7%) because over 400 bars nearly every stock frames a box at
    some point and the walk reports wherever it ended — median frame age was
    313 bars. The coverage harness called it `noise`, correctly.
    """
    from types import SimpleNamespace

    from api.services.screener.base_catalog import (
        MAX_BOX_AGE_BARS, darvas_box_state,
    )

    def _b(i, hi, lo):
        return {"t": 1_600_000_000 + i * 86400, "o": (hi + lo) / 2,
                "h": hi, "l": lo, "c": (hi + lo) / 2, "v": 1_000_000}

    # Frame it, then drift inside it for far longer than the age bound.
    framed = [_b(0, 50, 48)] + [_b(i, 49, 47) for i in range(1, 4)] \
        + [_b(i, 49, 47.5) for i in range(4, 8)]
    drift = [_b(i, 48.5, 47.6) for i in range(8, 8 + MAX_BOX_AGE_BARS + 40)]

    box = bc.by_key("darvas-box")
    fresh = SimpleNamespace(bars=framed)
    stale = SimpleNamespace(bars=framed + drift)

    assert darvas_box_state(framed + drift)["state"] == "box", (
        "the frame should still exist — it is only OLD"
    )
    assert box.detect(fresh) is True
    assert box.detect(stale) is False, (
        "a frame set 60 bars ago is not a live Darvas box"
    )


def test_the_recency_bound_is_declared_as_ours_not_darvas():
    """We recorded that Darvas refuses to bound box duration. The bound we
    then chose anyway must therefore be labelled `origin: uct` and must not
    cite him — otherwise the catalog attributes our number to a source that
    explicitly declined to publish one.
    """
    box = bc.by_key("darvas-box")
    live = [c for c in box.criteria if "live" in c.condition.lower()]
    assert live, "expected the recency criterion"
    for c in live:
        assert c.origin == "uct"
        assert not c.source_id


def test_darvas_box_records_its_measured_coverage():
    """A structure whose real-universe hit-rate was never measured has not
    been authored — that is how `cup_handle_uct` shipped green at 2 of 2,890.
    """
    box = bc.by_key("darvas-box")
    assert box.coverage_pct is not None
    assert 0.5 <= box.coverage_pct <= 35.0, (
        f"{box.coverage_pct}% is outside the informative band"
    )
