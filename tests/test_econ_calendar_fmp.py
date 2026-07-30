"""FMP economic calendar — the week-ahead econ source.

Exists because ForexFactory's `ff_calendar_nextweek.json` 404s, so the calendar
payload carries zero econ events for any week but the current one.
"""
from unittest import mock

from api.services import econ_calendar_fmp as fmp


def _row(event, date_utc, impact="Medium", country="US", est=1.0, prev=2.0):
    return {"event": event, "date": date_utc, "impact": impact,
            "country": country, "estimate": est, "previous": prev}


def _fetch(rows, **kw):
    resp = mock.Mock(ok=True)
    resp.json.return_value = rows
    with mock.patch("requests.get", return_value=resp), \
         mock.patch.dict("os.environ", {"FMP_API_KEY": "k"}):
        return fmp.fetch_us_econ_week("2026-08-03", "2026-08-07", **kw)


def test_utc_times_convert_to_et_through_a_real_timezone():
    """NFP is published 08:30 ET — 12:30 UTC in EDT, 13:30 UTC in EST. A fixed
    offset would be an hour wrong for half the year."""
    edt = _fetch([_row("Non Farm Payrolls", "2026-08-07 12:30:00", "High")])
    assert edt["2026-08-07"][0]["time"] == "8:30 AM"

    resp = mock.Mock(ok=True)
    resp.json.return_value = [_row("Consumer Price Index", "2026-01-13 13:30:00", "High")]
    with mock.patch("requests.get", return_value=resp), \
         mock.patch.dict("os.environ", {"FMP_API_KEY": "k"}):
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


def test_never_raises_and_returns_empty_on_failure():
    with mock.patch("requests.get", side_effect=RuntimeError("boom")), \
         mock.patch.dict("os.environ", {"FMP_API_KEY": "k"}):
        assert fmp.fetch_us_econ_week("2026-08-03", "2026-08-07") == {}

    resp = mock.Mock(ok=False, status_code=402)
    with mock.patch("requests.get", return_value=resp), \
         mock.patch.dict("os.environ", {"FMP_API_KEY": "k"}):
        assert fmp.fetch_us_econ_week("2026-08-03", "2026-08-07") == {}


def test_no_api_key_is_a_quiet_no_op():
    with mock.patch.dict("os.environ", {}, clear=True):
        assert fmp.fetch_us_econ_week("2026-08-03", "2026-08-07") == {}
