"""EMA Crossback — the first structure in the library that is OURS end to end.

⭐ WHAT MAKES THIS ONE DIFFERENT TO TEST. Every other structure can be checked
against a published sentence. This one cannot: the 15-source corpus contains no
Kell material, so there is nothing to quote and no threshold to cite. The only
authority is our own playbook (`app/src/pages/modelbook/setupPlaybooks.js`), and
the cases below assert the behaviours that playbook actually names — above all
the mistake it names, "anticipating the reclaim before price actually crosses
back above the averages", which is a REFUSAL the predicate has to make.

⛔ SO THE PROVENANCE CASES ARE NOT CEREMONY. A structure with no source is
exactly the one that can drift into claiming authority it does not have, and
`structure_origin` reading "uct" is what puts the "not a published pattern"
badge on the member's screen.
"""
import sys, pathlib, datetime
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc

_DAY0 = datetime.date(2023, 1, 2)


def _bars(closes, highs=None, lows=None):
    """Build a bar series from closes. Highs/lows default to a tight envelope so
    a case can speak about closes alone without accidentally tripping a
    range-based gate."""
    out = []
    for i, c in enumerate(closes):
        h = highs[i] if highs else c * 1.01
        l = lows[i] if lows else c * 0.99
        d = _DAY0 + datetime.timedelta(days=i)
        out.append({"t": int(d.strftime("%Y%m%d")), "o": c, "h": h, "l": l,
                    "c": c, "v": 1_000_000})
    return out


def _setup(advance=1.2, dip_bars=8, dip=0.90, recover_bars=6, base=100.0,
           run_bars=140):
    """A series that satisfies the whole rule: a long advance, a pullback
    through the averages, then a reclaim.

    ⛔ BUILT FROM THE RULE'S OWN PARTS so a case can disable exactly one of them
    and nothing else — a fixture that can only be all-or-nothing cannot show
    WHICH criterion a change broke.
    """
    closes = [base * (1 + advance * (i / run_bars)) for i in range(run_bars)]
    top = closes[-1]
    closes += [top * (1 - (1 - dip) * (i + 1) / dip_bars) for i in range(dip_bars)]
    bottom = closes[-1]
    closes += [bottom * (1 + (top / bottom - 1) * 1.05 * (i + 1) / recover_bars)
               for i in range(recover_bars)]
    return _bars(closes)


# ─── the control, first ─────────────────────────────────────────────────────

def test_the_fixture_actually_fires_the_structure():
    """⛔ NON-VACUITY. Every negative case below asserts `is None`. If the
    baseline fixture did not fire, all of them would pass while measuring
    nothing at all."""
    assert bc.ema_crossback_state(_setup()) is not None


# ─── what our own playbook says ─────────────────────────────────────────────

def test_the_reclaim_must_have_HAPPENED_not_be_approaching():
    """⭐ THE MISTAKE OUR PLAYBOOK NAMES, made into a refusal: 'anticipating the
    reclaim before price actually crosses back above the averages.' A series
    that has fallen through the averages and is still under them must NOT
    fire, however close it is."""
    bars = _setup(recover_bars=6)
    # truncate the recovery so price is still below the fast EMA
    still_below = bars[:-6]
    assert bc.ema_crossback_state(still_below) is None


def test_a_stock_that_never_left_the_averages_is_not_a_crossback():
    """There is nothing to re-enter. A steady advance that never crosses back
    down through the fast EMA is not this setup."""
    closes = [100.0 * (1.004 ** i) for i in range(200)]
    assert bc.ema_crossback_state(_bars(closes)) is None


def test_an_old_reclaim_does_not_count():
    """The playbook's entry is 'as price holds and remounts'. A reclaim from
    months ago is a trend, not a re-entry — the recency bound is what keeps
    this a signal rather than a description."""
    bars = _setup()
    stale = bars + _bars([bars[-1]["c"] * (1.002 ** i)
                          for i in range(1, 40)])
    assert bc.ema_crossback_state(stale) is None


def test_no_prior_advance_means_nothing_to_re_enter():
    """A flat stock that dips and recovers satisfies the crossing mechanics and
    is still not the setup — our playbook calls it a re-entry into an ongoing
    trend."""
    assert bc.ema_crossback_state(_setup(advance=0.05)) is None


def test_the_prior_advance_threshold_is_a_real_boundary():
    """⛔ The 60% is OURS and swept, so the rail must show it BINDS rather than
    that it exists: a 20% advance is refused where a 120% one fires. Without
    this pair the constant could be deleted and every other case would pass."""
    assert bc.ema_crossback_state(_setup(advance=0.20)) is None
    assert bc.ema_crossback_state(_setup(advance=1.20)) is not None


def test_it_survives_a_series_too_short_to_judge():
    assert bc.ema_crossback_state(_bars([100.0] * 50)) is None
    assert bc.ema_crossback_state([]) is None


def test_the_state_reports_what_it_measured():
    """A predicate that returns a bare True cannot be audited. The state carries
    the advance it found and how far back the reclaim was."""
    st = bc.ema_crossback_state(_setup())
    assert st["advance"] > 0.6
    assert 0 <= st["reclaim_bars_ago"] <= bc.CB_RECLAIM_BARS
    assert st["fast"] > 0 and st["slow"] > 0


# ─── provenance: the part that matters most for a structure with no source ──

def test_the_structure_reads_as_OURS_not_as_a_published_pattern():
    st = bc._BY_KEY["ema-crossback"]
    assert bc.structure_origin(st) == "uct"
    assert not any(c.source_id for c in st.criteria), (
        "a source_id here would flip the badge and claim an authority that "
        "does not exist — the corpus contains no Kell material")


def test_no_criterion_carries_a_quote_it_cannot_have():
    st = bc._BY_KEY["ema-crossback"]
    for c in st.criteria:
        assert not c.quote, (
            f"{c.condition!r} carries a verbatim quote, but there is no "
            f"published text for this setup to quote from")


def test_the_unimplemented_short_leg_is_declared_a_refusal():
    """Our playbook trades this BOTH ways. Shipping only the long leg without
    saying so would present a subset of our own setup as the whole of it."""
    st = bc._BY_KEY["ema-crossback"]
    refusals = [c for c in st.criteria if c.value is None and c.missing]
    assert len(refusals) >= 2
    text = " ".join(c.missing for c in refusals).lower()
    assert "vwap" in text, "the short leg's refusal must say why it is absent"
    assert "corpus" in text, "the no-source refusal must name the gap"


def test_every_criterion_is_in_exactly_one_provenance_state():
    """⛔ THE ERROR THIS FILE'S SUBJECT ACTUALLY MADE. Both refusals originally
    carried `origin="uct"` as well as `value=None` + `missing`, putting them in
    two states at once. Repeated here so this structure carries its own guard
    rather than relying on the catalog-wide sweep to notice."""
    st = bc._BY_KEY["ema-crossback"]
    for c in st.criteria:
        states = [
            c.origin == "uct",
            c.value is None and bool(c.missing),
            bool(c.source_id) and c.value is not None,
        ]
        assert sum(states) == 1, f"{c.condition!r} is in {sum(states)} states"
