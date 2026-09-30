"""backfill_timing.py: late-side backfill placement -- holiday/closure bounds, funding
lapses, era margins, backcast PIT, snap to authoritative release times."""
from __future__ import annotations

import pytest

from api.services.econ import backfill_timing as bt
from api.services.econ import calendar as cal
from api.services.econ import registry, timeutil
from api.services.econ.calendar import Event

NOW = timeutil.et_to_utc("2026-09-29", "12:00")


def T(d, t="00:00"):
    return timeutil.et_to_utc(d, t)


def spec(sym):
    return registry.get(sym)


def place(sym, ps, pe=None, **kw):
    kw.setdefault("now", NOW)
    return bt.place(spec(sym), ps, pe or ps, **kw)


@pytest.fixture
def no_history(monkeypatch):
    """Rule-path tests: the agency release-history table switched off."""
    monkeypatch.setattr(bt, "history", lambda: {})


@pytest.fixture
def no_lapses(monkeypatch):
    monkeypatch.setattr(bt, "lapses", lambda: ())


def month_end(ps):
    y, m = int(ps[:4]), int(ps[5:7])
    return timeutil.month_bounds(y, m)[1].isoformat()


# ─────────────────────────────── data files ──────────────────────────────────

def test_tables_load_and_are_well_formed():
    assert timeutil.as_date("2025-12-26") in bt.closures() and not bt.is_pub_day("2025-12-26")
    assert bt.is_pub_day("2025-12-23") and not bt.is_pub_day("2025-12-25")          # statutory holiday
    ids = [lp.id for lp in bt.lapses()]
    assert ids == ["1995-11", "1995-12", "2013-10", "2018-12", "2025-10", "2026-01"]
    for lp in bt.lapses():
        assert lp.start <= lp.end and lp.affected and lp.confidence
    lp25 = next(lp for lp in bt.lapses() if lp.id == "2025-10")
    assert lp25.end.isoformat() == "2025-11-12"
    assert lp25.window_end("bls:cpi").isoformat() == "2026-01-30"                   # catch-up > end + 60 d
    assert lp25.window_end("dol:claims").isoformat() == "2026-01-11"                # end + 60 d floor
    assert lp25.window_end("census:resconst").isoformat() == "2026-04-29"
    assert lp25.matches("fed:h15") is None and lp25.matches("eia:wpsr") is None
    h = bt.history()
    assert h["bls:cpi"]["2025-09"][:2] == ["2025-10-24", "08:30"]                   # lapse-era actual
    assert h["bls:cpi"]["1964-06"][0] == "1964-07-31" and h["bls:cpi"]["1964-06"][1] is None
    assert h["fed:g17"]["2025-09"][0] == "2025-12-03" and h["eia:wpsr"]["2025-12-19"][0] == "2025-12-29"


# ─────────────────────────────── holiday / closure bounds ─────────────────────

def test_gasoline_holiday_week_is_wednesday_side(no_history):
    """EIA: 'released on Wednesday' when Monday/Tuesday is a government holiday. The old rule
    (period_end + 1 d 17:00 = Tuesday) was EARLY in every Monday-holiday week."""
    ps, pe = "2026-09-01", "2026-09-07"                                             # Labor Day survey Monday
    assert bt.registry_rule(spec("USGASPRICE"), ps, pe) == T("2026-09-08", "17:00")  # negative control: early
    p = place("USGASPRICE", ps, pe)
    assert p.available_at >= T("2026-09-09", "10:00")
    assert p.available_at == T("2026-09-09", "23:59")
    # a normal week keeps the rule (Tuesday 17:00 is after Tuesday 10:00 / Monday 17:00)
    assert place("USGASPRICE", "2026-09-15", "2026-09-21").available_at == T("2026-09-22", "17:00")
    # Christmas 2024: Tuesday 12-24 closure (EO) -> after Wednesday's holiday too
    p = place("USGASPRICE", "2024-12-17", "2024-12-23")
    assert p.available_at >= T("2024-12-26", "23:59")


def test_wpsr_holiday_weeks(no_history):
    # Christmas 2025: Wed 12-24 + Fri 12-26 closed (EO 14371), Thu holiday -> EIA released Mon 12-29 17:00
    p = place("USCRUDEINV", "2025-12-13", "2025-12-19")
    assert p.available_at >= T("2025-12-29", "17:00")
    assert bt.registry_rule(spec("USCRUDEINV"), "2025-12-13", "2025-12-19") < T("2025-12-29", "17:00")
    # Labor Day week 2026: EIA 'Thursday at noon' -- the old rule (Thursday 11:00) was early by an hour
    assert bt.registry_rule(spec("USCRUDEINV"), "2026-08-29", "2026-09-04") == T("2026-09-10", "11:00")
    assert place("USCRUDEINV", "2026-08-29", "2026-09-04").available_at >= T("2026-09-10", "12:00")


def test_wpsr_history_snaps_to_the_eia_archive():
    p = place("USCRUDEINV", "2025-12-13", "2025-12-19")
    assert p.available_at == T("2025-12-29", "23:59") and p.method == "scheduled:history"   # Monday, date only
    p = place("USCRUDEINV", "2026-09-12", "2026-09-18")
    assert p.available_at == T("2026-09-23", "10:30")                                      # a normal Wednesday
    p = place("USCRUDEINV", "2022-06-11", "2022-06-17")          # no own release (2022 systems outage)
    assert p.available_at == T("2022-06-29", "23:59")


def test_claims_thursday_and_friday_closed(no_history):
    p = place("USICSA", "2025-12-14", "2025-12-20")                    # Thu 12-25 holiday, Fri 12-26 EO closure
    assert p.available_at >= T("2025-12-29", "00:00")
    assert place("USICSA", "2026-09-13", "2026-09-19").available_at == T("2026-09-25", "08:30")


def test_h41_christmas_friday_closure_moves_to_monday():
    """Fed: H.4.1 released Mon 2025-12-29 (and 2008/2014/2020) after a Christmas-Friday closure."""
    p = place("USFEDBAL", "2025-12-18", "2025-12-24")
    assert p.available_at == T("2025-12-29", "16:30")
    assert bt.registry_rule(spec("USFEDBAL"), "2025-12-18", "2025-12-24") == T("2025-12-26", "16:30")  # early


def test_sofr_good_friday_uses_the_next_publication_day():
    """SOFR is not published on SIFMA full closes (Good Friday 2026): Thursday's rate comes out Monday."""
    periods = [timeutil.as_date(d) for d in ("2026-04-01", "2026-04-02", "2026-04-06")]
    p = place("USSOFR", "2026-04-02", periods=periods)
    assert p.available_at == T("2026-04-06", "10:00")
    assert bt.registry_rule(spec("USSOFR"), "2026-04-02", "2026-04-02") == T("2026-04-03", "10:00")  # early
    # EFFR IS published on Good Friday (NY Fed holiday schedule): the next observation is Friday
    pe = [timeutil.as_date(d) for d in ("2026-04-02", "2026-04-03", "2026-04-06")]
    assert place("USEFFR", "2026-04-02", periods=pe).available_at == T("2026-04-03", "11:00")


def test_daily_next_obs_ignores_a_long_data_gap():
    periods = [timeutil.as_date(d) for d in ("2026-03-02", "2026-04-20")]
    assert place("USSOFR", "2026-03-02", periods=periods).available_at == T("2026-03-03", "10:00")


def test_h15_weekly_and_daily_update_eras():
    # 1985: weekly H.15 released the Monday after the week (FRASER issues, 3-day lag from Friday)
    p = place("UST10Y", "1985-01-02")
    assert p.available_at == T("1985-01-07", "23:59")
    # 2010: daily update, time not evidenced -> end of the next publication day
    assert place("UST10Y", "2010-03-03").available_at == T("2010-03-04", "23:59")
    # 2026: 'published at 4:15pm every business day'
    assert place("UST10Y", "2026-09-24").available_at == T("2026-09-25", "16:15")


def test_era_margins_only_where_evidence_is_missing(no_history):
    assert place("USCPI", "1950-06-01", "1950-06-30").available_at == T("1950-08-29", "08:30")   # pe + 60
    assert place("USINDPRO", "1930-01-01", "1930-01-31").available_at == T("1930-03-12", "09:15")
    assert place("USINDPRO", "2010-01-01", "2010-01-31").available_at == T("2010-02-20", "09:15")  # rule only


# ─────────────────────────────── PIT class ───────────────────────────────────

def test_backcast_and_rebased_history_is_not_pit_safe():
    assert place("USCPINSA", "1987-12-01", "1987-12-31").pit_class == "L"          # 1967=100 base then
    assert place("USCPINSA", "1988-01-01", "1988-01-31").pit_class == "U"
    assert place("USCORECPINSA", "1960-01-01", "1960-01-31").pit_class == "L"
    assert place("UST10Y", "1970-01-02").pit_class == "L" and place("UST10Y", "1990-01-02").pit_class == "U"
    assert place("USDEBT", "2000-01-03").pit_class == "L" and place("USDEBT", "2010-01-04").pit_class == "U"
    assert place("USCPI", "1987-12-01", "1987-12-31").pit_class == "L"             # L stays L


# ─────────────────────────────── funding lapses ──────────────────────────────

def test_lapse_downgrades_and_places_late(no_history):
    p = place("USCPINSA", "2025-09-01", "2025-09-30")
    assert p.pit_class == "L" and p.lapse == "2025-10"
    assert p.available_at == T("2026-01-30", "23:59") and p.method == "rule:lapse"
    assert p.available_at >= T("2025-10-24", "08:30")                              # the actual release
    # the Employment Situation rule was EARLY by 5 weeks (released 2025-11-20)
    p = place("USNFP", "2025-09-01", "2025-09-30")
    assert p.available_at >= T("2025-11-20", "08:30") and p.pit_class == "L"
    # a row whose rule time is outside every window keeps its class
    assert place("USCPINSA", "2026-05-01", "2026-05-31").pit_class == "U"


def test_negative_control_without_the_lapse_table_the_row_is_early_and_claims_pit_safe(no_history, no_lapses):
    """NEGATIVE CONTROL: remove the lapse rule and USCPINSA Sep-2025 claims 'U' (PIT-safe) on a
    rule time that the 2025 lapse invalidated, and USNFP Sep-2025 lands 5 weeks before its release.
    test_lapse_downgrades_and_places_late fails on exactly these rows."""
    p = place("USCPINSA", "2025-09-01", "2025-09-30")
    assert p.pit_class == "U" and p.lapse is None
    assert place("USNFP", "2025-09-01", "2025-09-30").available_at < T("2025-11-20", "08:30")


def test_lapse_with_history_snaps_to_the_actual_release_but_stays_L():
    p = place("USCPINSA", "2025-09-01", "2025-09-30")
    assert p.available_at == T("2025-10-24", "08:30") and p.method == "scheduled:history"
    assert p.pit_class == "L" and p.lapse == "2025-10"
    p = place("USHOUST", "2025-11-01", "2025-11-30")
    assert p.available_at == T("2026-02-18", "08:30") and p.pit_class == "L"


def test_2013_census_catch_up_beyond_sixty_days(no_history):
    """Census released Sep/Oct 2013 housing starts on 2013-12-18: lapse end + 63 d."""
    p = place("USHOUST", "2013-10-01", "2013-10-31")
    assert p.available_at >= T("2013-12-18", "08:30")


# ─────────────────────────────── calendar snap ───────────────────────────────

def cpi_ev(label, d, t="08:30", prec="time_configured", src="configured", key="bls:cpi"):
    return Event(key, label, d, t, prec, src)


def test_calendar_snap_places_at_the_authoritative_event(no_history):
    """Aug 2026 CPI: the rule (Sep 25) is late; the configured PFEI event says Sep 11 08:30."""
    evs = [cpi_ev("2026-08", "2026-09-11")]
    p = place("USCPI", "2026-08-01", "2026-08-31", events=evs)
    assert p.available_at == T("2026-09-11", "08:30") and p.method == "scheduled:calendar"
    assert p.pit_class == "L"                                                       # unchanged by the snap
    # a date_only / rule-sourced event is NOT a snap (the rule stays); a revision label never snaps
    for ev in (cpi_ev("2026-08", "2026-09-11", None, "date_only"),
               cpi_ev("2026-08", "2026-09-11", "08:30", "rule", "rule"),
               cpi_ev("2026-08/rev1", "2026-09-11")):
        assert place("USCPI", "2026-08-01", "2026-08-31", events=[ev]).available_at == T("2026-09-25", "08:30")


def test_inferred_bea_labels_need_a_plausible_lag_and_are_ignored_in_a_lapse(no_history):
    # BEA feed 'Jan 22 2026' is labelled 2025Q4 NEW by lag inference, but it was the Q3 update
    bad = Event("bea:gdp", "2025Q4", "2026-01-22", "08:30", "exact", "authoritative_feed")
    p = place("USGDP", "2025-10-01", "2025-12-31", events=[bad])
    assert p.available_at >= T("2026-02-20", "08:30") and p.method == "rule:lapse"
    good = Event("bea:gdp", "2026Q1", "2026-04-30", "08:30", "exact", "authoritative_feed")
    p = place("USGDP", "2026-01-01", "2026-03-31", events=[good])
    assert p.available_at == T("2026-04-30", "08:30")


def test_unsnapped_is_capped_at_first_sighting_but_never_before_a_schedule(no_history):
    now = T("2026-09-28", "10:00")
    ev = Event("fed:h15", "2026-09-25", "2026-09-28", "16:15", "rule", "rule")
    p = bt.place(spec("UST10Y"), "2026-09-25", "2026-09-25", now=now, events=[ev])
    assert p.available_at == T("2026-09-28", "16:15")


def test_placement_is_never_earlier_than_the_old_rule_unless_snapped(no_history):
    """Steps 2 and 4 only move LATER; only an authoritative snap may move earlier."""
    import datetime as dt
    for sym in ("USCPI", "USNFP", "USICSA", "USGASPRICE", "USCRUDEINV", "UST10Y", "USSOFR", "USFEDBAL",
                "USM2", "USINDPRO", "USGDP", "USHOUST", "USFHFAHPI", "USEMPIRE", "USDEBT", "USTGA"):
        sp = spec(sym)
        f = sp["frequency"]
        d = dt.date(2019, 1, 7)
        for _ in range(30):
            if f == "M":
                ps = d.replace(day=1)
                pe = timeutil.month_bounds(ps.year, ps.month)[1]
            elif f == "Q":
                ps, pe = timeutil.quarter_bounds_of(d)
            elif f == "W":
                ps, pe = timeutil.week_bounds(d + dt.timedelta(days=(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
                                                                     .index(sp["week_anchor"]) - d.weekday()) % 7),
                                              sp["week_anchor"])
            else:
                ps = pe = d
            r = bt.registry_rule(sp, ps, pe)
            p = bt.place(sp, ps, pe, now=NOW)
            assert p.available_at >= min(r, NOW), (sym, ps)
            d += dt.timedelta(days=37)


def test_backfill_pipeline_applies_the_lapse_rule(tmp_path):
    """End to end through ingest.backfill: USCPINSA rows around the 2025 lapse."""
    from api.services.econ import ingest
    from api.services.econ.adapters.fake import FakeAdapter
    from tests.econ.test_ingest import ents, open_store

    E = ents("USCPINSA")
    s = open_store(tmp_path)
    cal.refresh(s, NOW, feeds=False)
    obs = [("USCPINSA", ps, month_end(ps), 320.0 + i) for i, ps in
           enumerate(["2025-07-01", "2025-08-01", "2025-09-01", "2025-11-01", "2025-12-01", "2026-06-01"])]
    fa = FakeAdapter([{"observations": obs}], name="bls")
    ingest.backfill(s, E, http=None, now=NOW, adapter_for=lambda n: fa, entries=E, publish=False)
    got = {r.period_start: r for r in s.vintages("USCPINSA")}
    assert {p: got[p].pit_class for p in got} == {"2025-07-01": "U", "2025-08-01": "U", "2025-09-01": "L",
                                                  "2025-11-01": "L", "2025-12-01": "L", "2026-06-01": "U"}
    assert got["2025-09-01"].available_at == T("2025-10-24", "08:30")               # BLS archive
    assert got["2025-11-01"].available_at == T("2025-12-18", "08:30")
    assert all(r.available_method.startswith(("rule", "scheduled")) for r in got.values())
