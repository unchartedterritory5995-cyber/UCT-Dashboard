"""Economic events on the Calendar board — parsing + source fallback.

TWO defects, found 2026-07-31 by probing prod rather than trusting the notes:

1. **EVERY event was silently dropped, including the CURRENT week.**
   ForexFactory's JSON now returns `date` as `"7/30/2026 7:30:00 AM"`, but
   `_fetch_ff_events` called `datetime.fromisoformat(date_raw)`, which raises on
   that format. A bare `except Exception: continue` swallowed it, so all 92
   events in a working 200-OK feed vanished and every day showed `econ: []`.
   The recorded belief was "only FUTURE weeks lack econ" — the current week was
   broken too, for a completely different reason.

2. **`ff_calendar_nextweek.json` 404s**, so weeks FF does not publish had no
   source at all. FMP (`econ_calendar_fmp`) already backs the weekly Discord
   card; the page never used it.

3. **The order, since 2026-11-20: FMP first on EVERY week, ForexFactory only as a
   backup.** FMP is the licensed calendar and carries the released figure;
   ForexFactory is read only when FMP gave no row for the whole week. Before that
   date the current and the next week read ForexFactory first and threw FMP's
   released figure away, so no released figure ever showed. Section 3 pins it.

⚠️ The FF feed's clock is **US CENTRAL**, verified against four known releases:
FOMC statement 1:00 PM (2:00 ET), Core PCE / Advance GDP / Unemployment Claims
7:30 AM (8:30 ET), CB Consumer Confidence 9:00 AM (10:00 ET). Parsing these as
ET would put every econ event on the board an hour early. Converted through
`America/Chicago`, never a fixed -1 offset, so DST stays correct.
"""
from datetime import timedelta
from unittest import mock

from api.routers import calendar as cal


# ── 1. the date format that silently dropped everything ──────────────────────

def test_parses_the_us_style_format_the_live_feed_actually_returns():
    dt = cal._parse_ff_datetime("7/30/2026 7:30:00 AM")
    assert dt is not None, "the live feed format still fails to parse"
    assert (dt.year, dt.month, dt.day) == (2026, 7, 30)


def test_feed_times_are_CENTRAL_and_land_an_hour_later_in_ET():
    """FOMC prints at 1:00 PM in the feed and 2:00 PM ET in reality."""
    dt = cal._parse_ff_datetime("7/29/2026 1:00:00 PM")
    assert dt.hour == 14, f"expected 14:00 ET, got {dt.hour}:00 — feed is Central"


def test_an_830_et_release_reads_as_830_et():
    """Core PCE / Advance GDP: feed says 7:30 AM CT."""
    dt = cal._parse_ff_datetime("7/30/2026 7:30:00 AM")
    assert (dt.hour, dt.minute) == (8, 30)


def test_iso_input_still_works():
    """Don't break if the feed ever reverts to ISO-8601."""
    dt = cal._parse_ff_datetime("2026-07-30T08:30:00-04:00")
    assert dt is not None and dt.hour == 8


def test_garbage_returns_none_rather_than_raising():
    assert cal._parse_ff_datetime("not a date") is None
    assert cal._parse_ff_datetime("") is None
    assert cal._parse_ff_datetime(None) is None


# ── 2. the end-to-end regression rail ────────────────────────────────────────

_LIVE_SHAPE = [
    {"title": "Core PCE Price Index m/m", "country": "USD", "impact": "High",
     "date": "7/30/2026 7:30:00 AM", "forecast": "0.3%", "previous": "0.2%"},
    {"title": "FOMC Statement", "country": "USD", "impact": "High",
     "date": "7/29/2026 1:00:00 PM", "forecast": "", "previous": ""},
    {"title": "German ifo Business Climate", "country": "EUR", "impact": "Low",
     "date": "7/27/2026 3:00:00 AM", "forecast": "", "previous": ""},
    {"title": "Some Minor US Print", "country": "USD", "impact": "Low",
     "date": "7/28/2026 9:00:00 AM", "forecast": "", "previous": ""},
]


def _fake_ff(payload):
    class _R:
        ok = True
        text = "x"
        def json(self): return payload
    return mock.patch("requests.get", return_value=_R())


def test_a_working_feed_yields_events_not_silence():
    """THE BUG: 92 events in, 0 out. Any parse regression fails here."""
    with _fake_ff(_LIVE_SHAPE):
        out = cal._fetch_ff_events("2026-07-27", "2026-07-31")
    total = sum(len(b["econ"]) + len(b["fed"]) for b in out.values())
    assert total > 0, "a 200-OK feed produced zero events — the silent-drop bug is back"
    assert "2026-07-30" in out
    assert any(e["event"] == "Core PCE Price Index m/m" for e in out["2026-07-30"]["econ"])


def test_non_usd_and_low_impact_are_still_filtered_out():
    with _fake_ff(_LIVE_SHAPE):
        out = cal._fetch_ff_events("2026-07-27", "2026-07-31")
    titles = [e["event"] for b in out.values() for e in b["econ"] + b["fed"]]
    assert "German ifo Business Climate" not in titles, "non-USD leaked in"
    assert "Some Minor US Print" not in titles, "Low impact leaked in"


# ── 3. the source order: FMP first on every week, ForexFactory as the backup ─
#
# Every figure below is invented.

_PATCH_FMP = "api.services.econ_calendar_fmp.fetch_us_econ_week_with_cover"
_META = {"vendor": "fmp", "freshnessClass": "end_of_day", "licensingClass": "R"}


def _empty_days(*dates):
    return {d: {"econ": [], "fed": []} for d in dates}


def _this_monday():
    """The week ForexFactory can serve is DERIVED from `_week_dates()`, never typed: a
    hardcoded date ages out of the backup's two-week window and the test then proves
    nothing about the backup (the hardcoded-fixture-date rot of 2026-08-11)."""
    return cal._week_dates()[0]


def _ff_row(event="FF Event"):
    return {"time": "8:30 AM", "event": event, "estimate": None, "prior": None,
            "actual": None, "is_key": True}


def test_fmp_serves_a_week_forexfactory_has_no_feed_for():
    days = _empty_days("2026-08-03", "2026-08-04")
    fmp = {"2026-08-03": [
        {"time": "8:30 AM", "event": "Non-Farm Payrolls", "estimate": "180K",
         "prior": "150K", "actual": None, "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert [e["event"] for e in days["2026-08-03"]["econ"]] == ["Non-Farm Payrolls"]


def _fmp_row(time, event, **over):
    row = {"time": time, "event": event, "estimate": None, "prior": None,
           "actual": None, "is_fed": False}
    row.update(over)
    return row


def _week(n=3):
    mon = _this_monday()
    return [(mon + timedelta(days=i)).isoformat() for i in range(n)], \
        (mon + timedelta(days=4)).isoformat()


def test_a_release_fmp_holds_is_never_added_a_second_time_under_the_backups_name():
    """The licensed calendar answers the week. The backup lists the same release under
    its own wording; a member must not see it twice."""
    (d0, d1, _d2), fri = _week()
    days = _empty_days(d0, d1)
    ff = {d0: {"econ": [_ff_row("Unemployment Claims")], "fed": []}}
    fmp = {d0: [_fmp_row("8:30 AM", "Initial Jobless Claims (Nov/14)", actual="203K")],
           d1: [_fmp_row("10:00 AM", "FMP Only Day")]}
    cover = {d0: ["Initial Jobless Claims (Nov/14)"], d1: ["FMP Only Day"]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, cover)):
        out = cal._curate_econ_events(d0, fri, days)
    assert [e["event"] for e in days[d0]["econ"]] == ["Initial Jobless Claims (Nov/14)"]
    assert days[d0]["econ"][0]["actual"] == "203K"
    assert [e["event"] for e in days[d1]["econ"]] == ["FMP Only Day"]
    assert out == _META


def test_a_release_fmp_does_not_hold_is_filled_from_the_backup_and_says_so():
    """Found 2026-11-20: the final Michigan sentiment reading was on no FMP row the
    morning it was due. It is added in its clock place and names its source, because
    the payload's label names FMP."""
    (d0, _d1, _d2), fri = _week()
    days = _empty_days(d0)
    ff = {d0: {"econ": [{**_ff_row("Revised UoM Consumer Sentiment"), "time": "10:00 AM",
                         "estimate": "51.7", "prior": "51.0", "impact": "medium"}],
               "fed": []}}
    fmp = {d0: [_fmp_row("8:30 AM", "Housing Starts (Oct)"),
                _fmp_row("1:00 PM", "20-Year Bond Auction")]}
    cover = {d0: ["Housing Starts (Oct)", "20-Year Bond Auction",
                  "Baker Hughes Oil Rig Count (Nov/20)", "Fed Cook Speech"]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, cover)):
        out = cal._curate_econ_events(d0, fri, days)
    rows = days[d0]["econ"]
    assert [e["event"] for e in rows] == [
        "Housing Starts (Oct)", "Revised UoM Consumer Sentiment", "20-Year Bond Auction"]
    filled = rows[1]
    assert filled["source"] == cal.ECON_BACKUP_SOURCE == "ForexFactory"
    assert (filled["estimate"], filled["prior"], filled["actual"]) == ("51.7", "51.0", None)
    # FMP's own rows carry no such mark: the payload label already names FMP for them.
    assert "source" not in rows[0] and "source" not in rows[2]
    assert out == _META


def test_a_release_fmp_rates_low_and_leaves_out_is_not_brought_back():
    """The curated list dropped it on purpose. FMP still HOLDS it, so the backup's copy
    is not a gap."""
    (d0, _d1, _d2), fri = _week()
    days = _empty_days(d0)
    ff = {d0: {"econ": [_ff_row("CB Leading Index m/m")], "fed": []}}
    fmp = {d0: [_fmp_row("8:30 AM", "Initial Jobless Claims (Nov/14)")]}
    cover = {d0: ["Initial Jobless Claims (Nov/14)", "Leading Index MoM (Oct)"]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, cover)):
        cal._curate_econ_events(d0, fri, days)
    assert [e["event"] for e in days[d0]["econ"]] == ["Initial Jobless Claims (Nov/14)"]


def test_a_day_fmp_has_nothing_for_is_filled_in_a_week_it_answered():
    (d0, _d1, d2), fri = _week()
    days = _empty_days(d0, d2)
    ff = {d2: {"econ": [_ff_row("FF Quiet Day Event")], "fed": []}}
    fmp = {d0: [_fmp_row("9:00 AM", "FMP Event")]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, {d0: ["FMP Event"]})):
        out = cal._curate_econ_events(d0, fri, days)
    assert [e["event"] for e in days[d0]["econ"]] == ["FMP Event"]
    assert [(e["event"], e["source"]) for e in days[d2]["econ"]] == [
        ("FF Quiet Day Event", "ForexFactory")]
    assert out == _META


def test_fed_speakers_are_never_filled_from_the_backup():
    """Not even one FMP does not list: the two sources name them too differently to
    tell apart safely, and a speaker shown twice is worse than one missed."""
    (d0, _d1, _d2), fri = _week()
    days = _empty_days(d0)
    ff = {d0: {"econ": [], "fed": [{"time": "1:00 PM", "event": "FOMC Member Waller Speaks",
                                    "note": "Medium"}]}}
    fmp = {d0: [_fmp_row("12:15 PM", "Fed Cook Speech", is_fed=True)]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, {d0: ["Fed Cook Speech"]})):
        cal._curate_econ_events(d0, fri, days)
    assert [e["event"] for e in days[d0]["fed"]] == ["Fed Cook Speech"]
    assert days[d0]["econ"] == []


def test_two_figures_of_one_report_fmp_lacks_both_fill():
    """A fill is judged against what FMP holds, never against another fill: the sentiment
    reading and its inflation expectations are two figures and both show."""
    (d0, _d1, _d2), fri = _week()
    days = _empty_days(d0)
    ff = {d0: {"econ": [{**_ff_row("Revised UoM Consumer Sentiment"), "time": "10:00 AM"},
                        {**_ff_row("Revised UoM Inflation Expectations"), "time": "10:00 AM"},
                        {**_ff_row("Bank Holiday"), "time": "12:00 AM"}],
               "fed": []}}
    fmp = {d0: [_fmp_row("8:30 AM", "Housing Starts (Oct)")]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, {d0: ["Housing Starts (Oct)"]})):
        cal._curate_econ_events(d0, fri, days)
    assert [e["event"] for e in days[d0]["econ"]] == [
        "Bank Holiday", "Housing Starts (Oct)", "Revised UoM Consumer Sentiment",
        "Revised UoM Inflation Expectations"]


def test_a_fill_with_an_unreadable_clock_goes_last_and_a_stray_day_is_skipped():
    (d0, _d1, _d2), fri = _week()
    days = _empty_days(d0)
    stray = (_this_monday() + timedelta(days=5)).isoformat()      # a Saturday: not in the payload
    ff = {d0: {"econ": [{**_ff_row("Treasury Currency Report"), "time": "Tentative"},
                        {**_ff_row(""), "time": "9:00 AM"}], "fed": []},
          stray: {"econ": [_ff_row("Weekend Row")], "fed": []}}
    fmp = {d0: [_fmp_row("4:00 PM", "Net Long-Term TIC Flows (Sep)")]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META,
                                              {d0: ["Net Long-Term TIC Flows (Sep)"]})):
        cal._curate_econ_events(d0, fri, days)          # must not raise
    assert [e["event"] for e in days[d0]["econ"]] == [
        "Net Long-Term TIC Flows (Sep)", "Treasury Currency Report"]
    assert set(days) == {d0}


def test_a_failing_backup_leaves_the_week_fmp_answered_as_it_is():
    (d0, _d1, _d2), fri = _week()
    days = _empty_days(d0)
    fmp = {d0: [_fmp_row("9:00 AM", "FMP Event")]}
    with mock.patch.object(cal, "_fetch_ff_events", side_effect=RuntimeError("ff down")) as ffm, \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, {d0: ["FMP Event"]})):
        out = cal._curate_econ_events(d0, fri, days)    # must not raise
    ffm.assert_called_once()
    assert [e["event"] for e in days[d0]["econ"]] == ["FMP Event"]
    assert out == _META


def test_a_far_week_fmp_answered_does_not_read_the_backup():
    days = _empty_days("2026-12-14")
    fmp = {"2026-12-14": [_fmp_row("9:00 AM", "FMP Event")]}
    with mock.patch.object(cal, "_week_dates", return_value=[
            cal.date(2026, 11, 16) + timedelta(days=i) for i in range(5)]), \
         mock.patch.object(cal, "_fetch_ff_events") as ff, \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, {"2026-12-14": ["FMP Event"]})):
        cal._curate_econ_events("2026-12-14", "2026-12-18", days)
    ff.assert_not_called()
    assert [e["event"] for e in days["2026-12-14"]["econ"]] == ["FMP Event"]


def test_a_fill_never_lands_without_the_list_of_what_fmp_holds():
    """An older or broken FMP answer that carries rows but no list of the day's titles:
    the calendar then knows nothing FMP holds beyond the rows it placed, and must judge
    the backup's rows against THOSE at least. Here the list is missing altogether."""
    (d0, _d1, _d2), fri = _week()
    days = _empty_days(d0)
    ff = {d0: {"econ": [_ff_row("Unemployment Claims")], "fed": []}}
    fmp = {d0: [_fmp_row("8:30 AM", "Initial Jobless Claims (Nov/14)")]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=(fmp, _META, None)):
        cal._curate_econ_events(d0, fri, days)
    assert [e["event"] for e in days[d0]["econ"]] == ["Initial Jobless Claims (Nov/14)"]


def test_the_clock_reader_orders_a_day_and_never_puts_the_unreadable_first():
    assert [cal._clock_minutes(t) for t in ("12:00 AM", "8:30 AM", "12:15 PM", "3:30 PM")] == [
        0, 510, 735, 930]
    for bad in ("Tentative", "All Day", "", None, "25:00 PM"):
        assert cal._clock_minutes(bad) == 24 * 60, bad


def test_the_released_figure_fmp_carries_reaches_the_row():
    """It used to be overwritten with `None` ("FMP does not carry actuals"), so a print
    that was out showed no figure on any week FMP served."""
    days = _empty_days("2026-08-04", "2026-08-05")
    fmp = {"2026-08-04": [{"time": "10:00 AM", "event": "Factory Orders MoM",
                           "estimate": "1.2%", "prior": "0.3%", "actual": "1.8%",
                           "is_fed": False}],
           "2026-08-05": [{"time": "8:30 AM", "event": "Trade Balance",
                           "estimate": "-70B", "prior": "-68B", "actual": None,
                           "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    released = days["2026-08-04"]["econ"][0]
    assert (released["estimate"], released["prior"], released["actual"]) == (
        "1.2%", "0.3%", "1.8%")
    # Not out yet: no figure, never a made-up one and never the expected figure.
    assert days["2026-08-05"]["econ"][0]["actual"] is None


def test_a_row_from_an_older_fmp_shape_without_the_released_figure_reads_as_none():
    days = _empty_days("2026-08-04")
    fmp = {"2026-08-04": [{"time": "10:00 AM", "event": "Factory Orders MoM",
                           "estimate": "1.2%", "prior": "0.3%", "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert days["2026-08-04"]["econ"][0]["actual"] is None


def test_a_marquee_release_from_fmp_is_marked_key_by_the_calendars_own_terms():
    days = _empty_days("2026-08-07")
    fmp = {"2026-08-07": [
        {"time": "8:30 AM", "event": "Non Farm Payrolls", "estimate": None,
         "prior": None, "actual": None, "is_fed": False},
        {"time": "3:00 PM", "event": "Consumer Credit Change", "estimate": None,
         "prior": None, "actual": None, "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    flags = {e["event"]: e["is_key"] for e in days["2026-08-07"]["econ"]}
    assert flags == {"Non Farm Payrolls": cal._is_key_event("Non Farm Payrolls"),
                     "Consumer Credit Change": cal._is_key_event("Consumer Credit Change")}
    assert flags["Non Farm Payrolls"] is True and flags["Consumer Credit Change"] is False


def test_a_fed_speaker_from_fmp_routes_to_the_fed_bucket():
    days = _empty_days("2026-08-03")
    fmp = {"2026-08-03": [
        {"time": "1:00 PM", "event": "Fed Chair Powell Speaks", "estimate": None,
         "prior": None, "is_fed": True}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert days["2026-08-03"]["econ"] == []
    assert days["2026-08-03"]["fed"] == [
        {"time": "1:00 PM", "event": "Fed Chair Powell Speaks", "note": "Fed"}]


def test_fed_speakers_bucket_consistently_even_when_fmp_mislabels_them():
    """FMP tagged 'Fed Barkin Speech' is_fed but NOT 'Fed Cook Speech' /
    'Fed Musalem Speech' (week of 2026-08-03), splitting identical events across
    two buckets. The calendar's own detector backstops the flag."""
    days = _empty_days("2026-08-05")
    fmp = {"2026-08-05": [
        {"time": "4:05 PM", "event": "Fed Cook Speech", "estimate": None,
         "prior": None, "is_fed": False},                      # FMP got it WRONG
        {"time": "10:00 AM", "event": "Fed Barkin Speech", "estimate": None,
         "prior": None, "is_fed": True},                       # FMP got it right
    ]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert sorted(e["event"] for e in days["2026-08-05"]["fed"]) == [
        "Fed Barkin Speech", "Fed Cook Speech"]
    assert days["2026-08-05"]["econ"] == [], "a Fed speaker leaked into econ"


def test_a_row_with_no_title_and_a_day_outside_the_week_are_left_out():
    days = _empty_days("2026-08-04")
    fmp = {"2026-08-04": [{"time": "9:00 AM", "event": "", "is_fed": False},
                          {"time": "9:30 AM", "event": "Real Row", "estimate": None,
                           "prior": None, "actual": None, "is_fed": False}],
           # A day the payload does not hold (a weekend): skipped, never a KeyError.
           "2026-08-08": [{"time": "9:00 AM", "event": "Weekend Row", "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert [e["event"] for e in days["2026-08-04"]["econ"]] == ["Real Row"]
    assert set(days) == {"2026-08-04"}


def test_forexfactory_is_the_backup_when_fmp_gives_nothing_for_the_current_week():
    monday = _this_monday().isoformat()
    days = _empty_days(monday)
    ff = {monday: {"econ": [_ff_row()], "fed": [{"time": "1:00 PM", "event": "Fed Talk",
                                                  "note": "Fed"}]}}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff) as ffm, \
         mock.patch(_PATCH_FMP, return_value=({}, None, {})):
        out = cal._curate_econ_events(monday, monday, days)
    ffm.assert_called_once()
    assert [e["event"] for e in days[monday]["econ"]] == ["FF Event"]
    assert [e["event"] for e in days[monday]["fed"]] == ["Fed Talk"]
    assert out is None


def test_forexfactory_is_the_backup_when_fmp_raises():
    monday = _this_monday().isoformat()
    days = _empty_days(monday)
    ff = {monday: {"econ": [_ff_row()], "fed": []}}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff) as ffm, \
         mock.patch(_PATCH_FMP, side_effect=RuntimeError("fmp down")):
        out = cal._curate_econ_events(monday, monday, days)
    ffm.assert_called_once()
    assert [e["event"] for e in days[monday]["econ"]] == ["FF Event"]
    assert out is None


def test_rows_from_the_backup_are_never_labelled_as_fmps():
    """FMP answered with an empty week and its envelope; ForexFactory supplied the rows.
    The payload's source label must not name FMP for rows it did not supply."""
    monday = _this_monday().isoformat()
    days = _empty_days(monday)
    ff = {monday: {"econ": [_ff_row()], "fed": []}}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff), \
         mock.patch(_PATCH_FMP, return_value=({}, _META, {})):
        out = cal._curate_econ_events(monday, monday, days)
    assert [e["event"] for e in days[monday]["econ"]] == ["FF Event"]
    assert out is None


def test_an_empty_week_from_both_keeps_fmps_own_envelope():
    """FMP answered "nothing this week" and the backup has nothing either: the week is
    empty on FMP's word, and the envelope says whose word it is."""
    monday = _this_monday().isoformat()
    days = _empty_days(monday)
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=({}, _META, {})):
        out = cal._curate_econ_events(monday, monday, days)
    assert days[monday] == {"econ": [], "fed": []}
    assert out == _META


def test_a_far_week_never_reads_forexfactory_even_when_fmp_gives_nothing():
    """ForexFactory publishes two weeks. Outside them its two fetches are 12 s each of
    request-path waste for a week it cannot serve."""
    days = _empty_days("2026-12-14", "2026-12-15")
    with mock.patch.object(cal, "_week_dates", return_value=[
            cal.date(2026, 11, 16) + timedelta(days=i) for i in range(5)]), \
         mock.patch.object(cal, "_fetch_ff_events") as ff, \
         mock.patch(_PATCH_FMP, return_value=({}, None, {})):
        out = cal._curate_econ_events("2026-12-14", "2026-12-18", days)
    ff.assert_not_called()
    assert days["2026-12-14"] == {"econ": [], "fed": []}
    assert out is None


def test_the_backups_window_is_the_current_and_the_next_week_only():
    base = cal.date(2026, 11, 16)
    weeks = [base + timedelta(days=i) for i in range(5)]
    for offset, read in ((-14, False), (-7, True), (0, True), (7, True), (14, False)):
        ws = (base + timedelta(days=offset)).isoformat()
        days = _empty_days(ws)
        with mock.patch.object(cal, "_week_dates", return_value=weeks), \
             mock.patch.object(cal, "_fetch_ff_events", return_value={}) as ff, \
             mock.patch(_PATCH_FMP, return_value=({}, None, {})):
            cal._curate_econ_events(ws, ws, days)
        assert ff.called is read, (offset, ff.called)


def test_both_sources_failing_leaves_the_day_empty_not_broken():
    monday = _this_monday().isoformat()
    days = _empty_days(monday)
    with mock.patch.object(cal, "_fetch_ff_events", side_effect=RuntimeError("ff down")) as ff, \
         mock.patch(_PATCH_FMP, side_effect=RuntimeError("fmp down")):
        out = cal._curate_econ_events(monday, monday, days)   # must not raise
    ff.assert_called_once()
    assert days[monday] == {"econ": [], "fed": []}
    assert out is None


def test_fmps_own_fed_flag_is_enough_when_the_calendars_detector_misses_the_title():
    """The two are OR-ed: the detector backstops a wrong flag (the test above), and the
    flag backstops a title the detector does not know."""
    days = _empty_days("2026-08-05")
    fmp = {"2026-08-05": [
        {"time": "2:00 PM", "event": "Regional Bank President Remarks", "estimate": None,
         "prior": None, "is_fed": True}]}
    with mock.patch.object(cal, "_is_fed_speaker", return_value=False), \
         mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch(_PATCH_FMP, return_value=(fmp, None, {})):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert [e["event"] for e in days["2026-08-05"]["fed"]] == ["Regional Bank President Remarks"]
    assert days["2026-08-05"]["econ"] == []
