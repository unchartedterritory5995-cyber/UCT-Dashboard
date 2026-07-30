"""Already-passed days of the CURRENT week must keep their reporters.

Root cause (2026-07-30): `_build_live` rebuilds the WHOLE week from
EarningsWhispers + Finviz on every cache miss, and both are forward-looking
SCHEDULES, not archives — once a company reports, EW drops it from that date and
Finviz's `Earnings` column rolls to the next quarter, so `earningsdate_thisweek`
stops matching it. Measured that morning: EW served 2 names for Mon 7/27 and 6
for Tue 7/28 against Finnhub's 119 / 180 for the same dates. Monday visibly
emptied out while the week was still open.

The wire fallback never caught it: it only fires when the ENTIRE week is zero
(`live_total == 0`), and mid-week today/tomorrow are always full.

Every OTHER week already reads the retentive Finnhub range via
`_build_range_week`. These tests pin the current week's past days to that same
source.
"""
from datetime import date, timedelta
from unittest import mock

from fastapi.testclient import TestClient

from api.main import app
from api.routers import calendar as cal

client = TestClient(app)

MON, TUE, WED, THU, FRI = (date(2026, 7, 27) + timedelta(days=i) for i in range(5))
WEEK = [MON, TUE, WED, THU, FRI]
TODAY = THU  # mid-week: Mon/Tue/Wed are past, Fri is future


def _live_day(d: date, bmo=(), amc=()):
    """A day shaped like `_build_live` output."""
    day = cal._empty_day(d, TODAY)
    day["bmo"] = [dict(sym=s, eps_est=1.0, eps_act=None, rev_est=None,
                       rev_act=None, ew=7, time_et=None) for s in bmo]
    day["amc"] = [dict(sym=s, eps_est=1.0, eps_act=None, rev_est=None,
                       rev_act=None, ew=7, time_et=None) for s in amc]
    return day


def _fh_row(sym, d: date, hour="bmo", eps_act=0.5, eps_est=0.4):
    return {"symbol": sym, "date": d.isoformat(), "hour": hour,
            "epsEstimate": eps_est, "epsActual": eps_act,
            "revenueEstimate": 2_000_000_000, "revenueActual": 2_100_000_000}


CAP = {"AMKR", "APLD", "ARLP", "NUE", "RMBS", "BOH", "RZLV", "FLEX", "XOM"}


# ── the defect ────────────────────────────────────────────────────────────────

def test_past_day_emptied_by_ew_is_refilled_from_finnhub():
    """Monday keeps only RZLV in EW, but Finnhub still has the real reporters."""
    days = {
        MON.isoformat(): _live_day(MON, bmo=["RZLV"]),          # gutted by EW
        TUE.isoformat(): _live_day(TUE),                         # gutted entirely
        WED.isoformat(): _live_day(WED, bmo=["FLEX"]),
        THU.isoformat(): _live_day(THU, bmo=["NUE"]),
        FRI.isoformat(): _live_day(FRI, bmo=["XOM"]),
    }
    fh = {"earningsCalendar": [
        _fh_row("AMKR", MON, "amc"),
        _fh_row("ARLP", MON, "bmo"),
        _fh_row("BOH",  MON, "bmo"),
        _fh_row("RMBS", TUE, "amc"),
    ]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh):
        added = cal._backfill_past_days(days, WEEK, TODAY, CAP)

    assert added == 4
    mon = days[MON.isoformat()]
    assert set(e["sym"] for e in mon["bmo"]) == {"RZLV", "ARLP", "BOH"}
    assert [e["sym"] for e in mon["amc"]] == ["AMKR"]
    assert [e["sym"] for e in days[TUE.isoformat()]["amc"]] == ["RMBS"]
    # Backfilled entries carry the reported actuals that drive BEAT/MISS.
    amkr = days[MON.isoformat()]["amc"][0]
    assert amkr["eps_act"] == 0.5 and amkr["rev_act"] == 2100.0


def test_today_and_future_days_are_left_to_the_live_schedule():
    """Finnhub's broader universe must not leak into today/tomorrow — those are
    EW+Finviz's job (and today's actuals are `_patch_today_actuals`')."""
    days = {
        MON.isoformat(): _live_day(MON),
        TUE.isoformat(): _live_day(TUE),
        WED.isoformat(): _live_day(WED),
        THU.isoformat(): _live_day(THU, bmo=["NUE"]),
        FRI.isoformat(): _live_day(FRI, bmo=["XOM"]),
    }
    fh = {"earningsCalendar": [
        _fh_row("AMKR", THU, "amc"),   # today  → must be ignored
        _fh_row("APLD", FRI, "bmo"),   # future → must be ignored
        _fh_row("BOH",  MON, "bmo"),   # past   → must be added
    ]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh) as m:
        cal._backfill_past_days(days, WEEK, TODAY, CAP)

    # The range request itself stops at the last PAST day.
    assert m.call_args.args == (MON.isoformat(), WED.isoformat())
    assert [e["sym"] for e in days[THU.isoformat()]["bmo"]] == ["NUE"]
    assert days[THU.isoformat()]["amc"] == []
    assert [e["sym"] for e in days[FRI.isoformat()]["bmo"]] == ["XOM"]
    assert [e["sym"] for e in days[MON.isoformat()]["bmo"]] == ["BOH"]


def test_a_surviving_ew_entry_keeps_its_rank_and_only_gains_missing_actuals():
    """EW resolves BMO/AMC and carries the `ew` anticipation rank that drives
    ordering — Finnhub must never overwrite it, only fill the blanks."""
    days = {MON.isoformat(): _live_day(MON, bmo=["NUE"]),
            TUE.isoformat(): _live_day(TUE),
            WED.isoformat(): _live_day(WED),
            THU.isoformat(): _live_day(THU),
            FRI.isoformat(): _live_day(FRI)}
    # Finnhub disagrees on session (amc) and estimate — EW's must win.
    fh = {"earningsCalendar": [_fh_row("NUE", MON, "amc", eps_act=3.3, eps_est=9.9)]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh):
        added = cal._backfill_past_days(days, WEEK, TODAY, CAP)

    assert added == 0                                    # merged, not duplicated
    mon = days[MON.isoformat()]
    assert [e["sym"] for e in mon["bmo"]] == ["NUE"]      # stayed in EW's bucket
    assert mon["amc"] == []                              # no duplicate row
    assert mon["bmo"][0]["ew"] == 7                       # rank preserved
    assert mon["bmo"][0]["eps_est"] == 1.0                # EW estimate preserved
    assert mon["bmo"][0]["eps_act"] == 3.3                # blank actual filled


def test_backfill_applies_the_same_cap_universe_gate_as_every_other_week():
    days = {d.isoformat(): _live_day(d) for d in WEEK}
    fh = {"earningsCalendar": [
        _fh_row("BOH", MON, "bmo"),
        _fh_row("PENNYCO", MON, "bmo"),   # outside cap_universe
    ]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh):
        cal._backfill_past_days(days, WEEK, TODAY, CAP)

    assert [e["sym"] for e in days[MON.isoformat()]["bmo"]] == ["BOH"]


def test_a_finnhub_failure_leaves_the_live_week_untouched():
    """Never trade a working (if thin) calendar for an empty one."""
    days = {d.isoformat(): _live_day(d, bmo=["NUE"]) for d in WEEK}
    with mock.patch.object(cal, "_fh_get_month", return_value=None):
        assert cal._backfill_past_days(days, WEEK, TODAY, CAP) == 0
    assert [e["sym"] for e in days[MON.isoformat()]["bmo"]] == ["NUE"]


def test_monday_morning_has_no_past_days_and_makes_no_provider_call():
    days = {d.isoformat(): _live_day(d) for d in WEEK}
    with mock.patch.object(cal, "_fh_get_month") as m:
        assert cal._backfill_past_days(days, WEEK, MON, CAP) == 0
    m.assert_not_called()


def test_per_session_cap_survives_the_backfill():
    """Same [:40] per-session cap as `_build_live` and `_build_range_week`."""
    cap = {f"S{i:03d}" for i in range(60)} | {"KEEPME"}
    days = {d.isoformat(): _live_day(d) for d in WEEK}
    days[MON.isoformat()] = _live_day(MON, bmo=["KEEPME"])
    fh = {"earningsCalendar": [_fh_row(f"S{i:03d}", MON, "bmo") for i in range(60)]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh):
        cal._backfill_past_days(days, WEEK, TODAY, cap)

    bmo = days[MON.isoformat()]["bmo"]
    assert len(bmo) == 40
    # The EW-ranked name is never cut by the backfill tail.
    assert bmo[0]["sym"] == "KEEPME"


# ── the load consequence of refilling those days ──────────────────────────────

def test_past_day_enrichment_is_cached_for_hours_not_minutes():
    """A past day in the CURRENT week used to take the 5-min live-options TTL.
    That TTL exists for `expected_move`, which `_one` skips for past dates — and
    a past day now holds ~100 symbols instead of ~1, so a 5-min TTL would re-fire
    ~200 provider calls per past day every 5 minutes."""
    day = _live_day(MON, bmo=["NUE"])
    seen = {}

    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set",
                    side_effect=lambda k, v, ttl=None: seen.update({k: ttl})), \
         mock.patch.object(cal, "_today_et", return_value=TODAY), \
         mock.patch.object(cal, "_week_dates", return_value=WEEK), \
         mock.patch.object(cal, "_days_for_date", return_value=day), \
         mock.patch.object(cal, "_bounded_em", return_value=None):
        cal._compute_enrichment_for_date(MON.isoformat())

    assert seen[f"calendar_enrichment_{MON.isoformat()}"] == cal._ENRICH_TTL_PAST


def test_today_still_gets_the_live_enrichment_ttl():
    """The past-day rule must not slow down today's expected-move refresh."""
    day = _live_day(THU, bmo=["NUE"])
    seen = {}

    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set",
                    side_effect=lambda k, v, ttl=None: seen.update({k: ttl})), \
         mock.patch.object(cal, "_today_et", return_value=TODAY), \
         mock.patch.object(cal, "_week_dates", return_value=WEEK), \
         mock.patch.object(cal, "_days_for_date", return_value=day), \
         mock.patch.object(cal, "_bounded_em", return_value=None):
        cal._compute_enrichment_for_date(THU.isoformat())

    assert seen[f"calendar_enrichment_{THU.isoformat()}"] == cal._ENRICH_TTL


# ── end-to-end through the endpoint (assert on the served artifact) ───────────

def test_get_calendar_serves_a_populated_past_day():
    live = {
        MON.isoformat(): _live_day(MON, bmo=["RZLV"]),
        TUE.isoformat(): _live_day(TUE),
        WED.isoformat(): _live_day(WED, bmo=["FLEX"]),
        THU.isoformat(): _live_day(THU, bmo=["NUE"]),
        FRI.isoformat(): _live_day(FRI, bmo=["XOM"]),
    }
    fh = {"earningsCalendar": [_fh_row("AMKR", MON, "amc"), _fh_row("ARLP", MON, "bmo")]}

    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch.object(cal, "_week_dates", return_value=WEEK), \
         mock.patch.object(cal, "_today_et", return_value=TODAY), \
         mock.patch.object(cal, "_build_live", return_value=live), \
         mock.patch.object(cal, "_load_cap_universe", return_value=CAP), \
         mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_patch_today_actuals"), \
         mock.patch.object(cal, "_merge_sticky_actuals"), \
         mock.patch.object(cal, "_curate_econ_events"), \
         mock.patch.object(cal, "_attach_names"), \
         mock.patch.object(cal, "_attach_date_moves"), \
         mock.patch("api.services.engine._load_wire_data",
                    return_value={"cap_universe": sorted(CAP)}):
        r = client.get("/api/calendar")

    assert r.status_code == 200
    body = r.json()
    assert body["is_current_week"] is True
    mon = body["days"][MON.isoformat()]
    assert set(e["sym"] for e in mon["bmo"]) == {"RZLV", "ARLP"}
    assert [e["sym"] for e in mon["amc"]] == ["AMKR"]
