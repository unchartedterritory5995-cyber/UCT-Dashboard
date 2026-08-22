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


# ── 3. FMP fallback for the weeks ForexFactory does not publish ──────────────

def _empty_days(*dates):
    return {d: {"econ": [], "fed": []} for d in dates}


def test_fmp_fills_a_week_forexfactory_has_no_feed_for():
    """ff_calendar_nextweek.json 404s, so next week had NO source at all."""
    days = _empty_days("2026-08-03", "2026-08-04")
    fmp = {"2026-08-03": [
        {"time": "8:30 AM", "event": "Non-Farm Payrolls", "estimate": "180K",
         "prior": "150K", "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch("api.services.econ_calendar_fmp.fetch_us_econ_week", return_value=fmp):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert [e["event"] for e in days["2026-08-03"]["econ"]] == ["Non-Farm Payrolls"]


def test_fmp_does_not_overwrite_a_day_forexfactory_already_covered():
    """FF is the richer source — the fallback fills GAPS, it does not replace.

    ⚠️ The week is DERIVED from `_week_dates()`, not typed. `_curate_econ_events`
    only consults ForexFactory within ±7 days of the current week (`ff_eligible`
    — FF publishes `thisweek` only, so the fetch is pure request-path waste
    anywhere else), and this test's hardcoded 2026-08-03 aged out of that window
    on 2026-08-11. Past that date the FF mock was never called, FMP filled the
    day, and the one gate that actually pins "FF wins where FF has data" went
    red — the same hardcoded-fixture-date rot as `test_month_unknown_hour_lands_in_tbd`.
    """
    mon = cal._week_dates()[0]
    d0, d1 = mon.isoformat(), (mon + timedelta(days=1)).isoformat()
    days = _empty_days(d0, d1)
    ff = {d0: {"econ": [{"time": "8:30 AM", "event": "FF Event",
                         "estimate": None, "prior": None,
                         "actual": None, "is_key": True}], "fed": []}}
    fmp = {d0: [{"time": "9:00 AM", "event": "FMP Event", "estimate": None,
                 "prior": None, "is_fed": False}],
           d1: [{"time": "10:00 AM", "event": "FMP Only Day", "estimate": None,
                 "prior": None, "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff) as ff_mock, \
         mock.patch("api.services.econ_calendar_fmp.fetch_us_econ_week", return_value=fmp):
        cal._curate_econ_events(d0, (mon + timedelta(days=4)).isoformat(), days)
    # Non-vacuity: if FF is never consulted this test proves nothing about FF.
    ff_mock.assert_called_once()
    assert [e["event"] for e in days[d0]["econ"]] == ["FF Event"]
    assert [e["event"] for e in days[d1]["econ"]] == ["FMP Only Day"]


def test_a_fed_speaker_from_fmp_routes_to_the_fed_bucket():
    days = _empty_days("2026-08-03")
    fmp = {"2026-08-03": [
        {"time": "1:00 PM", "event": "Fed Chair Powell Speaks", "estimate": None,
         "prior": None, "is_fed": True}]}
    with mock.patch.object(cal, "_fetch_ff_events", return_value={}), \
         mock.patch("api.services.econ_calendar_fmp.fetch_us_econ_week", return_value=fmp):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert days["2026-08-03"]["econ"] == []
    assert [e["event"] for e in days["2026-08-03"]["fed"]] == ["Fed Chair Powell Speaks"]


def test_both_sources_failing_leaves_the_day_empty_not_broken():
    days = _empty_days("2026-08-03")
    with mock.patch.object(cal, "_fetch_ff_events", side_effect=RuntimeError("ff down")), \
         mock.patch("api.services.econ_calendar_fmp.fetch_us_econ_week",
                    side_effect=RuntimeError("fmp down")):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)   # must not raise
    assert days["2026-08-03"]["econ"] == []


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
         mock.patch("api.services.econ_calendar_fmp.fetch_us_econ_week", return_value=fmp):
        cal._curate_econ_events("2026-08-03", "2026-08-07", days)
    assert sorted(e["event"] for e in days["2026-08-05"]["fed"]) == [
        "Fed Barkin Speech", "Fed Cook Speech"]
    assert days["2026-08-05"]["econ"] == [], "a Fed speaker leaked into econ"


def test_a_far_week_skips_forexfactory_but_still_gets_fmp():
    """The old call-site guard skipped econ entirely beyond ±7 days, because it
    predated the FMP fallback. FF is still skipped there (its two fetches are
    12s of request-path waste for a week it cannot serve) but FMP must run."""
    days = _empty_days("2026-12-14", "2026-12-15")
    fmp = {"2026-12-14": [{"time": "8:30 AM", "event": "CPI m/m", "estimate": "0.2%",
                           "prior": "0.1%", "is_fed": False}]}
    with mock.patch.object(cal, "_fetch_ff_events") as ff, \
         mock.patch("api.services.econ_calendar_fmp.fetch_us_econ_week", return_value=fmp):
        cal._curate_econ_events("2026-12-14", "2026-12-18", days)
    ff.assert_not_called()          # far week -> no wasted faireconomy fetches
    assert [e["event"] for e in days["2026-12-14"]["econ"]] == ["CPI m/m"]


def test_the_current_week_still_prefers_forexfactory():
    """Near weeks must still try FF first — it carries `actual` once a print
    releases, which FMP does not."""
    monday = cal._week_dates()[0].isoformat()
    days = _empty_days(monday)
    ff = {monday: {"econ": [{"time": "8:30 AM", "event": "FF Event", "estimate": None,
                             "prior": None, "actual": "0.4%", "is_key": True}], "fed": []}}
    with mock.patch.object(cal, "_fetch_ff_events", return_value=ff) as ffm, \
         mock.patch("api.services.econ_calendar_fmp.fetch_us_econ_week", return_value={}):
        cal._curate_econ_events(monday, monday, days)
    ffm.assert_called_once()
    assert days[monday]["econ"][0]["actual"] == "0.4%"
