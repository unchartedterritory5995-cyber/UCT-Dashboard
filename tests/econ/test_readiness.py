"""Launch-catalog readiness (2026-09-30): calendar coverage for the newly enabled
series (Gate 3) and historical release placement from the agencies' own release
archives (Gate 4), with negative controls."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from api.services.econ import backfill_timing as bt
from api.services.econ import calendar as cal
from api.services.econ import currentness as cur
from api.services.econ import registry, timeutil
from api.services.econ.model import Currentness as C

NOW = timeutil.et_to_utc("2026-09-30", "12:00")


def T(d, t="00:00"):
    return timeutil.et_to_utc(d, t)


def evmap(batch, key):
    return {e.period_label: e for e in batch.events if e.calendar_key == key}


# ─────────────────────────────── Gate 3: calendar coverage ──────────────────

def test_every_enabled_series_has_a_known_calendar():
    """No enabled series may sit on a calendar the release system does not know
    (it would be NO_EXPECTATION forever and '/status' would say provider unknown)."""
    missing = {e["symbol"]: e["release"]["calendar_key"] for e in registry.enabled()
               if e["release"]["calendar_key"] not in cal.KNOWN_CALENDARS}
    assert missing == {}


def test_h8_rule_friday_with_the_previous_weeks_wednesday():
    b = evmap(cal.rule_events("2026-09-20", back_days=10, fwd_days=100), "fed:h8")
    e = b["2026-09-16"]                                   # FRB H.8 2026-09-25: week ending Sep 16
    assert (e.sched_date, e.sched_time, e.precision) == ("2026-09-25", "16:15", "rule")
    assert b["2026-12-16"].sched_date == "2026-12-24"     # Friday Christmas -> Thursday (statcalendar: 24)
    for lab, ev in b.items():
        assert timeutil.as_date(lab).weekday() == 2 and (timeutil.as_date(ev.sched_date) - timeutil.as_date(lab)).days in (8, 9)
    # the event lands on the weekly-WED grid of USBANKCRED
    exp = cal.expected_period(registry.get("USBANKCRED"), e)
    assert (exp.period_start, exp.period_end, exp.kind) == ("2026-09-10", "2026-09-16", "new")


def test_h8_juneteenth_friday_moves_to_thursday():
    b = evmap(cal.rule_events("2026-06-10", back_days=10, fwd_days=20), "fed:h8")
    assert b["2026-06-10"].sched_date == "2026-06-18"     # statcalendar 2026-06: 5, 12, 18, 26


def test_h10_rule_monday_for_the_previous_business_week():
    b = evmap(cal.rule_events("2026-09-01", back_days=10, fwd_days=130), "fed:h10")
    assert (b["2026-09-04"].sched_date, b["2026-09-04"].sched_time) == ("2026-09-08", "16:15")  # Labor Day -> Tue
    assert b["2026-09-25"].sched_date == "2026-09-28"
    assert b["2026-12-24"].sched_date == "2026-12-28"     # Christmas Friday: last business day Thursday
    exp = cal.expected_period(registry.get("USDOLLARIDX"), b["2026-09-25"])
    assert (exp.period_start, exp.kind) == ("2026-09-25", "new")


def test_ngs_table_exceptions_pfei_rule_and_normal_thursday():
    b = evmap(cal.rule_events("2026-11-01", back_days=10, fwd_days=40), "eia:ngs")
    assert (b["2026-11-06"].sched_date, b["2026-11-06"].sched_time, b["2026-11-06"].precision) == \
        ("2026-11-13", "10:30", "exact")                  # EIA table: Veterans Day -> Friday
    assert (b["2026-11-20"].sched_date, b["2026-11-20"].sched_time) == ("2026-11-25", "12:00")   # Thanksgiving
    assert (b["2026-10-30"].sched_date, b["2026-10-30"].sched_time, b["2026-10-30"].precision) == \
        ("2026-11-05", "10:30", "rule")
    later = evmap(cal.rule_events("2027-11-15", back_days=5, fwd_days=20), "eia:ngs")
    e = later["2027-11-19"]                               # 2027 Thanksgiving is NOT in the table: PFEI footnote rule
    assert (e.sched_date, e.sched_time, e.precision) == ("2027-11-24", "12:00", "rule")
    assert "PFEI" in e.provenance


def test_g19_prod_mxp_configured_events():
    b = cal.configured_events()
    g19 = evmap(b, "fed:g19")["2026-08"]
    assert (g19.sched_date, g19.sched_time, g19.precision, g19.source) == ("2026-10-07", "15:00", "exact", "configured")
    assert cal.expected_period(registry.get("USCONSCRED"), g19).period_start == "2026-08-01"
    prod = evmap(b, "bls:prod")
    assert prod["2026Q3"].sched_date == "2026-11-05" and prod["2026Q3/rev1"].sched_date == "2026-12-08"
    assert cal.expected_period(registry.get("USPROD"), prod["2026Q3/rev1"]).kind == "revision"
    mxp = evmap(b, "bls:mxp")["2026-09"]
    assert (mxp.sched_date, mxp.sched_time, mxp.precision) == ("2026-10-16", "08:30", "exact")
    for k in ("fed:g19", "bls:prod", "bls:mxp"):
        assert b.coverage[k][1] == "2026-12-31"


BEA_FEED = {
    "file_last_updated": "2026-07-13T08:00:42",
    "Gross Domestic Product": {"release_dates": ["2026-07-30T12:30:00+00:00", "2026-08-26T12:30:00+00:00",
                                                 "2026-09-30T12:30:00+00:00", "2026-10-29T12:30:00+00:00",
                                                 "2026-11-25T13:30:00+00:00"]},
    "Personal Income and Outlays": {"release_dates": ["2026-07-30T12:30:00+00:00", "2026-08-26T12:30:00+00:00",
                                                      "2026-09-30T12:30:00+00:00", "2026-10-29T12:30:00+00:00"]},
    "Corporate Profits": {"release_dates": ["2025-03-27T12:30:00+00:00", "2025-05-29T12:30:00+00:00",
                                            "2025-06-26T12:30:00+00:00", "2025-12-23T13:30:00+00:00",
                                            "2026-01-22T13:30:00+00:00", "2026-04-09T12:30:00+00:00",
                                            "2026-05-28T12:30:00+00:00", "2026-06-25T12:30:00+00:00",
                                            "2026-08-26T12:30:00+00:00", "2026-09-30T12:30:00+00:00",
                                            "2026-11-25T13:30:00+00:00", "2026-12-23T13:30:00+00:00"]},
}


def test_bea_profits_labels_first_release_new_later_revisions():
    b = cal.bea_events(BEA_FEED)
    p = {e.sched_date: e.period_label for e in b.events if e.calendar_key == "bea:profits"}
    assert p == {"2025-03-27": "2024Q4", "2025-05-29": "2025Q1", "2025-06-26": "2025Q1/rev1",
                 "2025-12-23": "2025Q3", "2026-01-22": "2025Q3/rev1", "2026-04-09": "2025Q4",
                 "2026-05-28": "2026Q1", "2026-06-25": "2026Q1/rev1", "2026-08-26": "2026Q2",
                 "2026-09-30": "2026Q2/rev1", "2026-11-25": "2026Q3", "2026-12-23": "2026Q3/rev1"}
    # a feed without 'Corporate Profits' still refreshes GDP/PIO (the key is optional)
    b2 = cal.bea_events({k: v for k, v in BEA_FEED.items() if k != "Corporate Profits"})
    assert {e.calendar_key for e in b2.events} == {"bea:gdp", "bea:pio"}


def _facts(latest):
    # the 2026-09-30 profits revision (2026Q2/rev1) changed a value -> that revision event is satisfied
    return cur.Facts(enabled=True, latest_period=latest, last_success_at=T("2026-10-29", "09:00"),
                     last_change_at=T("2026-09-30", "08:31"))


def test_corporate_profits_is_not_delayed_by_the_advance_gdp_release():
    """USCORPPROF on bea:profits: after the Q3 ADVANCE GDP (2026-10-29) with Q2 held it is
    CURRENT; on the old bea:gdp key the same facts read DELAYED (the defect)."""
    spec = registry.get("USCORPPROF")
    assert spec["release"]["calendar_key"] == "bea:profits"
    now = T("2026-10-29", "12:00")
    evs = [e for e in cal.bea_events(BEA_FEED).events]
    v = cur.evaluate(spec, _facts("2026-04-01"), [e for e in evs if e.calendar_key == "bea:profits"], now)
    assert v.state == C.CURRENT
    old = dict(spec, release=dict(spec["release"], calendar_key="bea:gdp"))
    v_old = cur.evaluate(old, _facts("2026-04-01"), [e for e in evs if e.calendar_key == "bea:gdp"], now)
    assert v_old.state == C.DELAYED                       # negative control: the reason for the new key


# ─────────────────────────────── Gate 4: placement from release archives ───

def _row_time(row):
    d, hhmm = row[0], row[1]
    return timeutil.et_to_utc(d, hhmm or bt.END_OF_DAY)


@pytest.mark.parametrize("sym,key", [("USBANKCRED", "fed:h8"), ("USCONSCRED", "fed:g19"), ("USDOLLARIDX", "fed:h10"),
                                     ("USFEDBAL", "fed:h41"), ("USM2", "fed:h6"), ("USPROD", "bls:prod"),
                                     ("USIMPPRICE", "bls:mxp")])
def test_every_archived_release_places_the_row_at_the_release(sym, key):
    """Each period with an archived release is placed exactly at that release (date +
    stated time, or the end of the ET day when only the date is known) -- never earlier."""
    spec = registry.get(sym)
    fam = bt.history()[key]
    assert len(fam) > 50
    f = spec["frequency"]
    n = 0
    for lab, row in list(fam.items())[-400:]:
        if f == "M":
            ps, pe = timeutil.parse_month(lab)
        elif f == "Q":
            ps, pe = timeutil.parse_quarter(lab)
        elif f == "W":
            ps, pe = timeutil.week_bounds(lab, spec["week_anchor"])
        else:
            ps = pe = timeutil.as_date(lab)
        p = bt.place(spec, ps.isoformat(), pe.isoformat(), now=NOW)
        assert p.available_at == _row_time(row), (sym, lab)
        assert p.method == "scheduled:history"
        assert p.available_at > timeutil.et_to_utc(pe, "00:00")
        n += 1
    assert n > 50


def test_h8_week_is_placed_at_its_friday_release_not_before():
    p = bt.place(registry.get("USBANKCRED"), "2026-09-10", "2026-09-16", now=NOW)
    assert p.available_at == T("2026-09-25", "16:15")
    # the 2025-12-26 closure: the archive says Monday 12-29
    p = bt.place(registry.get("USBANKCRED"), "2025-12-11", "2025-12-17", now=NOW)
    assert p.available_at == T("2025-12-29", "16:15")


def test_negative_control_the_old_h8_rule_was_a_lookahead_leak(monkeypatch):
    """With the pre-readiness lag (pe+5) and no archive, every H.8 week would be
    placed BEFORE its publication -- the audit below catches exactly that."""
    monkeypatch.setattr(bt, "history", lambda: {})
    spec = registry.get("USBANKCRED")
    old = dict(spec, release=dict(spec["release"], lag_rule=dict(spec["release"]["lag_rule"], days=5)))
    fam = bt._load(bt.HISTORY_FILE)["families"]["fed:h8"]
    early_old = early_new = 0
    for lab, row in list(fam.items())[-200:]:
        ps, pe = timeutil.week_bounds(lab, "WED")
        rel = _row_time(row)
        if bt.place(old, ps.isoformat(), pe.isoformat(), now=NOW).available_at < rel:
            early_old += 1
        floor = rel if row[1] else T(row[0], "16:15")      # date-only row: the page's 'generally at 4:15 p.m.'
        if bt.place(spec, ps.isoformat(), pe.isoformat(), now=NOW).available_at < floor:
            early_new += 1
    assert early_old >= 190                                # (nearly) every week leaked with pe+5
    assert early_new == 0


def test_h6_monthly_release_at_1630_is_not_placed_at_1300():
    """2022-02-22 H.6 (Jan 2022) went out at 4:30 p.m. per the Board's calendar; the
    4th-Tuesday 13:00 rule alone placed USM2 Jan-2022 3.5 h early."""
    p = bt.place(registry.get("USM2"), "2022-01-01", "2022-01-31", now=NOW)
    assert p.available_at == T("2022-02-22", "16:30")


def test_corporate_profits_2025q4_waits_for_the_april_catch_up():
    """Q4-2025 profits came 2026-04-09 (after the BEA family catch-up end 2026-03-13):
    the key-specific catch-up keeps the row late-side even without a calendar snap."""
    lp = next(lp for lp in bt.lapses() if lp.id == "2025-10")
    assert lp.window_end("bea:profits").isoformat() == "2026-04-09"
    assert lp.window_end("bea:gdp").isoformat() == "2026-03-13"
    p = bt.place(registry.get("USCORPPROF"), "2025-10-01", "2025-12-31", now=NOW)
    assert p.available_at >= T("2026-04-09", "08:30") and p.pit_class == "L"


def test_history_rows_never_precede_their_period():
    for key in ("fed:h8", "fed:h41", "fed:h10", "fed:g19", "fed:h6", "bls:prod", "bls:mxp"):
        for lab, row in bt.history()[key].items():
            d = timeutil.as_date(row[0])
            if len(lab) == 10:
                assert d > timeutil.as_date(lab), (key, lab)
            elif "Q" in lab:
                assert d > timeutil.parse_quarter(lab)[1], (key, lab)
            else:
                assert d > timeutil.parse_month(lab)[1], (key, lab)
