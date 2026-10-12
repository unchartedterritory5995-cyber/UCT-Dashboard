"""NH/NL Option B validator (`breadth_nhnl_validation`) — proven on synthetic data before any
production read. Values here are synthetic."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import pytest

from api.services import breadth_current as bc
from api.services import breadth_nhnl_validation as nv

ET = bc._ET
NH = {"new_52w_highs": 100, "new_52w_lows": 50, "net_new_high_low": 50, "new_20d_highs": 300,
      "new_20d_lows": 200, "hi_ratio": 1.8, "lo_ratio": 0.9}


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_NHNL_VALIDATION_PATH", str(tmp_path / "cap.json"))


def _payload(data_as_of, metrics=None, carried=False, ok=True):
    row = {"date": "2026-10-12", "final": False, "metrics": dict(metrics or NH)}
    p = {"ok": True, "data_as_of": data_as_of,
         "universes": {u: {"ok": ok, "rows": [row]} for u in nv.UNIVERSES}}
    if carried:
        p["carried"] = True
    return p


def test_nothing_is_captured_before_the_close():
    r = nv.capture(_payload("2026-10-12T15:59:00-04:00"), datetime(2026, 10, 12, 15, 59, 30, tzinfo=ET))
    assert r["captured"] == [] and nv._load() == {}


def test_a_stale_close_is_withheld_then_the_first_provisional_stands():
    nv.capture(_payload("2026-10-12T15:59:50-04:00"), datetime(2026, 10, 12, 16, 1, tzinfo=ET))
    assert nv._load()["2026-10-12"]["us"]["status"] == "withheld"
    nv.capture(_payload("2026-10-12T16:00:30-04:00"), datetime(2026, 10, 12, 16, 2, tzinfo=ET))
    first = nv._load()["2026-10-12"]["us"]
    assert first["status"] == "provisional" and first["data_as_of"].startswith("2026-10-12T16:00:30")
    nv.capture(_payload("2026-10-12T16:10:00-04:00", metrics=dict(NH, new_52w_highs=999)),
               datetime(2026, 10, 12, 16, 11, tzinfo=ET))
    assert nv._load()["2026-10-12"]["us"]["values"]["new_52w_highs"] == 100   # first stands


def test_an_unstamped_carried_payload_is_withheld_never_a_value():
    nv.capture(_payload(None, carried=True), datetime(2026, 10, 12, 16, 30, tzinfo=ET))
    rec = nv._load()["2026-10-12"]["nasdaq"]
    assert rec["status"] == "withheld" and "values" not in rec and rec["carried"]


def test_a_missing_universe_row_is_absent():
    nv.capture(_payload("2026-10-12T16:00:30-04:00", ok=False), datetime(2026, 10, 12, 16, 2, tzinfo=ET))
    assert nv._load()["2026-10-12"]["nyse"]["status"] == "absent"


def test_tolerances():
    assert nv.tolerance("new_52w_highs", {"new_52w_highs": 50}) == 3.0          # floor
    assert nv.tolerance("new_52w_highs", {"new_52w_highs": 500}) == 10.0        # 2%
    assert nv.tolerance("net_new_high_low", {"new_52w_highs": 400, "new_52w_lows": 100}) == 15.0
    assert nv.tolerance("hi_ratio", {}) == 0.1


def _sessions(n, delta=None):
    out, d = {}, date(2026, 9, 1)
    while len(out) < n:
        if d.weekday() < 5:
            vals = dict(NH)
            if delta:
                vals.update(delta(len(out)))
            out[d.isoformat()] = {u: {"status": "provisional", "data_as_of": d.isoformat() + "T16:00:30-04:00",
                                      "values": vals} for u in nv.UNIVERSES}
        d += timedelta(days=1)
    return out


def test_twenty_clean_sessions_pass():
    g = nv.grade(_sessions(20), settled=lambda u, d: dict(NH))
    assert all(m["pass"] for u in g["universes"].values() for m in u["measures"].values())


def test_too_few_sessions_never_pass():
    g = nv.grade(_sessions(19), settled=lambda u, d: dict(NH))
    v = g["universes"]["us"]["measures"]["new_52w_highs"]
    assert not v["pass"] and "19 of 20" in v["reasons"][0]


def test_one_session_beyond_three_times_tolerance_fails():
    g = nv.grade(_sessions(25, lambda i: {"new_52w_highs": 100 + 20} if i == 7 else {}),
                 settled=lambda u, d: dict(NH))
    v = g["universes"]["us"]["measures"]["new_52w_highs"]
    assert not v["pass"] and v["buckets"][">3x"] == 1 and any("beyond 3×" in r for r in v["reasons"])
    assert g["universes"]["us"]["measures"]["new_52w_lows"]["pass"]      # per measure


def test_below_ninety_five_percent_within_fails():
    g = nv.grade(_sessions(20, lambda i: {"new_52w_lows": 50 + 5} if i < 2 else {}),
                 settled=lambda u, d: dict(NH))
    v = g["universes"]["nyse"]["measures"]["new_52w_lows"]
    assert not v["pass"] and v["share_within"] == 0.9 and v["buckets"]["1-2x"] == 2


def test_unsettled_sessions_are_pending_and_withheld_sessions_counted():
    s = _sessions(3)
    s["2026-10-12"] = {u: {"status": "withheld", "reason": "x"} for u in nv.UNIVERSES}
    g = nv.grade(s, settled=lambda u, d: None if d == "2026-09-03" else dict(NH))
    u = g["universes"]["us"]
    assert u["pending_settlement"] == 1 and u["withheld_sessions"] == 1
    assert u["measures"]["new_52w_highs"]["graded"] == 2


def test_the_report_is_value_free(monkeypatch):
    distinctive = {k: 7777 + i for i, k in enumerate(nv.MEASURES)}
    nv.capture(_payload("2026-10-12T16:00:30-04:00", metrics=distinctive),
               datetime(2026, 10, 12, 16, 2, tzinfo=ET))
    monkeypatch.setattr(nv, "_settled_values", lambda u, d: {k: v + 1 for k, v in distinctive.items()})
    text = json.dumps(nv.report())
    assert not any(str(v) in text for v in list(distinctive.values()) + [v + 1 for v in distinctive.values()])


def test_the_live_tick_captures_after_the_close(monkeypatch):
    from api.services import breadth_live_universes as blu
    seen = []
    monkeypatch.setattr(blu, "serving", lambda: True)
    monkeypatch.setattr(blu, "payload", lambda cached_only=True: {})
    monkeypatch.setattr(blu, "check_health", lambda now=None, post=None: {})
    monkeypatch.setattr(nv, "capture", lambda p, now: seen.append(now) or {"captured": []})
    blu.tick(datetime(2026, 10, 12, 16, 5, tzinfo=ET))
    assert seen and "nhnl_capture" in blu.tick(datetime(2026, 10, 12, 16, 6, tzinfo=ET))


def test_capture_never_raises(monkeypatch):
    monkeypatch.setattr(nv, "_load", lambda: (_ for _ in ()).throw(OSError("disk")))
    assert "error" in nv.capture(_payload("2026-10-12T16:00:30-04:00"),
                                 datetime(2026, 10, 12, 16, 2, tzinfo=ET))


def test_capture_never_changes_the_served_payload_and_is_quiet_once_done(monkeypatch):
    import copy
    p = _payload("2026-10-12T16:00:30-04:00")
    snap = copy.deepcopy(p)
    nv.capture(p, datetime(2026, 10, 12, 16, 2, tzinfo=ET))
    assert p == snap                                   # read-only on what members are served
    saves = []
    real = nv._save
    monkeypatch.setattr(nv, "_save", lambda st: saves.append(1) or real(st))
    nv.capture(p, datetime(2026, 10, 12, 16, 3, tzinfo=ET))
    assert saves == []                                 # nothing new -> no rewrite each minute
