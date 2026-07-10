"""Actuals backfill: a name that reported EARLIER this week shows its result."""
from __future__ import annotations

from unittest import mock


def _days():
    # Thu = PEP (already printed BMO), Fri (today) = DAL (pending), Mon = future-safe
    return {
        "2026-07-06": {"bmo": [], "amc": [], "tbd": []},
        "2026-07-09": {"bmo": [{"sym": "PEP", "eps_est": 2.43, "eps_act": None}], "amc": [], "tbd": []},
        "2026-07-10": {"bmo": [{"sym": "DAL", "eps_est": 1.51, "eps_act": None}], "amc": [], "tbd": []},
        "2026-07-13": {"bmo": [{"sym": "AAPL", "eps_est": 1.20, "eps_act": None}], "amc": [], "tbd": []},
    }


def _fh_response(rows):
    resp = mock.Mock()
    resp.ok = True
    resp.json.return_value = {"earningsCalendar": rows}
    return resp


def test_patches_earlier_this_week_reporter(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "x")
    import api.routers.calendar as cal
    days = _days()
    fake = _fh_response([
        {"symbol": "PEP", "epsActual": 2.55, "epsEstimate": 2.43,
         "revenueActual": 23_000_000_000, "revenueEstimate": 22_500_000_000},
        {"symbol": "DAL", "epsActual": 1.56, "epsEstimate": 1.51},
    ])
    with mock.patch("requests.get", return_value=fake) as g:
        cal._patch_today_actuals(days, "2026-07-10")

    # Thursday's PEP is now filled in (the bug: it used to stay None on Friday)
    pep = days["2026-07-09"]["bmo"][0]
    assert pep["eps_act"] == 2.55
    assert pep["rev_act"] == 23000.0   # normalized to millions
    # Today's DAL also patched
    assert days["2026-07-10"]["bmo"][0]["eps_act"] == 1.56
    # The Finnhub call spanned the week, not just today
    _, kwargs = g.call_args
    assert kwargs["params"]["from"] == "2026-07-06"
    assert kwargs["params"]["to"] == "2026-07-10"


def test_future_day_not_patched(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "x")
    import api.routers.calendar as cal
    days = _days()
    # Even if Finnhub returned an AAPL actual, a FUTURE-dated row must stay pending
    fake = _fh_response([{"symbol": "AAPL", "epsActual": 1.30, "epsEstimate": 1.20}])
    with mock.patch("requests.get", return_value=fake):
        cal._patch_today_actuals(days, "2026-07-10")
    assert days["2026-07-13"]["bmo"][0]["eps_act"] is None   # Mon next week untouched


def test_no_key_is_noop(monkeypatch):
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    import api.routers.calendar as cal
    days = _days()
    with mock.patch("requests.get") as g:
        cal._patch_today_actuals(days, "2026-07-10")
    g.assert_not_called()
    assert days["2026-07-09"]["bmo"][0]["eps_act"] is None
