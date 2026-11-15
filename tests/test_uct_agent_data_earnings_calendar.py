"""MD-1 kind `earnings.calendar` (P3) — the market-wide earnings calendar for the Agent, read from what UCT already built.

No network, no provider, no model: the calendar router's cache, its ServeStale slot and the ET clock are replaced with
in-memory stand-ins, and EVERY builder / provider leg the calendar has is a tripwire (a read must never build).
Pins (AUDIT conditions on the design):
  1 per-row TRUE source (stamped at the row's constructor; a mixed week built by the REAL builders shows EW + Finnhub)
  2 bounded side effects: a cold week is `unavailable` ("not loaded yet"), provider_calls 0, never a build or a refresh
  3 a TBD row's session is `unknown`, never guessed; a bmo / amc filter says how many unknown rows it left out
  4 partial only when the week is good; a failed / missing / empty week is unavailable; a stale slot is stale + a note
  5 past weeks: actuals included, estimates labelled consensus-at-store, past dates never upcoming
  6 ForexFactory econ / fed rows never appear (an allow-list of buckets)
  7 access: anonymous 401, unpaid 402, a paid non-admin 403 while the Agent is dark, through the real Agent doors
  8 LOCAL-ONLY: a stored calendar answer reaches a model as the value-free marker only, under v1 and v2
  9 bytes: the round-1 bound with and without the capability registered
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import calendar as cal
from api.services.serve_stale import ServeStale
from api.services.uct_agent import turn, turn_v2 as v2
from api.services.uct_agent.marketdata import earnings_calendar as ec
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODAY = date(2026, 11, 18)                          # Wednesday: Mon/Tue past, Wed today, Thu/Fri upcoming
MON = date(2026, 11, 16)
NOW = datetime(2026, 11, 18, 11, 0, tzinfo=ec._ET)


class _Cache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = v


def _boom(*a, **k):
    raise AssertionError("an Agent read reached a calendar builder / provider leg")


TRIPWIRES = ("_build_current_week", "_build_range_week", "_get_or_build_range_week", "_build_live", "_backfill_past_days",
             "_supplement_live_days", "_patch_today_actuals", "_fetch_ew_day_resilient", "_fh_get_month", "_fmp_range_week",
             "_fmp_calendar_day", "_fetch_finviz_past_sessions", "_merge_finviz_sessions", "_fetch_ff_events",
             "_curate_econ_events", "_attach_names", "_attach_date_moves", "_attach_entities", "_resolve_tbd_sessions",
             "_past_reactions", "_build_enrichment_for_date", "refresh_calendar", "_get_calendar_payload",
             "rewarm_current_week_once")
_REAL = {n: getattr(cal, n) for n in TRIPWIRES}       # the router's own functions, for the one test that builds on purpose


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ec.KIND)
    gw._reset_for_test(None)
    store = _Cache()
    monkeypatch.setattr(cal, "cache", store)
    monkeypatch.setattr(cal, "_WEEKLY_STALE", ServeStale("calendar_weekly_test", max_age_seconds=cal._WEEKLY_STALE_MAX_AGE))
    monkeypatch.setattr(cal, "_today_et", lambda: TODAY)
    monkeypatch.setattr(ec, "now_et", lambda: NOW)
    for name in TRIPWIRES:
        monkeypatch.setattr(cal, name, _boom)
    yield store
    gw._reset_for_test(None)


def _r(sym, src="earningswhispers", **kw):
    return {"sym": sym, "eps_est": 1.25, "eps_act": None, "rev_est": 2500.0, "rev_act": None, "ew": 0, "mc_b": None,
            "time_et": None, "src": src, **kw}


def _day(d, bmo=(), amc=(), tbd=(), econ=None):
    return {"label": "", "day": "", "is_today": d == TODAY, "bmo": list(bmo), "amc": list(amc), "tbd": list(tbd),
            "econ": econ if econ is not None else [{"title": "CPI m/m", "time": "8:30 AM", "impact": "High"}],
            "fed": [{"title": "Fed Chair Speaks"}]}


def _week(monday=MON, **days):
    out = {}
    for i in range(5):
        d = monday + timedelta(days=i)
        out[d.isoformat()] = days.get(d.strftime("%a").lower(), _day(d))
    return {"week_start": monday.isoformat(), "week_end": (monday + timedelta(days=4)).isoformat(), "days": out,
            "source": "live", "earnings_quality": {"degraded": False}, "as_of": "2026-11-18T13:05:00+00:00",
            "is_current_week": True}


def _read(params=None, purpose="answer", turn_id="t1"):
    return gw.read(ec.KIND, params or {}, user_id=1, turn_id=turn_id, purpose=purpose)


def _current(store, payload):
    store.d["calendar_weekly"] = payload


def _full_week():
    return _week(mon=_day(MON, bmo=[_r("AAA", "finnhub", eps_act=1.4, rev_act=2600.0)]),
                 tue=_day(MON + timedelta(1), tbd=[_r("BBB", "fmp")]),
                 wed=_day(TODAY, bmo=[_r("CCC")], amc=[_r("DDD")], tbd=[_r("EEE", "finnhub")]),
                 thu=_day(MON + timedelta(3), amc=[_r("FFF", date_est=True)]),
                 fri=_day(MON + timedelta(4), bmo=[_r("GGG", "finviz")]))


# ── 1 · per-row TRUE source ───────────────────────────────────────────────────────────────────────────────────────────
def test_every_row_carries_the_provider_that_placed_it_and_the_envelope_names_exactly_those(_env):
    _current(_env, _full_week())
    out = _read()
    assert env.validate_envelope(out) == [] and out["status"] == "ok"
    got = {r["symbol"]: r["source"] for r in out["data"]["rows"]}
    assert got == {"AAA": "finnhub", "BBB": "fmp", "CCC": "earningswhispers", "DDD": "earningswhispers", "EEE": "finnhub",
                   "FFF": "earningswhispers", "GGG": "finviz"}
    assert out["source"] == "earningswhispers+finnhub+finviz+fmp" == "+".join(out["data"]["sources"])


def test_a_row_built_before_the_stamp_existed_is_unrecorded_never_a_guess(_env):
    old = _r("OLD"); old.pop("src")
    _current(_env, _week(thu=_day(MON + timedelta(3), amc=[old])))
    out = _read()
    assert out["data"]["rows"][0]["source"] == "unrecorded" and out["source"] == "unrecorded"


def test_a_MIXED_week_built_by_the_REAL_builders_stamps_EW_forward_days_and_the_Finnhub_backfill_past_days(monkeypatch):
    """The real `_build_live` (EarningsWhispers, forward days) and `_backfill_past_days` (Finnhub, passed days) on
    stubbed provider answers: each row says which of them placed it."""
    real = cal
    for name in ("_build_live", "_backfill_past_days"):             # the two REAL builders; every provider leg stays stubbed
        monkeypatch.setattr(real, name, _REAL[name])
    if True:
        monkeypatch.setattr(real, "_today_et", lambda: TODAY)
        monkeypatch.setattr(real, "_EW_PACE_SECONDS", 0)
        week = [MON + timedelta(days=i) for i in range(5)]
        ew = {(MON + timedelta(3)).isoformat(): [{"symbol": "FWD", "hour": "amc", "eps_estimate": 1.0, "ew_total": 3}],
              TODAY.isoformat(): [{"symbol": "NOW", "hour": "bmo", "eps_estimate": 0.5, "ew_total": 1}]}
        monkeypatch.setattr(real, "_fetch_ew_day_resilient", lambda ds: list(ew.get(ds, [])))
        days = real._build_live(week, TODAY)
        for d in week:
            days.setdefault(d.isoformat(), real._empty_day(d, TODAY))
        fh = {"earningsCalendar": [{"symbol": "PAST", "date": MON.isoformat(), "hour": "bmo", "epsEstimate": 2.0, "epsActual": 2.1},
                                   {"symbol": "TBDP", "date": (MON + timedelta(1)).isoformat(), "hour": "", "epsEstimate": 0.1}]}
        monkeypatch.setattr(real, "_fh_get_month", lambda a, b: fh)
        monkeypatch.setattr(real, "_fmp_range_week", lambda a, b: (None, None))
        monkeypatch.setattr(real, "_fetch_finviz_past_sessions", lambda *a, **k: {})
        monkeypatch.setattr(real, "_merge_finviz_sessions", lambda *a, **k: (0, 0))
        real._backfill_past_days(days, week, TODAY, None)
        srcs = {e["sym"]: e.get("src") for day in days.values() for b in ("bmo", "amc", "tbd") for e in day.get(b) or []}
        assert srcs["FWD"] == "earningswhispers" and srcs["NOW"] == "earningswhispers"
        assert srcs["PAST"] == "finnhub" and srcs["TBDP"] == "finnhub"


def test_every_row_constructor_in_the_calendar_router_stamps_a_source():
    """Every `"sym": sym` row literal in calendar.py's week builders is followed by its `"src"` stamp (a new leg must too)."""
    src = open(os.path.join(ROOT, "api", "routers", "calendar.py"), encoding="utf-8").read()
    body = src[:src.index("def _days_for_date(")]
    sites = [m.start() for m in re.finditer(r'"sym":\s+sym,', body)]
    assert len(sites) >= 11
    for at in sites:
        assert '"src":' in body[at: at + 220], body[at: at + 160]


# ── 2 · bounded side effects: warm only ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("params", [{}, {"week": "2026-11-09"}, {"week": "2027-11-15"}, {"date": "2026-11-27"}])
def test_a_COLD_week_is_unavailable_not_loaded_yet_and_never_builds(params):
    out = _read(params)                              # every builder is a tripwire: reaching one fails the test
    assert out["status"] == "unavailable" and out["provider_calls"] == 0
    assert "has not loaded the earnings calendar for the week of" in out["notes"][0]


def test_a_week_past_the_52_week_horizon_is_out_of_range():
    out = _read({"week": "2028-06-05"})
    assert out["status"] == "unavailable" and "outside UCT's earnings calendar range" in out["notes"][0]


def test_another_WARM_week_is_read_from_its_range_cache_with_zero_provider_calls(_env):
    nxt = date(2026, 11, 23)
    _env.d[f"calendar_week_{nxt.isoformat()}"] = {**_week(nxt, tue=_day(nxt + timedelta(1), bmo=[_r("NXT", "finnhub")])),
                                                  "source": "range_finnhub", "is_current_week": False}
    out = _read({"week": "2026-11-25"})
    assert out["status"] == "ok" and out["provider_calls"] == 0 and [r["symbol"] for r in out["data"]["rows"]] == ["NXT"]
    assert out["data"]["rows"][0]["when"] == "upcoming"


def test_the_peek_never_kicks_a_refresh_of_the_stale_slot(_env, monkeypatch):
    kicked = []
    monkeypatch.setattr(cal._WEEKLY_STALE, "_kick", lambda *a, **k: kicked.append(1))
    cal._WEEKLY_STALE.remember("current", _full_week())
    assert _read()["stale"] is True and kicked == []


# ── 3 · sessions never guessed ───────────────────────────────────────────────────────────────────────────────────────
def test_a_TBD_row_is_session_unknown(_env):
    _current(_env, _full_week())
    rows = {r["symbol"]: r["session"] for r in _read()["data"]["rows"]}
    assert rows["BBB"] == "unknown" and rows["EEE"] == "unknown" and rows["CCC"] == "bmo" and rows["DDD"] == "amc"


@pytest.mark.parametrize("session,keep,unknown", [("bmo", {"AAA", "CCC", "GGG"}, 2), ("amc", {"DDD", "FFF"}, 2)])
def test_a_session_filter_excludes_unknown_rows_and_says_how_many(_env, session, keep, unknown):
    _current(_env, _full_week())
    out = _read({"session": session})
    assert {r["symbol"] for r in out["data"]["rows"]} == keep
    assert out["data"]["excluded"]["unknown"] == unknown
    assert any(f"{unknown} reporters with an unconfirmed session" in n and f"the {session} filter" in n for n in out["notes"])


# ── 4 · partial vs unavailable vs stale ──────────────────────────────────────────────────────────────────────────────
def test_symbols_not_on_a_GOOD_week_make_it_partial_with_not_on_calendar(_env):
    _current(_env, _full_week())
    out = _read({"symbols": ["ccc", "ZZZ", "CCC"]})
    assert out["status"] == "partial" and out["data"]["not_on_calendar"] == ["ZZZ"]
    assert [r["symbol"] for r in out["data"]["rows"]] == ["CCC"]
    assert out["coverage"] == {"requested": 2, "answered": 1}
    assert any("not proof they don't report" in n for n in out["notes"])


@pytest.mark.parametrize("payload", [
    {"source": "error", "days": {}},
    {"source": "range_error", "days": {}},
    {"source": "range_error+finviz"},
    {"source": "empty"},
    {"source": "live", "empty_week": True},
])
def test_a_failed_or_empty_week_is_UNAVAILABLE_even_with_symbols_asked(_env, payload):
    wk = _week()
    if payload.pop("empty_week", False):
        for d in wk["days"].values():
            d["bmo"], d["amc"], d["tbd"] = [], [], []
    _current(_env, {**wk, **payload})
    out = _read({"symbols": ["AAA"]})
    assert out["status"] == "unavailable" and out["data"] is None


@pytest.mark.parametrize("source", ["range_error", "range_error+finviz", "error"])
def test_a_FAILED_build_is_unavailable_even_when_it_salvaged_rows(_env, source):
    _current(_env, {**_full_week(), "source": source})              # rows present, but both primary providers failed
    out = _read({"symbols": ["AAA", "ZZZ"]})
    assert out["status"] == "unavailable" and out["data"] is None
    assert "could not be built from its providers" in out["notes"][0]


def test_a_stale_slot_is_served_stale_with_its_age_and_a_note(_env):
    cal._WEEKLY_STALE.remember("current", _full_week(), at=__import__("time").time() - 900)
    out = _read()
    assert out["status"] == "ok" and out["stale"] is True
    assert any("last good calendar UCT built (15 minutes ago)" in n for n in out["notes"])


def test_a_slot_older_than_its_own_bound_is_cold(_env):
    cal._WEEKLY_STALE.remember("current", _full_week(), at=__import__("time").time() - cal._WEEKLY_STALE_MAX_AGE - 5)
    assert _read()["status"] == "unavailable"


def test_as_of_is_the_payloads_build_time_never_fetched_at(_env):
    _current(_env, _full_week())
    out = _read()
    assert out["as_of"] == "2026-11-18T13:05:00Z" != out["fetched_at"]


def test_a_wire_built_week_is_dated_not_timed(_env):
    _current(_env, {**_full_week(), "source": "wire", "as_of": "2026-11-18"})
    out = _read()
    assert out["as_of"] == "2026-11-18T00:00:00Z" and ec.NOTE_WIRE in out["notes"]


def test_a_degraded_build_says_so(_env):
    _current(_env, {**_full_week(), "earnings_quality": {"degraded": True}})
    assert ec.NOTE_DEGRADED in _read()["notes"]


# ── 5 · past weeks ────────────────────────────────────────────────────────────────────────────────────────────────────
def test_past_rows_carry_actuals_and_are_marked_past_with_the_note(_env):
    _current(_env, _full_week())
    out = _read()
    aaa = next(r for r in out["data"]["rows"] if r["symbol"] == "AAA")
    assert aaa["when"] == "past" and aaa["eps_act"] == 1.4 and aaa["rev_act_m"] == 2600.0
    assert {r["when"] for r in out["data"]["rows"] if r["date"] > TODAY.isoformat()} == {"upcoming"}
    assert ec.NOTE_ESTIMATES in out["notes"] and any("have already passed" in n for n in out["notes"])


def test_a_fully_past_week_is_historical(_env):
    last = date(2026, 11, 9)
    _env.d[f"calendar_week_{last.isoformat()}"] = {**_week(last, mon=_day(last, bmo=[_r("OLDW", "finnhub", eps_act=1.0)])),
                                                   "source": "range_finnhub"}
    out = _read({"week": last.isoformat()})
    assert out["freshness"] == "historical" and out["data"]["rows"][0]["when"] == "past"


def test_a_projected_date_is_flagged(_env):
    _current(_env, _full_week())
    out = _read()
    assert next(r for r in out["data"]["rows"] if r["symbol"] == "FFF")["date_estimated"] is True
    assert any("provider projection" in n for n in out["notes"])


# ── 6 · ForexFactory excluded by construction ────────────────────────────────────────────────────────────────────────
def test_econ_and_fed_rows_in_the_payload_never_reach_the_output(_env):
    wk = _full_week()
    for d in wk["days"].values():
        d["econ"] = [{"title": "CPI m/m", "sym": "CPI", "time": "8:30 AM"}]
        d["fed"] = [{"title": "Fed Chair Speaks", "sym": "FED"}]
        d["extra_bucket"] = [{"sym": "XTRA"}]
    _current(_env, wk)
    raw = json.dumps(_read())
    for leak in ("CPI", "Fed Chair", "FED", "XTRA", "8:30 AM", "forexfactory"):
        assert leak not in raw
    assert tuple(b for b, _ in ec.ROW_BUCKETS) == ("bmo", "amc", "tbd")


# ── shape, limit, validation ─────────────────────────────────────────────────────────────────────────────────────────
def test_a_date_reads_only_that_day_sorted_by_session(_env):
    _current(_env, _full_week())
    out = _read({"date": TODAY.isoformat()})
    assert [(r["symbol"], r["session"], r["when"]) for r in out["data"]["rows"]] == [
        ("CCC", "bmo", "today"), ("DDD", "amc", "today"), ("EEE", "unknown", "today")]


def test_the_limit_caps_the_rows_and_says_so(_env):
    _current(_env, _week(thu=_day(MON + timedelta(3), amc=[_r(f"S{i:02d}") for i in range(60)])))
    out = _read({"limit": 50})
    assert len(out["data"]["rows"]) == 50 and out["data"]["total"] == 60 and out["data"]["truncated"] is True
    assert any("50 of 60 reporters are shown" in n for n in out["notes"])


@pytest.mark.parametrize("params", [{"date": "tomorrow"}, {"week": "2026-13-01"}, {"date": "2026-11-18", "week": "2026-11-18"},
                                    {"symbols": []}, {"symbols": "AAPL"}, {"symbols": ["A"] * 51}, {"symbols": ["not a ticker"]},
                                    {"session": "dmh"}, {"limit": 0}, {"limit": 51}, {"limit": True}])
def test_bad_requests_are_refused_before_any_read(params):
    out = _read(params)
    assert out["status"] in ("refused", "unavailable") and out["data"] is None


def test_dark_unless_the_kind_is_named(monkeypatch):
    monkeypatch.setenv(gw.KINDS_ENV, "quote")
    gw._reset_for_test(None)
    assert _read()["status"] == "refused"


def test_registered_default_off_not_isolated_periodic():
    k = gw.registry().get(ec.KIND)
    assert k is not None and k.freshness == "periodic" and k.model_isolated is False and k.max_symbols == ec.MAX_SYMBOLS


# ── 7 · access ────────────────────────────────────────────────────────────────────────────────────────────────────────
def _app(user=None):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import uct_agent as rx
    app = FastAPI()
    app.include_router(rx.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


ASK = "who reports earnings this week?"


@pytest.mark.parametrize("user,code", [(None, 401), ({"id": "u-free", "plan": "free", "role": "user"}, 402),
                                       ({"id": "u-paid", "plan": "pro", "role": "user"}, 403)])
def test_anonymous_unpaid_and_non_admin_get_no_calendar_through_any_agent_door(_env, user, code):
    _current(_env, _full_week())
    c = _app(user)
    r = c.post("/api/agent/data", json={"kind": ec.KIND, "params": {}, "turn_id": "t-x"})
    assert r.status_code == code and "rows" not in r.text and "AAA" not in r.text
    for path in ("/api/agent/turn", "/api/agent/turn/stream", "/api/agent/turn/resume"):
        assert c.post(path, json={"message": ASK, "context": {}, "capabilities": []}).status_code == code, path


def test_an_admin_reads_it_through_the_gateway(_env):
    _current(_env, _full_week())
    r = _app({"id": "u-admin", "plan": "pro", "role": "admin"}).post(
        "/api/agent/data", json={"kind": ec.KIND, "params": {"symbols": ["AAA"]}, "turn_id": "t-a"})
    assert r.status_code == 200 and r.json()["data"]["rows"][0]["symbol"] == "AAA"


# ── 8 · LOCAL-ONLY is a real rail ────────────────────────────────────────────────────────────────────────────────────
STORED = {"role": "outcome", "text": "Earnings — the week of Mon Nov 16: 7 reporting.\nAAA before the open $1.25 / $1.40 (Finnhub)",
          "data": {"kind": "answered", "actions": ["stock.earningsCalendar"], "local": True,
                   "requests": [{"when": "this_week", "date": None, "symbols": ["AAA", "BBB"], "watchlist": "Core", "session": None}]}}


def test_the_capability_is_local_only_and_not_a_pre_read_data_reply():
    assert "stock.earningsCalendar" in turn.LOCAL_ONLY_ACTIONS
    assert "stock.earningsCalendar" not in turn.DATA_READ_ACTIONS


@pytest.mark.parametrize("local_flag", [True, False])
def test_a_stored_calendar_answer_reaches_a_model_as_the_value_free_marker_only(local_flag):
    row = {**STORED, "data": {**STORED["data"], "local": local_flag}}   # the action NAME alone decides, not the browser flag
    assert turn.is_local_row(row) is True
    text = turn.outcome_for_model(row)
    assert text.startswith(turn.LOCAL_RESULT_NOTE)
    for leak in ("AAA", "BBB", "Core", "1.25", "1.40", "Finnhub", "Nov 16", "7 reporting"):
        assert leak not in text


def test_v2_treats_the_capability_as_isolated():
    import inspect
    src = inspect.getsource(v2)
    assert "t1.LOCAL_ONLY_ACTIONS" in src                     # the v2 loop's isolation test reads the same set by name


# ── 9 · bytes (#1224): measured round-1, with and without the capability registered ───────────────────────────────────
def _js_summary() -> str:
    js = open(os.path.join(ROOT, "app", "src", "agent", "capabilities", "earningsCalendar.js"), encoding="utf-8").read()
    return re.search(r"summary: '([^']+)'", js).group(1)


def test_bytes_round1_bound_with_and_without_the_capability(record_property):
    sys.path.insert(0, ROOT)
    from tests import test_uct_agent_v2_cost_measure as cm
    from tools.agent_v2_cost_dryrun import _manifest
    base = _manifest()
    cap = {"name": "stock.earningsCalendar", "summary": _js_summary(), "query": True, "target": "market",
           "args": {"type": "object", "properties": {}, "required": [], "additionalProperties": False}}
    without = cm._round1_bound(base)
    with_cap = cm._round1_bound(base + [cap])
    record_property("bytes_without", without)
    record_property("bytes_with", with_cap)
    line = cm._line_bound(cap)
    assert with_cap["actual"] <= with_cap["bound"] and without["actual"] <= without["bound"]
    assert with_cap["base"] <= cm.NON_INDEX_BUDGET_BYTES                   # the non-index part did not move
    assert with_cap["bound"] - without["bound"] == line                     # exactly its own capped index line
    assert 0 < with_cap["actual"] - without["actual"] <= line
    print(f"\n[bytes] without={without['actual']}/{without['bound']} with={with_cap['actual']}/{with_cap['bound']} line={line}")
