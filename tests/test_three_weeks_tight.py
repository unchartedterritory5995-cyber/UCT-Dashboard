"""Three Weeks Tight — IBD's add-on point, and the two readings of it.

⭐⭐ THE STRUCTURE THIS FILE EXISTS TO PIN IS A DISAGREEMENT. IBD publishes two
incompatible MEASUREMENTS of one pattern — consecutive weekly closes within
1.5%, and a whole-cluster span within 1% to 2% — and the corpus says outright
that "an implementation must name which sentence it implements". The catalog
names the PAIRWISE sentence. Several cases below assert that choice in both
directions, because a silent switch to the span reading would move a quarter of
the matched population and break nothing that a shape test could see.

⛔ EVERY "is None" CASE BELOW IS WORTHLESS WITHOUT THE CONTROL AT THE TOP. A
fixture builder with a typo produces a series that matches nothing, and then
every refusal case passes for the wrong reason. `test_the_baseline_fixture_
actually_fires` and `test_the_builder_really_produces_distinct_iso_weeks` are
what make the rest mean anything.
"""
import datetime as dt
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc
from api.services.screener import bases


# ── fixtures, built from PARTS so one condition can be disabled at a time ───
#
# ⛔ REAL CALENDAR DATES. `20240101 + i` produces 20240132, which is not a date;
# every consumer here parses `t` with `datetime.date`, and half of them would
# raise on that. Weeks are generated from a real Monday with real timedeltas.

MONDAY = dt.date(2024, 1, 1)          # a real Monday
KEY = ",three-weeks-tight,"


def _ymd(d: dt.date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _week(monday: dt.date, close: float, sessions: int = 5,
          midweek_close=None, high=None, with_high: bool = True) -> list:
    """One trading week. The LAST session's close is the weekly close.

    `midweek_close` lets a test move price violently inside the week without
    touching the close that the pattern is actually defined on — which is how
    "closes only, and the last one" is proved rather than assumed.
    """
    out = []
    for k in range(sessions):
        day = monday + dt.timedelta(days=k)
        last = (k == sessions - 1)
        c = close if last else (midweek_close if midweek_close is not None else close)
        bar = {"t": _ymd(day), "o": c, "l": c * 0.99, "c": c, "v": 1_000_000}
        if with_high:
            bar["h"] = high if (high is not None and last) else c * 1.005
        out.append(bar)
    return out


def series(weekly_closes, start: dt.date = MONDAY, **kw) -> list:
    """A daily series whose weekly closes are exactly `weekly_closes`."""
    per_week = kw.pop("per_week", {})
    out = []
    for i, c in enumerate(weekly_closes):
        out += _week(start + dt.timedelta(days=7 * i), c,
                     **{**kw, **per_week.get(i, {})})
    return out


#: The tight run IBD describes: three weekly closes inside 1.5% of each other.
TIGHT = [100.0, 100.9, 100.2]

#: Long enough for `bases.classify`, which refuses under `MIN_HISTORY` bars.
LEAD = [80.0 + 2.0 * i for i in range(12)]


def ctx_of(bars):
    return bases._context(bars, bars)


def fires(bars) -> bool:
    return bc._detect_three_weeks_tight(ctx_of(bars))


# ── THE CONTROLS — everything below them is vacuous without these ──────────

def test_the_baseline_fixture_actually_fires():
    """⛔ NON-VACUITY. If the tight fixture does not match, every refusal case
    in this file passes because the builder is broken, not because the rule is
    right. This is the case that fails first when that happens.
    """
    bars = series(TIGHT)
    st = bc.three_weeks_tight_state(bars)
    assert st is not None, "the baseline fixture produced no state at all"
    assert st["weeks"] == 3
    assert st["pairwise"] <= bc.TWT_MAX_PAIRWISE
    assert fires(bars), "the baseline fixture does not match — nothing below means anything"


def test_the_builder_really_produces_distinct_iso_weeks():
    """The second control, and it caught a real class of fixture bug: a builder
    stepping by days instead of weeks puts every bar in ONE ISO week, so the
    state returns None and every negative case below goes green.
    """
    bars = series([10.0, 11.0, 12.0, 13.0])
    assert len(bc._weekly_close_map(bars)) == 4
    assert bc._weekly_closes(bars) == [10.0, 11.0, 12.0, 13.0]


def test_the_shipped_path_names_it_not_just_the_predicate():
    """⛔ `bases.classify` + `base_matches` is what a member screens on. A
    predicate that fires while the orchestrator drops the key is the
    `lesson_built_tested_green_and_unreachable` shape, and no predicate test can
    see it.
    """
    bars = series(LEAD + TIGHT)
    out = bases.classify(bars)
    assert KEY in (out["base_matches"] or ""), out["base_matches"]
    # and the control: perturb the last week only, and the key must leave.
    loose = bases.classify(series(LEAD + [100.0, 100.9, 104.0]))
    assert KEY not in (loose["base_matches"] or "")


# ── the 1.5% pairwise threshold BINDS ──────────────────────────────────────

def _two_step(step_pct: float) -> list:
    """Three weekly closes whose every consecutive step is exactly `step_pct`."""
    a = 100.0
    b = a * (1 + step_pct)
    return series([a, b, a])          # up then back: both steps are the step


def test_a_step_just_inside_the_published_tolerance_matches():
    bars = _two_step(0.0149)
    st = bc.three_weeks_tight_state(bars)
    assert st["pairwise"] < bc.TWT_MAX_PAIRWISE
    assert fires(bars)


def test_a_step_just_outside_the_published_tolerance_does_not():
    bars = _two_step(0.0151)
    st = bc.three_weeks_tight_state(bars)
    assert st is not None, "the state must still be READ — only the gate refuses"
    assert st["pairwise"] > bc.TWT_MAX_PAIRWISE
    assert not fires(bars)


def test_the_boundary_itself_is_inclusive():
    """"exceeds 1.5%" is the published wording, so 1.5% exactly is still tight.

    ⛔ THE CLOSES ARE WRITTEN OUT, NOT COMPUTED, AND THAT IS THE WHOLE POINT.
    The first version of this case built them as `100 * (1 + 0.015)`, which is
    101.49999999999999 in binary — so the "boundary" it tested sat just INSIDE
    the boundary, and flipping the operator to `<` left it green. A boundary
    case that does not land on the boundary is a comment. `1.5 / 100` is exact
    in doubles and equals the literal `0.015`, so this one bites.
    """
    bars = series([100.0, 101.5, 100.0])
    st = bc.three_weeks_tight_state(bars)
    assert st["pairwise"] == bc.TWT_MAX_PAIRWISE, "the fixture missed the boundary"
    assert fires(bars)


def test_ONE_wide_step_is_enough_to_refuse_it():
    """The rule is on EACH close against the prior one, so the max step decides.
    A mean-of-the-steps implementation passes the first case and fails this one.
    """
    tight_then_wide = series([100.0, 100.1, 104.0])
    st = bc.three_weeks_tight_state(tight_then_wide)
    assert min(abs(st["closes"][1] - st["closes"][0]) / st["closes"][0],
               abs(st["closes"][2] - st["closes"][1]) / st["closes"][1]) < 0.0015
    assert st["pairwise"] > bc.TWT_MAX_PAIRWISE
    assert not fires(tight_then_wide)


# ── the two published readings, and WHICH ONE GATES ────────────────────────

def test_the_corpus_disagreement_case_matches_on_the_pairwise_reading():
    """⭐⭐ THE CASE THE RESEARCH FILE ITSELF NAMES: closes of 100.0 / 101.4 /
    102.8 have pairwise steps of 1.4% (tight under the sentence we implement)
    and a span of 2.8% (not tight under the sentence we do not). It MATCHES, and
    the span is carried in the state saying so. If someone silently switches the
    gate to the span reading, this is what goes red.
    """
    bars = series([100.0, 101.4, 102.8])
    st = bc.three_weeks_tight_state(bars)
    assert st["pairwise"] <= bc.TWT_MAX_PAIRWISE
    assert st["span"] > bc.TWT_MAX_SPAN
    assert fires(bars)


def test_the_mirror_case_proves_neither_reading_contains_the_other():
    """100 / 102 / 101: span 2.0% (inside the looser published span) and a 2.0%
    pairwise step (outside 1.5%). It does NOT match — which is the other half of
    the same claim, and the reason "take the looser", the saucer's and the
    double bottom's answer, is not available for this conflict.
    """
    bars = series([100.0, 102.0, 101.0])
    st = bc.three_weeks_tight_state(bars)
    assert st["span"] <= bc.TWT_MAX_SPAN
    assert st["pairwise"] > bc.TWT_MAX_PAIRWISE
    assert not fires(bars)


def test_the_span_is_measured_on_every_match_not_only_when_it_agrees():
    agree = bc.three_weeks_tight_state(series(TIGHT))
    assert agree["span"] == pytest.approx(0.009, abs=1e-9)
    disagree = bc.three_weeks_tight_state(series([100.0, 101.4, 102.8]))
    assert disagree["span"] == pytest.approx(0.028, abs=1e-9)


# ── three weeks is three weeks ─────────────────────────────────────────────

def test_two_weekly_closes_are_not_a_three_weeks_tight():
    assert bc.three_weeks_tight_state(series(TIGHT[:2])) is None
    assert not fires(series(TIGHT[:2]))


def test_a_fourth_tight_week_is_a_superset_and_still_matches():
    """IBD: "some three-weeks-tight pattern stretch into a four-weeks-tight".
    Reading the LAST three catches that case instead of missing it.
    """
    assert fires(series([100.5] + TIGHT))


def test_only_the_LAST_three_weeks_are_read():
    """⛔ RECENCY, and it is ours. Without it the walk reports wherever it
    ended — the lesson darvas-box, green-line-breakout and double-bottom each
    had to learn separately.
    """
    stale = series(TIGHT + [92.0, 108.0])
    assert not fires(stale), "a tight run five weeks ago is history, not a setup"
    # the control: the same three weeks, now the last three.
    assert fires(series([92.0, 108.0] + TIGHT))


# ── weekly closes: which bar is "the close" ────────────────────────────────

def test_violent_MIDWEEK_prices_do_not_break_the_pattern():
    """The pattern is defined on weekly CLOSES. A stock that swung 10% inside
    each week and still closed flat three Fridays running is exactly what IBD is
    pointing at, so an implementation reading daily closes fails here.
    """
    wild = series(TIGHT, per_week={0: {"midweek_close": 110.0},
                                   1: {"midweek_close": 90.0},
                                   2: {"midweek_close": 112.0}})
    assert fires(wild)
    # the control: move that variation onto the FRIDAY closes and it stops.
    assert not fires(series([110.0, 90.0, 112.0]))


def test_a_holiday_shortened_week_closes_on_its_last_session():
    """Friday is not always the last session traded. The convention is "the last
    close inside the ISO week", so a Mon-Thu week closes on Thursday.
    """
    bars = series(TIGHT, per_week={2: {"sessions": 4}})
    st = bc.three_weeks_tight_state(bars)
    assert st["closes"] == TIGHT
    assert fires(bars)


def test_week_settled_is_REPORTED_and_never_gates():
    """⚠️ A series ending mid-week still matches. Gating on a settled week would
    make the label a function of the weekday the scan ran and report zero on any
    snapshot that does not end on a Friday.
    """
    friday = series(TIGHT)
    midweek = series(TIGHT, per_week={2: {"sessions": 3}})   # ends Wednesday
    assert bc.three_weeks_tight_state(friday)["week_settled"] is True
    assert bc.three_weeks_tight_state(midweek)["week_settled"] is False
    assert fires(friday) and fires(midweek), "week_settled must not gate"


# ── the pivot reads `h`, over the pattern's own weeks ──────────────────────

def test_the_pivot_is_the_highest_INTRADAY_price_plus_a_dime():
    """The pattern is qualified on `c` and triggered on `h` — two different
    fields of the same three bars, and the corpus is explicit about it.
    """
    bars = series(TIGHT, per_week={1: {"high": 130.0}})
    st = bc.three_weeks_tight_state(bars)
    assert st["high"] == 130.0
    assert st["pivot"] == pytest.approx(130.0 + bc.TWT_PIVOT_PAD)
    assert st["pivot"] > max(st["closes"]), "a close-based pivot would sit lower"


def test_a_high_OUTSIDE_the_three_weeks_is_not_the_pivot():
    bars = series([100.5] + TIGHT, per_week={0: {"high": 400.0}})
    st = bc.three_weeks_tight_state(bars)
    assert st["high"] < 400.0
    assert st["pivot"] < 200.0


# ── degenerate input refuses, never raises ─────────────────────────────────

@pytest.mark.parametrize("bars", [
    [],
    None,
    series(TIGHT[:1]),
    series([0.0, 0.0, 0.0]),
    series(TIGHT, with_high=False),
])
def test_unreadable_input_refuses_quietly(bars):
    assert bc.three_weeks_tight_state(bars) is None
    assert bc._detect_three_weeks_tight(ctx_of(bars or [])) is False


# ── catalog registration + the provenance grammar, for THIS structure ──────

def test_it_is_registered_as_a_relation_with_a_predicate():
    st = bc.by_key("three-weeks-tight")
    assert st is not None, "not registered in the catalog"
    assert st in bc.RELATIONS
    assert st.axis == "relation" and callable(st.detect)
    assert st.bias == "bullish" and st.family == "Momentum Continuation"
    assert st.rank not in [s.rank for s in bc.RELATIONS if s.key != st.key]


def test_it_reads_as_a_published_classic_not_as_ours():
    st = bc.by_key("three-weeks-tight")
    assert bc.structure_origin(st) == "published"


def test_no_criterion_of_this_structure_is_in_two_provenance_states():
    """⛔ A REFUSAL THAT ALSO SETS origin='uct' IS TWO STATES AND FAILS THE
    LIBRARY-WIDE RAIL. Pinned here as well so the failure names this structure.
    """
    for c in bc.by_key("three-weeks-tight").criteria:
        sourced = c.value is not None and bool(c.quote) and bool(c.source_id)
        refused = c.value is None and bool(c.missing)
        ours = c.origin == "uct"
        assert sum([sourced, refused, ours]) == 1, c.condition


def test_the_conflict_is_recorded_on_both_sides():
    """The pairwise sentence we implement AND the span sentence we do not must
    each appear with their own quote and their own source id. Recording only the
    winner is how a conflict becomes a decision nobody can audit.
    """
    cs = bc.by_key("three-weeks-tight").criteria
    pairwise = [c for c in cs
                if c.value == bc.TWT_MAX_PAIRWISE and c.source_id and c.quote]
    span = [c for c in cs if c.quote and "highest close and the lowest" in c.quote]
    assert pairwise, "the implemented reading is not recorded with its quote"
    assert span, "the reading we did NOT implement is not recorded at all"
    assert {c.source_id for c in pairwise} != {c.source_id for c in span}, (
        "one source's words are attributed to the other's id")
    assert all(c.value != bc.TWT_MAX_SPAN for c in span), (
        "the span row must not publish a single threshold — '1% to 2%' is a "
        "range, and collapsing it invents IBD's number")


def test_the_unpublished_parts_are_refusals_and_say_what_is_missing():
    cs = bc.by_key("three-weeks-tight").criteria
    refusals = [c for c in cs if c.value is None]
    assert len(refusals) >= 3
    for c in refusals:
        assert c.missing and len(c.missing) > 40, c.condition
        assert c.origin != "uct", f"{c.condition}: a refusal may not also be ours"


def test_its_coverage_was_measured_and_lands_in_band():
    st = bc.by_key("three-weeks-tight")
    assert st.coverage_pct is not None, "shipped without measuring coverage"
    assert 0 < st.coverage_pct <= 35.0, st.coverage_pct


def test_the_ledger_carries_an_honest_refused_row():
    """⭐ THE PREMISE MOVED, AND THAT IS THE GOOD DIRECTION.

    This asserted `sample_tickers is None and sample_tickers_missing` — the
    honest shape of a structure that had been SHIPPED BUT NEVER MEASURED. It
    has since been measured on 1,123 tickers and refused with reasons that
    quote real numbers, which is a strictly stronger state; the test went red
    because it pinned the placeholder rather than the guarantee.

    ⛔ THE GUARANTEE, restated so it survives the next transition: the row
    must be VISIBLE, must be REFUSED, and its refusal must be MEASURED rather
    than a placeholder — the failure this guards is a structure that quietly
    carries no row at all, because absence reads as "fine".
    """
    from api.services.screener import lift_ledger as ll
    e = (ll.load().get("structures") or {}).get("three-weeks-tight")
    assert e is not None, "no ledger row — absence reads as 'fine'"
    assert e["published"] is False
    assert e["reasons"], "a refused row with no reason is a blank"
    if e.get("lift") is None:
        assert e.get("sample_tickers") is None and e["sample_tickers_missing"], (
            "an unmeasured row must say WHY its sample is absent")
    else:
        assert isinstance(e.get("sample_tickers"), int) and e["sample_tickers"] > 0, (
            "a measured row must record the sample it was measured on")
        assert any(str(round(e["lift"], 4)) in r for r in e["reasons"]), (
            "a measured refusal must quote the number it refused, or the next "
            "reader cannot tell a real measurement from a placeholder")
