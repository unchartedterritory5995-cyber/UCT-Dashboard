"""The CURRENT week's STILL-FUTURE days must carry every in-universe reporter
the providers know — not only the ones EarningsWhispers happens to list.

Root cause (2026-08-16, owner report: BABA/BIDU/KLAR/FUTU absent from the week
of Aug 17). The current week was built with THREE date regimes and three
different source sets:

    past days of this week  Finnhub + FMP + Finviz   (`_backfill_past_days`)
    today                   EW + Finnhub + FMP       (`_supplement_today_roster`)
    STILL-FUTURE days       EarningsWhispers ONLY    <- the hole

…while EVERY OTHER week (`_build_range_week`) merged Finnhub + FMP + Finviz
across all five days. So a name absent from EW's calendar was absent from our
current week outright, even though two paid providers carried it — and the same
date, once the week rolled and it became a "range week", would show it.

`_build_live`'s second leg could not cover for it either: it asked Finviz for
preset view `v=111`, whose export carries **no `Earnings` column at all**
(measured live 2026-08-16 — columns are No./Ticker/Company/Sector/Industry/
Country/Market Cap/P/E/Price/Change/Volume). Every one of its 944 rows failed
the `if not date_str_fv: continue` guard, so the leg contributed ZERO and the
"EW + Finviz" live path was EW alone in fact. Measured on production the same
day: the served week held 71 in-universe reporters against 122 known to
EW ∪ Finnhub ∪ FMP, and carried **no symbol EW did not have**.

`_supplement_live_days` closes it by extending the today-roster supplement to
today AND every still-future day of the shown week, with the same add-only
precedence the range builder uses: Finnhub adds into its stated session bucket,
FMP adds what is still missing into `tbd` (it carries no session field — never
coerced), Finviz's custom export (`v=152`, which DOES carry Earnings Date) adds
a third independent opinion.
"""
from datetime import date, timedelta
from unittest import mock

from api.routers import calendar as cal

# The owner's week. Today is the SUNDAY before it, which is exactly the state
# the report came from: `_current_week_monday` rolls a weekend forward, so all
# five shown days are still in the future.
MON, TUE, WED, THU, FRI = (date(2026, 8, 17) + timedelta(days=i) for i in range(5))
WEEK = [MON, TUE, WED, THU, FRI]
SUNDAY = date(2026, 8, 16)
SUNDAY_S = SUNDAY.isoformat()

CAP = {"HD", "WMT", "BABA", "BIDU", "KLAR", "FUTU", "DE", "NTES", "BEKE", "TGT"}


def _live_day(d: date, bmo=(), amc=(), today=SUNDAY):
    """A day shaped like `_build_live` output."""
    day = cal._empty_day(d, today)
    day["bmo"] = [dict(sym=s, eps_est=1.0, eps_act=None, rev_est=None,
                       rev_act=None, ew=7, time_et=None) for s in bmo]
    day["amc"] = [dict(sym=s, eps_est=1.0, eps_act=None, rev_est=None,
                       rev_act=None, ew=7, time_et=None) for s in amc]
    return day


def _week(**per_day):
    """`per_day` maps an ISO date to the `_live_day` kwargs for that day."""
    return {d.isoformat(): _live_day(d, **per_day.get(d.isoformat(), {}))
            for d in WEEK}


def _fh_row(sym, ds, hour="bmo", eps_est=1.94, eps_act=None):
    """Finnhub `/calendar/earnings` shape, probe-verified 2026-08-16 (BABA)."""
    return {"symbol": sym, "date": ds, "hour": hour,
            "epsEstimate": eps_est, "epsActual": eps_act,
            "revenueEstimate": 39_517_890_000, "revenueActual": None}


def _fmp_row(sym, ds, eps_est=1.5):
    """FMP `stable/earnings-calendar` shape, probe-verified 2026-08-16 (BABA).
    Note there is NO session field — that is why an FMP-only add lands in tbd."""
    return {"symbol": sym, "date": ds, "epsActual": None, "epsEstimated": eps_est,
            "revenueActual": None, "revenueEstimated": 39_517_890_000,
            "lastUpdated": "2026-08-16"}


def _no_finviz(monkeypatch):
    """Silence the third leg — its own suite covers it."""
    monkeypatch.setattr(cal, "_merge_finviz_sessions", lambda *a, **kw: (0, 0))


# ── the defect ────────────────────────────────────────────────────────────────

def test_a_forward_day_reporter_only_finnhub_knows_is_added_to_its_session(monkeypatch):
    """BABA at its real 8/20 shape: Thursday BMO, known to Finnhub, absent from
    the EW page the live schedule was built from."""
    _no_finviz(monkeypatch)
    days = _week(**{THU.isoformat(): {"bmo": ["WMT"]}})
    fh = {"earningsCalendar": [_fh_row("BABA", THU.isoformat(), "bmo"),
                               _fh_row("FUTU", THU.isoformat(), "bmo")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh) as m, \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        added = cal._supplement_live_days(days, SUNDAY_S, CAP)

    # ONE range call covering the whole still-future window, not one per day.
    assert m.call_args.args == (MON.isoformat(), FRI.isoformat())
    assert added == 2
    thu = days[THU.isoformat()]
    assert [e["sym"] for e in thu["bmo"]] == ["WMT", "BABA", "FUTU"]
    assert thu["bmo"][1]["eps_est"] == 1.94
    assert thu["bmo"][1]["rev_est"] == 39517.9        # millions, 1dp


def test_a_forward_day_reporter_only_fmp_knows_lands_in_tbd_with_its_numbers(monkeypatch):
    """FMP carries no session field, so its adds must render as unknown —
    never coerced into bmo/amc."""
    _no_finviz(monkeypatch)
    days = _week(**{TUE.isoformat(): {"bmo": ["HD"]}})
    with mock.patch.object(cal, "_fh_get_month", return_value=None), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("BIDU", TUE.isoformat(), 1.51),
                                         _fmp_row("KLAR", TUE.isoformat(), -0.05)]) as fmp:
        added = cal._supplement_live_days(days, SUNDAY_S, CAP)

    assert fmp.call_args.args == (MON.isoformat(), FRI.isoformat())
    assert added == 2
    tue = days[TUE.isoformat()]
    assert [e["sym"] for e in tue["bmo"]] == ["HD"]
    assert [e["sym"] for e in tue["tbd"]] == ["BIDU", "KLAR"]
    assert tue["tbd"][0]["eps_est"] == 1.51
    assert tue["tbd"][1]["eps_est"] == -0.05


def test_a_symbol_the_schedule_already_placed_is_never_added_on_another_day(monkeypatch):
    """⛔ ONE PLACEMENT PER SYMBOL PER WEEK. Providers disagree about dates for
    the week ahead — measured live on 2026-08-17 with the merge shipped and a
    per-DAY check: EW had XP on Monday while FMP projected Tuesday, and Finnhub
    put ROST on Wednesday against EW's confirmed Thursday. Five companies
    rendered twice in one week. The schedule's confirmed date wins."""
    _no_finviz(monkeypatch)
    days = _week(**{THU.isoformat(): {"amc": ["DE"]}})
    fh = {"earningsCalendar": [_fh_row("DE", WED.isoformat(), "bmo")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("DE", TUE.isoformat())]):
        added = cal._supplement_live_days(days, SUNDAY_S, CAP)

    assert added == 0
    assert [e["sym"] for e in days[THU.isoformat()]["amc"]] == ["DE"]
    assert days[WED.isoformat()]["bmo"] == [] and days[TUE.isoformat()]["tbd"] == []


def test_finnhub_beats_fmp_when_the_two_disagree_about_the_day(monkeypatch):
    """Neither leg's date is confirmed, so precedence decides — and Finnhub
    goes first because it also carries the session."""
    _no_finviz(monkeypatch)
    days = _week()
    fh = {"earningsCalendar": [_fh_row("NTES", WED.isoformat(), "bmo")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("NTES", THU.isoformat())]):
        added = cal._supplement_live_days(days, SUNDAY_S, CAP)

    assert added == 1
    assert [e["sym"] for e in days[WED.isoformat()]["bmo"]] == ["NTES"]
    assert days[THU.isoformat()]["tbd"] == []


def test_a_name_that_already_reported_earlier_this_week_is_not_re_added_ahead(monkeypatch):
    """Mid-week: a company on Monday's finished board must not reappear on
    Thursday because a provider still carries a projected date for it."""
    _no_finviz(monkeypatch)
    days = _week(**{MON.isoformat(): {"bmo": ["WMT"]}})
    fh = {"earningsCalendar": [_fh_row("WMT", THU.isoformat(), "bmo")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        added = cal._supplement_live_days(days, WED.isoformat(), CAP)

    assert added == 0
    assert days[THU.isoformat()]["bmo"] == []
    assert [e["sym"] for e in days[MON.isoformat()]["bmo"]] == ["WMT"]


def test_the_finviz_leg_obeys_the_one_placement_rule_too(monkeypatch):
    """It gets the same gate, wrapped into the `keep` callable it already takes."""
    captured = {}

    def _fake_merge(days_, target_ds, filt, keep, sym_index, rebucket_ds=None):
        captured["keep_placed"] = keep("WMT")     # already on Thursday
        captured["keep_fresh"] = keep("NTES")     # nowhere yet
        return 0, 0

    monkeypatch.setattr(cal, "_merge_finviz_sessions", _fake_merge)
    days = _week(**{THU.isoformat(): {"bmo": ["WMT"]}})
    with mock.patch.object(cal, "_fh_get_month", return_value=None), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        cal._supplement_live_days(days, WED.isoformat(), CAP)

    assert captured == {"keep_placed": False, "keep_fresh": True}


def test_a_projected_forward_date_is_flagged_as_an_estimate(monkeypatch):
    """The same rule `_build_range_week` applies, so a projected date carries
    the same "est." chip — and is excluded by the "confirmed only" filter —
    whichever week you happen to be viewing it from. A Finnhub row that states
    a session is CONFIRMED; an empty hour and every FMP-only row are not.
    Today is exempt: a date that is happening cannot be an estimate."""
    _no_finviz(monkeypatch)
    days = _week()
    fh = {"earningsCalendar": [_fh_row("BABA", THU.isoformat(), "bmo"),
                               _fh_row("DE", THU.isoformat(), ""),
                               _fh_row("TGT", WED.isoformat(), "bmo")]}   # WED == today
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("NTES", THU.isoformat())]):
        cal._supplement_live_days(days, WED.isoformat(), CAP)

    thu, wed = days[THU.isoformat()], days[WED.isoformat()]
    assert thu["bmo"][0]["date_est"] is False        # Finnhub stated the session
    assert thu["tbd"][0]["date_est"] is True         # empty hour -> projected
    assert thu["tbd"][1]["date_est"] is True         # FMP carries no confirmation
    assert "date_est" not in wed["bmo"][0]           # today is not an estimate


def test_every_still_future_day_is_supplemented_not_only_today(monkeypatch):
    """The whole point: the supplement must not stop at `today`."""
    _no_finviz(monkeypatch)
    days = _week()
    fh = {"earningsCalendar": [_fh_row("HD", MON.isoformat()),
                               _fh_row("BIDU", TUE.isoformat()),
                               _fh_row("TGT", WED.isoformat()),
                               _fh_row("BABA", THU.isoformat()),
                               _fh_row("BEKE", FRI.isoformat())]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        added = cal._supplement_live_days(days, SUNDAY_S, CAP)

    assert added == 5
    assert [[e["sym"] for e in days[d.isoformat()]["bmo"]] for d in WEEK] == \
        [["HD"], ["BIDU"], ["TGT"], ["BABA"], ["BEKE"]]


def test_past_days_of_the_week_are_left_to_the_backfill(monkeypatch):
    """Mid-week, the finished days are `_backfill_past_days`' job — it fills
    blank fields on entries the schedule still carries, which this add-only
    pass must not race. Only today and later are in the window."""
    _no_finviz(monkeypatch)
    days = _week()
    fh = {"earningsCalendar": [_fh_row("HD", MON.isoformat()),      # already past
                               _fh_row("TGT", WED.isoformat())]}    # today
    with mock.patch.object(cal, "_fh_get_month", return_value=fh) as m, \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        added = cal._supplement_live_days(days, WED.isoformat(), CAP)

    assert m.call_args.args == (WED.isoformat(), FRI.isoformat())
    assert added == 1
    assert days[MON.isoformat()]["bmo"] == []        # untouched
    assert [e["sym"] for e in days[WED.isoformat()]["bmo"]] == ["TGT"]


def test_the_live_schedules_entries_are_never_touched_or_duplicated(monkeypatch):
    """EW owns the session, the estimate and the anticipation rank that drives
    ordering. ADD-ONLY."""
    _no_finviz(monkeypatch)
    days = _week(**{THU.isoformat(): {"bmo": ["WMT"]}})
    fh = {"earningsCalendar": [_fh_row("WMT", THU.isoformat(), "amc", eps_est=9.9)]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("WMT", THU.isoformat(), 8.8)]):
        added = cal._supplement_live_days(days, SUNDAY_S, CAP)

    assert added == 0
    thu = days[THU.isoformat()]
    assert [e["sym"] for e in thu["bmo"]] == ["WMT"]   # stayed in EW's bucket
    assert thu["amc"] == [] and thu["tbd"] == []       # no duplicate rows
    assert thu["bmo"][0]["ew"] == 7 and thu["bmo"][0]["eps_est"] == 1.0


def test_finnhub_wins_the_session_and_fmp_never_duplicates_its_add(monkeypatch):
    _no_finviz(monkeypatch)
    days = _week()
    fh = {"earningsCalendar": [_fh_row("BABA", THU.isoformat(), "bmo")]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("BABA", THU.isoformat())]):
        added = cal._supplement_live_days(days, SUNDAY_S, CAP)

    assert added == 1
    assert [e["sym"] for e in days[THU.isoformat()]["bmo"]] == ["BABA"]
    assert days[THU.isoformat()]["tbd"] == []


def test_the_same_universe_gate_as_every_other_week(monkeypatch):
    """FMP's raw range is mostly foreign listings — the same cap-universe rule
    every other week applies, so day counts stay comparable when paging."""
    _no_finviz(monkeypatch)
    days = _week()
    fh = {"earningsCalendar": [_fh_row("BABA", THU.isoformat()),
                               _fh_row("600641.SS", THU.isoformat())]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week",
                           return_value=[_fmp_row("PNCINFRA.NS", THU.isoformat()),
                                         _fmp_row("NTES", THU.isoformat())]):
        cal._supplement_live_days(days, SUNDAY_S, CAP)

    thu = days[THU.isoformat()]
    assert [e["sym"] for e in thu["bmo"]] == ["BABA"]
    assert [e["sym"] for e in thu["tbd"]] == ["NTES"]


def test_a_double_provider_failure_leaves_the_week_exactly_as_it_was(monkeypatch):
    """Never trade a working (if thin) week for an exception."""
    _no_finviz(monkeypatch)
    days = _week(**{THU.isoformat(): {"bmo": ["WMT"]}})
    with mock.patch.object(cal, "_fh_get_month", side_effect=RuntimeError("429")), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        assert cal._supplement_live_days(days, SUNDAY_S, CAP) == 0
    assert [e["sym"] for e in days[THU.isoformat()]["bmo"]] == ["WMT"]


def test_a_week_entirely_in_the_past_is_a_noop_with_no_provider_call(monkeypatch):
    """Nothing here belongs to this pass — the backfill owns finished days."""
    _no_finviz(monkeypatch)
    days = _week()
    with mock.patch.object(cal, "_fh_get_month") as fh, \
         mock.patch.object(cal, "_fmp_range_week") as fmp:
        assert cal._supplement_live_days(days, "2026-08-24", CAP) == 0
    fh.assert_not_called()
    fmp.assert_not_called()


# ── caps: a forward SCHEDULE and a live SESSION are bounded differently ───────

def test_a_forward_day_takes_the_schedule_cap_and_ew_names_are_never_cut(monkeypatch):
    """A still-future day is a forward schedule where anticipation rank decides
    who matters — the same [:40] `_build_range_week` gives every other week's
    future days, so "THU 9 · 21" means the same thing on every week."""
    _no_finviz(monkeypatch)
    n = 60
    cap = {f"S{i:04d}" for i in range(n)} | {"KEEPME"}
    days = _week(**{THU.isoformat(): {"bmo": ["KEEPME"]}})
    fh = {"earningsCalendar": [_fh_row(f"S{i:04d}", THU.isoformat()) for i in range(n)]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        cal._supplement_live_days(days, SUNDAY_S, cap)

    bmo = days[THU.isoformat()]["bmo"]
    assert len(bmo) == 40
    assert bmo[0]["sym"] == "KEEPME"


def test_today_keeps_the_loose_session_cap(monkeypatch):
    """Once prints land, the live session has no anticipation left to rank —
    cutting it just hides reporters (the 2026-08-11 finding). Today keeps
    `_PAST_SESSION_CAP` while the days after it stay on the schedule cap."""
    _no_finviz(monkeypatch)
    n = cal._PAST_SESSION_CAP + 20
    cap = {f"S{i:04d}" for i in range(n)} | {"KEEPME"}
    days = _week(**{WED.isoformat(): {"bmo": ["KEEPME"]}})
    fh = {"earningsCalendar": [_fh_row(f"S{i:04d}", WED.isoformat()) for i in range(n)]}
    with mock.patch.object(cal, "_fh_get_month", return_value=fh), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        cal._supplement_live_days(days, WED.isoformat(), cap)   # WED == today

    bmo = days[WED.isoformat()]["bmo"]
    assert len(bmo) == cal._PAST_SESSION_CAP
    assert bmo[0]["sym"] == "KEEPME"


# ── the third leg: Finviz's CUSTOM export, the one that carries Earnings Date ──

def test_the_finviz_leg_runs_over_the_forward_window_add_only(monkeypatch):
    """`_build_live` asked Finviz for preset `v=111`, whose export has no
    `Earnings` column at all, so its merge dropped every row and the live path
    was single-source in fact. The working custom-view implementation
    (`_merge_finviz_sessions`, `v=152&c=0,1,68`) now covers the same days.

    Forward dates are ADD-ONLY: the per-session cap is applied after the merge,
    so re-bucketing under the tight schedule cap pushes rows past it and the
    surplus is CUT. Today's cap is loose, so today may re-bucket."""
    seen = {}

    def _fake_merge(days_, target_ds, filt, keep, sym_index, rebucket_ds=None):
        seen.update(target=set(target_ds), filt=filt, rebucket=rebucket_ds)
        days_[THU.isoformat()]["bmo"].append(
            {"sym": "DE", "eps_est": None, "eps_act": None, "rev_est": None,
             "rev_act": None, "ew": 0, "mc_b": None, "time_et": None})
        return 1, 0

    monkeypatch.setattr(cal, "_merge_finviz_sessions", _fake_merge)
    days = _week()
    with mock.patch.object(cal, "_fh_get_month", return_value=None), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        added = cal._supplement_live_days(days, WED.isoformat(), CAP)

    assert seen["target"] == {WED.isoformat(), THU.isoformat(), FRI.isoformat()}
    assert seen["filt"] == "earningsdate_thisweek"
    assert seen["rebucket"] == {WED.isoformat()}      # today only
    assert added == 1
    assert [e["sym"] for e in days[THU.isoformat()]["bmo"]] == ["DE"]


def test_finviz_is_skipped_when_no_filter_covers_the_shown_week(monkeypatch):
    """Finviz exposes only `thisweek`/`prevweek`. On a weekend the shown week is
    the NEXT one, which no filter reaches — skip the leg rather than fire a
    request that would silently return the wrong week's rows."""
    monkeypatch.setattr(cal, "_merge_finviz_sessions",
                        mock.Mock(side_effect=AssertionError("must not run")))
    days = _week()
    with mock.patch.object(cal, "_fh_get_month", return_value=None), \
         mock.patch.object(cal, "_fmp_range_week", return_value=None):
        assert cal._supplement_live_days(days, SUNDAY_S, CAP) == 0


# ── the wire: `_build_current_week` must actually reach the forward days ──────

def _pin_build(monkeypatch, today, live_days):
    monkeypatch.setattr(cal, "_today_et", lambda: today)
    monkeypatch.setattr("api.services.engine._load_wire_data", lambda: None)
    monkeypatch.setattr(cal, "_build_live", lambda week_dates, t: live_days)
    monkeypatch.setattr(cal, "_backfill_past_days", lambda *a, **kw: 0)
    monkeypatch.setattr(cal, "_patch_today_actuals", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_restore_sticky_reporters", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_merge_sticky_actuals", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_curate_econ_events", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_attach_names", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_attach_date_moves", lambda *a, **kw: None)
    monkeypatch.setattr(cal, "_merge_finviz_sessions", lambda *a, **kw: (0, 0))
    cal.cache.invalidate("calendar_weekly")


def test_build_current_week_carries_the_reporters_the_schedule_never_listed(monkeypatch):
    """The 8/16 report end-to-end: a Sunday build of the week of Aug 17, an EW
    page that lists neither BABA/FUTU (Thu) nor BIDU/KLAR (Tue), and both
    providers carrying all four. Pins the CALL SITE, not just the helper —
    lesson_built_tested_green_and_unreachable."""
    live = _week(**{THU.isoformat(): {"bmo": ["WMT"]}, TUE.isoformat(): {"bmo": ["HD"]}})
    _pin_build(monkeypatch, SUNDAY, live)
    fh = {"earningsCalendar": [_fh_row("BABA", THU.isoformat(), "bmo"),
                               _fh_row("FUTU", THU.isoformat(), "bmo"),
                               _fh_row("BIDU", TUE.isoformat(), "bmo"),
                               _fh_row("KLAR", TUE.isoformat(), "bmo")]}
    monkeypatch.setattr(cal, "_fh_get_month", lambda *a, **kw: fh)
    monkeypatch.setattr(cal, "_fmp_range_week", lambda *a, **kw: None)

    payload = cal._build_current_week()

    assert payload["week_start"] == MON.isoformat()
    assert [e["sym"] for e in payload["days"][THU.isoformat()]["bmo"]] == \
        ["WMT", "BABA", "FUTU"]
    assert [e["sym"] for e in payload["days"][TUE.isoformat()]["bmo"]] == \
        ["HD", "BIDU", "KLAR"]


def test_the_build_records_what_the_schedule_alone_knew(monkeypatch):
    """`GET /api/admin/calendar-coverage-status`. A forward week back on one
    narrow source is invisible from the calendar itself — it just looks like a
    quiet week. This is the measurement that makes it a fact: `supplemented`
    pinned at 0 with `served == schedule_only` every day is the 8/16 shape."""
    live = _week(**{THU.isoformat(): {"bmo": ["WMT"]}})
    _pin_build(monkeypatch, SUNDAY, live)
    fh = {"earningsCalendar": [_fh_row("BABA", THU.isoformat(), "bmo"),
                               _fh_row("BIDU", TUE.isoformat(), "bmo")]}
    monkeypatch.setattr(cal, "_fh_get_month", lambda *a, **kw: fh)
    monkeypatch.setattr(cal, "_fmp_range_week", lambda *a, **kw: None)

    cal._build_current_week()
    report = cal.calendar_coverage_status()

    assert report["window"] == [MON.isoformat(), FRI.isoformat()]
    assert report["supplemented"] == 2
    # THU: EW knew 1, we serve 2. TUE: EW knew 0, we serve 1.
    assert report["days"][THU.isoformat()] == {"served": 2, "schedule_only": 1}
    assert report["days"][TUE.isoformat()] == {"served": 1, "schedule_only": 0}
    assert report["days"][MON.isoformat()] == {"served": 0, "schedule_only": 0}


def test_the_coverage_report_survives_a_total_provider_failure(monkeypatch):
    """A monitor that goes silent exactly when the thing it watches breaks is
    worse than none — it reads as "nothing to report"."""
    live = _week(**{THU.isoformat(): {"bmo": ["WMT"]}})
    _pin_build(monkeypatch, SUNDAY, live)
    monkeypatch.setattr(cal, "_fh_get_month",
                        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("429")))
    monkeypatch.setattr(cal, "_fmp_range_week", lambda *a, **kw: None)

    cal._build_current_week()
    report = cal.calendar_coverage_status()

    assert report["supplemented"] == 0
    assert report["days"][THU.isoformat()] == {"served": 1, "schedule_only": 1}


def test_the_admin_refresh_rebuilds_through_the_same_path(monkeypatch):
    """`/api/calendar/refresh` used to be a SECOND, divergent copy of the build:
    no universe filter, no past-day backfill, no roster supplement. An admin
    refreshing during an outage therefore replaced the real week with a thinner
    one. It now rebuilds through `_build_current_week`, so a refreshed week and
    a naturally-built week can never disagree."""
    live = _week(**{THU.isoformat(): {"bmo": ["WMT"]}})
    _pin_build(monkeypatch, SUNDAY, live)
    fh = {"earningsCalendar": [_fh_row("BABA", THU.isoformat(), "bmo")]}
    monkeypatch.setattr(cal, "_fh_get_month", lambda *a, **kw: fh)
    monkeypatch.setattr(cal, "_fmp_range_week", lambda *a, **kw: None)

    out = cal.refresh_calendar(user={"id": "admin", "role": "admin"})

    assert out["ok"] is True
    assert out["totals"][THU.isoformat()]["bmo"] == 2
    assert [e["sym"] for e in cal.cache.get("calendar_weekly")["days"]
            [THU.isoformat()]["bmo"]] == ["WMT", "BABA"]
