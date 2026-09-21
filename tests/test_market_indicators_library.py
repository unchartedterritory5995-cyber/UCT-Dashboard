"""NAMING · REGISTRY · PRODUCERS · SERIES · DISCOVERY — the library's standing rails.

Grouped in one file because they test one thing from five angles: a canonical market
series is described once, named by rule, produced deterministically, served in the one
bar shape, and found by search — with no second engine and no reachable series whose
inputs do not exist.
"""
from __future__ import annotations

import pytest

from api.services.market_indicators import mcclellan as mc
from api.services.market_indicators import naming
from api.services.market_indicators import producers
from api.services.market_indicators import registry as reg
from api.services.market_indicators import series as mseries
from api.services.market_indicators import validation as val


# ══════════════════════════════════════════════════════════════════════════
# NAMING — the five rules, as behaviour
# ══════════════════════════════════════════════════════════════════════════

def test_rule2_universe_metric_is_a_function_not_typed_strings():
    """One rule applied N times. The fifth universe must not need a new string."""
    f = naming.universe_metric_display
    assert f("uct", "% of Stocks Above 50-Day MA") == "UCT · % of Stocks Above 50-Day MA"
    assert f("us", "% of Stocks Above 50-Day MA") == "US · % of Stocks Above 50-Day MA"
    assert f("nasdaq", "% of Stocks Above 50-Day MA") == "Nasdaq · % of Stocks Above 50-Day MA"
    assert f("nyse", "% of Stocks Above 50-Day MA") == "NYSE · % of Stocks Above 50-Day MA"


def test_the_display_label_is_not_the_identity_label():
    """⛔⛔ RULE 4 AT THE UNIVERSE LEVEL. `breadth_universes.label()` mints symbols —
    `NASDAQ:A50` — and is frozen by every stored layout that holds one. The prose form
    is `Nasdaq`. Merging them would silently rename shipped identities."""
    from api.services import breadth_universes as bu
    assert bu.label("nasdaq") == "NASDAQ"
    assert naming.universe_display("nasdaq") == "Nasdaq"


def test_an_unknown_universe_degrades_rather_than_raising():
    assert naming.universe_display("atlantis")
    assert naming.universe_metric_display("atlantis", "Thing")


def test_rule1_an_established_name_needs_reproduction_AND_a_passing_report():
    """⛔ ACCURACY BEFORE BRANDING, enforced rather than intended."""
    ok_report = val.MatrixReport(compared=10)
    bad_report = val.MatrixReport(compared=10, failures=[object()])

    assert not naming.established_name_allowed(reproduces_reference=False,
                                               validation_report=ok_report)
    assert not naming.established_name_allowed(reproduces_reference=True,
                                               validation_report=None)
    assert not naming.established_name_allowed(reproduces_reference=True,
                                               validation_report=bad_report)
    assert naming.established_name_allowed(reproduces_reference=True,
                                           validation_report=ok_report)


def test_assert_established_name_raises_rather_than_warning():
    with pytest.raises(naming.EstablishedNameRefused):
        naming.assert_established_name("NYMO", reproduces_reference=False)


def test_the_us_mcclellan_does_not_claim_to_reproduce_a_reference():
    """⛔⛔ THE CENTRAL NAMING CLAIM OF THE WHOLE PROJECT. A McClellan Oscillator over
    UCT's US common-stock universe is a different census from the NYSE composite NYMO
    is computed over. It is named honestly and it does NOT assert Rule 1."""
    us = reg.get("US:MCO")
    assert us.reproduces_reference is False
    assert us.display == "US · McClellan Oscillator"
    assert "NOT NYMO" in us.methodology
    assert "NYMO" not in us.symbol


# ══════════════════════════════════════════════════════════════════════════
# REGISTRY — identity, dormancy, capability
# ══════════════════════════════════════════════════════════════════════════

def test_membership_is_a_registry_lookup_never_a_shape_test():
    """`US:MCO` and `US:NOPE` have the identical shape."""
    assert reg.is_market_indicator("US:MCO")
    assert not reg.is_market_indicator("US:NOPE")
    assert not reg.is_market_indicator("FOO:BAR")
    assert not reg.is_market_indicator("NASDAQ:AAPL")
    assert not reg.is_market_indicator("")


def test_the_dormant_mcclellan_family_is_registered_and_unreachable():
    """⛔⛔ NYMO/NYSI/NAMO/NASI EXIST AS DESIGN AND NOT AS SERIES.

    They must be describable — a reviewer asks what they would be and why they are not
    here — and simultaneously impossible to resolve, chart or discover.
    """
    for sym in ("NYMO", "NYSI", "NAMO", "NASI"):
        assert reg.resolve(sym) is None, f"{sym} must not resolve"
        assert not reg.is_market_indicator(sym)
        described = reg.resolve(sym, include_dormant=True)
        assert described is not None, f"{sym} must still be described"
        assert described.blocked_on, f"{sym} must say WHY it is dormant"
        assert described.status == reg.ST_DORMANT


def test_a_dormant_series_serves_no_bars():
    for sym in ("NYMO", "NYSI", "NAMO", "NASI"):
        assert mseries.build_bars(sym)["bars"] == []


def test_the_dormant_rows_name_their_exact_data_dependency():
    assert "nyse" in reg.resolve("NYMO", include_dormant=True).blocked_on.lower()
    assert "nasdaq" in reg.resolve("NAMO", include_dormant=True).blocked_on.lower()
    # and the 2011 attribution floor is stated, not implied
    assert "2011" in reg.resolve("NYMO", include_dormant=True).blocked_on


def test_vix_is_dormant_because_something_else_already_serves_it():
    """⛔ TWO PRODUCERS BEHIND ONE SYMBOL IS THE DEFECT, not the deep history."""
    row = reg.resolve("VIX", include_dormant=True)
    assert row.status == reg.ST_DORMANT
    assert "index_bars" in row.blocked_on
    assert reg.resolve("VIX") is None


def test_aliases_resolve_and_collisions_are_impossible():
    assert reg.resolve("SENT:NAAIM").id == "SENT:NAAIM"
    assert reg.resolve("NAAIM").id == "SENT:NAAIM"
    assert reg.resolve("$VVIX").id == "CBOE:VVIX"
    # the registry raises at import on a duplicate alias, so a clash cannot ship
    keys = [k for s in reg._ROWS
            for k in naming.search_tokens(s.id, s.symbol, s.aliases)]
    assert len(keys) == len(set(keys))


def test_candles_are_claimed_per_series_not_per_family():
    """⛔⛔ Cboe publish VIX as OHLC and VVIX/SKEW as a single close. A family-level
    capability draws a candlestick over a synthesised o=h=l=c that means nothing."""
    assert reg.get("CBOE:VIX9D").ohlc_capable is True
    assert reg.get("CBOE:VVIX").ohlc_capable is False
    assert reg.get("CBOE:SKEW").ohlc_capable is False
    assert reg.get("US:MCO").ohlc_capable is False
    assert reg.get("SENT:NAAIM").ohlc_capable is False


def test_every_published_row_carries_the_metadata_a_consumer_needs():
    for s in reg.published_rows():
        r = s.to_row()
        for k in ("id", "symbol", "display", "short", "family", "family_label",
                  "source_type", "frequency", "unit", "domain", "presentation",
                  "methodology", "provenance", "source_owner", "licensing",
                  "observation_semantics", "knowledge_semantics"):
            assert r.get(k) not in (None, ""), f"{s.id} is missing {k}"


def test_the_weekly_survey_declares_weekly_and_step():
    n = reg.get("SENT:NAAIM")
    assert n.frequency == reg.FREQ_WEEKLY
    assert n.presentation == reg.PRES_STEP
    # Case-insensitive: the prose emphasises WEDNESDAY in caps, and a rail that
    # pins the casing of a sentence is a rail that breaks on a copy-edit.
    assert "wednesday" in n.observation_semantics.lower()
    assert "thursday" in n.knowledge_semantics.lower()


def test_the_naaim_row_records_the_licensing_position():
    lic = reg.get("SENT:NAAIM").licensing
    assert "Program Partner" in lic and "1,500" in lic


# ══════════════════════════════════════════════════════════════════════════
# PRODUCERS — the generic engine, proven against a real published series
# ══════════════════════════════════════════════════════════════════════════

@pytest.fixture
def reference_universe(monkeypatch):
    """Point the producers at McClellan's own NYSE advances/declines.

    ⭐⭐ THIS IS THE INTEGRATION PROOF. The engine is already verified in isolation;
    this proves the PRODUCER — the store reader, the alignment, the anchor derivation —
    hands the engine what it expects and gets a real published series back. Patching
    the two store-reading functions is the whole isolation, which is why they are the
    only place `producers` touches breadth.
    """
    rows = val.load_reference_fixture()
    dates = [r["date"] for r in rows]
    adv = [r["advances"] for r in rows]
    dec = [r["declines"] for r in rows]
    net = [a - d for a, d in zip(adv, dec)]

    def fake_pair(a, b, universe, limit=0):
        return dates, adv, dec

    def fake_closes(metric, universe, limit=0):
        return (dates, net) if metric == "adv_decline" else (dates, adv)

    monkeypatch.setattr(producers, "load_pair", fake_pair)
    monkeypatch.setattr(producers, "load_metric_closes", fake_closes)
    producers.invalidate()
    yield rows
    producers.invalidate()


def test_the_producer_reproduces_the_published_oscillator(reference_universe):
    """The producer + engine together, against real published numbers, graded by the
    reusable matrix — the same harness a future NYMO validation will run."""
    rows = reference_universe
    res = producers.mcclellan_for_universe("nyse", method=mc.CLASSIC)
    assert res is not None

    seed = mc.TrendState(ema19=rows[0]["ref_trend_10pct"],
                         ema39=rows[0]["ref_trend_5pct"], n=1)
    rep = val.run_matrix([r["date"] for r in rows[1:]],
                         [r["advances"] for r in rows[1:]],
                         [r["declines"] for r in rows[1:]],
                         universe="nyse", method=mc.CLASSIC, seed_state=seed,
                         ref_oscillator=[r["ref_oscillator"] for r in rows[1:]])
    assert rep.ok, rep.summary()
    assert rep.max_osc_diff < val.EXACT_TOLERANCE


def test_the_summation_anchor_is_derived_and_sits_past_the_burn_in(reference_universe):
    rows = reference_universe
    res = producers.mcclellan_for_universe("nyse", want_summation=True)
    assert res is not None and res.anchor is not None
    assert res.anchor.source == "declared"
    assert res.anchor.value == mc.RATIO_ADJUSTED.summation_base == 0.0
    idx = res.dates.index(res.anchor.at)
    assert idx >= mc.DEFAULT_BURN_IN
    assert res.summation[idx - 1] is None, "undefined before the epoch"
    assert res.summation[idx] == pytest.approx(0.0)


def test_the_derivation_is_deterministic_across_rebuilds(reference_universe):
    """⛔ ONE FORWARD PASS, EVERY TIME. A cumulative series whose level depends on how
    often the job ran is not reproducible."""
    producers.invalidate()
    a = producers.mcclellan_for_universe("nyse", want_summation=True)
    producers.invalidate()
    b = producers.mcclellan_for_universe("nyse", want_summation=True)
    assert a.summation == b.summation
    assert a.anchor.at == b.anchor.at


def test_the_ad_line_is_a_single_forward_cumulation(reference_universe):
    rows = reference_universe
    ds = producers.ad_line_for_universe("nyse")
    assert ds is not None and ds.epoch == rows[0]["date"]
    running = 0.0
    for i, r in enumerate(rows):
        running += r["advances"] - r["declines"]
        assert ds.values[i] == pytest.approx(running)


def test_zweig_is_a_ten_day_ema_of_the_advance_ratio(reference_universe):
    rows = reference_universe
    ds = producers.zweig_for_universe("nyse")
    assert ds is not None
    a = rows[0]["advances"] / (rows[0]["advances"] + rows[0]["declines"])
    assert ds.values[0] == pytest.approx(a)
    alpha = 2.0 / 11
    r1 = rows[1]["advances"] / (rows[1]["advances"] + rows[1]["declines"])
    assert ds.values[1] == pytest.approx((1 - alpha) * a + alpha * r1)
    assert all(v is None or 0.0 <= v <= 1.0 for v in ds.values)


def test_the_thrust_EVENT_is_separate_from_the_continuous_series(reference_universe):
    """⛔ Zweig's signal has fired ~13 times since 1944. A chart of events would be
    empty for years; the continuous ratio is the series and the event is a marker."""
    ds = producers.zweig_for_universe("nyse")
    ev = producers.thrust_events(ds.dates, ds.values)
    assert isinstance(ev, list)
    for e in ev:
        assert e["sessions"] <= producers.ZWEIG_WINDOW
        assert e["value"] > producers.ZWEIG_THRUST


def test_a_thrust_requires_speed_not_merely_the_levels():
    """A slow climb through 0.40 → 0.615 does not qualify."""
    dates = [f"2026-01-{d:02d}" for d in range(1, 26)]
    slow = [0.35] + [0.40 + 0.012 * i for i in range(24)]   # crosses late, >10 sessions
    assert producers.thrust_events(dates, slow[:25]) == []
    fast = [0.30, 0.32, 0.35, 0.70] + [0.70] * 21
    assert producers.thrust_events(dates, fast[:25])


def test_a_universe_with_no_history_produces_nothing_rather_than_an_empty_series(monkeypatch):
    monkeypatch.setattr(producers, "load_pair", lambda *a, **k: ([], [], []))
    monkeypatch.setattr(producers, "load_metric_closes", lambda *a, **k: ([], []))
    producers.invalidate()
    assert producers.mcclellan_for_universe("nasdaq") is None
    assert producers.ad_line_for_universe("nasdaq") is None
    assert producers.zweig_for_universe("nasdaq") is None


def test_a_missing_session_is_a_hole_not_a_zero(monkeypatch):
    dates = ["2026-01-02", "2026-01-05", "2026-01-06"]
    monkeypatch.setattr(producers, "load_pair",
                        lambda *a, **k: (dates, [600, None, 700], [400, None, 300]))
    producers.invalidate()
    res = producers.mcclellan_for_universe("us")
    assert res.oscillator[1] is None


# ══════════════════════════════════════════════════════════════════════════
# SERIES — one bar shape, honest cadence
# ══════════════════════════════════════════════════════════════════════════

def test_every_served_bar_uses_an_iso_day_key(reference_universe, monkeypatch):
    """⛔⛔ THE REASON THE VOLATILITY LANE EXISTS. `symbolProjection` joins on exact
    `t`; `index_bars` emits unix seconds and therefore matches zero bars in a pane."""
    bars = mseries.daily_bars("US:MCO")
    assert bars
    for b in bars[:5]:
        assert isinstance(b["t"], str) and len(b["t"]) == 10 and b["t"][4] == "-"


def test_intraday_collapses_to_daily_rather_than_erroring(reference_universe):
    out = mseries.build_bars("US:MCO", "5")
    assert out["tf"] == "D"


def test_weekly_resampling_keys_to_the_week_friday():
    daily = [{"t": "2026-03-02", "o": 1, "h": 2, "l": 1, "c": 2, "v": 0},
             {"t": "2026-03-03", "o": 2, "h": 5, "l": 0, "c": 3, "v": 0}]
    w = mseries.resample(daily, "W")
    assert len(w) == 1 and w[0]["t"] == "2026-03-06"      # that week's Friday
    assert (w[0]["o"], w[0]["h"], w[0]["l"], w[0]["c"]) == (1, 5, 0, 3)


def test_a_weekly_survey_is_held_flat_across_daily_sessions_never_interpolated():
    """⭐ HOLD-LAST-KNOWN-VALUE STATES A FACT; a sloped line between observations
    would invent one. Every carried bar is flat."""
    pts = [{"t": "2026-03-04", "v": 50.0}, {"t": "2026-03-11", "v": 70.0}]
    cal = ["2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09",
           "2026-03-10", "2026-03-11"]
    bars = mseries.step_to_daily(pts, cal)
    assert [b["t"] for b in bars] == cal
    assert [b["c"] for b in bars] == [50.0, 50.0, 50.0, 50.0, 50.0, 70.0]
    for b in bars[1:5]:
        assert b["o"] == b["h"] == b["l"] == b["c"], "a carried bar must be flat"
    assert 50.0 not in (bars[-1]["c"],)                   # the step lands, not a ramp


def test_the_carry_is_capped_so_one_reading_cannot_paper_over_a_dead_feed():
    """⛔ The rule `cboe_putcall` was removed from the fill list for violating: 86 of
    150 stored rows held the previous session's value."""
    pts = [{"t": "2026-03-04", "v": 50.0}]
    cal = ["2026-03-05", "2026-03-20", "2026-04-30"]
    bars = mseries.step_to_daily(pts, cal, max_carry_days=12)
    assert [b["t"] for b in bars] == ["2026-03-05"]


def test_no_observation_is_manufactured_before_the_first_one():
    pts = [{"t": "2026-03-11", "v": 70.0}]
    cal = ["2026-03-04", "2026-03-11"]
    assert [b["t"] for b in mseries.step_to_daily(pts, cal)] == ["2026-03-11"]


def test_an_unknown_symbol_serves_an_empty_series_never_another_series_numbers():
    out = mseries.build_bars("US:NOPE")
    assert out["bars"] == [] and out["ticker"] == "US:NOPE"


# ══════════════════════════════════════════════════════════════════════════
# DISCOVERY — one system, both catalogues
# ══════════════════════════════════════════════════════════════════════════

def test_search_finds_a_market_indicator_by_its_display_name():
    from api.services.market_indicators import discovery as disc
    hits = {r["symbol"] for r in disc.search("McClellan", limit=20)}
    assert "US:MCO" in hits and "US:MCS" in hits


def test_search_finds_a_survey_by_its_established_symbol():
    from api.services.market_indicators import discovery as disc
    res = disc.search("NAAIM", limit=5)
    assert res and res[0]["symbol"] == "NAAIM"
    assert res[0]["score"] == 0 and res[0]["symbol_hit"] is True


def test_a_legacy_breadth_symbol_still_finds_its_metric():
    """⛔ RULE 5. `UCTA50` has been typed for a year and must keep working."""
    from api.services.market_indicators import discovery as disc
    res = disc.search("UCTA50", limit=5)
    assert res and res[0]["symbol"] == "UCTA50"
    assert res[0]["display"] == "UCT · % of Stocks Above 50-Day MA"


def test_a_numeric_token_does_not_match_inside_a_longer_number():
    """⚰️ MEASURED: `50 day` returned `Cboe S&P 500 9-Day Volatility Index`, because
    "50" occurs inside "500". A confident, plausible, irrelevant answer."""
    from api.services.market_indicators import discovery as disc
    hits = {r["symbol"] for r in disc.search("50 day", limit=20)}
    assert "VIX9D" not in hits
    assert any(h.endswith("A50") for h in hits)


def test_dormant_series_are_invisible_to_discovery():
    from api.services.market_indicators import discovery as disc
    for q in ("NYMO", "NASI", "NYSI", "NAMO"):
        assert disc.search(q, limit=10) == [], f"{q} must not be discoverable"
    assert any(r["symbol"] == "NASI"
               for r in disc.search("NASI", limit=10, include_dormant=True))


def test_the_catalogue_carries_both_catalogues_under_one_family_model():
    from api.services.market_indicators import discovery as disc
    cat = disc.catalogue()
    sources = {r["catalogue"] for r in cat["rows"]}
    assert "market_indicators" in sources and "breadth_library" in sources
    labels = {f["label"] for f in cat["families"]}
    assert {"McClellan", "Breadth", "Sentiment & Positioning", "Volatility"} <= labels


def test_the_catalogue_never_contains_a_dormant_row():
    from api.services.market_indicators import discovery as disc
    ids = {r["id"] for r in disc.catalogue()["rows"]}
    assert not ids & {s.id for s in reg.dormant_rows()}


# ══════════════════════════════════════════════════════════════════════════
# THE MEASURED FACTS THIS DESIGN RESTS ON
#
# ⛔⛔ Each of these was verified by a READ-ONLY probe of the production store on
# 2026-09-20 and then written into the code as a claim. A claim nobody re-reads is a
# claim that rots, so these rails fail when the code stops saying what was measured.
# ══════════════════════════════════════════════════════════════════════════

def test_trin_bpi_and_putcall_are_absent_and_the_registry_says_why():
    """⛔ ABSENT, NOT DORMANT — a decision not to have a row, recorded where a
    reviewer looks. And absent means unreachable through every door."""
    import inspect
    from api.services.market_indicators import registry as _reg
    for token in ("TRIN", "BPI", "UCTPC", "$CPCE"):
        assert _reg.resolve(token) is None
        assert _reg.resolve(token, include_dormant=True) is None
        assert not _reg.is_market_indicator(token)

    src = inspect.getsource(_reg)
    # The corrected TRIN position: derivable for US today, blocked on PRECISION and on
    # the exchange universes never being able to follow — not on "we cannot compute it".
    assert "TRIN / ARMS INDEX IS NOT REGISTERED" in src
    assert "up_vol_ratio" in src and "round(..., 2)" in src
    assert "point-and-figure" in src          # the BPI reason
    assert "QUARANTINED" in src               # the UCTPC position


def test_the_uct_ratio_adjusted_mcclellan_names_its_real_blocker():
    """The first audit said "only from 2026-03-16". The store says 15 rows."""
    row = reg.resolve("UCT:MCO", include_dormant=True)
    assert row is not None and row.status == reg.ST_DORMANT
    assert "15" in row.blocked_on, "the blocker must carry the measured row count"
    assert "UCTMC" in row.blocked_on, "it must name the series it would collide with"
    assert row.history_start is None, (
        "claiming a history_start for a series with 15 source rows would be a "
        "coverage promise the data cannot keep")


def test_the_shipped_uctmc_is_not_touched_by_this_package():
    """⛔ NO RENAME, NO MIGRATION, NO DELETION. `UCTMC` stays a breadth-library symbol
    served by the breadth path; nothing here may claim it."""
    assert reg.resolve("UCTMC", include_dormant=True) is None
    assert not reg.is_market_indicator("UCTMC")
    # and the new ratio-adjusted row must not alias itself onto the legacy identity
    row = reg.resolve("UCT:MCO", include_dormant=True)
    assert "UCTMC" not in [a.upper() for a in row.aliases]
    assert "Ratio-Adjusted" in row.display


# ══════════════════════════════════════════════════════════════════════════
# THE SUMMATION'S ABSOLUTE LEVEL — pinned, not derived
# ══════════════════════════════════════════════════════════════════════════

def test_the_us_summation_level_is_defined_in_the_registry_not_discovered():
    """⛔⛔ THE CANONICAL DEFINITION OF THE LEVEL LIVES IN ONE PLACE.

    "the cumulative sum of the ratio-adjusted US McClellan Oscillator since
     2008-06-24, taking the value 0 on that session."

    Deriving the epoch per build is deterministic only while the dataset's start never
    moves. A backfill that added 2007 sessions would shift it and silently re-level
    every historical value — the curve would still look right.
    """
    row = reg.get("US:MCS")
    assert row.summation_epoch == "2008-06-24"
    assert row.summation_base == 0.0
    assert row.summation_anchor_source == "declared"
    assert row.summation_base == mc.RATIO_ADJUSTED.summation_base, (
        "the base must be the VARIANT's neutral level, not an arbitrary number")


def test_the_pinned_epoch_sits_exactly_at_the_burn_in():
    """The pin is not a free parameter: it is the first session with DEFAULT_BURN_IN
    real observations behind it, given the store's measured start of 2008-01-02."""
    row = reg.get("US:MCS")
    assert row.summation_epoch > (reg.get("US:MCO").history_start or "")
    # 120 sessions after 2008-01-02 lands in mid-2008; a pin outside that window would
    # mean the burn-in and the pin had drifted apart.
    assert "2008-0" in row.summation_epoch


def test_a_pinned_epoch_missing_from_the_data_is_refused_not_re_derived(monkeypatch):
    """⛔⛔ THE DRIFT GUARD. Falling back to a derived epoch when the pinned one is
    absent would re-level the series the moment the source changed shape, silently."""
    dates = [f"2026-0{1 + i // 28}-{1 + i % 28:02d}" for i in range(200)]
    monkeypatch.setattr(producers, "load_pair",
                        lambda *a, **k: (dates, [600] * 200, [400] * 200))
    producers.invalidate()
    out = producers.mcclellan_for_universe(
        "us", anchor=mc.Anchor(at="1999-01-04", value=0.0, source="declared"))
    assert out is None


def test_nothing_is_served_before_the_epoch(monkeypatch):
    """⛔ NO FAKE SUMMATION VALUES DURING WARMUP. The series is UNDEFINED before its
    epoch, and an undefined point is not a bar."""
    dates = [f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(200)]
    monkeypatch.setattr(producers, "load_pair",
                        lambda *a, **k: (dates, [600] * 200, [400] * 200))
    monkeypatch.setattr(producers, "load_metric_closes",
                        lambda *a, **k: (dates, [200] * 200))
    producers.invalidate()
    res = producers.mcclellan_for_universe(
        "us", anchor=mc.Anchor(at=dates[120], value=0.0, source="declared"))
    assert res is not None
    assert all(v is None for v in res.summation[:120])
    assert res.summation[120] == pytest.approx(0.0)
    # and the served bars start AT the epoch, never before it
    ds = producers.DerivedSeries("US:MCS", res.dates, res.summation, "us", "v")
    pts = ds.as_points()
    assert pts[0]["t"] == dates[120]
    assert len(pts) == len(dates) - 120


def test_the_oscillator_is_served_from_the_first_session_but_the_summation_is_not():
    """They answer different questions: the oscillator forgets its seed, the level
    never does. Serving both from session 1 would be the bug."""
    assert reg.get("US:MCO").summation_epoch is None
    assert reg.get("US:MCS").summation_epoch is not None


def test_the_dormant_exchange_summations_carry_no_declared_level_yet():
    """⛔ NYSI/NASI will be anchored to a PUBLISHED reference value, which is what makes
    their level comparable rather than merely self-consistent. Pinning a declared one
    now would bake in the wrong strategy."""
    for sym in ("NYSI", "NASI"):
        row = reg.resolve(sym, include_dormant=True)
        assert row.summation_epoch is None
        assert "anchor" in row.blocked_on.lower()


# ══════════════════════════════════════════════════════════════════════════
# WHAT THE ZERO-ERROR REFERENCE RESULT DOES AND DOES NOT PROVE
# ══════════════════════════════════════════════════════════════════════════

def test_the_reference_reproduction_supplies_its_own_initial_conditions():
    """⛔⛔ NO AMBIGUITY ABOUT WHAT THE 0.000000000 MEANS.

    The zero-error replay seeds the trends from the REFERENCE'S OWN published 10%/5%
    values and anchors the summation at the REFERENCE'S OWN published level. It is a
    test of the RECURRENCE with initial conditions given — and it is therefore NOT a
    validation of `SEED_ZERO` or of `DEFAULT_BURN_IN`, which are the COLD-START
    strategy for the case where no such preceding state exists (ours).

    The two are connected by a separate measurement — the cold replay against the same
    published series — which is what `DEFAULT_BURN_IN` is derived from.
    """
    rows = val.load_reference_fixture()
    seeded = mc.TrendState(ema19=rows[0]["ref_trend_10pct"],
                           ema39=rows[0]["ref_trend_5pct"], n=1)
    assert seeded.ema19 is not None and seeded.ema39 is not None, (
        "the fixture supplies preceding state; that is the point")

    # Cold, with the shipped strategy, the FIRST oscillator is nowhere near the
    # reference — the seed has not been forgotten yet.
    cold = mc.compute([r["date"] for r in rows[:5]],
                      [r["advances"] for r in rows[:5]],
                      [r["declines"] for r in rows[:5]], method=mc.CLASSIC)
    assert abs(cold.oscillator[1] - rows[1]["ref_oscillator"]) > 10.0, (
        "if a cold start matched immediately, the burn-in would be unnecessary — and "
        "this test would be the thing that noticed")


def test_the_reference_anchor_is_labelled_as_a_reference_not_as_a_declaration():
    """The provenance of a level is part of the level. A reference anchor is exempt
    from the burn-in gate precisely because its authority comes from outside."""
    a = mc.Anchor(at="2026-01-02", value=1698.5, source="reference:mcclellan")
    assert a.source.startswith("reference:")
    d = mc.Anchor(at="2026-01-02", value=0.0, source="declared")
    assert not d.source.startswith("reference:")


# ── The unauthenticated status route may not be a thread sink ────────────────

def test_availability_is_cached_so_the_open_route_cannot_hold_a_worker(monkeypatch):
    """⛔⛔ MEASURED ON PRODUCTION AT 87 SECONDS, on a route with NO AUTH.

    `availability()` materialises every published series to count its points. A
    caller could hold a web worker for a minute and a half at will, and a handful
    in parallel would exhaust the pod's threadpool.
    """
    from api.services.market_indicators import series as ms
    calls = []
    monkeypatch.setattr(ms, "_avail_cache", None, raising=False)
    monkeypatch.setattr(ms, "_availability_uncached",
                        lambda: (calls.append(1), {"X": {"points": 1}})[1])
    a = ms.availability()
    b = ms.availability()
    c = ms.availability()
    assert a == b == c
    assert len(calls) == 1, f"recomputed {len(calls)} times — the cache is not holding"


def test_a_concurrent_caller_gets_the_previous_snapshot_rather_than_queueing():
    """⚠️ STALE BEATS BLOCKED. While one thread computes, others must return at once."""
    from api.services.market_indicators import series as ms
    ms._avail_cache = (0.0, {"OLD": {"points": 7}})      # expired, but present
    ms._avail_lock.acquire()                             # pretend a computation is running
    try:
        got = ms.availability()
    finally:
        ms._avail_lock.release()
        ms._avail_cache = None
    assert got == {"OLD": {"points": 7}}, "a waiter must be served, not queued"


def test_with_no_snapshot_at_all_a_concurrent_caller_still_does_not_block():
    from api.services.market_indicators import series as ms
    ms._avail_cache = None
    ms._avail_lock.acquire()
    try:
        assert ms.availability() == {}
    finally:
        ms._avail_lock.release()


def test_the_warm_door_exists_and_is_called_off_the_request_path():
    import inspect
    from api.services.market_indicators import series as ms
    import api.main as main
    assert callable(ms.warm_availability)
    assert "warm_availability" in inspect.getsource(main)


def test_the_status_route_never_computes_availability_on_the_request_thread():
    """⛔⛔ THE UNAUTHENTICATED ROUTE READS A SNAPSHOT, FULL STOP.

    Computing here measured 87s on production. The handler must call the
    snapshot reader, never the computing one.
    """
    import inspect
    from api.routers import market_indicators as r
    src = inspect.getsource(r.indicator_status)
    assert "availability_snapshot()" in src
    assert "mseries.availability()" not in src, (
        "the status handler must not compute availability on the request thread")


def test_an_uncomputed_snapshot_is_distinguishable_from_an_empty_one():
    from api.services.market_indicators import series as ms
    ms._avail_cache = None
    assert ms.availability_snapshot() == ({}, False)
    ms._avail_cache = (9e18, {})          # computed, and genuinely empty
    try:
        assert ms.availability_snapshot() == ({}, True)
    finally:
        ms._avail_cache = None


def test_disabling_the_cboe_refresh_does_not_disable_the_availability_warm():
    """⚠️ A flag that switches off a second, unrelated job is a trap."""
    import inspect
    import api.main as main
    src = inspect.getsource(main)
    i = src.index("_market_indicator_jobs")
    block = src[i:i + 1400]
    w = block.index("warm_availability")
    c = block.index('MARKET_INDICATORS_CBOE_REFRESH')
    # the warm must sit OUTSIDE the cboe flag's block — i.e. after it, not nested under
    assert w > c
    assert "MARKET_INDICATORS_BOOT_JOBS" in src
