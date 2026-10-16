"""Auto chart: the team's reference lines on archive-setup charts (api/services/wisdom/archive/levels.py).

SYNTHETIC bars and calls only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a formula drifting (prior-day high/low, the 10-session range high, the 10/20 EMA);
2. LOOKAHEAD: a bar dated on or after the as-of date changing any line;
3. family routing: a breakout setup losing its trigger lines, pullback_ma its entry lines, either
   its stop lines, or an excluded setup (support_level, undercut_reclaim, launch_pad, intraday)
   getting any line at all;
4. a call's stated price reaching the chart before it is older than 20 sessions, or an aged
   stated price NOT replacing the generic line of its role;
5. a label attributing a line to a person instead of saying where the team usually places it;
6. the route carrying `lines` with either flag off, or not carrying it with both on.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import levels, service
from api.services.wisdom.core import store, timeutil
from tests.authclients import PAID_MEMBER, authorize


def _weekdays(start: date, n: int) -> list[str]:
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


DAYS = _weekdays(date(2025, 3, 3), 30)
AS_OF = DAYS[25]                          # the chart's date: only DAYS[0..24] may be read


def _bars(n_after: int = 0) -> list[dict]:
    """Closes 50, 51, ... ; high = close + 1, low = close - 1; one spike high of 90 on DAYS[18]
    (inside the last 10 sessions before AS_OF) so the 10-day high differs from the prior-day high."""
    out = []
    for i, d in enumerate(DAYS[:25 + n_after]):
        c = 50.0 + i
        out.append({"date": d, "high": 90.0 if i == 18 else c + 1, "low": c - 1, "close": c})
    return out


def _ema(closes, n):
    k = 2 / (n + 1)
    e = sum(closes[:n]) / n
    for c in closes[n:]:
        e = e * (1 - k) + c * k
    return e


CLOSES = [50.0 + i for i in range(25)]
PDH, PDL = 75.0, 73.0                     # DAYS[24]: close 74
RANGE_HIGH = 90.0
EMA10, EMA20 = round(_ema(CLOSES, 10), 2), round(_ema(CLOSES, 20), 2)


def _by(lines):
    return {(l["role"], l["kind"]): l for l in lines}


# ── 1. formulas ──────────────────────────────────────────────────────────────

def test_breakout_lines_are_the_prior_day_high_and_the_10_day_high_plus_the_stop_lines():
    got = _by(levels.compute(_bars(), "flat_top_breakout", AS_OF))
    assert set(got) == {("trigger", "prior_day_high"), ("trigger", "range_high_10"),
                        ("stop", "prior_day_low"), ("stop", "ema_20")}
    assert got[("trigger", "prior_day_high")]["price"] == PDH
    assert got[("trigger", "range_high_10")]["price"] == RANGE_HIGH
    assert got[("stop", "prior_day_low")]["price"] == PDL
    assert got[("stop", "ema_20")]["price"] == EMA20


def test_pullback_lines_are_the_10_ema_and_the_prior_day_low_plus_the_stop_lines():
    got = _by(levels.compute(_bars(), "pullback_ma", AS_OF))
    assert set(got) == {("entry", "ema_10"), ("entry", "prior_day_low"), ("stop", "prior_day_low"), ("stop", "ema_20")}
    assert got[("entry", "ema_10")]["price"] == EMA10
    assert got[("entry", "prior_day_low")]["price"] == PDL
    assert EMA10 != EMA20                                                            # control: the two EMAs differ


def test_the_10_day_high_is_the_last_10_sessions_only():
    bars = _bars()
    bars[10]["high"] = 500.0                                                         # 15 sessions back: outside
    assert _by(levels.compute(bars, "flag_htf", AS_OF))[("trigger", "range_high_10")]["price"] == RANGE_HIGH
    bars[15]["high"] = 400.0                                                         # 10 sessions back: inside
    assert _by(levels.compute(bars, "flag_htf", AS_OF))[("trigger", "range_high_10")]["price"] == 400.0


def test_too_few_bars_drop_only_the_lines_they_cannot_support():
    got = _by(levels.compute(_bars()[:5], "breakout_other", DAYS[5]))
    assert set(got) == {("trigger", "prior_day_high"), ("stop", "prior_day_low")}
    assert levels.compute([], "breakout_other", AS_OF) == []


# ── 2. no lookahead ──────────────────────────────────────────────────────────

def test_a_bar_on_or_after_the_as_of_date_changes_nothing():
    base = levels.compute(_bars(), "inside_day", AS_OF)
    later = _bars(n_after=5)                                                         # DAYS[25..29] exist now
    for b in later[25:]:
        b["high"], b["low"], b["close"] = 999.0, 1.0, 500.0
    assert levels.compute(later, "inside_day", AS_OF) == base
    shuffled = list(reversed(later))                                                 # order must not matter either
    assert levels.compute(shuffled, "inside_day", AS_OF) == base
    # control: the same bars DO move the lines once the chart's date is after them
    assert levels.compute(later, "inside_day", DAYS[29]) != base


# ── 3. family routing ────────────────────────────────────────────────────────

@pytest.mark.parametrize("setup", sorted(levels.BREAKOUT_SETUPS))
def test_every_breakout_setup_routes_to_trigger_lines(setup):
    roles = {l["role"] for l in levels.compute(_bars(), setup, AS_OF)}
    assert roles == {"trigger", "stop"}


@pytest.mark.parametrize("setup", ["support_level", "undercut_reclaim", "launch_pad", "intraday_pivot",
                                   "index_0dte", "kicker", "ep", "", None, "not_a_setup"])
def test_setups_outside_the_two_families_get_no_lines(setup):
    assert levels.compute(_bars(), setup, AS_OF) == []
    assert levels.family(setup) is None


def test_the_breakout_family_is_exactly_the_studied_setups():
    assert levels.BREAKOUT_SETUPS == {"breakout_other", "flat_top_breakout", "flag_htf", "inside_day", "peg_flag"}
    assert levels.PULLBACK_SETUPS == {"pullback_ma"}


def test_a_short_call_gets_no_lines():
    assert levels.compute(_bars(), "flag_htf", AS_OF, direction="short") == []
    assert levels.compute(_bars(), "flag_htf", AS_OF, direction="LONG")             # control


# ── 4. stated prices replace the generic line of their role ────────────────────

def test_a_stated_entry_and_stop_replace_the_generic_lines_of_their_role():
    got = levels.compute(_bars(), "flat_top_breakout", AS_OF, stated=[("entry", 77.5), ("stop", 71.0),
                                                                       ("target", 99.0)], posted=AS_OF)
    assert {(l["role"], l["kind"], l["price"]) for l in got} == {("trigger", "stated_entry", 77.5),
                                                               ("stop", "stated_stop", 71.0)}
    assert all("Stated" in l["label"] and AS_OF in l["label"] for l in got)
    pull = _by(levels.compute(_bars(), "pullback_ma", AS_OF, stated=[("entry", 70.0)]))
    assert set(pull) == {("entry", "stated_entry"), ("stop", "prior_day_low"), ("stop", "ema_20")}


# ── 5. labels ────────────────────────────────────────────────────────────────

def test_labels_say_where_the_team_places_a_line_never_whose_level_it_is():
    for setup in ("flag_htf", "pullback_ma"):
        for l in levels.compute(_bars(), setup, AS_OF):
            assert l["label"].endswith(f"team {l['role']} line"), l
            assert "trader" not in l["label"].lower()
    lab = _by(levels.compute(_bars(), "flag_htf", AS_OF))[("trigger", "range_high_10")]["label"]
    assert lab == "10-day high · team trigger line"
    assert "trader's" not in levels.NOTE.lower() and "reference" in levels.NOTE.lower()


# ── 4b. the age gate, through the store ────────────────────────────────────────

TODAY = timeutil.now_et().date()
RECENT = (TODAY - timedelta(days=3)).isoformat()
AGED = (TODAY - timedelta(days=60)).isoformat()


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    store.init_db()


def _bars_until(as_of: str) -> list[dict]:
    end = date.fromisoformat(as_of)
    days = [d for d in _weekdays(end - timedelta(days=60), 60) if d < as_of]
    return [{"date": d, "high": 21.0 + i * 0.01, "low": 19.0, "close": 20.0} for i, d in enumerate(days)]


def _seed_calls():
    calls = [
        {"call_id": "t9201#0", "record_id": "t9201", "author_id": "tsdr", "ticker": "ZZLA", "direction": "long",
         "setup": "flag_htf", "action": "entry", "posted": AGED, "entry": 31.25, "stop": 27.5, "target": 40.0,
         "outcome": {"r20": 0.1, "status": "scored"}},
        {"call_id": "t9202#0", "record_id": "t9202", "author_id": "tsdr", "ticker": "ZZLB", "direction": "long",
         "setup": "flag_htf", "action": "entry", "posted": RECENT, "entry": 33.75, "stop": 29.25, "target": 41.0,
         "outcome": {}},
    ]
    with store.write() as conn:
        assert service.upsert_batch(conn, "calls", calls)["inserted"] == 2
    return calls


def test_an_aged_call_shows_its_stated_price_and_a_recent_call_never_does(wisdom_db, monkeypatch):
    monkeypatch.setattr(levels, "_bars_before", lambda sym, as_of: _bars_until(as_of))
    calls = _seed_calls()
    with store.read() as conn:
        out = levels.for_calls(conn, calls, "flag_htf")
    aged, recent = _by(out["t9201#0"]), _by(out["t9202#0"])
    assert aged[("trigger", "stated_entry")]["price"] == 31.25 and aged[("stop", "stated_stop")]["price"] == 27.5
    assert ("trigger", "prior_day_high") not in aged
    assert ("trigger", "prior_day_high") in recent and ("trigger", "range_high_10") in recent
    blob = repr(out["t9202#0"])
    assert "33.75" not in blob and "29.25" not in blob and "stated" not in blob


def test_the_age_gate_is_the_providers_twenty_sessions(wisdom_db, monkeypatch):
    from api.services.wisdom.archive import provider

    monkeypatch.setattr(levels, "_bars_before", lambda sym, as_of: _bars_until(as_of))
    calls = _seed_calls()
    monkeypatch.setattr(provider, "PRICE_AGE_SESSIONS", 10_000)                      # nothing is aged now
    with store.read() as conn:
        out = levels.for_calls(conn, calls, "flag_htf")
    assert "stated" not in repr(out)


# ── 6. the route ─────────────────────────────────────────────────────────────

SECRET = "s3cret-archive-lines-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}


def _client():
    a = FastAPI()
    a.include_router(wisdom_archive.member_router)
    a.include_router(wisdom_archive.internal_router)
    authorize(a, PAID_MEMBER)
    return TestClient(a, raise_server_exceptions=False)


def _seed_playbook():
    from tests.test_wisdom_archive_members import _playbook

    pb = _playbook(setup_id="flat_top_breakout", name="Flat top breakout", aliases=["flat top"],
                   winners=[{"call_id": "t9201#0", "record_id": "t9201", "ticker": "ZZLA", "author_id": "tsdr",
                             "posted": AGED, "direction": "long", "action": "entry", "evidence": "synthetic",
                             "r20": 0.1, "sim_R": 2.0, "regime": "uptrend"}],
                   failures=[])
    out = _client().post(BATCH, json={"kind": "setups", "items": [pb]}, headers=AUTH).json()
    assert out["inserted"] == 1, out


@pytest.fixture
def routed(wisdom_db, monkeypatch):
    from api.services.wisdom.archive import setup_map

    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setattr(levels, "_bars_before", lambda sym, as_of: _bars_until(as_of))
    monkeypatch.setattr(setup_map, "market_state", lambda: None)
    _seed_calls()
    _seed_playbook()


PLAYBOOK = "/api/wisdom/archive/playbook/flat_top_breakout"
PATTERN = "/api/wisdom/archive/pattern/flat_base?ticker=ZZLA"


def test_the_field_is_present_only_with_both_flags_on(routed, monkeypatch):
    c = _client()
    for flag in ("", "0"):
        monkeypatch.setenv("WISDOM_ARCHIVE_LINES_ENABLED", flag)
        assert "lines" not in c.get(PLAYBOOK).json()
        assert "lines" not in c.get(PATTERN).json()
    monkeypatch.setenv("WISDOM_ARCHIVE_LINES_ENABLED", "1")
    pb = c.get(PLAYBOOK).json()
    assert pb["lines"]["t9201#0"][0]["kind"] == "stated_entry" and pb["lines_note"] == levels.NOTE
    pat = c.get(PATTERN).json()
    assert {l["role"] for l in pat["lines"]} == {"trigger", "stop"}
    assert not any("stated" in l["kind"] for l in pat["lines"])                     # no call shown: generic only
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")                                 # the archive flag still rules
    assert c.get(PLAYBOOK).status_code == 404 and c.get(PATTERN).status_code == 404


def test_a_bars_failure_answers_no_lines_never_an_error(routed, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_LINES_ENABLED", "1")

    def boom(sym, as_of):
        raise RuntimeError("bars store down")

    monkeypatch.setattr(levels, "_bars_before", boom)
    r = _client().get(PATTERN)
    assert r.status_code == 200 and r.json()["lines"] == []
