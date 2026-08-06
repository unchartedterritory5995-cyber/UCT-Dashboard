"""Week paging (?week=), TBD session state, past-date reactions, and the
date-aware day resolver — Deploy 1a of the calendar flagship redesign."""
from datetime import date, timedelta
from unittest import mock

from fastapi.testclient import TestClient

from api.main import app
from api.routers import calendar as cal_mod

client = TestClient(app)


def _next_monday() -> date:
    cur = cal_mod._week_dates()[0]
    return cur + timedelta(days=7)


def _fh_payload(monday: date) -> dict:
    ds = monday.isoformat()
    return {"earningsCalendar": [
        {"symbol": "PEP",  "date": ds, "hour": "bmo", "epsEstimate": 2.21,
         "revenueEstimate": 894_000_000, "epsActual": None, "revenueActual": None},
        {"symbol": "BALY", "date": ds, "hour": "amc", "epsEstimate": -1.35,
         "revenueEstimate": None, "epsActual": None, "revenueActual": None},
        {"symbol": "ACU",  "date": ds, "hour": "",    "epsEstimate": 0.58,
         "revenueEstimate": 56_800_000, "epsActual": None, "revenueActual": None},
        {"symbol": "ZZZZOFF", "date": ds, "hour": "bmo", "epsEstimate": 1.0,
         "revenueEstimate": None, "epsActual": None, "revenueActual": None},
    ]}


def _range_env(fh_payload, cap=("PEP", "BALY", "ACU")):
    """Common patch stack for range-week builds: cold cache, fixed providers."""
    return (
        mock.patch("api.routers.calendar.cache.get", return_value=None),
        mock.patch("api.routers.calendar.cache.set"),
        mock.patch.object(cal_mod, "_fh_get_month", return_value=fh_payload),
        mock.patch.object(cal_mod, "_load_cap_universe", return_value=set(cap)),
        mock.patch.object(cal_mod, "_attach_names"),
        mock.patch.object(cal_mod, "_curate_econ_events"),
    )


def test_week_param_builds_range_week_with_tbd_state():
    monday = _next_monday()
    patches = _range_env(_fh_payload(monday))
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5]:
        r = client.get(f"/api/calendar?week={monday.isoformat()}")
    assert r.status_code == 200
    body = r.json()
    assert body["is_current_week"] is False
    assert body["source"] == "range_finnhub"
    assert body["week_start"] == monday.isoformat()

    day = body["days"][monday.isoformat()]
    assert [e["sym"] for e in day["bmo"]] == ["PEP"]      # ZZZZOFF cap-filtered
    assert [e["sym"] for e in day["amc"]] == ["BALY"]
    # hour="" is UNCONFIRMED — lands in tbd, never coerced into amc
    assert [e["sym"] for e in day["tbd"]] == ["ACU"]
    assert day["tbd"][0]["date_est"] is True
    assert day["bmo"][0]["date_est"] is False
    assert day["bmo"][0]["rev_est"] == 894.0              # millions


def test_week_param_snaps_any_date_to_monday():
    monday = _next_monday()
    thursday = monday + timedelta(days=3)
    patches = _range_env(_fh_payload(monday))
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5]:
        r = client.get(f"/api/calendar?week={thursday.isoformat()}")
    assert r.json()["week_start"] == monday.isoformat()


def test_week_param_out_of_horizon_is_honest():
    far = cal_mod._week_dates()[0] + timedelta(weeks=60)
    r = client.get(f"/api/calendar?week={far.isoformat()}")
    body = r.json()
    assert body["source"] == "out_of_range"
    assert body["days"] == {}
    assert body["is_current_week"] is False


def test_current_week_param_uses_legacy_cache_key():
    """?week= pointing at the current week must hit the calendar_weekly path
    (the key calendar_alerts / awareness / ics all read)."""
    cur_monday = cal_mod._week_dates()[0]
    sentinel = {"week_start": cur_monday.isoformat(), "days": {}, "source": "cached",
                "is_current_week": True}

    def _cache_get(key):
        return sentinel if key == "calendar_weekly" else None

    with mock.patch("api.routers.calendar.cache.get", side_effect=_cache_get):
        r = client.get(f"/api/calendar?week={cur_monday.isoformat()}")
    assert r.json()["source"] == "cached"


def test_range_week_falls_back_to_fmp_all_tbd():
    monday = _next_monday()
    ds = monday.isoformat()
    fmp_rows = [
        {"symbol": "PEP", "date": ds, "epsEstimated": 2.21,
         "revenueEstimated": 894_000_000, "epsActual": None, "revenueActual": None},
        {"symbol": "IVSO.ST", "date": ds, "epsEstimated": 1.49,
         "revenueEstimated": 497_000_000, "epsActual": None, "revenueActual": None},
    ]
    patches = _range_env(None)   # Finnhub down
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], \
         mock.patch.object(cal_mod, "_fmp_range_week", return_value=fmp_rows):
        r = client.get(f"/api/calendar?week={ds}")
    body = r.json()
    assert body["source"] == "range_fmp"
    day = body["days"][ds]
    # FMP carries no session → everything tbd; international symbol filtered
    assert [e["sym"] for e in day["tbd"]] == ["PEP"]
    assert day["bmo"] == [] and day["amc"] == []


def test_days_for_date_resolves_current_vs_range_week():
    cur_monday = cal_mod._week_dates()[0]
    cur_ds = cur_monday.isoformat()
    weekly = {"days": {cur_ds: {"bmo": [{"sym": "NOW"}], "amc": [], "tbd": []}}}

    def _cache_get(key):
        return weekly if key == "calendar_weekly" else None

    with mock.patch("api.routers.calendar.cache.get", side_effect=_cache_get):
        day = cal_mod._days_for_date(cur_ds)
    assert day["bmo"][0]["sym"] == "NOW"

    nxt = _next_monday().isoformat()
    range_payload = {"days": {nxt: {"bmo": [], "amc": [], "tbd": [{"sym": "LATER"}]}}}
    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch.object(cal_mod, "_get_or_build_range_week",
                           return_value=range_payload):
        day = cal_mod._days_for_date(nxt)
    assert day["tbd"][0]["sym"] == "LATER"


def test_month_unknown_hour_lands_in_tbd():
    today = cal_mod._today_et()
    # Pick a day THIS MONTH that is guaranteed to be a weekday, rather than
    # hardcoding day 15 -- the month endpoint correctly OMITS weekend dates
    # from `days`, so a weekend 15th (e.g. 2026-08-15, a Saturday) silently
    # makes this test pass for the wrong reason (day missing from the
    # response) instead of exercising the unknown-hour-lands-in-tbd
    # behaviour it's meant to guard. Every month's first 7 days contain at
    # least one weekday, so this is deterministic without pinning a literal
    # date that could itself age into a weekend.
    day_num = 1
    while date(today.year, today.month, day_num).weekday() >= 5:  # Sat=5, Sun=6
        day_num += 1
    ds = date(today.year, today.month, day_num).isoformat()
    payload = {"earningsCalendar": [
        {"symbol": "PEP", "date": ds, "hour": "", "epsEstimate": 1.0,
         "revenueEstimate": None, "epsActual": None, "revenueActual": None},
    ]}
    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch.object(cal_mod, "_fh_get_month", return_value=payload), \
         mock.patch.object(cal_mod, "_load_cap_universe", return_value={"PEP"}):
        r = client.get(f"/api/calendar/month?year={today.year}&month={today.month}")
    day = r.json()["days"][ds]
    assert [e["sym"] for e in day["tbd"]] == ["PEP"]
    assert day["amc"] == []   # the old coercion is dead


def test_vevent_tbd_is_all_day():
    ev = cal_mod._build_vevent("PEP", "2026-07-16", "tbd")
    assert "DTSTART;VALUE=DATE:20260716" in ev
    assert "DTEND;VALUE=DATE:20260717" in ev
    assert "time TBD" in ev
    # bmo/amc keep session anchors
    ev2 = cal_mod._build_vevent("PEP", "2026-07-16", "bmo")
    assert "T070000" in ev2


def test_past_reactions_bmo_vs_amc_offsets():
    """BMO on D → D vs D-1 close; AMC on D → D+1 vs D close."""
    d = date(2026, 7, 1)   # a past Wednesday
    ds = d.isoformat()
    day = {
        "bmo": [{"sym": "AAA", "eps_act": 1.0}],
        "amc": [{"sym": "BBB", "eps_act": 2.0}],
        "tbd": [],
    }

    import datetime as _dt
    def _ms(day_: date) -> int:
        return int(_dt.datetime(day_.year, day_.month, day_.day, 16, 0,
                                tzinfo=cal_mod._ET).timestamp() * 1000)

    bars = [
        {"t": _ms(d - timedelta(days=1)), "c": 100.0},
        {"t": _ms(d),                     "c": 110.0},
        {"t": _ms(d + timedelta(days=1)), "c": 121.0},
    ]
    with mock.patch("api.services.massive.get_agg_bars", return_value=bars):
        out = cal_mod._past_reactions(ds, day)
    assert out["AAA"] == 10.0   # 100 → 110 on the print day
    assert out["BBB"] == 10.0   # 110 → 121 the day after the AMC print


def test_week_param_calendar_invalid_dates_fall_through_not_500():
    """'2026-13-05' passes the regex but is calendar-invalid — must land on
    the current-week fallback (200), never a 500 on the public endpoint."""
    sentinel = {"week_start": "x", "days": {}, "source": "cached", "is_current_week": True}

    def _cache_get(key):
        return sentinel if key == "calendar_weekly" else None

    for bad in ("2026-13-05", "2026-02-31", "0000-01-01"):
        with mock.patch("api.routers.calendar.cache.get", side_effect=_cache_get):
            r = client.get(f"/api/calendar?week={bad}")
        assert r.status_code == 200, bad
        assert r.json()["source"] == "cached", bad   # current-week fallback


def test_current_week_cap_filter_applies_to_tbd():
    """The tbd bucket passes the SAME universe rule as bmo/amc — a $50M
    Finviz name without a session marker must not leak into the current week
    (or into calendar_alerts/ics via the shared payload)."""
    live_days = {"2026-07-09": {
        "label": "Thu Jul 9", "day": "Thursday", "is_today": True,
        "bmo": [{"sym": "BIG", "ew": 1}], "amc": [],
        "tbd": [{"sym": "TINY", "ew": 0}, {"sym": "PEP", "ew": 0}],
        "econ": [], "fed": [],
    }}
    wire = {"cap_universe": ["BIG", "PEP"]}
    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch.object(cal_mod, "_build_live", return_value=live_days), \
         mock.patch("api.services.engine._load_wire_data", return_value=wire), \
         mock.patch.object(cal_mod, "_patch_today_actuals"), \
         mock.patch.object(cal_mod, "_curate_econ_events"), \
         mock.patch.object(cal_mod, "_attach_names"):
        r = client.get("/api/calendar")
    day = r.json()["days"]["2026-07-09"]
    assert [e["sym"] for e in day["tbd"]] == ["PEP"]   # TINY cap-filtered
    assert [e["sym"] for e in day["bmo"]] == ["BIG"]


def test_alerts_reporters_include_tbd():
    from api.services import calendar_alerts as ca
    cal = {"days": {"2026-07-16": {
        "bmo": [{"sym": "AAA"}], "amc": [], "tbd": [{"sym": "CCC"}]}}}
    with mock.patch("api.services.cache.cache.get", return_value=cal):
        syms = ca._get_reporters_for_date("2026-07-16")
    assert syms == {"AAA", "CCC"}
