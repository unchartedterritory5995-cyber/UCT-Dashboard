"""FMP economic calendar — the week-ahead econ source.

Exists because ForexFactory's `ff_calendar_nextweek.json` 404s, so the calendar
payload carries zero econ events for any week but the current one.

D1 note (2026-09-03 A5 modernization): the raw `requests.get` transport moved
to `fmp_client.get_economic_calendar` (a typed D1 adapter call), so these
tests mock `fmp_client` rather than `requests.get` directly.
"""
from unittest import mock

from api.services import econ_calendar_fmp as fmp
from api.services import provider_errors as pe


def _row(event, date_utc, impact="Medium", country="US", est=1.0, prev=2.0):
    return {"event": event, "date": date_utc, "impact": impact,
            "country": country, "estimate": est, "previous": prev}


def _result(rows):
    return pe.ProviderResult(
        value=rows,
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"),
        licensing_class="R",
        freshness="end_of_day",
    )


def _fetch(rows, **kw):
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result(rows)):
        return fmp.fetch_us_econ_week("2026-08-03", "2026-08-07", **kw)


def test_utc_times_convert_to_et_through_a_real_timezone():
    """NFP is published 08:30 ET — 12:30 UTC in EDT, 13:30 UTC in EST. A fixed
    offset would be an hour wrong for half the year."""
    edt = _fetch([_row("Non Farm Payrolls", "2026-08-07 12:30:00", "High")])
    assert edt["2026-08-07"][0]["time"] == "8:30 AM"

    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result([_row("Consumer Price Index", "2026-01-13 13:30:00", "High")])):
        est = fmp.fetch_us_econ_week("2026-01-12", "2026-01-16")
    assert est["2026-01-13"][0]["time"] == "8:30 AM"


def test_non_us_rows_are_dropped():
    out = _fetch([
        _row("ECB Rate Decision", "2026-08-04 12:45:00", "High", country="EU"),
        _row("JOLTs Job Openings", "2026-08-04 14:00:00", "High"),
    ])
    assert [e["event"] for e in out["2026-08-04"]] == ["JOLTs Job Openings"]


def test_low_impact_is_dropped_but_a_fed_speaker_survives_it():
    out = _fetch([
        _row("Baltic Dry Index", "2026-08-04 14:00:00", "Low"),
        _row("Fed Chair Powell Speaks", "2026-08-04 18:00:00", "Low"),
    ])
    events = out.get("2026-08-04", [])
    assert [e["event"] for e in events] == ["Fed Chair Powell Speaks"]
    assert events[0]["is_fed"] is True


def test_inventory_and_mortgage_noise_is_filtered():
    """These took 3 of Wednesday's 8 slots while ADP competed for the same room."""
    out = _fetch([
        _row("MBA 30-Year Mortgage Rate", "2026-08-05 11:00:00"),
        _row("EIA Crude Oil Stocks Change", "2026-08-05 14:30:00"),
        _row("EIA Gasoline Stocks Change", "2026-08-05 14:30:00"),
        _row("API Crude Oil Stock Change", "2026-08-04 20:30:00"),
        _row("ADP Employment Change", "2026-08-05 12:15:00"),
    ])
    assert [e["event"] for e in out["2026-08-05"]] == ["ADP Employment Change"]
    assert "2026-08-04" not in out


def test_a_busy_day_keeps_the_marquee_release_and_drops_the_filler():
    """Selection is by importance; presentation is by time."""
    rows = [_row(f"Filler Number {i}", f"2026-08-07 11:{i:02d}:00", "Medium")
            for i in range(10)]
    rows.append(_row("Non Farm Payrolls", "2026-08-07 12:30:00", "High"))
    out = _fetch(rows, limit_per_day=3)
    events = out["2026-08-07"]
    assert len(events) == 3
    assert "Non Farm Payrolls" in [e["event"] for e in events]
    # …and the surviving events read chronologically, not by rank.
    times = [e["time"] for e in events]
    assert times == sorted(times, key=lambda t: (int(t.split(":")[0]) % 12, t))


def test_results_are_time_ordered_within_a_day():
    out = _fetch([
        _row("Later Release", "2026-08-06 18:00:00", "High"),
        _row("Earlier Release", "2026-08-06 12:30:00", "High"),
    ])
    assert [e["event"] for e in out["2026-08-06"]] == ["Earlier Release", "Later Release"]


def test_events_shifted_out_of_the_window_by_the_tz_conversion_are_dropped():
    # 2026-08-03 01:00 UTC is 2026-08-02 21:00 ET — outside the Mon-Fri window.
    out = _fetch([_row("Overnight Print", "2026-08-03 01:00:00", "High")])
    assert out == {}


def test_missing_estimate_and_prior_become_none_not_the_string_none():
    out = _fetch([_row("Some Release", "2026-08-04 14:00:00", "High",
                       est=None, prev=None)])
    e = out["2026-08-04"][0]
    assert e["estimate"] is None and e["prior"] is None


def test_integral_floats_render_without_a_trailing_zero():
    out = _fetch([_row("Some Release", "2026-08-04 14:00:00", "High",
                       est=79.0, prev=57.0)])
    e = out["2026-08-04"][0]
    assert e["estimate"] == "79" and e["prior"] == "57"


# ── the released figure, and the unit the provider names beside a number ─────
#
# Every figure below is invented.

def _figure_row(**over):
    row = _row("Some Release", "2026-08-04 14:00:00", "High", est=1.2, prev=0.3)
    row.update(over)
    return row


def test_the_released_figure_rides_on_the_curated_row():
    out = _fetch([_figure_row(actual=1.8)])
    assert out["2026-08-04"][0]["actual"] == "1.8"


def test_a_release_that_is_not_out_yet_has_no_figure():
    """`None`, never the string "None" and never the expected figure in its place."""
    for row in (_figure_row(), _figure_row(actual=None), _figure_row(actual="")):
        e = _fetch([row])["2026-08-04"][0]
        assert e["actual"] is None
        assert e["estimate"] == "1.2"


def test_a_released_zero_is_a_figure_not_a_missing_one():
    e = _fetch([_figure_row(actual=0.0, estimate=0, previous=-0.1)])["2026-08-04"][0]
    assert (e["actual"], e["estimate"], e["prior"]) == ("0", "0", "-0.1")


def test_the_providers_unit_is_joined_onto_all_three_figures():
    e = _fetch([_figure_row(actual=1.8, unit="%")])["2026-08-04"][0]
    assert (e["estimate"], e["prior"], e["actual"]) == ("1.2%", "0.3%", "1.8%")
    e = _fetch([_figure_row(estimate=198.0, previous=200.0, actual=205.0, unit="K")])["2026-08-04"][0]
    assert (e["estimate"], e["prior"], e["actual"]) == ("198K", "200K", "205K")


def test_only_the_short_known_units_are_joined_on():
    for unit in ("%", "K", "M", "B"):
        assert fmp._figure(2.5, unit) == "2.5" + unit
    assert fmp._figure(2.5, " % ") == "2.5%"
    # Anything else is left off: a figure is never given a unit it may not have.
    for unit in (None, "", "USD", "Index", "k", "bps", "%%", 7, ["%"]):
        assert fmp._figure(2.5, unit) == "2.5", unit


def test_a_missing_figure_never_becomes_a_bare_unit():
    assert fmp._figure(None, "%") is None
    assert fmp._figure("", "K") is None


def test_a_figure_that_already_carries_its_unit_is_not_given_it_twice():
    assert fmp._figure("0.4%", "%") == "0.4%"
    assert fmp._figure("198K", "K") == "198K"


def test_the_full_list_joins_the_unit_too():
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result([_figure_row(actual=1.8, unit="%"),
                                           _figure_row(event="Other Release", actual=None)])):
        out = fmp.fetch_us_econ_week_full("2026-08-03", "2026-08-07")
    rows = {e["event"]: e for e in out["2026-08-04"]["econ"]}
    assert (rows["Some Release"]["estimate"], rows["Some Release"]["prior"],
            rows["Some Release"]["actual"]) == ("1.2%", "0.3%", "1.8%")
    assert (rows["Other Release"]["estimate"], rows["Other Release"]["actual"]) == ("1.2", None)


# ── what FMP holds for a day, and whether another source's release is among it ──

def _fetch_cover(rows):
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result(rows)):
        return fmp.fetch_us_econ_week_with_cover("2026-08-03", "2026-08-07")


def test_the_cover_lists_every_us_row_fmp_holds_whatever_its_impact():
    curated, meta, cover = _fetch_cover([
        _row("JOLTs Job Openings", "2026-08-04 14:00:00", "High"),
        _row("Leading Index MoM (Jul)", "2026-08-04 14:00:00", "Low"),        # curated list drops it
        _row("EIA Crude Oil Stocks Change", "2026-08-04 14:30:00", "Medium"),  # noise
        _row("Fed Cook Speech", "2026-08-04 16:15:00", "Medium"),
        _row("ECB Rate Decision", "2026-08-04 12:45:00", "High", country="EU"),
        _row("Undated Row", "not a date", "High"),
        _row("Next Week Row", "2026-08-10 12:30:00", "High"),
        _row("", "2026-08-04 12:30:00", "High"),
    ])
    assert [e["event"] for e in curated["2026-08-04"]] == ["JOLTs Job Openings", "Fed Cook Speech"]
    assert cover == {"2026-08-04": ["JOLTs Job Openings", "Leading Index MoM (Jul)",
                                    "EIA Crude Oil Stocks Change", "Fed Cook Speech"]}
    assert meta["vendor"] == "fmp"


def test_the_cover_is_empty_when_the_provider_gives_nothing():
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     side_effect=RuntimeError("boom")):
        assert fmp.fetch_us_econ_week_with_cover("2026-08-03", "2026-08-07") == ({}, None, {})


def test_the_older_entry_points_keep_their_shapes():
    rows = [_row("JOLTs Job Openings", "2026-08-04 14:00:00", "High")]
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result(rows)):
        two = fmp.fetch_us_econ_week_with_meta("2026-08-03", "2026-08-07")
        one = fmp.fetch_us_econ_week("2026-08-03", "2026-08-07")
    assert isinstance(two, tuple) and len(two) == 2 and two[1]["vendor"] == "fmp"
    assert isinstance(one, dict) and one == two[0]


def test_cftc_positioning_rows_stay_off_the_curated_list_but_fmp_still_holds_them():
    """FMP rates four of them Medium. On a quiet Friday they were the whole day."""
    rows = [
        _row("CFTC Gold Speculative net positions", "2026-08-07 19:30:00", "Medium"),
        _row("CFTC S&P 500 speculative net positions", "2026-08-07 19:30:00", "Medium"),
        _row("CFTC Nasdaq 100 speculative net positions", "2026-08-07 19:30:00", "Medium"),
        _row("CFTC Crude Oil speculative net positions", "2026-08-07 19:30:00", "Medium"),
        _row("Consumer Credit Change (Jun)", "2026-08-07 19:00:00", "Medium"),
    ]
    curated, _meta, cover = _fetch_cover(rows)
    assert [e["event"] for e in curated["2026-08-07"]] == ["Consumer Credit Change (Jun)"]
    assert len(cover["2026-08-07"]) == 5
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result(rows)):
        full = fmp.fetch_us_econ_week_full("2026-08-03", "2026-08-07")
    assert len(full["2026-08-07"]["econ"]) == 5, "the widget's full list lost the CFTC rows"


def test_a_day_of_only_cftc_rows_has_no_curated_row_at_all():
    curated, _meta, cover = _fetch_cover([
        _row("CFTC Gold Speculative net positions", "2026-08-07 19:30:00", "Medium")])
    assert "2026-08-07" not in curated
    assert cover == {"2026-08-07": ["CFTC Gold Speculative net positions"]}


_SAME = [
    ("Unemployment Claims", "Initial Jobless Claims (Nov/14)"),
    ("HPI m/m", "House Price Index MoM (Sep)"),
    ("S&P/CS Composite-20 HPI y/y", "S&P/Case-Shiller Home Price YoY (Sep)"),
    ("Federal Funds Rate", "Fed Interest Rate Decision"),
    ("FOMC Statement", "Fed Interest Rate Decision"),
    ("Non-Farm Employment Change", "Non Farm Payrolls (Oct)"),
    ("Core PPI m/m", "Producer Price Index MoM (Oct)"),
    ("CPI y/y", "Inflation Rate YoY (Oct)"),
    ("CPI m/m", "Consumer Price Index MoM (Oct)"),
    ("Core CPI m/m", "Core Inflation Rate MoM (Oct)"),
    ("Philly Fed Manufacturing Index", "Philadelphia Fed Manufacturing Index (Nov)"),
    ("Revised UoM Consumer Sentiment", "Michigan Consumer Sentiment (Nov)"),
    ("Core Retail Sales m/m", "Retail Sales Ex Autos MoM (Oct)"),
    ("FOMC Meeting Minutes", "FOMC Minutes"),
    ("Unit Labor Costs q/q", "Unit Labour Costs QoQ Prel (Q3)"),
    ("Trade Balance", "Balance of Trade (Sep)"),
    ("Flash Manufacturing PMI", "S&P Global Manufacturing PMI (Nov)"),
    ("Empire State Manufacturing Index", "NY Empire State Manufacturing Index (Nov)"),
    ("Crude Oil Inventories", "EIA Crude Oil Stocks Change (Nov/13)"),
    ("10-y Bond Auction", "10-Year Note Auction"),
    ("CB Leading Index m/m", "Leading Index MoM (Oct)"),
]

_DIFFERENT = [
    ("Revised UoM Consumer Sentiment",
     ["CFTC Gold Speculative net positions", "Baker Hughes Oil Rig Count (Nov/20)",
      "Fed Cook Speech", "Fed Waller Speech"]),
    ("CB Consumer Confidence", ["Michigan Consumer Sentiment (Nov)"]),
    ("Philly Fed Manufacturing Index", ["Fed Waller Speech", "ISM Manufacturing PMI (Nov)"]),
    ("Existing Home Sales", ["Retail Sales MoM (Oct)", "Retail Sales Ex Autos MoM (Oct)"]),
    ("Bank Holiday", ["Initial Jobless Claims (Nov/21)"]),
    ("Revised UoM Inflation Expectations", ["Core Inflation Rate MoM (Oct)", "CPI (Oct)"]),
    ("JOLTS Job Openings", ["Initial Jobless Claims (Nov/14)"]),
    ("Unemployment Claims", []),
    # The weekly claims are not the monthly unemployment rate.
    ("Unemployment Claims", ["Unemployment Rate (Oct)", "Non Farm Payrolls (Oct)"]),
]


def test_the_same_release_under_two_wordings_is_held():
    for other, ours in _SAME:
        assert fmp.holds_release([ours], other), (other, ours)
        assert fmp.holds_release(["Some Other Row", ours], other), (other, ours)


def test_a_different_release_is_not_held():
    for other, day in _DIFFERENT:
        assert not fmp.holds_release(day, other), (other, day)
    assert not fmp.holds_release(None, "Unemployment Claims")


def test_a_title_with_nothing_to_tell_it_apart_by_counts_as_held():
    """Nothing identifies it, so it can never be shown to be missing: never added."""
    for title in ("", None, "Index m/m", "Core Price Index (Oct)", "Final Sales"):
        assert fmp.holds_release([], title), title


def test_the_period_in_brackets_and_the_kind_of_figure_are_not_identity():
    assert fmp._identity_words("Initial Jobless Claims (Nov/14)") == {"initial", "jobless", "claims"}
    assert fmp._identity_words("Retail Sales Ex Autos MoM (Oct)") == {"retail", "autos"}
    assert fmp._identity_words("S&P/CS Composite-20 HPI y/y") == {
        "case", "shiller", "composite", "house"}
    # A word inside the brackets must not make two releases the same one.
    assert not fmp.holds_release(["Building Permits (Claims)"], "Unemployment Claims")
    # Whole words only: "hpi" inside another word is not the house price index.
    assert fmp._identity_words("Shpiel Report") == {"shpiel"}
    assert fmp._identity_words("Philly Fed Manufacturing Index") == {"philadelphia"}


def test_never_raises_and_returns_empty_on_failure():
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     side_effect=RuntimeError("boom")):
        assert fmp.fetch_us_econ_week("2026-08-03", "2026-08-07") == {}

    from api.services import fmp_client
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     side_effect=fmp_client.FMPTransient("HTTP 402", vendor="fmp")):
        assert fmp.fetch_us_econ_week("2026-08-03", "2026-08-07") == {}


def test_no_api_key_is_a_quiet_no_op():
    from api.services import fmp_client
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     side_effect=fmp_client.FMPNotConfigured("FMP_API_KEY not set", vendor="fmp")):
        assert fmp.fetch_us_econ_week("2026-08-03", "2026-08-07") == {}


def test_fetch_with_meta_surfaces_the_d1_provenance_envelope():
    """The new disclosure entry point the calendar page's honest per-payload
    provenance is built on -- `fetch_us_econ_week` itself must keep returning
    a bare dict (three other callers depend on that), so this is a second,
    additive entry point."""
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result([_row("Non Farm Payrolls", "2026-08-07 12:30:00", "High")])):
        rows, meta = fmp.fetch_us_econ_week_with_meta("2026-08-03", "2026-08-07")
    assert rows["2026-08-07"][0]["event"] == "Non Farm Payrolls"
    assert meta["vendor"] == "fmp"
    assert meta["freshnessClass"] == "end_of_day"
    assert meta["licensingClass"] == "R"


def test_fetch_with_meta_returns_none_meta_on_failure():
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     side_effect=RuntimeError("boom")):
        rows, meta = fmp.fetch_us_econ_week_with_meta("2026-08-03", "2026-08-07")
    assert rows == {}
    assert meta is None


def _fetch_jh(rows, **kw):
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result(rows)):
        return fmp.fetch_us_econ_week("2026-08-24", "2026-08-28", **kw)


# THE 8/21/26 GAP: FMP ships the symposium as a Medium unknown and never lists
# the Chair's Friday keynote — the Warsh speech was on no calendar surface.
_SYMPOSIUM = _row("Jackson Hole Symposium", "2026-08-27 12:00:00", "Medium",
                  est=None, prev=None)


def test_jackson_hole_symposium_lands_in_the_fed_timeline():
    out = _fetch_jh([_SYMPOSIUM])
    thu = out.get("2026-08-27", [])
    sym = [e for e in thu if e["event"] == "Jackson Hole Symposium"]
    assert len(sym) == 1 and sym[0]["is_fed"] is True
    assert sym[0]["time"] == "8:00 AM"                        # 12:00Z = 08:00 ET


def test_chair_keynote_is_derived_the_morning_after_the_symposium_opens():
    out = _fetch_jh([_SYMPOSIUM])
    fri = out.get("2026-08-28", [])
    kn = [e for e in fri if "Keynote" in e["event"]]
    assert len(kn) == 1 and kn[0]["time"] == "10:00 AM" and kn[0]["is_fed"] is True
    # ROLE, never a name — a stale Chair name must never render.
    assert not any(n in kn[0]["event"].lower() for n in ("warsh", "powell"))


def test_a_provider_chair_row_suppresses_the_derived_keynote():
    rows = [_SYMPOSIUM,
            _row("Fed Chair Warsh Speaks at Jackson Hole",
                 "2026-08-28 14:00:00", "High", est=None, prev=None)]
    out = _fetch_jh(rows)
    fri = out.get("2026-08-28", [])
    assert [e["event"] for e in fri] == ["Fed Chair Warsh Speaks at Jackson Hole"]


def test_a_chair_speech_row_never_seeds_a_keynote_of_its_own():
    # Only the symposium row derives — a chair row mentioning Jackson Hole must
    # not spawn a phantom keynote the day after the speech.
    rows = [_row("Fed Chair Warsh Speaks at Jackson Hole",
                 "2026-08-28 14:00:00", "High", est=None, prev=None)]
    assert fmp.with_symposium_keynote(rows) == rows


def _fetch_full_jh(rows):
    with mock.patch("api.services.fmp_client.get_economic_calendar",
                     return_value=_result(rows)):
        return fmp.fetch_us_econ_week_full("2026-08-24", "2026-08-28")


def test_curated_keynote_is_injected_when_the_provider_omits_jackson_hole_entirely():
    """FMP some years ships NEITHER the symposium seed NOR the keynote, so the
    derivation has nothing to work from — the curated gap-filler must still surface it
    as a high-impact FED event on the right day."""
    out = _fetch_full_jh([_row("Michigan Consumer Sentiment", "2026-08-28 14:00:00", "Medium")])
    fed = out.get("2026-08-28", {}).get("fed", [])
    kn = [e for e in fed if "Keynote" in e["event"]]
    assert len(kn) == 1
    assert kn[0]["time"] == "10:00 AM" and kn[0]["impact"] == "high"


def test_curated_keynote_is_suppressed_when_the_symposium_seed_derives_one():
    """No duplicate: the derived role-labeled keynote wins, the curated one stands down."""
    out = _fetch_full_jh([_SYMPOSIUM])
    fed = out.get("2026-08-28", {}).get("fed", [])
    kn = [e for e in fed if "Keynote" in e["event"]]
    assert len(kn) == 1


def test_curated_keynote_is_suppressed_when_the_provider_lists_the_speech():
    out = _fetch_full_jh([
        _row("Fed Chair Warsh Speaks at Jackson Hole", "2026-08-28 14:00:00", "High"),
    ])
    fed = out.get("2026-08-28", {}).get("fed", [])
    titles = [e["event"] for e in fed]
    assert titles == ["Fed Chair Warsh Speaks at Jackson Hole"]


def test_marquee_releases_are_flagged_is_key_for_the_cards_accent_rail():
    """The card's gold rail must be driven by real importance, not styling."""
    out = _fetch([
        _row("Non Farm Payrolls", "2026-08-07 12:30:00", "High"),
        _row("Factory Orders MoM", "2026-08-07 14:00:00", "Medium"),
        _row("Fed Chair Powell Speaks", "2026-08-07 18:00:00", "Low"),
    ])
    by = {e["event"]: e for e in out["2026-08-07"]}
    assert by["Non Farm Payrolls"]["is_key"] is True
    assert by["Factory Orders MoM"]["is_key"] is False
    # A Fed speaker gets its OWN accent, so it must not double as is_key.
    assert by["Fed Chair Powell Speaks"]["is_fed"] is True
    assert by["Fed Chair Powell Speaks"]["is_key"] is False
