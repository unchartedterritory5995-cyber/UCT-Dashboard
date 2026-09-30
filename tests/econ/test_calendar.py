"""calendar.py: providers (BEA feed, Census page, fiscaldata feed, configured files,
rules), period labels, expected_period, persistence (supersede / withdraw / coverage)."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services.econ import calendar as cal
from api.services.econ import registry, timeutil
from api.services.econ import store as st
from api.services.econ.model import SchedulePrecision as P, ScheduleSource as S

FIX = Path(__file__).with_name("fixtures") / "calendar"


def T(d, t="00:00"):
    return timeutil.et_to_utc(d, t)


def ev_map(batch, key):
    return {e.period_label: e for e in batch.events if e.calendar_key == key}


@pytest.fixture
def s(tmp_path):
    db = st.connect(str(tmp_path / "econ.db"))
    yield db
    db.close()


# ─────────────────────────────── BEA ─────────────────────────────────────────

def test_bea_feed_gdp_labels_revisions_and_utc():
    b = cal.bea_events((FIX / "bea_release_dates.json").read_bytes())
    g = ev_map(b, "bea:gdp")
    assert (g["2026Q2/rev2"].sched_date, g["2026Q2/rev2"].sched_time) == ("2026-09-30", "08:30")   # 12:30Z EDT
    assert (g["2026Q3"].sched_date, g["2026Q3"].sched_time) == ("2026-10-29", "08:30")
    assert (g["2026Q3/rev1"].sched_date, g["2026Q3/rev1"].sched_time) == ("2026-11-25", "08:30")   # 13:30Z EST
    assert g["2026Q3/rev2"].sched_date == "2026-12-23"
    assert g["2026Q2"].sched_date == "2026-07-30" and g["2026Q2/rev1"].sched_date == "2026-08-26"
    for e in b.events:
        assert (e.precision, e.source) == (P.EXACT.value, S.AUTHORITATIVE_FEED.value)
        assert "release_dates.json" in e.provenance
    p = ev_map(b, "bea:pio")
    assert [p[m].sched_date for m in ("2026-08", "2026-09", "2026-10", "2026-11")] == \
        ["2026-09-30", "2026-10-29", "2026-11-25", "2026-12-23"]
    assert p["2025-12"].sched_time == "10:00"                                    # the one-off 15:00Z release
    assert b.coverage["bea:gdp"][1] == "2026-12-31"


def test_bea_duplicates_dropped_and_bad_payloads_refused():
    doc = json.loads((FIX / "bea_release_dates.json").read_text())
    doc["Gross Domestic Product"]["release_dates"].append("2026-10-29T12:30:00+00:00")   # duplicate
    b = cal.bea_events(doc)
    assert sum(1 for e in b.events if e.sched_date == "2026-10-29" and e.calendar_key == "bea:gdp") == 1
    with pytest.raises(cal.CalendarParseError):
        cal.bea_events({"Personal Income and Outlays": doc["Personal Income and Outlays"]})
    with pytest.raises(cal.CalendarParseError):
        cal.bea_events(b"[]")
    bad = json.loads(json.dumps(doc))
    bad["Gross Domestic Product"]["release_dates"][0] = "not-a-date"
    with pytest.raises(cal.CalendarParseError):
        cal.bea_events(bad)


# ─────────────────────────────── Census ──────────────────────────────────────

def test_census_page_remaining_2026():
    b = cal.census_events((FIX / "census_listview_now.html").read_bytes())
    want = {"census:marts": ("2026-09", "2026-10-15", "08:30"), "census:resconst": ("2026-09", "2026-10-20", "08:30"),
            "census:m3adv": ("2026-09", "2026-10-27", "08:30"), "census:m3": ("2026-08", "2026-10-02", "10:00"),
            "census:ft900": ("2026-08", "2026-10-06", "08:30")}
    for key, (label, d, t) in want.items():
        e = ev_map(b, key)[label]
        assert (e.sched_date, e.sched_time) == (d, t), key
        assert (e.precision, e.source) == (P.EXACT.value, S.AUTHORITATIVE_PAGE.value)
    assert ev_map(b, "census:marts")["2026-11"].sched_date == "2026-12-16"
    assert b.coverage["census:marts"][1] == "2026-12-31"


def test_census_truncated_or_foreign_page_refused():
    with pytest.raises(cal.CalendarParseError, match="only 22 rows"):
        cal.census_events((FIX / "census_listview_truncated.html").read_bytes())
    with pytest.raises(cal.CalendarParseError):
        cal.census_events(b"<html><body>Service Unavailable</body></html>")


# ─────────────────────────────── fiscaldata ──────────────────────────────────

def test_fiscal_mts_exact_and_october_hole():
    b = cal.fiscal_events((FIX / "fiscaldata_calendar.json").read_bytes())
    m = ev_map(b, "fiscal:mts")
    assert (m["2026-10"].sched_date, m["2026-10"].sched_time, m["2026-10"].precision) == ("2026-11-12", "14:00", "exact")
    assert (m["2026-11"].sched_date, m["2026-11"].sched_time) == ("2026-12-10", "14:00")
    hole = m["2026-09"]                                                           # FY-end statement: not listed
    assert hole.precision == P.UNKNOWN.value and hole.sched_time is None and hole.is_hole
    assert hole.sched_date == "2026-10-01" and "HOLE" in hole.provenance
    assert b.coverage["fiscal:mts"] == ("2026-09-28", "2027-01-05")
    with pytest.raises(cal.CalendarParseError):
        cal.fiscal_events(b'{"data": []}')


# ─────────────────────────────── configured ──────────────────────────────────

def test_bls_configured_remaining_2026_matches_research():
    b = cal.configured_events(["bls_2026.json"])
    want = {"bls:cpi": {"2026-09": "2026-10-14", "2026-10": "2026-11-10", "2026-11": "2026-12-10"},
            "bls:empsit": {"2026-09": "2026-10-02", "2026-10": "2026-11-06", "2026-11": "2026-12-04"},
            "bls:ppi": {"2026-09": "2026-10-15", "2026-10": "2026-11-13", "2026-11": "2026-12-15"},
            "bls:eci": {"2026Q3": "2026-10-30"},
            "bls:jolts": {"2026-08": "2026-09-29", "2026-09": "2026-11-03", "2026-10": "2026-12-01"}}
    for key, rows in want.items():
        m = ev_map(b, key)
        for label, d in rows.items():
            assert m[label].sched_date == d, (key, label)
            assert m[label].precision == P.TIME_CONFIGURED.value and m[label].source == S.CONFIGURED.value
            assert m[label].sched_time == ("10:00" if key == "bls:jolts" else "08:30")
            assert "time: CONFIGURED agency practice" in m[label].provenance
    assert "PFEI" in ev_map(b, "bls:cpi")["2026-09"].provenance
    jolts = ev_map(b, "bls:jolts")["2026-08"].provenance
    assert "NOT in the PFEI" in jolts and "LOWER CONFIDENCE" in jolts
    assert b.coverage["bls:cpi"] == ("2026-07-01", "2026-12-31")


def test_bls_file_never_names_fred_as_a_dependency():
    text = (cal.CALENDAR_DIR / "bls_2026.json").read_text(encoding="utf-8")
    assert not re.search(r"(?<![a-z])(al)?fred(?![a-z])", text, re.I)
    assert "stlouisfed" not in text.lower()


def test_other_configured_calendars():
    b = cal.configured_events()
    g = ev_map(b, "fed:g17")
    assert (g["2026-09"].sched_date, g["2026-09"].sched_time, g["2026-09"].precision) == ("2026-10-16", "09:15", "exact")
    assert (g["2026-10/rev1"].sched_date, g["2026-10/rev1"].sched_time) == ("2026-11-24", "12:00")
    assert g["2027-11"].sched_date == "2027-12-16"
    f = ev_map(b, "fhfa:hpi_monthly")
    assert (f["2026-07"].sched_date, f["2026-07"].sched_time) == ("2026-09-29", "09:00")
    assert f["2026-09"].sched_date == "2026-11-24"
    e = ev_map(b, "nyfed:esms")
    assert [e[m].sched_date for m in ("2026-10", "2026-11", "2026-12")] == ["2026-10-15", "2026-11-16", "2026-12-15"]


# ─────────────────────────────── rules ───────────────────────────────────────

@pytest.fixture(scope="module")
def rules():
    return cal.rule_events("2026-10-05", back_days=70, fwd_days=90, daily_back=10, daily_fwd=14)


def test_rule_h15_daily_next_business_day(rules):
    h = ev_map(rules, "fed:h15")
    assert (h["2026-10-09"].sched_date, h["2026-10-09"].sched_time) == ("2026-10-13", "16:15")   # Columbus Day
    assert "2026-10-10" not in h                                               # Saturday: no observation
    assert h["2026-10-05"].precision == P.RULE.value and h["2026-10-05"].source == S.RULE.value
    r = ev_map(rules, "nyfed:rrp")
    assert (r["2026-10-06"].sched_date, r["2026-10-06"].sched_time) == ("2026-10-06", "13:15")  # same day
    assert ev_map(rules, "nyfed:sofr")["2026-10-06"].sched_time == "08:00"
    assert ev_map(rules, "nyfed:effr")["2026-10-06"].sched_date == "2026-10-07"
    assert ev_map(rules, "fiscal:dts")["2026-10-06"].sched_time == "16:00"


def test_rule_h41_thanksgiving_shift_and_h6_fourth_tuesday(rules):
    h = ev_map(rules, "fed:h41")
    assert (h["2026-10-07"].sched_date, h["2026-10-07"].sched_time) == ("2026-10-08", "16:30")
    assert h["2026-11-25"].sched_date == "2026-11-27"                            # Thanksgiving Thu -> Fri
    h6 = ev_map(rules, "fed:h6")
    assert (h6["2026-09"].sched_date, h6["2026-09"].sched_time) == ("2026-10-27", "13:00")
    assert h6["2026-10"].sched_date == "2026-11-24"


def test_rule_eia_wpsr_holiday_table_and_unknown_weeks(rules):
    w = ev_map(rules, "eia:wpsr")
    assert (w["2026-10-02"].sched_date, w["2026-10-02"].sched_time) == ("2026-10-07", "10:30")
    assert (w["2026-10-09"].sched_date, w["2026-10-09"].sched_time, w["2026-10-09"].precision) == \
        ("2026-10-15", "12:00", "exact")                                         # Columbus Day week
    assert (w["2026-11-06"].sched_date, w["2026-11-06"].sched_time) == ("2026-11-12", "12:00")   # Veterans Day
    gas = ev_map(rules, "eia:gasdiesel")
    # EIA schedule page: "published around 10:00 a.m. Tuesday ... on government holidays ... Wednesday"
    assert (gas["2026-09-28"].sched_date, gas["2026-09-28"].sched_time) == ("2026-09-29", "10:00")
    assert (gas["2026-10-05"].sched_date, gas["2026-10-05"].sched_time) == ("2026-10-06", "10:00")
    assert (gas["2026-10-12"].sched_date, gas["2026-10-12"].sched_time) == ("2026-10-14", "10:00")  # Columbus Day
    hol = ev_map(cal.rule_events("2026-09-01", back_days=5, fwd_days=20), "eia:gasdiesel")
    assert hol["2026-09-07"].sched_date == "2026-09-09"                           # Labor Day (EIA holiday table)
    later = cal.rule_events("2027-01-10", back_days=5, fwd_days=20)
    assert ev_map(later, "eia:wpsr")["2027-01-15"].precision == P.UNKNOWN.value   # MLK week, not in the table


def test_rule_dol_claims_holiday_weeks(rules):
    c = ev_map(rules, "dol:claims")
    assert (c["2026-10-03"].sched_date, c["2026-10-03"].sched_time) == ("2026-10-08", "08:30")
    col = c["2026-10-10"]                                                          # Columbus Day week
    assert (col.sched_date, col.sched_time, col.precision) == ("2026-10-15", None, P.DATE_ONLY.value)
    tg = c["2026-11-21"]                                                           # Thanksgiving Thursday
    assert tg.precision == P.UNKNOWN.value and tg.sched_time is None and tg.is_hole


def test_rule_mts_past_only_and_never_over_a_feed_label():
    r = cal.rule_events("2026-09-28")
    m = ev_map(r, "fiscal:mts")
    assert (m["2026-08"].sched_date, m["2026-08"].sched_time) == ("2026-09-11", "14:00")   # 8th business day
    assert all(e.sched_date <= "2026-09-28" for e in m.values())
    r2 = cal.rule_events("2026-09-28", skip_labels={"fiscal:mts": {"2026-08"}})
    assert "2026-08" not in ev_map(r2, "fiscal:mts")


# ─────────────────────────────── expected_period ─────────────────────────────

def test_expected_period_new_and_revision():
    cpi = registry.get("USCPI")
    e = cal.Event("bls:cpi", "2026-09", "2026-10-14", "08:30", "time_configured", "configured")
    x = cal.expected_period(cpi, e)
    assert (x.period_start, x.period_end, x.kind) == ("2026-09-01", "2026-09-30", "new")
    gdp = registry.get("USGDP")
    g = cal.Event("bea:gdp", "2026Q2/rev2", "2026-09-30", "08:30", "exact", "authoritative_feed")
    x = cal.expected_period(gdp, g)
    assert (x.period_start, x.kind, x.revision) == ("2026-04-01", "revision", 2)
    assert cal.expected_period(cpi, g) is None                                   # quarterly label on a monthly series
    bal = registry.get("USFEDBAL")                                                # weekly, anchor WED
    w = cal.Event("fed:h41", "2026-10-07", "2026-10-08", "16:30", "rule", "rule")
    assert cal.expected_period(bal, w).period_start == "2026-10-01"
    assert cal.expected_period(bal, cal.Event("fed:h41", "2026-10-08", "2026-10-09", "16:30", "rule", "rule")) is None
    t10 = registry.get("UST10Y")
    d = cal.expected_period(t10, cal.Event("fed:h15", "2026-10-09", "2026-10-13", "16:15", "rule", "rule"))
    assert d.period_start == d.period_end == "2026-10-09"


def test_event_times():
    e = cal.Event("bls:cpi", "2026-09", "2026-10-14", "08:30", "time_configured", "configured")
    assert e.scheduled_at == T("2026-10-14", "08:30") and e.has_time
    d = cal.Event("dol:claims", "2026-10-10", "2026-10-15", None, "date_only", "rule")
    assert d.scheduled_at == T("2026-10-15") and not d.has_time
    h = cal.Event("fiscal:mts", "2026-09", "2026-10-01", "14:00", "unknown", "authoritative_feed")
    assert not h.has_time and h.public()["time"] is None


# ─────────────────────────────── persistence ─────────────────────────────────

def test_refresh_idempotent_and_coverage(s):
    now = T("2026-09-28", "12:00")
    pay = {"bea_feed": (FIX / "bea_release_dates.json").read_bytes(),
           "census_page": (FIX / "census_listview_now.html").read_bytes(),
           "fiscal_feed": (FIX / "fiscaldata_calendar.json").read_bytes()}
    r1 = cal.refresh(s, now, payloads=pay)
    assert all(v["ok"] for v in r1.values()), r1
    n = s.conn.execute("SELECT COUNT(*) FROM calendar_event").fetchone()[0]
    r2 = cal.refresh(s, now + 60, payloads=pay)
    assert all(v["changed"] == 0 and v["withdrawn"] == 0 for v in r2.values())
    assert s.conn.execute("SELECT COUNT(*) FROM calendar_event").fetchone()[0] == n
    assert cal.coverage_end(s, "bls:cpi") == "2026-12-31"
    assert cal.coverage_end(s, "fiscal:mts") == "2027-01-05"
    assert cal.coverage(s, "fed:h15")["coverage_end"] is None
    # the rule batch's past MTS row must not collide with / withdraw the feed's future rows
    mts = {e["period_label"]: e for e in s.events("fiscal:mts")}
    assert mts["2026-10"]["source"] == "authoritative_feed" and mts["2026-08"]["source"] == "rule"


def test_reschedule_supersedes_and_cancelled_future_event_withdrawn(s):
    now = T("2026-09-28", "12:00")
    b = cal.configured_events(["bls_2026.json"])
    cal.apply_batch(s, b, now)
    moved = [e if (e.calendar_key, e.period_label) != ("bls:cpi", "2026-09")
             else cal.Event(e.calendar_key, e.period_label, "2026-10-16", e.sched_time, e.precision, e.source,
                            e.provenance) for e in b.events]
    moved = [e for e in moved if (e.calendar_key, e.period_label) != ("bls:ppi", "2026-11")]      # cancelled
    moved = [e for e in moved if (e.calendar_key, e.period_label) != ("bls:ppi", "2026-07")]      # past: kept anyway
    out = cal.apply_batch(s, cal.CalendarBatch("configured", moved, b.coverage), now + 60)
    assert out["changed"] == 1 and out["withdrawn"] == 1
    hist = s.events("bls:cpi", include_superseded=True)
    old = [r for r in hist if r["period_label"] == "2026-09"]
    assert len(old) == 2 and sum(r["superseded_at"] is None for r in old) == 1
    assert s.next_event("bls:cpi", "2026-10-01")["sched_date"] == "2026-10-16"
    assert not [r for r in s.events("bls:ppi") if r["period_label"] == "2026-11"]
    assert [r for r in s.events("bls:ppi") if r["period_label"] == "2026-07"]


def test_failing_feed_keeps_previous_events_and_error_is_redacted(s, monkeypatch):
    now = T("2026-09-28", "12:00")
    cal.refresh(s, now, payloads={"bea_feed": (FIX / "bea_release_dates.json").read_bytes()})
    n = len(s.events("bea:gdp"))
    monkeypatch.setenv("BEA_API_KEY", "SECRETBEAKEY12345")
    res = cal.refresh(s, now + 60, payloads={"bea_feed": b'{"oops SECRETBEAKEY12345": 1}'})
    assert res["bea_feed"]["ok"] is False and "SECRETBEAKEY12345" not in res["bea_feed"]["error"]
    assert len(s.events("bea:gdp")) == n


def test_load_events_ordering(s):
    cal.refresh(s, T("2026-09-28", "12:00"), feeds=False)
    evs = cal.load_events(s, "bls:cpi", T("2026-09-28"))
    assert [e.scheduled_at for e in evs] == sorted(e.scheduled_at for e in evs)
    assert evs[0].event_id is not None
