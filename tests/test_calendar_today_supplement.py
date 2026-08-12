"""TODAY's roster must include every in-universe reporter the providers know.

Root cause (2026-08-11): the current week's TODAY bucket is sourced ONLY from
EarningsWhispers + Finviz forward schedules. Both under-cover the day —
measured that evening: EW+Finviz knew 59 names for Tue 8/11 against FMP's 104
in-universe reporters, 87 of which had already PUBLISHED actuals (SLAB: EPS
0.71 vs 0.69 est). `_patch_today_actuals` cannot help — it only fills fields on
entries that already exist — and `_backfill_past_days` deliberately stops at
`d < today`. The earnings wire builds its watchlist from this same payload
(`todays_reporters`), so all 38 already-reported names were structurally
invisible to the feed until the day rolled past.

`_supplement_today_roster` closes the gap with the SAME two provider legs the
range-week builder already trusts: Finnhub adds into its stated session bucket,
FMP adds what's still missing into `tbd` (it carries no session field — an
unknown session renders as unknown, never coerced). ADD-ONLY: entries the live
schedule already owns are never touched, so EW's session + anticipation rank
always win.
"""
from datetime import date, timedelta
from unittest import mock

from api.routers import calendar as cal

MON, TUE, WED, THU, FRI = (date(2026, 8, 10) + timedelta(days=i) for i in range(5))
WEEK = [MON, TUE, WED, THU, FRI]
TODAY = TUE
TODAY_S = TODAY.isoformat()


def _live_day(d: date, bmo=(), amc=()):
    """A day shaped like `_build_live` output."""
    day = cal._empty_day(d, TODAY)
    day["bmo"] = [dict(sym=s, eps_est=1.0, eps_act=None, rev_est=None,
                       rev_act=None, ew=7, time_et=None) for s in bmo]
    day["amc"] = [dict(sym=s, eps_est=1.0, eps_act=None, rev_est=None,
                       rev_act=None, ew=7, time_et=None) for s in amc]
    return day


def _week_days(**today_kw):
    return {d.isoformat(): (_live_day(d, **today_kw) if d == TODAY else _live_day(d))
            for d in WEEK}


def _fh_row(sym, hour="bmo", eps_act=0.5, eps_est=0.4):
    return {"symbol": sym, "date": TODAY_S, "hour": hour,
            "epsEstimate": eps_est, "epsActual": eps_act,
            "revenueEstimate": 2_000_000_000, "revenueActual": 2_100_000_000}


def _fmp_row(sym, eps_act=0.71, eps_est=0.69):
    """Real shape, probe-verified 2026-08-11 (SLAB): `epsEstimated` /
    `revenueEstimated`, revenue in raw dollars, NO session field."""
    return {"symbol": sym, "date": TODAY_S, "epsActual": eps_act,
            "epsEstimated": eps_est, "revenueActual": 228_189_000,
            "revenueEstimated": 227_992_300, "lastUpdated": TODAY_S}


CAP = {"SE", "CAH", "SLAB", "BGS", "IHS", "SANA", "NUE"}


# ── the defect ────────────────────────────────────────────────────────────────

def test_a_reporter_only_fmp_knows_is_added_to_todays_tbd_with_its_numbers():
    """SLAB, at its real 8/11 shape: reported, absent from EW, known to FMP."""
    days = _week_days(bmo=["SE"], amc=["CAH"])
    with mock.patch.object(cal, "_fh_get_month", return_value=None), \
         mock.patch.object(cal, "_fmp_range_week", return_value=[_fmp_row("SLAB")]) as fmp:
        added = cal._supplement_today_roster(days, TODAY_S, CAP)

    assert fmp.call_args.args == (TODAY_S, TODAY_S)   # one day, never a range
    assert added == 1
    tbd = days[TODAY_S]["tbd"]
    assert [e["sym"] for e in tbd] == ["SLAB"]
    slab = tbd[0]
    assert slab["eps_act"] == 0.71 and slab["eps_est"] == 0.69
    assert slab["rev_act"] == 228.2 and slab["rev_est"] == 228.0   # millions


def test_a_finnhub_reporter_lands_in_its_stated_session_bucket():
    days = _week_days(bmo=["SE"])
    fh = {"earningsCalendar": [_fh_row("BGS", "amc"), _fh_row("IHS", "bmo"),
                               _fh_row("SANA", "")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh) as m, \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        added = cal._supplement_today_roster(days, TODAY_S, CAP)

    assert m.call_args.args == (TODAY_S, TODAY_S)
    assert added == 3
    day = days[TODAY_S]
    assert [e["sym"] for e in day["amc"]] == ["BGS"]
    assert [e["sym"] for e in day["bmo"]] == ["SE", "IHS"]
    assert [e["sym"] for e in day["tbd"]] == ["SANA"]   # unknown session stays honest
    bgs = day["amc"][0]
    assert bgs["eps_act"] == 0.5 and bgs["rev_act"] == 2100.0


def test_the_live_schedules_entries_are_never_touched_or_duplicated():
    """EW owns session + anticipation rank + its estimate; the supplement is
    ADD-ONLY (blank actuals on existing entries are `_patch_today_actuals`'
    job, which runs right after)."""
    days = _week_days(bmo=["NUE"])
    fh = {"earningsCalendar": [_fh_row("NUE", "amc", eps_act=3.3, eps_est=9.9)]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("NUE", eps_est=8.8)]):
        added = cal._supplement_today_roster(days, TODAY_S, CAP)

    assert added == 0
    day = days[TODAY_S]
    assert [e["sym"] for e in day["bmo"]] == ["NUE"]   # stayed in EW's bucket
    assert day["amc"] == [] and day["tbd"] == []       # no duplicate rows
    assert day["bmo"][0]["ew"] == 7                    # rank preserved
    assert day["bmo"][0]["eps_est"] == 1.0             # EW estimate preserved
    assert day["bmo"][0]["eps_act"] is None            # fills belong to the patch


def test_finnhub_wins_the_session_and_fmp_never_duplicates_its_add():
    days = _week_days()
    fh = {"earningsCalendar": [_fh_row("BGS", "amc")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week", return_value=[_fmp_row("BGS")]):
        added = cal._supplement_today_roster(days, TODAY_S, CAP)

    assert added == 1
    assert [e["sym"] for e in days[TODAY_S]["amc"]] == ["BGS"]
    assert days[TODAY_S]["tbd"] == []


def test_the_same_universe_gate_as_every_other_week():
    days = _week_days()
    fh = {"earningsCalendar": [_fh_row("BGS"), _fh_row("600641.SS")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("PNCINFRA.NS"), _fmp_row("SLAB")]):
        cal._supplement_today_roster(days, TODAY_S, CAP)

    day = days[TODAY_S]
    assert [e["sym"] for e in day["bmo"]] == ["BGS"]
    assert [e["sym"] for e in day["tbd"]] == ["SLAB"]


def test_a_double_provider_failure_leaves_today_exactly_as_it_was():
    """Never trade a working (if thin) day for an exception."""
    days = _week_days(bmo=["SE"])
    with mock.patch.object(cal, "_fh_get_month", side_effect=RuntimeError("429")), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        assert cal._supplement_today_roster(days, TODAY_S, CAP) == 0
    assert [e["sym"] for e in days[TODAY_S]["bmo"]] == ["SE"]


def test_a_today_outside_the_shown_week_is_a_noop_with_no_provider_call():
    """Weekend: the current week rolls forward, so 'today' has no bucket."""
    days = _week_days()
    with mock.patch.object(cal, "_fh_get_month") as fh, \
         mock.patch.object(cal, "_fmp_range_week") as fmp:
        assert cal._supplement_today_roster(days, "2026-08-08", CAP) == 0
    fh.assert_not_called()
    fmp.assert_not_called()


def test_today_is_bounded_by_the_past_session_cap_and_ew_names_are_never_cut():
    """A live session is no longer a pure forward schedule once prints land —
    it takes the loose `_PAST_SESSION_CAP`, and the appended tail is what gets
    cut, never the EW-ranked head."""
    n = cal._PAST_SESSION_CAP + 20
    cap = {f"S{i:04d}" for i in range(n)} | {"KEEPME"}
    days = _week_days(bmo=["KEEPME"])
    fh = {"earningsCalendar": [_fh_row(f"S{i:04d}") for i in range(n)]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        cal._supplement_today_roster(days, TODAY_S, cap)

    bmo = days[TODAY_S]["bmo"]
    assert len(bmo) == cal._PAST_SESSION_CAP
    assert bmo[0]["sym"] == "KEEPME"


# ── the wire: `_build_current_week` must actually CALL it ─────────────────────

def test_build_current_week_reaches_the_supplement_and_the_payload_carries_it(monkeypatch):
    """The 8/11 defect end-to-end: a thin live schedule, FMP knowing a reported
    name — the built payload (the same one `todays_reporters` reads) must show
    it. Pins the call site, not just the helper — see
    lesson_built_tested_green_and_unreachable."""
    monkeypatch.setattr(cal, "_today_et", lambda: TODAY)   # never weekday-dependent
    monkeypatch.setattr("api.services.engine._load_wire_data", lambda: None)

    def _fake_live(week_dates, today):
        return {d.strftime("%Y-%m-%d"): _live_day(d, bmo=(["SE"] if d == TODAY else []))
                for d in week_dates}

    monkeypatch.setattr(cal, "_build_live", _fake_live)
    monkeypatch.setattr(cal, "_backfill_past_days", lambda *a, **kw: 0)
    monkeypatch.setattr(cal, "_patch_today_actuals", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_restore_sticky_reporters", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_merge_sticky_actuals", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_curate_econ_events", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_attach_names", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_attach_date_moves", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_fh_get_month", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_fmp_range_week", lambda *a, **kw: [_fmp_row("SLAB")])
    cal.cache.invalidate("calendar_weekly")

    payload = cal._build_current_week()

    today_day = payload["days"][TODAY_S]
    assert [e["sym"] for e in today_day["tbd"]] == ["SLAB"]
    assert today_day["tbd"][0]["eps_act"] == 0.71
    # And the thin schedule's own entry is intact beside it.
    assert [e["sym"] for e in today_day["bmo"]] == ["SE"]
