"""Base warnings (extras.warning): late-stage / failed breakout / too deep, gated, no lookahead.

pattern_engine/base_warnings.py computes one warning per structures row as of bar i from bars[:i+1];
auto_structures.with_warnings stamps them behind AUTO_STRUCTURES_WARNINGS_ENABLED (default OFF:
byte-identical payloads) and, for a member, only while MEMBER_WARNINGS_ROUND (None) matches.
Synthetic bars only (public repo).
"""
from __future__ import annotations

import json
import random

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures
from api.services.pattern_engine import base_warnings as bw
from api.services.pattern_engine.detectors.registry import display_policy
from tests.authclients import ADMIN, PAID_MEMBER, authorize
from tests.detector_fixtures import ymd_t


def _bars(closes, spread=0.5):
    return [{"t": ymd_t(i), "o": c, "h": c + spread, "l": c - spread, "c": c, "v": 1_000_000.0}
            for i, c in enumerate(closes)]


def _base_row(pivot=100.0, low=90.0, start_i=0, pid="bc:base"):
    t0 = ymd_t(start_i)
    if pid == "bc:base":
        ex = {"draw_base": {"pivot": pivot, "low": low, "start_t": t0, "end_t": ymd_t(start_i + 50),
                            "label": "pivot", "low_label": "base low"}, "draw_round": 1}
    else:
        ex = {"top": pivot, "floor": low, "pivot": pivot}
    return {"id": f"{pid}:X", "pattern_id": pid, "start_t": t0, "end_t": ymd_t(start_i + 50),
            "geometry": {"shape": "base_box", "anchors": [], "extras": ex}, **display_policy(pid)}


@pytest.fixture(autouse=True)
def _no_stage(monkeypatch):
    """The stage count is its own rule; every other test runs with stage 1 unless it says otherwise."""
    from api.services.screener import base_catalog
    monkeypatch.setattr(base_catalog, "base_stage_count", lambda bars: 1)


# ── the rules, one synthetic chart each ─────────────────────────────────────

def _failed_breakout_closes(last):
    # a 60-session base under 100, a close at 102 ten sessions ago, then back to `last`
    return [97.0 + (i % 3) for i in range(60)] + [99.0, 102.0, 101.0, 99.5, 99.0, 98.5, 98.0, 98.0, 98.0, 98.0, last]


def test_failed_breakout_fires_when_price_closes_back_under_the_pivot():
    bars = _bars(_failed_breakout_closes(97.5))
    w = bw.warning_at(bars, len(bars) - 1, _base_row(100.0, 95.0))
    assert w == {"code": "failed_breakout", "text": "failed breakout: closed back below pivot 100.00",
                 "round": bw.WARNINGS_ROUND}


def test_failed_breakout_needs_the_close_BACK_under_the_pivot():
    """Control: the same breakout with the last close still above the line is not a failure."""
    bars = _bars(_failed_breakout_closes(100.8))
    assert bw.warning_at(bars, len(bars) - 1, _base_row(100.0, 95.0)) is None


def test_failed_breakout_needs_a_breakout_first():
    """Control: price under the pivot that never closed above it is just a base."""
    bars = _bars([97.0 + (i % 3) for i in range(70)] + [97.5])
    assert bw.warning_at(bars, len(bars) - 1, _base_row(100.0, 95.0)) is None


def test_failed_breakout_ignores_a_breakout_older_than_the_lookback():
    closes = [97.0 + (i % 3) for i in range(40)] + [103.0] + [97.5] * (bw.FAILED_LOOKBACK + 2)
    bars = _bars(closes)
    assert bw.warning_at(bars, len(bars) - 1, _base_row(100.0, 95.0)) is None


def test_too_deep_is_judged_against_the_shapes_own_norm():
    bars = _bars([95.0] * 40)
    flat = bw.warning_at(bars, 39, _base_row(100.0, 80.0, pid="bc:flat-base"))
    assert flat == {"code": "too_deep", "text": "too deep: 20% (norm <= 15%)", "round": bw.WARNINGS_ROUND}
    # the same 20% is inside a cup's norm (33%), and a shape with no published norm gets none
    assert bw.warning_at(bars, 39, _base_row(100.0, 80.0, pid="bc:cup-with-handle")) is None
    assert bw.warning_at(bars, 39, _base_row(100.0, 60.0, pid="bc:three-weeks-tight")) is None
    deep_cup = bw.warning_at(bars, 39, _base_row(100.0, 60.0, pid="bc:cup-with-handle"))
    assert deep_cup["code"] == "too_deep" and deep_cup["text"] == "too deep: 40% (norm <= 33%)"
    assert bw.warning_at(bars, 39, _base_row(100.0, 90.0, pid="bc:flat-base")) is None


def test_late_stage_labels_the_stage_as_an_estimate(monkeypatch):
    from api.services.screener import base_catalog
    bars = _bars([95.0] * 40)
    row = _base_row(100.0, 92.0)
    for n, want in ((1, None), (2, None), (3, "late-stage base (est. stage 3)"), (4, "late-stage base (est. stage 4)")):
        monkeypatch.setattr(base_catalog, "base_stage_count", lambda b, n=n: n)
        w = bw.warning_at(bars, 39, row)
        assert (w or {}).get("text") == want, n
        if want:
            assert w["code"] == "late_stage" and "est." in w["text"]


def test_the_stage_count_reads_only_bars_up_to_the_as_of_bar(monkeypatch):
    from api.services.screener import base_catalog
    seen = []
    monkeypatch.setattr(base_catalog, "base_stage_count", lambda b: seen.append(len(b)) or 1)
    bars = _bars([95.0] * 80)
    bw.warning_at(bars, 39, _base_row(100.0, 92.0))
    assert seen == [40]


def test_priority_failed_breakout_over_too_deep_over_late_stage(monkeypatch):
    from api.services.screener import base_catalog
    monkeypatch.setattr(base_catalog, "base_stage_count", lambda b: 5)
    bars = _bars(_failed_breakout_closes(97.5))
    deep = _base_row(100.0, 50.0)                       # 50% deep bc:base AND failed AND stage 5
    assert bw.warning_at(bars, len(bars) - 1, deep)["code"] == "failed_breakout"
    calm = _bars([95.0] * 80)
    assert bw.warning_at(calm, 79, deep)["code"] == "too_deep"
    assert bw.warning_at(calm, 79, _base_row(100.0, 92.0))["code"] == "late_stage"


def test_a_row_that_never_draws_carries_no_warning():
    bars = _bars([95.0] * 40)
    hidden = _base_row(100.0, 50.0, pid="bc:darvas-box")          # registry: hidden
    assert hidden["display_tier"] == "hidden"
    assert bw.warning_at(bars, 39, hidden) is None
    rng = _base_row(100.0, 50.0, pid="bc:range-10")
    assert bw.warning_at(bars, 39, rng) is None
    other = {**_base_row(100.0, 50.0), "pattern_id": "draw:inside-day"}
    assert bw.warning_at(bars, 39, other) is None


# ── no lookahead ────────────────────────────────────────────────────────────

def _walk(seed, n=420):
    rnd = random.Random(seed)
    c, out = 50.0, []
    for i in range(n):
        c = max(5.0, c * (1 + rnd.gauss(0.0008, 0.022)))
        out.append(c)
    return out


def _wild(bars, up=True, k=30):
    last = bars[-1]["c"]
    t0 = bars[-1]["t"]
    out = []
    for j in range(k):
        last = last * (1.12 if up else 0.85)
        out.append({"t": t0 + j + 1, "o": last, "h": last * 1.02, "l": last * 0.98, "c": last, "v": 9e7})
    return bars + out


def test_no_lookahead_appending_future_bars_never_changes_a_warning(monkeypatch):
    """The real pipeline: rows built from bars[:i+1] (auto_structures.build_structures, the same rows
    structures_for serves), stamped with bars[:i+1], with the real later history and with 30 wild-up /
    crash bars appended. Every stamp must be identical. Non-vacuous: warnings must actually fire."""
    from api.services.screener import base_catalog
    monkeypatch.undo()   # the real stage count, not the autouse stub
    assert base_catalog.base_stage_count.__name__ == "base_stage_count"
    fired, checked = 0, 0
    for seed in range(6):
        full = _bars(_walk(seed), spread=0.6)
        for i in range(300, len(full) - 1, 7):
            asof = full[:i + 1]
            served, withheld = auto_structures.build_structures("ZZZ", asof)
            want = auto_structures.stamp_warnings(served, withheld, asof, i)
            for ext in (full, _wild(asof, True), _wild(asof, False)):
                got = auto_structures.stamp_warnings(served, withheld, ext, i)
                assert json.dumps(got, sort_keys=True) == json.dumps(want, sort_keys=True), (seed, i)
            checked += 1
    # a constructed failed breakout so the comparison is not over warning-free rows only
    bars = _bars(_failed_breakout_closes(97.5))
    row = _base_row(100.0, 95.0)
    i = len(bars) - 1
    want = bw.warning_at(bars, i, row)
    for ext in (_wild(bars, True), _wild(bars, False), bars + _bars([150.0] * 40)[len(bars):]):
        assert bw.warning_at(ext, i, row) == want
    fired += want is not None
    assert checked > 50 and fired == 1


def test_the_failed_breakout_rule_itself_reads_no_bar_after_i():
    """Direct: a failure visible only AFTER i (a crash below the pivot) must not leak back to i."""
    closes = [97.0 + (i % 3) for i in range(60)] + [102.0, 101.5, 101.0]
    bars = _bars(closes + [96.0, 95.0])
    i = len(closes) - 1
    assert bw.warning_at(bars, i, _base_row(100.0, 95.0)) is None
    assert bw.warning_at(bars, len(bars) - 1, _base_row(100.0, 95.0))["code"] == "failed_breakout"


# ── the gate ────────────────────────────────────────────────────────────────

def _seed(sym, served, withheld, bars):
    auto_structures._CACHE[sym] = (10 ** 12, served)
    auto_structures._WITHHELD_CACHE[sym] = (10 ** 12, withheld, bars)


@pytest.fixture
def _rig(monkeypatch):
    """One served bc:base with a failed breakout, and one WITHHELD flat-base box 20% deep."""
    bars = _bars(_failed_breakout_closes(97.5))
    served = [_base_row(100.0, 95.0)]
    stale = _base_row(110.0, 80.0, pid="bc:flat-base")      # no close ever reached 110: deep, not failed
    stale["geometry"]["extras"].update({"stale": True, "stale_reason": "deep_decline"})
    sym = "ZZZ"
    _seed(sym, served, [stale], bars)
    monkeypatch.setattr(auto_structures, "last_bar_complete", lambda t, now=None: True)
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    yield sym, bars, served, stale
    auto_structures._CACHE.pop(sym, None)
    auto_structures._WITHHELD_CACHE.pop(sym, None)


def test_flag_unset_or_off_returns_the_same_list(monkeypatch, _rig):
    sym, _bars_, served, _stale = _rig
    for val in (None, "0", "false", ""):
        if val is None:
            monkeypatch.delenv("AUTO_STRUCTURES_WARNINGS_ENABLED", raising=False)
        else:
            monkeypatch.setenv("AUTO_STRUCTURES_WARNINGS_ENABLED", val)
        assert auto_structures.with_warnings(sym, served) is served
        assert auto_structures.with_warnings(sym, served, member=True) is served


def test_flag_on_stamps_admins_and_brings_back_a_withheld_fault(monkeypatch, _rig):
    sym, _bars_, served, stale = _rig
    monkeypatch.setenv("AUTO_STRUCTURES_WARNINGS_ENABLED", "1")
    out = auto_structures.with_warnings(sym, served)
    assert [r["geometry"]["extras"]["warning"]["code"] for r in out] == ["failed_breakout", "too_deep"]
    assert out[1]["geometry"]["extras"]["stale"] is True        # still withheld-shaped, drawn only by the tag
    # nothing shared is mutated (structures_for's cache is every viewer's)
    assert "warning" not in served[0]["geometry"]["extras"]
    assert "warning" not in stale["geometry"]["extras"]


def test_members_get_nothing_until_the_member_round_matches(monkeypatch, _rig):
    sym, _bars_, served, _stale = _rig
    monkeypatch.setenv("AUTO_STRUCTURES_WARNINGS_ENABLED", "1")
    assert auto_structures.MEMBER_WARNINGS_ROUND is None
    assert auto_structures.with_warnings(sym, served, member=True) is served
    monkeypatch.setattr(auto_structures, "MEMBER_WARNINGS_ROUND", bw.WARNINGS_ROUND + 1)
    assert auto_structures.with_warnings(sym, served, member=True) is served
    monkeypatch.setattr(auto_structures, "MEMBER_WARNINGS_ROUND", bw.WARNINGS_ROUND)
    out = auto_structures.with_warnings(sym, served, member=True)
    assert [r["geometry"]["extras"]["warning"]["code"] for r in out] == ["failed_breakout"]  # no withheld box


def _client(user):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, user)
    return TestClient(app)


URL = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"


def test_admin_payload_is_byte_identical_with_the_flag_off(monkeypatch, _rig):
    sym, _bars_, served, _stale = _rig
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setattr(patterns_router.memory, "get_active_detections", lambda *a, **k: [])
    monkeypatch.delenv("AUTO_STRUCTURES_WARNINGS_ENABLED", raising=False)
    off = _client(ADMIN).get(URL).content
    # the payload before this change: structures_for's rows, untouched
    monkeypatch.setattr(auto_structures, "with_warnings", lambda s, rows, member=False: rows)
    before = _client(ADMIN).get(URL).content
    assert off == before
    monkeypatch.undo()
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_WARNINGS_ENABLED", "1")
    monkeypatch.setattr(patterns_router.memory, "get_active_detections", lambda *a, **k: [])
    monkeypatch.setattr(auto_structures, "last_bar_complete", lambda t, now=None: True)
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    on = _client(ADMIN).get(URL).json()
    assert [r["geometry"]["extras"]["warning"]["code"] for r in on["structures"]] == ["failed_breakout", "too_deep"]
    assert b'"warning"' not in off


def test_member_payload_carries_no_warning_with_the_flag_on(monkeypatch, _rig):
    """MEMBER_WARNINGS_ROUND is None: a member's structures never carry a warning, flag on or off."""
    sym, _bars_, _served, _stale = _rig
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_MEMBERS_ENABLED", "1")
    monkeypatch.setattr(patterns_router.memory, "get_active_detections", lambda *a, **k: [])
    monkeypatch.setattr(patterns_router.memory, "latest_scan_at", lambda sym, tf: 1)
    bodies = []
    for flag in ("0", "1"):
        monkeypatch.setenv("AUTO_STRUCTURES_WARNINGS_ENABLED", flag)
        bodies.append(_client(PAID_MEMBER).get(URL).content)
    assert bodies[0] == bodies[1]
    assert b'"warning"' not in bodies[1]
