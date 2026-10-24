"""A member is served only the drawings of the ticker's LATEST scan (2026-10-18).

The bug (found by a read-only production check): detections upsert by hash_key, which hashes
(sym, tf, pattern_id, start_t, end_t). When the next scan finds the same pattern with a different
start_t / end_t it writes a NEW row and the old one keeps its stamp -- and memory's 7-day active
window (detected_at + status) keeps serving it. So a member saw a flat-top ceiling and its touch
markers stamped as of an older session (the lab rule draws a fire only as of its own session), and
several bull_flag drawings for one ticker (ABNB had five active rows).

The fix (auto_structures.latest_scan_rows / fresh_member_rows, called by the member path only):
  * per ticker, only rows whose last_seen_at belongs to the ticker's newest scan
    (memory.latest_scan_at: MAX(last_seen_at) over every stored row of that ticker);
  * a uct_flat_top_breakout additionally needs draw_flat_top.end_t == the ticker's newest
    COMPLETED daily bar (today's forming bar never counts; weekends and holidays roll back);
  * a failing scan read serves nothing; a failing bar read withholds only the flat top.
Admin output is untouched and a member's currently-correct rows are all still served: the golden
below seeds a real patterns.db through memory.store_detection and checks both.

Synthetic tickers, ids and prices only (public repo).
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures, bars_sqlite, barspack
from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors import registry
from tests.authclients import ADMIN, PAID_MEMBER, authorize


#: The member bull_flag literal AS SHIPPED, read before any test patches it. Since 2026-10-24 (recert E) it is
#: None: every bull flag is withheld from members. The tests below exercise the round-9 gate MECHANISM, so they
#: run under the one-literal re-enable (MEMBER_BULL_FLAG_ROUND = 9, in memory); the shipped default is railed in
#: tests/test_bull_flag_withheld_from_members.py.
SHIPPED_MEMBER_BULL_FLAG_ROUND = auto_structures.MEMBER_BULL_FLAG_ROUND


@pytest.fixture
def round9_flag_released(monkeypatch):
    monkeypatch.setattr(auto_structures, "MEMBER_BULL_FLAG_ROUND", 9)
    # the MA pullback v5 is withheld from members too (recert C, 2026-10-24; MEMBER_PULLBACK_MA_V5_ROUND = None,
    # railed in tests/test_pullback_v5_withheld_from_members.py); these tests exercise the member gates around it
    # under the same one-literal re-enable
    monkeypatch.setattr(auto_structures, "MEMBER_PULLBACK_MA_V5_ROUND", 1)


pytestmark = pytest.mark.usefixtures("round9_flag_released")

NOW = int(time.time())
#: Scan times: the newest scan two minutes ago, older scans one and two days back.
SCAN_NEW = NOW - 120
SCAN_DAY1 = NOW - 86_400
SCAN_DAY2 = NOW - 2 * 86_400
#: Daily bar keys (YYYYMMDD, as bars_sqlite stores D) the scans drew as of.
BAR_NEW, BAR_DAY1, BAR_DAY2 = 20261016, 20261015, 20261014

URL = "/api/patterns/{sym}?tf=D&confirmed_only=false&include_structures=true"


def _flat_top_draw(as_of: int, price: float = 50.0) -> dict:
    """A well-formed v2 flat-top stamp drawn as of bar `as_of` (display.flat_top_drawing's shape)."""
    return {"price": price, "start_t": 20260901, "end_t": as_of, "label": "flat top",
            "variant": "breakout",
            "touches": [{"t": 20260901, "price": price}, {"t": 20260915, "price": price - 0.05},
                        {"t": 20260929, "price": price}]}


def _det(rid, sym, pid, start_t, end_t, seen, extras=None, status="ready"):
    """A full Detection as the scan stores it; `seen` is the scan's time (detected_at too)."""
    return {
        "id": rid, "sym": sym, "tf": "D", "pattern_id": pid,
        "pattern_name": pid.replace("_", " ").title(),
        "category": "uct", "direction": "bullish",
        "start_t": start_t, "end_t": end_t, "pivot_ts": [],
        "geometry": {"shape": "x", "anchors": [], "extras": dict(extras or {})},
        "levels": {"entry": 50.0, "entry_condition": "", "stop": 47.0, "stop_basis": "",
                   "target_primary": 56.0, "target_secondary": None, "risk_reward": 2.0},
        "context": {}, "confidence": 70.0,
        "quality_components": {"geometry_score": 70.0, "volume_score": 70.0,
                               "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": status, "outcome": None, "detected_at": seen, "last_seen_at": seen,
    }


def _ft(rid, sym, start_t, end_t, seen, as_of):
    return _det(rid, sym, "uct_flat_top_breakout", start_t, end_t, seen,
                {"draw_round": 2, "draw_flat_top": _flat_top_draw(as_of), "trigger_bars_ago": 0})


def _flag(rid, sym, start_t, end_t, seen):
    # drawn entry 40.0, clear of the flat top's 50.0 ceiling: this file tests WHICH SCAN is served, so its
    # rows must not also be one base drawn twice (auto_structures.member_one_line_per_base would keep
    # only the flat top; that rule is railed in tests/test_one_line_per_base.py)
    return _det(rid, sym, "bull_flag", start_t, end_t, seen, {"draw_round": 9, "draw_entry_price": 40.0})


ET = ZoneInfo("America/New_York")
#: The default session clock: Saturday noon ET, so the last complete session is Friday BAR_NEW.
SAT_NOON = datetime(2026, 10, 17, 12, 0, tzinfo=ET)


class _Bars(dict):
    """sym -> stored daily bar keys. `world[sym] = 20261016` stores bars up to that key (an int is
    the newest stored bar); a list stores exactly those keys."""

    def stored(self, sym):
        v = self.get(sym.upper())
        if v is None:
            return []
        return sorted(v) if isinstance(v, (list, tuple)) else [v]


@pytest.fixture
def world(tmp_path, monkeypatch):
    """An isolated patterns.db, both member flags on, no base boxes / learned drawer, a fake daily
    bar store (`world[sym]`), and the REAL completed-session rule run at a pinned clock
    (`world.now`, default SAT_NOON) -- barspack._last_complete_session_ymd is what decides."""
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_MEMBERS_ENABLED", "1")
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [])
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    bars = _Bars()
    bars.now = SAT_NOON

    def before(sym, tf, n, to_key):
        assert tf == "D"
        keep = [t for t in bars.stored(sym) if t <= to_key][-n:]
        return [(t, 1.0, 1.0, 1.0, 1.0, 1.0) for t in keep]

    real = barspack._last_complete_session_ymd
    monkeypatch.setattr(bars_sqlite, "get_bars_before", before)
    monkeypatch.setattr(barspack, "_last_complete_session_ymd",
                        lambda now=None: real(bars.now if now is None else now))
    return bars


def _store(*dets):
    for d in dets:
        memory.store_detection(d)


def _get(user, sym):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, user)
    return TestClient(app).get(URL.format(sym=sym))


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return [r["id"] for r in resp.json()["detections"]]


# -- the bug, reproduced through the route -----------------------------------------------------------

def test_an_older_scans_flat_top_is_not_served_when_the_new_scan_moved_its_hash(world):
    """Yesterday's scan stamped a flat top; today's scan found the same pattern with a new end_t
    (a new hash_key) and stamped it as of today. Only today's drawing reaches a member."""
    world["ZZA"] = BAR_NEW
    _store(_ft("old", "ZZA", 20260901, BAR_DAY1, SCAN_DAY1, BAR_DAY1),
           _ft("new", "ZZA", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW))
    assert _ids(_get(PAID_MEMBER, "ZZA")) == ["new"]


def test_an_older_scans_flat_top_is_not_served_when_the_new_scan_did_not_stamp_one(world):
    """Today's scan still sees the pattern but its fire is no longer the last bar, so it carries no
    stamp: a member gets NO flat top -- not yesterday's stamped one."""
    world["ZZB"] = BAR_NEW
    _store(_ft("old", "ZZB", 20260901, BAR_DAY1, SCAN_DAY1, BAR_DAY1),
           _det("new", "ZZB", "uct_flat_top_breakout", 20260901, BAR_NEW, SCAN_NEW,
                {"trigger_bars_ago": 1}))
    assert _ids(_get(PAID_MEMBER, "ZZB")) == []


def test_only_the_latest_scans_bull_flags_are_served(world):
    """Five active flag rows for one ticker across three scans: a member gets the newest scan's two."""
    world["ZZC"] = BAR_NEW
    _store(_flag("f1", "ZZC", 20260801, BAR_DAY2, SCAN_DAY2),
           _flag("f2", "ZZC", 20260805, BAR_DAY2, SCAN_DAY2),
           _flag("f3", "ZZC", 20260801, BAR_DAY1, SCAN_DAY1),
           _flag("f4", "ZZC", 20260801, BAR_NEW, SCAN_NEW),
           _flag("f5", "ZZC", 20260805, BAR_NEW, SCAN_NEW + 3))
    assert sorted(_ids(_get(PAID_MEMBER, "ZZC"))) == ["f4", "f5"]


def test_a_flat_top_drawn_as_of_an_older_bar_than_the_latest_is_not_served(world):
    """The newest scan's stamp is as of BAR_DAY1 but a newer bar has since landed: the fire is no
    longer as of its own session. The equal-bar control is served."""
    _store(_ft("ft", "ZZD", 20260901, BAR_DAY1, SCAN_NEW, BAR_DAY1))
    world["ZZD"] = BAR_NEW
    assert _ids(_get(PAID_MEMBER, "ZZD")) == []
    world["ZZD"] = BAR_DAY1
    assert _ids(_get(PAID_MEMBER, "ZZD")) == ["ft"]      # control: the same row can be served


def test_a_family_with_no_row_in_the_newest_scan_serves_nothing(world):
    """The newest scan wrote only a doji for this ticker: yesterday's flag is not current."""
    world["ZZE"] = BAR_NEW
    _store(_flag("f", "ZZE", 20260801, BAR_DAY1, SCAN_DAY1),
           _det("d", "ZZE", "doji", BAR_NEW, BAR_NEW, SCAN_NEW))
    assert _ids(_get(PAID_MEMBER, "ZZE")) == []


def test_a_row_the_newest_scan_rewrote_under_the_same_hash_is_served(world):
    """Same start/end on consecutive scans: the upsert refreshes last_seen_at, so it is current."""
    world["ZZF"] = BAR_NEW
    _store(_flag("f", "ZZF", 20260801, BAR_NEW, SCAN_DAY1))
    _store(_flag("f", "ZZF", 20260801, BAR_NEW, SCAN_NEW))
    assert _ids(_get(PAID_MEMBER, "ZZF")) == ["f"]


# -- fail closed -----------------------------------------------------------------------------------

def test_a_failing_bar_read_withholds_only_the_flat_top(world, monkeypatch):
    """The bar store is only the flat top's question: a failing read drops the flat top and keeps
    every other current row."""
    world["ZZG"] = BAR_NEW
    _store(_flag("f", "ZZG", 20260801, BAR_NEW, SCAN_NEW),
           _ft("ft", "ZZG", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW))
    assert sorted(_ids(_get(PAID_MEMBER, "ZZG"))) == ["f", "ft"]      # control

    def boom(*a, **k):
        raise RuntimeError("bars down")
    monkeypatch.setattr(bars_sqlite, "get_bars_before", boom)
    assert _ids(_get(PAID_MEMBER, "ZZG")) == ["f"]


def test_an_unknown_session_clock_withholds_only_the_flat_top(world, monkeypatch):
    world["ZZM"] = BAR_NEW
    _store(_flag("f", "ZZM", 20260801, BAR_NEW, SCAN_NEW),
           _ft("ft", "ZZM", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW))
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: None)
    assert _ids(_get(PAID_MEMBER, "ZZM")) == ["f"]


def test_the_bar_store_is_read_only_when_a_flat_top_is_on_the_chart(world, monkeypatch):
    world["ZZL"] = BAR_NEW
    _store(_flag("f", "ZZL", 20260801, BAR_NEW, SCAN_NEW))

    def boom(*a, **k):
        raise AssertionError("bar store read without a flat top")
    monkeypatch.setattr(bars_sqlite, "get_bars_before", boom)
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", boom)
    assert _ids(_get(PAID_MEMBER, "ZZL")) == ["f"]


# -- the as-of bar is the last COMPLETED session, never today's forming bar ------------------------

MON, TUE = 20261019, 20261020
WED_PRE_HOL, THANKSGIVING = 20261125, 20261126


def _clock(world, *ymdhm):
    world.now = datetime(*ymdhm, tzinfo=ET)


def test_mid_session_todays_forming_bar_does_not_hide_yesterdays_flat_top(world):
    """Monday 11:00 ET: today's bar is already in the store (chart reads write it mid-session), but
    the last completed session is Friday, which is what the 01:00 scan drew as of."""
    _clock(world, 2026, 10, 19, 11, 0)
    world["ZMS"] = [BAR_DAY1, BAR_NEW, MON]
    _store(_ft("ft", "ZMS", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW))
    assert _ids(_get(PAID_MEMBER, "ZMS")) == ["ft"]
    # the guard still fails a stamp older than the last completed session
    world["ZMT"] = [BAR_DAY1, BAR_NEW, MON]
    _store(_ft("old", "ZMT", 20260901, BAR_DAY1, SCAN_NEW, BAR_DAY1))
    assert _ids(_get(PAID_MEMBER, "ZMT")) == []


def test_after_the_close_a_completed_today_needs_a_newer_scan(world):
    """Monday 17:00 ET: Monday has completed and its bar is stored, so Friday's stamp is old until a
    scan stamps Monday."""
    _clock(world, 2026, 10, 19, 17, 0)
    world["ZAC"] = [BAR_NEW, MON]
    _store(_ft("fri", "ZAC", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW))
    assert _ids(_get(PAID_MEMBER, "ZAC")) == []
    _store(_ft("mon", "ZAC", 20260901, MON, NOW - 30, MON))
    assert _ids(_get(PAID_MEMBER, "ZAC")) == ["mon"]


def test_after_the_close_before_todays_bar_is_stored_the_last_stored_session_counts(world):
    """Monday 17:00 ET but the store has no Monday bar yet: no scan could have drawn Monday, so
    Friday's stamp is still the current one."""
    _clock(world, 2026, 10, 19, 17, 0)
    world["ZAD"] = [BAR_DAY1, BAR_NEW]
    _store(_ft("fri", "ZAD", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW))
    assert _ids(_get(PAID_MEMBER, "ZAD")) == ["fri"]


def test_on_a_weekend_fridays_flat_top_is_current(world):
    _clock(world, 2026, 10, 18, 12, 0)                                   # Sunday
    world["ZWE"] = [BAR_DAY1, BAR_NEW]
    _store(_ft("fri", "ZWE", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW),
           _ft("thu", "ZWE", 20260801, BAR_DAY1, SCAN_NEW, BAR_DAY1))
    assert _ids(_get(PAID_MEMBER, "ZWE")) == ["fri"]


def test_on_a_market_holiday_the_prior_sessions_flat_top_is_current(world):
    """Thanksgiving noon: the last completed session is Wednesday. A bar keyed to the holiday (a
    stray write) is not a completed session and does not hide Wednesday's stamp."""
    _clock(world, 2026, 11, 26, 12, 0)
    world["ZHO"] = [20261124, WED_PRE_HOL, THANKSGIVING]
    _store(_ft("wed", "ZHO", 20261001, WED_PRE_HOL, SCAN_NEW, WED_PRE_HOL))
    assert _ids(_get(PAID_MEMBER, "ZHO")) == ["wed"]


def test_latest_completed_bar_t_is_daily_only_and_reads_the_completed_session(world):
    world["ZLC"] = [BAR_NEW, MON]
    _clock(world, 2026, 10, 19, 11, 0)
    assert auto_structures.latest_completed_bar_t("ZLC", "D") == BAR_NEW
    _clock(world, 2026, 10, 20, 9, 0)                                    # Tuesday pre-open
    assert auto_structures.latest_completed_bar_t("ZLC", "D") == MON
    assert auto_structures.latest_completed_bar_t("ZLC", "5") is None
    assert auto_structures.latest_completed_bar_t("ZLC", "W") is None
    assert auto_structures.latest_completed_bar_t("NONE", "D") is None


def test_a_failing_latest_scan_read_serves_no_detections(world, monkeypatch):
    world["ZZH"] = BAR_NEW
    _store(_flag("f", "ZZH", 20260801, BAR_NEW, SCAN_NEW))
    assert _ids(_get(PAID_MEMBER, "ZZH")) == ["f"]                      # control

    def boom(*a, **k):
        raise RuntimeError("store down")
    monkeypatch.setattr(memory, "latest_scan_at", boom)
    assert _ids(_get(PAID_MEMBER, "ZZH")) == []


def test_a_flat_top_on_a_ticker_with_no_bars_is_not_served(world):
    _store(_ft("ft", "ZZI", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW))
    assert _ids(_get(PAID_MEMBER, "ZZI")) == []


# -- the pure filter -------------------------------------------------------------------------------

def _row(rid, pid, seen, as_of=None):
    ex = {"draw_flat_top": _flat_top_draw(as_of)} if as_of is not None else {}
    return {"id": rid, "pattern_id": pid, "last_seen_at": seen, "geometry": {"extras": ex}}


def test_latest_scan_rows_keeps_the_window_and_fails_closed_on_every_malformed_input():
    tol = auto_structures.SCAN_TOLERANCE_SECS
    rows = [
        _row("edge", "bull_flag", SCAN_NEW - tol),          # exactly at the floor: same scan
        _row("past", "bull_flag", SCAN_NEW - tol - 1),      # one second older: an older scan
        _row("none", "bull_flag", None),
        _row("str", "bull_flag", str(SCAN_NEW)),
        _row("float", "bull_flag", float(SCAN_NEW)),
        {"id": "nokey", "pattern_id": "bull_flag"},
        _row("ft_ok", "uct_flat_top_breakout", SCAN_NEW, BAR_NEW),
        _row("ft_old", "uct_flat_top_breakout", SCAN_NEW, BAR_DAY1),
        _row("ft_str", "uct_flat_top_breakout", SCAN_NEW, str(BAR_NEW)),
        _row("ft_nostamp", "uct_flat_top_breakout", SCAN_NEW),
    ]
    got = auto_structures.latest_scan_rows(rows, SCAN_NEW, BAR_NEW)
    assert [r["id"] for r in got] == ["edge", "ft_ok"]
    assert auto_structures.latest_scan_rows(rows, None, BAR_NEW) == []
    assert auto_structures.latest_scan_rows(rows, str(SCAN_NEW), BAR_NEW) == []
    # an unknown latest bar drops the flat top only
    assert [r["id"] for r in auto_structures.latest_scan_rows(rows, SCAN_NEW, None)] == ["edge"]


def test_latest_scan_at_is_the_newest_row_of_the_ticker_across_every_pattern_and_status(world):
    _store(_flag("a", "ZZJ", 1, 2, SCAN_DAY1),
           _det("b", "ZZJ", "doji", 3, 4, SCAN_NEW, status="expired"),
           _flag("c", "ZZK", 1, 2, NOW))                                # another ticker
    assert memory.latest_scan_at("zzj", "D") == SCAN_NEW
    assert memory.latest_scan_at("ZZJ", "5") is None
    assert memory.latest_scan_at("NOPE", "D") is None


# -- the golden: admin byte-identical, every currently-correct member row still served ----------------

def _seed_golden(world):
    """Four tickers, every member row family, three scans, plus non-member and admin-only rows."""
    world.update({"GA": BAR_NEW, "GB": BAR_NEW, "GC": BAR_DAY1, "GD": BAR_NEW})
    _store(
        # GA: a flat top that moved its hash, flags across scans, a flat base re-seen, an MA pullback
        _ft("ga_ft_old", "GA", 20260901, BAR_DAY1, SCAN_DAY1, BAR_DAY1),
        _ft("ga_ft_new", "GA", 20260901, BAR_NEW, SCAN_NEW, BAR_NEW),
        _flag("ga_f_old", "GA", 20260801, BAR_DAY2, SCAN_DAY2),
        _flag("ga_f_new", "GA", 20260801, BAR_NEW, SCAN_NEW + 2),
        _det("ga_fb", "GA", "flat_base", 20260810, BAR_NEW, SCAN_DAY1),
        _det("ga_pb", "GA", "uct_pullback_ma_v5", 20260820, BAR_NEW, SCAN_NEW + 5),
        _det("ga_doji", "GA", "doji", BAR_NEW, BAR_NEW, SCAN_NEW),
        _det("ga_vcp", "GA", "vcp", 20260801, BAR_DAY1, SCAN_DAY1),
        # GB: everything current, nothing stale
        _flag("gb_f1", "GB", 20260801, BAR_NEW, SCAN_NEW),
        _flag("gb_f2", "GB", 20260806, BAR_NEW, SCAN_NEW + 1),
        _det("gb_fb", "GB", "flat_base", 20260810, BAR_NEW, SCAN_NEW),
        # GC: newest scan was yesterday (a non-leader); its flat top is as of the newest completed bar
        _ft("gc_ft", "GC", 20260901, BAR_DAY1, SCAN_DAY1, BAR_DAY1),
        _flag("gc_f_old", "GC", 20260801, BAR_DAY2, SCAN_DAY2),
        _flag("gc_f", "GC", 20260801, BAR_DAY1, SCAN_DAY1 + 4),
        # GD: the newest scan stopped stamping the flat top; older flags only
        _ft("gd_ft_old", "GD", 20260901, BAR_DAY1, SCAN_DAY1, BAR_DAY1),
        _det("gd_ft_new", "GD", "uct_flat_top_breakout", 20260901, BAR_NEW, SCAN_NEW,
             {"trigger_bars_ago": 1}),
        _flag("gd_f_old", "GD", 20260801, BAR_DAY1, SCAN_DAY1),
    )
    _store(_det("ga_fb", "GA", "flat_base", 20260810, BAR_NEW, SCAN_NEW))   # re-seen, same hash


#: THE GOLDEN: exactly what each ticker's member chart is drawn after the fix.
GOLDEN_MEMBER = {
    "GA": ["ga_f_new", "ga_fb", "ga_ft_new", "ga_pb"],
    "GB": ["gb_f1", "gb_f2", "gb_fb"],
    "GC": ["gc_f", "gc_ft"],
    "GD": [],
}


def _old_member_rows(sym):
    """What the member path served before the fix: member_rows over the member-set read."""
    raw = memory.get_active_detections(sym, "D", pattern_ids=sorted(auto_structures.member_ids()),
                                       include_internal=True)
    return auto_structures.member_rows([{**r, **registry.row_display_policy(r)} for r in raw])


def _current(row, sym, world):
    """Independent of the fix's code: the row was written by the ticker's newest scan (per the raw
    store) and, for a flat top, is stamped as of the ticker's newest completed bar."""
    newest = max(r["last_seen_at"] for r in _all_rows(sym))
    if row["last_seen_at"] < newest - auto_structures.SCAN_TOLERANCE_SECS:
        return False
    if row["pattern_id"] == "uct_flat_top_breakout":
        return row["geometry"]["extras"]["draw_flat_top"]["end_t"] == world[sym]
    return True


def _all_rows(sym):
    from api.services.pattern_engine.pattern_db import get_connection
    conn = get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT id, last_seen_at FROM pattern_detections WHERE sym = ?", (sym,))]
    finally:
        conn.close()


def test_golden_every_currently_correct_member_row_is_still_served(world):
    _seed_golden(world)
    for sym, want in GOLDEN_MEMBER.items():
        got = _ids(_get(PAID_MEMBER, sym))
        assert sorted(got) == want, sym
        old = _old_member_rows(sym)
        old_ids = [r["id"] for r in old]
        # nothing new is ever served, and every old row that is current still is, in the same order
        assert [i for i in old_ids if i in got] == got, sym
        assert [r["id"] for r in old if _current(r, sym, world)] == got, sym
    # the golden is not vacuous: the old path served stale rows the fix now drops
    dropped = {sym: sorted(set(r["id"] for r in _old_member_rows(sym)) - set(GOLDEN_MEMBER[sym]))
               for sym in GOLDEN_MEMBER}
    assert dropped == {"GA": ["ga_f_old", "ga_ft_old"], "GB": [], "GC": ["gc_f_old"],
                       "GD": ["gd_f_old", "gd_ft_old"]}


def test_golden_admin_and_non_structure_responses_are_byte_identical(world, monkeypatch):
    """The admin path and a member's plain request never reach the freshness filter: their bytes are
    the same whether it works or raises."""
    _seed_golden(world)
    plain = "/api/patterns/{sym}?tf=D&confirmed_only=false"

    def fetch(user, url):
        app = FastAPI()
        app.include_router(patterns_router.router)
        authorize(app, user)
        return TestClient(app).get(url).content

    cases = [(ADMIN, URL), (ADMIN, plain), (PAID_MEMBER, plain)]
    before = {(u["role"], url, s): fetch(u, url.format(sym=s))
              for u, url in cases for s in GOLDEN_MEMBER}

    def boom(*a, **k):
        raise AssertionError("freshness filter reached")
    monkeypatch.setattr(auto_structures, "latest_scan_rows", boom)
    monkeypatch.setattr(auto_structures, "fresh_member_rows", boom)
    monkeypatch.setattr(memory, "latest_scan_at", boom)
    after = {(u["role"], url, s): fetch(u, url.format(sym=s))
             for u, url in cases for s in GOLDEN_MEMBER}
    assert after == before
    # admins still see every active row, stale ones included (non-vacuous)
    admin_ga = [r["id"] for r in json.loads(before[("admin", URL, "GA")])["detections"]]
    assert {"ga_ft_old", "ga_f_old", "ga_vcp", "ga_doji"} <= set(admin_ga)
