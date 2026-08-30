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


# ── Green Line Breakout ────────────────────────────────────────────────────

def _daily(i, price, spread=0.005):
    """Bars keyed YYYYMMDD, the form screener bars actually carry."""
    y, m, d = 2020 + i // 252, ((i // 21) % 12) + 1, (i % 21) + 1
    return {"t": y * 10000 + m * 100 + d, "o": price,
            "h": price * (1 + spread), "l": price * (1 - spread),
            "c": price, "v": 1_000_000}


def test_month_key_handles_both_timestamp_forms():
    """Screener bars are int YYYYMMDD; pattern_engine.types.Bar documents unix
    seconds. Guessing wrong buckets every bar into one month.
    """
    assert bc._month_key(20260817) == 202608
    assert bc._month_key(1_600_000_000) == 202009


def test_green_line_needs_the_high_to_stand_for_three_months():
    """A peak with only two quiet months after it is not yet a green line."""
    bars = [_daily(i, 100.0) for i in range(21)]          # month 1
    bars += [_daily(i, 130.0) for i in range(21, 42)]     # month 2 — the peak
    bars += [_daily(i, 110.0) for i in range(42, 84)]     # 2 quiet months
    assert bc.green_line(bars) is None


def test_green_line_latches_once_three_months_pass():
    bars = [_daily(i, 100.0) for i in range(21)]
    bars += [_daily(i, 130.0) for i in range(21, 42)]
    bars += [_daily(i, 110.0) for i in range(42, 126)]    # 4 quiet months
    line = bc.green_line(bars)
    assert line is not None
    assert line["price"] > 130.0 * 0.99


def test_glb_fires_only_on_a_RECENT_break():
    """⛔ THE SAME TRAP THE DARVAS BOX SPRANG, CAUGHT AGAIN.

    Measured 2026-08-30: 496 tickers (14.0%) sit above their green line and
    the median cleared it 74 sessions ago — max 741. A column labelled
    "Breakout" must mean the event, not a state entered three years back.
    """
    from types import SimpleNamespace
    base = [_daily(i, 100.0) for i in range(21)]
    base += [_daily(i, 130.0) for i in range(21, 42)]
    base += [_daily(i, 110.0) for i in range(42, 126)]
    fresh = base + [_daily(i, 140.0) for i in range(126, 130)]
    stale = base + [_daily(i, 140.0) for i in range(126, 126 + 80)]

    glb = bc.by_key("green-line-breakout")
    assert bc.glb_breakout_age(fresh) is not None
    assert glb.detect(SimpleNamespace(bars=fresh, bars_full=fresh)) is True
    assert glb.detect(SimpleNamespace(bars=stale, bars_full=stale)) is False


def test_glb_records_that_our_high_is_not_truly_all_time():
    """Wish requires an ALL-TIME high. Our deepest daily history is bounded
    (AAPL starts 2002-10-16 against a 1980 IPO), and the corpus names an
    unlabelled since-IPO high as a real, common defect in GLB screeners.
    """
    glb = bc.by_key("green-line-breakout")
    scope = [c for c in glb.criteria if "scope" in c.condition.lower()]
    assert scope and all(c.origin == "uct" for c in scope)
    assert "history we hold" in glb.desc


def test_glb_volume_criterion_is_a_refusal_not_a_number():
    """"It does help if the stock showed above average volume" — no multiple,
    no window. Not computable as published, so it ships uncomputed.
    """
    glb = bc.by_key("green-line-breakout")
    vol = [c for c in glb.criteria if "volume" in c.condition.lower()]
    assert vol and all(c.value is None and c.missing for c in vol)


# ── Pocket Pivot ───────────────────────────────────────────────────────────

def _pp_series(n=260, base=100.0):
    """A gently rising series with alternating up/down closes so the prior
    10-day window always contains down days.
    """
    out = []
    for i in range(n):
        p = base * (1.0 + 0.0015 * i) * (0.995 if i % 3 == 0 else 1.0)
        out.append({"t": 20200101 + i, "o": p, "h": p * 1.01,
                    "l": p * 0.99, "c": p, "v": 1_000_000})
    return out


def test_pocket_pivot_refuses_when_the_window_has_no_down_days():
    """⛔ The rule's right-hand side is max of an empty set. The authors never
    address it. Passing vacuously would make EVERY up day a pocket pivot.
    """
    from types import SimpleNamespace
    bars = []
    for i in range(260):
        p = 100.0 * (1.0 + 0.002 * i)          # strictly rising: no down days
        bars.append({"t": 20200101 + i, "o": p, "h": p * 1.01,
                     "l": p * 0.985, "c": p, "v": 1_000_000})
    bars[-1]["v"] = 50_000_000
    pp = bc.by_key("pocket-pivot")
    assert pp.detect(SimpleNamespace(bars=bars, bars_full=bars)) is False


def test_pocket_pivot_needs_the_close_in_the_top_half_of_the_range():
    from types import SimpleNamespace
    bars = _pp_series()
    last = bars[-1]
    last["v"] = 90_000_000
    last["c"] = last["l"] + (last["h"] - last["l"]) * 0.2   # bottom fifth
    pp = bc.by_key("pocket-pivot")
    assert pp.detect(SimpleNamespace(bars=bars, bars_full=bars)) is False


def test_pocket_pivot_window_length_is_sourced_but_exclusivity_is_ours():
    """The 10 days are Kacher's; whether day t sits inside the window is an
    inference no primary text states, so it is labelled ours.
    """
    pp = bc.by_key("pocket-pivot")
    win = [c for c in pp.criteria if "window length" in c.condition.lower()]
    excl = [c for c in pp.criteria if "signal day itself" in c.condition.lower()]
    assert win and win[0].origin == "source" and win[0].value == bc.PP_WINDOW
    assert excl and excl[0].origin == "uct"


def test_pocket_pivot_fundamentals_gate_is_a_refusal():
    pp = bc.by_key("pocket-pivot")
    fund = [c for c in pp.criteria if "fundamentals" in c.condition.lower()]
    assert fund and all(c.value is None and c.missing for c in fund)


# ── every relation carries a measured coverage ─────────────────────────────

def test_every_relation_records_its_measured_coverage():
    """A structure whose real-universe hit-rate was never measured has not
    been authored — that is how `cup_handle_uct` shipped green at 2 of 2,890.

    ⚠️ `thin` IS ALLOWED, and this test was WRONG to forbid it. The first
    version required 0.5% <= coverage <= 35%, i.e. the harness's `ok` band —
    and immediately rejected the Power Play at 0.13%, which is correct: a
    doubling inside eight weeks followed by a sub-20% flag is genuinely rare.
    `tools/base_coverage` says so in as many words ("a genuinely rare
    structure (high tight flag: 8 symbols) is legitimately thin and should
    still ship"). What must never ship is a structure that was never measured
    (None), one that fires on nothing (0), or one so common it carries no
    information (>35%).
    """
    for s in bc.RELATIONS:
        assert s.coverage_pct is not None, f"{s.key} has no measured coverage"
        assert s.coverage_pct > 0, f"{s.key} fires on nothing"
        assert s.coverage_pct <= 35.0, f"{s.key} at {s.coverage_pct}% is uninformative"
