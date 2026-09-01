"""The Ugly Double Bottom — the shape both shipped engines refuse.

⭐⭐ WHY THIS STRUCTURE EARNS A KEY INSTEAD OF A WIDENED TOLERANCE. Two
detectors already ship under the double-bottom name, and each rejects this shape
on the line that defines it:

  - `base_catalog.double_bottom_state` refuses on ``if p2 >= p1: return None``.
    IBD's W REQUIRES the second low to UNDERCUT the first, so a second bottom
    5-15% HIGHER is refused on the defining feature, not on a tolerance.
  - `pattern_engine/detectors/classical/double_bottom.py` refuses on
    ``abs(t1_price - t2_price) / t1_price >= _MAX_TROUGH_SIMILARITY`` with
    ``_MAX_TROUGH_SIMILARITY = 0.04``. It rejects the same shape from the other
    side: this pattern's MINIMUM separation is already outside its band.

⛔ THAT ARGUMENT IS NOT TAKEN ON TRUST HERE. `test_a_CLASSIC_double_bottom_does_
not_fire_this_detector` and `test_one_skeleton_one_sign_flip_and_the_two_labels_
never_meet` drive ONE fixture builder across the sign of the second leg and read
the SHIPPED `base_matches` string: the W appears below zero, this appears above
it, and no value produces both. The universe measurement agrees — 80 symbols
carry this, 137 carry the W, 0 carry both, on the same 1,871-ticker sample.

⛔ AND EVERY CASE THAT REFUSES IS PAIRED WITH ONE THAT FIRES. A gate proven only
by refusals is indistinguishable from a detector that never fires at all, which
is the `cup_handle_uct` defect (shipped green at 2 of 2,890). Each threshold is
shown just-inside AND just-outside, on fixtures whose confirmed swing lows are
IDENTICAL either side of the line — so what refused is the threshold and not the
segmenter losing sight of the pattern.
"""
import sys, pathlib, datetime, io, re, glob, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc
from api.services.screener import bases

ROOT = pathlib.Path(__file__).resolve().parents[1]


# ── fixtures ────────────────────────────────────────────────────────────────
# ⛔ REAL CALENDAR DATES. `20240101 + i` yields 20240132, and every consumer that
# parses a screener bar's `t` as YYYYMMDD then reads a month with 32 days.

def _sessions(n: int) -> list:
    out, d = [], datetime.date(2024, 1, 2)
    while len(out) < n:
        if d.weekday() < 5:                      # weekdays only
            out.append(int(d.strftime("%Y%m%d")))
        d += datetime.timedelta(days=1)
    return out


_DATES = _sessions(400)


def _bar(i, c, v=1_000_000):
    return {"t": _DATES[i], "o": c, "c": c, "v": v,
            "h": c * 1.005, "l": c * 0.995}


def _leg(bars, n, to):
    """Append a smooth move from the last close to `to`."""
    start = bars[-1]["c"]
    step = (to - start) / max(1, n)
    for i in range(n):
        bars.append(_bar(len(bars), start + step * (i + 1)))
    return bars


TOP = 100.0
LOW1 = TOP * 0.78
#: The rally between the two bottoms. ⚠️ IT IS DELIBERATELY DEEP. At a shallower
#: peak a +15.5% second bottom retraces only ~1% and `zigzag` never confirms it
#: as a swing low at all — so the ceiling case would have refused because the
#: SEGMENTER lost the pattern, not because the threshold bit, and the test would
#: have passed for the wrong reason. The paired-lows assertions in each
#: threshold case are what caught that.
PEAK = TOP * 0.96


def _two_bottoms(second_leg, confirm=True, tail=6, prior_gain=0.50):
    """ONE skeleton. `second_leg` is the second bottom's offset from the first.

    Positive puts the second bottom ABOVE the first (Bulkowski's ugly double
    bottom); negative undercuts it (IBD's W). Everything else is held fixed, so
    a difference in what fires is attributable to that one number.

    ⭐ THE CONFIRMING CLOSE IS ONE BAR, so `tail` IS the confirmation's age in
    sessions. A multi-bar confirming leg made the age a function of where inside
    the leg price happened to cross, which is not something a reader of the
    recency case should have to compute.
    """
    bars = [_bar(0, TOP / (1.0 + prior_gain))]
    _leg(bars, 45, TOP)                          # the advance the base rests on
    _leg(bars, 20, LOW1)                         # the FIRST bottom
    _leg(bars, 18, PEAK)                         # the rally between the bottoms
    _leg(bars, 20, LOW1 * (1 + second_leg))      # the SECOND bottom
    _leg(bars, 10, PEAK * 0.99)                  # back up, still UNDER that high
    if confirm:
        bars.append(_bar(len(bars), PEAK * 1.03))    # THE confirming close
        _leg(bars, tail, PEAK * 1.04)                # sessions since confirmation
    else:
        _leg(bars, tail + 1, PEAK * 0.98)            # never closes above it
    return bars


def _ctx(bars):
    return bases._context(bars, bars)


def _fires(bars):
    return bc.by_key("ugly-double-bottom").detect(_ctx(bars))


def _lows(bars):
    return [(l["bar_index"], round(l["price"], 4)) for l in _ctx(bars).lows]


def _matches(bars):
    return bases.classify(bars, bars)["base_matches"] or ""


# ── the control, first, because it is what makes the refusals mean anything ──

def test_the_baseline_fixture_actually_FIRES():
    """⛔ NON-VACUITY. Nearly every case below asserts a refusal, and a detector
    that returned False unconditionally would satisfy all of them. This is the
    case that refuses that reading.
    """
    bars = _two_bottoms(0.09)
    st = bc.ugly_double_bottom_state(bars)
    assert st is not None, "the baseline fixture does not fire — every refusal below is vacuous"
    assert st["low2"] > st["low1"], "the second bottom must sit ABOVE the first"
    assert bc.UDB_MIN_RISE <= st["rise"] <= bc.UDB_MAX_RISE
    assert st["confirm_age_bars"] <= bc.UDB_MAX_AGE_BARS
    assert _fires(bars) is True


def test_the_shipped_path_carries_it_all_the_way_to_base_matches():
    """⛔ A predicate that fires and reaches no column is this repo's own
    `lesson_built_tested_green_and_unreachable`. The member screens
    `base_matches`, so that is what is asserted — delimiter-wrapped, because a
    bare key makes a `contains` filter match the wrong row.
    """
    m = _matches(_two_bottoms(0.09))
    assert bc.match_value("ugly-double-bottom") in m, m
    assert ",ugly-double-bottom," in m
    render = bases.classify(_two_bottoms(0.09), _two_bottoms(0.09))["base_render"]
    assert "Ugly Double Bottom" in render


# ── each threshold BINDS: just-inside fires, just-outside refuses ────────────

def test_the_five_percent_floor_binds():
    """⭐ AND THE SWINGS ARE IDENTICAL EITHER SIDE OF THE LINE, which is what
    makes this a test of the threshold rather than of the segmenter. A pair
    where the refusing fixture had also lost a pivot would prove nothing about
    the number.
    """
    inside, outside = _two_bottoms(0.050), _two_bottoms(0.045)
    assert _fires(inside) is True
    assert _fires(outside) is False
    a, b = _lows(inside)[-2:], _lows(outside)[-2:]
    assert a[0] == b[0], "the FIRST bottom moved — the fixtures are not comparable"
    assert a[1][0] == b[1][0], "the second bottom's bar moved, not just its price"
    assert bc.UDB_MIN_RISE == 0.05


def test_the_fifteen_percent_ceiling_binds():
    inside, outside = _two_bottoms(0.145), _two_bottoms(0.155)
    assert _fires(inside) is True
    assert _fires(outside) is False
    a, b = _lows(inside)[-2:], _lows(outside)[-2:]
    assert a[0] == b[0] and a[1][0] == b[1][0]
    assert bc.UDB_MAX_RISE == 0.15


def test_the_published_band_is_the_ONLY_band_that_fires():
    """The gate is a closed interval, not a floor with an open top. Swept, so a
    detector that quietly accepted everything above 5% would be caught.
    """
    fired = {round(p, 3): _fires(_two_bottoms(p))
             for p in (0.00, 0.02, 0.045, 0.05, 0.09, 0.145, 0.155, 0.20, 0.30)}
    assert fired == {0.0: False, 0.02: False, 0.045: False, 0.05: True,
                     0.09: True, 0.145: True, 0.155: False, 0.2: False,
                     0.3: False}, fired


def test_an_UNCONFIRMED_pattern_is_refused():
    """"Price must close above highest high between two bottoms" — and the
    corpus states the negative too: "No close above the intervening high" leaves
    it unconfirmed, which is to say not this pattern.

    The refusing fixture keeps BOTH bottoms; only the close above the
    intervening high is removed.
    """
    confirmed, unconfirmed = _two_bottoms(0.09), _two_bottoms(0.09, confirm=False)
    assert _fires(confirmed) is True
    assert _fires(unconfirmed) is False
    assert _lows(confirmed)[-2:] == _lows(unconfirmed)[-2:], (
        "the two fixtures differ in more than the confirming close")


def test_the_confirming_close_must_be_RECENT():
    """⛔ THE BOUND `darvas-box` AND `green-line-breakout` EACH HAD TO LEARN. A
    walk with no recency gate reports wherever it happened to end; over 400 bars
    that turned "a breakout" into "a state entered some time in the last two
    years" — 10.58% of the universe instead of 4.28%.
    """
    fresh = _two_bottoms(0.09, tail=bc.UDB_MAX_AGE_BARS)
    stale = _two_bottoms(0.09, tail=bc.UDB_MAX_AGE_BARS + 1)
    assert _fires(fresh) is True, "the bound refuses at exactly its own value"
    assert _fires(stale) is False, "one session past the bound must refuse"
    assert (bc.ugly_double_bottom_state(fresh)["confirm_age_bars"]
            == bc.UDB_MAX_AGE_BARS)
    assert _lows(fresh)[-2:] == _lows(stale)[-2:], (
        "the stale fixture lost a pivot — it would refuse for the wrong reason")


def test_the_recency_bound_is_exactly_where_it_is_declared():
    """The knob is real: move it and the verdict moves with it. Without this a
    constant could be inert and every case above would still pass.
    """
    stale = _two_bottoms(0.09, tail=bc.UDB_MAX_AGE_BARS + 15)
    assert _fires(stale) is False
    original = bc.UDB_MAX_AGE_BARS
    try:
        bc.UDB_MAX_AGE_BARS = original + 30
        assert _fires(stale) is True, (
            "widening UDB_MAX_AGE_BARS changed nothing — the constant is inert, "
            "which is `lesson_a_measured_knob_is_inert_if_the_consumer_skips_"
            "its_stage`")
    finally:
        bc.UDB_MAX_AGE_BARS = original


# ── the classic double bottom is a DIFFERENT pattern, and stays one ──────────

def test_a_CLASSIC_double_bottom_does_not_fire_this_detector():
    """⛔⛔ THE WHOLE REASON THIS STRUCTURE EXISTS, STATED AS AN EXCLUSION.

    A second low at or below the first is the double bottom the rest of the
    world means. It must not be relabelled as Bulkowski's ugly one — the two
    make opposite claims about the same feature, and a member reading "Ugly
    Double Bottom" on a W would be reading the wrong pattern's statistics.
    """
    equal = _two_bottoms(0.0)
    undercut = _two_bottoms(-0.06)
    deep = _two_bottoms(-0.15)
    for bars, what in ((equal, "equal lows"), (undercut, "a 6% undercut"),
                       (deep, "a 15% undercut")):
        assert bc.ugly_double_bottom_state(bars) is None, (
            f"{what} fired the ugly double bottom — the second bottom must be "
            f"HIGHER, that is the definition")
        assert ",ugly-double-bottom," not in _matches(bars), what


def test_the_W_still_fires_on_the_undercut_the_ugly_one_refuses():
    """⭐ THE OTHER HALF, AND IT IS NOT THE SAME SENTENCE. Showing this detector
    stays silent proves nothing on its own — a fixture broken in some unrelated
    way is also silent. The undercut leg must be a shape the EXISTING W names.
    """
    m = _matches(_two_bottoms(-0.06))
    assert ",double-bottom," in m, m
    assert ",ugly-double-bottom," not in m, m


def test_one_skeleton_one_sign_flip_and_the_two_labels_never_meet():
    """⛔ THE OVERLAP, DRIVEN RATHER THAN ARGUED. One builder, one parameter, the
    SHIPPED `base_matches` string. Measured on the real universe the same way:
    80 symbols carry this, 137 carry the W, 0 carry both.
    """
    both, ugly, w = [], [], []
    for p in (-0.15, -0.10, -0.06, -0.02, 0.0, 0.02, 0.05, 0.09, 0.145, 0.20):
        m = _matches(_two_bottoms(p))
        u, d = ",ugly-double-bottom," in m, ",double-bottom," in m
        if u and d:
            both.append(p)
        if u:
            ugly.append(p)
        if d:
            w.append(p)
    assert not both, f"one symbol carried BOTH labels at second-leg {both}"
    assert ugly and all(p > 0 for p in ugly), ugly
    assert w and all(p < 0 for p in w), w


# ── one pivot authority ─────────────────────────────────────────────────────

def test_the_bars_reader_and_the_context_predicate_never_disagree():
    """⭐ `ugly_double_bottom_state(bars)` builds a context; the predicate is
    handed one. Both must read the SAME confirmed swings — a structure that
    found its own pivots would be a second authority on what a swing low is, and
    the two would drift the first time `zigzag` moved.
    """
    seen = set()
    for p in (-0.06, 0.0, 0.045, 0.05, 0.09, 0.145, 0.155):
        for confirm in (True, False):
            bars = _two_bottoms(p, confirm=confirm)
            a = bc.ugly_double_bottom_state(bars) is not None
            b = bc.by_key("ugly-double-bottom").detect(_ctx(bars))
            assert a == b, (p, confirm, a, b)
            seen.add(a)
    assert seen == {True, False}, (
        "the sweep never produced both verdicts, so agreement is vacuous")


def test_the_predicate_reads_swings_it_is_handed_and_never_segments_again():
    """The hot path must not re-run `zigzag.segment` (8.48 ms against a
    detector's ~0.3 ms, rebuilt per anchor by the lift harness). Proven by
    handing it a context whose swings have already been computed and asserting
    the context is not re-segmented — the cache object is identity-stable.
    """
    ctx = _ctx(_two_bottoms(0.09))
    _ = ctx.lows                                   # force the one segmentation
    before = ctx._seg
    assert bc.by_key("ugly-double-bottom").detect(ctx) is True
    assert ctx._seg is before, "the predicate re-segmented the context"


# ── provenance: the quotes are HIS words, and his numbers are HIS numbers ────

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    for a, b in (("’", "'"), ("‘", "'"), ("“", '"'),
                 ("”", '"'), ("—", "--"), ("–", "-"),
                 ("−", "-"), (" ", " ")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def _corpus() -> str:
    files = sorted(glob.glob(str(ROOT / "docs/superpowers/research/bases/*.md")))
    assert files, "the research corpus is missing — this audit would be vacuous"
    return _norm(" ".join(io.open(f, encoding="utf-8").read() for f in files))


def test_every_quote_is_VERBATIM_in_the_research_corpus():
    """⛔ A paraphrase in a `quote` field is a fabricated citation. The whole
    provenance grammar exists because `setup_templates` carried a Minervini
    breakout-volume figure a regex over his 218-page book cannot find.
    """
    corpus = _corpus()
    st = bc.by_key("ugly-double-bottom")
    quoted = [c for c in st.criteria if c.quote]
    assert len(quoted) >= 8, f"only {len(quoted)} quotes — the sweep is thin"
    for c in quoted:
        assert _norm(c.quote) in corpus, (
            f"not verbatim in the corpus: {c.quote!r}")


def test_the_verbatim_audit_can_actually_FAIL():
    """Non-vacuity control. An audit whose needle is always found is a comment.
    A plausible paraphrase of a real quote must be rejected.
    """
    corpus = _corpus()
    assert _norm("Recedes 80% of the time") in corpus
    assert _norm("Volume recedes eighty percent of the time") not in corpus
    assert _norm("the second bottom is significantly higher than the first") in corpus
    assert _norm("the second bottom is somewhat higher than the first") not in corpus


def test_every_criterion_is_in_exactly_one_provenance_state():
    st = bc.by_key("ugly-double-bottom")
    for c in st.criteria:
        sourced = c.value is not None and bool(c.quote) and bool(c.source_id)
        refused = c.value is None and bool(c.missing)
        ours = c.origin == "uct"
        assert sum([sourced, refused, ours]) == 1, c.condition
        if ours:
            assert not c.source_id, c.condition
    states = {("ours" if c.origin == "uct" else
               "refused" if c.value is None and c.missing else "sourced")
              for c in st.criteria}
    assert states == {"sourced", "refused", "ours"}, (
        f"only {states} occur — a structure exercising one state is not "
        f"evidence the grammar survived")


def test_the_numbers_we_supplied_are_declared_as_OURS_and_cite_nobody():
    st = bc.by_key("ugly-double-bottom")
    ours = [c for c in st.criteria if c.origin == "uct"]
    assert ours, "the recency bound and the history floor are ours"
    assert any(c.value == bc.UDB_MAX_AGE_BARS for c in ours), (
        "the recency bound must be recorded as a criterion, not only as a "
        "module constant")
    for c in ours:
        assert not c.source_id and not c.quote, c.condition


def test_the_sourced_band_is_the_number_the_code_actually_uses():
    """⛔ A quote beside a constant that disagrees with it is worse than no
    quote: it reads as verified. The criterion carries the pair the detector
    reads, not a retyped copy."""
    st = bc.by_key("ugly-double-bottom")
    band = [c for c in st.criteria if c.quote == "5-15% higher than first"]
    assert len(band) == 1
    assert band[0].value == (bc.UDB_MIN_RISE, bc.UDB_MAX_RISE)


# ── ⚠️ the hard part: HIS measurements are recorded, and are NOT our edge ────

def test_bulkowskis_performance_figures_are_RECORDED_as_his():
    """They are things he published, so they belong in the provenance — verbatim
    and under his id, with the population they were measured on beside them.
    """
    st = bc.by_key("ugly-double-bottom")
    quotes = {c.quote for c in st.criteria if c.quote}
    assert "Based on 4,376 perfect trades from July 1991 to July 2025" in quotes
    assert "41% versus 37% for regular double bottoms" in quotes
    assert "15% versus 16% for all double bottoms" in quotes
    for c in st.criteria:
        if c.quote in ("41% versus 37% for regular double bottoms",
                       "15% versus 16% for all double bottoms"):
            assert c.source_id == "bulkowski_ugly_double_bottom"
            assert "NOT OUR EDGE" in c.condition or "not ours" in c.condition, (
                "a vendor's win rate recorded without saying whose it is reads "
                "as ours the moment it is rendered")


def test_his_41_percent_is_NOT_in_our_coverage_number():
    """⛔⛔ THE SUBSTITUTION THIS LIBRARY REFUSES. `coverage_pct` is how often the
    label fires on OUR universe, measured through the shipped path. Bulkowski's
    41% rise / 15% failure / 64% throwback are his outcomes on his hand-vetted
    population and can never stand in for it.
    """
    st = bc.by_key("ugly-double-bottom")
    assert st.coverage_pct == 4.28, (
        "coverage must be the measured hit rate: 80 of 1,871 usable tickers "
        "through `bases.classify` -> `base_matches`, 2026-08-31")
    for forbidden in (41.0, 41, 15.0, 15, 64.0, 64, 37, 16, 63, 23):
        assert st.coverage_pct != forbidden, (
            f"coverage_pct reads {forbidden} — one of Bulkowski's published "
            f"figures has been pasted into our measured hit rate")


def test_the_structure_has_NO_lift_until_a_run_is_done():
    """⛔ `meta()` reads the ledger, never the catalog. An unmeasured structure
    surfaces None — not his number, and not a synthetic 0.0, which would claim
    "measured, and exactly break-even".
    """
    m = bc.meta()["ugly-double-bottom"]
    assert m["lift_pp"] is None, m
    assert m["lift_ci_pp"] is None and m["lift_n"] is None
    assert m["coverage_pct"] == 4.28


def test_the_ledger_row_is_refused_and_his_figures_never_became_our_lift():
    """⭐ THE PREMISE MOVED. This pinned the row as UNMEASURED with the
    source's own figures named in its refusal reasons. The structure has since
    been measured on our universe and refused for a measured reason, so the
    placeholder wording is gone — a strictly better state that turned this red.

    ⛔ THE GUARANTEE THAT MATTERS IS UNCHANGED and is restated here in the
    form that outlives the transition: the source's published figures may live
    in the catalog as a SOURCED CRITERION, and must never become the ledger's
    lift. That is the import this test exists to prevent.
    """
    from api.services.screener import lift_ledger as ll
    from api.services.screener import base_catalog as bc

    row = (ll.load().get("structures") or {}).get("ugly-double-bottom")
    assert row, "the structure has no ledger row — absence reads as 'fine'"
    assert row["published"] is False
    assert row["reasons"], "a refused row with no reason is a blank"

    # his numbers are a QUOTED criterion, with a source
    st = bc.by_key("ugly-double-bottom")
    quoted = [c for c in st.criteria
              if c.quote and "perfect trades" in c.quote.lower()]
    assert quoted, (
        "the source's own sample no longer appears as a sourced criterion — "
        "if it was deleted, say so; if it moved, point this rail at it")
    assert all(c.source_id for c in quoted), (
        "a quoted figure with no source_id is an unattributed import")

    # ⛔ AND IT IS NOT OUR MEASUREMENT. The ledger's lift, when there is one,
    # must come from OUR universe — never from the number in that quote.
    if row.get("lift") is not None:
        assert isinstance(row.get("sample_tickers"), int), (
            "a measured row must record the sample WE measured it on")
        assert bc.meta()["ugly-double-bottom"]["lift_pp"] is None, (
            "a refused row is surfacing a lift to members")
    assert ll.for_structure("ugly-double-bottom") is None


# ── registration ────────────────────────────────────────────────────────────

def test_it_is_registered_as_a_relation_with_a_unique_key_and_rank():
    st = bc.by_key("ugly-double-bottom")
    assert st is not None and st.axis == "relation"
    assert st in bc.RELATIONS
    ranks = [s.rank for s in bc.RELATIONS]
    assert len(ranks) == len(set(ranks)), "rank collision makes render order undefined"
    keys = [s.key for s in bc.ALL_STRUCTURES]
    assert len(keys) == len(set(keys))


def test_its_measured_coverage_is_in_the_informative_band():
    """Not dead (0), not noise (>35%) — the two verdicts that mean a structure
    should not ship as authored."""
    from tools import base_coverage

    st = bc.by_key("ugly-double-bottom")
    assert st.coverage_pct is not None and st.coverage_pct > 0
    assert base_coverage.classify(st.coverage_pct) == "ok", st.coverage_pct


def test_the_label_is_owned_by_this_axis_alone():
    """A second axis answering "Ugly Double Bottom" would let a member read two
    verdicts under one name. Derived, never typed."""
    from api.services.screener import bar_character as bch
    from api.services.screener import filters as flt

    label = bc.by_key("ugly-double-bottom").label.lower()
    others = [c.label.lower() for c in bch.CASCADE]
    others += [f.get("label", "").lower() for f in flt.FILTERS.values()
               if isinstance(f, dict) and f.get("label")]
    assert others, "the sweep saw no other axis — its verdict would be vacuous"
    assert label not in others
