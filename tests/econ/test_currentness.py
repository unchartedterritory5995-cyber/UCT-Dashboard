"""currentness.py: the pure evaluate() state machine + its DB wrapper."""
from __future__ import annotations

import copy

import pytest

from api.services.econ import calendar as cal
from api.services.econ import currentness as cur
from api.services.econ import registry, timeutil
from api.services.econ import store as st
from api.services.econ.currentness import Facts
from api.services.econ.model import Currentness as C

T = timeutil.et_to_utc
CPI = registry.get("USCPI")
GDP = registry.get("USGDP")
T10 = registry.get("UST10Y")
CRUDE = registry.get("USCRUDEINV")


def E(key, label, d, t, prec="exact", src="configured"):
    return cal.Event(key, label, d, t, prec, src)


CPI_EVS = [E("bls:cpi", "2026-08", "2026-09-11", "08:30", "time_configured"),
           E("bls:cpi", "2026-09", "2026-10-14", "08:30", "time_configured"),
           E("bls:cpi", "2026-10", "2026-11-10", "08:30", "time_configured")]
S_OCT = T("2026-10-14", "08:30")


def held(p="2026-08-01", **kw) -> Facts:
    return Facts(latest_period=p, last_success_at=kw.pop("last_success_at", T("2026-09-11", "08:31")), **kw)


# ─────────────────────────────── precedence ──────────────────────────────────

def test_not_production_first():
    assert cur.evaluate(CPI, Facts(enabled=False, latest_period="2026-08-01"), CPI_EVS, S_OCT).state == C.NOT_PRODUCTION


def test_uninitialized_and_source_unavailable_without_data():
    assert cur.evaluate(CPI, Facts(), CPI_EVS, S_OCT).state == C.UNINITIALIZED
    f = Facts(consecutive_failures=3, last_failure_kind="source")
    assert cur.evaluate(CPI, f, CPI_EVS, S_OCT).state == C.SOURCE_UNAVAILABLE


def test_current_between_releases_then_checking_then_delayed():
    f = held()
    v = cur.evaluate(CPI, f, CPI_EVS, S_OCT - 60)
    assert v.state == C.CURRENT and v.expected.label == "2026-08"
    assert v.next_release == {"date": "2026-10-14", "time": "08:30", "tz": "America/New_York",
                              "precision": "time_configured", "source": "configured", "period_label": "2026-09"}
    assert cur.evaluate(CPI, f, CPI_EVS, S_OCT).state == C.CHECKING
    assert cur.evaluate(CPI, f, CPI_EVS, S_OCT + 3599).state == C.CHECKING          # BLS grace 60 min
    v = cur.evaluate(CPI, f, CPI_EVS, S_OCT + 3600)
    assert v.state == C.DELAYED and v.expected.period_start == "2026-09-01"
    assert cur.evaluate(CPI, held("2026-09-01"), CPI_EVS, S_OCT + 3600).state == C.CURRENT


def test_missing_release_stays_delayed_after_the_next_event_opens():
    v = cur.evaluate(CPI, held(), CPI_EVS, T("2026-11-10", "08:31"))
    assert v.state == C.DELAYED and v.expected.label == "2026-10" and "2026-09" in v.reason


def test_http_200_with_no_new_period_is_never_current():
    f = held(last_success_at=S_OCT + 30, last_change_at=S_OCT + 30)                 # fetched OK, even wrote a revision
    v = cur.evaluate(CPI, f, CPI_EVS, S_OCT + 60)
    assert v.state == C.CHECKING and "not held" in v.reason


def test_eia_grace_90_minutes():
    evs = [E("eia:wpsr", "2026-10-02", "2026-10-07", "10:30", "rule", "rule")]
    f = Facts(latest_period="2026-09-19", last_success_at=1)
    s = T("2026-10-07", "10:30")
    assert cur.evaluate(CRUDE, f, evs, s + 75 * 60).state == C.CHECKING
    assert cur.evaluate(CRUDE, f, evs, s + 91 * 60).state == C.DELAYED


def test_daily_expected_previous_business_day_and_one_business_day_grace():
    evs = cal.rule_events("2026-10-05").events
    evs = [e for e in evs if e.calendar_key == "fed:h15"]
    f = Facts(latest_period="2026-10-01", last_success_at=1)                         # holds Thursday
    mon_am = T("2026-10-05", "10:00")
    v = cur.evaluate(T10, f, evs, mon_am)
    assert v.state == C.CURRENT and v.expected.period_start == "2026-10-01"
    mon_pm = T("2026-10-05", "16:20")
    v = cur.evaluate(T10, f, evs, mon_pm)
    assert v.state == C.CHECKING and v.expected.period_start == "2026-10-02"         # Friday's obs now expected
    assert v.window_end == T("2026-10-06", "16:15")                                  # + 1 business day
    # Friday Oct 9 obs releases Tue Oct 13 (Columbus Day); its grace runs to Wed Oct 14 16:15
    f2 = Facts(latest_period="2026-10-08", last_success_at=1)
    v = cur.evaluate(T10, f2, evs, T("2026-10-14", "16:00"))
    assert v.state == C.CHECKING and v.expected.period_start == "2026-10-09"
    v = cur.evaluate(T10, f2, evs, T("2026-10-14", "16:16"))                       # Oct 13 obs now also due ...
    assert v.state == C.DELAYED and "2026-10-09" in v.reason                        # ... but Oct 9 is overdue
    assert cur.evaluate(T10, Facts(latest_period="2026-10-09", last_success_at=1), evs,
                        T("2026-10-14", "16:16")).expected.period_start == "2026-10-13"


def test_source_unavailable_inside_window_and_quota_block():
    f = held(consecutive_failures=3, last_failure_kind="source")
    assert cur.evaluate(CPI, f, CPI_EVS, S_OCT + 60).state == C.SOURCE_UNAVAILABLE
    f = held(blocked_until=S_OCT + 86400, last_failure_kind="quota", consecutive_failures=1)
    v = cur.evaluate(CPI, f, CPI_EVS, S_OCT + 60)
    assert v.state == C.SOURCE_UNAVAILABLE and "quota" in v.reason
    # source failing but the expected period is held -> still CURRENT (the data IS current)
    assert cur.evaluate(CPI, held("2026-09-01", consecutive_failures=5), CPI_EVS, S_OCT + 60).state == C.CURRENT


def test_validation_failed_keeps_precedence_until_a_later_success():
    f = held("2026-09-01", last_success_at=S_OCT + 10, last_validation_failure_at=S_OCT + 20)
    assert cur.evaluate(CPI, f, CPI_EVS, S_OCT + 30).state == C.VALIDATION_FAILED
    f.last_success_at = S_OCT + 40
    assert cur.evaluate(CPI, f, CPI_EVS, S_OCT + 50).state == C.CURRENT


# ─────────────────────────────── no expectation ──────────────────────────────

def test_no_expectation_without_events_or_after_coverage():
    assert cur.evaluate(CPI, held(), [], S_OCT).state == C.NO_EXPECTATION
    f = held("2026-11-01")
    jan = T("2027-01-02", "12:00")
    assert cur.evaluate(CPI, f, CPI_EVS, jan, coverage_end="2026-12-31").state == C.NO_EXPECTATION
    assert cur.evaluate(CPI, f, CPI_EVS, T("2026-12-20"), coverage_end="2026-12-31").state == C.CURRENT


def test_stale_rule_horizon_is_no_expectation():
    evs = [e for e in cal.rule_events("2026-10-05").events if e.calendar_key == "fed:h15"]
    f = Facts(latest_period="2026-10-16", last_success_at=1)
    assert cur.evaluate(T10, f, evs, T("2026-10-30")).state == C.NO_EXPECTATION


def test_hole_event_is_no_expectation_until_the_period_is_held():
    mts = registry.get("USMTSDEF")
    evs = [E("fiscal:mts", "2026-08", "2026-09-11", "14:00", "rule", "rule"),
           E("fiscal:mts", "2026-09", "2026-10-01", None, "unknown", "authoritative_feed"),
           E("fiscal:mts", "2026-10", "2026-11-12", "14:00", "exact", "authoritative_feed")]
    f = Facts(latest_period="2026-08-01", last_success_at=1)
    assert cur.evaluate(mts, f, evs, T("2026-09-30")).state == C.CURRENT
    v = cur.evaluate(mts, f, evs, T("2026-10-20"))
    assert v.state == C.NO_EXPECTATION and "does not invent" in v.reason
    assert cur.evaluate(mts, Facts(latest_period="2026-09-01", last_success_at=1), evs,
                        T("2026-10-20")).state == C.CURRENT
    hole = E("dol:claims", "2026-11-21", "2026-11-25", None, "unknown", "rule")
    assert hole.is_hole


# ─────────────────────────────── revision releases ───────────────────────────

GDP_EVS = [E("bea:gdp", "2026Q2/rev1", "2026-08-26", "08:30", src="authoritative_feed"),
           E("bea:gdp", "2026Q2/rev2", "2026-09-30", "08:30", src="authoritative_feed"),
           E("bea:gdp", "2026Q3", "2026-10-29", "08:30", src="authoritative_feed")]
S_GDP = T("2026-09-30", "08:30")


def test_revision_release_needs_a_positive_signal():
    base = dict(latest_period="2026-04-01", last_change_at=T("2026-08-26", "08:31"),
                last_success_at=S_GDP + 60)
    v = cur.evaluate(GDP, Facts(**base), GDP_EVS, S_GDP + 60)
    assert v.state == C.CHECKING and v.expected.kind == "revision"
    v = cur.evaluate(GDP, Facts(**base), GDP_EVS, S_GDP + 3600)
    assert v.state == C.UNCONFIRMED                                                  # never CURRENT without a signal
    assert cur.evaluate(GDP, Facts(**{**base, "last_change_at": S_GDP + 30}), GDP_EVS, S_GDP + 60).state == C.CURRENT
    assert cur.evaluate(GDP, Facts(**{**base, "last_published_at": S_GDP + 20}), GDP_EVS,
                        S_GDP + 60).state == C.CURRENT
    # provider time BEFORE the schedule is not a signal for this release
    assert cur.evaluate(GDP, Facts(**{**base, "last_published_at": S_GDP - 20}), GDP_EVS,
                        S_GDP + 60).state == C.CHECKING
    # no validated fetch after the schedule at all -> DELAYED, not UNCONFIRMED
    stale = {**base, "last_success_at": S_GDP - 100}
    assert cur.evaluate(GDP, Facts(**stale), GDP_EVS, S_GDP + 3600).state == C.DELAYED


def test_verdict_unpacks_as_the_contract_tuple():
    state, reason, expected, nxt = cur.evaluate(CPI, held(), CPI_EVS, S_OCT - 60)
    assert state == C.CURRENT and expected.label == "2026-08" and nxt["date"] == "2026-10-14"


def test_window_end_families():
    assert cur.grace_s("bls:cpi") == 3600 and cur.grace_s("eia:wpsr") == 5400
    d = E("dol:claims", "2026-10-10", "2026-10-15", None, "date_only", "rule")
    assert cur.window_end(d, "dol:claims", "W") == T("2026-10-16") + 3600


# ─────────────────────────────── DB wrapper ──────────────────────────────────

@pytest.fixture
def s(tmp_path):
    db = st.connect(str(tmp_path / "econ.db"))
    yield db
    db.close()


def test_refresh_state_writes_series_state(s):
    cal.refresh(s, T("2026-09-28", "12:00"), feeds=False)
    rid = s.upsert_release("backfill:USCPI:x", None, "backfill")
    s.write_observations("USCPI", rid, [("2026-08-01", "2026-08-31", 321.5, "", T("2026-09-11", "08:30"),
                                         "rule", "L", None, None)], now=T("2026-09-28"))
    cur.note_success(s, "USCPI", T("2026-09-28"))
    v = cur.refresh_state(s, CPI, T("2026-09-28", "12:00"))
    row = s.get_state("USCPI")
    assert v.state == C.CURRENT and row["state"] == "CURRENT"
    assert row["latest_period"] == "2026-08-01" and row["expected_period"] == "2026-08-01"
    assert s.get_event(row["next_event_id"])["sched_date"] == "2026-10-14"
    v = cur.refresh_state(s, CPI, S_OCT + 7200)
    assert v.state == C.DELAYED and s.get_state("USCPI")["expected_period"] == "2026-09-01"
    j = copy.deepcopy(CPI)
    j["status"] = "disabled"
    assert cur.refresh_state(s, j, S_OCT).state == C.NOT_PRODUCTION


def test_derived_series_inherits_input_fetch_facts(s):
    mom = registry.get("USCPIMOM")
    cur.note_success(s, "USCPI", 1000, published_at=900)
    f = cur.gather_facts(s, mom, 2000)
    assert f.last_success_at == 1000 and f.last_published_at == 900


def test_ops_fields_are_whitelisted(s):
    with pytest.raises(ValueError):
        cur.update_series_ops(s, "USCPI", 1, bogus=1)
    cur.note_failure(s, "USCPI", 5, "source", "x")
    cur.note_failure(s, "USCPI", 6, "validation", "y")
    o = cur.series_ops(s, "USCPI")
    assert o["consecutive_failures"] == 2 and o["last_validation_failure_at"] == 6
    cur.note_success(s, "USCPI", 7)
    assert cur.series_ops(s, "USCPI")["consecutive_failures"] == 0
